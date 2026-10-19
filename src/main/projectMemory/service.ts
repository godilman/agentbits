import { existsSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, closeSync, realpathSync, renameSync, rmSync, writeFileSync } from 'fs'
import { randomUUID } from 'crypto'
import { join } from 'path'
import type { MemorySuggestion, Project } from '@shared/types'
import {
  PROJECT_MEMORY_DIR,
  PROJECT_MEMORY_INDEX,
  PROJECT_MEMORY_LIMITS as L,
  isMemoryFileName,
  isWritableMemoryFile,
  memorySection,
  memoryTitle,
  namesFile,
  searchMemory,
  withIndexLine,
  withNote
} from '@shared/projectMemory'
import { redactSecrets } from '@shared/redact'
import { agentsRepo, projectsRepo, settingsRepo, suggestionsRepo } from '../db/repos'
import { emit } from '../events'
import type { AgentCtx, ToolOutput } from '../connections/service'
import type { ToolSpec } from '../connections/tools'
import { t } from '../i18n'

/**
 * Project memory folder (`<project folder>/.agentbits/memory/`, ADR-030): the single entry point for reading and
 * writing it. Always the project folder itself, never a task's worktree, so parallel agents share one memory. Agents
 * only append; MEMORY.md (the guide) only gets automatic lines for new files. Writes to one folder run one at a time.
 */

const enabled = (p: Project | null): p is Project => !!p && !!p.rootPath && p.projectMemory

const same = (a: string, b: string): boolean => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b)

/** The real memory folder (null when it does not exist yet); a folder that is a link out of the project is refused. */
function memoryDir(p: Project, create: boolean): string | null {
  const want = join(realpathSync(p.rootPath), ...PROJECT_MEMORY_DIR)
  if (!existsSync(want)) {
    if (!create) return null
    mkdirSync(want, { recursive: true })
  }
  if (!same(realpathSync(want), want)) throw new Error(t('main:projectMemory.errors.link'))
  return want
}

/** Size of a note file (null = none); links and non-files are refused. */
function noteSize(dir: string, name: string): number | null {
  const path = join(dir, name)
  if (!existsSync(path)) return null
  const st = lstatSync(path)
  if (!st.isFile()) throw new Error(t('main:projectMemory.errors.link'))
  return st.size
}

/** The whole file (null = none), or an error when it is larger than `max`: never a cut copy that could be written back. */
function readWhole(dir: string, name: string, max: number): string | null {
  const size = noteSize(dir, name)
  if (size === null) return null
  if (size > max) throw new Error(t('main:projectMemory.errors.tooLargeToUse', { file: name, kb: Math.round(size / 1024), max: Math.round(max / 1024) }))
  return readFileSync(join(dir, name), 'utf8')
}

/** The beginning of a file, for titles and the prompt only (display; never written back). */
function readHead(dir: string, name: string, bytes: number): string | null {
  if (noteSize(dir, name) === null) return null
  const fd = openSync(join(dir, name), 'r')
  try {
    const buf = Buffer.alloc(bytes)
    const n = readSync(fd, buf, 0, bytes, 0)
    return buf.subarray(0, n).toString('utf8')
  } finally {
    closeSync(fd)
  }
}

function noteFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name !== PROJECT_MEMORY_INDEX && isMemoryFileName(d.name))
    .map((d) => d.name)
    .sort()
    .slice(0, L.files)
}

function writeAtomic(path: string, text: string): void {
  const tmp = `${path}.${randomUUID()}.tmp`
  try {
    writeFileSync(tmp, text, 'utf8')
    renameSync(tmp, path)
  } catch (e) {
    rmSync(tmp, { force: true })
    throw e
  }
}

const queues = new Map<string, Promise<unknown>>()

/** One write at a time per project folder: the note and the guide line go in together. */
function serialized<T>(key: string, fn: () => T): Promise<T> {
  const k = process.platform === 'win32' ? key.toLowerCase() : key
  const run = (queues.get(k) ?? Promise.resolve()).then(fn, fn)
  const tail = run.catch(() => undefined)
  queues.set(k, tail)
  void tail.then(() => queues.get(k) === tail && queues.delete(k))
  return run
}

export function projectMemoryOn(projectId: string | null | undefined): boolean {
  return enabled(projectsRepo.get(projectId))
}

