/**
 * Text from legacy (97–2003, OLE compound file) Office formats: Excel .xls (BIFF8), PowerPoint .ppt and Word .doc.
 * Pure and bounds-checked: these files are untrusted input and run in the extraction worker (fuzzed files from Apache
 * POI's test data are in `tests/fixtures/office`). `tests/files.legacy.test.ts`.
 */
import * as CFB from 'cfb'

export interface LegacySheet {
  name: string
  hidden: boolean
  rows: { n: number; cells: string[] }[]
  truncated: boolean
}

function stream(bytes: Uint8Array, names: string[]): Uint8Array | null {
  const c = CFB.read(bytes, { type: 'buffer' })
  for (const n of names) {
    const e = CFB.find(c, n)
    if (e?.content && e.content.length) return e.content instanceof Uint8Array ? e.content : Uint8Array.from(e.content as ArrayLike<number>)
  }
  return null
}

/* ───────────────────────────── Excel 97–2003 (BIFF8) ───────────────────────────── */

interface Rec {
  type: number
  data: Uint8Array
}

function records(buf: Uint8Array, start: number): Rec[] {
  const out: Rec[] = []
  let p = start
  while (p + 4 <= buf.length && out.length < 2_000_000) {
    const type = buf[p] | (buf[p + 1] << 8)
    const len = buf[p + 2] | (buf[p + 3] << 8)
    out.push({ type, data: buf.subarray(p + 4, Math.min(buf.length, p + 4 + len)) })
    p += 4 + len
  }
  return out
}

/** Reads across a record and its CONTINUE records; a string's characters may resume with a new flags byte. */
class Seg {
  private i = 0
  private p = 0
  private segs: Uint8Array[]
  constructor(segs: Uint8Array[]) {
    this.segs = segs
  }
  private cur(): Uint8Array | undefined {
    while (this.i < this.segs.length && this.p >= this.segs[this.i].length) {
      this.i++
      this.p = 0
    }
    return this.segs[this.i]
  }
  u8(): number {
    const s = this.cur()
    if (!s) throw new Error('eof')
    return s[this.p++]
  }
  u16(): number {
    return this.u8() | (this.u8() << 8)
  }
  u32(): number {
    return (this.u16() | (this.u16() << 16)) >>> 0
  }
  skip(n: number): void {
    for (let k = 0; k < n; k++) this.u8()
  }
  chars(cch: number, high: boolean): string {
    let out = ''
    let wide = high
    for (let k = 0; k < cch; k++) {
      const s = this.segs[this.i]
      if (!s) throw new Error('eof')
      if (this.p >= s.length) {
        // Continued in the next record: it starts with a fresh "high byte" flag.
        this.i++
        this.p = 0
        if (!this.segs[this.i]) throw new Error('eof')
        wide = (this.u8() & 1) === 1
      }
      out += String.fromCharCode(wide ? this.u16() : this.u8())
    }
    return out
  }
}

/** XLUnicodeRichExtendedString (SST entries) and XLUnicodeString (LABEL, FORMAT, STRING). */
function readString(r: Seg, rich = true): string {
  const cch = r.u16()
  const flags = r.u8()
  const cRun = rich && flags & 0x08 ? r.u16() : 0
  const cbExt = rich && flags & 0x04 ? r.u32() : 0
  const s = r.chars(cch, (flags & 1) === 1)
  r.skip(cRun * 4)
  r.skip(cbExt)
  return s
}

function rk(v: number): number {
  let n: number
  if (v & 2) n = v >> 2
  else {
    const b = new DataView(new ArrayBuffer(8))
    b.setUint32(4, v & 0xfffffffc, true)
    n = b.getFloat64(0, true)
  }
  return v & 1 ? n / 100 : n
}

const BUILTIN_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47])
const isDateCode = (code: string): boolean => {
  const s = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '')
  return /[dmyhs]/i.test(s) && !/^[#0.,%\s]*$/.test(s)
}

function excelSerial(serial: number, date1904: boolean): string {
  const d = new Date(Math.round((serial + (date1904 ? 1462 : 0) - 25569) * 86_400_000))
  if (Number.isNaN(d.getTime())) return String(serial)
  const iso = d.toISOString()
  if (serial < 1) return iso.slice(11, 19)
  return Math.abs(serial % 1) > 1e-9 ? `${iso.slice(0, 10)} ${iso.slice(11, 19)}` : iso.slice(0, 10)
}

const num = (x: number): string => (Number.isInteger(x) ? String(x) : String(Math.round(x * 1e10) / 1e10))

