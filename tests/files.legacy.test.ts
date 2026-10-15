/** Office 97–2003 attachments (.doc, .xls, .ppt) through the real extraction path. Run: npm run test:unit */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { detectKind, extractFile } from '../src/main/files/extract.ts'

const dir = join(import.meta.dirname, 'fixtures/office')
const file = (n: string): Uint8Array => new Uint8Array(readFileSync(join(dir, n)))
const all = (r: Awaited<ReturnType<typeof extractFile>>): string => r.chunks.map((c) => c.text).join('\n')

// detection: an OLE file is read by its extension; a renamed text file is not
assert.equal(detectKind('a.doc', file('test01.doc')).kind, 'doc')
assert.equal(detectKind('a.xls', file('chinese-provinces.xls')).kind, 'xls')
assert.equal(detectKind('a.ppt', file('incorrect_slide_order.ppt')).kind, 'ppt')
assert.notEqual(detectKind('a.doc', new TextEncoder().encode('just text')).kind, 'doc')

const doc = await extractFile(file('test01.doc'), 'test01.doc')
assert.equal(doc.status, 'ready', doc.message ?? '')
assert.match(all(doc), /Unicode characters/)
assert.match(all(doc), /😀 ∀/)

const xls = await extractFile(file('chinese-provinces.xls'), 'provinces.xls')
assert.equal(xls.status, 'ready', xls.message ?? '')
assert.deepEqual(xls.sheets, ['provinces'])
assert.match(all(xls), /Anhui/)
assert.match(all(xls), /安徽省/)
assert.match(all(xls), /北京市/)

const ppt = await extractFile(file('incorrect_slide_order.ppt'), 'deck.ppt')
assert.equal(ppt.status, 'ready', ppt.message ?? '')
assert.equal(ppt.pages, 3)
const text = all(ppt)
// slides in presentation order (the file stores them out of order)
assert.ok(text.indexOf('First slide I added') < text.indexOf('Third slide I added'), text)
assert.ok(text.indexOf('Third slide I added') < text.indexOf('Second slide I added'), text)
assert.ok(!/Click to edit Master/.test(text), 'master placeholders are not slide text')

// fuzzed / broken files (Apache POI clusterfuzz cases): a clear failure, never a crash or a hang
for (const n of readdirSync(dir).filter((x) => x.startsWith('clusterfuzz'))) {
  const t0 = Date.now()
  const r = await extractFile(file(n), n)
  assert.ok(r.status === 'failed' || r.status === 'partial' || r.status === 'ready', n)
  assert.ok(Date.now() - t0 < 5000, `${n} took too long`)
}
console.log('legacy office: .doc, .xls (BIFF8, CJK), .ppt (slide order) read; fuzzed files fail cleanly')
