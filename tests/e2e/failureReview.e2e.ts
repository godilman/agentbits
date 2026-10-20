// Package 1A: a failed task is held at once and never re-run on its own (not after the cooldown, not on restart); a
// retry tells the agent about the earlier attempt; a review that can't decide (provider error, no lead, no report,
// unclear verdict, race) waits visibly for the user; "retry the review" re-runs only the lead's review, once.
// Real SQLite, real orchestrator and IPC handlers; the provider is a stub. Run: npm run test:e2e
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDb, openDb } from '../../src/main/db'
import { agentsRepo, messagesRepo, runsRepo, settingsRepo, tasksRepo } from '../../src/main/db/repos'
import { handlers } from '../../src/main/ipc'
import { orchestrator } from '../../src/main/core/orchestrator'
import { projectLead, projectMembers } from '../../src/main/core/org'
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
// Like ipcMain.handle: a handler that throws becomes a rejected promise.
const call = <T = any>(name: string, ...args: unknown[]): Promise<T> => Promise.resolve().then(() => (handlers as any)[name](...args))
const o = orchestrator as any
/** A new app start: shutdown() marks the process closing for good (a real start is a new process). */
const restart = (): void => {
  orchestrator.shutdown()
  o.closing = false
  orchestrator.init()
}

// The worker (mode task) and the lead (mode review) are scripted per step.
let sideEffects = 0 // what a tool would have done in the outside world
const taskPrompts: string[] = []
let work: (ctx: RunContext) => Promise<string> = async () => 'done'
let reviewCalls = 0
let review: (ctx: RunContext) => Promise<string> = async () => '{"approved": true, "note": "ok"}'
getAdapter('mock').run = async (ctx: RunContext) => {
  if (ctx.mode === 'review') {
    reviewCalls++
    return { text: await review(ctx), tokensIn: 1, tokensOut: 1, costUsd: 0 }
  }
  taskPrompts.push(ctx.prompt)
  return { text: await work(ctx), tokensIn: 1, tokensOut: 1, costUsd: 0 }
}

const thread = (taskId: string, pid: string) => messagesRepo.list(`task:${taskId}`, 200, pid)
const held = (taskId: string) => (orchestrator.state().held.find((h) => h.taskId === taskId)?.reason ?? null)
const runsOf = (taskId: string) => runsRepo.list({ taskId })

