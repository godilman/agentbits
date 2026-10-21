// "Cancel task": the user gives up a task. The mark is written first, so nothing later — a run or review ending late,
// a queued review, autopilot, a card, a restart — reopens, finishes or merges it. "Cancelled" is said only once the run
// really stopped; nothing is undone; the task and its history stay; tasks depending on it wait and say why; a race's
// attempts go together; "Reopen" starts nothing. Real SQLite, real orchestrator and IPC handlers; the provider is a stub.
// Run: npm run test:e2e
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDb, openDb } from '../../src/main/db'
import { agentsRepo, messagesRepo, runsRepo, settingsRepo, tasksRepo } from '../../src/main/db/repos'
import { handlers } from '../../src/main/ipc'
import { orchestrator } from '../../src/main/core/orchestrator'
import { projectLead, projectMembers } from '../../src/main/core/org'
import { AbortedError, getAdapter } from '../../src/main/providers'
import { applyLanguageSetting } from '../../src/main/i18n'
import type { Message, NeedsCard, Task } from '../../src/shared/types'
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
  // A new process holds none of the old one's in-memory runs, approvals or busy agents.
  o.approvals.clear()
  o.busy.clear()
  o.active.clear()
  orchestrator.init()
}

/** The worker: by default it works until it is stopped (honours the stop); a step can script it otherwise. */
let workCalls = 0
let work: (ctx: RunContext) => Promise<string> = (ctx) =>
  new Promise((_, reject) => ctx.signal.addEventListener('abort', () => reject(new AbortedError())))
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
const untilAbort = (ctx: RunContext): Promise<string> =>
  new Promise((_, reject) => ctx.signal.addEventListener('abort', () => reject(new AbortedError())))

const get = (id: string): Task => tasksRepo.get(id)!
const runsOf = (id: string) => runsRepo.list({ taskId: id })
const thread = (id: string, pid: string): Message[] => messagesRepo.list(`task:${id}`, 200, pid)
const said = (id: string, pid: string, re: RegExp): number => thread(id, pid).filter((m) => re.test(m.content)).length
const held = (id: string): boolean => orchestrator.state().held.some((h) => h.taskId === id)
const isRunning = (id: string): boolean => [...o.active.values()].some((r: { taskId: string }) => r.taskId === id)
const outcomes = (event: string): (string | null)[] =>
  (getDb().prepare(`SELECT id FROM messages WHERE json_extract(meta, '$.card.event') = ?`).all(event) as { id: string }[]).map(
    (r) => (messagesRepo.get(r.id)!.meta?.resolution as { outcome: string } | undefined)?.outcome ?? null
  )

