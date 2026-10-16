import { strToU8, zipSync } from 'fflate'

/**
 * Query results as a file (db_export): the rows go from the database straight to the file, never through the model.
 * No Electron imports — `tests/connections.export.test.ts` runs this under plain Node.
 */
export type ExportFormat = 'xlsx' | 'csv' | 'json'

const text = (v: unknown): string => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v))

/** RFC 4180, UTF-8 with a BOM so Excel reads Turkish characters. */
export function toCsv(columns: string[], rows: unknown[][]): Uint8Array {
  const q = (v: unknown): string => {
    const s = text(v)
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return strToU8('\ufeff' + [columns, ...rows].map((r) => r.map(q).join(',')).join('\r\n') + '\r\n')
}

export function toJson(columns: string[], rows: unknown[][]): Uint8Array {
  return strToU8(JSON.stringify(rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i] ?? null]))), null, 2))
}

// Characters XML 1.0 does not allow (control characters a database text column can still hold).
// eslint-disable-next-line no-control-regex
const BAD_XML = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g
const xml = (s: string): string => s.replace(BAD_XML, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const colName = (i: number): string => {
  let n = i + 1
  let s = ''
  while (n > 0) {
    const m = (n - 1) % 26
    s = String.fromCharCode(65 + m) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

/**
 * A minimal Office Open XML workbook: one sheet, bold frozen header, column widths from the content. Real numbers are
 * number cells; everything else (dates, ids with leading zeros, decimals the driver gives as text) stays text.
 */
export function toXlsx(columns: string[], rows: unknown[][], sheetName = 'Data'): Uint8Array {
  const widths = columns.map((c) => Math.max(8, c.length + 2))
  for (const r of rows.slice(0, 2000)) r.forEach((v, i) => (widths[i] = Math.min(60, Math.max(widths[i] ?? 8, text(v).length + 2))))
  const cellXml = (v: unknown, ref: string, style = ''): string => {
    if (v === null || v === undefined || v === '') return ''
    if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${style}><v>${v}</v></c>`
    if (typeof v === 'boolean') return `<c r="${ref}" t="b"${style}><v>${v ? 1 : 0}</v></c>`
    return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${xml(text(v))}</t></is></c>`
  }
  const rowXml = (r: unknown[], n: number, style = ''): string => `<row r="${n}">${r.map((v, i) => cellXml(v, `${colName(i)}${n}`, style)).join('')}</row>`
  const sheet =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` +
    `<sheetData>${rowXml(columns, 1, ' s="1"')}${rows.map((r, i) => rowXml(r, i + 2)).join('')}</sheetData>` +
    '</worksheet>'
  const safeSheet = xml(sheetName.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Data')
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>'
    ),
    'xl/workbook.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        `<sheets><sheet name="${safeSheet}" sheetId="1" r:id="rId1"/></sheets></workbook>`
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        '</Relationships>'
    ),
    'xl/styles.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
        '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
        '</styleSheet>'
    ),
    'xl/worksheets/sheet1.xml': strToU8(sheet)
  })
}

export function exportBytes(format: ExportFormat, columns: string[], rows: unknown[][], sheetName?: string): Uint8Array {
  return format === 'csv' ? toCsv(columns, rows) : format === 'json' ? toJson(columns, rows) : toXlsx(columns, rows, sheetName)
}

export const EXPORT_MIME: Record<ExportFormat, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  json: 'application/json'
}
