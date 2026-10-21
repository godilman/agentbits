// Worker recovery (ADR-037): a worker run that failed for a passing reason is run again on its own only when it is
// known to have changed nothing outside — its tools all went through Agentbits (counted before each runs), it called
// none but Agentbits' own reads, saved no file, touched no connection, and the failure was in the provider call. Same
// budget as the review recovery (2 per task, kept across restarts); checked again right before the provider call (and
// after an approval); counted only when the provider attempt begins; a run that began before a quit isn't repeated.
// Real SQLite, real orchestrator; the provider is a stub; long timers are captured and fired by the test.
// Run: npm run test:e2e
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDb, openDb } from '../../src/main/db'
import { filesRepo } from '../../src/main/files/repo'
import { agentsRepo, messagesRepo, settingsRepo, tasksRepo } from '../../src/main/db/repos'
import { handlers } from '../../src/main/ipc'
import { orchestrator } from '../../src/main/core/orchestrator'
import { projectLead, projectMembers } from '../../src/main/core/org'
import { getAdapter } from '../../src/main/providers'
import { applyLanguageSetting } from '../../src/main/i18n'
import type { Message } from '../../src/shared/types'
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
const fire = (): void => {
  const fns = [...captured.values()]
  captured.clear()
  for (const f of fns) f()
}

const NET = 'TypeError: fetch failed'
let workCalls = 0
/** The worker's provider: what it does in a task run (tools through ctx.callTool, then an answer or an error). */
let work: (ctx: RunContext) => Promise<string> = async () => 'report: done'
const ok = async (): Promise<string> => 'report: done'
const netFail = async (): Promise<string> => {
  throw new Error(NET)
}
getAdapter('mock').run = async (ctx: RunContext) => {
  if (ctx.mode === 'review') return { text: '{"approved": true, "note": "ok"}', tokensIn: 1, tokensOut: 1, costUsd: 0 }
  if (ctx.mode === 'chat') return { text: 'Ok.', tokensIn: 1, tokensOut: 1, costUsd: 0 }
  workCalls++
  return { text: await work(ctx), tokensIn: 1, tokensOut: 1, costUsd: 0 }
}

const thread = (id: string, pid: string): Message[] => messagesRepo.list(`task:${id}`, 200, pid)
const general = (pid: string): Message[] => messagesRepo.list('general', 400, pid)
const recovering = (id: string) => orchestrator.state().recovering[id] ?? null
const heldWhy = (id: string): string | null => orchestrator.state().held.find((h) => h.taskId === id)?.reason ?? null
const recState = (id: string) => o.recovery.get(id) as { attempts: number; episode: any } | undefined
const runsOf = (id: string) => getDb().prepare('SELECT id, status FROM runs WHERE task_id = ? ORDER BY rowid').all(id) as { id: string; status: string }[]
const idle = (id: string): boolean => !o.active.size && tasksRepo.get(id)!.status !== 'in_progress'

