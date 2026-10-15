/**
 * Text extraction for attached files. Pure and self-contained (no Electron, no
 * app imports) because it runs inside a worker thread with memory limits and a
 * timeout: attachments are untrusted input. Also imported directly by the unit
 * tests (`tests/files.extract.test.ts`).
 *
 * Supported: PDF (text layer, per page), DOCX, legacy DOC / XLS / PPT (legacyOffice.ts), RTF (paragraphs, headings, lists,
 * tables), XLSX (all sheets, shared strings, dates, formulas without cached
 * value), PPTX (text per slide), CSV / TSV (delimiter detection), TXT and code,
 * Markdown, JSON (pretty-printed), images (dimensions; text by OCR when the caller provides it — ocr.ts), scanned PDF pages (OCR).
 */
import { Unzip, UnzipInflate, type UnzipFile } from 'fflate'
import Papa from 'papaparse'
// Explicit .ts: these modules are also loaded directly by Node in the unit tests (no bundler there).
import { readDoc, readPpt, readXls } from './legacyOffice.ts'
import { encodeGrayPng, toGray, type OcrFn } from './ocr.ts'
import type { I18nKey } from '../../shared/i18n'

/**
 * Translator handed in by the caller (the worker creates its own i18next instance; this module imports
 * no i18n runtime so it stays self-contained and testable). Without one, keys come back as-is, followed
 * by their parameter values.
 */
export type ExtractT = (key: Extract<I18nKey, `main:files.extract.${string}`>, opts?: Record<string, string | number>) => string

export interface ExtractText {
  t: ExtractT
  /** BCP 47 tag for number formatting (e.g. "en-US"). */
  locale: string
}

const keyT: ExtractT = (key, opts) => (opts ? `${key} ${Object.values(opts).join(' ')}` : key)
export const DEFAULT_TEXT: ExtractText = { t: keyT, locale: 'en-US' }

export type ExtractKind = 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'rtf' | 'doc' | 'xls' | 'ppt' | 'csv' | 'text' | 'markdown' | 'json' | 'image' | 'other'
export type ExtractStatus = 'ready' | 'partial' | 'unsupported' | 'failed'

export interface ExtractLimits {
  /** Max decompressed bytes of one ZIP entry (DOCX / XLSX / PPTX). */
  zipEntryBytes: number
  /** Max decompressed bytes of all entries read from one ZIP. */
  zipTotalBytes: number
  /** Max characters of extracted text kept. */
  maxChars: number
  /** Max rows per sheet / CSV. */
  maxRows: number
  /** Max PDF pages read. */
  maxPages: number
  /** Target characters per chunk. */
  chunkChars: number
  /** OCR: at most this many image-only PDF pages, within this many milliseconds (the worker's own limit is 120 s). */
  ocrPages: number
  ocrMs: number
}

export const DEFAULT_LIMITS: ExtractLimits = {
  zipEntryBytes: 120 * 1024 * 1024,
  zipTotalBytes: 250 * 1024 * 1024,
  maxChars: 8_000_000,
  maxRows: 200_000,
  maxPages: 3000,
  chunkChars: 3500,
  ocrPages: 20,
  ocrMs: 75_000
}

export interface Chunk {
  label: string
  text: string
}

export interface ExtractResult {
  kind: ExtractKind
  mime: string
  status: ExtractStatus
  /** Short explanation (UI language) for partial / unsupported / failed results. */
  message: string | null
  chunks: Chunk[]
  chars: number
  pages: number | null
  sheets: string[] | null
  width: number | null
  height: number | null
  encoding: string | null
  warnings: string[]
  /** Lines that look like instructions to an AI (heuristic; content stays data either way). */
  suspicious: string[]
}

/* ───────────────────────────── kind detection ───────────────────────────── */

const TEXT_EXT = new Set(
  (
    'txt log ini cfg conf toml yaml yml xml html htm css scss less js mjs cjs jsx ts tsx py rb php java kt kts go rs c h cc cpp hpp cs ' +
    'swift m sql sh bash zsh ps1 bat cmd r lua pl dart vue svelte gradle properties env gitignore dockerfile makefile tex rst adoc svg srt vtt'
  ).split(' ')
)
const IMAGE_MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' }

export function extOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name
  const i = base.lastIndexOf('.')
  if (i <= 0) return /^(dockerfile|makefile)$/i.test(base) ? base.toLowerCase() : ''
  return base.slice(i + 1).toLowerCase()
}

const startsWith = (b: Uint8Array, sig: number[]): boolean => sig.every((v, i) => b[i] === v)

