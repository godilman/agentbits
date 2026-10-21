// Project-folder files that are no longer on disk: what the review, file_read and file_search see (real SQLite, real
// temp folders, Claude Code stubbed). "Not on disk" is told apart from "this run removed it", and from a folder or file
// that can't be checked; no earlier text comes back as current.
// Run: npm run test:e2e
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, renameSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDb, openDb } from '../../src/main/db'
import { agentsRepo, settingsRepo, tasksRepo } from '../../src/main/db/repos'
import { handlers } from '../../src/main/ipc'
import { orchestrator } from '../../src/main/core/orchestrator'
import { projectLead, projectMembers } from '../../src/main/core/org'
import { runEvidence } from '../../src/main/core/evidence'
import { filesRepo } from '../../src/main/files/repo'
import {
  checkOnDisk,
  disappearedSince,
  filesSection,
  generatedFor,
  processFile,
  resumeProcessing,
  toolFileRead,
  toolFileSearch,
  workspacePresent,
  type WorkerResult
} from '../../src/main/files/service'
import { getAdapter } from '../../src/main/providers'
import { applyLanguageSetting } from '../../src/main/i18n'
import type { FileRecord } from '../../src/shared/types'
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
const sh = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
const result = (text: string): WorkerResult => ({
  kind: 'text',
  mime: 'text/plain',
  status: 'ready',
  message: null,
  chunks: [{ label: 'Text (1/1)', text }],
  chars: text.length,
  pages: null,
  sheets: null,
  width: null,
  height: null,
  encoding: 'utf-8',
  warnings: [],
  suspicious: []
})