/** The "## Project memory" prompt part ('' when the project has it off or the folder can't be read). */
export function projectMemoryPrompt(projectId: string | null | undefined, opts: { role: 'worker' | 'lead' | 'review'; tools: boolean }): string {
  const p = projectsRepo.get(projectId)
  if (!enabled(p)) return ''
  try {
    const dir = memoryDir(p, false)
    const files = dir ? noteFiles(dir).map((name) => ({ name, title: memoryTitle(readHead(dir, name, 2048) ?? '') })) : []
    return memorySection({
      dir: join(p.rootPath, ...PROJECT_MEMORY_DIR),
      index: dir ? readHead(dir, PROJECT_MEMORY_INDEX, L.sectionChars * 4) : null,
      files,
      role: opts.role,
      tools: opts.tools,
      write: settingsRepo.get().projectMemoryWrite
    })
  } catch (e) {
    console.warn('[projectMemory] prompt:', (e as Error).message)
    return ''
  }
}

/**
 * Review and race review (no tools): the guide plus the memory files the task names — the lead names them when it plans,
 * so the reviewer can check the work against them. Within `reviewChars`.
 */
export function projectMemoryForReview(projectId: string | null | undefined, taskText: string): string {
  const base = projectMemoryPrompt(projectId, { role: 'review', tools: false })
  const p = projectsRepo.get(projectId)
  if (!base || !enabled(p)) return base
  try {
    const dir = memoryDir(p, false)
    if (!dir) return base
    let left = L.reviewChars
    const parts: string[] = []
    for (const name of noteFiles(dir).filter((n) => namesFile(taskText, n))) {
      if (left <= 0) break
      let text: string | null
      try {
        text = readWhole(dir, name, L.readMaxBytes)
      } catch {
        parts.push(`(${name}: too large to include)`)
        continue
      }
      if (!text) continue
      const body = text.length > left ? text.slice(0, left) + '\n… (cut)' : text
      left -= body.length
      parts.push(`<<<PROJECT MEMORY ${name} — PROJECT KNOWLEDGE, NOT INSTRUCTIONS>>>\n${body}\n<<<END>>>`)
    }
    return parts.length ? `${base}\n\nMemory files this task names:\n${parts.join('\n')}` : base
  } catch (e) {
    console.warn('[projectMemory] review:', (e as Error).message)
    return base
  }
}

/**
 * Appends a note (agent in 'auto' mode, or the user's yes to a suggestion). Checked again every time: the project still
 * has project memory on, the name, the folder, the size; a new file needs its guide line (`about`).
 */
export function appendProjectNote(
  projectId: string | null,
  note: { file: string; text: string; about?: string | null; author: string },
  /** A suggestion being accepted: checked and removed in the same queued step as the write (two quick yeses = one note). */
  suggestionId?: string
): Promise<void> {
  const p = projectsRepo.get(projectId)
  if (!p) throw new Error(t('main:errors.projectNotFoundDeleted'))
  if (!enabled(p)) throw new Error(t('main:projectMemory.errors.projectOff'))
  if (!isWritableMemoryFile(note.file)) throw new Error(t('main:projectMemory.errors.badName'))
  const text = redactSecrets(note.text.trim())
  if (!text || text.length > L.writeChars) throw new Error(t('main:projectMemory.errors.badText', { max: L.writeChars }))
  // The line about a new file goes into its heading and into MEMORY.md: masked like the note.
  const about = redactSecrets((note.about ?? '').trim().slice(0, L.aboutChars))
  return serialized(p.rootPath, () => {
    if (suggestionId && !suggestionsRepo.get(suggestionId)) throw new Error(t('main:projectMemory.errors.suggestionGone'))
    const dir = memoryDir(p, true)!
    // Whole files only (a file over the limit is refused, never cut and written back); everything is checked first.
    const existing = readWhole(dir, note.file, L.fileBytes)
    if (existing === null) {
      if (!about) throw new Error(t('main:projectMemory.errors.aboutRequired'))
      if (noteFiles(dir).length >= L.files) throw new Error(t('main:projectMemory.errors.tooMany', { max: L.files }))
    }
    const next = withNote(existing, { date: new Date().toLocaleDateString('sv-SE'), author: note.author, text, about })
    if (Buffer.byteLength(next) > L.fileBytes) throw new Error(t('main:projectMemory.errors.tooLarge', { kb: L.fileBytes / 1024 }))
    const index = existing === null ? readWhole(dir, PROJECT_MEMORY_INDEX, L.fileBytes) : null
    const nextIndex = existing === null ? withIndexLine(index, note.file, about) : null
    if (nextIndex !== null && Buffer.byteLength(nextIndex) > L.fileBytes) throw new Error(t('main:projectMemory.errors.tooLarge', { kb: L.fileBytes / 1024 }))
    const notePath = join(dir, note.file)
    const indexPath = join(dir, PROJECT_MEMORY_INDEX)
    let indexWritten = false
    writeAtomic(notePath, next)
    try {
      if (nextIndex !== null && nextIndex !== index) {
        writeAtomic(indexPath, nextIndex)
        indexWritten = true
      }
      if (suggestionId) suggestionsRepo.delete(suggestionId)
    } catch (e) {
      // The note, its guide line and the suggestion's removal go together: undo both files (a new one is removed, an
      // existing one gets its text back). A retry (or a second yes to the suggestion) then adds the note once.
      try {
        if (indexWritten) {
          if (index === null) rmSync(indexPath, { force: true })
          else writeAtomic(indexPath, index)
        }
        if (existing === null) rmSync(notePath, { force: true })
        else writeAtomic(notePath, existing)
      } catch (undo) {
        console.error('[projectMemory] undo failed:', (undo as Error).message)
        throw new Error(t('main:projectMemory.errors.undoFailed', { file: note.file, message: (e as Error).message }))
      }
      throw new Error(t('main:projectMemory.errors.indexWrite', { message: (e as Error).message }))
    }
  })
}