/** Decides how to read a file from its extension, checked against its first bytes. */
export function detectKind(name: string, bytes: Uint8Array): { kind: ExtractKind; mime: string } {
  const ext = extOf(name)
  const isZip = startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])
  const isPdf = startsWith(bytes, [0x25, 0x50, 0x44, 0x46]) // %PDF
  if (ext === 'pdf' || isPdf) return { kind: 'pdf', mime: 'application/pdf' }
  if (ext === 'docx' && isZip) return { kind: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }
  if ((ext === 'xlsx' || ext === 'xlsm') && isZip) return { kind: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
  if (ext === 'pptx' && isZip) return { kind: 'pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }
  if (bytes.length > 5 && String.fromCharCode(...bytes.subarray(0, 5)) === '{\\rtf') return { kind: 'rtf', mime: 'application/rtf' }
  // Office 97–2003: an OLE compound file; the extension says which application.
  const isOle = bytes.length > 512 && [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((b, i) => bytes[i] === b)
  if (isOle && (ext === 'doc' || ext === 'dot')) return { kind: 'doc', mime: 'application/msword' }
  if (isOle && (ext === 'xls' || ext === 'xlt')) return { kind: 'xls', mime: 'application/vnd.ms-excel' }
  if (isOle && (ext === 'ppt' || ext === 'pps' || ext === 'pot')) return { kind: 'ppt', mime: 'application/vnd.ms-powerpoint' }
  const img = imageInfo(bytes)
  if (img) return { kind: 'image', mime: img.mime }
  if (IMAGE_MIME[ext]) return { kind: 'other', mime: IMAGE_MIME[ext] } // extension says image, bytes do not
  if (ext === 'csv' || ext === 'tsv') return { kind: 'csv', mime: ext === 'tsv' ? 'text/tab-separated-values' : 'text/csv' }
  if (ext === 'json' || ext === 'jsonl' || ext === 'geojson') return { kind: 'json', mime: 'application/json' }
  if (ext === 'md' || ext === 'markdown' || ext === 'mdx') return { kind: 'markdown', mime: 'text/markdown' }
  if (TEXT_EXT.has(ext) || (!isZip && looksLikeText(bytes))) return { kind: 'text', mime: ext === 'svg' ? 'image/svg+xml' : 'text/plain' }
  return { kind: 'other', mime: 'application/octet-stream' }
}

function looksLikeText(b: Uint8Array): boolean {
  if (!b.length) return true
  if (startsWith(b, [0xff, 0xfe]) || startsWith(b, [0xfe, 0xff])) return true
  const n = Math.min(b.length, 8192)
  let ctrl = 0
  for (let i = 0; i < n; i++) {
    const c = b[i]
    if (c === 0) return false
    if (c < 9 || (c > 13 && c < 32)) ctrl++
  }
  return ctrl / n < 0.02
}

/** Width / height and mime of PNG, JPEG, GIF, WebP and BMP images. */
export function imageInfo(b: Uint8Array): { mime: string; width: number; height: number } | null {
  const u16be = (o: number): number => (b[o] << 8) | b[o + 1]
  const u16le = (o: number): number => b[o] | (b[o + 1] << 8)
  const u32be = (o: number): number => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3]
  const u32le = (o: number): number => b[o] + (b[o + 1] << 8) + (b[o + 2] << 16) + ((b[o + 3] << 24) >>> 0)
  if (b.length >= 24 && startsWith(b, [0x89, 0x50, 0x4e, 0x47])) return { mime: 'image/png', width: u32be(16), height: u32be(20) }
  if (b.length >= 10 && startsWith(b, [0x47, 0x49, 0x46, 0x38])) return { mime: 'image/gif', width: u16le(6), height: u16le(8) }
  if (b.length >= 26 && startsWith(b, [0x42, 0x4d])) return { mime: 'image/bmp', width: u32le(18), height: Math.abs(u32le(22) | 0) }
  if (b.length >= 30 && startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b.subarray(8), [0x57, 0x45, 0x42, 0x50])) {
    const fmt = String.fromCharCode(b[12], b[13], b[14], b[15])
    if (fmt === 'VP8 ') return { mime: 'image/webp', width: u16le(26) & 0x3fff, height: u16le(28) & 0x3fff }
    if (fmt === 'VP8L') {
      const bits = u32le(21)
      return { mime: 'image/webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
    }
    if (fmt === 'VP8X') return { mime: 'image/webp', width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) }
    return { mime: 'image/webp', width: 0, height: 0 }
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let o = 2
    while (o + 9 < b.length) {
      if (b[o] !== 0xff) {
        o++
        continue
      }
      const marker = b[o + 1]
      if (marker === 0xd9 || marker === 0xda) break
      const len = u16be(o + 2)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { mime: 'image/jpeg', height: u16be(o + 5), width: u16be(o + 7) }
      }
      o += 2 + len
    }
    return { mime: 'image/jpeg', width: 0, height: 0 }
  }
  return null
}

/* ───────────────────────────── text decoding ───────────────────────────── */

export function decodeText(b: Uint8Array): { text: string; encoding: string } {
  if (startsWith(b, [0xef, 0xbb, 0xbf])) return { text: new TextDecoder('utf-8').decode(b.subarray(3)), encoding: 'UTF-8 (BOM)' }
  if (startsWith(b, [0xff, 0xfe])) return { text: new TextDecoder('utf-16le').decode(b.subarray(2)), encoding: 'UTF-16 LE' }
  if (startsWith(b, [0xfe, 0xff])) return { text: new TextDecoder('utf-16be').decode(b.subarray(2)), encoding: 'UTF-16 BE' }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(b), encoding: 'UTF-8' }
  } catch {
    // Not valid UTF-8: most likely a Turkish Windows export (Excel CSV, Notepad).
    try {
      return { text: new TextDecoder('windows-1254').decode(b), encoding: 'Windows-1254' }
    } catch {
      return { text: new TextDecoder('latin1').decode(b), encoding: 'Latin-1' }
    }
  }
}

/* ───────────────────────────── ZIP (bounded) ───────────────────────────── */

/**
 * Reads selected ZIP entries with hard limits on decompressed size (zip bombs
 * lie about sizes in their headers, so the limit is enforced while inflating).
 */
export function readZip(buf: Uint8Array, want: (name: string) => boolean, limits: ExtractLimits, t: ExtractT = keyT): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>()
  let total = 0
  let error = null as Error | null
  const uz = new Unzip((file: UnzipFile) => {
    if (error || !want(file.name)) return
    const parts: Uint8Array[] = []
    let size = 0
    file.ondata = (err, data, final) => {
      if (error) return
      if (err) {
        error = new Error(t('main:files.extract.zipError', { message: err.message }))
        return
      }
      size += data.length
      total += data.length
      if (size > limits.zipEntryBytes || total > limits.zipTotalBytes) {
        error = new Error(t('main:files.extract.zipBomb'))
        file.terminate()
        return
      }
      parts.push(data)
      if (final) {
        const all = new Uint8Array(size)
        let o = 0
        for (const p of parts) {
          all.set(p, o)
          o += p.length
        }
        out.set(file.name, all)
      }
    }
    file.start()
  })
  uz.register(UnzipInflate)
  // Push in slices so a limit violation stops work early.
  const STEP = 1 << 20
  for (let i = 0; i < buf.length && !error; i += STEP) uz.push(buf.subarray(i, Math.min(buf.length, i + STEP)), i + STEP >= buf.length)
  if (error) throw error
  return out
}

const utf8 = (b: Uint8Array | undefined): string => (b ? new TextDecoder('utf-8').decode(b) : '')

/* ───────────────────────────── XML helpers ───────────────────────────── */

