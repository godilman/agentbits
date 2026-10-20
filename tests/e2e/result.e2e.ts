// Package 4: a task's result is told from what really ran (the tool record), not from the worker's report. The lead's
// review gets that evidence (commands with results, files, refusals, the git diff in worktree mode); a provider
// without a tool record says so; the Demo is a simulation; a race shows what attempt B was given.
// Real SQLite, git, orchestrator and IPC handlers; the providers are stubs. Run: npm run test:e2e
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDb, openDb } from '../../src/main/db'
import { agentsRepo, providersRepo, runsRepo, settingsRepo, tasksRepo } from '../../src/main/db/repos'
import { handlers } from '../../src/main/ipc'
import { orchestrator } from '../../src/main/core/orchestrator'
import { projectLead, projectMembers } from '../../src/main/core/org'
import { racePrompt } from '../../src/main/core/prompts'
import { evidenceSection, runEvidence } from '../../src/main/core/evidence'
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
const until = async (cond: () => boolean, what: string, ms = 15_000): Promise<void> => {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
    await wait(20)
  }
}
const call = <T = any>(name: string, ...args: unknown[]): Promise<T> => Promise.resolve().then(() => (handlers as any)[name](...args))
const usage = { input: 10, output: 10, cacheRead: 0, cacheWrite: 0, costUsd: 0 }

const gitCfg = join(mkdtempSync(join(tmpdir(), 'ab-git-')), 'gitconfig')
writeFileSync(gitCfg, '[user]\n\tname = Test\n\temail = test@example.com\n[commit]\n\tgpgsign = false\n[init]\n\tdefaultBranch = main\n')
process.env.GIT_CONFIG_GLOBAL = gitCfg
process.env.GIT_CONFIG_NOSYSTEM = '1'
const sh = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

// What each stub does in a task run, and every review prompt / system it is given.
let claudeWork: (ctx: RunContext) => string = () => 'done'
const reviews: { prompt: string; system: string }[] = []
let raceWinner = 'B'
const review = (ctx: RunContext): string => {
  reviews.push({ prompt: ctx.prompt, system: ctx.system })
  if (ctx.prompt.includes('\n## Attempt A by ')) return JSON.stringify({ winner: raceWinner, note: 'the better attempt' })
  return '{"approved": true, "note": "ok"}'
}
const realClaude = getAdapter('claude-cli').run.bind(getAdapter('claude-cli'))
getAdapter('claude-cli').run = async (ctx: RunContext) => {
  ctx.onUsage?.(usage)
  const text = ctx.mode === 'review' ? review(ctx) : claudeWork(ctx)
  return { text, tokensIn: 10, tokensOut: 10, costUsd: 0 }
}
getAdapter('anthropic').run = async (ctx: RunContext) => {
  ctx.onUsage?.(usage)
  return { text: ctx.mode === 'review' ? review(ctx) : 'Implemented it. All tests pass.', tokensIn: 10, tokensOut: 10, costUsd: 0 }
}
getAdapter('mock').run = async (ctx: RunContext) => {
  ctx.onUsage?.(usage)
  return { text: ctx.mode === 'review' ? review(ctx) : '> This is a simulation', tokensIn: 10, tokensOut: 10, costUsd: 0 }
}