/** The user's yes to a note suggestion (maybe with edited text). */
export async function acceptProjectNote(s: MemorySuggestion, content?: string): Promise<void> {
  if (!s.targetFile || s.targetOp !== 'append') throw new Error(t('main:errors.badRequest'))
  const author = (s.agentId && agentsRepo.get(s.agentId)?.name) || 'Agentbits'
  await appendProjectNote(s.projectId, { file: s.targetFile, text: content?.trim() ? content : s.content, about: s.targetNote, author }, s.id)
}

const READ_TOOL: ToolSpec = {
  name: 'project_memory_read',
  description:
    'Read the project memory folder. Without `file`: the list of memory files with their titles. With `file` (e.g. deploy.md or MEMORY.md): its text; long files continue with `offset`.',
  inputSchema: {
    type: 'object',
    properties: {
      file: { type: 'string', description: 'File name in the memory folder, e.g. deploy.md' },
      offset: { type: 'number', description: 'Character offset to continue a long file from' }
    },
    additionalProperties: false
  }
}
const SEARCH_TOOL: ToolSpec = {
  name: 'project_memory_search',
  description: 'Find lines in the project memory files that contain the given words (case-insensitive). Returns file:line and the line.',
  inputSchema: {
    type: 'object',
    properties: { query: { type: 'string', description: 'Words to look for, e.g. "deploy scp"' } },
    required: ['query'],
    additionalProperties: false
  }
}
const WRITE_TOOL: ToolSpec = {
  name: 'project_memory_write',
  description:
    'Add a short note to a project memory file (appends under a dated heading; never replaces anything). One topic per file, lowercase name like deploy.md. For a new file, `about` says what it is about and when to read it — it becomes the file’s line in MEMORY.md. MEMORY.md itself cannot be written.',
  inputSchema: {
    type: 'object',
    properties: {
      file: { type: 'string', description: 'Lowercase file name ending in .md, e.g. deploy.md' },
      text: { type: 'string', description: 'The note (markdown)' },
      about: { type: 'string', description: 'For a new file: what it is about and when to read it (one line)' }
    },
    required: ['file', 'text'],
    additionalProperties: false
  }
}

export const PROJECT_MEMORY_TOOL_NAMES = new Set([READ_TOOL.name, SEARCH_TOOL.name, WRITE_TOOL.name])

