// Package 3: message drafts per project + channel, kept across restarts (text + finished attachments' ids, the files
// themselves untouched), removed when emptied or with their project; the IPC checks what the renderer sends.
// Real SQLite and IPC handlers. Run: npm run test:e2e
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, getDb, openDb } from '../../src/main/db'
import { settingsRepo } from '../../src/main/db/repos'
import { filesRepo } from '../../src/main/files/repo'
import { handlers } from '../../src/main/ipc'
import { applyLanguageSetting } from '../../src/main/i18n'
import { MAX_FILES_PER_SEND } from '../../src/shared/files'

let count = 0
const step = async (name: string, fn: () => Promise<void> | void): Promise<void> => {
  await fn()
  count++
  console.log(`  ✓ ${name}`)
}
const call = <T = any>(name: string, ...args: unknown[]): Promise<T> => Promise.resolve().then(() => (handlers as any)[name](...args))
const list = (): Promise<any[]> => call('drafts:list')

async function main(): Promise<void> {
  openDb()
  settingsRepo.update({ onboarded: true, language: 'en' })
  applyLanguageSetting('en')
  const p1 = await call('projects:save', { name: 'P1', rootPath: mkdtempSync(join(tmpdir(), 'ab-d1-')) })
  const p2 = await call('projects:save', { name: 'P2', rootPath: mkdtempSync(join(tmpdir(), 'ab-d2-')) })
  const file = await call('files:addData', p1.id, 'notes.txt', new TextEncoder().encode('hello'))

  await step('one draft per project + channel: text and finished attachments, nothing leaks to another', async () => {
    await call('drafts:save', { projectId: p1.id, channel: 'general', text: 'half a thought', files: [{ id: file.id, name: 'notes.txt', size: 5 }] })
    await call('drafts:save', { projectId: p1.id, channel: 'agent:abc-123', text: 'to one agent', files: [] })
    await call('drafts:save', { projectId: p2.id, channel: 'general', text: 'other project', files: [] })
    const all = await list()
    assert.equal(all.length, 3)
    const g1 = all.find((d) => d.projectId === p1.id && d.channel === 'general')
    assert.equal(g1.text, 'half a thought')
    assert.deepEqual(g1.files, [{ id: file.id, name: 'notes.txt', size: 5 }])
    assert.deepEqual(all.find((d) => d.projectId === p2.id).files, [])
    assert.ok(filesRepo.get(file.id), 'the file itself is untouched (no copy, no delete)')
  })

  await step('saving again replaces; an emptied draft is removed', async () => {
    await call('drafts:save', { projectId: p1.id, channel: 'general', text: 'a whole thought', files: [{ id: file.id, name: 'notes.txt', size: 5 }] })
    assert.equal((await list()).find((d) => d.projectId === p1.id && d.channel === 'general').text, 'a whole thought')
    await call('drafts:save', { projectId: p1.id, channel: 'agent:abc-123', text: '', files: [] })
    assert.ok(!(await list()).some((d) => d.channel === 'agent:abc-123'))
  })

  await step('a restart keeps the drafts', async () => {
    closeDb()
    openDb()
    const all = await list()
    assert.deepEqual(
      all.map((d) => `${d.projectId === p1.id ? 'P1' : 'P2'}:${d.channel}:${d.text}`).sort(),
      ['P1:general:a whole thought', 'P2:general:other project']
    )
  })

  await step('what the renderer sends is checked: project, channel, size', async () => {
    await assert.rejects(call('drafts:save', { projectId: 'nope', channel: 'general', text: 'x', files: [] }), /Project not found/)
    for (const channel of ['', 'random', 'task:../../x', 'agent:' + 'a'.repeat(65)]) {
      await assert.rejects(call('drafts:save', { projectId: p1.id, channel, text: 'x', files: [] }), /draft could not be saved/, channel)
    }
    await assert.rejects(call('drafts:save', { projectId: p1.id, channel: 'general', text: 'x'.repeat(100_001), files: [] }), /draft could not be saved/)
    const many = Array.from({ length: MAX_FILES_PER_SEND + 1 }, (_, i) => ({ id: `f${i}`, name: 'n', size: 1 }))
    await assert.rejects(call('drafts:save', { projectId: p1.id, channel: 'general', text: 'x', files: many }), /draft could not be saved/)
    assert.equal((await list()).find((d) => d.projectId === p1.id && d.channel === 'general').text, 'a whole thought', 'a refused save changes nothing')
  })

  await step('deleting a project removes its drafts (the other project keeps its own)', async () => {
    await call('drafts:save', { projectId: p2.id, channel: `task:${'t'.repeat(8)}`, text: 'note', files: [] })
    await call('projects:delete', p2.id)
    assert.ok(!(await list()).some((d) => d.projectId === p2.id))
    assert.ok((await list()).some((d) => d.projectId === p1.id))
    assert.equal((getDb().prepare('SELECT COUNT(*) AS n FROM message_drafts WHERE project_id = ?').get(p2.id) as { n: number }).n, 0)
  })

  console.log(`drafts e2e: ${count} steps ok`)
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e)
    process.exit(1)
  }
)
