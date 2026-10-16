// Task runs end to end: stop during preparation, start rules, moving a running task, race dependencies, worktree
// clean-up and the semantic memory index. Real SQLite, real orchestrator, real git; the provider is a stub.
// Run: npm run test:e2e
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDb, openDb } from '../../src/main/db'
import { agentsRepo, memoriesRepo, providersRepo, runsRepo, settingsRepo, tasksRepo } from '../../src/main/db/repos'
import { handlers } from '../../src/main/ipc'
import { orchestrator } from '../../src/main/core/orchestrator'
import { memoryEngine } from '../../src/main/core/memory'
import { clearProject } from '../../src/main/core/maintenance'
import { scheduleIndex } from '../../src/main/core/embeddings'
import { projectMembers } from '../../src/main/core/org'
import { getAdapter } from '../../src/main/providers'
import type { RunContext } from '../../src/main/providers/types'
import { fromBlob } from '../../src/shared/vectors'

let count = 0
const step = async (name: string, fn: () => Promise<void> | void): Promise<void> => {
  await fn()
  count++
  console.log(`  ✓ ${name}`)
}
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const until = async (cond: () => boolean, what: string, ms = 5000): Promise<void> => {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
    await wait(10)
  }
}
const call = <T = any>(name: string, ...args: unknown[]): T => (handlers as any)[name](...args)
const o = orchestrator as any

