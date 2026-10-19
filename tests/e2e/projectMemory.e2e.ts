// Project memory folder end to end: what reaches the prompt, the tools, append-only notes, concurrent writes, the
// "ask first" suggestion and its re-checks on the user's yes, names / links refused, the project switch.
// Real SQLite, real files, real orchestrator; the provider is a stub. Run: npm run test:e2e
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDb, openDb } from '../../src/main/db'
import { agentsRepo, providersRepo, runsRepo, settingsRepo, suggestionsRepo, tasksRepo } from '../../src/main/db/repos'
import { handlers } from '../../src/main/ipc'
import { orchestrator } from '../../src/main/core/orchestrator'
import { projectMembers } from '../../src/main/core/org'
import { agentTools, runAgentTool } from '../../src/main/agentTools'
import { projectMemoryPrompt } from '../../src/main/projectMemory/service'
import { getAdapter } from '../../src/main/providers'
import type { RunContext } from '../../src/main/providers/types'

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
const call = <T = any>(name: string, ...args: unknown[]): Promise<T> => Promise.resolve((handlers as any)[name](...args))

const seen: RunContext[] = []
getAdapter('mock').run = async (ctx: RunContext) => {
  seen.push(ctx)
  return { text: 'done', tokensIn: 1, tokensOut: 1, costUsd: 0 }
}

