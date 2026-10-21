// The review loop seen on 2026-10-20 (TA-32 / TA-34, Claude Code): the lead was told "No file tool was used" for runs
// that read files, saw a file's previous version while it was being read in again, couldn't say "I can't verify",
// and sent unchanged work back until the round limit. Each step rebuilds one of those situations.
// Real SQLite, orchestrator and IPC handlers; the provider is a stub. Run: npm run test:e2e
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDb, openDb } from '../../src/main/db'
import { agentsRepo, runsRepo, settingsRepo, tasksRepo } from '../../src/main/db/repos'
import { handlers } from '../../src/main/ipc'
import { orchestrator } from '../../src/main/core/orchestrator'
import { projectLead, projectMembers } from '../../src/main/core/org'
import { evidenceSection, runEvidence } from '../../src/main/core/evidence'
import { filesRepo } from '../../src/main/files/repo'
import { filesSection, recordWorkspaceChanges } from '../../src/main/files/service'
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

// A finished run as Claude Code records it: usage row (provider), tool calls with results, file links.
function recordedRun(taskId: string, agentId: string, projectId: string, provider = 'claude-cli'): string {
  const run = runsRepo.create(taskId, agentId, 'succeeded', projectId)
  getDb()
    .prepare(
      `INSERT INTO token_usage (agent_id, run_id, task_id, project_id, mode, provider, model, input, output, cache_read, cache_write, cost_usd, estimated, session_id, created_at)
       VALUES (?, ?, ?, ?, 'task', ?, 'm', 1, 1, 0, 0, 0, 0, '', ?)`
    )
    .run(agentId, run.id, taskId, projectId, provider, new Date().toISOString())
  return run.id
}
function toolCall(runId: string, agentId: string, taskId: string, projectId: string, message: string, result = '↳ ok'): void {
  const id = `toolu_${randomUUID()}`
  const add = getDb().prepare(
    'INSERT INTO agent_logs (run_id, agent_id, task_id, project_id, level, message, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  )
  add.run(runId, agentId, taskId, projectId, 'tool', message, JSON.stringify({ toolUseId: id }), new Date().toISOString())
  add.run(runId, agentId, taskId, projectId, 'debug', result, JSON.stringify({ toolUseId: id }), new Date().toISOString())
}

async function main(): Promise<void> {
  openDb()
  const tpl = await call('templates:instantiate', 'ecommerce')
  const p = await call('projects:save', { name: 'Erkunt Mobil', rootPath: mkdtempSync(join(tmpdir(), 'ab-rl-')), unitIds: [tpl.unitId] })
  // The paths without recovery (ADR-036 has its own test: reviewRecovery.e2e.ts).
  settingsRepo.update({ onboarded: true, autopilot: false, reviewByLead: false, raceMode: false, language: 'en', autoRecovery: false })
  getDb().prepare('UPDATE agent_permissions SET require_approval = 0').run()
  applyLanguageSetting('en')
  orchestrator.init()
  const lead = projectLead(p.id)!
  const [ece, arda] = projectMembers(p.id).filter((a) => !a.isLead && a.id !== lead.id)
  // Files as Agentbits keeps them once read in (the extraction worker isn't part of this test).
  const file = async (name: string, text: string) => {
    const f = await call('files:addData', p.id, name, new TextEncoder().encode(text))
    await until(() => filesRepo.get(f.id)?.status !== 'processing', 'the read-in attempt to end')
    filesRepo.setChunks(f.id, [{ label: 'Text (1/1)', text }])
    filesRepo.update(f.id, { status: 'ready', chars: text.length, chunkCount: 1, projectShared: true })
    return f
  }
  const page = await file('bildirimler.php', "<?php\n$delLabel = Lang::t('notif.delete.btn');\n")
  const api = await file('notif_delete.php', '<?php // delete endpoint\n')
  const sql = await file('57_notifications_deleted_at.sql', 'ALTER TABLE notifications ADD deleted_at DATETIME;\n')

  // ── K1: reads are evidence too ─────────────────────────────────────────────────────────────────────────────────
  await step('K1. a run that only read (Agentbits file_read, like TA-32 rounds 3–4): the lead is told what it read', () => {
    const t32 = tasksRepo.create({ title: 'Swipe to delete', projectId: p.id, assigneeId: ece.id })
    const run = recordedRun(t32.id, ece.id, p.id)
    // Claude Code logs the MCP call without its arguments; Agentbits links the file it read to the run.
    toolCall(run, ece.id, t32.id, p.id, 'mcp__agentbits__file_read ', '↳ <<<FILE ref=…>>>')
    toolCall(run, ece.id, t32.id, p.id, 'mcp__agentbits__file_search ', '↳ Matches …')
    filesRepo.link(page.id, 'run', run, 'read')
    const e = runEvidence(run)!
    assert.deepEqual(e.reads.files, ['bildirimler.php'], 'the file it read, once (the mcp line is not a second read)')
    assert.equal(e.reads.searches, 0, "Agentbits' own search isn't a Grep / Glob")
    const text = evidenceSection(e, null)
    assert.doesNotMatch(text, /No file tool was used/)
    assert.match(text, /- Files read \(1\): bildirimler\.php/)
    assert.match(text, /- No file write with file tools is recorded\./, 'what is known about writes stays')
  })

  await step("K1. Claude Code's own Read / Grep / Glob: files and searches (a pattern isn't a file)", () => {
    const t = tasksRepo.create({ title: 'Check the page', projectId: p.id, assigneeId: ece.id })
    const run = recordedRun(t.id, ece.id, p.id)
    toolCall(run, ece.id, t.id, p.id, 'Read W:\\erkunt-mobil\\modules\\bildirimler.php')
    toolCall(run, ece.id, t.id, p.id, 'Read W:\\erkunt-mobil\\modules\\bildirimler.php')
    toolCall(run, ece.id, t.id, p.id, 'Grep notif\\.delete\\.btn')
    toolCall(run, ece.id, t.id, p.id, 'Glob partials/header.php')
    toolCall(run, ece.id, t.id, p.id, 'mcp__agentbits__project_memory_read ')
    const e = runEvidence(run)!
    assert.deepEqual(e.reads.files, ['W:\\erkunt-mobil\\modules\\bildirimler.php'])
    assert.equal(e.reads.searches, 2)
    assert.equal(e.reads.memory, 1)
    const text = evidenceSection(e, null)
    assert.match(text, /Searches with Grep \/ Glob: 2 \(patterns, not files\)/)
    assert.match(text, /Project memory read 1 time\(s\): context only, not evidence about the current files or tests\./)
  })

  await step('K1. TA-34 rounds 1–2: files attached to the prompt and one read are told apart, never "full"', () => {
    const t34 = tasksRepo.create({ title: 'Security review of the delete endpoint', projectId: p.id, assigneeId: arda.id })
    const run = recordedRun(t34.id, arda.id, p.id)
    filesRepo.link(api.id, 'run', run, 'given')
    filesRepo.link(sql.id, 'run', run, 'read')
    toolCall(run, arda.id, t34.id, p.id, 'mcp__agentbits__file_read ')
    const text = evidenceSection(runEvidence(run)!, null)
    assert.match(text, /Attached to the worker's prompt \(1; in full, in part, or only named with a note to read it — not known which\): notif_delete\.php/)
    assert.match(text, /- Files read \(1\): 57_notifications_deleted_at\.sql/)
  })

  await step('K1. no read recorded: said as "not recorded", never "nothing was read"; shell commands are not tracked', () => {
    const t = tasksRepo.create({ title: 'Quiet run', projectId: p.id, assigneeId: ece.id })
    const quietRun = recordedRun(t.id, ece.id, p.id)
    // A run always has its own lines (started, output); none of them is a file tool.
    getDb()
      .prepare("INSERT INTO agent_logs (run_id, agent_id, task_id, project_id, level, message, created_at) VALUES (?, ?, ?, ?, 'status', '▶ started', ?)")
      .run(quietRun, ece.id, t.id, p.id, new Date().toISOString())
    const quiet = runEvidence(quietRun)!
    assert.match(evidenceSection(quiet, null), /- No file read is recorded with file tools\./)
    const shell = recordedRun(t.id, ece.id, p.id)
    toolCall(shell, ece.id, t.id, p.id, 'Bash cat modules/bildirimler.php')
    const text = evidenceSection(runEvidence(shell)!, null)
    assert.match(text, /Shell commands may also have read or changed files; that is not tracked here\./)
    assert.doesNotMatch(text, /No file tool was used|nothing was read|no file was read/i)
  })

  await step('K1. a Read that failed or has no recorded result is not counted as read (said separately)', () => {
    const t = tasksRepo.create({ title: 'Failed read', projectId: p.id, assigneeId: ece.id })
    const run = recordedRun(t.id, ece.id, p.id)
    toolCall(run, ece.id, t.id, p.id, 'Read W:\\nope.php', '↳ File does not exist.')
    getDb().prepare("UPDATE agent_logs SET level = 'error' WHERE run_id = ? AND message LIKE '↳%'").run(run)
    toolCall(run, ece.id, t.id, p.id, 'Read W:\\ok.php')
    const e = runEvidence(run)!
    assert.deepEqual(e.reads.files, ['W:\\ok.php'])
    assert.equal(e.reads.unconfirmed, 1)
    assert.match(evidenceSection(e, null), /Read attempts that failed or have no recorded result: 1 \(not counted as read\)/)
  })

  await step("K1. other providers: reads through Agentbits count; the provider's own reads are 'not known'", () => {
    const t = tasksRepo.create({ title: 'Codex run', projectId: p.id, assigneeId: ece.id })
    const run = recordedRun(t.id, ece.id, p.id, 'codex-cli')
    filesRepo.link(page.id, 'run', run, 'read')
    const e = runEvidence(run)!
    assert.equal(e.toolRecord, false)
    assert.deepEqual(e.reads.files, ['bildirimler.php'])
    assert.match(evidenceSection(e, null), /Reads through Agentbits are listed above; this provider's own reads are not known\./)
  })

  // ── K2: a file being read in again never shows its previous version ─────────────────────────────────────────────
  await step('K2. a changed file still being read in: none of its stored (old) text goes into any prompt', () => {
    filesRepo.update(page.id, { status: 'processing' })
    for (const toolsAvailable of [false, true]) {
      const sec = filesSection({ agentId: lead.id, projectId: p.id, focusIds: [page.id], toolsAvailable, vision: 'none', budget: 16_000 })
      assert.doesNotMatch(sec.text, /notif\.delete\.btn/, 'the previous version is not shown')
      assert.match(sec.text, /bildirimler\.php is being updated: its current content is not ready yet, so none of it is shown here\./)
      assert.deepEqual(sec.pending.map((f) => f.id), [page.id])
      assert.equal(sec.given.length, 0, 'not counted as given to the agent')
    }
    // A toolless review is told it can't open the other files (it used to read "Other files you may read").
    const review = filesSection({ agentId: lead.id, projectId: p.id, focusIds: [], toolsAvailable: false, vision: 'none' })
    assert.match(review.text, /not shown to you, and you cannot open them/)
    filesRepo.update(page.id, { status: 'ready' })
  })

  await step('K2. a project file changed on disk: its old text is dropped at once (also when reading the new one fails)', async () => {
    const root = getDb().prepare('SELECT root_path FROM projects WHERE id = ?').get(p.id) as { root_path: string }
    const abs = join(root.root_path, 'old.php')
    writeFileSync(abs, '<?php // v1')
    const ctx = { projectId: p.id, agentId: ece.id, runId: null, taskId: null } as any
    const [f] = recordWorkspaceChanges(ctx, root.root_path, 0)
    await until(() => filesRepo.get(f.id)?.status !== 'processing', 'first read-in attempt')
    filesRepo.setChunks(f.id, [{ label: 'Text (1/1)', text: 'OLD VERSION TEXT' }])
    filesRepo.update(f.id, { status: 'ready', chars: 16, chunkCount: 1, statusMessage: null })
    writeFileSync(abs, '<?php // v2')
    const later = Date.now() / 1000 + 5
    utimesSync(abs, later, later)
    recordWorkspaceChanges(ctx, root.root_path, Date.now())
    assert.equal(filesRepo.chunks(f.id, 0, 5).length, 0, 'the previous text is gone while the new one is read in')
    await until(() => filesRepo.get(f.id)?.status !== 'processing', 'the read-in attempt to end (it fails here: no extraction worker)')
    const sec = filesSection({ agentId: lead.id, projectId: p.id, focusIds: [f.id], toolsAvailable: false, vision: 'none' })
    assert.doesNotMatch(sec.text, /OLD VERSION TEXT/)
    assert.match(sec.text, /old\.php: its current content couldn't be read/)
  })

  await step('K2. a task attachment still being read in when the run starts: recorded, and the review is told', async () => {
    settingsRepo.update({ reviewByLead: false })
    getAdapter('mock').run = async () => ({ text: 'done', tokensIn: 1, tokensOut: 1, costUsd: 0 })
    const t = tasksRepo.create({ title: 'Uses the spec', projectId: p.id, assigneeId: ece.id })
    filesRepo.link(api.id, 'task', t.id, 'attached')
    filesRepo.update(api.id, { status: 'processing' })
    await call('tasks:start', t.id)
    await until(() => tasksRepo.get(t.id)!.status === 'in_review', 'run ended')
    agentsRepo.setStatus(ece.id, 'idle')
    const run = runsRepo.list({ taskId: t.id, limit: 1 })[0]
    getDb().prepare("UPDATE token_usage SET provider = 'claude-cli' WHERE run_id = ?").run(run.id)
    const text = evidenceSection(runEvidence(run.id)!, null)
    assert.match(text, /Not ready when the run started \(still being read in; the worker may not have seen them\): notif_delete\.php/)
    filesRepo.update(api.id, { status: 'ready' })
  })

  await step("K2. the review waits for the worker's changed file; still not ready → the user decides, nothing is judged", async () => {
    settingsRepo.update({ reviewByLead: true })
    orchestrator.startProjectWork(p.id)
    o.filesReadyMs = 300
    let reviews = 0
    getAdapter('mock').run = async (ctx: RunContext) => {
      if (ctx.mode === 'review') {
        reviews++
        return { text: '{"approved": false, "note": "the fix is not applied"}', tokensIn: 1, tokensOut: 1, costUsd: 0 }
      }
      const run = runsRepo.list({ taskId: t.id, limit: 1 })[0]
      // What a CLI agent's edit does: the file is linked to the run and read in again (slowly here).
      filesRepo.link(page.id, 'run', run.id, 'generated')
      filesRepo.update(page.id, { status: 'processing' })
      return { text: 'fixed the key', tokensIn: 1, tokensOut: 1, costUsd: 0 }
    }
    const t = tasksRepo.create({ title: 'Fix the delete label', projectId: p.id, assigneeId: ece.id })
    await call('tasks:start', t.id)
    await until(() => orchestrator.state().undecided.includes(t.id), 'the user decides')
    assert.equal(reviews, 0, 'no verdict on content the lead could not see')
    assert.equal(tasksRepo.get(t.id)!.status, 'in_review', 'not sent back')
    assert.match(orchestrator.state().undecidedWhy[t.id], /aren't ready yet \(bildirimler\.php/)
    filesRepo.update(page.id, { status: 'ready' })
    agentsRepo.setStatus(ece.id, 'idle')
  })

  await step('K2. ready within the wait: the review sees the current content (not the previous version)', async () => {
    o.filesReadyMs = 5000
    let prompt = ''
    getAdapter('mock').run = async (ctx: RunContext) => {
      if (ctx.mode === 'review') {
        prompt = ctx.prompt
        return { text: '{"approved": true, "note": "ok"}', tokensIn: 1, tokensOut: 1, costUsd: 0 }
      }
      const run = runsRepo.list({ taskId: t.id, limit: 1 })[0]
      filesRepo.link(page.id, 'run', run.id, 'generated')
      filesRepo.update(page.id, { status: 'processing' })
      // Read in a moment later, with the fix.
      setTimeout(() => {
        filesRepo.setChunks(page.id, [{ label: 'Text (1/1)', text: "$delLabel = Lang::t('notif.delete.button');" }])
        filesRepo.update(page.id, { status: 'ready' })
      }, 400)
      return { text: 'fixed the key', tokensIn: 1, tokensOut: 1, costUsd: 0 }
    }
    const t = tasksRepo.create({ title: 'Fix the delete label again', projectId: p.id, assigneeId: ece.id })
    await call('tasks:start', t.id)
    await until(() => tasksRepo.get(t.id)!.status === 'done', 'approved')
    assert.match(prompt, /notif\.delete\.button/)
    assert.doesNotMatch(prompt, /notif\.delete\.btn/)
    agentsRepo.setStatus(ece.id, 'idle')
    settingsRepo.update({ reviewByLead: false })
  })

  // ── K3 / K4 / K6: the review's outcome, the loop, and what #general says ───────────────────────────────────────
  // Ece and the lead run on "Claude Code" (stubbed): its tool record decides what is known about a run.
  getDb()
    .prepare("INSERT INTO providers (id, kind, label, model, cli_path, is_default) VALUES ('cc-test', 'claude-cli', 'Claude Code', 'opus', 'claude', 0)")
    .run()
  getDb().prepare("UPDATE agents SET provider_id = 'cc-test' WHERE id IN (?, ?)").run(ece.id, lead.id)
  let worker: (runId: string, taskId: string) => void = () => undefined
  let verdict = '{"approved": true, "note": "ok"}'
  let workerRuns = 0
  getAdapter('claude-cli').run = async (ctx: RunContext) => {
    if (ctx.mode === 'review') return { text: verdict, tokensIn: 1, tokensOut: 1, costUsd: 0 }
    workerRuns++
    ctx.onUsage?.({ input: 1, output: 1, cacheRead: 0, cacheWrite: 0, costUsd: 0 }) // as the CLI reports it
    const run = getDb().prepare("SELECT id, task_id FROM runs WHERE status = 'running' ORDER BY started_at DESC LIMIT 1").get() as { id: string; task_id: string }
    worker(run.id, run.task_id)
    return { text: 'report', tokensIn: 1, tokensOut: 1, costUsd: 0 }
  }
  const general = (): { content: string; senderType: string; meta: any }[] =>
    (getDb().prepare("SELECT content, sender_type AS senderType, meta FROM messages WHERE channel = 'general' AND project_id = ? ORDER BY created_at, rowid").all(p.id) as any[]).map(
      (m) => ({ ...m, meta: m.meta ? JSON.parse(m.meta) : null })
    )
  const since = (n: number) => general().slice(n)
  const settle = async (taskId: string, done: () => boolean, what: string): Promise<void> => {
    await until(done, what)
    await until(() => !o.reviewing.has(taskId), 'the review to end')
    agentsRepo.setStatus(ece.id, 'idle')
  }
  settingsRepo.update({ reviewByLead: true, autopilot: false })

  await step('K6. a finished run: #general says who finished what, that it went to the lead, and that nothing is needed — by the app', async () => {
    const n = general().length
    worker = () => undefined
    verdict = '{"approved": true, "note": "Kriterler karşılanıyor.", "summary": "Silme düğmesi yalnız Genel sekmesinde."}'
    const t = tasksRepo.create({ title: 'Bildirimleri silme', projectId: p.id, assigneeId: ece.id })
    await call('tasks:start', t.id)
    await settle(t.id, () => tasksRepo.get(t.id)!.status === 'done', 'approved')
    const lines = since(n)
    assert.equal(lines[0].senderType, 'system', 'a status line by the app, not in the worker\'s name')
    assert.match(lines[0].content, new RegExp(`^${ece.name} finished “Bildirimleri silme”; it has gone to the lead \\(${lead.name}\\) for review\\. Nothing needed from you\\. · ${t.key}$`))
    const approved = lines.find((l) => /approved/.test(l.content))!
    assert.equal(approved.senderType, 'system')
    assert.equal(approved.content, `${lead.name} approved “Bildirimleri silme”. Silme düğmesi yalnız Genel sekmesinde. · ${t.key}`, "the lead's summary, not its technical note")
    assert.ok(!lines.some((l) => /Kriterler karşılanıyor/.test(l.content)), 'the technical note stays on the task page')
  })

  await step('K3. "I couldn\'t verify": stays in review, the worker does not run again, the user decides — also after a restart', async () => {
    const n = general().length
    verdict = '{"approved": false, "unverifiable": true, "note": "parts 5–8 were not shown", "summary": "Dosyanın bir kısmını göremedi."}'
    const t = tasksRepo.create({ title: 'Swipe ile silme', projectId: p.id, assigneeId: ece.id })
    const runsBefore = workerRuns
    await call('tasks:start', t.id)
    await settle(t.id, () => orchestrator.state().undecided.includes(t.id), 'needs the user')
    assert.equal(tasksRepo.get(t.id)!.status, 'in_review', 'not sent back, not approved')
    assert.equal(workerRuns, runsBefore + 1, 'the worker ran once')
    assert.match(orchestrator.state().undecidedWhy[t.id], /couldn't verify the work: parts 5–8 were not shown/)
    const line = since(n).find((l) => /couldn't verify/.test(l.content))!
    assert.equal(
      line.content,
      `${lead.name} couldn't verify “Swipe ile silme”. Dosyanın bir kısmını göremedi. ${ece.name} reported it done, but it hasn't been checked. Your call: press “Retry the review”, move it to Done, or send it back to To do with a note. · ${t.key}`
    )
    assert.equal(line.senderType, 'system')
    assert.equal(line.meta.needsYou, true)
    // A restart keeps the decision with the user (and its reason); starting the work doesn't review it again.
    orchestrator.shutdown()
    o.closing = false
    orchestrator.init()
    assert.ok(orchestrator.state().undecided.includes(t.id))
    assert.match(orchestrator.state().undecidedWhy[t.id], /parts 5–8 were not shown/)
    orchestrator.startProjectWork(p.id)
    await wait(100)
    assert.ok(!o.reviewing.has(t.id) && tasksRepo.get(t.id)!.status === 'in_review', 'not reviewed or run again on its own')
    await call('tasks:move', t.id, 'done')
  })

  // TA-32: round 1 a real defect (it wrote), round 2 only read and changed nothing, sent back again.
  await step('K4. sent back, then a run that is known to have changed nothing is sent back again: it stops in review', async () => {
    const t = tasksRepo.create({ title: 'Swipe ile silme 2', projectId: p.id, assigneeId: ece.id })
    worker = (runId, taskId) => toolCall(runId, ece.id, taskId, p.id, 'Edit W:\\erkunt-mobil\\modules\\bildirimler.php', '↳ The file has been updated successfully.')
    verdict = '{"approved": false, "note": "notif.delete.btn ≠ notif.delete.button", "summary": "Sil düğmesinin metin anahtarı yanlış."}'
    let n = general().length
    await call('tasks:start', t.id)
    await settle(t.id, () => tasksRepo.get(t.id)!.status === 'todo', 'sent back')
    assert.match(since(n).at(-1)!.content, new RegExp(`^${lead.name} sent “Swipe ile silme 2” back\\. Sil düğmesinin metin anahtarı yanlış\\. It's in To do again and runs when you start it\\. · ${t.key}$`))
    // Round 2: only reads (Read + Agentbits file_read), no write, no shell — and the lead sends it back again.
    worker = (runId, taskId) => {
      toolCall(runId, ece.id, taskId, p.id, 'Read W:\\erkunt-mobil\\modules\\bildirimler.php')
      toolCall(runId, ece.id, taskId, p.id, 'mcp__agentbits__file_read ')
    }
    verdict = '{"approved": false, "note": "araç kaydı yok", "summary": "Kanıt yetersiz."}'
    const runs = workerRuns
    n = general().length
    await call('tasks:start', t.id)
    await settle(t.id, () => orchestrator.state().undecided.includes(t.id), 'stopped for the user')
    assert.equal(tasksRepo.get(t.id)!.status, 'in_review', 'stays in review (the user decides)')
    assert.equal(workerRuns, runs + 1)
    assert.ok(!orchestrator.state().held.some((h) => h.taskId === t.id), 'not a second waiting system')
    const lines = since(n).filter((l) => l.content.endsWith(` · ${t.key}`))
    assert.equal(lines.length, 2, lines.map((l) => l.content).join(' | '))
    assert.match(lines[1].content, /^“Swipe ile silme 2” isn't moving: the run after the send-back recorded no change and .* sent it back again\. It won't restart on its own\. Your call: .*press “Retry the review” or “Run the worker again”/)
    assert.ok(!lines.some((l) => /runs again|runs when you start/.test(l.content) && l !== lines[0]), 'no "it runs again" for this round')
    await call('tasks:move', t.id, 'done')
  })

  await step('K4. no earlier send-back (the lead could not verify, the user re-ran it): a first send-back returns to To do as usual', async () => {
    const t = tasksRepo.create({ title: 'First send-back', projectId: p.id, assigneeId: ece.id })
    worker = (runId, taskId) => toolCall(runId, ece.id, taskId, p.id, 'Read W:\\z.php')
    verdict = '{"approved": false, "unverifiable": true, "note": "not shown"}'
    await call('tasks:start', t.id)
    await settle(t.id, () => orchestrator.state().undecided.includes(t.id), 'needs the user')
    verdict = '{"approved": false, "note": "eksik"}'
    await call('tasks:start', t.id) // "Run the worker again"
    await settle(t.id, () => tasksRepo.get(t.id)!.status === 'todo', 'sent back')
    assert.ok(!orchestrator.state().undecided.includes(t.id), 'not stopped: there was no send-back before')
    await call('tasks:move', t.id, 'done')
  })

  await step('K4. not known to be unchanged (a shell command ran, or another provider): sent back as usual, nothing stops early', async () => {
    const t = tasksRepo.create({ title: 'Shell round', projectId: p.id, assigneeId: ece.id })
    worker = (runId, taskId) => toolCall(runId, ece.id, taskId, p.id, 'Edit W:\\x.php')
    verdict = '{"approved": false, "note": "eksik"}'
    await call('tasks:start', t.id)
    await settle(t.id, () => tasksRepo.get(t.id)!.status === 'todo', 'sent back')
    // Round 2 reads only, but a shell command ran: it may have changed files.
    worker = (runId, taskId) => {
      toolCall(runId, ece.id, taskId, p.id, 'Read W:\\x.php')
      toolCall(runId, ece.id, taskId, p.id, 'Bash php -l x.php')
    }
    await call('tasks:start', t.id)
    await settle(t.id, () => tasksRepo.get(t.id)!.status === 'todo' && runsRepo.list({ taskId: t.id }).length === 2, 'sent back again')
    assert.ok(!orchestrator.state().undecided.includes(t.id))
    // Round 3 calls a tool that may write (not an Agentbits read tool): still unknown.
    worker = (runId, taskId) => toolCall(runId, ece.id, taskId, p.id, 'mcp__agentbits__file_save ')
    await call('tasks:start', t.id)
    await settle(t.id, () => tasksRepo.get(t.id)!.status === 'todo' && runsRepo.list({ taskId: t.id }).length === 3, 'sent back a third time')
    assert.ok(!orchestrator.state().undecided.includes(t.id))
    await call('tasks:move', t.id, 'done')
  })

  await step('K4/K5. the round limit: one #general line that says it stopped and what the user can do (no "runs again")', async () => {
    const t = tasksRepo.create({ title: 'Limit', projectId: p.id, assigneeId: ece.id })
    worker = (runId, taskId) => toolCall(runId, ece.id, taskId, p.id, 'Edit W:\\y.php')
    verdict = '{"approved": false, "note": "eksik"}'
    for (let i = 1; i <= 4; i++) {
      const n = general().length
      await call('tasks:start', t.id)
      await settle(t.id, () => tasksRepo.get(t.id)!.status === 'todo' && runsRepo.list({ taskId: t.id }).length === i, `round ${i}`)
      if (i === 4) {
        const lines = since(n).filter((l) => l.content.endsWith(` · ${t.key}`))
        assert.equal(lines.length, 2, lines.map((l) => l.content).join(' | '))
        assert.equal(lines[1].content, `“Limit” was sent back 4 times; it won't restart on its own. Your call: check the lead's note on the task page, then press “Try again”, edit the task, or move it to Done. · ${t.key}`)
        assert.equal(lines[1].meta.needsYou, true)
      }
    }
    assert.ok(orchestrator.state().held.some((h) => h.taskId === t.id))
  })

  await step('K6. an approval turned into a send-back by an unmet criterion: its "all good" summary is not shown', async () => {
    worker = (runId, taskId) => toolCall(runId, ece.id, taskId, p.id, 'Edit W:\\c.php')
    verdict = '{"approved": true, "note": "ok", "summary": "Her şey tamam.", "criteria": [{"met": false, "note": "test yok"}]}'
    const n = general().length
    const t = tasksRepo.create({ title: 'Criteria', projectId: p.id, assigneeId: ece.id, acceptance: 'Tests pass' })
    await call('tasks:start', t.id)
    await settle(t.id, () => tasksRepo.get(t.id)!.status === 'todo', 'sent back')
    const line = since(n).filter((l) => l.content.endsWith(` · ${t.key}`)).at(-1)!
    assert.match(line.content, /sent “Criteria” back\. It's in To do again/)
    assert.doesNotMatch(line.content, /Her şey tamam/)
    await call('tasks:move', t.id, 'done')
  })

  await step('K6. lead review off: one line that says the user decides', async () => {
    settingsRepo.update({ reviewByLead: false })
    worker = () => undefined
    let n = general().length
    const t = tasksRepo.create({ title: 'Review off', projectId: p.id, assigneeId: ece.id })
    await call('tasks:start', t.id)
    await until(() => tasksRepo.get(t.id)!.status === 'in_review', 'in review')
    agentsRepo.setStatus(ece.id, 'idle')
    const off = since(n).filter((l) => l.content.endsWith(` · ${t.key}`))
    assert.deepEqual(off.map((l) => l.content), [`${ece.name} finished “Review off”. Lead review is off, so it's your call: move it to Done or send it back to To do with a note. · ${t.key}`])
    settingsRepo.update({ reviewByLead: true })
  })

  console.log(`reviewLoop e2e: ${count} steps ok`)
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e)
    process.exit(1)
  }
)
