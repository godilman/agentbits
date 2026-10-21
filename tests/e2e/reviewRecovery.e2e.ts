// Review recovery (ADR-036): when the lead's review fails for a passing reason or gives no clear verdict, only the
// review is tried again — never the worker — at most 2 extra times per task (kept across restarts), within a time
// window; only where each call's limits are enforced; waiting for files being read in is no model call and ends in one
// review. Nothing is armed before the user starts the project's work; the user's cancel / pause / own retry / move
// ends a pending recovery; one timer per task. Real SQLite, real orchestrator; the provider is a stub; long timers are
// captured and fired by the test. Run: npm run test:e2e
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDb, openDb } from '../../src/main/db'
import { agentsRepo, messagesRepo, settingsRepo, tasksRepo } from '../../src/main/db/repos'
import { handlers } from '../../src/main/ipc'
import { orchestrator } from '../../src/main/core/orchestrator'
import { projectLead, projectMembers } from '../../src/main/core/org'
import { generatedFor, recordWorkspaceChanges } from '../../src/main/files/service'
import { emit } from '../../src/main/events'
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

// Timers of a minute or more (the recovery's) are captured instead of run: the test fires them.
const realSet = globalThis.setTimeout
const realClear = globalThis.clearTimeout
const captured = new Map<object, () => void>()
;(globalThis as any).setTimeout = (fn: () => void, ms?: number, ...rest: unknown[]) => {
  if ((ms ?? 0) < 50_000) return realSet(fn, ms, ...rest)
  const handle = { captured: true }
  captured.set(handle, fn)
  return handle
}
;(globalThis as any).clearTimeout = (h: unknown) => (h && typeof h === 'object' && captured.delete(h as object) ? undefined : realClear(h as NodeJS.Timeout))
/** Fires every captured timer (as if their time had come). */
const fire = (): void => {
  const fns = [...captured.values()]
  captured.clear()
  for (const f of fns) f()
}

let workCalls = 0
let reviewCalls = 0
let review: (ctx: RunContext) => Promise<string> = async () => '{"approved": true, "note": "ok"}'
getAdapter('mock').run = async (ctx: RunContext) => {
  if (ctx.mode === 'review') {
    reviewCalls++
    return { text: await review(ctx), tokensIn: 1, tokensOut: 1, costUsd: 0 }
  }
  if (ctx.mode === 'chat') return { text: 'Ok.', tokensIn: 1, tokensOut: 1, costUsd: 0 }
  workCalls++
  return { text: 'report: done', tokensIn: 1, tokensOut: 1, costUsd: 0 }
}
const timeout = async (): Promise<string> => {
  throw new Error('The operation was aborted due to timeout')
}

const thread = (id: string, pid: string): Message[] => messagesRepo.list(`task:${id}`, 200, pid)
const general = (pid: string): Message[] => messagesRepo.list('general', 400, pid)
const recovering = (id: string) => orchestrator.state().recovering[id] ?? null
const undecided = (id: string): boolean => orchestrator.state().undecided.includes(id)
const recState = (id: string) => o.recovery.get(id) as { attempts: number; episode: unknown } | undefined