export function xmlDecode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (_m, e: string) => {
    const k = e.toLowerCase()
    if (k === 'lt') return '<'
    if (k === 'gt') return '>'
    if (k === 'amp') return '&'
    if (k === 'quot') return '"'
    if (k === 'apos') return "'"
    const code = k.startsWith('#x') ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10)
    try {
      return String.fromCodePoint(code)
    } catch {
      return ''
    }
  })
}

const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag)
  return m ? xmlDecode(m[1]) : null
}

/** Index of the matching close tag of an element that may nest (e.g. w:tbl). */
function matchClose(xml: string, from: number, tag: string): number {
  const open = new RegExp(`<${tag}[\\s>/]|</${tag}>`, 'g')
  open.lastIndex = from
  let depth = 0
  let m: RegExpExecArray | null
  while ((m = open.exec(xml))) {
    if (m[0].startsWith('</')) {
      depth--
      if (depth === 0) return m.index + m[0].length
    } else {
      // Self-closing <tag .../> does not nest.
      const end = xml.indexOf('>', m.index)
      if (xml[end - 1] !== '/') depth++
      else if (depth === 0) return end + 1
    }
  }
  return xml.length
}

/* ───────────────────────────── sections & chunking ───────────────────────────── */

interface TextSection {
  label: string
  text: string
  /** A numbered page / slide: keeps a "[label]" marker when merged with its neighbours. */
  marker?: boolean
}
interface TableSection {
  label: string
  /** Row number as in the source (1-based), and cells. */
  rows: { n: number; cells: string[] }[]
}
type Section = TextSection | TableSection
const isTable = (s: Section): s is TableSection => 'rows' in s

const cellText = (c: string): string => c.replace(/\r?\n/g, ' ⏎ ').replace(/\|/g, '\\|').trim()
const rowLine = (cells: string[]): string => cells.map(cellText).join(' | ')

/** Splits long text on paragraph / line / sentence boundaries. */
function splitText(text: string, max: number): string[] {
  if (text.length <= max) return [text]
  const out: string[] = []
  let rest = text
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n\n', max)
    if (cut < max * 0.5) cut = rest.lastIndexOf('\n', max)
    if (cut < max * 0.5) cut = rest.lastIndexOf('. ', max) + 1
    if (cut < max * 0.5) cut = rest.lastIndexOf(' ', max)
    if (cut < max * 0.5) cut = max
    out.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) out.push(rest)
  return out
}

/**
 * Turns sections into chunks of about `max` characters. Small consecutive text
 * sections are merged ("Pages 1–3"); long ones are split ("Page 4 (2/3)");
 * table chunks repeat the header row and say which source rows they hold.
 */
export function chunkSections(sections: Section[], max: number, mergeLabel: (a: string, b: string) => string, t: ExtractT = keyT): Chunk[] {
  const chunks: Chunk[] = []
  const rowsLabel = (from: number, to: number): string =>
    from === to ? t('main:files.extract.row', { range: String(from) }) : t('main:files.extract.rows', { range: `${from}–${to}` })
  // Small consecutive sections share a chunk; each keeps a "[label]" marker so pages stay identifiable.
  let pending: { label: string; text: string; marker?: boolean }[] = []
  let pendingSize = 0
  const flush = (): void => {
    if (pending.length === 1) chunks.push({ label: pending[0].label, text: pending[0].text })
    else if (pending.length > 1) {
      chunks.push({
        label: mergeLabel(pending[0].label, pending[pending.length - 1].label),
        text: pending.map((p) => (p.marker ? `[${p.label}]\n${p.text}` : p.text)).join('\n\n')
      })
    }
    pending = []
    pendingSize = 0
  }
  for (const s of sections) {
    if (isTable(s)) {
      flush()
      if (!s.rows.length) continue
      const [head, ...body] = s.rows
      const headLine = rowLine(head.cells)
      if (!body.length) {
        chunks.push({ label: `${s.label} · ${rowsLabel(head.n, head.n)}`, text: headLine })
        continue
      }
      let cur: typeof body = []
      let size = headLine.length
      const emit = (): void => {
        if (!cur.length) return
        const from = cur[0].n
        const to = cur[cur.length - 1].n
        chunks.push({ label: `${s.label} · ${rowsLabel(from, to)}`, text: headLine + '\n' + cur.map((r) => rowLine(r.cells)).join('\n') })
        cur = []
        size = headLine.length
      }
      for (const r of body) {
        const line = rowLine(r.cells)
        if (size + line.length + 1 > max && cur.length) emit()
        cur.push(r)
        size += line.length + 1
      }
      emit()
      continue
    }
    const text = s.text.trim()
    if (!text) continue
    if (text.length > max) {
      flush()
      const parts = splitText(text, max)
      parts.forEach((p, i) => chunks.push({ label: `${s.label} (${i + 1}/${parts.length})`, text: p }))
      continue
    }
    if (pending.length && pendingSize + text.length + s.label.length + 4 > max) flush()
    pending.push({ label: s.label, text, marker: s.marker })
    pendingSize += text.length + s.label.length + 4
  }
  flush()
  return chunks
}

/* ───────────────────────────── format readers ───────────────────────────── */

interface Partial_ {
  sections: Section[]
  pages?: number
  sheets?: string[]
  encoding?: string
  warnings: string[]
  status?: ExtractStatus
  message?: string
}

/** Per-file text context: the translator plus the page / slide labels issued (for merged-chunk labels). */
interface Cx extends ExtractText {
  numbered: Map<string, { kind: 'page' | 'slide'; n: number }>
}

function numberedLabel(cx: Cx, kind: 'page' | 'slide', n: number): string {
  const label = cx.t(kind === 'page' ? 'main:files.extract.page' : 'main:files.extract.slide', { n })
  cx.numbered.set(label, { kind, n })
  return label
}