async function main(): Promise<void> {
  openDb()
  settingsRepo.update({ onboarded: true, autopilot: false, reviewByLead: true, raceMode: false, language: 'en' })
  applyLanguageSetting('en')
  orchestrator.init()
  const claude = providersRepo.save({ kind: 'claude-cli', label: 'Claude Code', model: 'sonnet', isDefault: true } as never)
  const api = providersRepo.save({ kind: 'anthropic', label: 'API', model: 'm', apiKey: 'sk-ant-test-0000000000000000000000' } as never)
  const demo = providersRepo.save({ kind: 'mock', label: 'Demo', model: '' } as never)
  const tpl = await call('templates:instantiate', 'core')
  const p = await call('projects:save', { name: 'Shop', rootPath: mkdtempSync(join(tmpdir(), 'ab-r-')), unitIds: [tpl.unitId] })
  getDb().prepare('UPDATE agent_permissions SET require_approval = 0').run()
  const lead = projectLead(p.id)!
  const dev = projectMembers(p.id).filter((a) => a.id !== lead.id)[0]
  const setProvider = (agentId: string, providerId: string): void => void getDb().prepare('UPDATE agents SET provider_id = ? WHERE id = ?').run(providerId, agentId)
  setProvider(lead.id, claude.id)
  const run = async (title: string, providerId: string, pid = p.id): Promise<{ id: string; key: string }> => {
    setProvider(dev.id, providerId)
    agentsRepo.setStatus(dev.id, 'idle')
    const t = tasksRepo.create({ title, projectId: pid, assigneeId: dev.id })
    reviews.length = 0
    await call('tasks:start', t.id)
    await until(() => tasksRepo.get(t.id)!.status === 'done', `${title}: approved`)
    return t
  }

  await step('Claude Code: commands with their results, written files and refusals come from the tool record', async () => {
    claudeWork = (ctx) => {
      ctx.onLog('tool', 'Bash npm test', { toolUseId: 't1' })
      ctx.onLog('error', '↳ 2 failing', { toolUseId: 't1' })
      ctx.onLog('tool', 'Bash npm run lint', { toolUseId: 't2' })
      ctx.onLog('debug', '↳ ok', { toolUseId: 't2' })
      ctx.onLog('tool', 'Bash git status', { toolUseId: 't3' }) // no result recorded
      ctx.onLog('tool', 'Edit src/cart.ts', { toolUseId: 't4' })
      ctx.onLog('tool', 'Read README.md', { toolUseId: 't5' })
      ctx.onLog('warn', 'Permission denied: Bash rm -rf build', { denied: { tool: 'Bash', target: 'rm -rf build' } })
      return 'Fixed the cart total. All tests pass.'
    }
    const t = await run('fix the cart total', claude.id)
    const r = await call('tasks:result', t.id)
    assert.equal(r.evidence.toolRecord, true)
    assert.deepEqual(r.evidence.commands, [
      { command: 'npm test', result: 'error' },
      { command: 'npm run lint', result: 'ok' },
      { command: 'git status', result: 'unknown' }
    ])
    assert.deepEqual(r.evidence.commandCount, { total: 3, failed: 1, failedNotFixed: 1, unknown: 1, notListed: 0, failedNotListed: 0 })
    assert.deepEqual(r.evidence.fileWrites, [{ path: 'src/cart.ts', written: false, last: 'unknown' }], 'an edit without a result is not "written"')
    assert.deepEqual(r.evidence.denied, ['Bash rm -rf build'])
    assert.equal(r.review.by, lead.name)
    assert.equal(r.review.simulated, false)
    assert.equal(r.changes, null, 'not a worktree project')
    // The lead's review read the same evidence, and was told the report is the worker's own account.
    const rv = reviews.at(-1)!
    assert.match(rv.prompt, /## Evidence from the tool record/)
    assert.match(rv.prompt, /`npm test` → FAILED/)
    assert.match(rv.prompt, /`npm run lint` → finished/)
    assert.match(rv.prompt, /`git status` → result not recorded/)
    assert.match(rv.prompt, /No successful write with file tools is recorded/)
    assert.doesNotMatch(rv.prompt, /No file was written/)
    assert.match(rv.prompt, /Not known whether written \(no result recorded\): src\/cart\.ts/)
    assert.match(rv.prompt, /Shell commands may also have read or changed files/)
    assert.match(rv.prompt, /Refused during the run[\s\S]*Bash rm -rf build/)
    assert.match(rv.system, /a claim in the report \(e\.g\. "tests pass"\) that the record does not back is unverified/)
  })

  await step('no command ran: the result and the review say no test ran', async () => {
    claudeWork = (ctx) => {
      ctx.onLog('tool', 'Edit src/a.ts', { toolUseId: 'x1' })
      return 'Done. Tests pass.'
    }
    const t = await run('small edit', claude.id)
    const r = await call('tasks:result', t.id)
    assert.deepEqual(r.evidence.commands, [])
    assert.match(reviews.at(-1)!.prompt, /No shell command ran in this run \(so no test ran\)/)
  })

  await step('a provider without a tool record: commands and files are unknown, not guessed', async () => {
    const t = await run('api work', api.id)
    const r = await call('tasks:result', t.id)
    assert.equal(r.evidence.provider, 'anthropic')
    assert.equal(r.evidence.toolRecord, false)
    assert.deepEqual(r.evidence.commands, [])
    assert.match(reviews.at(-1)!.prompt, /This provider does not report its tool calls: which commands ran \(e\.g\. tests\) is not known/)
  })

  await step('a connection call refused during the run is in the result and the review', async () => {
    claudeWork = () => {
      const live = runsRepo.list({ activeOnly: true })[0] // the run in progress (the stub gets no ids)
      getDb()
        .prepare(
          `INSERT INTO audit_log (at, actor_type, actor_id, actor_name, connection_name, project_id, task_id, run_id, action, detail, result, message)
           VALUES (?, 'agent', ?, ?, 'maindb', ?, ?, ?, 'query', 'DELETE FROM orders', 'denied', 'no write access')`
        )
        .run(new Date().toISOString(), dev.id, dev.name, p.id, live.taskId, live.id)
      return 'Cleaned the orders.'
    }
    const t = await run('clean old orders', claude.id)
    const r = await call('tasks:result', t.id)
    assert.ok(r.evidence.denied.some((d: string) => /maindb: query DELETE FROM orders/.test(d)), JSON.stringify(r.evidence.denied))
    assert.match(reviews.at(-1)!.prompt, /maindb: query DELETE FROM orders/)
  })

  await step('a long report: the review is told the end was not shown', async () => {
    claudeWork = () => 'x'.repeat(13_000)
    const t = await run('long report', claude.id)
    assert.equal((await call('tasks:result', t.id)).evidence.reportCut, true)
    assert.match(reviews.at(-1)!.prompt, /The report is longer than the 12000 characters shown above/)
  })

  await step('Demo: a simulation — no evidence section, the result says nothing was checked', async () => {
    const t = await run('demo work', demo.id)
    const r = await call('tasks:result', t.id)
    assert.equal(r.evidence.simulated, true)
    assert.doesNotMatch(reviews.at(-1)!.prompt, /Evidence from the tool record/)
  })

  await step('file writes count only when they worked: written / failed / refused / no result; shell writes are not claimed absent', async () => {
    claudeWork = (ctx) => {
      ctx.onLog('tool', 'Write src/a.ts', { toolUseId: 'f1' })
      ctx.onLog('debug', '↳ ✓', { toolUseId: 'f1' })
      ctx.onLog('tool', 'Write src/b.ts', { toolUseId: 'f2' })
      ctx.onLog('error', '↳ EACCES', { toolUseId: 'f2' })
      ctx.onLog('tool', 'Edit src/c.ts', { toolUseId: 'f3' })
      ctx.onLog('error', '↳ ✗', { toolUseId: 'f3' })
      ctx.onLog('warn', 'Permission denied: Edit src/c.ts', { denied: { tool: 'Edit', target: 'src/c.ts' } })
      ctx.onLog('tool', 'Write src/d.ts', { toolUseId: 'f4' })
      ctx.onLog('tool', 'Write src/e.ts', { toolUseId: 'f5' })
      ctx.onLog('error', '↳ disk full', { toolUseId: 'f5' })
      ctx.onLog('tool', 'Write src/e.ts', { toolUseId: 'f6' }) // tried again: this one worked
      ctx.onLog('debug', '↳ ✓', { toolUseId: 'f6' })
      ctx.onLog('tool', 'Bash printf x > src/f.ts', { toolUseId: 'f7' })
      ctx.onLog('debug', '↳ ✓', { toolUseId: 'f7' })
      return 'Wrote the files.'
    }
    const t = await run('write files', claude.id)
    const r = await call('tasks:result', t.id)
    assert.deepEqual(r.evidence.fileWrites, [
      { path: 'src/a.ts', written: true, last: 'ok' },
      { path: 'src/e.ts', written: true, last: 'ok' },
      { path: 'src/b.ts', written: false, last: 'error' },
      { path: 'src/c.ts', written: false, last: 'refused' },
      { path: 'src/d.ts', written: false, last: 'unknown' }
    ])
    const pr = reviews.at(-1)!.prompt
    assert.match(pr, /Written with file tools \(2\): src\/a\.ts, src\/e\.ts/)
    assert.match(pr, /No successful write recorded, every attempt FAILED: src\/b\.ts/)
    assert.match(pr, /No successful write recorded, refused: src\/c\.ts/)
    assert.match(pr, /Not known whether written \(no result recorded\): src\/d\.ts/)
    assert.match(pr, /Shell commands may also have read or changed files; that is not tracked here/)
  })

  await step('a failure early in a long run stays: counted, listed, and the rest is said to be left out', async () => {
    claudeWork = (ctx) => {
      ctx.onLog('tool', 'Bash npm test', { toolUseId: 'L0' })
      ctx.onLog('error', '↳ 1 failing', { toolUseId: 'L0' })
      for (let i = 1; i <= 40; i++) {
        ctx.onLog('tool', `Bash echo ${i}`, { toolUseId: `L${i}` })
        ctx.onLog('debug', '↳ ✓', { toolUseId: `L${i}` })
      }
      return 'All good, tests pass.'
    }
    const t = await run('long run', claude.id)
    const e = (await call('tasks:result', t.id)).evidence
    assert.deepEqual(e.commandCount, { total: 41, failed: 1, failedNotFixed: 1, unknown: 0, notListed: 10, failedNotListed: 0 })
    assert.deepEqual(e.commands[0], { command: 'npm test', result: 'error' })
    const pr = reviews.at(-1)!.prompt
    assert.match(pr, /Shell commands: 41 ran, 1 failed \(0 later succeeded when run again\)/)
    assert.match(pr, /`npm test` → FAILED/)
    assert.match(pr, /… 10 more commands not listed \(all failures are listed above\)/)
  })

  await step('over 5000 log lines after the failing test: still found (not "no command ran")', async () => {
    claudeWork = (ctx) => {
      ctx.onLog('tool', 'Bash npm test', { toolUseId: 'B0' })
      ctx.onLog('error', '↳ 3 failing', { toolUseId: 'B0' })
      for (let i = 0; i < 5100; i++) ctx.onLog('output', `line ${i}`)
      return 'Done.'
    }
    const t = await run('chatty run', claude.id)
    const e = (await call('tasks:result', t.id)).evidence
    assert.deepEqual(e.commands, [{ command: 'npm test', result: 'error' }])
    assert.doesNotMatch(reviews.at(-1)!.prompt, /No shell command ran/)
  })

  await step('a failure that the same command later got past is told apart', async () => {
    claudeWork = (ctx) => {
      ctx.onLog('tool', 'Bash npm test', { toolUseId: 'R1' })
      ctx.onLog('error', '↳ 1 failing', { toolUseId: 'R1' })
      ctx.onLog('tool', 'Bash npm test', { toolUseId: 'R2' })
      ctx.onLog('debug', '↳ all passing', { toolUseId: 'R2' })
      return 'Fixed.'
    }
    const t = await run('fixed on retry', claude.id)
    const e = (await call('tasks:result', t.id)).evidence
    assert.deepEqual(e.commands, [{ command: 'npm test', result: 'error', fixedLater: true }, { command: 'npm test', result: 'ok' }])
    assert.equal(e.commandCount.failedNotFixed, 0)
    assert.match(reviews.at(-1)!.prompt, /`npm test` → FAILED \(succeeded later\)/)
  })

  await step('the same file again: refused then written is written; written then failed stays written (the change stays)', async () => {
    claudeWork = (ctx) => {
      ctx.onLog('tool', 'Edit src/r.ts', { toolUseId: 'g1' })
      ctx.onLog('error', '↳ ✗', { toolUseId: 'g1' })
      ctx.onLog('warn', 'Permission denied: Edit src/r.ts', { denied: { tool: 'Edit', target: 'src/r.ts' } })
      ctx.onLog('tool', 'Edit src/r.ts', { toolUseId: 'g2' })
      ctx.onLog('debug', '↳ ✓', { toolUseId: 'g2' })
      ctx.onLog('tool', 'Write src/w.ts', { toolUseId: 'g3' })
      ctx.onLog('debug', '↳ ✓', { toolUseId: 'g3' })
      ctx.onLog('tool', 'Write src/w.ts', { toolUseId: 'g4' })
      ctx.onLog('error', '↳ disk full', { toolUseId: 'g4' })
      return 'Done.'
    }
    const t = await run('retries on one file', claude.id)
    const e = (await call('tasks:result', t.id)).evidence
    assert.deepEqual(e.fileWrites, [
      { path: 'src/r.ts', written: true, last: 'ok' },
      { path: 'src/w.ts', written: true, last: 'error' }
    ])
    assert.deepEqual(e.fileCount, { total: 2, written: 2, notWritten: 0, notListed: 0, writtenNotListed: 0 })
    const pr = reviews.at(-1)!.prompt
    assert.match(pr, /Written with file tools \(2\): src\/r\.ts, src\/w\.ts/)
    assert.match(pr, /Written, but a later attempt on src\/w\.ts FAILED \(the earlier change stays\)/)
    assert.doesNotMatch(pr, /refused: src\/r\.ts|No successful write/)
  })

  await step('lists are shortened, counts are not: 25 failures are all counted; a written 41st file is still written', async () => {
    claudeWork = (ctx) => {
      for (let i = 1; i <= 25; i++) {
        ctx.onLog('tool', `Bash test ${i}`, { toolUseId: `F${i}` })
        ctx.onLog('error', '↳ ✗', { toolUseId: `F${i}` })
      }
      for (let i = 1; i <= 30; i++) {
        ctx.onLog('tool', `Bash ok ${i}`, { toolUseId: `O${i}` })
        ctx.onLog('debug', '↳ ✓', { toolUseId: `O${i}` })
      }
      for (let i = 1; i <= 40; i++) ctx.onLog('tool', `Write src/u${i}.ts`, { toolUseId: `U${i}` }) // no result recorded
      ctx.onLog('tool', 'Write src/last.ts', { toolUseId: 'U41' })
      ctx.onLog('debug', '↳ ✓', { toolUseId: 'U41' })
      return 'Done.'
    }
    const t = await run('many of everything', claude.id)
    const e = (await call('tasks:result', t.id)).evidence
    assert.deepEqual(e.commandCount, { total: 55, failed: 25, failedNotFixed: 25, unknown: 0, notListed: 5, failedNotListed: 5 })
    assert.deepEqual(e.fileCount, { total: 41, written: 1, notWritten: 40, notListed: 1, writtenNotListed: 0 })
    assert.deepEqual(e.fileWrites[0], { path: 'src/last.ts', written: true, last: 'ok' }, 'the written one is listed first')
    const pr = reviews.at(-1)!.prompt
    assert.match(pr, /Shell commands: 55 ran, 25 failed/)
    assert.match(pr, /… 5 more commands not listed, 5 of them FAILED\./)
    assert.doesNotMatch(pr, /all failures are listed above/)
    assert.match(pr, /Written with file tools \(1\): src\/last\.ts/)
    assert.doesNotMatch(pr, /No successful write/)
    assert.match(pr, /… 1 more files without a recorded successful write are not listed/)
  })

  await step('a missing tool record is "not known", never "no command ran"', async () => {
    claudeWork = () => 'Done.'
    const t = await run('record cleaned', claude.id)
    const runId = runsRepo.list({ taskId: t.id, limit: 1 })[0].id
    getDb().prepare('DELETE FROM agent_logs WHERE run_id = ?').run(runId)
    const e = runEvidence(runId)!
    assert.equal(e.recordMissing, true)
    const s = evidenceSection(e, null)
    assert.match(s, /The tool record of this run is not available: what ran is not known/)
    assert.doesNotMatch(s, /No shell command ran|No successful write/)
  })

  await step('worktree: the review gets the git changes and diff; the result says merged after the approval', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'ab-wt-'))
    sh(repo, 'init', '-q')
    writeFileSync(join(repo, 'a.txt'), 'one\n')
    sh(repo, 'add', '.')
    sh(repo, 'commit', '-qm', 'init')
    const wp = await call('projects:save', { name: 'W', rootPath: repo, unitIds: [tpl.unitId], isolation: 'worktree' })
    claudeWork = (ctx) => {
      writeFileSync(join(ctx.cwd!, 'price.ts'), 'export const price = 42\n')
      ctx.onLog('tool', `Write ${join(ctx.cwd!, 'price.ts')}`, { toolUseId: 'w1' })
      return 'Added the price.'
    }
    const t = await run('add the price', claude.id, wp.id)
    const rv = reviews.at(-1)!
    assert.match(rv.prompt, /Files changed \(git\): price\.ts/)
    assert.match(rv.prompt, /\+export const price = 42/)
    await until(() => !orchestrator.pendingMerge(t.id), 'merged')
    const r = await call('tasks:result', t.id)
    assert.deepEqual(r.changes, { files: 1, added: 1, removed: 0, merged: true })
  })

  await step('race, Demo lead / real lead, B or A wins: both sides show who judged, simulated or not, and that it was a race', async () => {
    const api2 = providersRepo.save({ kind: 'anthropic', label: 'API 2', model: 'm2', apiKey: 'sk-ant-test-0000000000000000000001' } as never)
    const rp = await call('projects:save', { name: 'Race', unitIds: [tpl.unitId] }) // no folder: a race may run without a git copy
    const rLead = projectLead(rp.id)!
    const [w1, w2] = projectMembers(rp.id).filter((a) => a.id !== rLead.id)
    setProvider(w1.id, api.id)
    setProvider(w2.id, api2.id)
    for (const a of projectMembers(rp.id)) if (a.id !== w1.id && a.id !== w2.id && a.id !== rLead.id) getDb().prepare('UPDATE agents SET enabled = 0 WHERE id = ?').run(a.id)
    settingsRepo.update({ raceMode: true })
    for (const [leadProvider, winner] of [[demo.id, 'B'], [claude.id, 'B'], [demo.id, 'A'], [claude.id, 'A']] as const) {
      setProvider(rLead.id, leadProvider)
      raceWinner = winner
      for (const a of [w1, w2]) agentsRepo.setStatus(a.id, 'idle')
      const ta = tasksRepo.create({ title: `race ${leadProvider === demo.id ? 'demo' : 'real'} ${winner}`, projectId: rp.id, assigneeId: w1.id })
      await call('tasks:start', ta.id)
      await until(() => !!tasksRepo.challengerOf(ta.id) && tasksRepo.get(ta.id)!.raceResult !== null, 'the race decided', 20_000)
      const tb = tasksRepo.challengerOf(ta.id)!
      const simulated = leadProvider === demo.id
      for (const x of [ta, tb]) {
        const r = await call('tasks:result', x.id)
        assert.deepEqual(r.review, { by: rLead.name, simulated, race: true }, `${x.key} (${simulated ? 'Demo' : 'real'} lead, ${winner} won)`)
      }
      const n = (getDb().prepare("SELECT COUNT(*) AS n FROM token_usage WHERE mode = 'review' AND task_id IN (?, ?)").get(ta.id, tb.id) as { n: number }).n
      assert.equal(n, 1, 'one comparison, one usage record (not copied to both)')
    }
    settingsRepo.update({ raceMode: false })
  })

  await step('the real Claude Code parser: a write is reported only when its result worked; every result is recorded', async () => {
    // A fake `claude` printing stream-json tool events (Windows runs it through a .cmd shim, like an npm install).
    const dir = mkdtempSync(join(tmpdir(), 'ab-claude-'))
    const script = join(dir, 'claude.js')
    writeFileSync(
      script,
      `#!/usr/bin/env node
const a = process.argv.slice(2)
if (a[0] === '--version') { console.log('2.1.300 (Claude Code)'); process.exit(0) }
if (a[0] === '--help') { console.log('Options:\\n  --print'); process.exit(0) }
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n')
process.stdin.resume(); process.stdin.on('end', () => {
  out({ type: 'system', subtype: 'init', session_id: 's1', model: 'm' })
  out({ type: 'assistant', message: { id: 'm1', content: [
    { type: 'tool_use', id: 'w1', name: 'Write', input: { file_path: 'src/ok.ts' } },
    { type: 'tool_use', id: 'w2', name: 'Write', input: { file_path: 'src/fails.ts' } },
    { type: 'tool_use', id: 'b1', name: 'Bash', input: { command: 'true' } }
  ], usage: { input_tokens: 1, output_tokens: 1 } } })
  out({ type: 'user', message: { content: [
    { type: 'tool_result', tool_use_id: 'w1', content: '' },
    { type: 'tool_result', tool_use_id: 'w2', is_error: true, content: 'EACCES: permission denied' },
    { type: 'tool_result', tool_use_id: 'b1', content: '' }
  ] } })
  out({ type: 'result', result: 'Done.', total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1 } })
})
`
    )
    let bin = join(dir, 'claude')
    if (process.platform === 'win32') {
      bin = join(dir, 'claude.cmd')
      writeFileSync(bin, '@node "%~dp0claude.js" %*\r\n')
    } else {
      writeFileSync(bin, readFileSync(script))
      chmodSync(bin, 0o755)
    }
    const written: string[] = []
    const logs: { level: string; message: string; meta?: Record<string, unknown> }[] = []
    const ctx = {
      mode: 'task',
      agent: dev,
      permissions: { fsRead: true, fsWrite: true, terminal: true, network: false, requireApproval: false, allowedPaths: [] },
      provider: { ...claude, cliPath: bin },
      model: 'm',
      apiKey: null,
      cwd: dir,
      system: 's',
      prompt: 'p',
      signal: new AbortController().signal,
      onText: () => undefined,
      onLog: (level: string, message: string, meta?: Record<string, unknown>) => void logs.push({ level, message, meta }),
      onFileWritten: (path: string) => void written.push(path),
      onProgress: () => undefined,
      checkpoint: async () => undefined
    }
    await realClaude(ctx as never)
    assert.deepEqual(written, ['src/ok.ts'], 'the failed write is not reported as written')
    const res = (id: string) => logs.find((l) => l.meta?.toolUseId === id && l.message.startsWith('↳'))
    assert.equal(res('w1')?.message, '↳ ✓', 'a result without output is still recorded')
    assert.equal(res('w1')?.level, 'debug')
    assert.equal(res('w2')?.level, 'error')
    assert.match(res('w2')!.message, /EACCES/)
    assert.equal(res('b1')?.message, '↳ ✓')
  })

  await step('race: what attempt B was given is shown when its copy was edited (and not when it is the same)', () => {
    const a = tasksRepo.create({ title: 'Speed up search', description: 'Make it faster', projectId: p.id })
    const same = { ...a, id: 'b' }
    const edited = { ...a, id: 'b', description: 'Make it faster, but keep the old API', acceptance: 'Old API still works' }
    const att = (o: string) => ({ agent: dev, label: 'x', output: o })
    assert.doesNotMatch(racePrompt(a, att('A'), { ...att('B'), task: same }), /Attempt B was given/)
    const pr = racePrompt(a, att('A'), { ...att('B'), task: edited })
    assert.match(pr, /Attempt B was given these task details \(its copy was edited\)\nSpeed up search\nMake it faster, but keep the old API\nAcceptance criteria:\n1\. Old API still works/)
  })

  orchestrator.shutdown()
  console.log(`result e2e: ${count} steps ok`)
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e)
    process.exit(1)
  }
)
