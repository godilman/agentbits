import { ts } from './i18n'
import type { FileKind, FileOrigin, FileStatus } from './types'

/** Attachments: limits and labels shared by main (enforcement) and renderer (display). */

export const MAX_FILE_BYTES = 50 * 1024 * 1024
export const MAX_FILES_PER_SEND = 20
/** Text an agent may save with `file_save`. */
export const MAX_SAVE_BYTES = 2 * 1024 * 1024
export const MAX_SAVES_PER_RUN = 20

/** Display name of a file kind; `lng` forces a language (e.g. 'en' for text shown to agents). */
export function kindLabel(kind: FileKind, lng?: string): string {
  switch (kind) {
    case 'pdf':
      return 'PDF'
    case 'docx':
      return 'Word'
    case 'xlsx':
      return 'Excel'
    case 'pptx':
      return 'PowerPoint'
    case 'csv':
      return 'CSV'
    case 'markdown':
      return 'Markdown'
    case 'json':
      return 'JSON'
    default:
      return ts(`main:files.kind.${kind}`, lng ? { lng } : undefined)
  }
}

/** Labels in the current UI language (getters: read at render time). */
export const KIND_LABEL: Record<FileKind, string> = {
  pdf: 'PDF',
  docx: 'Word',
  xlsx: 'Excel',
  pptx: 'PowerPoint',
  csv: 'CSV',
  get text() {
    return kindLabel('text')
  },
  markdown: 'Markdown',
  json: 'JSON',
  get image() {
    return kindLabel('image')
  },
  get other() {
    return kindLabel('other')
  }
}

export const ORIGIN_LABEL: Record<FileOrigin, string> = {
  get user() {
    return ts('main:files.origin.user')
  },
  get agent() {
    return ts('main:files.origin.agent')
  },
  get workspace() {
    return ts('main:files.origin.workspace')
  }
}

export const STATUS_LABEL: Record<FileStatus, string> = {
  get processing() {
    return ts('main:files.status.processing')
  },
  get ready() {
    return ts('main:files.status.ready')
  },
  get partial() {
    return ts('main:files.status.partial')
  },
  get unsupported() {
    return ts('main:files.status.unsupported')
  },
  get failed() {
    return ts('main:files.status.failed')
  }
}

/** Extensions the user may open with the system's default app (never executables or scripts). */
export const SAFE_OPEN_EXT = new Set([
  'pdf', 'docx', 'xlsx', 'xlsm', 'pptx', 'csv', 'tsv', 'txt', 'md', 'json', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'log'
])

/** Extensions an agent may save with `file_save` (text formats only). */
export const SAVE_EXT = new Set(['md', 'txt', 'csv', 'tsv', 'json', 'html', 'xml', 'yaml', 'yml', 'sql', 'log', 'svg', 'ini', 'toml'])

/** Rough token estimate for display and context budgeting (~3.6 characters per token for mixed TR/EN text). */
export const estimateTokens = (chars: number): number => Math.ceil(chars / 3.6)

/** Short, stable reference agents use for a file (first 8 hex chars of its id). */
export const fileRef = (id: string): string => id.replace(/-/g, '').slice(0, 8)

const EXT_KIND: Record<string, FileKind> = {
  pdf: 'pdf',
  docx: 'docx',
  xlsx: 'xlsx',
  xlsm: 'xlsx',
  pptx: 'pptx',
  doc: 'docx',
  dot: 'docx',
  rtf: 'docx',
  xls: 'xlsx',
  xlt: 'xlsx',
  ppt: 'pptx',
  pps: 'pptx',
  pot: 'pptx',
  csv: 'csv',
  tsv: 'csv',
  json: 'json',
  jsonl: 'json',
  md: 'markdown',
  markdown: 'markdown',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  bmp: 'image',
  txt: 'text',
  log: 'text'
}

export const extOfName = (name: string): string => {
  const base = name.split(/[\\/]/).pop() ?? name
  const i = base.lastIndexOf('.')
  return i > 0 ? base.slice(i + 1).toLowerCase() : ''
}

/** First guess from the extension (the extractor checks the bytes and corrects it). */
export const kindFromName = (name: string): FileKind => EXT_KIND[extOfName(name)] ?? 'other'

/** Strips path separators, control characters and reserved names so a name is safe on Windows too. */
export function safeFileName(name: string, fallback = ts('main:files.defaultName')): string {
  const base = (name.split(/[\\/]/).pop() ?? '')
    .replace(/[\u0000-\u001f<>:"|?*]/g, '_')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 120)
  if (!base || /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(base)) return fallback
  return base
}