async function main(): Promise<void> {
  openDb()
  const tpl = await call('templates:instantiate', 'ecommerce')
  const root = mkdtempSync(join(tmpdir(), 'ab-rr-'))
  const p = await call('projects:save', { name: 'P', rootPath: root, unitIds: [tpl.unitId] })
  settingsRepo.update({ onboarded: true, autopilot: false, reviewByLead: true, raceMode: false, language: 'en', autoRecovery: true })
  getDb().prepare('UPDATE agent_permissions SET require_approval = 0').run()
  applyLanguageSetting('en')
  orchestrator.init()
  orchestrator.startProjectWork(p.id) // the user started the work: recovery may act
  const lead = projectLead(p.id)!
  const dev = projectMembers(p.id).filter((a) => !a.isLead && a.id !== lead.id)[0]
  /** A task the worker finished: in review, its review scripted by `review`. */
  const reviewed = async (title: string) => {
    const t1 = tasksRepo.create({ title, projectId: p.id, assigneeId: dev.id })
    agentsRepo.setStatus(dev.id, 'idle')
    await call('tasks:start', t1.id)
    await until(() => tasksRepo.get(t1.id)!.status === 'in_review' && !o.reviewing.has(t1.id), 'reviewed once')
    return t1
  }

  await step('a passing review failure: no card; only the review is tried again later (one timer); the worker never runs', async () => {
    review = timeout
    const t1 = await reviewed('retry heals it')
    await until(() => !!recovering(t1.id), 'recovering')
    assert.ok(!undecided(t1.id), 'not "needs you"')
    const r = recovering(t1.id)!
    assert.equal(r.kind, 'retry')
    assert.equal(r.attempt, 1)
    assert.equal(r.max, 2)
    assert.ok(r.at && Date.parse(r.at) - Date.now() > 50_000, 'about a minute later')
    assert.equal(captured.size, 1, 'one timer')
    assert.match(general(p.id).at(-1)!.content, /review couldn't finish \(Demo \(simulation\): no answer in time\)\. The team will try only the review again in 1 min \(extra attempt 1 of 2\); the worker doesn't run again\. Nothing is needed from you/)
    assert.doesNotMatch(general(p.id).at(-1)!.content, /Try again later/, "the provider's advice to the user isn't repeated here")
    assert.equal(r.waitsForStart, false)
    const works = workCalls
    const reviews = reviewCalls
    review = async () => '{"approved": true, "note": "fine now"}'
    fire()
    await until(() => tasksRepo.get(t1.id)!.status === 'done', 'approved on the retry')
    assert.equal(reviewCalls, reviews + 1)
    assert.equal(workCalls, works, 'the worker did not run again')
    assert.equal(recovering(t1.id), null)
    assert.equal(recState(t1.id)!.attempts, 1, 'the attempt is counted')
    assert.equal(captured.size, 0)
  })

  await step('it keeps failing: after 2 extra tries the user decides, told what was tried and what it cost', async () => {
    review = timeout
    const t1 = await reviewed('never heals')
    await until(() => !!recovering(t1.id), 'recovering')
    fire()
    await until(() => recovering(t1.id)?.attempt === 2 && !!recovering(t1.id)?.at, 'the second retry scheduled')
    assert.match(general(p.id).at(-1)!.content, /again in 5 min \(extra attempt 2 of 2\)/)
    const reviews = reviewCalls
    fire()
    await until(() => undecided(t1.id), 'needs you')
    assert.equal(reviewCalls, reviews + 1)
    assert.equal(captured.size, 0, 'no third try')
    assert.equal(recState(t1.id)!.attempts, 2)
    const card = thread(t1.id, p.id).filter((m) => m.meta?.card).at(-1)!
    assert.match(card.content, /tried the review 2 more times over \d+ min; it didn't work\. There is no usage record of the task's model calls, so what they cost isn't known\./)
    assert.match(orchestrator.state().undecidedWhy[t1.id], /2 more times/)
  })

  await step('no clear verdict: asked once more, then it stands', async () => {
    review = async () => 'looks fine I guess'
    const t1 = await reviewed('unclear once')
    await until(() => !!recovering(t1.id), 'recovering')
    assert.ok(!undecided(t1.id))
    review = async () => '{"approved": true, "note": "clear now"}'
    fire()
    await until(() => tasksRepo.get(t1.id)!.status === 'done', 'approved')
  })

  await step('a provider whose review calls have no enforced limits (Claude Code): not retried, the card says why', async () => {
    const providerFor = o.providerFor.bind(o)
    o.providerFor = (agent: { id: string }) => {
      const r = providerFor(agent)
      return agent.id === lead.id ? { ...r, provider: { ...r.provider, kind: 'claude-cli' } } : r
    }
    try {
      review = timeout
      const t1 = await reviewed('cli review')
      await until(() => undecided(t1.id), 'needs you')
      assert.equal(recovering(t1.id), null)
      assert.equal(captured.size, 0)
      assert.match(orchestrator.state().undecidedWhy[t1.id], /wasn't retried automatically: this provider's review calls have no enforced time or token limit/)
    } finally {
      o.providerFor = providerFor
    }
  })

  await step('files still being read in: no model call while waiting; once ready, one review (however many events)', async () => {
    o.filesReadyMs = 60
    review = async () => '{"approved": true, "note": "ok"}'
    const t1 = tasksRepo.create({ title: 'files pending', projectId: p.id, assigneeId: dev.id })
    // The worker's run leaves a file being read in when the review starts.
    getAdapter('mock').run = async (ctx: RunContext) => {
      if (ctx.mode === 'review') {
        reviewCalls++
        return { text: await review(ctx), tokensIn: 1, tokensOut: 1, costUsd: 0 }
      }
      workCalls++
      writeFileSync(join(root, 'notes.md'), 'v1')
      return { text: 'report', tokensIn: 1, tokensOut: 1, costUsd: 0 }
    }
    const reviews = reviewCalls
    settingsRepo.update({ reviewByLead: false }) // the run ends in review; the test queues the review itself below
    agentsRepo.setStatus(dev.id, 'idle')
    await call('tasks:start', t1.id)
    await until(() => tasksRepo.get(t1.id)!.status === 'in_review', 'in review')
    settingsRepo.update({ reviewByLead: true })
    const run = (getDb().prepare('SELECT id FROM runs WHERE task_id = ?').get(t1.id) as { id: string }).id
    recordWorkspaceChanges({ projectId: p.id, agentId: dev.id, runId: run, taskId: t1.id } as never, root, 0)
    // The file the review looks at (the run's output) is still being read in.
    await until(() => !!generatedFor(run)[0] && generatedFor(run)[0].status !== 'processing', 'its own read-in to end')
    const [f] = generatedFor(run)
    getDb().prepare("UPDATE files SET status = 'processing' WHERE id = ?").run(f.id)
    o.reviewedRun.delete(t1.id)
    o.queueReview(t1.id)
    await until(() => recovering(t1.id)?.kind === 'files', 'waiting for files')
    assert.equal(reviewCalls, reviews, 'no model call while the file is read in')
    assert.ok(!undecided(t1.id))
    assert.match(general(p.id).at(-1)!.content, /still being read in \(notes\.md\)[\s\S]*no model is called meanwhile/)
    emit({ type: 'files:changed' }) // still processing: nothing
    await wait(50)
    assert.equal(reviewCalls, reviews)
    getDb().prepare("UPDATE files SET status = 'ready' WHERE id = ?").run(f.id)
    for (let i = 0; i < 5; i++) emit({ type: 'files:changed' })
    await until(() => tasksRepo.get(t1.id)!.status === 'done', 'reviewed once the file is ready')
    await wait(80)
    assert.equal(reviewCalls, reviews + 1, 'exactly one review')
    assert.equal(recState(t1.id)?.attempts ?? 0, 0, 'waiting for files is not a retry')
    getAdapter('mock').run = async (ctx: RunContext) => {
      if (ctx.mode === 'review') {
        reviewCalls++
        return { text: await review(ctx), tokensIn: 1, tokensOut: 1, costUsd: 0 }
      }
      workCalls++
      return { text: 'report: done', tokensIn: 1, tokensOut: 1, costUsd: 0 }
    }
  })

  await step('a restart keeps attempts and the recovery; nothing is armed until the user starts the work', async () => {
    review = timeout
    const t1 = await reviewed('across a restart')
    await until(() => !!recovering(t1.id), 'recovering')
    orchestrator.shutdown()
    assert.equal(captured.size, 0, 'timers end with the process')
    o.closing = false
    o.workStarted.clear() // a new process: no project's work is started, no review judged in memory
    o.reviewedRun.clear()
    orchestrator.init()
    assert.equal(recState(t1.id)!.attempts, 0)
    assert.ok(recState(t1.id)!.episode, 'the recovery is remembered')
    assert.equal(captured.size, 0, 'opening the app starts nothing')
    const reviews = reviewCalls
    orchestrator.startProjectWork(p.id)
    assert.equal(captured.size, 1, 'armed once the user starts the work')
    await wait(150)
    assert.equal(reviewCalls, reviews, 'no other (uncounted) review of it when the work starts')
    review = async () => '{"approved": true, "note": "ok"}'
    fire()
    await until(() => tasksRepo.get(t1.id)!.status === 'done', 'approved')
    assert.equal(reviewCalls, reviews + 1)
    assert.equal(recState(t1.id)!.attempts, 1)
  })

  await step('the user decides: cancel, pause, their own retry or a move ends a pending recovery (no timer left)', async () => {
    review = timeout
    const a = await reviewed('cancelled while recovering')
    await until(() => !!recovering(a.id), 'recovering')
    await call('tasks:cancel', a.id)
    assert.equal(recovering(a.id), null)
    assert.equal(captured.size, 0)

    const b = await reviewed('paused while recovering')
    await until(() => !!recovering(b.id), 'recovering')
    orchestrator.pauseAll()
    assert.equal(captured.size, 0)
    assert.ok(undecided(b.id), 'it waits for the user, not silently')
    assert.match(orchestrator.state().undecidedWhy[b.id], /stopped because you paused everything/)
    orchestrator.resumeAll()
    assert.equal(captured.size, 0, 'resuming does not bring it back')

    const c = await reviewed('own retry')
    await until(() => !!recovering(c.id), 'recovering')
    const attempts = recState(c.id)!.attempts
    review = async () => '{"approved": true, "note": "ok"}'
    assert.equal(await call('tasks:retryReview', c.id), 'queued')
    assert.equal(captured.size, 0, 'the automatic retry is dropped')
    await until(() => tasksRepo.get(c.id)!.status === 'done', 'approved')
    assert.equal(recState(c.id)!.attempts, attempts, "the user's retry isn't counted")

    review = timeout
    const d = await reviewed('moved while recovering')
    await until(() => !!recovering(d.id), 'recovering')
    await call('tasks:move', d.id, 'done')
    orchestrator.state()
    assert.equal(recovering(d.id), null)
    assert.equal(captured.size, 0)
    const reviews = reviewCalls
    fire()
    await wait(50)
    assert.equal(reviewCalls, reviews)
  })

  await step('only passing failures are retried; in a project whose work isn\'t started nothing is armed', async () => {
    review = async () => {
      throw new Error('Unexpected token < in JSON at position 0')
    }
    const t1 = await reviewed('a lasting failure')
    await until(() => undecided(t1.id), 'needs you at once')
    assert.equal(recovering(t1.id), null)
    assert.equal(captured.size, 0)

    const p2 = await call('projects:save', { name: 'Q', rootPath: mkdtempSync(join(tmpdir(), 'ab-rr2-')), unitIds: [tpl.unitId] })
    const lead2 = projectLead(p2.id)!
    const dev2 = projectMembers(p2.id).filter((a) => !a.isLead && a.id !== lead2.id)[0]
    review = async () => '{"approved": true, "note": "ok"}'
    settingsRepo.update({ reviewByLead: false })
    const t2 = tasksRepo.create({ title: 'not started project', projectId: p2.id, assigneeId: dev2.id })
    agentsRepo.setStatus(dev2.id, 'idle')
    await call('tasks:start', t2.id)
    await until(() => tasksRepo.get(t2.id)!.status === 'in_review', 'in review')
    settingsRepo.update({ reviewByLead: true })
    review = timeout
    await call('tasks:retryReview', t2.id)
    await until(() => !!recovering(t2.id), 'recovering')
    assert.equal(captured.size, 0, 'the user hasn\'t started this project\'s work: nothing armed')
    assert.equal(recovering(t2.id)!.waitsForStart, true)
    assert.match(general(p2.id).at(-1)!.content, /once you start this project's work \(extra attempt 1 of 2\)/, 'no time promised')
    orchestrator.startProjectWork(p2.id)
    assert.equal(captured.size, 1)
    await call('tasks:cancel', t2.id)
  })

  await step('the recovery time is up: the user decides (no further try)', async () => {
    review = timeout
    const t1 = await reviewed('window over')
    await until(() => !!recovering(t1.id), 'recovering')
    o.recovery.get(t1.id).episode.startedAt = Date.now() - 31 * 60_000
    const reviews = reviewCalls
    fire()
    await until(() => undecided(t1.id), 'needs you')
    assert.equal(reviewCalls, reviews)
    assert.match(orchestrator.state().undecidedWhy[t1.id], /ran out of time/)
  })

  // The setting and the provider are checked again right before the call, not only when the retry was planned.
  const providerFor = o.providerFor.bind(o)
  const leadOnCli = (agent: { id: string }) => {
    const r = providerFor(agent)
    return agent.id === lead.id ? { ...r, provider: { ...r.provider, kind: 'claude-cli' } } : r
  }

  await step('recovery turned off while a retry waits: it ends at once, the card says why; no call later', async () => {
    review = timeout
    const t1 = await reviewed('off while waiting')
    await until(() => !!recovering(t1.id), 'recovering')
    const reviews = reviewCalls
    await call('settings:update', { autoRecovery: false })
    assert.equal(recovering(t1.id), null, 'not left "recovering"')
    assert.equal(captured.size, 0, 'its timer is gone')
    assert.ok(undecided(t1.id))
    assert.match(orchestrator.state().undecidedWhy[t1.id], /turned off in Settings; the pending review wasn't made/)
    fire()
    await wait(50)
    assert.equal(reviewCalls, reviews)
    settingsRepo.update({ autoRecovery: true })
  })

  await step('recovery turned off after the retry was queued: no call, not counted, the card says why', async () => {
    review = timeout
    const t1 = await reviewed('off once queued')
    await until(() => !!recovering(t1.id), 'recovering')
    const reviews = reviewCalls
    const attempts = recState(t1.id)!.attempts
    fire() // the timer queues the retry review…
    await call('settings:update', { autoRecovery: false }) // …and the setting goes off before its call
    await until(() => undecided(t1.id), 'needs you')
    assert.equal(reviewCalls, reviews, 'no model call')
    assert.equal(recState(t1.id)!.attempts, attempts, 'a try not made is not counted')
    assert.equal(recovering(t1.id), null)
    assert.match(orchestrator.state().undecidedWhy[t1.id], /turned off in Settings/)
    settingsRepo.update({ autoRecovery: true })
  })

  await step('the lead moved to a provider without call limits (CLI) while the retry waited: no call, the card says why', async () => {
    review = timeout
    const t1 = await reviewed('cli while waiting')
    await until(() => !!recovering(t1.id), 'recovering')
    const reviews = reviewCalls
    o.providerFor = leadOnCli
    try {
      fire()
      await until(() => undecided(t1.id), 'needs you')
      assert.equal(reviewCalls, reviews, 'no model call')
      assert.equal(recState(t1.id)!.attempts, 0, 'not counted')
      assert.match(orchestrator.state().undecidedWhy[t1.id], /pending automatic review retry wasn't made: the lead's current provider can't enforce/)
    } finally {
      o.providerFor = providerFor
    }
  })

  await step('the provider changed while the queued retry was being prepared: checked again with the current one, no call', async () => {
    review = timeout
    const t1 = await reviewed('cli once queued')
    await until(() => !!recovering(t1.id), 'recovering')
    const reviews = reviewCalls
    const changesOf = o.changesOf
    o.changesOf = async (id: string) => {
      o.providerFor = leadOnCli // switched after the review took the provider, before its call
      return changesOf.call(o, id)
    }
    try {
      fire()
      await until(() => undecided(t1.id), 'needs you')
      assert.equal(reviewCalls, reviews, 'no model call')
      assert.match(orchestrator.state().undecidedWhy[t1.id], /the lead's current provider can't enforce/)
    } finally {
      o.changesOf = changesOf
      o.providerFor = providerFor
    }
  })

  await step('the file event queues the review, then the setting is off: no call, the card says why', async () => {
    review = async () => '{"approved": true, "note": "ok"}'
    const t1 = tasksRepo.create({ title: 'files then off', projectId: p.id, assigneeId: dev.id })
    settingsRepo.update({ reviewByLead: false })
    agentsRepo.setStatus(dev.id, 'idle')
    await call('tasks:start', t1.id)
    await until(() => tasksRepo.get(t1.id)!.status === 'in_review', 'in review')
    settingsRepo.update({ reviewByLead: true })
    const run = (getDb().prepare('SELECT id FROM runs WHERE task_id = ?').get(t1.id) as { id: string }).id
    writeFileSync(join(root, 'later.md'), 'v1')
    recordWorkspaceChanges({ projectId: p.id, agentId: dev.id, runId: run, taskId: t1.id } as never, root, 0)
    await until(() => !!generatedFor(run)[0] && generatedFor(run)[0].status !== 'processing', 'its own read-in to end')
    const [f] = generatedFor(run)
    getDb().prepare("UPDATE files SET status = 'processing' WHERE id = ?").run(f.id)
    o.reviewedRun.delete(t1.id)
    o.queueReview(t1.id)
    await until(() => recovering(t1.id)?.kind === 'files', 'waiting for files')
    const reviews = reviewCalls
    settingsRepo.update({ autoRecovery: false }) // straight to the store: the queued review itself must notice
    getDb().prepare("UPDATE files SET status = 'ready' WHERE id = ?").run(f.id)
    emit({ type: 'files:changed' })
    await until(() => undecided(t1.id), 'needs you')
    assert.equal(reviewCalls, reviews, 'no model call')
    assert.match(orchestrator.state().undecidedWhy[t1.id], /turned off in Settings/)
    settingsRepo.update({ autoRecovery: true })
  })

  await step("the user's own retry is not the recovery's: it runs with recovery off and a CLI lead, even over a queued one", async () => {
    review = timeout
    const t1 = await reviewed('own retry, off + cli')
    await until(() => !!recovering(t1.id), 'recovering')
    settingsRepo.update({ autoRecovery: false })
    o.providerFor = leadOnCli
    try {
      review = async () => '{"approved": true, "note": "ok"}'
      const reviews = reviewCalls
      fire() // the automatic retry is queued…
      assert.equal(await call('tasks:retryReview', t1.id), 'pending') // …and the user asks for it too
      await until(() => tasksRepo.get(t1.id)!.status === 'done', 'reviewed')
      assert.equal(reviewCalls, reviews + 1)

      review = timeout
      const t2 = await reviewed('own retry, nothing queued')
      await until(() => undecided(t2.id), 'needs you')
      review = async () => '{"approved": true, "note": "ok"}'
      assert.equal(await call('tasks:retryReview', t2.id), 'queued')
      await until(() => tasksRepo.get(t2.id)!.status === 'done', 'reviewed')
    } finally {
      o.providerFor = providerFor
      settingsRepo.update({ autoRecovery: true })
    }
  })

  await step('the app closed after the retry was queued, before its call: it is queued again on start (counted once)', async () => {
    review = timeout
    const t1 = await reviewed('queued at close')
    await until(() => !!recovering(t1.id), 'recovering')
    const st = o.recovery.get(t1.id)
    st.attempts++ // what the timer does when it queues the retry
    st.episode.retries++
    st.episode.nextAt = null
    o.saveRecovery()
    for (const h of [...captured.keys()]) captured.delete(h)
    orchestrator.shutdown()
    o.closing = false
    o.workStarted.clear()
    o.reviewedRun.clear()
    orchestrator.init()
    assert.ok(recovering(t1.id), 'still recovering, not stuck')
    const reviews = reviewCalls
    review = async () => '{"approved": true, "note": "ok"}'
    orchestrator.startProjectWork(p.id)
    await until(() => tasksRepo.get(t1.id)!.status === 'done', 'reviewed')
    assert.equal(reviewCalls, reviews + 1)
    assert.equal(recState(t1.id)!.attempts, 1)
  })

  // The 30-minute window is checked right before the call too (not only when the timer fires).
  const old = Date.now() - 31 * 60_000

  await step('the window ran out while the queued retry waited for a restart: no call on start, not counted, the card says why', async () => {
    review = timeout
    const t1 = await reviewed('window over at restart')
    await until(() => !!recovering(t1.id), 'recovering')
    const st = o.recovery.get(t1.id)
    st.attempts++ // queued by the timer…
    st.episode.retries++
    st.episode.nextAt = null
    st.episode.startedAt = old // …and the app stayed closed past the window
    o.saveRecovery()
    for (const h of [...captured.keys()]) captured.delete(h)
    orchestrator.shutdown()
    o.closing = false
    o.workStarted.clear()
    o.reviewedRun.clear()
    orchestrator.init()
    const reviews = reviewCalls
    review = async () => '{"approved": true, "note": "ok"}'
    orchestrator.startProjectWork(p.id)
    await until(() => undecided(t1.id), 'needs you')
    assert.equal(reviewCalls, reviews, 'no model call')
    assert.equal(recState(t1.id)!.attempts, 0, 'a try not made is not counted')
    assert.equal(recovering(t1.id), null)
    assert.match(orchestrator.state().undecidedWhy[t1.id], /pending automatic review wasn't made: the automatic recovery's 30 minutes are up/)
  })

  await step('the window ran out while the retry sat in the queue: no call', async () => {
    review = timeout
    const t1 = await reviewed('window over in the queue')
    await until(() => !!recovering(t1.id), 'recovering')
    const reviews = reviewCalls
    fire() // queued in time…
    o.recovery.get(t1.id).episode.startedAt = old // …but its turn came after the window
    await until(() => undecided(t1.id), 'needs you')
    assert.equal(reviewCalls, reviews, 'no model call')
    assert.match(orchestrator.state().undecidedWhy[t1.id], /30 minutes are up/)
  })

  await step('the files became ready only after the window: no review call, the card says why', async () => {
    review = async () => '{"approved": true, "note": "ok"}'
    const t1 = tasksRepo.create({ title: 'files ready late', projectId: p.id, assigneeId: dev.id })
    settingsRepo.update({ reviewByLead: false })
    agentsRepo.setStatus(dev.id, 'idle')
    await call('tasks:start', t1.id)
    await until(() => tasksRepo.get(t1.id)!.status === 'in_review', 'in review')
    settingsRepo.update({ reviewByLead: true })
    const run = (getDb().prepare('SELECT id FROM runs WHERE task_id = ?').get(t1.id) as { id: string }).id
    writeFileSync(join(root, 'late.md'), 'v1')
    recordWorkspaceChanges({ projectId: p.id, agentId: dev.id, runId: run, taskId: t1.id } as never, root, 0)
    await until(() => !!generatedFor(run)[0] && generatedFor(run)[0].status !== 'processing', 'its own read-in to end')
    const [f] = generatedFor(run)
    getDb().prepare("UPDATE files SET status = 'processing' WHERE id = ?").run(f.id)
    o.reviewedRun.delete(t1.id)
    o.queueReview(t1.id)
    await until(() => recovering(t1.id)?.kind === 'files', 'waiting for files')
    const reviews = reviewCalls
    o.recovery.get(t1.id).episode.startedAt = old // its timer didn't get to fire (e.g. the app was closed)
    getDb().prepare("UPDATE files SET status = 'ready' WHERE id = ?").run(f.id)
    emit({ type: 'files:changed' })
    await until(() => undecided(t1.id), 'needs you')
    assert.equal(reviewCalls, reviews, 'no model call')
    assert.match(orchestrator.state().undecidedWhy[t1.id], /30 minutes are up/)
    for (const h of [...captured.keys()]) captured.delete(h)
  })

  await step("the user's own retry isn't held to the window", async () => {
    review = timeout
    const t1 = await reviewed('own retry after the window')
    await until(() => !!recovering(t1.id), 'recovering')
    fire() // the automatic retry is queued…
    o.recovery.get(t1.id).episode.startedAt = old
    review = async () => '{"approved": true, "note": "ok"}'
    const reviews = reviewCalls
    assert.equal(await call('tasks:retryReview', t1.id), 'pending') // …and the user asks for it
    await until(() => tasksRepo.get(t1.id)!.status === 'done', 'reviewed')
    assert.equal(reviewCalls, reviews + 1)
  })

  await step('a used-up task stays used up after a restart; recovery off = the user decides at once', async () => {
    const used = (getDb().prepare("SELECT id FROM tasks WHERE title = 'never heals'").get() as { id: string }).id
    o.recovery.get(used).episode = null
    o.saveRecovery()
    orchestrator.shutdown()
    o.closing = false
    orchestrator.init()
    assert.equal(recState(used)!.attempts, 2)
    review = timeout
    assert.equal(await call('tasks:retryReview', used), 'queued')
    await until(() => !o.reviewing.has(used) && undecided(used), 'needs you again')
    assert.equal(captured.size, 0, 'no automatic retry left')
    assert.match(orchestrator.state().undecidedWhy[used], /retries for this task are used up \(2 of 2\)/)

    settingsRepo.update({ autoRecovery: false })
    const t2 = await reviewed('recovery off')
    await until(() => undecided(t2.id), 'needs you at once')
    assert.equal(captured.size, 0)
    settingsRepo.update({ autoRecovery: true })
    const card = thread(t2.id, p.id).filter((m) => m.meta?.card).at(-1)!.meta!.card as NeedsCard
    assert.equal(card.kind, 'undecided')
  })

  console.log(`reviewRecovery e2e: ${count} steps ok`)
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e)
    process.exit(1)
  }
)
