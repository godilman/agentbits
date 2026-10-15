/** OCR of images and scanned PDF pages with the bundled language data, offline. Run: npm run test:unit */
import assert from 'node:assert/strict'
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { extractFile } from '../src/main/files/extract.ts'
import { createOcr, encodeGrayPng, OCR_LANGS, toGray } from '../src/main/files/ocr.ts'

// The app copies the shipped language data into one folder the same way (files/service.ts → ocrLangPath).
const require = createRequire(import.meta.url)
const langPath = mkdtempSync(join(tmpdir(), 'agentbits-ocr-'))
for (const lang of OCR_LANGS) {
  const src = join(dirname(require.resolve(`@tesseract.js-data/${lang}/package.json`)), '4.0.0_best_int', `${lang}.traineddata.gz`)
  copyFileSync(src, join(langPath, `${lang}.traineddata.gz`))
}
// Offline by construction: a local langPath is read from disk, never fetched (tesseract.js worker-script). Checked when
// written by running this test with no network at all (`unshare -rn`).
const ocr = createOcr(langPath)
const fixture = (n: string): Uint8Array => new Uint8Array(readFileSync(join(import.meta.dirname, 'fixtures/ocr', n)))
const flat = (s: string): string => s.replace(/\s+/g, ' ')

try {
  const img = await extractFile(fixture('scan-text.png'), 'scan.png', undefined, undefined, ocr)
  const text = flat(img.chunks.map((c) => c.text).join(' '))
  assert.match(text, /Invoice 2026-104/, text)
  assert.match(text, /1250 EUR/, text)
  assert.match(text, /Teslim tarihi: 17 Ekim/, text)
  assert.equal(img.width, 900)

  const pdf = await extractFile(fixture('scanned.pdf'), 'scanned.pdf', undefined, undefined, ocr)
  const ptext = flat(pdf.chunks.map((c) => c.text).join(' '))
  assert.equal(pdf.status, 'ready', pdf.message ?? '')
  assert.match(ptext, /Invoice 2026-104/, ptext)
  assert.ok(pdf.warnings.some((w) => w.includes('pdfOcr')), JSON.stringify(pdf.warnings))

  // without OCR the scanned PDF has no text (as before)
  const plain = await extractFile(fixture('scanned.pdf'), 'scanned.pdf')
  assert.equal(plain.status, 'partial')

  // grayscale conversion and PNG encoding round-trip through Tesseract above; shape checks here
  assert.equal(toGray({ width: 2, height: 1, channels: 3, data: new Uint8Array([255, 255, 255, 0, 0, 0]) })?.join(','), '255,0')
  assert.equal(toGray({ width: 2, height: 2, channels: 3, data: new Uint8Array(3) }), null) // too short
  const png = encodeGrayPng(2, 1, new Uint8Array([0, 255]))
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  console.log('ocr: image and scanned PDF read offline (eng + tur)')
} finally {
  rmSync(langPath, { recursive: true, force: true })
}
