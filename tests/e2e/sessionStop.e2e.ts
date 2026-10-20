// Package 1B: opening a project starts nothing (the user starts work per project and session; held tasks stay held;
// a new start waits again); a stop says nothing was undone and where the changes are; a task moved to Done by hand
// counts as done by the user (not the lead), is never merged on its own and its dependents wait for the merge; the
// close dialog's counts. Real SQLite, real git, real orchestrator and IPC handlers; the provider is a stub.
// Run: npm run test:e2e
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDb, openDb } from '../../src/main/db'
import { agentsRepo, messagesRepo, runsRepo, settingsRepo, tasksRepo } from '../../src/main/db/repos'
import { handlers } from '../../src/main/ipc'
import { orchestrator } from '../../src/main/core/orchestrator'
import { projectLead, projectMembers } from '../../src/main/core/org'
import { quitWarning } from '../../src/main/core/quitGuard'
import { getAdapter } from '../../src/main/providers'
import { applyLanguageSetting } from '../../src/main/i18n'
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
  orchestrator.init()
}

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

async function main(): Promise<void> {
  openDb()
  const tpl = await call('templates:instantiate', 'core')
  const p1 = await call('projects:save', { name: 'P1', rootPath: mkdtempSync(join(tmpdir(), 'ab-s1-')), unitIds: [tpl.unitId] })
  settingsRepo.update({ onboarded: true, autopilot: true, reviewByLead: false, raceMode: false, language: 'en' })
  getDb().prepare('UPDATE agent_permissions SET require_approval = 0').run()
  applyLanguageSetting('en')
  orchestrator.init()
  const lead = projectLead(p1.id)!
  const dev = projectMembers(p1.id).filter((a) => a.id !== lead.id)[0]
  const task = (title: string, extra: Record<string, unknown> = {}, pid = p1.id) => tasksRepo.create({ title, projectId: pid, assigneeId: dev.id, ...extra })
  const runsOf = (id: string) => runsRepo.list({ taskId: id })
  const idle = () => agentsRepo.setStatus(dev.id, 'idle')
  const ticks = async (n = 4) => {
    for (let i = 0; i < n; i++) {
      idle()
      o.tick()
      await wait(30)
    }
  }
  const thread = (id: string) => messagesRepo.list(`task:${id}`, 100)

  await step('opening the app / a project starts nothing: a waiting task is not taken until work is started', async () => {
    const t1 = task('waits for the start')
    await ticks()
    assert.equal(runsOf(t1.id).length, 0)
    assert.deepEqual(orchestrator.state().startedProjects, [])
    await call('projects:startWork', p1.id)
    await until(() => runsOf(t1.id).length === 1, 'the run after the start')
    assert.deepEqual(orchestrator.state().startedProjects, [p1.id])
    await until(() => tasksRepo.get(t1.id)!.status !== 'in_progress', 'end')
  })

  await step('starting work does not release held tasks', async () => {
    restart() // a fresh session: this start is the first one
    const tH = task('held before the start')
    o.hold(tH.id, 'Failed: x')
    await call('projects:startWork', p1.id)
    await ticks()
    assert.equal(runsOf(tH.id).length, 0, 'held stays held')
    assert.ok(orchestrator.state().held.some((h) => h.taskId === tH.id))
  })

  await step('a new app start waits for the user again', async () => {
    restart()
    const t2 = task('after a restart')
    await ticks()
    assert.equal(runsOf(t2.id).length, 0)
    assert.deepEqual(orchestrator.state().startedProjects, [])
    await call('projects:startWork', p1.id)
    await until(() => runsOf(t2.id).length === 1, 'run after the new start')
    await until(() => tasksRepo.get(t2.id)!.status !== 'in_progress', 'end')
  })

  await step('a project whose work is not started: tasks from the lead say how to start them', async () => {
    const p2 = await call('projects:save', { name: 'P2', rootPath: mkdtempSync(join(tmpdir(), 'ab-s2-')), unitIds: [tpl.unitId] })
    chat = async () => 'On it.\n```tasks\n[{"title": "fix the cart", "assignee": "' + dev.name + '"}]\n```'
    await call('messages:send', 'general', 'Fix the cart total please, it is wrong', p2.id)
    await until(() => messagesRepo.list('general', 20, p2.id).some((m) => /won't start yet/.test(m.content)), 'the note')
    const t3 = tasksRepo.listAll().find((x) => x.projectId === p2.id && x.title === 'fix the cart')!
    await ticks()
    assert.equal(runsOf(t3.id).length, 0, 'not started in P2 (only P1 is)')
  })

  await step('a stop says nothing was undone and where the changes are (once)', async () => {
    const tS = task('stopped')
    work = (ctx) => new Promise((_, reject) => ctx.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
    idle()
    await call('tasks:start', tS.id)
    await until(() => runsOf(tS.id).some((r) => r.status === 'running'), 'running')
    await orchestrator.stopTaskAndWait(tS.id)
    const notes = thread(tS.id).filter((m) => /Nothing was undone/.test(m.content))
    assert.equal(notes.length, 1)
    assert.match(notes[0].content, /in the project folder/)
    assert.equal(runsOf(tS.id)[0].status, 'cancelled', 'the run history is kept')
  })

  await step('a running task moved to Done by hand: run stopped, done by the user (not the lead), not held', async () => {
    const tR = task('moved to done while running')
    work = (ctx) => new Promise((_, reject) => ctx.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
    idle()
    await call('tasks:start', tR.id)
    await until(() => runsOf(tR.id).some((r) => r.status === 'running'), 'running')
    await call('tasks:move', tR.id, 'done')
    const t = tasksRepo.get(tR.id)!
    assert.equal(t.status, 'done')
    assert.equal(t.completedBy, 'user')
    assert.equal(runsOf(tR.id)[0].status, 'cancelled')
    assert.ok(!orchestrator.state().held.some((h) => h.taskId === tR.id), 'a done task is not on hold')
    assert.equal(thread(tR.id).filter((m) => /You marked it done, without the lead's review/.test(m.content)).length, 1)
    assert.ok(!thread(tR.id).some((m) => /Look at it before you start the task again/.test(m.content)), 'no "start again" note for a done task')
    // Back to To do and Done again by the lead: who did it follows.
    await call('tasks:move', tR.id, 'todo')
    assert.equal(tasksRepo.get(tR.id)!.completedBy, null)
  })

  await step('approved by the lead → done by the lead', async () => {
    settingsRepo.update({ reviewByLead: true })
    const tL = task('approved')
    work = async () => 'report'
    idle()
    await call('tasks:start', tL.id)
    await until(() => tasksRepo.get(tL.id)!.status === 'done', 'approved')
    assert.equal(tasksRepo.get(tL.id)!.completedBy, 'lead')
    settingsRepo.update({ reviewByLead: false })
  })

  await step('worktree: Done by hand merges nothing; the changes stay in the copy; dependents wait; merge brings them in', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'ab-wt-'))
    sh(repo, 'init', '-q')
    writeFileSync(join(repo, 'a.txt'), 'one\n')
    sh(repo, 'add', '.')
    sh(repo, 'commit', '-qm', 'init')
    const wp = await call('projects:save', { name: 'W', rootPath: repo, unitIds: [tpl.unitId], isolation: 'worktree' })
    const wt = task('worktree change', {}, wp.id)
    const dep = task('needs the change', { dependsOn: [wt.id] }, wp.id)
    const copy = await o.prepareWorktree(wp, wt, { runId: 'r', agentId: dev.id, taskId: wt.id, projectId: wp.id })
    writeFileSync(join(copy.dir, 'b.txt'), 'from the agent\n')
    tasksRepo.update(wt.id, { status: 'in_review' })
    await call('tasks:move', wt.id, 'done')
    assert.equal(tasksRepo.get(wt.id)!.completedBy, 'user')
    await wait(150)
    assert.ok(!existsSync(join(repo, 'b.txt')), 'nothing merged into the project')
    assert.ok(existsSync(copy.dir), 'the copy is kept')
    assert.equal(await call('tasks:mergePending', wt.id), true)
    assert.ok(orchestrator.state().unmerged.includes(wt.id), '"Needs you" lists it as waiting to be merged')
    assert.match(thread(wt.id).find((m) => /You marked it done/.test(m.content))!.content, /working copy \(branch /)
    assert.deepEqual(await call('tasks:waitingFor', dep.id), [wt.key], 'the dependent waits for the merge')
    // "Review changes and merge": looking merges nothing; the merge is a separate yes bound to what was shown.
    const shown = (await call('tasks:changes', wt.id)) as any
    assert.deepEqual(shown.files.map((f: any) => f.path), ['b.txt'], 'the uncommitted new file is shown')
    assert.ok(shown.basis)
    assert.ok(!existsSync(join(repo, 'b.txt')), 'looking merged nothing')
    await assert.rejects(call('tasks:merge', wt.id, ''), /changed after you looked/, 'no basis → nothing merged')
    writeFileSync(join(copy.dir, 'c.txt'), 'written after the look\n')
    await assert.rejects(call('tasks:merge', wt.id, shown.basis), /changed after you looked/)
    assert.ok(!existsSync(join(repo, 'b.txt')) && !existsSync(join(repo, 'c.txt')), 'a stale look merges nothing')
    assert.equal(await call('tasks:mergePending', wt.id), true, 'the changes are kept')
    const again = (await call('tasks:changes', wt.id)) as any
    assert.deepEqual(again.files.map((f: any) => f.path).sort(), ['b.txt', 'c.txt'])
    assert.equal(await call('tasks:merge', wt.id, again.basis), false, 'merged')
    assert.ok(existsSync(join(repo, 'b.txt')) && existsSync(join(repo, 'c.txt')))
    assert.deepEqual(await call('tasks:waitingFor', dep.id), [])
  })

  await step('a merge that fails says why and keeps the changes', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'ab-wt-'))
    sh(repo, 'init', '-q')
    writeFileSync(join(repo, 'a.txt'), 'one\n')
    sh(repo, 'add', '.')
    sh(repo, 'commit', '-qm', 'init')
    const wp = await call('projects:save', { name: 'W3', rootPath: repo, unitIds: [tpl.unitId], isolation: 'worktree' })
    const wt = task('dirty root', {}, wp.id)
    const copy = await o.prepareWorktree(wp, wt, { runId: 'r3', agentId: dev.id, taskId: wt.id, projectId: wp.id })
    writeFileSync(join(copy.dir, 'a.txt'), 'from the agent\n')
    tasksRepo.update(wt.id, { status: 'done', completedBy: 'user' })
    writeFileSync(join(repo, 'a.txt'), 'the user edits the project too\n') // uncommitted in the project folder
    const shown = (await call('tasks:changes', wt.id)) as any
    await assert.rejects(call('tasks:merge', wt.id, shown.basis), /uncommitted changes/)
    assert.equal(await call('tasks:mergePending', wt.id), true)
  })

  await step('reviews left from the last session wait for the start too (a yes would finish and merge)', async () => {
    settingsRepo.update({ reviewByLead: true })
    const repo = mkdtempSync(join(tmpdir(), 'ab-wt-'))
    sh(repo, 'init', '-q')
    writeFileSync(join(repo, 'a.txt'), 'one\n')
    sh(repo, 'add', '.')
    sh(repo, 'commit', '-qm', 'init')
    const wp = await call('projects:save', { name: 'W2', rootPath: repo, unitIds: [tpl.unitId], isolation: 'worktree' })
    const other = await call('projects:save', { name: 'P4', rootPath: mkdtempSync(join(tmpdir(), 'ab-s4-')), unitIds: [tpl.unitId] })
    const inReview = (title: string, pid: string) => {
      const x = task(title, {}, pid)
      const run = runsRepo.create(x.id, dev.id, 'succeeded', pid)
      runsRepo.update(run.id, { output: 'report', endedAt: new Date().toISOString() })
      tasksRepo.update(x.id, { status: 'in_review', progress: 100 })
      return x
    }
    const rv = inReview('ready in its copy', wp.id)
    const copy = await o.prepareWorktree(wp, rv, { runId: 'r2', agentId: dev.id, taskId: rv.id, projectId: wp.id })
    writeFileSync(join(copy.dir, 'r.txt'), 'reviewed change\n')
    const ro = inReview('other project review', other.id)
    const rh = inReview('held in review', wp.id)
    o.hold(rh.id, 'Failed: x')
    const reviewed: string[] = []
    review = async (ctx) => {
      reviewed.push(ctx.prompt)
      return '{"approved": true, "note": "ok"}'
    }
    restart() // a new session
    await ticks()
    await wait(200)
    assert.equal(reviewed.length, 0, 'no model call before the start')
    assert.equal(tasksRepo.get(rv.id)!.status, 'in_review')
    assert.ok(!existsSync(join(repo, 'r.txt')), 'nothing merged')
    for (const x of [rv, ro, rh]) assert.ok(orchestrator.state().deferredReviews.includes(x.id), 'the banner can count them')
    await call('projects:startWork', wp.id)
    await until(() => tasksRepo.get(rv.id)!.status === 'done', 'the review after the start')
    assert.equal(tasksRepo.get(rv.id)!.completedBy, 'lead')
    await until(() => existsSync(join(repo, 'r.txt')), 'the approved copy merged')
    await wait(200)
    assert.equal(tasksRepo.get(ro.id)!.status, 'in_review', "the other project's review still waits")
    assert.ok(!reviewed.some((p) => p.includes(ro.key)))
    assert.ok(orchestrator.state().deferredReviews.includes(ro.id))
    assert.ok(!orchestrator.state().deferredReviews.includes(rv.id))
    assert.ok(orchestrator.state().held.some((h) => h.taskId === rh.id), 'held stays held')
    assert.equal(tasksRepo.get(rh.id)!.status, 'in_review', 'a held task is not reviewed by the start')
    assert.ok(!reviewed.some((p) => p.includes(rh.key)))
    settingsRepo.update({ reviewByLead: false })
  })

  await step('a run that cannot be confirmed stopped is not moved to Done; the user is told', async () => {
    const tN = task('will not stop')
    work = (ctx) => new Promise((_, reject) => ctx.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
    idle()
    await call('tasks:start', tN.id)
    await until(() => runsOf(tN.id).some((r) => r.status === 'running'), 'running')
    const real = orchestrator.stopTaskAndWait.bind(orchestrator)
    o.stopTaskAndWait = async () => false
    try {
      await assert.rejects(call('tasks:move', tN.id, 'done'), /could not be confirmed as stopped/)
    } finally {
      o.stopTaskAndWait = real
    }
    const t = tasksRepo.get(tN.id)!
    assert.notEqual(t.status, 'done')
    assert.equal(t.completedBy, null)
    assert.ok(!thread(tN.id).some((m) => /You marked it done/.test(m.content)), 'no done note')
    await orchestrator.stopTaskAndWait(tN.id, 2000)
  })

  await step('the close dialog: counts what would be cut off; nothing to cut off → no dialog', async () => {
    assert.equal(quitWarning({ runs: 0, replies: 0, approvals: 0 }), null)
    const w = quitWarning({ runs: 2, replies: 1, approvals: 1 })!
    assert.match(w.detail, /2 task runs stop halfway/)
    assert.match(w.detail, /1 chat reply or review is cut off/)
    assert.match(w.detail, /1 approval request is turned down/)
    assert.match(w.detail, /Nothing that was already done is undone/)
    assert.equal(w.keep, 'Keep working')
    // What the orchestrator reports while a run works and another waits for approval.
    const tA = task('working at quit')
    const tB = task('waiting at quit')
    const dev2 = projectMembers(p1.id).filter((a) => a.id !== lead.id && a.id !== dev.id)[0]
    tasksRepo.update(tB.id, { assigneeId: dev2.id })
    getDb().prepare('UPDATE agent_permissions SET require_approval = 1 WHERE agent_id = ?').run(dev2.id)
    work = (ctx) => new Promise((_, reject) => ctx.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
    idle()
    agentsRepo.setStatus(dev2.id, 'idle')
    await call('tasks:start', tA.id)
    void call('tasks:start', tB.id)
    await until(() => runsOf(tA.id).some((r) => r.status === 'running') && runsOf(tB.id).some((r) => r.status === 'awaiting_approval'), 'both')
    const s = orchestrator.workSummary()
    assert.equal(s.runs, 1)
    assert.equal(s.approvals, 1)
    await orchestrator.stopTaskAndWait(tA.id)
    orchestrator.approve(runsOf(tB.id)[0].id, false)
  })

  orchestrator.shutdown()
  console.log(`sessionStop e2e: ${count} steps ok`)
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e)
    process.exit(1)
  }
)
