// Package 2: an honest Demo and an unblocked way to the first job. Templates set up from inside a project join that
// project only (from the organization nothing is touched); the Demo never calls a tool, splits a request only at real
// sentence ends, and its report, review and the task say it was a simulation. Real SQLite, orchestrator and IPC
// handlers; the real Demo provider (only wrapped to watch what it calls).
// Run: npm run test:e2e
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDb, openDb } from '../../src/main/db'
import { agentsRepo, messagesRepo, projectsRepo, providersRepo, runsRepo, settingsRepo, tasksRepo, unitsRepo } from '../../src/main/db/repos'
import { handlers } from '../../src/main/ipc'
import { orchestrator } from '../../src/main/core/orchestrator'
import { projectLead } from '../../src/main/core/org'
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
const until = async (cond: () => boolean, what: string, ms = 60_000): Promise<void> => {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
    await wait(20)
  }
}
const call = <T = any>(name: string, ...args: unknown[]): Promise<T> => Promise.resolve().then(() => (handlers as any)[name](...args))

// The real Demo provider, offered every kind of tool: it must call none and report no written file.
const demo = getAdapter('mock')
const realRun = demo.run.bind(demo)
let toolCalls: string[] = []
let filesWritten = 0
const OFFERED = ['connections_list', 'db_query', 'ssh_exec', 'files_list', 'file_read', 'file_save', 'skill_read', 'app_shop__orders'].map((name) => ({
  name,
  description: name === 'app_shop__orders' ? '[App: Shop] list orders' : name,
  inputSchema: { type: 'object', properties: {} }
}))
demo.run = (ctx: RunContext) =>
  realRun({
    ...ctx,
    tools: OFFERED,
    callTool: async (name) => {
      toolCalls.push(name)
      return { text: '[]', isError: false }
    },
    onFileWritten: () => {
      filesWritten++
    }
  })

