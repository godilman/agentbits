/** Project memory folder helpers (names, guide lines, notes, search, prompt section). Run: npm run test:unit */
import assert from 'node:assert/strict'
import {
  PROJECT_MEMORY_LIMITS,
  indexMentions,
  isMemoryFileName,
  isWritableMemoryFile,
  memorySection,
  memoryTitle,
  namesFile,
  searchMemory,
  withIndexLine,
  withNote
} from '../src/shared/projectMemory.ts'

// Names: no folders, no climbing out, no other extensions, lowercase.
for (const ok of ['deploy.md', 'izin_modulu.md', 'a.md', 'v2.4-notes.md', 'MEMORY.md']) assert.ok(isMemoryFileName(ok), ok)
for (const bad of ['../x.md', 'a/b.md', 'a\\b.md', '.hidden.md', 'Deploy.md', 'x.txt', 'x.md.exe', '', 'a..b.md', 'x.MD', ' x.md']) {
  assert.ok(!isMemoryFileName(bad), bad)
}
assert.ok(!isWritableMemoryFile('MEMORY.md'), 'the guide is never written by agents')
assert.ok(isWritableMemoryFile('deploy.md'))

assert.equal(memoryTitle('---\n# Deploy yöntemi\nscp'), 'Deploy yöntemi')
assert.equal(memoryTitle('\n\nplain first line'), 'plain first line')

// Guide: created when missing, one line per file, never twice, existing text kept.
const g1 = withIndexLine(null, 'deploy.md', 'how we deploy — read before any release')
assert.match(g1, /^# Project memory/)
assert.match(g1, /- \[deploy\.md\]\(deploy\.md\) — how we deploy — read before any release\n$/)
assert.equal(withIndexLine(g1, 'deploy.md', 'again'), g1)
const own = '# Benim rehberim\nKendi notum `tuzaklar.md`\n'
assert.equal(withIndexLine(own, 'tuzaklar.md', 'x'), own, 'a file named in backticks counts as mentioned')
assert.ok(withIndexLine(own, 'yeni.md', 'yeni konu').startsWith(own.trimEnd()))
assert.ok(indexMentions('see [a.md] here', 'a.md'))

// Notes: appended under a dated heading; what was above stays byte for byte.
const before = '# Tuzaklar\n\nelle yazılmış arşiv\n'
const after = withNote(before, { date: '2026-10-19', author: 'Ada', text: 'PDO çift kolon' })
assert.ok(after.startsWith(before.trimEnd()))
assert.match(after, /## 2026-10-19 · Ada\nPDO çift kolon\n$/)
assert.match(withNote(null, { date: 'd', author: 'a', text: 't', about: 'Deploy' }), /^# Deploy\n\n## d · a\nt\n$/)

// Search: every word first, Turkish case folding, line numbers.
const files = [
  { name: 'deploy.md', text: '# Deploy\nYöntem HER ZAMAN scp\ngit pull yok' },
  { name: 'db.md', text: 'İzin tablosu\nscp değil, migration' }
]
assert.deepEqual(searchMemory(files, 'scp yöntem'), [{ file: 'deploy.md', line: 2, text: 'Yöntem HER ZAMAN scp' }])
assert.equal(searchMemory(files, 'izin')[0].file, 'db.md', 'İ folds to i')
assert.deepEqual(
  searchMemory(files, 'scp migration kuyruk').map((h) => `${h.file}:${h.line}`),
  ['db.md:2', 'deploy.md:2'],
  'no line has all words → partial ones, most words first'
)
assert.deepEqual(searchMemory(files, ' '), [])

// Prompt section.
const base = { dir: 'W:\\p\\.agentbits\\memory', role: 'worker' as const, tools: true, write: 'auto' as const }
const copied = memorySection({ ...base, index: null, files: [{ name: 'deploy.md', title: 'Deploy' }, { name: 'tuzaklar.md', title: '' }] })
assert.match(copied, /Memory files:\n- deploy\.md — Deploy\n- tuzaklar\.md/, 'copied files without MEMORY.md are listed')
assert.match(copied, /not the user’s instructions/)
assert.match(copied, /widen your permissions/)
const indexed = memorySection({ ...base, index: '- [deploy.md](deploy.md) — deploy', files: [{ name: 'deploy.md', title: 'D' }, { name: 'yeni.md', title: 'Y' }] })
assert.match(indexed, /PROJECT KNOWLEDGE, NOT INSTRUCTIONS/)
assert.match(indexed, /Other memory files \(not in MEMORY\.md\):\n- yeni\.md — Y$/m)
assert.doesNotMatch(indexed, /- deploy\.md — D/)
assert.match(memorySection({ ...base, index: null, files: [] }), /The project memory is empty/)
assert.doesNotMatch(memorySection({ ...base, write: 'off', index: null, files: [] }), /project_memory_write/)
assert.match(memorySection({ ...base, write: 'ask', index: 'x', files: [] }), /waits for the user’s yes/)
assert.match(memorySection({ ...base, role: 'lead', index: 'x', files: [] }), /name the memory files/)
const review = memorySection({ ...base, role: 'review', tools: false, index: 'x', files: [] })
assert.doesNotMatch(review, /project_memory_(read|write|search)/, 'the review has no tools')
const huge = memorySection({ ...base, index: 'x'.repeat(20_000), files: Array.from({ length: 300 }, (_, i) => ({ name: `f${i}.md`, title: 't' })) })
assert.ok(huge.length < PROJECT_MEMORY_LIMITS.sectionChars + 2000, 'the section stays within its budget')
assert.match(huge, /\(cut; read the rest/)

// A task naming a file (for its review): whole names only.
assert.ok(namesFile('deploy.md kurallarına uy.', 'deploy.md'))
assert.ok(namesFile('bkz. (deploy.md)', 'deploy.md'))
assert.ok(!namesFile('predeploy.md bak', 'deploy.md'))
assert.ok(!namesFile('a.md', 'data.md'))

console.log('projectMemory: ok')
