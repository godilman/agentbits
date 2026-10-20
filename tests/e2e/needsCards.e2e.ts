// "Needs you" cards in the project chat (ADR-034): a card says what waits and offers only the actions the app has for
// it; the main process checks every action again (`needs:act`), runs it once, and closes every copy of the card with
// how the wait really ended. Real SQLite, real orchestrator and IPC handlers; the provider is a stub.
// Run: npm run test:e2e
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDb, openDb } from '../../src/main/db'
import { agentsRepo, messagesRepo, runsRepo, settingsRepo, tasksRepo } from '../../src/main/db/repos'
import { handlers } from '../../src/main/ipc'
import { orchestrator } from '../../src/main/core/orchestrator'
import { projectLead, projectMembers } from '../../src/main/core/org'
import { listApprovals, rejectApprovalsForRun, waitForApproval } from '../../src/main/connections/service'
import { getAdapter } from '../../src/main/providers'
import { applyLanguageSetting } from '../../src/main/i18n'
import type { Message, NeedsCard } from '../../src/shared/types'
import type { RunContext } from '../../src/main/providers/types'

let count = 0
const step = async (name: string, fn: () => Promise<void> | void): Promise<void> => {
  await fn()
  count++
  console.log(`  ✓ ${name}`)
}
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const until = async (cond: () => boolean, what: string, ms = 8000): Promise<void> => {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
    await wait(10)
  }
}
const call = <T = any>(name: string, ...args: unknown[]): Promise<T> => Promise.resolve().then(() => (handlers as any)[name](...args))
const o = orchestrator as any
const restart = (): void => {
  orchestrator.shutdown()
  o.closing = false
  // A new process doesn't hold the old one's waiting approvals (nor the agents those runs kept busy).
  o.approvals.clear()
  o.busy.clear()
  orchestrator.init()
}

let workCalls = 0
let work: (ctx: RunContext) => Promise<string> = async () => 'done'
let reviewCalls = 0
let review: (ctx: RunContext) => Promise<string> = async () => '{"approved": true, "note": "ok"}'
getAdapter('mock').run = async (ctx: RunContext) => {
  if (ctx.mode === 'review') {
    reviewCalls++
    return { text: await review(ctx), tokensIn: 1, tokensOut: 1, costUsd: 0 }
  }
  if (ctx.mode === 'chat') return { text: 'Ok.', tokensIn: 1, tokensOut: 1, costUsd: 0 }
  workCalls++
  return { text: await work(ctx), tokensIn: 1, tokensOut: 1, costUsd: 0 }
}

/** Every card copy of an event (#general + the task thread), read from the DB. */
const copies = (event: string): Message[] =>
  (getDb().prepare(`SELECT id FROM messages WHERE json_extract(meta, '$.card.event') = ?`).all(event) as { id: string }[]).map(
    (r) => messagesRepo.get(r.id)!
  )
const cardsOf = (taskId: string, pid: string): Message[] => messagesRepo.list(`task:${taskId}`, 200, pid).filter((m) => m.meta?.card)
const lastCard = (taskId: string, pid: string): NeedsCard => cardsOf(taskId, pid).at(-1)!.meta!.card as NeedsCard
const outcomes = (event: string): (string | null)[] => copies(event).map((m) => (m.meta?.resolution as { outcome: string } | undefined)?.outcome ?? null)
/** Every run of the task has finished (approved work ran to its end). */
const ended = (taskId: string): boolean => runsRepo.list({ taskId }).every((r) => r.status === 'succeeded' || r.status === 'failed' || r.status === 'cancelled')
const waitingRun = (taskId: string) => runsRepo.list({ taskId }).find((r) => r.status === 'awaiting_approval')