// The provider: counts its calls; `hang` makes it run until stopped.
const adapter = getAdapter('mock')
let calls = 0
let hang = false
adapter.run = async (ctx: RunContext) => {
  calls++
  if (hang) await new Promise<void>((_, reject) => ctx.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
  return { text: 'done', tokensIn: 1, tokensOut: 1, costUsd: 0 }
}
// Preparation hook: memory recall is the first awaited step every run takes.
const recall = memoryEngine.context.bind(memoryEngine)
let beforeRecall: (() => Promise<void>) | null = null
memoryEngine.context = (async (...a: Parameters<typeof recall>) => {
  if (beforeRecall) await beforeRecall()
  return recall(...a)
}) as typeof memoryEngine.context

// Git without the user's global config (signing, hooks, identity): every repo here is a throwaway.
const gitCfg = join(mkdtempSync(join(tmpdir(), 'ab-git-')), 'gitconfig')
writeFileSync(gitCfg, '[user]\n\tname = Test\n\temail = test@example.com\n[commit]\n\tgpgsign = false\n[init]\n\tdefaultBranch = main\n')
process.env.GIT_CONFIG_GLOBAL = gitCfg
process.env.GIT_CONFIG_NOSYSTEM = '1'
const sh = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

async function main(): Promise<void> {
  openDb()
  const tpl = call('templates:instantiate', 'ecommerce')
  const project = call('projects:save', { name: 'P', rootPath: mkdtempSync(join(tmpdir(), 'ab-proj-')), unitIds: [tpl.unitId] })
  settingsRepo.update({ onboarded: true, autopilot: false, reviewByLead: false, raceMode: false })
  getDb().prepare('UPDATE agent_permissions SET require_approval = 0').run()
  orchestrator.init()
  const workers = projectMembers(project.id).filter((a) => !a.isLead)
  const dev = workers[0]
  const task = (title: string, extra: Record<string, unknown> = {}) => tasksRepo.create({ title, projectId: project.id, assigneeId: dev.id, ...extra })
  const runsOf = (taskId: string) => runsRepo.list({ taskId })

  await step('stopped while preparing: the provider is never called', async () => {
    const t1 = task('stop while preparing')
    let release!: () => void
    let entered = false
    beforeRecall = () => ((entered = true), new Promise<void>((r) => (release = r)))
    calls = 0
    const started = orchestrator.startTask(t1.id)
    await until(() => entered, 'preparation')
    orchestrator.stopTask(t1.id)
    beforeRecall = null
    release()
    await started
    assert.equal(calls, 0)
    assert.equal(runsOf(t1.id)[0].status, 'cancelled')
    assert.equal(tasksRepo.get(t1.id)!.status, 'todo')
  })

  await step('a preparation step that throws ends the run: not left active, the agent is free', async () => {
    const t2 = task('preparation fails')
    beforeRecall = async () => {
      throw new Error('recall exploded')
    }
    await orchestrator.startTask(t2.id)
    beforeRecall = null
    assert.equal(o.active.size, 0)
    assert.equal(o.busy.has(dev.id), false)
    assert.equal(runsOf(t2.id)[0].status, 'failed')
    assert.equal(tasksRepo.get(t2.id)!.status, 'todo')
    agentsRepo.setStatus(dev.id, 'idle')
  })

  await step('a turned-off agent gets no task, also when it was turned off while its run waited for approval', async () => {
    const t3 = task('agent off')
    getDb().prepare('UPDATE agents SET enabled = 0 WHERE id = ?').run(dev.id)
    calls = 0
    await orchestrator.startTask(t3.id)
    assert.equal(runsOf(t3.id).length, 0)
    getDb().prepare('UPDATE agents SET enabled = 1 WHERE id = ?').run(dev.id)
    getDb().prepare('UPDATE agent_permissions SET require_approval = 1 WHERE agent_id = ?').run(dev.id)
    const started = orchestrator.startTask(t3.id)
    await until(() => runsOf(t3.id)[0]?.status === 'awaiting_approval', 'approval')
    getDb().prepare('UPDATE agents SET enabled = 0 WHERE id = ?').run(dev.id)
    orchestrator.approve(runsOf(t3.id)[0].id, true)
    await started
    assert.equal(calls, 0)
    assert.equal(runsOf(t3.id)[0].status, 'cancelled')
    getDb().prepare('UPDATE agents SET enabled = 1 WHERE id = ?').run(dev.id)
    getDb().prepare('UPDATE agent_permissions SET require_approval = 0 WHERE agent_id = ?').run(dev.id)
    orchestrator.release(t3.id)
    agentsRepo.setStatus(dev.id, 'idle')
  })

  await step('a task waiting for an unfinished one starts only when the user says "start anyway"', async () => {
    const first = task('first step')
    const next = task('next step', { dependsOn: [first.id] })
    assert.deepEqual(call('tasks:waitingFor', next.id), [first.key])
    calls = 0
    await orchestrator.startTask(next.id)
    assert.equal(runsOf(next.id).length, 0)
    await call('tasks:move', next.id, 'in_progress')
    await wait(50)
    assert.equal(runsOf(next.id).length, 0)
    assert.equal(tasksRepo.get(next.id)!.status, 'todo')
    await orchestrator.startTask(next.id, undefined, { force: true })
    assert.equal(calls, 1)
    assert.equal(tasksRepo.get(next.id)!.status, 'in_review')
    agentsRepo.setStatus(dev.id, 'idle')
  })

  await step('a running task dragged to Done stays Done (the stop finishes first)', async () => {
    const t4 = task('drag to done')
    hang = true
    const started = orchestrator.startTask(t4.id)
    await until(() => calls > 0 && o.active.size === 1, 'running')
    await call('tasks:move', t4.id, 'done')
    await started
    hang = false
    assert.equal(o.active.size, 0)
    assert.equal(tasksRepo.get(t4.id)!.status, 'done')
    agentsRepo.setStatus(dev.id, 'idle')
  })

  await step('race: while the winner is back in To do (merge conflict), tasks waiting for the original wait', async () => {
    const orig = task('raced')
    const challenger = task('raced (challenger)', { raceOf: orig.id })
    const after = task('after the race', { dependsOn: [orig.id] })
    getDb().prepare("UPDATE tasks SET status = 'done', race_result = 'lost' WHERE id = ?").run(orig.id)
    getDb().prepare("UPDATE tasks SET status = 'todo', race_result = 'won' WHERE id = ?").run(challenger.id)
    assert.deepEqual(call('tasks:waitingFor', after.id), [orig.key])
    // What the autopilot's picker leaves out: the original holds back its dependents.
    assert.equal(o.mergeBlockers().has(orig.id), true)
    getDb().prepare("UPDATE tasks SET status = 'done' WHERE id = ?").run(challenger.id)
    assert.deepEqual(call('tasks:waitingFor', after.id), [])
  })

  await step('cleaning a project’s tasks removes their copies and branches; leftovers from gone tasks are swept', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'ab-repo-'))
    sh(repo, 'init', '-q')
    writeFileSync(join(repo, 'a.txt'), 'v1\n')
    sh(repo, 'add', '.')
    sh(repo, 'commit', '-qm', 'init')
    const wp = call('projects:save', { name: 'W', rootPath: repo, unitIds: [tpl.unitId], isolation: 'worktree' })
    const wt = tasksRepo.create({ title: 'old work', projectId: wp.id })
    const copy = await o.prepareWorktree(wp, wt, { runId: 'r', agentId: dev.id, taskId: wt.id, projectId: wp.id })
    writeFileSync(join(copy.dir, 'a.txt'), 'old task\n')
    sh(copy.dir, 'commit', '-qam', 'old')
    // A branch left by a task that no longer exists (an older version's clean-up).
    sh(repo, 'branch', 'agentbits/ta-9999')
    await clearProject(wp.id, ['tasks'])
    assert.equal(existsSync(copy.dir), false)
    assert.equal(sh(repo, 'branch', '--list', 'agentbits/*'), '')
    // The next task in the folder starts from the project's own commit.
    const fresh = tasksRepo.create({ title: 'new work', projectId: wp.id })
    const c2 = await o.prepareWorktree(wp, fresh, { runId: 'r2', agentId: dev.id, taskId: fresh.id, projectId: wp.id })
    assert.equal(sh(c2.dir, 'show', 'HEAD:a.txt'), 'v1')
    // Startup sweep: a copy and a branch whose task is gone.
    getDb().prepare('DELETE FROM tasks WHERE id = ?').run(fresh.id)
    await orchestrator.sweepWorktrees()
    assert.equal(existsSync(c2.dir), false)
    assert.equal(sh(repo, 'branch', '--list', 'agentbits/*'), '')
  })

  await step('an edited memory never gets the old text’s vector', async () => {
    let hold: (() => void) | null = null
    const seen: string[] = []
    let requests = 0
    const srv = http.createServer((req, res) => {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', async () => {
        const input = JSON.parse(body).input as string[]
        seen.push(...input)
        if (++requests === 1) await new Promise<void>((r) => (hold = r))
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ data: input.map((s, index) => ({ index, embedding: [1, s.length] })) }))
      })
    })
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()))
    const port = (srv.address() as AddressInfo).port
    const p = providersRepo.save({ kind: 'openai', label: 'emb', model: 'm', apiKey: 'k', baseUrl: `http://127.0.0.1:${port}` })
    const m = memoriesRepo.add({ content: 'abc', kind: 'fact' })
    getDb().prepare('DELETE FROM memory_vectors').run()
    settingsRepo.update({ memoryEmbedProviderId: p.id, memoryEmbedModel: 'm' })
    scheduleIndex(0)
    await until(() => hold !== null, 'embedding request')
    memoriesRepo.update(m.id, 'abcdefgh')
    hold!()
    await until(() => seen.includes('abcdefgh'), 'second embedding request')
    await wait(100)
    const row = getDb().prepare('SELECT vec FROM memory_vectors WHERE memory_id = ?').get(m.id) as { vec: Buffer } | undefined
    assert.ok(row, 'the new text was embedded')
    const v = fromBlob(row.vec)
    assert.ok(Math.abs(v[1] / v[0] - 8) < 1e-3, `vector of the new text (ratio ${v[1] / v[0]})`)
    srv.close()
  })

  orchestrator.shutdown()
  console.log(`orchestrator e2e: ${count} ok`)
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e)
    process.exit(1)
  }
)
