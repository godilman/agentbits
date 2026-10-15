/**
 * OCR for images and scanned PDF pages (tesseract.js, WebAssembly — no native module). Language data (English +
 * Turkish, LSTM "best_int") ships with the app and is read from a local folder: nothing is downloaded. Runs inside the
 * extraction worker; `extract.ts` gets it as an injected function so it stays pure. `tests/ocr.test.ts`.
 */
import { zlibSync } from 'fflate'

export type OcrFn = (images: Uint8Array[], budgetMs: number) => Promise<{ texts: string[]; timedOut: boolean }>

export const OCR_LANGS = ['eng', 'tur']

/** One Tesseract worker per batch (one file); terminated afterwards so memory goes back. */
export function createOcr(langPath: string): OcrFn {
  return async (images, budgetMs) => {
    const { createWorker, OEM } = await import('tesseract.js')
    const worker = await createWorker(OCR_LANGS, OEM.LSTM_ONLY, { langPath, cacheMethod: 'none', gzip: true })
    const texts: string[] = []
    const until = Date.now() + budgetMs
    let timedOut = false
    try {
      for (const img of images) {
        if (Date.now() > until) {
          timedOut = true
          break
        }
        const { data } = await worker.recognize(Buffer.from(img))
        texts.push(data.text.replace(/[ \t]+\n/g, '\n').trim())
      }
    } finally {
      await worker.terminate()
    }
    return { texts, timedOut }
  }
}

/* ── PNG encoding of decoded PDF images (grayscale is enough for OCR and keeps it small) ── */

const CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(parts: Uint8Array[]): number {
  let c = 0xffffffff
  for (const p of parts) for (let i = 0; i < p.length; i++) c = CRC[(c ^ p[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, data.length)
  const t = new Uint8Array([...type].map((c) => c.charCodeAt(0)))
  out.set(t, 4)
  out.set(data, 8)
  dv.setUint32(8 + data.length, crc32([t, data]))
  return out
}

/** 8-bit grayscale PNG. */
export function encodeGrayPng(width: number, height: number, gray: Uint8Array): Uint8Array {
  const raw = new Uint8Array((width + 1) * height)
  for (let y = 0; y < height; y++) raw.set(gray.subarray(y * width, (y + 1) * width), y * (width + 1) + 1)
  const ihdr = new Uint8Array(13)
  const dv = new DataView(ihdr.buffer)
  dv.setUint32(0, width)
  dv.setUint32(4, height)
  ihdr.set([8, 0, 0, 0, 0], 8) // bit depth 8, grayscale, deflate, no filter, no interlace
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlibSync(raw, { level: 6 })), chunk('IEND', new Uint8Array(0))]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) (out.set(p, o), (o += p.length))
  return out
}

/** A decoded PDF image (unpdf `extractImages`: 1 = gray, 3 = RGB, 4 = RGBA channels) → grayscale pixels; null otherwise. */
export function toGray(img: { width: number; height: number; channels: number; data?: Uint8Array | Uint8ClampedArray }): Uint8Array | null {
  const { width: w, height: h, channels: ch, data } = img
  if (!data || !w || !h || w * h > 40_000_000 || data.length < w * h * ch) return null
  if (ch === 1) return new Uint8Array(data.subarray(0, w * h))
  if (ch !== 3 && ch !== 4) return null
  const out = new Uint8Array(w * h)
  for (let i = 0, j = 0; i < out.length; i++, j += ch) out[i] = (data[j] * 77 + data[j + 1] * 150 + data[j + 2] * 29) >> 8
  return out
}