export function readXls(bytes: Uint8Array, maxRows: number): { sheets: LegacySheet[]; encrypted: boolean; old: boolean } {
  const wb = stream(bytes, ['Workbook', 'Book'])
  if (!wb) throw new Error('no workbook stream')
  const recs = records(wb, 0)
  const dv = (d: Uint8Array): DataView => new DataView(d.buffer, d.byteOffset, d.byteLength)
  const bof = recs[0]
  if (!bof || bof.type !== 0x0809 || bof.data.length < 2) throw new Error('not an Excel workbook')
  if (dv(bof.data).getUint16(0, true) !== 0x0600) return { sheets: [], encrypted: false, old: true }
  const sst: string[] = []
  const sheetsMeta: { name: string; hidden: boolean; pos: number }[] = []
  const formats = new Map<number, string>()
  const xfFmt: number[] = []
  let date1904 = false
  for (let k = 1; k < recs.length; k++) {
    const { type, data } = recs[k]
    if (type === 0x000a) break // EOF of the globals
    if (type === 0x002f) return { sheets: [], encrypted: true, old: false } // FILEPASS
    if (type === 0x0022 && data.length >= 2) date1904 = dv(data).getUint16(0, true) === 1
    else if (type === 0x00e0 && data.length >= 4) xfFmt.push(dv(data).getUint16(2, true))
    else if (type === 0x041e && data.length >= 5) {
      try {
        formats.set(dv(data).getUint16(0, true), readString(new Seg([data.subarray(2)]), false))
      } catch {
        /* skip a broken format */
      }
    } else if (type === 0x0085 && data.length >= 8) {
      const d = dv(data)
      if (data[5] !== 0) continue // not a worksheet (chart, macro…)
      let name = ''
      try {
        const cch = data[6]
        const high = (data[7] & 1) === 1
        name = new Seg([data.subarray(8)]).chars(cch, high)
      } catch {
        name = `Sheet${sheetsMeta.length + 1}`
      }
      sheetsMeta.push({ name, hidden: (data[4] & 3) !== 0, pos: d.getUint32(0, true) })
    } else if (type === 0x00fc && data.length >= 8) {
      const segs = [data.subarray(8)]
      for (let j = k + 1; j < recs.length && recs[j].type === 0x003c; j++) segs.push(recs[j].data)
      const r = new Seg(segs)
      const unique = Math.min(dv(data).getUint32(4, true), 5_000_000)
      try {
        for (let n = 0; n < unique; n++) sst.push(readString(r))
      } catch {
        /* a short table: keep what was read */
      }
    }
  }
  const isDate = (ixfe: number): boolean => {
    const f = xfFmt[ixfe]
    return f !== undefined && (BUILTIN_DATE.has(f) || isDateCode(formats.get(f) ?? ''))
  }
  const cellText = (ixfe: number, x: number): string => (isDate(ixfe) ? excelSerial(x, date1904) : num(x))
  const sheets: LegacySheet[] = []
  for (const meta of sheetsMeta) {
    const rows = new Map<number, string[]>()
    const set = (r: number, c: number, v: string): void => {
      if (c > 16_384) return
      const row = rows.get(r) ?? []
      while (row.length < c) row.push('')
      row[c] = v
      rows.set(r, row)
    }
    let truncated = false
    if (meta.pos >= 0 && meta.pos < wb.length) {
      const sr = records(wb, meta.pos)
      let depth = 0
      let pendingFormula: { r: number; c: number } | null = null
      for (let k = 0; k < sr.length; k++) {
        const { type, data } = sr[k]
        if (type === 0x0809) depth++
        else if (type === 0x000a) {
          if (--depth <= 0) break
        }
        if (depth !== 1 || data.length < 6) continue
        const d = dv(data)
        const r = d.getUint16(0, true)
        const c = d.getUint16(2, true)
        const ixfe = d.getUint16(4, true)
        try {
          if (type === 0x00fd && data.length >= 10) set(r, c, sst[d.getUint32(6, true)] ?? '')
          else if (type === 0x0203 && data.length >= 14) set(r, c, cellText(ixfe, d.getFloat64(6, true)))
          else if (type === 0x027e && data.length >= 10) set(r, c, cellText(ixfe, rk(d.getUint32(6, true))))
          else if (type === 0x00bd) {
            for (let o = 4, col = c; o + 6 <= data.length - 2; o += 6, col++) set(r, col, cellText(d.getUint16(o, true), rk(d.getUint32(o + 2, true))))
          } else if (type === 0x0205 && data.length >= 8) set(r, c, data[7] ? '#ERROR' : data[6] ? 'TRUE' : 'FALSE')
          else if (type === 0x0204) set(r, c, readString(new Seg([data.subarray(6)]), false))
          else if (type === 0x0006 && data.length >= 14) {
            if (data[12] === 0xff && data[13] === 0xff) {
              if (data[6] === 0) pendingFormula = { r, c }
              else if (data[6] === 1) set(r, c, data[8] ? 'TRUE' : 'FALSE')
            } else set(r, c, cellText(ixfe, d.getFloat64(6, true)))
          }
        } catch {
          /* a broken cell record */
        }
        if (type === 0x0207 && pendingFormula) {
          const segs = [data]
          for (let j = k + 1; j < sr.length && sr[j].type === 0x003c; j++) segs.push(sr[j].data)
          try {
            set(pendingFormula.r, pendingFormula.c, readString(new Seg(segs), false))
          } catch {
            /* skip */
          }
          pendingFormula = null
        }
        if (rows.size > maxRows) {
          truncated = true
          break
        }
      }
    }
    const sorted = [...rows.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([n, cells]) => {
        while (cells.length && !cells[cells.length - 1]) cells.pop()
        return { n: n + 1, cells }
      })
      .filter((x) => x.cells.length)
    sheets.push({ name: meta.name, hidden: meta.hidden, rows: sorted, truncated })
  }
  return { sheets, encrypted: false, old: false }
}

