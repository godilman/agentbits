// Package 5B: operating-system notifications from the real event sources (approvals, held / undecided tasks, lead
// approval and race results with the merge state, chat replies), with the owner's timing (first urgent at once, more
// grouped for 10 s per project, finishes collected), stale events dropped, nothing while a window has focus or after
// the setting is off, a click that only opens screens, and a failing notification that breaks nothing. Real SQLite,
// git, orchestrator and IPC handlers; the provider and Electron's Notification / window are stubs (tests/e2e/
// electron-stub.cjs) — this proves what Agentbits asks the system to show, not that Windows shows it.
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
import { getAdapter } from '../../src/main/providers'
import { applyLanguageSetting } from '../../src/main/i18n'
import { listApprovals, resolveApproval, waitForApproval } from '../../src/main/connections/service'
import { notifyUser, startNotifications } from '../../src/main/notify'
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
const WINDOW = 10_000

// ── stubs ─────────────────────────────────────────────────────────────────────────────────────────────────────────
let work: (ctx: RunContext) => Promise<string> = async () => 'done'
let review: (ctx: RunContext) => Promise<string> = async () => '{"approved": true, "note": "ok"}'
let chat: (ctx: RunContext) => Promise<string> = async () => 'ok'
getAdapter('mock').run = async (ctx: RunContext) => {
  const text = ctx.mode === 'review' ? await review(ctx) : ctx.mode === 'chat' ? await chat(ctx) : await work(ctx)
  return { text, tokensIn: 1, tokensOut: 1, costUsd: 0 }
}
const gitCfg = join(mkdtempSync(join(tmpdir(), 'ab-git-')), 'gitconfig')
writeFileSync(gitCfg, '[user]\n\tname = Test\n\temail = test@example.com\n[commit]\n\tgpgsign = false\n[init]\n\tdefaultBranch = main\n')
process.env.GIT_CONFIG_GLOBAL = gitCfg
process.env.GIT_CONFIG_NOSYSTEM = '1'
const sh = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

const e2e = (globalThis as any).__e2e as { windows: unknown[]; shown: { options: { title: string; body: string; silent: boolean }; handlers: Record<string, () => void> }[]; supported: boolean; failShow: boolean }
let focused = false
let minimized = false
const flashes: boolean[] = []
const sent: any[] = []
const onFocus: (() => void)[] = []
const win = {
  isDestroyed: () => false,
  isFocused: () => focused,
  isMinimized: () => minimized,
  isVisible: () => true,
  restore: () => undefined,
  show: () => undefined,
  focus: () => {
    focused = true
    for (const f of onFocus) f()
  },
  flashFrame: (on: boolean) => void flashes.push(on),
  on: (event: string, fn: () => void) => void (event === 'focus' && onFocus.push(fn)),
  webContents: { send: (_channel: string, event: unknown) => void sent.push(event) }
}
e2e.windows.push(win)
const shown = () => e2e.shown.map((n) => n.options)
const forProject = (name: string) => shown().filter((n) => n.title.startsWith(name))
/** The last notification object of a project (to click it). */
const noteOf = (name: string) => e2e.shown.filter((n) => n.options.title.startsWith(name)).at(-1)!
const navigations = () => sent.filter((e) => e.type === 'navigate')
const RAW = /boom|secret|stack|\/etc\//i