async function main(): Promise<void> {
  openDb()
  const tpl = await call('templates:instantiate', 'ecommerce')
  const root = mkdtempSync(join(tmpdir(), 'ab-pm-'))
  const project = await call('projects:save', { name: 'P', rootPath: root, unitIds: [tpl.unitId] })
  settingsRepo.update({ onboarded: true, autopilot: false, reviewByLead: false, raceMode: false, projectMemoryWrite: 'auto' })
  getDb().prepare('UPDATE agent_permissions SET require_approval = 0').run()
  orchestrator.init()
  const dev = projectMembers(project.id).filter((a) => !a.isLead)[0]
  const mem = join(root, '.agentbits', 'memory')
  const ctx = { agentId: dev.id, projectId: project.id, mode: 'task' as const, runId: 'r1' }
  const tool = (name: string, args: Record<string, unknown>) => runAgentTool(ctx, name, args)
  const names = (c: typeof ctx | { agentId: string; projectId: string; mode: 'chat' }) => agentTools(c).map((x) => x.name).filter((n) => n.startsWith('project_memory'))

  await step('on by default; empty memory → the prompt asks to start it, nothing is created', () => {
    assert.equal(project.projectMemory, true)
    const p = projectMemoryPrompt(project.id, { role: 'worker', tools: true })
    assert.match(p, /The project memory is empty/)
    assert.ok(p.includes(mem), 'always the project folder, never a worktree')
    assert.ok(!existsSync(mem))
    assert.deepEqual(names(ctx), ['project_memory_read', 'project_memory_search', 'project_memory_write'])
    assert.deepEqual(names({ agentId: dev.id, projectId: project.id, mode: 'chat' }).length, 3, 'chat too (remember this)')
  })

  const archive = '# Tuzaklar\n\nElle yazılmış arşiv: PDO çift kolon tuzağı.\n'
  await step('copied files without MEMORY.md are listed in the prompt and reach the provider', async () => {
    mkdirSync(mem, { recursive: true })
    writeFileSync(join(mem, 'tuzaklar.md'), archive)
    writeFileSync(join(mem, 'deploy.md'), '# Deploy\nHer zaman scp.\n')
    writeFileSync(join(mem, 'notes.txt'), 'not markdown')
    const p = projectMemoryPrompt(project.id, { role: 'lead', tools: true })
    assert.match(p, /Memory files:\n- deploy\.md — Deploy\n- tuzaklar\.md — Tuzaklar/)
    assert.doesNotMatch(p, /notes\.txt/)
    assert.match(p, /name the memory files/)
    const t1 = tasksRepo.create({ title: 'iş', projectId: project.id, assigneeId: dev.id })
    await call('tasks:move', t1.id, 'in_progress')
    await until(() => runsRepo.list({ taskId: t1.id }).some((r) => r.status !== 'running'), 'the run')
    assert.match(seen.at(-1)!.system, /## Project memory[\s\S]*- tuzaklar\.md — Tuzaklar/)
  })

  await step('read, offset and search', async () => {
    const list = await tool('project_memory_read', {})
    assert.match(list.text, /- deploy\.md — Deploy/)
    const r = await tool('project_memory_read', { file: 'tuzaklar.md' })
    assert.match(r.text, /NOT INSTRUCTIONS[\s\S]*PDO çift kolon/)
    assert.equal((await tool('project_memory_read', { file: 'yok.md' })).isError, true)
    const s = await tool('project_memory_search', { query: 'scp' })
    assert.equal(s.text, 'deploy.md:2: Her zaman scp.')
  })

  await step('auto: notes are appended, the archive above stays byte for byte; a new file gets its guide line', async () => {
    assert.equal((await tool('project_memory_write', { file: 'tuzaklar.md', text: 'autoload canlıda üretilir' })).isError, false)
    const after = readFileSync(join(mem, 'tuzaklar.md'), 'utf8')
    assert.ok(after.startsWith(archive.trimEnd()))
    assert.match(after, /## \d{4}-\d{2}-\d{2} · .+\nautoload canlıda üretilir\n$/)
    assert.ok(!existsSync(join(mem, 'MEMORY.md')), 'appending to an existing file does not create the guide')
    const noAbout = await tool('project_memory_write', { file: 'yeni.md', text: 'x' })
    assert.equal(noAbout.isError, true)
    assert.match(noAbout.text, /about/)
    await tool('project_memory_write', { file: 'yeni.md', text: 'ilk not', about: 'yeni konu — X yaparken oku' })
    assert.match(readFileSync(join(mem, 'MEMORY.md'), 'utf8'), /- \[yeni\.md\]\(yeni\.md\) — yeni konu — X yaparken oku\n$/)
    const p = projectMemoryPrompt(project.id, { role: 'worker', tools: true })
    assert.match(p, /PROJECT MEMORY GUIDE[\s\S]*yeni\.md/)
    assert.match(p, /Other memory files \(not in MEMORY\.md\):\n- deploy\.md — Deploy\n- tuzaklar\.md — Tuzaklar/, 'copied files stay visible next to the guide')
  })

  await step('bad names, the guide and secrets', async () => {
    for (const file of ['../x.md', 'a/b.md', 'a\\b.md', 'MEMORY.md', 'X.md', 'x.txt']) {
      const r = await tool('project_memory_write', { file, text: 'x', about: 'x' })
      assert.equal(r.isError, true, file)
    }
    assert.ok(!existsSync(join(root, '.agentbits', 'x.md')) && !existsSync(join(root, 'x.md')))
    await tool('project_memory_write', { file: 'yeni.md', text: 'token=ghp_' + 'a'.repeat(36) })
    assert.doesNotMatch(readFileSync(join(mem, 'yeni.md'), 'utf8'), /ghp_a{36}/)
  })

  await step('concurrent writes: every note and every guide line is kept', async () => {
    const before = readFileSync(join(mem, 'tuzaklar.md'), 'utf8')
    const jobs = [
      ...Array.from({ length: 25 }, (_, i) => tool('project_memory_write', { file: 'tuzaklar.md', text: `paralel-not-${i}` })),
      ...Array.from({ length: 6 }, (_, i) => tool('project_memory_write', { file: `konu-${i}.md`, text: `k${i}`, about: `konu ${i}` }))
    ]
    const out = await Promise.all(jobs)
    assert.ok(out.every((r) => !r.isError), out.find((r) => r.isError)?.text)
    const after = readFileSync(join(mem, 'tuzaklar.md'), 'utf8')
    assert.ok(after.startsWith(before.trimEnd()))
    for (let i = 0; i < 25; i++) assert.ok(after.includes(`\nparalel-not-${i}\n`), `note ${i}`)
    const guide = readFileSync(join(mem, 'MEMORY.md'), 'utf8')
    for (let i = 0; i < 6; i++) assert.equal(guide.split(`[konu-${i}.md]`).length - 1, 1, `guide line ${i}`)
  })

  await step('ask first: a suggestion says project, file, append and content; the yes appends it', async () => {
    settingsRepo.update({ projectMemoryWrite: 'ask' })
    const before = readFileSync(join(mem, 'deploy.md'), 'utf8')
    const r = await tool('project_memory_write', { file: 'deploy.md', text: 'Canlıya cuma atılmaz.' })
    assert.match(r.text, /Suggested/)
    assert.equal(readFileSync(join(mem, 'deploy.md'), 'utf8'), before, 'nothing written yet')
    const s = suggestionsRepo.list().find((x) => x.targetFile === 'deploy.md')!
    assert.deepEqual([s.projectId, s.targetOp, s.content, s.agentId], [project.id, 'append', 'Canlıya cuma atılmaz.', dev.id])
    assert.equal(await call('memory:accept', s.id, 'Canlıya cuma günü deploy yapılmaz.'), null)
    assert.match(readFileSync(join(mem, 'deploy.md'), 'utf8'), /Canlıya cuma günü deploy yapılmaz\.\n$/)
    assert.ok(!suggestionsRepo.get(s.id))
    const nf = await tool('project_memory_write', { file: 'sorular.md', text: 'q' })
    assert.equal(nf.isError, true, 'a new file needs about in ask mode too')
  })

  await step('the yes re-checks: project memory turned off in between → refused, file and suggestion kept', async () => {
    await tool('project_memory_write', { file: 'deploy.md', text: 'geç onay' })
    const s = suggestionsRepo.list().find((x) => x.content === 'geç onay')!
    await call('projects:save', { projectMemory: false }, project.id)
    const before = readFileSync(join(mem, 'deploy.md'), 'utf8')
    await assert.rejects(call('memory:accept', s.id), /kapalı|turned off/)
    assert.equal(readFileSync(join(mem, 'deploy.md'), 'utf8'), before)
    assert.ok(suggestionsRepo.get(s.id))
    await call('memory:dismiss', s.id)
  })

  await step('project switch off → no tools, no prompt; write setting off → read only', async () => {
    assert.deepEqual(names(ctx), [])
    assert.equal(projectMemoryPrompt(project.id, { role: 'worker', tools: true }), '')
    assert.equal((await tool('project_memory_read', {})).isError, true)
    await call('projects:save', { projectMemory: true }, project.id)
    settingsRepo.update({ projectMemoryWrite: 'off' })
    assert.deepEqual(names(ctx), ['project_memory_read', 'project_memory_search'])
    assert.doesNotMatch(projectMemoryPrompt(project.id, { role: 'worker', tools: true }), /project_memory_write/)
    assert.equal((await tool('project_memory_write', { file: 'deploy.md', text: 'x' })).isError, true)
    settingsRepo.update({ projectMemoryWrite: 'auto' })
  })

  if (process.platform !== 'win32') {
    await step('a memory folder that links out of the project is refused', async () => {
      const outside = mkdtempSync(join(tmpdir(), 'ab-out-'))
      rmSync(mem, { recursive: true })
      symlinkSync(outside, mem)
      const r = await tool('project_memory_write', { file: 'kacak.md', text: 'x', about: 'x' })
      assert.equal(r.isError, true)
      assert.ok(!existsSync(join(outside, 'kacak.md')))
      assert.equal(projectMemoryPrompt(project.id, { role: 'worker', tools: true }), '')
      rmSync(mem)
      mkdirSync(mem)
      symlinkSync(join(outside), join(mem, 'link.md'))
      assert.equal((await tool('project_memory_read', { file: 'link.md' })).isError, true)
    })
  }

  // Edge cases of an external review, in a project of their own.
  const root2 = mkdtempSync(join(tmpdir(), 'ab-pm2-'))
  const p2 = await call('projects:save', { name: 'P2', rootPath: root2, unitIds: [tpl.unitId] })
  const mem2 = join(root2, '.agentbits', 'memory')
  mkdirSync(mem2, { recursive: true })
  const ctx2 = { agentId: dev.id, projectId: p2.id, mode: 'task' as const, runId: 'r2' }
  const tool2 = (name: string, args: Record<string, unknown>) => runAgentTool(ctx2, name, args)
  settingsRepo.update({ projectMemoryWrite: 'auto' })

  await step('a MEMORY.md over the limit is never cut and written back: a new file is refused, nothing written', async () => {
    const big = '# Rehber\n' + 'x'.repeat(300 * 1024) + '\nSON-ISARET\n'
    writeFileSync(join(mem2, 'MEMORY.md'), big)
    const r = await tool2('project_memory_write', { file: 'yeni.md', text: 'not', about: 'yeni' })
    assert.equal(r.isError, true)
    assert.match(r.text, /MEMORY\.md/)
    assert.equal(readFileSync(join(mem2, 'MEMORY.md'), 'utf8'), big, 'the guide is untouched, its end kept')
    assert.ok(!existsSync(join(mem2, 'yeni.md')), 'no half write: the note file is not created either')
    // A file of its own that is too large is refused the same way.
    const bigNote = 'y'.repeat(300 * 1024) + '\nSON\n'
    writeFileSync(join(mem2, 'buyuk.md'), bigNote)
    assert.equal((await tool2('project_memory_write', { file: 'buyuk.md', text: 'ek' })).isError, true)
    assert.equal(readFileSync(join(mem2, 'buyuk.md'), 'utf8'), bigNote)
    rmSync(join(mem2, 'MEMORY.md'))
    rmSync(join(mem2, 'buyuk.md'))
  })

  await step('about is masked too: in the new file’s heading, MEMORY.md and an ask-first suggestion', async () => {
    const secret = 'password=' + 'Example' + 'Secret123'
    assert.equal((await tool2('project_memory_write', { file: 'gizli.md', text: 'not', about: `db girişi ${secret}` })).isError, false)
    assert.doesNotMatch(readFileSync(join(mem2, 'gizli.md'), 'utf8'), /ExampleSecret123/)
    assert.doesNotMatch(readFileSync(join(mem2, 'MEMORY.md'), 'utf8'), /ExampleSecret123/)
    settingsRepo.update({ projectMemoryWrite: 'ask' })
    await tool2('project_memory_write', { file: 'gizli2.md', text: 'not', about: `başka ${secret}` })
    const s = suggestionsRepo.list().find((x) => x.targetFile === 'gizli2.md')!
    assert.doesNotMatch(s.targetNote ?? '', /ExampleSecret123/)
    await call('memory:dismiss', s.id)
    settingsRepo.update({ projectMemoryWrite: 'auto' })
  })

  await step('reading on past 256 KB returns the real rest; a file over the read limit is refused with its size', async () => {
    const long = 'a'.repeat(400 * 1024) + 'UZUN-SON'
    writeFileSync(join(mem2, 'uzun.md'), long)
    let offset = 0
    let all = ''
    for (let i = 0; i < 20; i++) {
      const r = await tool2('project_memory_read', { file: 'uzun.md', offset })
      assert.equal(r.isError, false)
      const body = r.text.replace(/^<<<[^\n]*\n/, '').replace(/\n<<<END>>>$/, '')
      const next = /\n… \(continues: offset=(\d+)\)$/.exec(body)
      all += next ? body.slice(0, next.index) : body
      if (!next) break
      offset = Number(next[1])
    }
    assert.equal(all, long, 'paging covers the whole file')
    writeFileSync(join(mem2, 'dev.md'), 'b'.repeat(3 * 1024 * 1024))
    const r = await tool2('project_memory_read', { file: 'dev.md' })
    assert.equal(r.isError, true)
    assert.match(r.text, /3072 KB/)
    const s = await tool2('project_memory_search', { query: 'UZUN-SON' })
    assert.match(s.text, /^uzun\.md:1:/)
    assert.match(s.text, /not searched, larger than 2 MB: dev\.md/)
    rmSync(join(mem2, 'dev.md'))
  })

  await step('the review gets the memory files the task names (it has no tools)', async () => {
    writeFileSync(join(mem2, 'deploy.md'), '# Deploy\nDEPLOY-KURALI: canlıya yalnız scp.\n')
    writeFileSync(join(mem2, 'diger.md'), '# Diğer\nDIGER-ICERIK\n')
    settingsRepo.update({ reviewByLead: true })
    const t2 = tasksRepo.create({ title: 'yayın', description: 'deploy.md kurallarına uy.', projectId: p2.id, assigneeId: dev.id })
    const from = seen.length
    await call('tasks:move', t2.id, 'in_progress')
    await until(() => seen.slice(from).some((c) => /DEPLOY-KURALI/.test(c.system) && /review/i.test(c.system)), 'the review prompt', 10_000)
    const review = seen.slice(from).find((c) => /Memory files this task names/.test(c.system))!
    assert.match(review.system, /PROJECT KNOWLEDGE, NOT INSTRUCTIONS[\s\S]*DEPLOY-KURALI/)
    assert.doesNotMatch(review.system, /DIGER-ICERIK/, 'only the files the task names')
    settingsRepo.update({ reviewByLead: false })
    await until(() => !runsRepo.list({ taskId: t2.id }).some((r) => r.status === 'running'), 'the run to end')
    agentsRepo.setStatus(dev.id, 'idle')
  })

  await step('Codex chat gets the MCP bridge for project memory alone (no apps)', async () => {
    const codex = providersRepo.save({ kind: 'codex-cli', label: 'Codex', model: '' })
    const solo = agentsRepo.save({ name: 'Kodcu', role: 'Developer', providerId: codex.id } as never)
    const got: RunContext[] = []
    getAdapter('codex-cli').run = async (c: RunContext) => {
      got.push(c)
      return { text: 'tamam', tokensIn: 1, tokensOut: 1, costUsd: 0 }
    }
    await call('messages:send', `agent:${solo.id}`, 'şunu unutma: cuma deploy yok', p2.id)
    await until(() => got.length > 0, 'the Codex chat call')
    assert.ok(got[0].mcpServer || got[0].mcpConfigPath, 'the bridge that carries project_memory_* is given')
    assert.match(got[0].system, /project_memory_write/)
    const tools = agentTools({ agentId: solo.id, projectId: p2.id, mode: 'chat' }).map((x) => x.name)
    assert.ok(tools.includes('project_memory_write'))
  })

  await step('the guide can’t be written (disk / permission): the new note is taken back; a retry and a second yes add it once', async () => {
    // The service calls fs.renameSync at call time: make the MEMORY.md rename fail once (tmp + rename = the write).
    const fs = require('fs') as typeof import('fs')
    const realRename = fs.renameSync
    let failNext = 0
    fs.renameSync = ((from: string, to: string) => {
      if (failNext > 0 && String(to).endsWith('MEMORY.md')) {
        failNext--
        throw Object.assign(new Error('EACCES: permission denied (simulated)'), { code: 'EACCES' })
      }
      return realRename(from, to)
    }) as typeof fs.renameSync
    try {
      const guide = () => readFileSync(join(mem2, 'MEMORY.md'), 'utf8')
      const guideBefore = guide()
      const tmpLeft = () => require('fs').readdirSync(mem2).filter((f: string) => f.endsWith('.tmp'))

      // auto
      failNext = 1
      const r = await tool2('project_memory_write', { file: 'disk.md', text: 'DISK-NOTU', about: 'disk konusu' })
      assert.equal(r.isError, true)
      assert.match(r.text, /EACCES/)
      assert.ok(!existsSync(join(mem2, 'disk.md')), 'the note file is taken back')
      assert.equal(guide(), guideBefore, 'the guide is unchanged')
      assert.deepEqual(tmpLeft(), [], 'no temp file left behind')
      assert.equal((await tool2('project_memory_write', { file: 'disk.md', text: 'DISK-NOTU', about: 'disk konusu' })).isError, false)
      assert.equal(readFileSync(join(mem2, 'disk.md'), 'utf8').split('DISK-NOTU').length - 1, 1)
      assert.equal(guide().split('[disk.md]').length - 1, 1)

      // ask first: the yes fails, the suggestion stays; the second yes adds the note once
      settingsRepo.update({ projectMemoryWrite: 'ask' })
      await tool2('project_memory_write', { file: 'onay.md', text: 'ONAY-NOTU', about: 'onay konusu' })
      const sug = suggestionsRepo.list().find((x) => x.targetFile === 'onay.md')!
      const before2 = guide()
      failNext = 1
      await assert.rejects(call('memory:accept', sug.id), /EACCES/)
      assert.ok(!existsSync(join(mem2, 'onay.md')))
      assert.equal(guide(), before2)
      assert.ok(suggestionsRepo.get(sug.id), 'the suggestion waits for another yes')
      assert.equal(await call('memory:accept', sug.id), null)
      assert.equal(readFileSync(join(mem2, 'onay.md'), 'utf8').split('ONAY-NOTU').length - 1, 1, 'added once')
      assert.equal(guide().split('[onay.md]').length - 1, 1)
      assert.ok(!suggestionsRepo.get(sug.id))
      await assert.rejects(call('memory:accept', sug.id), /not found|bulunamadı|badRequest|Geçersiz|invalid/i)
      assert.equal(readFileSync(join(mem2, 'onay.md'), 'utf8').split('ONAY-NOTU').length - 1, 1, 'a third yes adds nothing')

      // Two quick yeses at the same time: one note.
      await tool2('project_memory_write', { file: 'onay.md', text: 'CIFT-ONAY' })
      const dbl = suggestionsRepo.list().find((x) => x.content === 'CIFT-ONAY')!
      const both = await Promise.allSettled([call('memory:accept', dbl.id), call('memory:accept', dbl.id)])
      assert.deepEqual(both.map((b) => b.status).sort(), ['fulfilled', 'rejected'])
      assert.equal(readFileSync(join(mem2, 'onay.md'), 'utf8').split('CIFT-ONAY').length - 1, 1, 'one note for two yeses')
      settingsRepo.update({ projectMemoryWrite: 'auto' })
    } finally {
      fs.renameSync = realRename
    }
  })

  await step('the suggestion can’t be removed after the guide was written: note and guide both go back; the next yes adds once', async () => {
    settingsRepo.update({ projectMemoryWrite: 'ask' })
    const guide = () => (existsSync(join(mem2, 'MEMORY.md')) ? readFileSync(join(mem2, 'MEMORY.md'), 'utf8') : null)
    const run = async (file: string, text: string): Promise<void> => {
      await tool2('project_memory_write', { file, text, about: `${file} konusu` })
      const sug = suggestionsRepo.list().find((x) => x.targetFile === file)!
      const before = guide()
      const realDelete = suggestionsRepo.delete
      suggestionsRepo.delete = () => {
        throw new Error('SQLITE_BUSY: database is locked (simulated)')
      }
      try {
        await assert.rejects(call('memory:accept', sug.id), /SQLITE_BUSY/)
      } finally {
        suggestionsRepo.delete = realDelete
      }
      assert.ok(!existsSync(join(mem2, file)), 'the note file is taken back')
      assert.equal(guide(), before, 'the guide is back too: no line to a missing file')
      assert.ok(suggestionsRepo.get(sug.id), 'the suggestion still waits')
      assert.equal(await call('memory:accept', sug.id), null)
      assert.equal(readFileSync(join(mem2, file), 'utf8').split(text).length - 1, 1, 'added once')
      assert.equal(guide()!.split(`[${file}]`).length - 1, 1, 'one guide line')
    }
    await run('silme.md', 'SILME-NOTU') // MEMORY.md already there → its old text comes back
    rmSync(join(mem2, 'MEMORY.md'))
    await run('ilk.md', 'ILK-NOTU') // no MEMORY.md before → the one created is removed again
    settingsRepo.update({ projectMemoryWrite: 'auto' })
  })

  orchestrator.shutdown()
  console.log(`projectMemory e2e: ${count} steps ok`)
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