/* ───────────────────────────── PowerPoint 97–2003 ───────────────────────────── */

export function readPpt(bytes: Uint8Array): { slides: string[]; notes: string[]; loose: string[] } {
  const doc = stream(bytes, ['PowerPoint Document'])
  if (!doc) throw new Error('no PowerPoint Document stream')
  const slides: string[][] = []
  const notes: string[][] = []
  const loose: string[] = []
  let atoms = 0
  const text = (type: number, d: Uint8Array): string | null => {
    if (type === 0x0fa0) {
      let s = ''
      for (let k = 0; k + 1 < d.length; k += 2) s += String.fromCharCode(d[k] | (d[k + 1] << 8))
      return s
    }
    if (type === 0x0fa8) return String.fromCharCode(...d.subarray(0, 65_536))
    return null
  }
  const clean = (s: string): string => s.replace(/\r|\v/g, '\n').replace(/[\u0000-\u0008\u000e-\u001f]/g, '').trim()
  /** Walks a container; inside a SlideListWithText, a SlidePersistAtom starts the next slide (or notes page). */
  const walk = (from: number, to: number, depth: number, list: string[][] | null): void => {
    let p = from
    while (p + 8 <= to && atoms < 200_000) {
      const verInst = doc[p] | (doc[p + 1] << 8)
      const type = doc[p + 2] | (doc[p + 3] << 8)
      const len = (doc[p + 4] | (doc[p + 5] << 8) | (doc[p + 6] << 16) | (doc[p + 7] << 24)) >>> 0
      const start = p + 8
      const end = Math.min(to, start + len)
      if (start > to) break
      atoms++
      if ((verInst & 0xf) === 0xf && depth < 32) {
        const inst = verInst >> 4
        // SlideListWithText: instance 0 = slides, 2 = notes (1 = masters, skipped).
        const inner = type === 0x0ff0 ? (inst === 0 ? slides : inst === 2 ? notes : null) : list
        if (!(type === 0x0ff0 && inst === 1)) walk(start, end, depth + 1, inner)
      } else if (type === 0x03f3 && list) list.push([])
      else {
        const s = text(type, doc.subarray(start, end))
        if (s !== null) {
          const v = clean(s)
          if (v) (list ? (list[list.length - 1] ?? (list.push([]), list[0])) : loose).push(v)
        }
      }
      if (end <= p) break
      p = end
    }
  }
  walk(0, doc.length, 0, null)
  return { slides: slides.map((s) => s.join('\n')), notes: notes.map((s) => s.join('\n')), loose }
}

/* ───────────────────────────── Word 97–2003 ───────────────────────────── */

export async function readDoc(bytes: Uint8Array): Promise<{ body: string; notes: string; headers: string }> {
  const { default: WordExtractor } = await import('word-extractor')
  const doc = await new WordExtractor().extract(Buffer.from(bytes))
  return {
    body: doc.getBody(),
    notes: [doc.getFootnotes(), doc.getEndnotes()].map((x: string) => x.trim()).filter(Boolean).join('\n\n'),
    headers: doc.getHeaders({ includeFooters: true }).trim()
  }
}