async function main(): Promise<void> {
  openDb()
  settingsRepo.update({ onboarded: true, autopilot: false, reviewByLead: true, raceMode: false, language: 'en' })
  applyLanguageSetting('en')
  providersRepo.save({ kind: 'mock', label: 'Demo', model: '', isDefault: true } as never)
  orchestrator.init()
  const p1 = await call('projects:save', { name: 'Shop API', rootPath: mkdtempSync(join(tmpdir(), 'ab-f1-')) })
  const p2 = await call('projects:save', { name: 'Other', rootPath: mkdtempSync(join(tmpdir(), 'ab-f2-')) })
  const archived = await call('projects:save', { name: 'Old', rootPath: mkdtempSync(join(tmpdir(), 'ab-f3-')) })
  await call('projects:save', { status: 'archived' }, archived.id)

  await step('set up from inside a project: the team joins that project and its lead is ready', async () => {
    assert.equal(projectLead(p1.id), null, 'no lead before (the chat would be stuck)')
    const r = await call('templates:instantiate', 'core', { projectId: p1.id })
    assert.deepEqual(projectsRepo.get(p1.id)!.unitIds, [r.unitId])
    const lead = projectLead(p1.id)
    assert.ok(lead && r.agentIds.includes(lead.id), "the template's lead leads the project")
    assert.deepEqual(projectsRepo.get(p2.id)!.unitIds, [], 'another project is not touched')
  })

  await step('set up from the organization (or with the box unticked): no project is touched', async () => {
    const before = projectsRepo.list().map((p) => [p.id, p.unitIds.join()])
    const r = await call('templates:instantiate', 'core', {})
    assert.ok(unitsRepo.list().some((u) => u.id === r.unitId), 'the team exists')
    assert.deepEqual(projectsRepo.list().map((p) => [p.id, p.unitIds.join()]), before)
  })

  await step('a project that is gone or archived is refused before anything is created', async () => {
    const agents = agentsRepo.list().length
    const units = unitsRepo.list().length
    await assert.rejects(call('templates:instantiate', 'core', { projectId: 'nope' }), /Project not found/)
    await assert.rejects(call('templates:instantiate', 'core', { projectId: archived.id }), /Project not found/)
    assert.equal(agentsRepo.list().length, agents)
    assert.equal(unitsRepo.list().length, units)
  })

  await step('Demo lead: a one-sentence request with a file name, a version and a URL stays one task', async () => {
    const msg = 'Fix the rounding bug in utils/math.js for v2.1.3 as described at https://example.com/issues/12.html'
    await call('messages:send', 'general', msg, p1.id)
    await until(() => tasksRepo.listAll().some((t) => t.projectId === p1.id), 'the plan')
    const made = tasksRepo.listAll().filter((t) => t.projectId === p1.id)
    assert.equal(made.length, 1, made.map((t) => t.title).join(' | '))
    assert.match(made[0].title, /math\.js for v2\.1\.3/)
    const reply = messagesRepo.list('general', 20, p1.id).find((m) => m.senderType === 'agent')!
    assert.match(reply.content, /Demo \(simulation\)/)
    assert.match(reply.content, /my review is not a real check/)
    // Starting with a file name: one task, the name keeps its case.
    await call('messages:send', 'general', 'math.js rounds 0.5 the wrong way, fix it please', p1.id)
    await until(() => tasksRepo.listAll().filter((t) => t.projectId === p1.id).length === 2, 'the second plan')
    assert.ok(tasksRepo.listAll().some((t) => t.title === 'math.js rounds 0.5 the wrong way, fix it please'))
    tasksRepo.delete(tasksRepo.listAll().find((t) => t.title.startsWith('math.js'))!.id)
  })

  await step('a Demo run and review: no tool call, no written file, and every result says simulation', async () => {
    const task = tasksRepo.listAll().find((t) => t.projectId === p1.id)!
    tasksRepo.update(task.id, { title: 'Update the stock table in the orders database via the Shop app and save a summary file' })
    getDb().prepare('UPDATE agent_permissions SET require_approval = 0').run() // templates ask first; not what this checks
    toolCalls = []
    filesWritten = 0
    await call('tasks:start', task.id)
    await until(() => tasksRepo.get(task.id)!.status === 'done' || tasksRepo.get(task.id)!.status === 'todo', 'the review', 90_000)
    assert.deepEqual(toolCalls, [], 'the Demo called no tool')
    assert.equal(filesWritten, 0, 'no file reported as written')
    const run = runsRepo.list({ taskId: task.id })[0]
    assert.match(run.output!, /^> This is a simulation \(Demo provider\)\. No file was read or edited and no command or test ran/)
    assert.match(run.output!, /Example file names \(no file was edited\)/)
    assert.doesNotMatch(run.output!, /tests? (were run and )?passed|✓ \d+ tests? passed/i)
    const logs = getDb().prepare("SELECT level, message FROM agent_logs WHERE run_id = ? AND level IN ('tool','output')").all(run.id) as { level: string; message: string }[]
    const tools = logs.filter((l) => l.level === 'tool')
    assert.ok(tools.length > 0 && tools.every((l) => /^Simulation · .* \(not really run\)$/.test(l.message)), tools.map((l) => l.message).join(' | '))
    assert.ok(logs.some((l) => l.message === 'Simulation · no test result (no test ran)'))
    const verdict = messagesRepo.list(`task:${task.id}`, 50, p1.id).filter((m) => /Simulated review — nothing was really checked/.test(m.content))
    const note = tasksRepo.get(task.id)!.reviewNote ?? ''
    assert.ok(verdict.length > 0 || /^Simulated review/.test(note), 'the lead verdict says simulation')
    assert.ok(orchestrator.state().simulatedWork.includes(task.id), 'the card and the task details can say simulation')
    assert.ok(orchestrator.state().simulatedReview.includes(task.id))
    // The finish and the verdict went to #general and to the thread as one event each (the live feed shows them once).
    const ev = (m: { meta: Record<string, unknown> | null }): string | null => (typeof m.meta?.event === 'string' ? m.meta.event : null)
    const threadEvents = messagesRepo.list(`task:${task.id}`, 50, p1.id).map(ev).filter((x): x is string => !!x)
    const generalEvents = messagesRepo.list('general', 200, p1.id).map(ev).filter((x): x is string => !!x)
    assert.ok(threadEvents.length >= 2, `finish + verdict carry an event id (${threadEvents.length})`)
    for (const e of threadEvents) assert.equal(generalEvents.filter((x) => x === e).length, 1, 'each has one #general copy')
    assert.equal(new Set(threadEvents).size, threadEvents.length, 'a different event id per event')
  })

  await step('short work orders through the real Demo lead become tasks; small talk and questions do not', async () => {
    const before = (): number => tasksRepo.listAll().filter((t) => t.projectId === p2.id).length
    await call('templates:instantiate', 'core', { projectId: p2.id })
    getDb().prepare('UPDATE agent_permissions SET require_approval = 0').run()
    for (const msg of ["math.js'i düzelt", 'Hatayı düzelt', 'Fix math.js']) {
      const n = before()
      await call('messages:send', 'general', msg, p2.id)
      await until(() => before() === n + 1, `a task for "${msg}"`)
      assert.ok(tasksRepo.listAll().some((t) => t.projectId === p2.id && t.title.toLowerCase() === msg.toLowerCase()), msg)
    }
    for (const msg of ['Merhaba', 'Thanks!', 'What is left on the board?']) {
      const n = before()
      const replies = messagesRepo.list('general', 200, p2.id).filter((m) => m.senderType === 'agent').length
      await call('messages:send', 'general', msg, p2.id)
      await until(() => messagesRepo.list('general', 200, p2.id).filter((m) => m.senderType === 'agent').length === replies + 1, `the reply to "${msg}"`)
      assert.equal(before(), n, `no task for "${msg}"`)
    }
    for (const t of tasksRepo.listAll().filter((x) => x.projectId === p2.id)) tasksRepo.delete(t.id)
  })

  await step('labels follow who did what: real / Demo worker × real / Demo lead', async () => {
    // A "real" provider: the Anthropic kind with its adapter stubbed (no network); usage is recorded as anthropic.
    const real = providersRepo.save({ kind: 'anthropic', label: 'Real', model: 'm', apiKey: 'sk-ant-test-0000000000000000000000' } as never)
    const mockP = providersRepo.list().find((p) => p.kind === 'mock')!
    getAdapter('anthropic').run = async (ctx: RunContext) => {
      ctx.onUsage?.({ input: 10, output: 10, cacheRead: 0, cacheWrite: 0, costUsd: 0.001 })
      const text = ctx.mode === 'review' ? '{"approved": true, "note": "checked the diff"}' : 'Changed src/a.ts; tests pass.'
      return { text, tokensIn: 10, tokensOut: 10, costUsd: 0.001 }
    }
    const lead = projectLead(p2.id)!
    const unit = unitsRepo.list().find((u) => u.id === projectsRepo.get(p2.id)!.unitIds[0])!
    const dev = agentsRepo.get(unit.members.map((m) => m.agentId).find((id) => id !== lead.id)!)!
    const setProvider = (agentId: string, providerId: string): void => void getDb().prepare('UPDATE agents SET provider_id = ? WHERE id = ?').run(providerId, agentId)
    const cases: [string, string, boolean, boolean][] = [
      ['real worker, real lead', real.id + '|' + real.id, false, false],
      ['real worker, Demo lead', real.id + '|' + mockP.id, false, true],
      ['Demo worker, real lead', mockP.id + '|' + real.id, true, false],
      ['Demo worker, Demo lead', mockP.id + '|' + mockP.id, true, true]
    ]
    for (const [name, pair, work, review] of cases) {
      const [w, l] = pair.split('|')
      setProvider(dev.id, w)
      setProvider(lead.id, l)
      agentsRepo.setStatus(dev.id, 'idle')
      const t = tasksRepo.create({ title: `combo: ${name}`, projectId: p2.id, assigneeId: dev.id })
      await call('tasks:start', t.id)
      await until(() => tasksRepo.get(t.id)!.status === 'done' || !!tasksRepo.get(t.id)!.reviewNote, `the review (${name})`, 90_000)
      const s = orchestrator.state()
      assert.equal(s.simulatedWork.includes(t.id), work, `${name}: work label`)
      assert.equal(s.simulatedReview.includes(t.id), review, `${name}: review label`)
    }
    setProvider(dev.id, mockP.id)
    setProvider(lead.id, mockP.id)
  })

  orchestrator.shutdown()
  console.log(`firstRun e2e: ${count} steps ok`)
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e)
    process.exit(1)
  }
)