async function readPdf(bytes: Uint8Array, limits: ExtractLimits, cx: Cx, ocr?: OcrFn): Promise<Partial_> {
  const { t } = cx
  const { getDocumentProxy, extractImages } = await import('unpdf')
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>
  try {
    // pdf.js takes ownership of the buffer; give it a copy.
    pdf = await getDocumentProxy(new Uint8Array(bytes), { isEvalSupported: false, useSystemFonts: false, disableFontFace: true, verbosity: 0 } as never)
  } catch (e) {
    const msg = String((e as Error)?.message ?? e)
    if (/password/i.test(msg)) throw new Error(t('main:files.extract.pdfPassword'))
    throw new Error(t('main:files.extract.pdfError', { message: msg.slice(0, 160) }))
  }
  const warnings: string[] = []
  const total = pdf.numPages
  const n = Math.min(total, limits.maxPages)
  if (n < total) warnings.push(t('main:files.extract.pdfPagesLimited', { total, n }))
  const sections: TextSection[] = []
  let chars = 0
  for (let i = 1; i <= n; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    let line = ''
    const lines: string[] = []
    for (const item of content.items as { str?: string; hasEOL?: boolean }[]) {
      if (typeof item.str !== 'string') continue
      line += item.str
      if (item.hasEOL) {
        lines.push(line)
        line = ''
      }
    }
    if (line) lines.push(line)
    const text = lines
      .join('\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    chars += text.length
    sections.push({ label: numberedLabel(cx, 'page', i), text, marker: true })
    page.cleanup()
    if (chars > limits.maxChars) {
      warnings.push(t('main:files.extract.textLimitPage', { n: i }))
      break
    }
  }
  // Scanned pages (no text layer): OCR the page's largest image.
  const allBlank = sections.filter((s) => !s.text)
  const blank = allBlank.slice(0, ocr ? limits.ocrPages : 0)
  if (ocr && blank.length) {
    const pngs: { section: TextSection; png: Uint8Array }[] = []
    for (const s of blank) {
      const n = cx.numbered.get(s.label)?.n
      if (!n) continue
      try {
        const imgs = await extractImages(pdf, n)
        const big = imgs.sort((a, b) => b.width * b.height - a.width * a.height)[0]
        const gray = big && big.width >= 200 && big.height >= 60 ? toGray(big) : null
        if (gray) pngs.push({ section: s, png: encodeGrayPng(big.width, big.height, gray) })
      } catch {
        /* an image pdf.js can't decode */
      }
    }
    if (pngs.length) {
      const { texts, timedOut } = await ocr(
        pngs.map((p) => p.png),
        limits.ocrMs
      )
      let read = 0
      texts.forEach((text, k) => {
        if (!text) return
        pngs[k].section.text = text
        chars += text.length
        read++
      })
      if (read) warnings.push(t('main:files.extract.pdfOcr', { n: read }))
      if (timedOut || allBlank.length > limits.ocrPages) warnings.push(t('main:files.extract.ocrPartial'))
    }
  }
  await (pdf as unknown as { destroy?: () => Promise<void> }).destroy?.()
  const empty = sections.filter((s) => !s.text).length
  const r: Partial_ = { sections, pages: total, warnings }
  if (!chars) {
    r.status = 'partial'
    r.message = t('main:files.extract.pdfNoText')
  } else if (empty > 0 && empty >= n / 2) {
    warnings.push(t('main:files.extract.pdfEmptyPages', { n: empty }))
  }
  return r
}

function docxParagraph(p: string): { text: string; heading: number; list: boolean } {
  const style = /<w:pStyle\s+w:val="([^"]+)"/.exec(p)?.[1] ?? ''
  const hm = /^(?:heading|balk|başlık|baslik|title|berschrift|titre|titolo)\s*(\d)?$/i.exec(style.replace(/[^A-Za-zçğıöşüÇĞİÖŞÜ0-9]/g, '')) // i18n-ignore
  const heading = /^title$/i.test(style) ? 1 : hm ? Number(hm[1] ?? 1) : 0
  const list = /<w:numPr>/.test(p) || /list|liste/i.test(style)
  let text = ''
  const re = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:(tab|br|cr)\b[^>]*\/>|<w:delText/g
  let m: RegExpExecArray | null
  // Deleted (tracked) text is skipped: drop <w:del> blocks first.
  const body = p.replace(/<w:del\b[\s\S]*?<\/w:del>/g, '')
  while ((m = re.exec(body))) {
    if (m[1] !== undefined) text += xmlDecode(m[1])
    else if (m[2] === 'tab') text += '\t'
    else if (m[2]) text += '\n'
  }
  return { text: text.replace(/[ \t]+$/gm, ''), heading, list }
}

function docxTable(t: string): string[][] {
  const rows: string[][] = []
  const trRe = /<w:tr[\s>][\s\S]*?<\/w:tr>/g
  for (const tr of t.match(trRe) ?? []) {
    const cells: string[] = []
    const tcRe = /<w:tc[\s>][\s\S]*?<\/w:tc>/g
    for (const tc of tr.match(tcRe) ?? []) {
      const paras = tc.match(/<w:p[\s>][\s\S]*?<\/w:p>/g) ?? []
      cells.push(paras.map((p) => docxParagraph(p).text).filter(Boolean).join(' '))
    }
    if (cells.some((c) => c.trim())) rows.push(cells)
  }
  return rows
}

function readDocx(bytes: Uint8Array, limits: ExtractLimits, { t }: Cx): Partial_ {
  const files = readZip(bytes, (n) => n === 'word/document.xml', limits, t)
  const xml = utf8(files.get('word/document.xml'))
  if (!xml) throw new Error(t('main:files.extract.docxInvalid'))
  const body = xml.slice(Math.max(0, xml.indexOf('<w:body')))
  const sections: TextSection[] = []
  let cur: TextSection = { label: t('main:files.extract.docStart'), text: '' }
  let n = 1
  const push = (line: string): void => {
    cur.text += (cur.text ? '\n' : '') + line
  }
  const re = /<w:tbl[\s>]|<w:p[\s>]|<w:p\/>/g
  let m: RegExpExecArray | null
  let chars = 0
  const warnings: string[] = []
  while ((m = re.exec(body))) {
    if (m[0] === '<w:p/>') {
      push('')
      continue
    }
    if (m[0].startsWith('<w:tbl')) {
      const end = matchClose(body, m.index, 'w:tbl')
      const rows = docxTable(body.slice(m.index, end))
      if (rows.length) push('\n' + rows.map(rowLine).join('\n') + '\n')
      re.lastIndex = end
      continue
    }
    const end = body.indexOf('</w:p>', m.index)
    if (end < 0) break
    const para = docxParagraph(body.slice(m.index, end + 6))
    re.lastIndex = end + 6
    if (para.heading && para.text.trim()) {
      if (cur.text.trim()) sections.push(cur)
      n++
      cur = { label: para.text.trim().slice(0, 60), text: '' }
      push(`${'#'.repeat(Math.min(6, para.heading))} ${para.text.trim()}`)
    } else {
      push(para.list && para.text.trim() ? `- ${para.text}` : para.text)
    }
    chars += para.text.length
    if (chars > limits.maxChars) {
      warnings.push(t('main:files.extract.textLimitDoc'))
      break
    }
  }
  if (cur.text.trim()) sections.push(cur)
  for (const s of sections) s.text = s.text.replace(/\n{3,}/g, '\n\n').trim()
  void n
  if (/<w:footnoteReference|<w:endnoteReference/.test(body)) warnings.push(t('main:files.extract.footnotes'))
  return { sections, warnings }
}