async function main(): Promise<void> {
  openDb()
  settingsRepo.update({ onboarded: true, autopilot: false, reviewByLead: true, raceMode: false, language: 'en', autoRecovery: false })
  applyLanguageSetting('en')
  const tpl = await call('templates:instantiate', 'ecommerce')
  const root = mkdtempSync(join(tmpdir(), 'ab-mf-'))
  const p = await call('projects:save', { name: 'Shared', rootPath: root, unitIds: [tpl.unitId] })
  orchestrator.init()
  getDb().prepare('UPDATE agent_permissions SET require_approval = 0, fs_write = 1').run()
  const lead = projectLead(p.id)!
  const [dev, dev2] = projectMembers(p.id).filter((a) => !a.isLead && a.id !== lead.id)
  // The worker and the lead on "Claude Code" (stubbed): the worker changes the folder as `work` says.
  getDb()
    .prepare("INSERT INTO providers (id, kind, label, model, cli_path, is_default) VALUES ('cc-test', 'claude-cli', 'Claude Code', 'opus', 'claude', 0)")
    .run()
  getDb().prepare("UPDATE agents SET provider_id = 'cc-test' WHERE id IN (?, ?, ?)").run(dev.id, dev2.id, lead.id)
  let work: (ctx: RunContext) => void = () => undefined
  const reviews: string[] = []
  getAdapter('claude-cli').run = async (ctx: RunContext) => {
    if (ctx.mode === 'review') {
      reviews.push(ctx.prompt)
      return { text: '{"approved": true, "note": "ok"}', tokensIn: 1, tokensOut: 1, costUsd: 0 }
    }
    ctx.onUsage?.({ input: 1, output: 1, cacheRead: 0, cacheWrite: 0, costUsd: 0 })
    work(ctx)
    return { text: 'report: done', tokensIn: 1, tokensOut: 1, costUsd: 0 }
  }

  /** A project-folder file as Agentbits keeps it once read in (the extraction worker isn't part of this test). */
  const seed = async (dir: string, projectId: string, rel: string, text: string): Promise<FileRecord> => {
    mkdirSync(join(dir, rel, '..'), { recursive: true })
    writeFileSync(join(dir, rel), text)
    const name = rel.split('/').at(-1)!
    const f = filesRepo.create({ projectId, name, ext: name.split('.').at(-1)!, mime: 'text/plain', kind: 'text', size: text.length, sha256: '', origin: 'workspace', createdByType: 'agent', createdById: dev.id, relPath: rel })
    filesRepo.update(f.id, { projectShared: true })
    filesRepo.setChunks(f.id, [{ label: 'Text (1/1)', text }])
    filesRepo.update(f.id, { status: 'ready', statusMessage: null, chars: text.length, chunkCount: 1 })
    return filesRepo.get(f.id)!
  }
  /** A task of `dev` that runs `run`, then the lead's review; returns the review prompt and the run. */
  const runTask = async (projectId: string, title: string, run: (ctx: RunContext) => void, attach: FileRecord[] = []) => {
    work = run
    const n = reviews.length
    const t = tasksRepo.create({ title, projectId, assigneeId: dev.id })
    for (const f of attach) filesRepo.link(f.id, 'task', t.id, 'attached')
    agentsRepo.setStatus(dev.id, 'idle')
    await call('tasks:start', t.id)
    await until(() => reviews.length > n && !o.reviewing.has(t.id), 'reviewed', 15_000)
    const runId = (getDb().prepare('SELECT id FROM runs WHERE task_id = ? ORDER BY rowid DESC LIMIT 1').get(t.id) as { id: string }).id
    agentsRepo.setStatus(dev.id, 'idle')
    return { task: t, prompt: reviews.at(-1)!, runId }
  }
  // Every file in focus: whatever text is kept for it would be inlined (so "not shown" is really tested).
  const leadSees = (projectId: string, taskId: string | null = null): string =>
    filesSection({
      agentId: lead.id,
      projectId,
      taskId,
      focusIds: filesRepo.list({ projectId }).map((f) => f.id),
      toolsAvailable: false,
      vision: 'none',
      budget: 60_000
    }).text
  const ctxOf = (projectId: string, taskId: string | null = null) => ({ agentId: lead.id, projectId, taskId, runId: null, mode: 'task' }) as any
  const NOT_FOUND = (name: string): RegExp => new RegExp(`${name.replace('.', '\\.')} — .*NOT FOUND in the project folder when checked`)
  const LOST_LINE = /Present in the project folder when the run started, not found when it ended: (.+)\. The folder is shared, so this run may have removed them or someone else did — not known which\./

  await step('a recorded file the run removed: the review sees it is not there (no old text), "not known who"; record and history kept', async () => {
    const f = await seed(root, p.id, 'electron/main.js', 'console.log("OLD CONTENT")')
    const links = filesRepo.links(f.id).length
    const { prompt, runId } = await runTask(p.id, 'Remove the Electron files', (ctx) => unlinkSync(join(ctx.cwd, 'electron/main.js')), [f])
    assert.match(prompt, NOT_FOUND('main.js'))
    assert.ok(!prompt.includes('OLD CONTENT'), 'its earlier text is not given as current')
    assert.match(prompt, LOST_LINE)
    assert.equal(LOST_LINE.exec(prompt)![1], 'electron/main.js')
    assert.ok(!leadSees(p.id).includes('OLD CONTENT'))
    assert.deepEqual(runEvidence(runId)!.lostFiles, ['electron/main.js'])
    const now = filesRepo.get(f.id)!
    assert.ok(now.missingAt, 'kept as a record, marked missing')
    assert.equal(now.chunkCount, 0)
    assert.equal(filesRepo.chunks(f.id).length, 0)
    assert.ok(filesRepo.links(f.id).length >= links, 'its links (history) stay')
    // Reading and searching: nothing of the earlier text.
    const read = toolFileRead(ctxOf(p.id), now.id.slice(0, 8))
    assert.ok(read.isError)
    assert.match(read.text, /Not found in the project folder/)
    assert.equal(toolFileSearch(ctxOf(p.id), 'OLD CONTENT').text, 'No matches.')
    assert.equal((await call('files:search', p.id, 'OLD CONTENT')).length, 0)
  })

  await step('a rename (no proof that it is one): the old path is missing, the new one a new file of the run', async () => {
    const a = await seed(root, p.id, 'src/a.js', 'export const A = 1')
    const old = new Date(Date.now() - 3_600_000)
    utimesSync(join(root, 'src/a.js'), old, old) // written long before the run; a rename keeps that mtime
    const { prompt, runId } = await runTask(p.id, 'Tidy up src', (ctx) => renameSync(join(ctx.cwd, 'src/a.js'), join(ctx.cwd, 'src/b.js')))
    assert.ok(filesRepo.get(a.id)!.missingAt)
    assert.match(prompt, NOT_FOUND('a.js'))
    assert.equal(LOST_LINE.exec(prompt)![1], 'src/a.js')
    const b = filesRepo.findWorkspace(p.id, 'src/b.js')
    assert.ok(b, 'the new path is recorded (a rename keeps the mtime; the ctime tells it is new here)')
    assert.notEqual(b!.id, a.id, 'a new record, not the old one carried over')
    assert.ok(generatedFor(runId).some((x) => x.id === b!.id))
    assert.ok(!/\b(renamed|moved)\b/i.test(prompt), 'no rename is claimed')
  })

  await step('found again at the same path: read in anew; neither the old text nor the "missing" mark stays', async () => {
    const f = filesRepo.findWorkspace(p.id, 'electron/main.js')!
    assert.ok(f.missingAt)
    writeFileSync(join(root, 'electron/main.js'), 'console.log("NEW CONTENT")') // put back by the user
    leadSees(p.id) // any read checks it
    const back = filesRepo.get(f.id)!
    assert.equal(back.missingAt, null)
    assert.equal(back.status, 'processing', 'read in anew')
    assert.equal(back.statusMessage, null)
    assert.match(leadSees(p.id), /main\.js — .*being updated/)
    // Its read-in ends (stubbed: the real worker isn't part of this test) with the content now on disk.
    await processFile(f.id, join(root, 'electron/main.js'), 'electron/main.js', async (path) => result(readFileSync(path, 'utf8')))
    const text = leadSees(p.id)
    assert.ok(text.includes('NEW CONTENT'))
    assert.ok(!text.includes('OLD CONTENT'))
    assert.doesNotMatch(text, NOT_FOUND('main.js'))
  })

  await step('removed by someone else before the run, or between the run and its review: "not found", never put on the run', async () => {
    // Before: the user removes it, then a run (that touches nothing) is reviewed.
    const before = await seed(root, p.id, 'docs/before.md', 'BEFORE TEXT')
    unlinkSync(join(root, 'docs/before.md'))
    const r1 = await runTask(p.id, 'Unrelated work', () => undefined)
    assert.match(r1.prompt, NOT_FOUND('before.md'))
    assert.ok(!r1.prompt.includes('BEFORE TEXT'))
    assert.doesNotMatch(r1.prompt, LOST_LINE)
    assert.deepEqual(runEvidence(r1.runId)!.lostFiles, [])
    assert.ok(filesRepo.get(before.id)!.missingAt)
    // Also one nobody had looked at since (not shared with the worker, so its prompt didn't check it): not put on the run.
    const hidden = await seed(root, p.id, 'docs/hidden.md', 'HIDDEN TEXT')
    filesRepo.update(hidden.id, { projectShared: false })
    unlinkSync(join(root, 'docs/hidden.md'))
    const r0 = await runTask(p.id, 'Unrelated work again', () => undefined)
    assert.deepEqual(runEvidence(r0.runId)!.lostFiles, [], 'gone before the run started')
    // Another agent's run removed it (dev2): a later run of dev is not blamed.
    await seed(root, p.id, 'docs/other.md', 'OTHER TEXT')
    unlinkSync(join(root, 'docs/other.md')) // as dev2's run would
    const r2 = await runTask(p.id, 'More unrelated work', () => undefined)
    assert.doesNotMatch(r2.prompt, LOST_LINE)
    // Between: present when the run ended, gone before the review is prepared.
    settingsRepo.update({ reviewByLead: false })
    const late = await seed(root, p.id, 'docs/late.md', 'LATE TEXT')
    work = () => undefined
    const t = tasksRepo.create({ title: 'Reviewed later', projectId: p.id, assigneeId: dev.id })
    filesRepo.link(late.id, 'task', t.id, 'attached')
    await call('tasks:start', t.id)
    await until(() => tasksRepo.get(t.id)!.status !== 'in_progress' && !o.active.size, 'the run to end')
    agentsRepo.setStatus(dev.id, 'idle')
    assert.equal(filesRepo.get(late.id)!.missingAt, null, 'still there when the run ended')
    unlinkSync(join(root, 'docs/late.md'))
    settingsRepo.update({ reviewByLead: true })
    tasksRepo.update(t.id, { status: 'in_review' })
    const n = reviews.length
    o.queueReview(t.id)
    await until(() => reviews.length > n && !o.reviewing.has(t.id), 'reviewed')
    const prompt = reviews.at(-1)!
    assert.match(prompt, NOT_FOUND('late.md'))
    assert.ok(!prompt.includes('LATE TEXT'), 'checked when the review is prepared, not only at the end of the run')
    assert.doesNotMatch(prompt, LOST_LINE)
  })

  await step("a folder or file that can't be checked is not missing: nothing marked, no text given, back when reachable", async () => {
    const root2 = mkdtempSync(join(tmpdir(), 'ab-mf2-'))
    const p2 = await call('projects:save', { name: 'Unplugged', rootPath: root2, unitIds: [tpl.unitId] })
    const f = await seed(root2, p2.id, 'notes.md', 'STORED TEXT')
    const g = await seed(root2, p2.id, 'locked/secret.md', 'LOCKED TEXT')
    const present = workspacePresent(p2.id)
    assert.equal(present.size, 2)
    // The whole project folder unreachable (an unplugged drive, a moved folder).
    renameSync(root2, `${root2}-away`)
    let text = leadSees(p2.id)
    assert.match(text, /notes\.md — .*The project folder couldn't be checked \(ENOENT\)/)
    assert.ok(!text.includes('STORED TEXT'))
    assert.doesNotMatch(text, /NOT FOUND/)
    assert.equal(disappearedSince(present).length, 0, 'an unreachable folder is not "everything removed"')
    assert.equal(filesRepo.get(f.id)!.missingAt, null)
    assert.equal(filesRepo.get(f.id)!.chunkCount, 1, 'nothing persisted')
    assert.match(toolFileRead(ctxOf(p2.id), f.id.slice(0, 8)).text, /couldn't be checked/)
    assert.equal(toolFileSearch(ctxOf(p2.id), 'STORED').text, 'No matches.')
    assert.equal((await call('files:search', p2.id, 'STORED')).length, 0, "the user's search: no text that can't be checked")
    renameSync(`${root2}-away`, root2)
    assert.ok(leadSees(p2.id).includes('STORED TEXT'), 'reachable again: its text is current again')
    // One folder without access (POSIX permissions; root ignores them, so skipped there).
    if (process.getuid?.() !== 0 && process.platform !== 'win32') {
      chmodSync(join(root2, 'locked'), 0o000)
      try {
        text = leadSees(p2.id)
        assert.match(text, /secret\.md — .*couldn't be checked \(EACCES\)/)
        assert.ok(!text.includes('LOCKED TEXT'))
        assert.equal(disappearedSince(present).length, 0)
        assert.equal(filesRepo.get(g.id)!.missingAt, null, 'an access error is not a removal')
      } finally {
        chmodSync(join(root2, 'locked'), 0o755)
      }
    }
  })

  await step('a read-in still running when the file goes missing: its late result writes nothing (newest attempt only)', async () => {
    const f = await seed(root, p.id, 'slow.txt', 'FIRST')
    let finish!: (r: WorkerResult) => void
    const done = processFile(f.id, join(root, 'slow.txt'), 'slow.txt', () => new Promise<WorkerResult>((r) => (finish = r)))
    unlinkSync(join(root, 'slow.txt'))
    checkOnDisk([filesRepo.get(f.id)!])
    assert.ok(filesRepo.get(f.id)!.missingAt)
    finish(result('STALE TEXT'))
    await done
    const now = filesRepo.get(f.id)!
    assert.ok(now.missingAt, 'still missing')
    assert.equal(now.chunkCount, 0)
    assert.equal(filesRepo.chunks(f.id).length, 0)
    assert.ok(!leadSees(p.id).includes('STALE TEXT'))
    // Also a late failure: the status stays "not found".
    const g = await seed(root, p.id, 'slow2.txt', 'FIRST')
    let fail!: (e: Error) => void
    const done2 = processFile(g.id, join(root, 'slow2.txt'), 'slow2.txt', () => new Promise<WorkerResult>((_, rej) => (fail = rej)))
    unlinkSync(join(root, 'slow2.txt'))
    checkOnDisk([filesRepo.get(g.id)!])
    fail(new Error('late failure'))
    await done2
    assert.match(filesRepo.get(g.id)!.statusMessage!, /Not found in the project folder/)
  })

  await step('after a restart, a read-in left unfinished: a missing file is marked missing, an unreachable folder is not', async () => {
    const f = await seed(root, p.id, 'resume/a.txt', 'A')
    filesRepo.update(f.id, { status: 'processing' })
    unlinkSync(join(root, 'resume/a.txt'))
    const root3 = mkdtempSync(join(tmpdir(), 'ab-mf3-'))
    const p3 = await call('projects:save', { name: 'Away', rootPath: root3, unitIds: [tpl.unitId] })
    const g = await seed(root3, p3.id, 'b.txt', 'B')
    filesRepo.update(g.id, { status: 'processing' })
    renameSync(root3, `${root3}-away`)
    resumeProcessing()
    assert.ok(filesRepo.get(f.id)!.missingAt)
    assert.equal(filesRepo.get(g.id)!.missingAt, null)
    assert.equal(filesRepo.get(g.id)!.status, 'failed')
    assert.match(filesRepo.get(g.id)!.statusMessage!, /The project folder couldn't be checked \(ENOENT\)/)
    renameSync(`${root3}-away`, root3)
  })

  await step('opening a file directly (no listing first): the preview and its details are checked on disk too', async () => {
    const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
    const preview = (id: string) => call('files:preview', id, 0, 30)
    // Removed → previewed at once: no stored text, the reason given.
    const f = await seed(root, p.id, 'pv/removed.md', 'PREVIEW OLD')
    unlinkSync(join(root, 'pv/removed.md'))
    let v = await preview(f.id)
    assert.deepEqual(v.chunks, [])
    assert.equal(v.total, 0)
    assert.ok(v.file.missingAt)
    assert.match(v.file.statusMessage, /Not found in the project folder/)
    assert.ok((await call('files:get', f.id)).file.missingAt)
    // No access to its folder → previewed: no text, "couldn't be checked", nothing persisted.
    const g = await seed(root, p.id, 'pvlock/locked.md', 'PREVIEW LOCKED')
    if (process.getuid?.() !== 0 && process.platform !== 'win32') {
      chmodSync(join(root, 'pvlock'), 0o000)
      try {
        v = await preview(g.id)
        assert.deepEqual(v.chunks, [])
        assert.match(v.file.statusMessage, /couldn't be checked \(EACCES\)/)
        assert.equal(v.file.missingAt, null)
        assert.match((await call('files:get', g.id)).file.statusMessage, /couldn't be checked/)
      } finally {
        chmodSync(join(root, 'pvlock'), 0o755)
      }
      assert.equal(filesRepo.get(g.id)!.chunkCount, 1, 'not persisted')
    }
    // The whole folder unreachable → previewed.
    const root4 = mkdtempSync(join(tmpdir(), 'ab-mf4-'))
    const p4 = await call('projects:save', { name: 'Preview away', rootPath: root4, unitIds: [tpl.unitId] })
    const h = await seed(root4, p4.id, 'x.md', 'PREVIEW AWAY')
    const img = await seed(root4, p4.id, 'pic.png', '')
    writeFileSync(join(root4, 'pic.png'), PNG)
    filesRepo.update(img.id, { kind: 'image', mime: 'image/png', size: PNG.length })
    assert.ok((await preview(img.id)).imageDataUrl, 'a project-folder image on disk is shown')
    renameSync(root4, `${root4}-away`)
    v = await preview(h.id)
    assert.deepEqual(v.chunks, [])
    assert.match(v.file.statusMessage, /couldn't be checked \(ENOENT\)/)
    assert.equal((await preview(img.id)).imageDataUrl, null)
    renameSync(`${root4}-away`, root4)
    // Recreated at the same path → previewed while it is read in again: no earlier text or image, "processing".
    writeFileSync(join(root, 'pv/removed.md'), 'PREVIEW NEW')
    v = await preview(f.id)
    assert.equal(v.file.status, 'processing')
    assert.equal(v.file.missingAt, null)
    assert.deepEqual(v.chunks, [])
    unlinkSync(join(root4, 'pic.png'))
    assert.equal((await preview(img.id)).imageDataUrl, null, 'removed image: none')
    writeFileSync(join(root4, 'pic.png'), PNG)
    v = await preview(img.id)
    assert.equal(v.file.status, 'processing')
    assert.equal(v.imageDataUrl, null, 'being read in again: no image yet')
    // A stored text kept while it is read in again (e.g. left by an earlier session) is not shown either.
    const k = await seed(root, p.id, 'pv/kept.md', 'PREVIEW KEPT')
    filesRepo.update(k.id, { status: 'processing' })
    assert.deepEqual((await preview(k.id)).chunks, [])
    // Uploads (not project-folder files) behave as before.
    const up = await call('files:addData', p.id, 'upload.png', new Uint8Array(PNG))
    assert.equal(filesRepo.get(up.id)!.status, 'processing')
    assert.ok((await preview(up.id)).imageDataUrl, 'an uploaded image is shown while it is read in (its stored original is current)')
    await until(() => filesRepo.get(up.id)?.status !== 'processing', 'the upload read-in to end')
    assert.ok((await preview(up.id)).imageDataUrl, 'an uploaded image is shown')
    const txt = await call('files:addData', p.id, 'upload.md', new TextEncoder().encode('UPLOAD TEXT'))
    await until(() => filesRepo.get(txt.id)?.status !== 'processing', 'the upload read-in to end')
    filesRepo.setChunks(txt.id, [{ label: 'Text (1/1)', text: 'UPLOAD TEXT' }])
    filesRepo.update(txt.id, { status: 'ready', chars: 11, chunkCount: 1 })
    v = await preview(txt.id)
    assert.equal(v.chunks[0].text, 'UPLOAD TEXT')
    assert.equal(v.total, 1)
  })

  await step('worktree project: the run works in its copy; the project folder is checked, nothing is put on the run', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'ab-mfwt-'))
    sh(repo, 'init', '-q')
    sh(repo, 'config', 'user.email', 't@example.com')
    sh(repo, 'config', 'user.name', 'T')
    writeFileSync(join(repo, 'keep.js'), 'KEEP TEXT')
    writeFileSync(join(repo, 'gone.js'), 'GONE TEXT')
    sh(repo, 'add', '.')
    sh(repo, 'commit', '-qm', 'init')
    const wp = await call('projects:save', { name: 'Worktree', rootPath: repo, unitIds: [tpl.unitId], isolation: 'worktree' })
    const keep = await seed(repo, wp.id, 'keep.js', 'KEEP TEXT')
    const gone = await seed(repo, wp.id, 'gone.js', 'GONE TEXT')
    const { prompt, runId } = await runTask(wp.id, 'Work in the copy', (ctx) => {
      assert.notEqual(ctx.cwd, repo, 'runs in its own copy')
      unlinkSync(join(ctx.cwd, 'keep.js')) // its own change: in the copy (git shows it), not in the project folder
      unlinkSync(join(repo, 'gone.js')) // someone else, in the project folder meanwhile
    })
    assert.equal(filesRepo.get(keep.id)!.missingAt, null, 'still in the project folder')
    assert.ok(prompt.includes('KEEP TEXT'), 'the project folder copy is what it is')
    assert.match(prompt, /Files changed \(git\): keep\.js/)
    assert.match(prompt, NOT_FOUND('gone.js'))
    assert.ok(!prompt.includes('GONE TEXT'))
    assert.doesNotMatch(prompt, LOST_LINE, 'no start/end comparison of the project folder for a worktree run')
    assert.deepEqual(runEvidence(runId)!.lostFiles, [])
    assert.ok(filesRepo.get(gone.id)!.missingAt)
  })

  console.log(`missingFiles e2e: ${count} steps ok`)
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e)
    process.exit(1)
  }
)