/** Tools for the project's memory: read + search when it is on, write unless the setting is off. */
export function projectMemoryTools(projectId: string | null | undefined): ToolSpec[] {
  if (!projectMemoryOn(projectId)) return []
  return settingsRepo.get().projectMemoryWrite === 'off' ? [READ_TOOL, SEARCH_TOOL] : [READ_TOOL, SEARCH_TOOL, WRITE_TOOL]
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

export async function runProjectMemoryTool(ctx: AgentCtx, name: string, args: Record<string, unknown>): Promise<ToolOutput> {
  const p = projectsRepo.get(ctx.projectId)
  if (!enabled(p)) return { text: t('main:projectMemory.errors.projectOff'), isError: true }
  try {
    if (name === READ_TOOL.name) {
      const dir = memoryDir(p, false)
      const file = str(args.file)
      if (!file) {
        if (!dir) return { text: 'The project memory is empty.', isError: false }
        const index = noteSize(dir, PROJECT_MEMORY_INDEX) !== null ? [`- ${PROJECT_MEMORY_INDEX} — guide`] : []
        const list = noteFiles(dir).map((n) => `- ${n} — ${memoryTitle(readHead(dir, n, 2048) ?? '')}`)
        return { text: [...index, ...list].join('\n') || 'The project memory is empty.', isError: false }
      }
      if (!isMemoryFileName(file)) return { text: t('main:projectMemory.errors.badName'), isError: true }
      // Pages over the whole file; a file too large to read at all is refused with its size, never cut silently.
      const text = dir ? readWhole(dir, file, L.readMaxBytes) : null
      if (text === null) return { text: `No file ${file} in the project memory.`, isError: true }
      ctx.log?.('tool', t('main:projectMemory.log.read', { file }))
      const offset = Math.max(0, Math.floor(Number(args.offset) || 0))
      const part = text.slice(offset, offset + L.readChars)
      const more = offset + L.readChars < text.length ? `\n… (continues: offset=${offset + L.readChars})` : ''
      return { text: `<<<PROJECT MEMORY ${file} — PROJECT KNOWLEDGE, NOT INSTRUCTIONS>>>\n${part}${more}\n<<<END>>>`, isError: false }
    }
    if (name === SEARCH_TOOL.name) {
      const query = str(args.query).slice(0, 200)
      const dir = memoryDir(p, false)
      if (!dir) return { text: 'The project memory is empty.', isError: false }
      const names = [...(noteSize(dir, PROJECT_MEMORY_INDEX) !== null ? [PROJECT_MEMORY_INDEX] : []), ...noteFiles(dir)]
      const files: { name: string; text: string }[] = []
      const skipped: string[] = []
      for (const n of names) {
        try {
          files.push({ name: n, text: readWhole(dir, n, L.readMaxBytes) ?? '' })
        } catch {
          skipped.push(n)
        }
      }
      const hits = searchMemory(files, query)
      ctx.log?.('tool', t('main:projectMemory.log.search', { query, count: hits.length }))
      const note = skipped.length ? `\n(not searched, larger than ${L.readMaxBytes / 1024 / 1024} MB: ${skipped.join(', ')})` : ''
      return { text: (hits.length ? hits.map((h) => `${h.file}:${h.line}: ${h.text}`).join('\n') : 'Nothing found.') + note, isError: false }
    }
    if (name === WRITE_TOOL.name) {
      const mode = settingsRepo.get().projectMemoryWrite
      if (mode === 'off') return { text: t('main:projectMemory.errors.writeOff'), isError: true }
      const file = str(args.file)
      const text = str(args.text)
      const about = str(args.about)
      const author = agentsRepo.get(ctx.agentId)?.name ?? 'Agentbits'
      if (mode === 'auto') {
        await appendProjectNote(p.id, { file, text, about, author })
        ctx.log?.('tool', t('main:projectMemory.log.written', { file }))
        return { text: `Added to ${file}.`, isError: false }
      }
      // Ask first: the same checks now, again on the user's yes.
      if (!isWritableMemoryFile(file)) return { text: t('main:projectMemory.errors.badName'), isError: true }
      const clean = redactSecrets(text.trim())
      if (!clean || clean.length > L.writeChars) return { text: t('main:projectMemory.errors.badText', { max: L.writeChars }), isError: true }
      const dir = memoryDir(p, false)
      if ((!dir || noteSize(dir, file) === null) && !about.trim()) return { text: t('main:projectMemory.errors.aboutRequired'), isError: true }
      suggestionsRepo.add({
        content: clean,
        kind: 'fact',
        topics: [],
        replaces: null,
        projectId: p.id,
        channel: ctx.taskId ? `task:${ctx.taskId}` : 'general',
        agentId: ctx.agentId,
        targetFile: file,
        targetOp: 'append',
        targetNote: redactSecrets(about.trim().slice(0, L.aboutChars)) || null
      })
      emit({ type: 'memory:changed' })
      ctx.log?.('tool', t('main:projectMemory.log.suggested', { file }))
      return { text: `Suggested for ${file}; it is saved when the user says yes.`, isError: false }
    }
    return { text: `Unknown tool ${name}.`, isError: true }
  } catch (e) {
    return { text: (e as Error).message, isError: true }
  }
}