/* XLSX */

const BUILTIN_DATE_FMT = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47])

function isDateFormat(code: string): boolean {
  const s = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '')
  return /[dmyhs]/i.test(s) && !/^[#0.,%\s]*$/.test(s)
}

function excelDate(serial: number, date1904: boolean, timeOnly: boolean): string {
  const ms = Math.round((serial + (date1904 ? 1462 : 0) - 25569) * 86400 * 1000)
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return String(serial)
  const iso = d.toISOString()
  const hasTime = Math.abs(serial % 1) > 1e-9
  if (timeOnly) return iso.slice(11, 19)
  return hasTime ? `${iso.slice(0, 10)} ${iso.slice(11, 19)}` : iso.slice(0, 10)
}

function colIndex(ref: string): number {
  let n = 0
  for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

function readXlsx(bytes: Uint8Array, limits: ExtractLimits, { t }: Cx): Partial_ {
  const want = (n: string): boolean =>
    n === 'xl/workbook.xml' || n === 'xl/_rels/workbook.xml.rels' || n === 'xl/sharedStrings.xml' || n === 'xl/styles.xml' || /^xl\/worksheets\/[^/]+\.xml$/.test(n)
  const files = readZip(bytes, want, limits, t)
  const wb = utf8(files.get('xl/workbook.xml'))
  if (!wb) throw new Error(t('main:files.extract.xlsxInvalid'))
  const date1904 = /<workbookPr[^>]*date1904="(1|true)"/.test(wb)
  const rels = new Map<string, string>()
  for (const r of utf8(files.get('xl/_rels/workbook.xml.rels')).match(/<Relationship\b[^>]*>/g) ?? []) {
    const id = attr(r, 'Id')
    const target = attr(r, 'Target')
    if (id && target) rels.set(id, target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, ''))
  }
  // Shared strings (rich text runs concatenated; phonetic runs skipped).
  const shared: string[] = []
  for (const si of utf8(files.get('xl/sharedStrings.xml')).match(/<si>[\s\S]*?<\/si>|<si\/>/g) ?? []) {
    const clean = si.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '')
    shared.push([...clean.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((x) => xmlDecode(x[1])).join(''))
  }
  // Styles: which cell formats are dates.
  const styles = utf8(files.get('xl/styles.xml'))
  const customFmt = new Map<number, string>()
  for (const f of styles.match(/<numFmt\b[^>]*>/g) ?? []) customFmt.set(Number(attr(f, 'numFmtId')), attr(f, 'formatCode') ?? '')
  const xfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? ''
  const dateStyle: ('date' | 'time' | null)[] = (xfs.match(/<xf\b[^>]*>/g) ?? []).map((xf) => {
    const id = Number(attr(xf, 'numFmtId') ?? 0)
    if (BUILTIN_DATE_FMT.has(id)) return id >= 18 && id <= 21 ? 'time' : id === 45 || id === 46 || id === 47 ? 'time' : 'date'
    const code = customFmt.get(id)
    if (code && isDateFormat(code)) return /[dy]/i.test(code.replace(/"[^"]*"/g, '')) ? 'date' : 'time'
    return null
  })

  const sections: TableSection[] = []
  const sheets: string[] = []
  const warnings: string[] = []
  let cells = 0
  for (const s of wb.match(/<sheet\b[^>]*>/g) ?? []) {
    const name = attr(s, 'name') ?? t('main:files.extract.sheet', { n: sheets.length + 1 })
    const rid = attr(s, 'r:id')
    const path = rid ? rels.get(rid) : undefined
    sheets.push(name)
    const xml = path ? utf8(files.get(path)) : ''
    if (!xml) continue
    if (attr(s, 'state') && attr(s, 'state') !== 'visible') warnings.push(t('main:files.extract.hiddenSheet', { name }))
    const rows: TableSection['rows'] = []
    const rowRe = /<row\b([^>]*)>([\s\S]*?)<\/row>/g
    let rm: RegExpExecArray | null
    let rowNo = 0
    while ((rm = rowRe.exec(xml))) {
      rowNo = Number(attr(rm[1], 'r') ?? rowNo + 1)
      const out: string[] = []
      const cRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g
      let cm: RegExpExecArray | null
      let col = 0
      while ((cm = cRe.exec(rm[2]))) {
        const a = cm[1]
        const inner = cm[2] ?? ''
        const ref = attr(a, 'r')
        col = ref ? colIndex(ref) : col
        const t = attr(a, 't')
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1]
        const f = /<f\b[^>]*>([\s\S]*?)<\/f>/.exec(inner)?.[1]
        let val = ''
        if (t === 's') val = v !== undefined ? shared[Number(v)] ?? '' : ''
        else if (t === 'inlineStr') val = [...inner.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((x) => xmlDecode(x[1])).join('')
        else if (t === 'b') val = v === '1' ? 'TRUE' : v === '0' ? 'FALSE' : ''
        else if (t === 'str' || t === 'e') val = v !== undefined ? xmlDecode(v) : ''
        else if (v !== undefined) {
          const num = Number(v)
          const ds = dateStyle[Number(attr(a, 's') ?? 0)]
          val = ds && Number.isFinite(num) ? excelDate(num, date1904, ds === 'time' && num < 1) : v
        }
        if (!val && f) val = '=' + xmlDecode(f)
        while (out.length < col) out.push('')
        out[col] = val
        col++
        cells++
      }
      while (out.length && !out[out.length - 1]) out.pop()
      if (out.length) rows.push({ n: rowNo, cells: out })
      if (rows.length >= limits.maxRows || cells > 3_000_000) {
        warnings.push(t('main:files.extract.sheetRowLimit', { name, row: rowNo }))
        break
      }
    }
    sections.push({ label: name, rows })
  }
  return { sections, sheets, warnings }
}

function readPptx(bytes: Uint8Array, limits: ExtractLimits, cx: Cx): Partial_ {
  const { t } = cx
  const files = readZip(bytes, (n) => /^ppt\/slides\/slide\d+\.xml$/.test(n) || /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n), limits, t)
  const slides = [...files.keys()].filter((k) => k.startsWith('ppt/slides/')).sort((a, b) => Number(/\d+/.exec(a.slice(11))?.[0]) - Number(/\d+/.exec(b.slice(11))?.[0]))
  if (!slides.length) throw new Error(t('main:files.extract.pptxInvalid'))
  const para = (xml: string): string =>
    (xml.match(/<a:p>[\s\S]*?<\/a:p>|<a:p\b[^>]*>[\s\S]*?<\/a:p>/g) ?? [])
      .map((p) => [...p.matchAll(/<a:t>([^<]*)<\/a:t>|<a:br\/>/g)].map((x) => (x[1] !== undefined ? xmlDecode(x[1]) : '\n')).join(''))
      .filter((l) => l.trim())
      .join('\n')
  const sections: TextSection[] = slides.map((s, i) => {
    const num = /\d+/.exec(s.slice(11))?.[0] ?? String(i + 1)
    const notes = para(utf8(files.get(`ppt/notesSlides/notesSlide${num}.xml`)))
    return {
      label: numberedLabel(cx, 'slide', i + 1),
      text: para(utf8(files.get(s))) + (notes ? `\n\n[${t('main:files.extract.speakerNotes')}]\n${notes}` : ''),
      marker: true
    }
  })
  return { sections, pages: slides.length, warnings: [] }
}