async function main(): Promise<void> {
  openDb()
  const tpl = await call('templates:instantiate', 'ecommerce')
  const p = await call('projects:save', { name: 'P', rootPath: mkdtempSync(join(tmpdir(), 'ab-cx-')), unitIds: [tpl.unitId] })
  // The paths without recovery (ADR-036 has its own test: reviewRecovery.e2e.ts).
  settingsRepo.update({ onboarded: true, autopilot: false, reviewByLead: false, raceMode: false, language: 'en', autoRecovery: false })
  getDb().prepare('UPDATE agent_permissions SET require_approval = 0').run()
  applyLanguageSetting('en')
  orchestrator.init()
  const lead = projectLead(p.id)!
  const [dev, dev2] = projectMembers(p.id).filter((a) => !a.isLead && a.id !== lead.id)
  const task = (title: string, extra: Record<string, unknown> = {}) => tasksRepo.create({ title, projectId: p.id, assigneeId: dev.id, ...extra })
  const idle = (): void => {
    agentsRepo.setStatus(dev.id, 'idle')
    agentsRepo.setStatus(dev2.id, 'idle')
  }
  /** Autopilot on, ticks; then off again. Returns how many runs were started meanwhile. */
  const autopilot = async (): Promise<void> => {
    settingsRepo.update({ autopilot: true })
    orchestrator.startProjectWork(p.id)
    for (let i = 0; i < 5; i++) {
      idle()
      o.tick()
      await wait(30)
    }
    settingsRepo.update({ autopilot: false })
  }

  await step('a running task: the agent is stopped, then "cancelled" — kept (not done, not deleted, not held)', async () => {
    work = untilAbort
    const t1 = task('running, then cancelled')
    idle()
    await call('tasks:start', t1.id)
    await until(() => isRunning(t1.id), 'the run')
    const scope = await call('tasks:cancelScope', t1.id)
    assert.deepEqual(scope, { keys: [t1.key], dependents: [], running: true, awaitingApproval: false })
    const r = await call('tasks:cancel', t1.id)
    assert.deepEqual(r, { keys: [t1.key], stopped: true })
    const after = get(t1.id)
    assert.ok(after.cancelledAt, 'marked')
    assert.equal(after.status, 'todo')
    assert.notEqual(after.completedBy, 'user')
    assert.equal(runsOf(t1.id)[0].status, 'cancelled')
    assert.ok(!held(t1.id), 'not a held task waiting for "Try again"')
    // Requested first (a run was going), then confirmed with what it left, once.
    assert.equal(said(t1.id, p.id, /Cancel requested/), 1)
    assert.equal(said(t1.id, p.id, /is cancelled: its agent/), 1)
    // No usage record of the stopped run here: what it touched can't be told — said so, not guessed.
    assert.match(thread(t1.id, p.id).at(-1)!.content, /isn't known[\s\S]*no connection or app operation[\s\S]*Nothing was undone[\s\S]*The task and its history are kept/)
    assert.equal(said(t1.id, p.id, /⏹ Stopped/), 0, 'no "stopped, start it again" note')
  })

  await step('a cancelled task is never picked up again: autopilot, "Start now", a drag, a card', async () => {
    const id = (getDb().prepare("SELECT id FROM tasks WHERE title = 'running, then cancelled'").get() as { id: string }).id
    const before = workCalls
    await autopilot()
    await call('tasks:start', id)
    await wait(80)
    await assert.rejects(call('tasks:move', id, 'in_progress'), /cancelled: reopen it first/)
    await assert.rejects(call('tasks:move', id, 'done'), /cancelled: reopen it first/)
    assert.equal(workCalls, before)
    assert.equal(runsOf(id).length, 1)
    await assert.rejects(call('tasks:cancel', id), /already cancelled/)
    // Each layer on its own: autopilot's picker never returns it, a review is never queued for it.
    assert.ok(!tasksRepo.queuedFor([dev.id], [p.id]).some((x) => x.id === id), 'not in the picker')
    assert.equal(tasksRepo.nextFor(dev.id, new Set(), [p.id], [p.id])?.id === id, false)
    o.queueReview(id)
    assert.ok(!o.reviewing.has(id), 'no review queued')
  })

  await step('a provider that ignores the stop: "requested", not "cancelled"; its late result opens nothing', async () => {
    let finish: (() => void) | null = null
    work = () => new Promise((res) => (finish = () => res('late report: all done')))
    settingsRepo.update({ reviewByLead: true })
    const t1 = task('late result')
    idle()
    await call('tasks:start', t1.id)
    await until(() => !!finish, 'the provider working (past the preparation)')
    const r = await orchestrator.cancelTask(t1.id, 150)
    assert.deepEqual(r, { keys: [t1.key], stopped: false }, 'not confirmed')
    assert.equal(said(t1.id, p.id, /Cancel requested/), 1)
    assert.equal(said(t1.id, p.id, /is cancelled: its agent/), 0, 'never "cancelled" before the run ended')
    const reviews = reviewCalls
    finish!()
    await until(() => !isRunning(t1.id), 'the run to end')
    await wait(80)
    const after = get(t1.id)
    assert.equal(after.status, 'todo', 'not moved to review by the late result')
    assert.ok(after.cancelledAt)
    assert.equal(reviewCalls, reviews, 'not reviewed')
    assert.equal(runsOf(t1.id)[0].status, 'succeeded', 'the run itself is recorded as it ended')
    assert.equal(said(t1.id, p.id, /is cancelled: its agent/), 1, 'confirmed when the run ended')
    assert.ok(!held(t1.id))
    settingsRepo.update({ reviewByLead: false })
  })

  await step('a run waiting for approval: turned down, its card says "cancelled", nothing ran', async () => {
    getDb().prepare('UPDATE agent_permissions SET require_approval = 1 WHERE agent_id = ?').run(dev.id)
    const t1 = task('waits for approval')
    idle()
    await call('tasks:start', t1.id)
    await until(() => runsOf(t1.id).some((r) => r.status === 'awaiting_approval'), 'the approval')
    const run = runsOf(t1.id)[0]
    const scope = await call('tasks:cancelScope', t1.id)
    assert.equal(scope.awaitingApproval, true)
    assert.equal(scope.running, false)
    const before = workCalls
    assert.deepEqual(await call('tasks:cancel', t1.id), { keys: [t1.key], stopped: true })
    await until(() => runsRepo.get(run.id)!.status === 'cancelled', 'the run cancelled')
    assert.deepEqual(outcomes(`run:${run.id}:approval`), ['cancelled', 'cancelled'])
    assert.match(runsRepo.get(run.id)!.error ?? '', /cancelled/)
    assert.equal(workCalls, before)
    assert.ok(!held(t1.id))
    assert.deepEqual(await call('needs:act', p.id, `run:${run.id}:approval`, 'approve'), { result: 'gone', outcome: null })
    assert.equal(said(t1.id, p.id, /never ran/i), 1)
    getDb().prepare('UPDATE agent_permissions SET require_approval = 0').run()
  })

  await step('a task in review: a review finishing after the cancel neither approves nor merges it', async () => {
    settingsRepo.update({ reviewByLead: true })
    let verdict!: () => void
    review = () => new Promise((res) => (verdict = () => res('{"approved": true, "note": "fine"}')))
    work = async () => 'report: done'
    const t1 = task('cancelled during review')
    idle()
    await call('tasks:start', t1.id)
    await until(() => get(t1.id).status === 'in_review' && o.reviewing.has(t1.id), 'reviewing')
    await call('tasks:cancel', t1.id)
    assert.equal(get(t1.id).status, 'todo')
    verdict()
    await until(() => !o.reviewing.has(t1.id), 'the review to end')
    await wait(80)
    assert.equal(get(t1.id).status, 'todo', 'not done')
    assert.ok(get(t1.id).cancelledAt)
    assert.ok(!o.reviewing.has(t1.id) && !o.reviewAgain.has(t1.id), 'nothing queued for it')
    review = async () => '{"approved": true, "note": "ok"}'
    settingsRepo.update({ reviewByLead: false })
  })

  await step('a held task (failed) and a review left to the user: their cards end as "cancelled"', async () => {
    work = async () => {
      throw new Error('TypeError: fetch failed')
    }
    const t1 = task('failed then cancelled')
    idle()
    await call('tasks:start', t1.id)
    await until(() => held(t1.id), 'held')
    const heldEvent = (thread(t1.id, p.id).filter((m) => m.meta?.card).at(-1)!.meta!.card as NeedsCard).event
    await call('tasks:cancel', t1.id)
    assert.deepEqual(outcomes(heldEvent), ['cancelled', 'cancelled'])
    assert.ok(!held(t1.id))
    assert.ok(!orchestrator.state().waitEvents.includes(heldEvent))
    assert.deepEqual(await call('needs:act', p.id, heldEvent, 'retry'), { result: 'gone', outcome: null })

    settingsRepo.update({ reviewByLead: true })
    review = async () => {
      throw new Error('The operation was aborted due to timeout')
    }
    work = async () => 'report'
    const t2 = task('undecided then cancelled')
    idle()
    await call('tasks:start', t2.id)
    await until(() => orchestrator.state().undecided.includes(t2.id), 'needs you')
    const ev = (thread(t2.id, p.id).filter((m) => m.meta?.card).at(-1)!.meta!.card as NeedsCard).event
    await call('tasks:cancel', t2.id)
    assert.deepEqual(outcomes(ev), ['cancelled', 'cancelled'])
    assert.ok(!orchestrator.state().undecided.includes(t2.id))
    await assert.rejects(call('tasks:retryReview', t2.id))
    review = async () => '{"approved": true, "note": "ok"}'
    settingsRepo.update({ reviewByLead: false })
  })

  await step('a race: both attempts are cancelled together (shown in the scope); dependents wait and say why', async () => {
    work = untilAbort
    const orig = task('raced original')
    const chal = tasksRepo.create({ title: 'raced original', projectId: p.id, assigneeId: dev2.id, raceOf: orig.id })
    const dep = task('needs the raced work', { dependsOn: [orig.id] })
    const scope = await call('tasks:cancelScope', chal.id)
    assert.deepEqual(scope.keys.sort(), [orig.key, chal.key].sort())
    assert.deepEqual(scope.dependents, [dep.key])
    const r = await call('tasks:cancel', chal.id)
    assert.equal(r.stopped, true)
    assert.ok(get(orig.id).cancelledAt && get(chal.id).cancelledAt)
    assert.ok(!get(dep.id).cancelledAt, 'a dependent is not cancelled')
    assert.match(orchestrator.waitingFor(dep.id).join(), new RegExp(`${orig.key} \\(cancelled\\)`))
    assert.match(thread(orig.id, p.id).at(-1)!.content, new RegExp(`Tasks that depend on it won't start: ${dep.key}\\.`))
    const before = workCalls
    await autopilot()
    assert.equal(workCalls, before, 'nothing started: the dependent waits')
    assert.equal(runsOf(dep.id).length, 0)
  })

  await step('a restart keeps the cancel; a task cancelled while running when the app closed is confirmed then', async () => {
    const t1 = task('cancelled, closed mid-run')
    // As left by a quit: marked cancelled while its run still ran.
    tasksRepo.update(t1.id, { status: 'in_progress', cancelledAt: new Date().toISOString() })
    const t2 = getDb().prepare("SELECT id FROM tasks WHERE title = 'running, then cancelled'").get() as { id: string }
    restart()
    assert.equal(get(t1.id).status, 'todo')
    assert.ok(get(t1.id).cancelledAt)
    assert.ok(!held(t1.id), 'not "interrupted, held"')
    assert.equal(said(t1.id, p.id, /is cancelled: its agent/), 1)
    assert.ok(get(t2.id).cancelledAt, 'still cancelled after a restart')
    const before = workCalls
    await autopilot()
    assert.equal(workCalls, before)
  })

  await step('"Reopen": the cancel is lifted for the task (and its race attempt); nothing starts until the user does', async () => {
    const orig = getDb().prepare("SELECT id FROM tasks WHERE title = 'raced original' AND race_of IS NULL").get() as { id: string }
    const keys = await call('tasks:reopen', orig.id)
    assert.equal(keys.length, 2, 'the race attempt cancelled with it is reopened too')
    assert.ok(!get(orig.id).cancelledAt)
    assert.ok(held(orig.id), 'it waits for the user')
    const before = workCalls
    await autopilot()
    assert.equal(workCalls, before, 'not started on its own')
    work = async () => 'done'
    idle()
    await call('tasks:start', orig.id)
    await until(() => workCalls > before, 'the user started it')
  })

  await step('a done task cannot be cancelled; delete still works for a cancelled one', async () => {
    const t1 = task('already done', { status: 'done' })
    await assert.rejects(call('tasks:cancel', t1.id), /already done/)
    const gone = getDb().prepare("SELECT id FROM tasks WHERE title = 'late result'").get() as { id: string }
    await call('tasks:delete', gone.id)
    assert.equal(tasksRepo.get(gone.id), null)
  })

  console.log(`cancel e2e: ${count} steps ok`)
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e)
    process.exit(1)
  }
)