async function main(): Promise<void> {
  openDb()
  // The paths without recovery (ADR-036 has its own test: reviewRecovery.e2e.ts).
  settingsRepo.update({ onboarded: true, autopilot: false, reviewByLead: false, raceMode: false, language: 'en', autoRecovery: false })
  applyLanguageSetting('en')
  const tpl = await call('templates:instantiate', 'ecommerce')
  const project = (name: string, extra: Record<string, unknown> = {}) => call('projects:save', { name, rootPath: mkdtempSync(join(tmpdir(), 'ab-n-')), unitIds: [tpl.unitId], ...extra })
  const P = {
    approve: await project('Approvals'),
    fail: await project('Failures'),
    done: await project('Finished'),
    race: await project('Race'),
    focus: await project('Focus'),
    off: await project('Off'),
    reply: await project('Replies'),
    dm: await project('Direct'),
    broken: await project('Broken'),
    long: await project('Çok Uzun Adlı E-Ticaret Yeniden Tasarım Projesi 👩‍👩‍👧‍👦 İkinci Faz'),
    nosupport: await project('NoSupport'),
    late: await project('LateFocus'),
    review: await project('Review'),
    raceUnclear: await project('RaceUnclear'),
    mixed: await project('Mixed'),
    taskApproval: await project('TaskApproval'),
    deleted: await project('Deleted'),
    raceFail: await project('RaceFail'),
    stopped: await project('Stopped'),
    minimized: await project('Minimized')
  }
  getDb().prepare('UPDATE agent_permissions SET require_approval = 0').run()
  const lead = projectLead(P.approve.id)!
  const [dev, dev2] = projectMembers(P.approve.id).filter((a) => a.id !== lead.id)
  const task = (pid: string, title: string, extra: Record<string, unknown> = {}, who = dev.id) => tasksRepo.create({ title, projectId: pid, assigneeId: who, ...extra })
  const idle = () => {
    agentsRepo.setStatus(dev.id, 'idle')
    agentsRepo.setStatus(dev2.id, 'idle')
  }
  const askApproval = (pid: string, taskId: string | null, target: string) => {
    void waitForApproval({ agentId: dev.id, projectId: pid, taskId }, { connectionId: 'c', connectionName: target, operation: 'query', detail: 'SELECT 1', needs: 'read' })
    return listApprovals().at(-1)!.id
  }

  await step('startup: an interrupted task and anything before the window exists is not announced', async () => {
    const t = task(P.fail.id, 'was running when the app closed')
    tasksRepo.update(t.id, { status: 'in_progress' })
    orchestrator.init() // marks it interrupted and held
    notifyUser({ kind: 'undecided', taskId: t.id, event: 'early', stillPending: () => true })
    assert.equal(shown().length, 0)
    assert.equal(flashes.length, 0)
    startNotifications(win as any)
  })

  await step('a window in focus: no notification and no taskbar flash', async () => {
    focused = true
    getDb().prepare('UPDATE agent_permissions SET require_approval = 1 WHERE agent_id = ?').run(dev.id)
    const t = task(P.approve.id, 'needs approval while I look')
    idle()
    await call('tasks:start', t.id)
    await until(() => runsRepo.list({ taskId: t.id })[0]?.status === 'awaiting_approval', 'awaiting approval')
    assert.equal(shown().length, 0)
    assert.ok(!flashes.includes(true))
    await call('runs:approve', runsRepo.list({ taskId: t.id })[0].id, false) // rejected by the user: held, not announced
    focused = false
  })

  const tApprove = task(P.approve.id, 'Update the stock table in the orders database')
  await step('an approval while away: shown at once, with the project, key + short title and the step; the taskbar flashes', async () => {
    idle()
    await call('tasks:start', tApprove.id)
    await until(() => forProject('Approvals').length === 1, 'the notification')
    const n = forProject('Approvals')[0]
    assert.equal(n.title, 'Approvals')
    assert.equal(n.body, `Update the stock table in the orders database · ${tApprove.key} is waiting for your approval to start — approve or reject`)
    assert.equal(n.silent, false)
    assert.equal(flashes.at(-1), true)
  })

  await step('a click opens the task (with the run it was about) and approves nothing', async () => {
    const run = runsRepo.list({ taskId: tApprove.id })[0]
    noteOf('Approvals').handlers.click()
    assert.deepEqual(navigations().at(-1).target, { projectId: P.approve.id, view: 'task', taskId: tApprove.id, runId: run.id })
    await wait(100)
    assert.equal(runsRepo.get(run.id)!.status, 'awaiting_approval', 'still waiting for a real yes')
    focused = false // the click focused the window; away again
  })

  await step('a click with no window: nothing is sent; the renderer takes the place once (notify:takePending)', async () => {
    const run = runsRepo.list({ taskId: tApprove.id })[0]
    const before = sent.length
    e2e.windows.length = 0
    noteOf('Approvals').handlers.click()
    e2e.windows.push(win)
    assert.equal(sent.length, before)
    assert.deepEqual(await call('notify:takePending'), { projectId: P.approve.id, view: 'task', taskId: tApprove.id, runId: run.id })
    assert.equal(await call('notify:takePending'), null, 'taken once')
  })

  // Within the window: two more urgent events; one is answered before the group is due.
  const tFail = task(P.fail.id, 'fails twice', {}, dev2.id) // dev still has the run waiting for approval
  let approvalKept = ''
  await step('more within 10 s are collected; answered meanwhile → dropped. A failure says what to do, not the error', async () => {
    // The click brought the user back (what was collected is dropped), so the next one is shown at once again.
    const first = askApproval(P.approve.id, null, 'Orders DB')
    assert.equal(forProject('Approvals').length, 2)
    resolveApproval(first, false)
    approvalKept = askApproval(P.approve.id, null, 'Payments DB')
    const answered = askApproval(P.approve.id, null, 'Billing DB')
    resolveApproval(answered, false)
    assert.equal(forProject('Approvals').length, 2, 'held for the group')
    work = async () => {
      throw new Error('boom: secret token in /etc/passwd at stack frame 3')
    }
    getDb().prepare('UPDATE agent_permissions SET require_approval = 0').run()
    idle()
    await call('tasks:start', tFail.id)
    await until(() => forProject('Failures').length === 1, 'the failure')
    const f = forProject('Failures')[0]
    assert.match(f.body, new RegExp(`^fails twice · ${tFail.key} stopped with an error — decide what to do$`))
    assert.doesNotMatch(f.body, RAW)
  })

  await step('after the window: the group shows only what still waits; the retried task failing again is a new notification', async () => {
    await wait(WINDOW + 300)
    const groups = forProject('Approvals')
    assert.equal(groups.length, 3)
    assert.match(groups[2].body, /Payments DB/)
    assert.doesNotMatch(groups[2].body, /Billing DB/, 'the answered one is not announced')
    resolveApproval(approvalKept, false)
    agentsRepo.setStatus(dev2.id, 'idle')
    await call('tasks:start', tFail.id)
    await until(() => forProject('Failures').length === 2, 'the second failure (a new run)')
    assert.doesNotMatch(forProject('Failures')[1].body, RAW)
  })

  await step('finished tasks are collected; one deleted meanwhile is dropped; the text says done with the lead', async () => {
    work = async () => 'done'
    await call('runs:approve', runsRepo.list({ taskId: tApprove.id })[0].id, false) // frees dev (rejected: not announced)
    const flashesBefore = flashes.length
    settingsRepo.update({ reviewByLead: true })
    const a = task(P.done.id, 'first to finish')
    const b = task(P.done.id, 'second to finish', {}, dev2.id)
    const c = task(P.done.id, 'deleted before the group')
    for (const t of [a, b, c]) {
      idle()
      await call('tasks:start', t.id)
      await until(() => tasksRepo.get(t.id)!.status === 'done', `${t.key} done`)
    }
    assert.equal(forProject('Finished').length, 0, 'collected, not shown one by one')
    await call('tasks:delete', c.id)
    await wait(WINDOW + 300)
    const g = forProject('Finished')
    assert.equal(g.length, 1)
    assert.equal(g[0].title, 'Finished — 2 tasks approved by the lead')
    assert.equal(g[0].body, `first to finish · ${a.key} is done (approved by the lead)\nsecond to finish · ${b.key} is done (approved by the lead)`)
    assert.equal(g[0].silent, true)
    assert.ok(!flashes.slice(flashesBefore).includes(true), 'finished work does not flash the taskbar')
    noteOf('Finished').handlers.click()
    assert.deepEqual(navigations().at(-1).target, { projectId: P.done.id, view: 'tasks' }, 'a group opens the board')
    focused = false
  })

  await step('a race: one notification for the winner (naming the closed attempt); none for the loser', async () => {
    settingsRepo.update({ reviewByLead: false })
    const a = task(P.race.id, 'race A')
    const b = task(P.race.id, 'race B', { raceOf: a.id }, dev2.id)
    idle()
    await call('tasks:start', a.id)
    await call('tasks:start', b.id)
    await until(() => tasksRepo.get(a.id)!.status === 'in_review' && tasksRepo.get(b.id)!.status === 'in_review', 'both in review')
    review = async (ctx) => (ctx.prompt.includes('## Attempt B') ? '{"winner": "A", "note": "cleaner"}' : '{"approved": true, "note": "ok"}')
    settingsRepo.update({ reviewByLead: true })
    o.queueReview(b.id)
    await until(() => tasksRepo.get(a.id)!.status === 'done' && tasksRepo.get(b.id)!.status === 'done', 'decided', 10_000)
    await wait(WINDOW + 300)
    const r = forProject('Race')
    assert.equal(r.length, 1)
    assert.equal(r[0].body, `race A · ${a.key} won the race (${b.key} closed)`)
    review = async () => '{"approved": true, "note": "ok"}'
  })

  await step('the lead approved a worktree task: merged / the merge waits are told apart', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'ab-wt-'))
    sh(repo, 'init', '-q')
    writeFileSync(join(repo, 'a.txt'), 'one\n')
    sh(repo, 'add', '.')
    sh(repo, 'commit', '-qm', 'init')
    const wp = await call('projects:save', { name: 'Worktree', rootPath: repo, unitIds: [tpl.unitId], isolation: 'worktree' })
    const merged = task(wp.id, 'merges cleanly')
    const copy1 = await o.prepareWorktree(wp, merged, { runId: 'r1', agentId: dev.id, taskId: merged.id, projectId: wp.id })
    writeFileSync(join(copy1.dir, 'b.txt'), 'from the agent\n')
    tasksRepo.update(merged.id, { status: 'done' })
    await o.finishAndNotify(merged.id, 'review:m')
    const waits = task(wp.id, 'merge has to wait')
    const copy2 = await o.prepareWorktree(wp, waits, { runId: 'r2', agentId: dev.id, taskId: waits.id, projectId: wp.id })
    writeFileSync(join(copy2.dir, 'c.txt'), 'from the agent\n')
    writeFileSync(join(repo, 'a.txt'), 'edited by hand, not committed\n') // a dirty project folder: the merge waits
    tasksRepo.update(waits.id, { status: 'done' })
    await o.finishAndNotify(waits.id, 'review:w')
    sh(repo, 'checkout', '--', 'a.txt') // clean again
    const unchanged = task(wp.id, 'changed nothing')
    await o.prepareWorktree(wp, unchanged, { runId: 'r3', agentId: dev.id, taskId: unchanged.id, projectId: wp.id })
    tasksRepo.update(unchanged.id, { status: 'done' })
    await o.finishAndNotify(unchanged.id, 'review:u')
    await wait(WINDOW + 300)
    // One group, or two when slow git work (Windows CI) spans the 10 s window: grouping is tested above; this step is
    // about what each line says.
    const g = forProject('Worktree')
    assert.ok(g.length >= 1 && g.length <= 2, String(g.length))
    assert.deepEqual(g.flatMap((n) => n.body.split('\n')), [
      `merges cleanly · ${merged.key} is done (approved by the lead) and merged into the project`,
      `merge has to wait · ${waits.key} was approved by the lead; the merge is waiting — review the changes and merge`,
      `changed nothing · ${unchanged.key} is done (approved by the lead)`
    ])
  })

  await step('back in the app: what was collected is dropped (not shown later) and the flash stops', async () => {
    askApproval(P.focus.id, null, 'First')
    askApproval(P.focus.id, null, 'Second (collected)')
    assert.equal(forProject('Focus').length, 1)
    win.focus()
    assert.equal(flashes.at(-1), false)
    focused = false
    await wait(WINDOW + 300)
    assert.equal(forProject('Focus').length, 1, 'the collected one is not shown afterwards')
  })

  await step('notifications turned off: collected ones dropped, flash stopped, nothing new; on again works', async () => {
    askApproval(P.off.id, null, 'Shown')
    askApproval(P.off.id, null, 'Collected')
    await call('settings:update', { notifications: false })
    assert.equal(flashes.at(-1), false)
    askApproval(P.off.id, null, 'While off')
    await wait(WINDOW + 300)
    assert.equal(forProject('Off').length, 1)
    await call('settings:update', { notifications: true })
    askApproval(P.off.id, null, 'On again')
    assert.equal(forProject('Off').length, 2)
    for (const a of listApprovals()) resolveApproval(a.id, false)
  })

  await step('chat replies: a real reply is announced (lead and direct message); hidden blocks only / an error are not', async () => {
    chat = async () => 'Here is the plan: first the stock table, then the report.'
    const flashesAtReply = flashes.length
    await call('messages:send', 'general', 'what is next?', P.reply.id)
    await until(() => forProject('Replies').length === 1, 'the reply')
    const r = forProject('Replies')[0]
    assert.equal(r.body, `${projectLead(P.reply.id)!.name} replied — see the chat`)
    assert.doesNotMatch(r.body, /stock table/, 'no chat content')
    assert.ok(!flashes.slice(flashesAtReply).includes(true), 'a reply does not flash the taskbar')
    noteOf('Replies').handlers.click()
    assert.deepEqual(navigations().at(-1).target, { projectId: P.reply.id, view: 'chat', channel: 'general' })
    focused = false
    await wait(WINDOW + 300)
    const general = () => messagesRepo.list('general', 200, P.reply.id)
    const agentLines = () => general().filter((m) => m.senderType === 'agent').length
    const before = agentLines()
    chat = async () => '```learn\n[]\n```'
    await call('messages:send', 'general', 'remember nothing', P.reply.id)
    await until(() => agentLines() === before + 1, 'the hidden-blocks-only reply stored')
    const systemBefore = general().filter((m) => m.senderType === 'system').length
    chat = async () => {
      throw new Error('fetch failed')
    }
    await call('messages:send', 'general', 'and again', P.reply.id)
    await until(() => general().filter((m) => m.senderType === 'system').length > systemBefore, 'the failed reply noted')
    await wait(200)
    assert.equal(forProject('Replies').length, 1, 'neither the empty nor the failed reply')
    chat = async () => 'Done, I added it.'
    const member = projectMembers(P.dm.id).find((a) => a.id !== projectLead(P.dm.id)!.id)!
    agentsRepo.setStatus(member.id, 'idle')
    await call('messages:send', `agent:${member.id}`, 'please add a note', P.dm.id)
    await until(() => forProject('Direct').length === 1, 'the direct reply')
    assert.equal(forProject('Direct')[0].body, `${member.name} replied — see the chat`)
  })

  await step('several sources in one 10 s window: no OS support, a retried review, an unclear race, a mixed group, a task approval, a deleted project', async () => {
    // a) Windows may not show notifications at all: the taskbar still flashes for an approval.
    e2e.supported = false
    askApproval(P.nosupport.id, null, 'Unsupported')
    assert.equal(flashes.at(-1), true)
    e2e.supported = true
    // c) a real review the lead can't decide → "your call"; retried and unclear again → a new event (a new review).
    review = async () => 'I am not sure.'
    const r = task(P.review.id, 'review twice')
    idle()
    await call('tasks:start', r.id)
    await until(() => forProject('Review').length === 1, 'the undecided review')
    assert.equal(forProject('Review')[0].body, `review twice · ${r.key}: waiting for your decision — see the task page`)
    await call('tasks:retryReview', r.id)
    await until(() => !o.reviewing.has(r.id) && orchestrator.state().undecided.includes(r.id), 'the retried review decided (unclear again)')
    // d) a race the lead can't decide: one event for both attempts.
    settingsRepo.update({ reviewByLead: false })
    const a = task(P.raceUnclear.id, 'unclear A')
    const b = task(P.raceUnclear.id, 'unclear B', { raceOf: a.id }, dev2.id)
    idle()
    await call('tasks:start', a.id)
    await call('tasks:start', b.id)
    await until(() => tasksRepo.get(a.id)!.status === 'in_review' && tasksRepo.get(b.id)!.status === 'in_review', 'both in review')
    review = async (ctx) => (ctx.prompt.includes('## Attempt B') ? 'Both look fine to me.' : 'I am not sure.')
    settingsRepo.update({ reviewByLead: true })
    o.queueReview(b.id)
    await until(() => forProject('RaceUnclear').length === 1, 'the race waits for the user')
    // d2) the lead's comparison fails: one event for both attempts too.
    const fa = task(P.raceFail.id, 'failing A')
    const fb = task(P.raceFail.id, 'failing B', { raceOf: fa.id }, dev2.id)
    settingsRepo.update({ reviewByLead: false })
    review = async () => 'I am not sure.'
    idle()
    await call('tasks:start', fa.id)
    await call('tasks:start', fb.id)
    await until(() => tasksRepo.get(fa.id)!.status === 'in_review' && tasksRepo.get(fb.id)!.status === 'in_review', 'both in review')
    review = async (ctx) => {
      if (ctx.prompt.includes('## Attempt B')) throw new Error('fetch failed')
      return 'I am not sure.'
    }
    settingsRepo.update({ reviewByLead: true })
    o.queueReview(fb.id)
    await until(() => forProject('RaceFail').length === 1, 'the failed comparison waits for the user')
    // e) a group mixing kinds says what the numbers are; more than three → "+N more".
    const m1 = task(P.mixed.id, 'mixed one')
    const m2 = task(P.mixed.id, 'mixed two')
    askApproval(P.mixed.id, null, 'Mixed first') // shown at once
    askApproval(P.mixed.id, null, 'Mixed DB 1')
    askApproval(P.mixed.id, null, 'Mixed DB 2')
    notifyUser({ kind: 'undecided', taskId: m1.id, event: 'mixed-1', stillPending: () => true })
    notifyUser({ kind: 'held', taskId: m2.id, why: 'limit', event: 'mixed-2', stillPending: () => true })
    // f) a connection approval for a task: the task says who; the click goes to the task with that approval.
    const ta = task(P.taskApproval.id, 'reads the orders database')
    const apId = askApproval(P.taskApproval.id, ta.id, 'Orders DB')
    assert.equal(forProject('TaskApproval')[0].body, `reads the orders database · ${ta.key}: waiting for your approval for Orders DB — approve or reject`)
    const taskApprovalNote = noteOf('TaskApproval') // clicked after the window (a click brings the user back: it clears the rest)
    // g) a project deleted before its group is due: nothing for it.
    askApproval(P.deleted.id, null, 'Deleted first')
    askApproval(P.deleted.id, null, 'Deleted collected')
    await call('projects:delete', P.deleted.id)

    await wait(WINDOW + 300)
    assert.equal(forProject('NoSupport').length, 0, 'a) nothing constructed when unsupported')
    assert.equal(forProject('Review').length, 2, 'c) the retried review is a new event')
    assert.match(forProject('Review')[1].body, /waiting for your decision/)
    assert.equal(forProject('RaceUnclear').length, 1, 'd) one notification for the race')
    assert.equal(forProject('RaceFail').length, 1, 'd2) one notification for the failed comparison')
    const mixed = forProject('Mixed')
    assert.equal(mixed.length, 2)
    assert.equal(mixed[1].title, 'Mixed — 4 things are waiting for you')
    const lines = mixed[1].body.split('\n')
    assert.equal(lines.length, 5)
    assert.equal(lines[0], '2 approvals · 2 decisions for you')
    assert.equal(lines[1], `${dev.name} is waiting for your approval for Mixed DB 1 — approve or reject`)
    assert.equal(lines[2], `${dev.name} is waiting for your approval for Mixed DB 2 — approve or reject`)
    assert.equal(lines[3], `mixed one · ${m1.key}: waiting for your decision — see the task page`)
    assert.equal(lines[4], '+1 more')
    assert.equal(forProject('Deleted').length, 1, 'g) the collected one for a deleted project is not shown')
    // d3) the same race compared again (retried): a new event, not silenced by the first.
    review = async (ctx) => (ctx.prompt.includes('## Attempt B') ? 'Still not sure.' : 'I am not sure.')
    await call('tasks:retryReview', a.id)
    await until(() => forProject('RaceUnclear').length === 2, 'the retried comparison')
    taskApprovalNote.handlers.click()
    assert.deepEqual(navigations().at(-1).target, { projectId: P.taskApproval.id, view: 'task', taskId: ta.id, approvalId: apId }, 'f) the click opens the task')
    focused = false
    for (const x of listApprovals()) resolveApproval(x.id, false)
  })

  await step('a window got focus without a focus event reaching us: the group due meanwhile is not shown', async () => {
    askApproval(P.late.id, null, 'Late one')
    askApproval(P.late.id, null, 'Late two (collected)')
    focused = true
    await wait(WINDOW + 300)
    assert.equal(forProject('LateFocus').length, 1)
    focused = false
    for (const x of listApprovals()) resolveApproval(x.id, false)
  })

  await step("a run limit firing after the user's stop is not a limit: held as stopped, nothing announced", async () => {
    review = async () => '{"approved": true, "note": "ok"}'
    work = (ctx) => new Promise((_, reject) => ctx.signal.addEventListener('abort', () => reject(new Error('aborted'))))
    const st = task(P.stopped.id, 'stopped by me')
    idle()
    await call('tasks:start', st.id)
    await until(() => [...o.active.values()].some((x: any) => x.taskId === st.id), 'running')
    const ar = [...o.active.values()].find((x: any) => x.taskId === st.id)
    await call('runs:stop', ar.runId)
    o.limitStop(ar, 'token limit reached') // a late usage report after the stop
    await until(() => orchestrator.state().held.some((h) => h.taskId === st.id), 'held')
    assert.doesNotMatch(orchestrator.state().held.find((h) => h.taskId === st.id)!.reason, /token limit/)
    await wait(300)
    assert.equal(forProject('Stopped').length, 0, 'the user stopped it: not announced')
    work = async () => 'done'
  })

  await step('minimized but still the active window (Windows): the user is away → shown and flashing', async () => {
    focused = true
    minimized = true
    askApproval(P.minimized.id, null, 'While minimized')
    assert.equal(forProject('Minimized').length, 1)
    assert.equal(flashes.at(-1), true)
    minimized = false
    focused = false
    for (const x of listApprovals()) resolveApproval(x.id, false)
  })

  await step('the system refusing a notification breaks nothing (the approval still waits, the flow goes on)', async () => {
    e2e.failShow = true
    const id = askApproval(P.broken.id, null, 'Refused')
    assert.ok(listApprovals().some((a) => a.id === id), 'the approval is there')
    resolveApproval(id, false)
    e2e.failShow = false
  })

  await step('a long project name and title are shortened on whole characters (an emoji at the cut stays whole)', async () => {
    const family = '👩‍👩‍👧‍👦'
    const t = task(P.long.id, 'Ö'.repeat(48) + family + ' and more text after the cut')
    notifyUser({ kind: 'undecided', taskId: t.id, event: 'long', stillPending: () => true })
    const n = forProject('Çok Uzun')[0]
    assert.equal(n.title, 'Çok Uzun Adlı E-Ticaret Yeniden Tasarım…')
    assert.equal(n.body, `${'Ö'.repeat(48)}${family}… · ${t.key}: waiting for your decision — see the task page`)
    assert.ok((n.title + n.body).isWellFormed(), 'no broken surrogate pair')
  })

  console.log(`notify e2e: ${count} steps ok`)
  orchestrator.shutdown()
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