/**
 * Rich Text Format → plain text. Groups are tracked on a stack; font / colour / style tables, pictures, objects, headers
 * and every `\*` destination are skipped; `\'hh` bytes decode with the document's code page (`\ansicpg`, e.g. 1254
 * Turkish), `\uN` is a Unicode character followed by `\ucN` fallback characters that are skipped.
 */
const RTF_SKIP = new Set(['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object', 'header', 'headerl', 'headerr', 'headerf', 'footer', 'footerl', 'footerr', 'footerf', 'fldinst', 'listtable', 'listoverridetable', 'rsidtbl', 'xmlnstbl', 'generator', 'themedata', 'colorschememapping', 'datastore', 'latentstyles', 'pgdsctbl', 'filetbl', 'revtbl', 'bkmkstart', 'bkmkend', 'nonshppict', 'shppict'])
const RTF_CHARS: Record<string, string> = { par: '\n', line: '\n', sect: '\n\n', page: '\n\n', row: '\n', cell: ' | ', tab: '\t', emdash: '—', endash: '–', bullet: '•', lquote: '‘', rquote: '’', ldblquote: '“', rdblquote: '”', emspace: ' ', enspace: ' ', qmspace: ' ' }

export function rtfToText(src: string): string {
  let codepage = 'windows-1252'
  const out: string[] = []
  let bytes: number[] = []
  const flush = (): void => {
    if (!bytes.length) return
    try {
      out.push(new TextDecoder(codepage).decode(new Uint8Array(bytes)))
    } catch {
      out.push(new TextDecoder('windows-1252').decode(new Uint8Array(bytes)))
    }
    bytes = []
  }
  const stack: { skip: boolean; uc: number }[] = []
  let state = { skip: false, uc: 1 }
  let pendingSkip = 0 // fallback characters still to drop after a \uN
  const emit = (s: string): void => {
    if (state.skip) return
    flush()
    out.push(s)
  }
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (c === '{') {
      stack.push(state)
      state = { ...state }
      i++
      // {\* ...} — an ignorable destination
      if (src.startsWith('\\*', i)) state.skip = true
      continue
    }
    if (c === '}') {
      flush()
      state = stack.pop() ?? { skip: false, uc: 1 }
      pendingSkip = 0
      i++
      continue
    }
    if (c === '\\') {
      const next = src[i + 1]
      if (next === "'") {
        const hex = src.slice(i + 2, i + 4)
        i += 4
        if (pendingSkip > 0) {
          pendingSkip--
          continue
        }
        if (!state.skip && /^[0-9a-f]{2}$/i.test(hex)) bytes.push(parseInt(hex, 16))
        continue
      }
      if (next === '{' || next === '}' || next === '\\') {
        i += 2
        if (pendingSkip > 0) pendingSkip--
        else emit(next)
        continue
      }
      if (next === '~') (emit(' '), (i += 2))
      else if (next === '_') (emit('-'), (i += 2))
      else if (next === '-' || next === '*' || next === ':' || next === '|') i += 2
      else if (next === '\n' || next === '\r') (emit('\n'), (i += 2))
      else {
        const m = /^([a-z]{1,32})(-?\d{1,10})? ?/i.exec(src.slice(i + 1, i + 46))
        if (!m) {
          i++
          continue
        }
        i += 1 + m[0].length
        const word = m[1]
        const arg = m[2] !== undefined ? Number(m[2]) : null
        if (RTF_SKIP.has(word)) state.skip = true
        else if (word === 'ansicpg' && arg) codepage = `windows-${arg}`
        else if (word === 'uc' && arg !== null) state.uc = arg
        else if (word === 'u' && arg !== null) {
          emit(String.fromCodePoint(arg < 0 ? arg + 65536 : arg))
          pendingSkip = state.uc
        } else if (RTF_CHARS[word]) emit(RTF_CHARS[word])
      }
      continue
    }
    if (c === '\r' || c === '\n') {
      i++
      continue
    }
    if (pendingSkip > 0) {
      pendingSkip--
      i++
      continue
    }
    emit(c)
    i++
  }
  flush()
  return out
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/* Office 97–2003 (legacyOffice.ts) */