async function main(): Promise<void> {
  openDb()
  const tpl = await call('templates:instantiate', 'ecommerce')
  const p1 = await call('projects:save', { name: 'P1', rootPath: mkdtempSync(join(tmpdir(), 'ab-f1-')), unitIds: [tpl.unitId] })
  const tpl2 = await call('templates:instantiate', 'core')
  const p2 = await call('projects:save', { name: 'P2', rootPath: mkdtempSync(join(tmpdir(), 'ab-f2-')), unitIds: [tpl2.unitId] })
  settingsRepo.update({ onboarded: true, autopilot: false, reviewByLead: false, raceMode: false, language: 'en' })
  getDb().prepare('UPDATE agent_permissions SET require_approval = 0').run()
  applyLanguageSetting('en')
  orchestrator.init()
  const lead = projectLead(p1.id)!
  const dev = projectMembers(p1.id).filter((a) => !a.isLead && a.id !== lead.id)[0]
  const task = (title: string, extra: Record<string, unknown> = {}) => tasksRepo.create({ title, projectId: p1.id, assigneeId: dev.id, ...extra })
  const idle = () => agentsRepo.setStatus(dev.id, 'idle') // what the 45 s cooldown timer does

  // ── A. a side effect, then an error ────────────────────────────────────────────────────────────────────────────
  const tA = task('fails after a side effect')
  await step('A. the first failure holds the task with its reason; the side effect happened once', async () => {
    work = async () => {
      sideEffects++
      throw new Error('TypeError: fetch failed')
    }
    await call('tasks:start', tA.id)
    await until(() => runsOf(tA.id).some((r) => r.status === 'failed'), 'the failed run')
    assert.equal(sideEffects, 1)
    assert.equal(tasksRepo.get(tA.id)!.status, 'todo')
    assert.match(held(tA.id) ?? '', /^Failed: .*network/i, held(tA.id) ?? 'not held')
  })

  await step('A. time passing, the agent idle again, autopilot on: nothing restarts it', async () => {
    settingsRepo.update({ autopilot: true })
    orchestrator.startProjectWork(p1.id) // work started: only the hold keeps it back
    for (let i = 0; i < 6; i++) {
      idle()
      o.tick()
      await wait(30)
    }
    assert.equal(runsOf(tA.id).length, 1, 'no second run')
    assert.equal(sideEffects, 1)
    settingsRepo.update({ autopilot: false })
  })

  await step('A. a restart keeps the hold (and still nothing runs on its own)', async () => {
    restart()
    settingsRepo.update({ autopilot: true })
    orchestrator.startProjectWork(p1.id)
    for (let i = 0; i < 4; i++) {
      idle()
      o.tick()
      await wait(30)
    }
    settingsRepo.update({ autopilot: false })
    assert.ok(held(tA.id), 'still held after a restart')
    assert.equal(runsOf(tA.id).length, 1)
    assert.equal(sideEffects, 1)
  })

  await step('B. card / "Needs you" reason and the task thread tell the same thing, once', async () => {
    const notes = thread(tA.id, p1.id).filter((m) => m.senderType === 'system' && /couldn't finish this task/.test(m.content))
    assert.equal(notes.length, 1, 'one explained note')
    assert.match(notes[0].content, /won't start again on its own/)
    assert.match(notes[0].content, /Try again/)
    assert.match(notes[0].content, /network/i, 'the explanation, in the user language')
    assert.match(notes[0].content, /Details: TypeError: fetch failed/, 'the technical line, in the thread only')
    assert.doesNotMatch(held(tA.id) ?? '', /TypeError/, 'the short reason (card, "Needs you") stays plain')
    // The raw error stays in the run for the details.
    assert.equal(runsOf(tA.id)[0].error, 'TypeError: fetch failed')
  })

  await step('A/3. only the user restarts it; the new attempt is told about the earlier one', async () => {
    work = async () => {
      sideEffects++
      return 'checked the state first; done'
    }
    const before = taskPrompts.length
    idle()
    await call('tasks:start', tA.id)
    await until(() => runsOf(tA.id).length === 2 && runsOf(tA.id)[0].status !== 'running', 'the second run')
    assert.equal(sideEffects, 2)
    assert.match(taskPrompts[before], /## Previous attempt \(it did not finish\)[\s\S]*fetch failed[\s\S]*check the current state/)
    assert.equal(held(tA.id), null, 'the explicit start released the hold')
  })

  await step('B. secrets in an error stay out of the reason, the thread and the run', async () => {
    const tS = task('fails with a secret')
    const secret = 'sk-ant-' + 'abcd' + 'EFGHIJKLMNOPQRSTUV0123'
    work = async () => {
      throw new Error(`request failed: key ${secret} rejected by proxy`)
    }
    idle()
    await call('tasks:start', tS.id)
    await until(() => runsOf(tS.id).some((r) => r.status === 'failed'), 'the failed run')
    const everywhere = [held(tS.id) ?? '', ...thread(tS.id, p1.id).map((m) => m.content), runsOf(tS.id)[0].error ?? '']
    assert.ok(everywhere.every((x) => !x.includes(secret)), JSON.stringify(everywhere))
  })

  await step('A. a run that only waited for approval is not a "previous attempt"', async () => {
    const tP = task('rejected first')
    getDb().prepare('UPDATE agent_permissions SET require_approval = 1 WHERE agent_id = ?').run(dev.id)
    idle()
    void call('tasks:start', tP.id)
    await until(() => runsOf(tP.id).some((r) => r.status === 'awaiting_approval'), 'approval wait')
    orchestrator.approve(runsOf(tP.id)[0].id, false)
    await until(() => runsOf(tP.id)[0].status === 'cancelled', 'rejected')
    getDb().prepare('UPDATE agent_permissions SET require_approval = 0 WHERE agent_id = ?').run(dev.id)
    work = async () => 'ok'
    const before = taskPrompts.length
    idle()
    await call('tasks:start', tP.id)
    await until(() => taskPrompts.length > before, 'the real run')
    assert.doesNotMatch(taskPrompts[before], /Previous attempt/)
    await until(() => runsOf(tP.id)[0].status !== 'running', 'the run to end')
  })

  // ── E. regressions on the failure path ─────────────────────────────────────────────────────────────────────────
  await step('E. an auth error still pauses everything with its alert, and the task waits too', async () => {
    const tAuth = task('auth fails')
    work = async () => {
      throw new Error('Anthropic 401: {"type":"authentication_error"}')
    }
    idle()
    await call('tasks:start', tAuth.id)
    await until(() => runsOf(tAuth.id).some((r) => r.status === 'failed'), 'the failed run')
    assert.equal(orchestrator.state().paused, true, 'paused like before')
    assert.match(held(tAuth.id) ?? '', /login/i)
    orchestrator.resumeAll()
  })

  await step('E. a user stop keeps its own reason (not "failed")', async () => {
    const tStop = task('stopped by the user')
    work = (ctx) => new Promise((_, reject) => ctx.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
    idle()
    void call('tasks:start', tStop.id)
    await until(() => runsOf(tStop.id).some((r) => r.status === 'running'), 'running')
    await orchestrator.stopTaskAndWait(tStop.id)
    assert.match(held(tStop.id) ?? '', /stopped/i)
    assert.doesNotMatch(held(tStop.id) ?? '', /Failed/)
  })

  await step('E. projects stay apart: a failure in P1 holds nothing in P2', async () => {
    const devB = projectMembers(p2.id).filter((a) => !a.isLead && a.id !== projectLead(p2.id)?.id)[0]
    const tB = tasksRepo.create({ title: 'P2 task', projectId: p2.id, assigneeId: devB.id })
    work = async () => 'ok'
    agentsRepo.setStatus(devB.id, 'idle')
    await call('tasks:start', tB.id)
    await until(() => tasksRepo.get(tB.id)!.status !== 'in_progress', 'P2 run')
    assert.equal(held(tB.id), null)
    assert.ok(thread(tB.id, p2.id).every((m) => !/couldn't finish/.test(m.content)))
  })

  // ── D. a double start makes one run ────────────────────────────────────────────────────────────────────────────
  await step('D. two start calls at once start one run', async () => {
    const tD = task('double start')
    let release!: () => void
    work = () => new Promise((r) => (release = () => r('ok')))
    idle()
    await Promise.all([call('tasks:start', tD.id), call('tasks:start', tD.id)])
    await until(() => runsOf(tD.id).length > 0, 'a run')
    await wait(50)
    assert.equal(runsOf(tD.id).length, 1)
    release()
    await until(() => tasksRepo.get(tD.id)!.status !== 'in_progress', 'end')
  })

  await step('G. fail → a run turned down at approval → restart: the warning still names the real failed attempt', async () => {
    const tG = task('fail, reject, retry')
    work = async () => {
      throw new Error('connect ECONNREFUSED 10.0.0.5:5432')
    }
    idle()
    await call('tasks:start', tG.id)
    await until(() => runsOf(tG.id).some((r) => r.status === 'failed'), 'the failed run')
    getDb().prepare('UPDATE agent_permissions SET require_approval = 1 WHERE agent_id = ?').run(dev.id)
    idle()
    void call('tasks:start', tG.id)
    await until(() => runsOf(tG.id).some((r) => r.status === 'awaiting_approval'), 'approval wait')
    orchestrator.approve(runsOf(tG.id)[0].id, false)
    await until(() => runsOf(tG.id)[0].status === 'cancelled', 'turned down')
    getDb().prepare('UPDATE agent_permissions SET require_approval = 0 WHERE agent_id = ?').run(dev.id)
    work = async () => 'ok'
    let before = taskPrompts.length
    idle()
    await call('tasks:start', tG.id)
    await until(() => taskPrompts.length > before, 'the third run')
    assert.match(taskPrompts[before], /## Previous attempt[\s\S]*ECONNREFUSED/, 'the run turned down at approval is skipped')
    await until(() => tasksRepo.get(tG.id)!.status !== 'in_progress', 'third run ends')
    // After a run that went through, there is no "previous attempt" to warn about.
    before = taskPrompts.length
    idle()
    await call('tasks:start', tG.id)
    await until(() => taskPrompts.length > before, 'the fourth run')
    assert.doesNotMatch(taskPrompts[before], /Previous attempt/)
    await until(() => tasksRepo.get(tG.id)!.status !== 'in_progress', 'fourth run ends')
  })

  // ── C. the lead's review can't decide ──────────────────────────────────────────────────────────────────────────
  settingsRepo.update({ reviewByLead: true })
  const reviewed = async (title: string) => {
    const t1 = task(title)
    work = async () => 'worker report: fixed it'
    idle()
    await call('tasks:start', t1.id)
    await until(() => tasksRepo.get(t1.id)!.status === 'in_review', 'in review')
    return t1
  }
  const undecided = (id: string) => orchestrator.state().undecided.includes(id)
  const why = (id: string) => orchestrator.state().undecidedWhy[id] ?? ''

  await step('C. a review provider error: not approved, visible in "Needs you" and the thread', async () => {
    review = async () => {
      throw new Error('Anthropic 529: {"type":"overloaded_error"}')
    }
    const tC = await reviewed('review will fail')
    await until(() => undecided(tC.id), 'needs the user')
    assert.equal(tasksRepo.get(tC.id)!.status, 'in_review', 'never approved by an error')
    assert.match(why(tC.id), /review couldn't finish: .*busy/i)
    const notes = thread(tC.id, p1.id).filter((m) => /retry just the review/.test(m.content))
    assert.equal(notes.length, 1)
    assert.equal(agentsRepo.get(lead.id)!.status, 'idle', 'the lead is not left "working"')

    // D. Two retries at once: one review; the worker never runs again.
    const runsBefore = runsOf(tC.id).length
    const callsBefore = reviewCalls
    let open!: () => void
    review = () => new Promise((r) => (open = () => r('{"approved": true, "note": "looks right"}')))
    const results = await Promise.all([call('tasks:retryReview', tC.id), call('tasks:retryReview', tC.id)])
    assert.deepEqual(results.sort(), ['pending', 'queued'])
    assert.ok(!undecided(tC.id), 'a queued review is not "needs you"')
    await until(() => reviewCalls === callsBefore + 1, 'one review call')
    open()
    await until(() => tasksRepo.get(tC.id)!.status === 'done', 'approved')
    assert.equal(reviewCalls, callsBefore + 1)
    assert.equal(runsOf(tC.id).length, runsBefore, 'the worker did not run again')
    assert.ok(!undecided(tC.id))
  })

  await step('C. a retry that fails again stays visible, without a second copy of the note', async () => {
    let rk = ''
    let rCalls = 0
    review = async (ctx) => {
      if (rk && ctx.prompt.includes(`\n${rk}: `)) rCalls++
      throw new Error('The operation was aborted due to timeout')
    }
    const tR = await reviewed('fails twice')
    rk = tR.key
    await until(() => undecided(tR.id), 'needs the user')
    await call('tasks:retryReview', tR.id)
    await until(() => undecided(tR.id), 'needs the user again')
    assert.match(why(tR.id), /in time/i)
    // After a restart it still waits for the user, with its reason (2026-10-20): starting the project's work doesn't
    // review it again on its own; only the user's retry does, and the same failure doesn't stack notes.
    restart()
    o.reviewedRun.delete(tR.id) // a new process doesn't remember which run it reviewed
    const before = rCalls
    assert.ok(undecided(tR.id), 'still "needs you" after the restart')
    assert.match(why(tR.id), /in time/i, 'with the same reason')
    orchestrator.startProjectWork(p1.id)
    await wait(150)
    assert.equal(rCalls, before, 'not reviewed again on its own')
    await call('tasks:retryReview', tR.id)
    await until(() => rCalls > before && !o.reviewing.has(tR.id) && undecided(tR.id), 'reviewed again on retry')
    const notes = thread(tR.id, p1.id).filter((m) => /retry just the review/.test(m.content))
    assert.equal(notes.length, 1, notes.map((n) => n.content).join(' | '))
    // The user decides: moving it out clears the mark.
    await call('tasks:move', tR.id, 'done')
    assert.ok(!undecided(tR.id))
  })

  await step('D. the review queue takes one review per task (restart re-queue + another trigger at once)', async () => {
    // Other tasks left in review by earlier steps are reviewed (and approved) on the way; only this one waits.
    let open: (() => void) | null = null
    let key = ''
    review = (ctx) =>
      key && ctx.prompt.includes(`\n${key}: `)
        ? new Promise((_, reject) => (open = () => reject(new Error('fetch failed'))))
        : Promise.resolve('{"approved": true, "note": "ok"}')
    const tQ = task('queued twice')
    key = tQ.key
    work = async () => 'worker report'
    idle()
    await call('tasks:start', tQ.id)
    await until(() => !!open, 'its review running', 15000)
    const callsBefore = reviewCalls
    o.queueReview(tQ.id)
    o.queueReview(tQ.id)
    open!()
    await until(() => undecided(tQ.id), 'needs the user')
    await wait(150)
    assert.equal(reviewCalls, callsBefore, 'no extra review while one was queued or running')
  })

  await step('C. unclear verdict still waits for the user (existing behavior, now with a reason)', async () => {
    review = async () => 'Looks fine to me I guess'
    const tU = await reviewed('unclear verdict')
    await until(() => undecided(tU.id), 'needs the user')
    assert.match(why(tU.id), /no clear verdict/)
    assert.equal(tasksRepo.get(tU.id)!.status, 'in_review')
  })

  await step('C. nobody can review (no enabled lead or member): the task waits; "retry the review" says why', async () => {
    // In review without a review queued (the lead's review off for a moment), then the whole team turned off.
    settingsRepo.update({ reviewByLead: false })
    const tL = await reviewed('nobody to review')
    settingsRepo.update({ reviewByLead: true })
    const members = projectMembers(p1.id).map((a) => a.id)
    const setAll = (on: number) => {
      for (const id of members) getDb().prepare('UPDATE agents SET enabled = ? WHERE id = ?').run(on, id)
    }
    setAll(0)
    o.queueReview(tL.id)
    await until(() => undecided(tL.id), 'needs the user')
    assert.match(why(tL.id), /Nobody in this project can review/)
    assert.equal(tasksRepo.get(tL.id)!.status, 'in_review')
    await assert.rejects(call('tasks:retryReview', tL.id), /no active lead/)
    setAll(1)
    review = async () => '{"approved": true, "note": "ok"}'
    assert.equal(await call('tasks:retryReview', tL.id), 'queued')
    await until(() => tasksRepo.get(tL.id)!.status === 'done', 'approved')
  })

  await step('C. retry is refused for a task that is not in review (done / deleted)', async () => {
    const tN = task('not in review')
    await assert.rejects(call('tasks:retryReview', tN.id), /isn't in review/)
    await call('tasks:delete', tN.id)
    await assert.rejects(call('tasks:retryReview', tN.id), /not found/i)
  })

  await step('D. a late review failure after the user decided or deleted leaves no record', async () => {
    let fail!: () => void
    review = () => new Promise((_, reject) => (fail = () => reject(new Error('fetch failed'))))
    const tM = await reviewed('decided meanwhile')
    await until(() => !!fail, 'review running')
    await call('tasks:move', tM.id, 'done')
    fail()
    await wait(100)
    assert.ok(!undecided(tM.id))
    assert.ok(thread(tM.id, p1.id).every((m) => !/retry just the review/.test(m.content)))

    fail = undefined as never
    const tX = await reviewed('deleted meanwhile')
    await until(() => !!fail, 'review running')
    await call('tasks:delete', tX.id)
    fail()
    await wait(100)
    assert.ok(!undecided(tX.id))
    // (Messages written before the delete stay as they were; nothing about the review is written after it.)
    assert.ok(messagesRepo.list(`task:${tX.id}`, 50).every((m) => !/retry just the review/.test(m.content)), 'no review note for a deleted task')
  })

  // ── F. a review answers for the run (and task details) it judged, never for a newer one ────────────────────────
  const twoRuns = async (title: string, onFirstReview: (ctx: RunContext) => Promise<string>, onSecondReview: () => Promise<string>) => {
    let first: (() => void) | null = null
    let firstDone: Promise<string> | null = null
    review = (ctx) => {
      if (ctx.prompt.includes('REPORT-ONE')) {
        firstDone = new Promise((r) => (first = () => r(undefined as never))).then(() => onFirstReview(ctx))
        return firstDone
      }
      if (ctx.prompt.includes('REPORT-TWO')) return onSecondReview()
      return Promise.resolve('{"approved": true, "note": "ok"}')
    }
    const tF = task(title)
    work = async () => 'REPORT-ONE'
    idle()
    await call('tasks:start', tF.id)
    await until(() => !!first, 'the review of run 1 running')
    // The user runs the worker again while that review is still out; run 2 finishes and is in review too.
    work = async () => 'REPORT-TWO'
    idle()
    await call('tasks:start', tF.id)
    await until(() => runsOf(tF.id).length === 2 && tasksRepo.get(tF.id)!.status === 'in_review', 'run 2 in review')
    const callsBefore = reviewCalls
    first!()
    await until(() => tasksRepo.get(tF.id)!.status !== 'in_review' || undecided(tF.id), 'a decision', 10000)
    return { tF, extraCalls: () => reviewCalls - callsBefore }
  }

  await step('F. a late "approved" for run 1 does not finish the task: run 2 is reviewed and decides', async () => {
    const { tF, extraCalls } = await twoRuns(
      'stale approval',
      async () => '{"approved": true, "note": "old run looked fine"}',
      async () => '{"approved": false, "note": "second run needs work"}'
    )
    assert.equal(tasksRepo.get(tF.id)!.status, 'todo', "run 2's verdict (send back), not run 1's approval")
    assert.match(tasksRepo.get(tF.id)!.reviewNote ?? '', /second run needs work/)
    assert.equal(extraCalls(), 1, 'run 2 reviewed exactly once')
  })

  await step('F. a late failure of run 1\'s review does not mark run 2: run 2 is reviewed and approved', async () => {
    const { tF, extraCalls } = await twoRuns(
      'stale failure',
      async () => {
        throw new Error('fetch failed')
      },
      async () => '{"approved": true, "note": "second run is fine"}'
    )
    await until(() => tasksRepo.get(tF.id)!.status === 'done', 'approved')
    assert.ok(!undecided(tF.id), 'the old failure left no mark')
    assert.ok(thread(tF.id, p1.id).every((m) => !/retry just the review/.test(m.content)), 'and no note')
    assert.equal(extraCalls(), 1)
  })

  await step('F. task details edited during the review: that verdict is dropped and the current details are reviewed', async () => {
    let open!: () => void
    let seen = 0
    review = (ctx) => {
      seen++
      if (!ctx.prompt.includes('NEW-DETAILS')) return new Promise((r) => (open = () => r('{"approved": true, "note": "judged the old details"}')))
      return Promise.resolve('{"approved": false, "note": "judged the new details"}')
    }
    const tE = task('edited during review')
    work = async () => 'a report'
    idle()
    await call('tasks:start', tE.id)
    await until(() => seen === 1, 'review running')
    await call('tasks:update', tE.id, { description: 'NEW-DETAILS: also handle empty carts' })
    open()
    await until(() => tasksRepo.get(tE.id)!.status !== 'in_review', 'a decision')
    assert.equal(tasksRepo.get(tE.id)!.status, 'todo')
    assert.match(tasksRepo.get(tE.id)!.reviewNote ?? '', /judged the new details/)
    assert.equal(seen, 2)
  })

  // ── H. race: whichever side changes while the comparison is out, the current pair is compared (once) ─────────────
  const dev2 = projectMembers(p1.id).filter((a) => !a.isLead && a.id !== lead.id && a.id !== dev.id)[0]
  const racePair = async (name: string) => {
    // Both attempts finished and in review, with no review queued yet (the lead's review off meanwhile).
    settingsRepo.update({ reviewByLead: false })
    const a = task(`${name} A`)
    const b = tasksRepo.create({ title: `${name} B`, projectId: p1.id, assigneeId: dev2.id, raceOf: a.id })
    work = async (ctx) => (ctx.prompt.includes(`${name} B`) ? 'ATTEMPT-B' : 'ATTEMPT-A')
    idle()
    agentsRepo.setStatus(dev2.id, 'idle')
    await call('tasks:start', a.id)
    await call('tasks:start', b.id)
    await until(() => tasksRepo.get(a.id)!.status === 'in_review' && tasksRepo.get(b.id)!.status === 'in_review', 'both in review')
    settingsRepo.update({ reviewByLead: true })
    return { a, b }
  }
  const raceCalls: string[] = []
  const comparing = (first: () => Promise<string>, next: (prompt: string) => string) => {
    let release: (() => void) | null = null
    let n = 0
    review = (ctx) => {
      if (!ctx.prompt.includes('## Attempt B')) return Promise.resolve('{"approved": true, "note": "ok"}')
      raceCalls.push(ctx.prompt)
      n++
      if (n === 1) return new Promise<void>((r) => (release = r)).then(first)
      return Promise.resolve(next(ctx.prompt))
    }
    return { started: () => !!release, release: () => release!(), calls: () => n }
  }

  await step('H. started from B, A edited meanwhile: the old verdict is dropped and the current pair is compared once', async () => {
    const { a, b } = await racePair('race-1')
    const c = comparing(async () => '{"winner": "B", "note": "old comparison"}', (prompt) =>
      prompt.includes('NEW-A') ? '{"winner": "A", "note": "current comparison"}' : '{"winner": "B", "note": "stale text"}'
    )
    o.queueReview(b.id)
    await until(c.started, 'comparison running')
    await call('tasks:update', a.id, { description: 'NEW-A: also round the totals' })
    c.release()
    await until(() => tasksRepo.get(a.id)!.status === 'done', 'the current comparison decided', 10000)
    assert.equal(c.calls(), 2, 'one new comparison')
    assert.match(raceCalls.at(-1)!, /NEW-A/, 'with the current details')
    assert.notEqual(tasksRepo.get(b.id)!.status, 'in_review')
    await wait(150)
    assert.equal(c.calls(), 2, 'and no extra one')
  })

  await step('H. same, but the old comparison fails: no mark is left and the current pair is compared', async () => {
    const { a, b } = await racePair('race-2')
    const c = comparing(
      async () => {
        throw new Error('fetch failed')
      },
      () => '{"winner": "A", "note": "current comparison"}'
    )
    o.queueReview(b.id)
    await until(c.started, 'comparison running')
    await call('tasks:update', a.id, { description: 'NEW-A again' })
    c.release()
    await until(() => tasksRepo.get(a.id)!.status === 'done', 'decided', 10000)
    assert.ok(!undecided(a.id) && !undecided(b.id))
    assert.equal(c.calls(), 2)
  })

  await step('H. started from A, B edited meanwhile: the current pair is compared (the other direction)', async () => {
    const { a, b } = await racePair('race-3')
    const c = comparing(async () => '{"winner": "A", "note": "old comparison"}', () => '{"winner": "B", "note": "current comparison"}')
    o.queueReview(a.id)
    await until(c.started, 'comparison running')
    await call('tasks:update', b.id, { description: 'NEW-B: a better approach' })
    c.release()
    await until(() => tasksRepo.get(b.id)!.status === 'done', 'the current comparison decided', 10000)
    assert.equal(c.calls(), 2)
    await wait(150)
    assert.equal(c.calls(), 2)
  })

  await step('H. both sides queue their review (the usual finish): one comparison for the pair, not two', async () => {
    // An unclear verdict leaves both in review: the second side's queued review must not compare them again.
    const { a, b } = await racePair('race-4')
    const c = comparing(async () => 'I cannot tell which one is better', () => '{"winner": "A", "note": "x"}')
    o.queueReview(a.id)
    o.queueReview(b.id)
    await until(c.started, 'comparison running')
    c.release()
    await until(() => undecided(a.id) && undecided(b.id), 'both wait for the user', 10000)
    await wait(200)
    assert.equal(c.calls(), 1, 'the same two runs are compared once')
    // The user can still ask again, explicitly: that is one more comparison.
    assert.equal(await call('tasks:retryReview', a.id), 'queued')
    await until(() => tasksRepo.get(a.id)!.status === 'done', 'decided on retry', 10000)
    assert.equal(c.calls(), 2)
  })

  orchestrator.shutdown()
  console.log(`failureReview e2e: ${count} steps ok`)
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e)
    process.exit(1)
  }
)
