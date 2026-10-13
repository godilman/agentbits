/**
 * Worker-thread entry for text extraction (bundled as out/main/files-worker.js).
 * Runs with a memory cap and a timeout set by the parent; imports nothing from
 * the app (no Electron, no i18next) so a malformed attachment can only take this
 * thread down. Texts (labels, warnings) come from the parent as the
 * `main:files.extract.*` strings of the UI language and are interpolated here.
 */
import { readFileSync } from 'fs'
import { parentPort, workerData } from 'worker_threads'
import { DEFAULT_LIMITS, DEFAULT_TEXT, extractFile, type ExtractT } from './extract'

const { path, name, strings, locale } = workerData as { path: string; name: string; strings?: Record<string, string>; locale?: string }

const PREFIX = 'main:files.extract.'
const t: ExtractT = (key, opts) => {
  const s = strings?.[key.slice(PREFIX.length)]
  if (typeof s !== 'string') return DEFAULT_TEXT.t(key, opts)
  return opts ? s.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) => (k in opts ? String(opts[k]) : m)) : s
}

extractFile(new Uint8Array(readFileSync(path)), name, DEFAULT_LIMITS, { t, locale: locale || DEFAULT_TEXT.locale })
  .then((result) => parentPort?.postMessage({ ok: true, result }))
  .catch((e: unknown) => parentPort?.postMessage({ ok: false, error: e instanceof Error ? e.message : String(e) }))