async function readLegacy(kind: 'doc' | 'xls' | 'ppt', bytes: Uint8Array, limits: ExtractLimits, cx: Cx): Promise<Partial_> {
  const { t } = cx
  try {
    if (kind === 'doc') {
      const d = await readDoc(bytes)
      const sections: TextSection[] = [{ label: t('main:files.extract.text'), text: d.body.trim().slice(0, limits.maxChars) }]
      if (d.notes) sections.push({ label: t('main:files.extract.docNotes'), text: d.notes.slice(0, 200_000) })
      if (d.headers) sections.push({ label: t('main:files.extract.docHeaders'), text: d.headers.slice(0, 50_000) })
      return { sections, warnings: d.body.length > limits.maxChars ? [t('main:files.extract.truncated', { max: limits.maxChars.toLocaleString(cx.locale) })] : [] }
    }
    if (kind === 'xls') {
      const r = readXls(bytes, limits.maxRows)
      if (r.encrypted) throw new Error(t('main:files.extract.legacyEncrypted'))
      if (r.old) throw new Error(t('main:files.extract.xlsOld'))
      const warnings: string[] = []
      for (const s of r.sheets) {
        if (s.hidden) warnings.push(t('main:files.extract.hiddenSheet', { name: s.name }))
        if (s.truncated) warnings.push(t('main:files.extract.sheetRowLimit', { name: s.name, row: s.rows[s.rows.length - 1]?.n ?? 0 }))
      }
      return { sections: r.sheets.map((s) => ({ label: s.name, rows: s.rows })), sheets: r.sheets.map((s) => s.name), warnings }
    }
    const r = readPpt(bytes)
    const sections: TextSection[] = r.slides.map((text, i) => ({
      label: numberedLabel(cx, 'slide', i + 1),
      text: text + (r.notes[i] ? `\n\n[${t('main:files.extract.speakerNotes')}]\n${r.notes[i]}` : ''),
      marker: true
    }))
    // No slide list (unusual writers): whatever text the file holds, in order.
    if (!sections.length && r.loose.length) sections.push({ label: t('main:files.extract.text'), text: r.loose.join('\n') })
    return { sections, pages: r.slides.length || undefined, warnings: [] }
  } catch (e) {
    const msg = String((e as Error)?.message ?? e)
    if (msg === t('main:files.extract.legacyEncrypted') || msg === t('main:files.extract.xlsOld')) throw e
    throw new Error(t('main:files.extract.legacyInvalid', { message: msg.slice(0, 120) }))
  }
}

function readCsv(text: string, ext: string, limits: ExtractLimits, { t, locale }: Cx): Partial_ {
  const res = Papa.parse<string[]>(text, {
    delimiter: ext === 'tsv' ? '\t' : '',
    delimitersToGuess: [',', ';', '\t', '|'],
    skipEmptyLines: 'greedy',
    preview: limits.maxRows + 1
  })
  const warnings: string[] = []
  if (res.data.length > limits.maxRows) warnings.push(t('main:files.extract.csvRowLimit', { max: limits.maxRows.toLocaleString(locale) }))
  const bad = res.errors.filter((e) => e.type !== 'Delimiter').length
  if (bad) warnings.push(t('main:files.extract.csvBadRows', { n: bad }))
  const rows = res.data.slice(0, limits.maxRows).map((cells, i) => ({ n: i + 1, cells: cells.map((c) => String(c ?? '')) }))
  const delim = res.meta.delimiter === '\t' ? t('main:files.extract.tab') : `“${res.meta.delimiter}”`
  return { sections: [{ label: t('main:files.extract.table'), rows }], warnings: [t('main:files.extract.delimiter', { delim }), ...warnings] }
}

function readMarkdown(text: string, { t }: Cx): Partial_ {
  const sections: TextSection[] = []
  let cur: TextSection = { label: t('main:files.extract.intro'), text: '' }
  let fence = false
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence
    const h = !fence && /^(#{1,3})\s+(.+)/.exec(line)
    if (h) {
      if (cur.text.trim()) sections.push(cur)
      cur = { label: h[2].trim().slice(0, 60), text: '' }
    }
    cur.text += line + '\n'
  }
  if (cur.text.trim()) sections.push(cur)
  return { sections, warnings: [] }
}

function readJson(text: string, ext: string, { t }: Cx): Partial_ {
  if (ext === 'jsonl') {
    const lines = text.split(/\r?\n/).filter((l) => l.trim())
    let bad = 0
    for (const l of lines.slice(0, 1000)) {
      try {
        JSON.parse(l)
      } catch {
        bad++
      }
    }
    return { sections: [{ label: t('main:files.extract.jsonLines'), text: lines.join('\n') }], warnings: bad ? [t('main:files.extract.jsonBadLines', { n: bad })] : [] }
  }
  try {
    const v = JSON.parse(text)
    const pretty = text.length < 4_000_000 ? JSON.stringify(v, null, 2) : text
    return { sections: [{ label: 'JSON', text: pretty }], warnings: [] }
  } catch (e) {
    return { sections: [{ label: t('main:files.extract.jsonInvalidLabel'), text }], warnings: [t('main:files.extract.jsonInvalid', { message: (e as Error).message.slice(0, 120) })] }
  }
}

/* ───────────────────────────── instruction-like content ───────────────────────────── */

