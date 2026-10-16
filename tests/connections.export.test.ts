// db_export file writers (src/main/connections/export.ts): the files Excel and the app's own reader open.
// Run: npm run test:unit   (Node 22+, no test framework needed)
import assert from 'node:assert/strict'
import { strFromU8, unzipSync } from 'fflate'
import { EXPORT_FORMATS, exportBytes, toCsv, toHtml, toJson, toMarkdown, toTsv, toXlsx } from '../src/main/connections/export.ts'
import { extractFile } from '../src/main/files/extract.ts'

const columns = ['id', 'tarih', 'ad_soyad', 'genel_yorum', 'puan']
const long = 'Çok güzeldi. '.repeat(500) // 6500 characters: kept whole
const rows: unknown[][] = [
  [1785, '2026-09-01', 'Mustafa Şarıkaya', 'Tuz <az>, "acı" & bol', 5],
  [1786, '2026-09-02', 'Özlem Kılıç', long, null],
  [1787, '2026-09-03', '00123', 'satır\nsonu\u0007kontrol', 4.5]
]

// CSV: BOM, quoting of comma / quote / newline, empty for NULL.
const csvBytes = toCsv(columns, rows)
assert.deepEqual([...csvBytes.slice(0, 3)], [0xef, 0xbb, 0xbf], 'UTF-8 BOM')
const csv = new TextDecoder('utf-8', { ignoreBOM: true }).decode(csvBytes)
assert.ok(csv.startsWith('\ufeffid,tarih,ad_soyad,genel_yorum,puan\r\n'))
assert.ok(csv.includes('1785,2026-09-01,Mustafa Şarıkaya,"Tuz <az>, ""acı"" & bol",5\r\n'), csv.slice(0, 200))
assert.ok(csv.includes(`1786,2026-09-02,Özlem Kılıç,${long},\r\n`))
assert.ok(csv.includes('"satır\nsonu\u0007kontrol"'))

// JSON: one object per row, NULL kept.
const json = JSON.parse(strFromU8(toJson(columns, rows)))
assert.equal(json.length, 3)
assert.deepEqual(json[1].puan, null)
assert.equal(json[0].ad_soyad, 'Mustafa Şarıkaya')

// XLSX: a valid package; numbers are number cells, text (also "00123") inline strings, XML escaped,
// control characters dropped, header bold and frozen.
const xlsx = toXlsx(columns, rows, 'MainDB')
const parts = unzipSync(xlsx)
for (const p of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml']) assert.ok(parts[p], p)
const sheet = strFromU8(parts['xl/worksheets/sheet1.xml'])
assert.ok(sheet.includes('<c r="A2"><v>1785</v></c>'), 'number cell')
assert.ok(sheet.includes('<c r="E4"><v>4.5</v></c>'))
assert.ok(sheet.includes('<c r="C4" t="inlineStr"><is><t xml:space="preserve">00123</t></is></c>'), 'leading zeros stay text')
assert.ok(sheet.includes('Tuz &lt;az&gt;, &quot;acı&quot; &amp; bol'))
assert.ok(!sheet.includes('\u0007') && sheet.includes('satır\nsonukontrol'))
assert.ok(sheet.includes('<c r="A1" t="inlineStr" s="1">'), 'bold header')
assert.ok(sheet.includes('state="frozen"'))
assert.ok(!sheet.includes('<c r="E3"'), 'NULL is an empty cell')
assert.ok(strFromU8(parts['xl/workbook.xml']).includes('<sheet name="MainDB"'))

// The app's own attachment reader opens it: every row, Turkish text and the long cell intact.
const read = await extractFile(xlsx, 'export.xlsx')
const text = read.chunks.map((c) => c.text).join('\n')
assert.equal(read.status, 'ready', JSON.stringify(read.warnings))
assert.ok(text.includes('Mustafa Şarıkaya') && text.includes('Özlem Kılıç') && text.includes('00123'), text.slice(0, 300))
assert.ok(text.includes(long.trim()))

// Many columns: AA, AB … after Z.
const wide = toXlsx(Array.from({ length: 30 }, (_, i) => `c${i}`), [Array.from({ length: 30 }, (_, i) => i)])
assert.ok(strFromU8(unzipSync(wide)['xl/worksheets/sheet1.xml']).includes('<c r="AD2"><v>29</v></c>'))

// TXT / TSV: tab-separated, header first, one line per row (tabs / line breaks inside a cell become spaces).
const tsv = strFromU8(toTsv(columns, rows)).split('\r\n')
assert.equal(tsv[0], 'id\ttarih\tad_soyad\tgenel_yorum\tpuan')
assert.equal(tsv[1], '1785\t2026-09-01\tMustafa Şarıkaya\tTuz <az>, "acı" & bol\t5')
assert.equal(tsv[3], '1787\t2026-09-03\t00123\tsatır sonu\u0007kontrol\t4.5')
assert.equal(tsv.length, 5, 'header + 3 rows + final line break')
assert.deepEqual(exportBytes('txt', columns, rows), toTsv(columns, rows))

// Markdown: a table, | escaped, line breaks as <br>.
const md = strFromU8(toMarkdown(['a', 'b'], [['x|y', 'satır\nsonu'], [null, 3]])).split('\n')
assert.deepEqual(md.slice(0, 4), ['| a | b |', '| --- | --- |', '| x\\|y | satır<br>sonu |', '|  | 3 |'])

// HTML: escaped cells in one table.
const html = strFromU8(toHtml(columns, rows, 'MainDB'))
assert.ok(html.startsWith('<!doctype html>') && html.includes('<title>MainDB</title>'))
assert.ok(html.includes('<td>Tuz &lt;az&gt;, &quot;acı&quot; &amp; bol</td>') && !html.includes('<az>'))
assert.equal((html.match(/<tr>/g) ?? []).length, 4)

// Every listed format produces bytes.
for (const f of EXPORT_FORMATS) assert.ok(exportBytes(f, columns, rows).byteLength > 20, f)

console.log('connections.export: ok')