async function main(): Promise<void> {
  openDb()
  const tpl = await call('templates:instantiate', 'ecommerce')
  const p1 = await call('projects:save', { name: 'P1', rootPath: mkdtempSync(join(tmpdir(), 'ab-nc1-')), unitIds: [tpl.unitId] })
  const tpl2 = await call('templates:instantiate', 'core')
  const p2 = await call('projects:save', { name: 'P2', rootPath: mkdtempSync(join(tmpdir(), 'ab-nc2-')), unitIds: [tpl2.unitId] })
  settingsRepo.update({ onboarded: true, autopilot: false, reviewByLead: false, raceMode: false, language: 'en' })
  getDb().prepare('UPDATE agent_permissions SET require_approval = 1').run()
  applyLanguageSetting('en')
  orchestrator.init()
  const lead = projectLead(p1.id)!
  const dev = projectMembers(p1.id).filter((a) => !a.isLead && a.id !== lead.id)[0]
  const task = (title: string) => tasksRepo.create({ title, projectId: p1.id, assigneeId: dev.id })
  const idle = () => agentsRepo.setStatus(dev.id, 'idle')
  /** Starts a task that asks before it runs; returns its card event. */
  const asking = async (title: string) => {
    const t1 = task(title)
    idle()
    await call('tasks:start', t1.id)
    await until(() => !!waitingRun(t1.id) && cardsOf(t1.id, p1.id).length > 0, 'the approval card')
    return { t1, event: lastCard(t1.id, p1.id).event, runId: waitingRun(t1.id)!.id }
  }

  let approved!: Awaited<ReturnType<typeof asking>>
  // ── run approval ───────────────────────────────────────────────────────────────────────────────────────────────
  await step('run approval: one card in #general and the thread (same event), real capabilities, no "tamam" approval', async () => {
    approved = await asking('approve from chat')
    const { t1, event, runId } = approved
    const cs = copies(event)
    assert.deepEqual(cs.map((m) => m.channel).sort(), ['general', `task:${t1.id}`])
    assert.ok(cs.every((m) => m.meta?.event === event && m.projectId === p1.id))
    const card = cs[0].meta!.card as NeedsCard
    assert.deepEqual(card.actions, ['reject', 'approve', 'openTask'])
    assert.equal(card.runId, runId)
    assert.match(cs[0].content, /waiting for your approval[\s\S]*will be able to use: .+\. Approving doesn't widen/)
    assert.match(cs[0].content, new RegExp(`· ${t1.key}$`))
    // Typing an approval word in the chat is a message, not a decision.
    await call('messages:send', 'general', 'tamam', p1.id)
    await call('messages:send', `task:${t1.id}`, 'ok, approve', p1.id)
    await wait(100)
    assert.equal(runsRepo.get(runId)!.status, 'awaiting_approval')
    assert.deepEqual(outcomes(event), [null, null])
    assert.equal(workCalls, 0)
  })

  await step('run approval: approve from the card runs the work once; both copies say "approved"; a 2nd click is gone', async () => {
    const { t1, event, runId } = approved
    const before = workCalls
    assert.deepEqual(await call('needs:act', p1.id, event, 'approve'), { result: 'done', outcome: 'approved' })
    await until(() => workCalls === before + 1 && ended(t1.id), 'the work')
    assert.deepEqual(outcomes(event), ['approved', 'approved'])
    assert.deepEqual(await call('needs:act', p1.id, event, 'approve'), { result: 'gone', outcome: null })
    await call('runs:approve', runId, true) // the panel, late: nothing
    await wait(50)
    assert.equal(workCalls, before + 1)
  })

  await step('run approval: the chat and the panel at once → applied once', async () => {
    const { t1, event, runId } = await asking('chat and panel at once')
    const before = workCalls
    const [r1, , r3] = await Promise.all([call('needs:act', p1.id, event, 'approve'), call('runs:approve', runId, true), call('needs:act', p1.id, event, 'approve')])
    assert.deepEqual([r1.result, r3.result], ['done', 'gone'], 'the first answer counts; the others find nothing')
    await until(() => ended(t1.id), 'the work')
    await wait(50)
    assert.equal(workCalls, before + 1)
    assert.equal(runsRepo.list({ taskId: t1.id }).length, 1)
    assert.deepEqual(outcomes(event), ['approved', 'approved'])
  })

  await step('run approval: reject from the card → not started, held, both copies "rejected"', async () => {
    const { t1, event, runId } = await asking('reject from chat')
    const before = workCalls
    assert.deepEqual(await call('needs:act', p1.id, event, 'reject'), { result: 'done', outcome: 'rejected' })
    await until(() => runsRepo.get(runId)!.status === 'cancelled', 'cancelled')
    assert.equal(workCalls, before)
    assert.equal(tasksRepo.get(t1.id)!.status, 'todo')
    assert.ok(orchestrator.state().held.some((h) => h.taskId === t1.id))
    assert.deepEqual(outcomes(event), ['rejected', 'rejected'])
  })

  await step('another project: the card is refused there and stays waiting; no card leaks into its chat', async () => {
    const { event, runId } = await asking('cross project')
    await assert.rejects(call('needs:act', p2.id, event, 'approve'), /isn't in this project|not in this project|project/i)
    assert.equal(runsRepo.get(runId)!.status, 'awaiting_approval')
    assert.deepEqual(outcomes(event), [null, null])
    assert.equal(messagesRepo.list('general', 500, p2.id).filter((m) => m.meta?.card).length, 0)
    // An action this kind of wait doesn't have (the card is not trusted).
    await assert.rejects(call('needs:act', p1.id, event, 'retry'))
    assert.equal(runsRepo.get(runId)!.status, 'awaiting_approval')
    // Stopped elsewhere: the card says so; a click is "gone" and starts nothing.
    orchestrator.stopRun(runId)
    await until(() => outcomes(event).every((x) => x === 'withdrawn'), 'withdrawn')
    const before = workCalls
    assert.deepEqual(await call('needs:act', p1.id, event, 'approve'), { result: 'gone', outcome: null })
    await assert.rejects(call('needs:act', p1.id, 'run:nope:approval', 'approve')) // a run that doesn't exist
    await wait(50)
    assert.equal(workCalls, before)
  })

  await step('the action worked but writing how it ended failed: a re-click does not repeat it', async () => {
    const { t1, event } = await asking('record fails')
    const before = workCalls
    const setMeta = messagesRepo.setMeta
    messagesRepo.setMeta = () => {
      throw new Error('SQLITE_FULL: database or disk is full')
    }
    try {
      assert.deepEqual(await call('needs:act', p1.id, event, 'approve'), { result: 'done', outcome: 'approved' })
      await until(() => workCalls === before + 1, 'the work')
      assert.deepEqual(outcomes(event), [null, null], 'not recorded')
      assert.deepEqual(await call('needs:act', p1.id, event, 'approve'), { result: 'gone', outcome: null })
    } finally {
      messagesRepo.setMeta = setMeta
    }
    await until(() => ended(t1.id), 'done')
    assert.equal(workCalls, before + 1)
    assert.equal(runsRepo.list({ taskId: t1.id }).length, 1)
  })

  await step('restart: a run that was waiting for approval closes its card ("closed"), nothing runs', async () => {
    const { event, runId } = await asking('waiting at restart')
    const before = workCalls
    restart()
    assert.notEqual(runsRepo.get(runId)!.status, 'awaiting_approval')
    assert.deepEqual(outcomes(event), ['closed', 'closed'])
    assert.deepEqual(await call('needs:act', p1.id, event, 'approve'), { result: 'gone', outcome: null })
    await wait(50)
    assert.equal(workCalls, before)
  })

  await step('approved, but the agent was turned off meanwhile: not "approved" — withdrawn, not started', async () => {
    const { t1, event, runId } = await asking('agent off while waiting')
    getDb().prepare('UPDATE agents SET enabled = 0 WHERE id = ?').run(dev.id)
    const before = workCalls
    await call('needs:act', p1.id, event, 'approve')
    await until(() => runsRepo.get(runId)!.status === 'cancelled', 'cancelled')
    assert.deepEqual(outcomes(event), ['withdrawn', 'withdrawn'])
    assert.equal(workCalls, before)
    assert.ok(orchestrator.state().held.some((h) => h.taskId === t1.id))
    getDb().prepare('UPDATE agents SET enabled = 1 WHERE id = ?').run(dev.id)
    idle()
  })

  await step('approved, but what the agent can use changed meanwhile: the yes was for the old list — withdrawn', async () => {
    const { t1, event, runId } = await asking('caps change while waiting')
    const terminal = getDb().prepare('SELECT terminal FROM agent_permissions WHERE agent_id = ?').get(dev.id) as { terminal: number }
    getDb().prepare('UPDATE agent_permissions SET terminal = ? WHERE agent_id = ?').run(terminal.terminal ? 0 : 1, dev.id)
    const before = workCalls
    await call('needs:act', p1.id, event, 'approve')
    await until(() => runsRepo.get(runId)!.status === 'cancelled', 'cancelled')
    assert.equal(workCalls, before)
    assert.deepEqual(outcomes(event), ['withdrawn', 'withdrawn'])
    assert.match(orchestrator.state().held.find((h) => h.taskId === t1.id)!.reason, /changed while it waited/)
    getDb().prepare('UPDATE agent_permissions SET terminal = ? WHERE agent_id = ?').run(terminal.terminal, dev.id)
    idle()
  })

  await step('the card lists what the provider really allows (Demo honours the switches; extra folders named)', async () => {
    getDb().prepare("UPDATE agent_permissions SET fs_write = 0, terminal = 0, allowed_paths = ? WHERE agent_id = ?").run(JSON.stringify(['/srv/shared']), dev.id)
    const { event, runId } = await asking('caps text')
    const text = copies(event)[0].content
    assert.match(text, /reading files/)
    assert.doesNotMatch(text, /writing files|the terminal/)
    assert.match(text, /files outside the project: \/srv\/shared/)
    assert.match(text, /project memory/)
    orchestrator.stopRun(runId)
    getDb().prepare("UPDATE agent_permissions SET fs_write = 1, terminal = 1, allowed_paths = '[]' WHERE agent_id = ?").run(dev.id)
    idle()
  })

  // ── connection / app approval ──────────────────────────────────────────────────────────────────────────────────
  await step('connection approval: the card opens the panel (no approve here); the panel decides; details kept', async () => {
    const t1 = task('needs a query')
    const decided = waitForApproval(
      { agentId: dev.id, taskId: t1.id, projectId: p1.id, runId: null },
      { connectionId: 'c1', connectionName: 'Orders DB', operation: 'query', detail: 'UPDATE orders SET paid = 1 WHERE id = 7', needs: 'write' } as never
    )
    const a = listApprovals().find((x) => x.taskId === t1.id)!
    const event = `approval:${a.id}`
    const cs = copies(event)
    assert.equal(cs.length, 2)
    const card = cs[0].meta!.card as NeedsCard
    assert.equal(card.kind, 'connApproval')
    assert.deepEqual(card.actions, ['openApproval', 'openTask'])
    assert.equal(card.approvalId, a.id)
    assert.match(cs[0].content, /Orders DB — a SQL query \(needs .+ access\)[\s\S]*approval panel/)
    // The chat can't decide it: approving through needs:act does nothing.
    assert.deepEqual(await call('needs:act', p1.id, event, 'approve'), { result: 'gone', outcome: null })
    assert.ok(listApprovals().some((x) => x.id === a.id), 'still waiting, with its details')
    assert.equal(listApprovals().find((x) => x.id === a.id)!.detail, 'UPDATE orders SET paid = 1 WHERE id = 7')
    await call('approvals:resolve', a.id, true)
    assert.equal(await decided, true)
    assert.deepEqual(outcomes(event), ['allowed', 'allowed'], 'the operation may run (not "the run may start")')
    await assert.rejects(call('approvals:resolve', a.id, true)) // already decided: not twice
  })

  await step('connection approval: rejected in the panel → "rejected"; an app tool request; an expired one says so', async () => {
    const t1 = task('more requests')
    const ctx = { agentId: dev.id, taskId: t1.id, projectId: p1.id, runId: null }
    const no = waitForApproval(ctx, { connectionId: 'c1', connectionName: 'Orders DB', operation: 'exec', detail: 'rm -rf /tmp/x', needs: 'admin' } as never)
    const a1 = listApprovals().find((x) => x.detail === 'rm -rf /tmp/x')!
    await call('approvals:resolve', a1.id, false)
    assert.equal(await no, false)
    assert.deepEqual(outcomes(`approval:${a1.id}`), ['rejected', 'rejected'])
    // An app tool: same card kind, its text names the tool; "allowed" when approved.
    const app = waitForApproval(ctx, { connectionId: 'app1', connectionName: 'Jira', operation: 'app', tool: 'create_issue', detail: '{"title":"x"}', needs: 'write' } as never)
    const a2 = listApprovals().find((x) => x.connectionName === 'Jira')!
    const c2 = copies(`approval:${a2.id}`)
    assert.equal((c2[0].meta!.card as NeedsCard).kind, 'connApproval')
    assert.match(c2[0].content, /Jira — the app tool create_issue/)
    await call('approvals:resolve', a2.id, true)
    assert.equal(await app, true)
    assert.deepEqual(outcomes(`approval:${a2.id}`), ['allowed', 'allowed'])
    // Expiry: the dock's timer fires (captured instead of waiting 10 minutes).
    const realSet = globalThis.setTimeout
    let fire: (() => void) | null = null
    ;(globalThis as any).setTimeout = (fn: () => void, ms: number) => (ms >= 60_000 ? ((fire = fn), realSet(() => {}, 0)) : realSet(fn, ms))
    const late = waitForApproval(ctx, { connectionId: 'c1', connectionName: 'Orders DB', operation: 'query', detail: 'SELECT 1', needs: 'read' } as never)
    globalThis.setTimeout = realSet
    const a3 = listApprovals().find((x) => x.detail === 'SELECT 1')!
    assert.ok(fire, 'the expiry timer')
    fire!()
    assert.equal(await late, false)
    assert.deepEqual(outcomes(`approval:${a3.id}`), ['expired', 'expired'])
    assert.ok(!listApprovals().some((x) => x.id === a3.id))
    await assert.rejects(call('approvals:resolve', a3.id, true), 'too late: nothing to approve')
  })

  await step('a run stopped while a connection request waits: the request is withdrawn (not "closed")', async () => {
    const t1 = task('run with a request')
    const pending = waitForApproval({ agentId: dev.id, taskId: t1.id, projectId: p1.id, runId: 'run-x' }, { connectionId: 'c1', connectionName: 'Orders DB', operation: 'query', detail: 'SELECT 2', needs: 'read' } as never)
    const a = listApprovals().find((x) => x.detail === 'SELECT 2')!
    rejectApprovalsForRun('run-x')
    assert.equal(await pending, false)
    assert.deepEqual(outcomes(`approval:${a.id}`), ['withdrawn', 'withdrawn'])
  })

  // ── failed run (held) ──────────────────────────────────────────────────────────────────────────────────────────
  getDb().prepare('UPDATE agent_permissions SET require_approval = 0').run()
  await step('failed run: a "retry" card; an error keeps the card and the wait; retry starts it again; says nothing is undone', async () => {
    work = async () => {
      throw new Error('TypeError: fetch failed')
    }
    const t1 = task('fails then retried')
    idle()
    await call('tasks:start', t1.id)
    await until(() => orchestrator.state().held.some((h) => h.taskId === t1.id) && cardsOf(t1.id, p1.id).length > 0, 'held')
    const card = lastCard(t1.id, p1.id)
    assert.equal(card.kind, 'held')
    assert.deepEqual(card.actions, ['retry', 'openTask'])
    // Retrying doesn't undo the earlier attempt: #general says so plainly, the thread with the details.
    assert.match(copies(card.event).find((m) => m.channel === 'general')!.content, /nothing the earlier attempt did is undone/)
    assert.match(cardsOf(t1.id, p1.id).at(-1)!.content, /may have changed files[\s\S]*Check what it left behind/)
    assert.ok(orchestrator.state().waitEvents.includes(card.event))
    // From another project's chat: refused, nothing starts.
    await assert.rejects(call('needs:act', p2.id, card.event, 'retry'), /another project/)
    assert.equal(runsRepo.list({ taskId: t1.id }).length, 1)
    // It can't start (agent turned off): the error says why, the card and the hold stay.
    getDb().prepare('UPDATE agents SET enabled = 0 WHERE id = ?').run(dev.id)
    await assert.rejects(call('needs:act', p1.id, card.event, 'retry'))
    assert.ok(orchestrator.state().held.some((h) => h.taskId === t1.id))
    assert.deepEqual(outcomes(card.event), [null, null])
    getDb().prepare('UPDATE agents SET enabled = 1 WHERE id = ?').run(dev.id)
    idle()
    // Restart in between: the persisted wait id still works.
    restart()
    assert.ok(orchestrator.state().waitEvents.includes(card.event))
    work = async () => 'fixed'
    const runs = runsRepo.list({ taskId: t1.id }).length
    assert.deepEqual(await call('needs:act', p1.id, card.event, 'retry'), { result: 'done', outcome: 'restarted' })
    await until(() => ended(t1.id), 'done')
    assert.equal(runsRepo.list({ taskId: t1.id }).length, runs + 1)
    assert.deepEqual(outcomes(card.event), ['restarted', 'restarted'])
    assert.deepEqual(await call('needs:act', p1.id, card.event, 'retry'), { result: 'gone', outcome: null })
    // Held again for a newer reason while a card is open: the old one says it was superseded, the new one waits.
    o.hold(t1.id, 'first reason', { why: 'failed', event: 'run:A:held' })
    o.heldCard(tasksRepo.get(t1.id), 'run:A:held', 'first', 'first')
    o.hold(t1.id, 'second reason', { why: 'failed', event: 'run:B:held' })
    o.heldCard(tasksRepo.get(t1.id), 'run:B:held', 'second', 'second')
    assert.deepEqual(outcomes('run:A:held'), ['superseded', 'superseded'])
    assert.deepEqual(outcomes('run:B:held'), [null, null])
    assert.ok(orchestrator.state().waitEvents.includes('run:B:held') && !orchestrator.state().waitEvents.includes('run:A:held'))
    o.release(t1.id)
    assert.deepEqual(outcomes('run:B:held'), ['moved', 'moved'])
  })

  // ── review couldn't decide ─────────────────────────────────────────────────────────────────────────────────────
  settingsRepo.update({ reviewByLead: true })
  await step('review error: "retry the review" reviews again without running the worker; a new wait is a new card', async () => {
    work = async () => 'worker report: fixed it'
    review = async () => {
      throw new Error('The operation was aborted due to timeout')
    }
    const t1 = task('review fails')
    idle()
    await call('tasks:start', t1.id)
    await until(() => orchestrator.state().undecided.includes(t1.id) && cardsOf(t1.id, p1.id).length > 0, 'needs you')
    const first = lastCard(t1.id, p1.id)
    assert.equal(first.kind, 'undecided')
    assert.deepEqual(first.actions, ['retryReview', 'openTask'])
    const w = workCalls
    const r = reviewCalls
    assert.deepEqual(await call('needs:act', p1.id, first.event, 'retryReview'), { result: 'done', outcome: 'reviewRequested' })
    await until(() => reviewCalls > r && orchestrator.state().undecided.includes(t1.id) && lastCard(t1.id, p1.id).event !== first.event, 'needs you again')
    assert.equal(workCalls, w, 'the worker did not run')
    assert.deepEqual(outcomes(first.event), ['reviewRequested', 'reviewRequested'])
    const second = lastCard(t1.id, p1.id)
    assert.deepEqual(outcomes(second.event), [null, null], 'the new wait has its own open card')
    // The old card stays closed: its action is gone, the new wait is untouched.
    assert.deepEqual(await call('needs:act', p1.id, first.event, 'retryReview'), { result: 'gone', outcome: null })
    assert.ok(orchestrator.state().undecided.includes(t1.id))
    // A restart keeps the open one open, the closed one closed.
    restart()
    assert.ok(orchestrator.state().waitEvents.includes(second.event))
    assert.ok(!orchestrator.state().waitEvents.includes(first.event))
    // The user decides elsewhere (moves it): the card says so.
    await call('tasks:move', t1.id, 'done')
    orchestrator.state()
    assert.deepEqual(outcomes(second.event), ['moved', 'moved'])
  })

  await step('review already queued: the card says so (not "taken"); the same reason twice is one card', async () => {
    review = async () => {
      throw new Error('The operation was aborted due to timeout')
    }
    const t1 = task('queued review')
    idle()
    await call('tasks:start', t1.id)
    await until(() => orchestrator.state().undecided.includes(t1.id) && cardsOf(t1.id, p1.id).length > 0, 'needs you')
    const card = lastCard(t1.id, p1.id)
    o.reviewing.add(t1.id) // another trigger queued it meanwhile
    await assert.rejects(call('needs:act', p1.id, card.event, 'retryReview'), /already queued/)
    o.reviewing.delete(t1.id)
    assert.deepEqual(outcomes(card.event), [null, null], 'still waiting')
    // The same reason again (e.g. a race reviewed twice before anyone answered): no second card, no new wait.
    const n = cardsOf(t1.id, p1.id).length
    o.needsUser(t1.id, orchestrator.state().undecidedWhy[t1.id], `review:${t1.id}:again`)
    assert.equal(cardsOf(t1.id, p1.id).length, n)
    assert.ok(orchestrator.state().waitEvents.includes(card.event))
    await call('tasks:move', t1.id, 'done')
  })

  await step('merge waits (dirty project folder): a card; it survives a restart; isolation off → "nothing waits", not "merged"', async () => {
    const sh = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
    const repo = mkdtempSync(join(tmpdir(), 'ab-nc-wt-'))
    sh(repo, 'init', '-q')
    sh(repo, 'config', 'user.email', 't@t')
    sh(repo, 'config', 'user.name', 't')
    writeFileSync(join(repo, 'a.txt'), 'one\n')
    sh(repo, 'add', '.')
    sh(repo, 'commit', '-qm', 'init')
    const wp = await call('projects:save', { name: 'W', rootPath: repo, unitIds: [tpl.unitId], isolation: 'worktree' })
    const t1 = tasksRepo.create({ title: 'merge has to wait', projectId: wp.id, assigneeId: dev.id })
    const copy = await o.prepareWorktree(wp, t1, { runId: 'rw', agentId: dev.id, taskId: t1.id, projectId: wp.id })
    writeFileSync(join(copy.dir, 'b.txt'), 'from the agent\n')
    writeFileSync(join(repo, 'a.txt'), 'edited by hand\n') // dirty: the merge waits
    tasksRepo.update(t1.id, { status: 'done' })
    await o.finishAndNotify(t1.id, 'review:wt')
    const card = lastCard(t1.id, wp.id)
    assert.equal(card.kind, 'merge')
    assert.deepEqual(card.actions, ['reviewMerge', 'openTask'])
    assert.match(cardsOf(t1.id, wp.id).at(-1)!.content, /uncommitted changes[\s\S]*Review changes and merge/)
    // Tried again while still dirty: a new card, the earlier one says it was superseded.
    await o.finishAndNotify(t1.id, 'review:wt2')
    const again = lastCard(t1.id, wp.id)
    assert.notEqual(again.event, card.event)
    assert.deepEqual(outcomes(card.event), ['superseded', 'superseded'])
    restart()
    assert.ok(orchestrator.state().waitEvents.includes(again.event), 'still waiting after a restart')
    await call('projects:save', { isolation: 'shared' }, wp.id)
    orchestrator.state()
    assert.deepEqual(outcomes(again.event), ['mergeGone', 'mergeGone'])
  })

  console.log(`needsCards e2e: ${count} steps ok`)
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e)
    process.exit(1)
  }
)