const SUSPICIOUS = [
  /\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all|system)\b[^.\n]{0,20}\b(instructions?|prompts?|rules?|messages?)/i,
  /\byou are now\b|\bact as (an? )?(admin|administrator|root|developer mode)/i,
  /\b(system|developer)\s*(prompt|message|instructions?)\s*[:=]/i,
  /^\s*(system|assistant)\s*:/im,
  /<\s*\/?\s*(system|instructions?|im_start|im_end)\b[^>]*>/i,
  /\bdo not (tell|inform|show) the user\b/i,
  /(önceki|tüm|yukarıdaki)\s+(talimat|komut|kural)\w*\s+(yok say|unut|görmezden gel|dikkate alma)/i, // i18n-ignore
  /\b(sistem|geliştirici)\s+(mesajı|komutu|talimatı)\s*[:=]/i, // i18n-ignore
  /kullanıcıya\s+(söyleme|bahsetme|gösterme)/i, // i18n-ignore
  /\b(delete|drop|wipe|exfiltrate|upload|send)\b[^.\n]{0,40}\b(database|all files|credentials|secrets?|api keys?|passwords?)\b/i,
  /(veritaban\w*|tüm dosyalar\w*|şifre\w*|parola\w*|anahtar\w*)[^.\n]{0,40}\b(sil|gönder|yükle|paylaş)/i // i18n-ignore
]

export function findSuspicious(text: string, max = 5): string[] {
  const out: string[] = []
  for (const line of text.split(/\n/)) {
    if (line.length > 2000) continue
    if (SUSPICIOUS.some((re) => re.test(line))) {
      out.push(line.trim().slice(0, 200))
      if (out.length >= max) break
    }
  }
  return out
}

/* ───────────────────────────── entry point ───────────────────────────── */

/** "Pages 1–3" / "Slides 2–4" for runs of numbered sections, otherwise "first … last". */
const mergeLabelFor =
  (cx: Cx) =>
  (a: string, b: string): string => {
    const na = cx.numbered.get(a)
    const nb = cx.numbered.get(b)
    if (na && nb && na.kind === nb.kind) {
      return cx.t(na.kind === 'page' ? 'main:files.extract.pageRange' : 'main:files.extract.slideRange', { from: na.n, to: nb.n })
    }
    return `${a} … ${b}`
  }

export async function extractFile(
  bytes: Uint8Array,
  name: string,
  limits: ExtractLimits = DEFAULT_LIMITS,
  strings: ExtractText = DEFAULT_TEXT,
  /** OCR for images and scanned PDF pages (worker: tesseract.js); without it images only report their size. */
  ocr?: OcrFn
): Promise<ExtractResult> {
  const cx: Cx = { ...strings, numbered: new Map() }
  const { t } = cx
  const { kind, mime } = detectKind(name, bytes)
  const ext = extOf(name)
  const base: ExtractResult = {
    kind,
    mime,
    status: 'ready',
    message: null,
    chunks: [],
    chars: 0,
    pages: null,
    sheets: null,
    width: null,
    height: null,
    encoding: null,
    warnings: [],
    suspicious: []
  }
  if (kind === 'image') {
    const info = imageInfo(bytes)!
    const sized = { ...base, width: info.width || null, height: info.height || null, message: t('main:files.extract.image') }
    // OCR only where Tesseract reads the format; tiny icons and huge scans are skipped.
    const readable = /png|jpeg|bmp|gif|webp|tiff/.test(info.mime) && info.width >= 40 && info.height >= 16 && info.width * info.height <= 40_000_000
    if (!ocr || !readable) return sized
    try {
      const { texts } = await ocr([bytes], limits.ocrMs)
      const text = (texts[0] ?? '').trim()
      if (text.replace(/\W/g, '').length < 3) return sized
      const chunks = chunkSections([{ label: t('main:files.extract.ocrText'), text }], limits.chunkChars, mergeLabelFor(cx), t)
      return { ...sized, message: t('main:files.extract.imageOcr'), chunks, chars: text.length, suspicious: findSuspicious(text) }
    } catch {
      return sized
    }
  }
  if (kind === 'other') {
    return {
      ...base,
      status: 'unsupported',
      message: IMAGE_MIME[ext] ? t('main:files.extract.imageMismatch') : t('main:files.extract.unsupported', { ext: ext || '?' })
    }
  }
  let r: Partial_
  try {
    if (kind === 'pdf') r = await readPdf(bytes, limits, cx, ocr)
    else if (kind === 'docx') r = readDocx(bytes, limits, cx)
    else if (kind === 'xlsx') r = readXlsx(bytes, limits, cx)
    else if (kind === 'pptx') r = readPptx(bytes, limits, cx)
    else if (kind === 'doc' || kind === 'xls' || kind === 'ppt') r = await readLegacy(kind, bytes, limits, cx)
    else if (kind === 'rtf') {
      const text = rtfToText(new TextDecoder('latin1').decode(bytes))
      r = { sections: [{ label: t('main:files.extract.text'), text: text.slice(0, limits.maxChars) }], warnings: text.length > limits.maxChars ? [t('main:files.extract.truncated', { max: limits.maxChars.toLocaleString(cx.locale) })] : [] }
    } else {
      const { text: raw, encoding } = decodeText(bytes)
      const text = raw.length > limits.maxChars ? raw.slice(0, limits.maxChars) : raw
      r =
        kind === 'csv'
          ? readCsv(text, ext, limits, cx)
          : kind === 'json'
            ? readJson(text, ext, cx)
            : kind === 'markdown'
              ? readMarkdown(text, cx)
              : { sections: [{ label: t('main:files.extract.text'), text }], warnings: [] }
      r.encoding = encoding
      if (raw.length > limits.maxChars) r.warnings.push(t('main:files.extract.truncated', { max: limits.maxChars.toLocaleString(cx.locale) }))
      if (encoding !== 'UTF-8') r.warnings.unshift(t('main:files.extract.encoding', { encoding }))
    }
  } catch (e) {
    return { ...base, status: 'failed', message: String((e as Error)?.message ?? e).slice(0, 300) }
  }
  const chunks = chunkSections(r.sections, limits.chunkChars, mergeLabelFor(cx), t)
  const chars = chunks.reduce((n, c) => n + c.text.length, 0)
  const suspicious = findSuspicious(chunks.map((c) => c.text).join('\n'))
  return {
    ...base,
    status: r.status ?? (chars ? 'ready' : 'partial'),
    message: r.message ?? (chars ? null : t('main:files.extract.noText')),
    chunks,
    chars,
    pages: r.pages ?? null,
    sheets: r.sheets ?? null,
    encoding: r.encoding ?? null,
    warnings: r.warnings,
    suspicious
  }
}