async function main(): Promise<void> {
  openDb()
  const tpl = await call('templates:instantiate', 'ecommerce')
  const p = await call('projects:save', { name: 'P', rootPath: mkdtempSync(join(tmpdir(), 'ab-wr-')), unitIds: [tpl.unitId] })
  settingsRepo.update({ onboarded: true, autopilot: false, reviewByLead: false, raceMode: false, language: 'en', autoRecovery: true, runMaxMinutes: 0 })
  getDb().prepare('UPDATE agent_permissions SET require_approval = 0').run()
  applyLanguageSetting('en')
  orchestrator.init()
  orchestrator.startProjectWork(p.id)
  const lead = projectLead(p.id)!
  const [dev, dev2] = projectMembers(p.id).filter((a) => !a.isLead && a.id !== lead.id)
  /** A task whose first run fails as `work` says; waits until it either recovers or is held. */
  const failed = async (title: string, run: (ctx: RunContext) => Promise<string> = netFail, assignee = dev.id) => {
    work = run
    const t1 = tasksRepo.create({ title, projectId: p.id, assigneeId: assignee })
    agentsRepo.setStatus(assignee, 'idle')
    await call('tasks:start', t1.id)
    await until(() => idle(t1.id) && (!!recovering(t1.id) || heldWhy(t1.id) !== null), 'recovering or held')
    return t1
  }

  await step('a passing failure of a run that called no tool: no card; the worker runs again later (one timer); counted when it starts', async () => {
    const t1 = await failed('heals')
    const r = recovering(t1.id)!
    assert.equal(r.kind, 'work')
    assert.equal(r.attempt, 1)
    assert.match(r.reason!, /provider call couldn't finish \(Demo \(simulation\): no network connection\)/)
    assert.ok(r.at && Date.parse(r.at) - Date.now() > 50_000)
    assert.equal(heldWhy(t1.id), null, 'not "needs you"')
    assert.equal(captured.size, 1, 'one timer')
    assert.equal(recState(t1.id)!.attempts, 0, 'nothing counted before the retry starts')
    assert.match(general(p.id).at(-1)!.content, /changed nothing outside[\s\S]*will run the work again on its own in 1 min \(extra attempt 1 of 2\)[\s\S]*You can cancel the task/)
    // Autopilot doesn't take it meanwhile: only the recovery's timer starts it.
    settingsRepo.update({ autopilot: true })
    o.tick()
    await wait(80)
    settingsRepo.update({ autopilot: false })
    assert.equal(runsOf(t1.id).length, 1, 'autopilot left it alone')
    work = ok
    const calls = workCalls
    fire()
    await until(() => tasksRepo.get(t1.id)!.status === 'in_review', 'ran again')
    assert.equal(workCalls, calls + 1)
    assert.equal(recState(t1.id)!.attempts, 1)
    assert.equal(recovering(t1.id), null)
  })

  await step('only Agentbits\' own reads keep it retryable; any other tool (or an unknown one), even without a result, stops it', async () => {
    const reads = await failed('reads only', async (ctx) => {
      await ctx.callTool!('team_status', {})
      throw new Error(NET)
    })
    assert.ok(recovering(reads.id), 'a read of Agentbits\' own data is no side effect')
    await call('tasks:cancel', reads.id)

    for (const [title, tool] of [
      ['saved a file', 'file_save'],
      ['ran a query', 'db_query'],
      ['an unknown tool', 'brand_new_tool']
    ]) {
      const t1 = await failed(title, async (ctx) => {
        void ctx.callTool!(tool, { name: 'x.md', content: 'x' }).catch(() => undefined) // its result never awaited
        throw new Error(NET)
      })
      assert.equal(recovering(t1.id), null, title)
      assert.match(heldWhy(t1.id)!, new RegExp(`wasn't run again automatically: the run called these tools: ${tool}`))
      const card = thread(t1.id, p.id).filter((m) => m.meta?.card).at(-1)!
      assert.match(card.content, new RegExp(tool))
    }
    // file_save's text extraction runs on with a 2-minute timeout timer (captured here too); it is cleared when it ends.
    await until(() => !filesRepo.stuck().length, 'the saved file\'s extraction finished')
    assert.equal(captured.size, 0)
  })

  await step('no tool record, a failure outside the provider call, or a CLI provider: never taken as "nothing happened"', () => {
    const run = runsOf((getDb().prepare("SELECT id FROM tasks WHERE title = 'heals'").get() as { id: string }).id)[0].id
    const ar = { tools: [] as string[] | null, callFailed: true }
    assert.equal(o.sideEffects(run, 'anthropic', ar), '')
    assert.match(o.sideEffects(run, 'claude-cli', ar), /Claude Code \/ Codex/)
    assert.match(o.sideEffects(run, 'codex-cli', ar), /Claude Code \/ Codex/)
    assert.match(o.sideEffects(run, 'openai', { ...ar, tools: null }), /no record of its tools/)
    assert.match(o.sideEffects(run, 'openai', { ...ar, callFailed: false }), /preparing or finishing/)
    // Second layer: the run's own records (a connection operation logged for it).
    getDb().prepare("INSERT INTO audit_log (actor_type, run_id, action, result) VALUES ('agent', ?, 'query', 'denied')").run(run)
    assert.match(o.sideEffects(run, 'openai', ar), /connection or app operation/)
  })

  await step('a lasting failure, or a run stopped by its own time limit: the user decides at once', async () => {
    const t1 = await failed('lasting', async () => {
      throw new Error('Unexpected token < in JSON')
    })
    assert.equal(recovering(t1.id), null)
    assert.ok(heldWhy(t1.id))

    settingsRepo.update({ runMaxMinutes: 1 })
    work = (ctx) => new Promise((_, rej) => ctx.signal.addEventListener('abort', () => rej(new Error('The operation was aborted due to timeout'))))
    const t2 = tasksRepo.create({ title: 'limit', projectId: p.id, assigneeId: dev.id })
    agentsRepo.setStatus(dev.id, 'idle')
    await call('tasks:start', t2.id)
    await until(() => captured.size === 1, 'its time limit armed')
    fire()
    await until(() => idle(t2.id) && heldWhy(t2.id) !== null, 'held')
    assert.equal(recovering(t2.id), null, 'its own limit is not a passing failure')
    settingsRepo.update({ runMaxMinutes: 0 })
    assert.equal(captured.size, 0)

    // The retry run has the same limits as any run (not more), and a retry stopped by one is not tried again.
    const t3 = await failed('retry hits its limit')
    settingsRepo.update({ runMaxMinutes: 1 })
    work = (ctx) => new Promise((_, rej) => ctx.signal.addEventListener('abort', () => rej(new Error('The operation was aborted due to timeout'))))
    fire()
    await until(() => captured.size === 1 && tasksRepo.get(t3.id)!.status === 'in_progress', 'the retry runs with its 1-minute limit')
    fire()
    await until(() => idle(t3.id) && heldWhy(t3.id) !== null, 'held')
    settingsRepo.update({ runMaxMinutes: 0 })
    assert.equal(recovering(t3.id), null)
    assert.equal(recState(t3.id)!.attempts, 1)
    assert.match(heldWhy(t3.id)!, /1 min/)
    assert.equal(captured.size, 0)
  })

  await step('fails again: a second try; after both, the user decides, told what was tried; the budget is shared with the review', async () => {
    const t1 = await failed('keeps failing')
    fire()
    await until(() => idle(t1.id) && recovering(t1.id)?.attempt === 2, 'second try planned')
    assert.equal(recState(t1.id)!.attempts, 1)
    assert.match(general(p.id).at(-1)!.content, /in 5 min \(extra attempt 2 of 2\)/)
    fire()
    await until(() => idle(t1.id) && heldWhy(t1.id) !== null, 'held')
    assert.equal(recState(t1.id)!.attempts, 2)
    assert.equal(captured.size, 0)
    assert.match(thread(t1.id, p.id).filter((m) => m.meta?.card).at(-1)!.content, /ran the worker 2 more times over \d+ min; it didn't work/)

    // Shared: one worker retry, then the review's recovery has one left (not two).
    settingsRepo.update({ reviewByLead: true })
    const t2 = await failed('shared budget')
    work = ok
    const reviewRun = getAdapter('mock').run
    getAdapter('mock').run = async (ctx: RunContext) => {
      if (ctx.mode === 'review') throw new Error('The operation was aborted due to timeout')
      return reviewRun(ctx)
    }
    try {
      fire()
      await until(() => recovering(t2.id)?.kind === 'retry', 'the review recovers')
      assert.equal(recState(t2.id)!.attempts, 1)
      assert.equal(recovering(t2.id)!.attempt, 2, 'its last extra try')
      fire()
      await until(() => orchestrator.state().undecided.includes(t2.id), 'the user decides')
      assert.equal(recState(t2.id)!.attempts, 2)
      assert.equal(captured.size, 0, 'no third try')
    } finally {
      getAdapter('mock').run = reviewRun
      settingsRepo.update({ reviewByLead: false })
    }
  })

  await step('while it waits: inputs, dependencies, assignee, setting, provider, pause or the window change → no run, the card says why', async () => {
    const cases: [string, (id: string) => Promise<void> | void, RegExp][] = [
      ['description', (id) => void tasksRepo.update(id, { description: 'something else now' }), /title, description, acceptance criteria, dependencies or assigned worker changed/],
      ['acceptance', (id) => void tasksRepo.update(id, { acceptance: '- new criterion' }), /acceptance criteria/],
      ['assignee', (id) => void tasksRepo.update(id, { assigneeId: dev2.id }), /assigned worker changed/],
      [
        'dependency',
        (id) => {
          const dep = tasksRepo.create({ title: 'dep', projectId: p.id })
          getDb().prepare('UPDATE tasks SET depends_on = ? WHERE id = ?').run(JSON.stringify([dep.id]), id)
        },
        /dependencies/
      ],
      ['provider', () => void (o.providerFor = cliFor(dev.id)), /Claude Code \/ Codex/],
      ['window', (id) => void (recState(id)!.episode.startedAt = Date.now() - 31 * 60_000), /30 minutes are up/],
      ['agent off', () => void getDb().prepare('UPDATE agents SET enabled = 0 WHERE id = ?').run(dev.id), /turned off or gone/]
    ]
    const providerFor = o.providerFor.bind(o)
    const cliFor = (id: string) => (agent: { id: string }) => {
      const r = providerFor(agent)
      return agent.id === id ? { ...r, provider: { ...r.provider, kind: 'claude-cli' } } : r
    }
    for (const [name, change, why] of cases) {
      const t1 = await failed(`changed: ${name}`)
      await change(t1.id)
      const calls = workCalls
      fire()
      await until(() => heldWhy(t1.id) !== null, `held (${name})`)
      o.providerFor = providerFor
      getDb().prepare('UPDATE agents SET enabled = 1 WHERE id = ?').run(dev.id)
      assert.equal(workCalls, calls, `no run (${name})`)
      assert.equal(runsOf(t1.id).length, 1, `no run record (${name})`)
      assert.match(heldWhy(t1.id)!, why, name)
      assert.match(heldWhy(t1.id)!, /wasn't run again automatically/)
      assert.equal(recState(t1.id)!.attempts, 0, `not counted (${name})`)
      assert.equal(recovering(t1.id), null)
    }

    const off = await failed('setting off')
    await call('settings:update', { autoRecovery: false })
    assert.equal(captured.size, 0)
    assert.match(heldWhy(off.id)!, /turned off in Settings/)
    settingsRepo.update({ autoRecovery: true })

    const paused = await failed('paused')
    orchestrator.pauseAll()
    assert.match(heldWhy(paused.id)!, /paused everything/)
    orchestrator.resumeAll()
    assert.equal(captured.size, 0)
  })

  await step('an input changed while the failing run ran: the old work is not planned again', async () => {
    const t1 = await failed('edited during the run', async () => {
      tasksRepo.update(tasksRepo.listAll().find((x) => x.title === 'edited during the run')!.id, { description: 'changed while it ran' })
      throw new Error(NET)
    })
    assert.equal(recovering(t1.id), null)
    assert.match(heldWhy(t1.id)!, /wasn't run again automatically: the task's title, description/)
    assert.equal(captured.size, 0)
  })

  await step('an input changed and the drawer looks: it stops at once (not only when the timer fires)', async () => {
    const t1 = await failed('edited early')
    tasksRepo.update(t1.id, { title: 'edited early (renamed)' })
    orchestrator.state()
    assert.match(heldWhy(t1.id)!, /changed/)
    assert.equal(captured.size, 0)
  })

  await step('an agent needing approval asks again (an automatic retry, why the last stopped, what starts); counted only once it runs', async () => {
    getDb().prepare('UPDATE agent_permissions SET require_approval = 1 WHERE agent_id = ?').run(dev2.id)
    try {
      const approve = async (taskId: string, yes = true): Promise<void> => {
        await until(() => runsOf(taskId).at(-1)?.status === 'awaiting_approval', 'asks for approval')
        await call('runs:approve', runsOf(taskId).at(-1)!.id, yes)
      }
      work = netFail
      const t1 = tasksRepo.create({ title: 'needs approval', projectId: p.id, assigneeId: dev2.id })
      agentsRepo.setStatus(dev2.id, 'idle')
      await call('tasks:start', t1.id)
      await approve(t1.id)
      await until(() => idle(t1.id) && !!recovering(t1.id), 'recovering')
      fire()
      await until(() => runsOf(t1.id).at(-1)?.status === 'awaiting_approval', 'asks again')
      const card = thread(t1.id, p.id).filter((m) => m.meta?.card).at(-1)!
      assert.match(card.content, /waiting for your approval for an automatic retry \(extra attempt 1 of 2\)\. The last try stopped because: The worker's provider call couldn't finish[\s\S]*changed nothing outside[\s\S]*runs the work again from the start[\s\S]*An earlier approval doesn't count/)
      assert.equal(recState(t1.id)!.attempts, 0, 'asking is not trying')
      // The timer firing again, or another start, doesn't start a second run.
      o.workDue(t1.id)
      await call('tasks:start', t1.id)
      await wait(50)
      assert.equal(runsOf(t1.id).length, 2)
      work = ok
      const calls = workCalls
      await approve(t1.id)
      await until(() => tasksRepo.get(t1.id)!.status === 'in_review', 'ran')
      assert.equal(workCalls, calls + 1)
      assert.equal(recState(t1.id)!.attempts, 1)

      // Conditions changed during the approval wait: checked again after the yes — no call, not counted.
      work = netFail
      const id2 = tasksRepo.create({ title: 'changed during approval', projectId: p.id, assigneeId: dev2.id }).id
      agentsRepo.setStatus(dev2.id, 'idle')
      await call('tasks:start', id2)
      await approve(id2)
      await until(() => idle(id2) && !!recovering(id2), 'recovering')
      fire()
      await until(() => runsOf(id2).at(-1)?.status === 'awaiting_approval', 'asks again')
      settingsRepo.update({ autoRecovery: false }) // straight to the store: the check after the approval must catch it
      const before = workCalls
      await approve(id2)
      await until(() => idle(id2) && heldWhy(id2) !== null, 'held')
      settingsRepo.update({ autoRecovery: true })
      assert.equal(workCalls, before, 'no provider call')
      assert.equal(recState(id2)!.attempts, 0, 'not counted')
      assert.match(heldWhy(id2)!, /wasn't run again automatically: automatic recovery was turned off in Settings/)

      // Rejected: no run, not counted, the recovery ends.
      const t3 = tasksRepo.create({ title: 'rejected retry', projectId: p.id, assigneeId: dev2.id })
      work = netFail
      agentsRepo.setStatus(dev2.id, 'idle')
      await call('tasks:start', t3.id)
      await approve(t3.id)
      await until(() => idle(t3.id) && !!recovering(t3.id), 'recovering')
      fire()
      await approve(t3.id, false)
      await until(() => idle(t3.id) && heldWhy(t3.id) !== null, 'held')
      assert.equal(recovering(t3.id), null)
      assert.equal(recState(t3.id)!.attempts, 0)
      assert.equal(captured.size, 0)
    } finally {
      getDb().prepare('UPDATE agent_permissions SET require_approval = 0').run()
    }
  })

  await step("the user's own start is separate (not counted, no recovery check) but keeps the cancel and dependency checks", async () => {
    const t1 = await failed('own start')
    settingsRepo.update({ autoRecovery: false })
    work = ok
    await call('tasks:start', t1.id)
    await until(() => tasksRepo.get(t1.id)!.status === 'in_review', 'ran')
    settingsRepo.update({ autoRecovery: true })
    assert.equal(recState(t1.id)?.attempts ?? 0, 0)
    assert.equal(captured.size, 0, 'the automatic one is dropped')

    const dep = tasksRepo.create({ title: 'open dependency', projectId: p.id })
    const t2 = await failed('own start, waiting for a dependency')
    getDb().prepare('UPDATE tasks SET depends_on = ? WHERE id = ?').run(JSON.stringify([dep.id]), t2.id) // a stale plan (no basis check here)
    await call('tasks:start', t2.id)
    await wait(50)
    assert.equal(runsOf(t2.id).length, 1, "the user's start still waits for the dependency")
    await call('tasks:cancel', t2.id)
    await call('tasks:start', t2.id)
    await wait(50)
    assert.equal(runsOf(t2.id).length, 1, 'nor starts a cancelled task')
  })

  await step('cancelled while it waits or while its approval is asked: a late timer starts nothing', async () => {
    const t1 = await failed('cancel waiting')
    await call('tasks:cancel', t1.id)
    assert.equal(recovering(t1.id), null)
    const calls = workCalls
    fire()
    o.workDue(t1.id)
    await wait(50)
    assert.equal(workCalls, calls)
    assert.equal(runsOf(t1.id).length, 1)

    getDb().prepare('UPDATE agent_permissions SET require_approval = 1 WHERE agent_id = ?').run(dev2.id)
    try {
      work = netFail
      const t2 = tasksRepo.create({ title: 'cancel during approval', projectId: p.id, assigneeId: dev2.id })
      agentsRepo.setStatus(dev2.id, 'idle')
      await call('tasks:start', t2.id)
      await until(() => runsOf(t2.id).at(-1)?.status === 'awaiting_approval', 'asks')
      await call('runs:approve', runsOf(t2.id).at(-1)!.id, true)
      await until(() => idle(t2.id) && !!recovering(t2.id), 'recovering')
      fire()
      await until(() => runsOf(t2.id).at(-1)?.status === 'awaiting_approval', 'asks again')
      const before = workCalls
      await call('tasks:cancel', t2.id)
      await until(() => runsOf(t2.id).at(-1)?.status === 'cancelled', 'its run ends')
      fire()
      await wait(50)
      assert.equal(workCalls, before, 'no provider call')
      assert.equal(recovering(t2.id), null)
      assert.equal(recState(t2.id)!.attempts, 0)
    } finally {
      getDb().prepare('UPDATE agent_permissions SET require_approval = 0').run()
    }
  })

  const restart = (): void => {
    for (const h of [...captured.keys()]) captured.delete(h)
    orchestrator.shutdown()
    o.approvals.clear() // the process is gone: nobody answers an old approval, no agent is busy
    o.busy.clear()
    o.closing = false
    o.workStarted.clear()
    orchestrator.init()
  }

  await step('closed while it waited in the queue: kept, nothing starts on open, it goes on once the work is started', async () => {
    const t1 = await failed('queued at close')
    restart()
    assert.ok(recovering(t1.id), 'still recovering')
    assert.equal(recovering(t1.id)!.waitsForStart, true)
    assert.equal(captured.size, 0, 'opening starts nothing')
    assert.equal(heldWhy(t1.id), null)
    orchestrator.startProjectWork(p.id)
    assert.equal(captured.size, 1)
    work = ok
    fire()
    await until(() => tasksRepo.get(t1.id)!.status === 'in_review', 'ran')
    assert.equal(recState(t1.id)!.attempts, 1)
  })

  await step('closed while its approval was asked: not counted; on start it asks again (a new run, a new approval)', async () => {
    getDb().prepare('UPDATE agent_permissions SET require_approval = 1 WHERE agent_id = ?').run(dev2.id)
    try {
      work = netFail
      const t1 = tasksRepo.create({ title: 'approval at close', projectId: p.id, assigneeId: dev2.id })
      agentsRepo.setStatus(dev2.id, 'idle')
      await call('tasks:start', t1.id)
      await until(() => runsOf(t1.id).at(-1)?.status === 'awaiting_approval', 'asks')
      await call('runs:approve', runsOf(t1.id).at(-1)!.id, true)
      await until(() => idle(t1.id) && !!recovering(t1.id), 'recovering')
      fire()
      await until(() => runsOf(t1.id).at(-1)?.status === 'awaiting_approval', 'asks again')
      restart()
      assert.equal(tasksRepo.get(t1.id)!.status, 'todo')
      assert.equal(heldWhy(t1.id), null, 'not "interrupted": it never reached the provider')
      assert.ok(recovering(t1.id))
      assert.equal(recState(t1.id)!.attempts, 0)
      orchestrator.startProjectWork(p.id)
      fire()
      await until(() => runsOf(t1.id).at(-1)?.status === 'awaiting_approval' && runsOf(t1.id).length === 3, 'a new approval')
      work = ok
      await call('runs:approve', runsOf(t1.id).at(-1)!.id, true)
      await until(() => tasksRepo.get(t1.id)!.status === 'in_review', 'ran')
      assert.equal(recState(t1.id)!.attempts, 1)
    } finally {
      getDb().prepare('UPDATE agent_permissions SET require_approval = 0').run()
    }
  })

  await step('closed after its provider call began: counted, and never run again on its own (it may have done part of its work)', async () => {
    const t1 = await failed('call began at close')
    work = (ctx) => new Promise((_, rej) => ctx.signal.addEventListener('abort', () => rej(new Error('aborted'))))
    fire()
    await until(() => recState(t1.id)?.attempts === 1 && tasksRepo.get(t1.id)!.status === 'in_progress', 'its call began')
    orchestrator.shutdown()
    await until(() => !o.active.size, 'the run ended')
    o.approvals.clear()
    o.closing = false
    o.workStarted.clear()
    orchestrator.init()
    assert.equal(recovering(t1.id), null)
    assert.equal(recState(t1.id)!.attempts, 1, 'the begun attempt stays counted')
    orchestrator.startProjectWork(p.id)
    await wait(80)
    assert.equal(captured.size, 0)
    assert.equal(runsOf(t1.id).length, 2, 'not run again')
    assert.ok(heldWhy(t1.id) !== null, 'it waits for the user')
  })

  console.log(`workRecovery e2e: ${count} steps ok`)
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e)
    process.exit(1)
  }
)
