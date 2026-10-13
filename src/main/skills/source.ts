import { randomUUID } from 'crypto'
import { lstatSync, readdirSync, readFileSync, statSync } from 'fs'
import { basename, extname, join, relative, sep } from 'path'
import { Unzip, UnzipInflate, type UnzipFile } from 'fflate'
import {
  BINARY_EXT,
  SCRIPT_EXT,
  SKILL_LIMITS,
  SKIP_PATH,
  buildSkillMd,
  parseGithubUrl,
  skillIdentity,
  type Skill,
  type SkillCandidate,
  type SkillPreview,
  type SkillSource,
  type SkillSourceInput
} from '@shared/skills'
import { decodeText, findSuspicious } from '../files/extract'
import { t } from '../i18n'
import { skillsRepo } from './repo'

/**
 * Reading skills from their sources (GitHub, .zip, folder, single .md) into memory, finding the SKILL.md folders
 * in them, and installing the ones the user picked. Nothing from a source is executed; paths are normalised and
 * everything is size-limited (download, archive entries, files per skill).
 */

type Files = Map<string, Uint8Array>

interface Loaded {
  label: string
  base: Omit<SkillSource, 'subpath'>
  files: Files
  /** Folder to look in (GitHub tree URL); '' = everywhere. */
  subpath: string
  /** A single Markdown file (not a SKILL.md folder). */
  markdown?: { name: string; text: string }
  notes: string[]
}

interface Staged {
  base: Omit<SkillSource, 'subpath'>
  createdAt: number
  items: { candidate: SkillCandidate; files: Files }[]
}

const staging = new Map<string, Staged>()
const STAGING_TTL = 30 * 60_000

/** Normalises an archive / folder path; null for anything that could escape the skill folder. */
function cleanPath(p: string): string | null {
  const s = p.replace(/\\/g, '/').replace(/^\.\/+/, '')
  if (!s || s.startsWith('/') || /^[A-Za-z]:/.test(s)) return null
  const parts = s.split('/').filter(Boolean)
  if (parts.some((x) => x === '..' || x === '.')) return null
  return parts.join('/')
}

/** Streaming unzip with per-entry and total limits; oversized entries are skipped (noted), not fatal. */
export function unzipBounded(buf: Uint8Array, want: (path: string) => boolean): { files: Files; skipped: string[] } {
  const files: Files = new Map()
  const skipped: string[] = []
  let total = 0
  let fatal: Error | null = null
  const uz = new Unzip((file: UnzipFile) => {
    const path = cleanPath(file.name)
    if (fatal || !path || file.name.endsWith('/') || SKIP_PATH.test(path) || !want(path)) return
    const parts: Uint8Array[] = []
    let size = 0
    file.ondata = (err, data, final) => {
      if (fatal || size < 0) return
      if (err) {
        fatal = new Error(t('main:skills.errors.badArchive', { message: err.message }))
        return
      }
      size += data.length
      total += data.length
      if (total > SKILL_LIMITS.maxArchiveBytes * 2) {
        fatal = new Error(t('main:skills.errors.tooLarge'))
        file.terminate()
        return
      }
      if (size > SKILL_LIMITS.maxFileBytes) {
        skipped.push(path)
        size = -1
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
        files.set(path, all)
      }
    }
    file.start()
  })
  uz.register(UnzipInflate)
  uz.push(buf, true)
  if (fatal) throw fatal
  return { files, skipped }
}

/** Drops a single top-level folder shared by every entry (GitHub archives: `repo-ref/`). */
function stripCommonRoot(files: Files): Files {
  const firsts = new Set([...files.keys()].map((p) => p.split('/')[0]))
  if (firsts.size !== 1 || [...files.keys()].some((p) => !p.includes('/'))) return files
  const out: Files = new Map()
  for (const [p, b] of files) out.set(p.slice(p.indexOf('/') + 1), b)
  return out
}

async function download(url: string, maxBytes: number): Promise<Uint8Array> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 60_000)
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': 'Agentbits' }, redirect: 'follow' })
    if (res.status === 404) throw new Error(t('main:skills.errors.notFound'))
    if (!res.ok) throw new Error(t('main:skills.errors.download', { status: `${res.status} ${res.statusText}` }))
    const len = Number(res.headers.get('content-length') || 0)
    if (len > maxBytes) throw new Error(t('main:skills.errors.tooLarge'))
    const reader = res.body?.getReader()
    if (!reader) return new Uint8Array(await res.arrayBuffer())
    const chunks: Uint8Array[] = []
    let size = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > maxBytes) {
        ctrl.abort()
        throw new Error(t('main:skills.errors.tooLarge'))
      }
      chunks.push(value)
    }
    const out = new Uint8Array(size)
    let o = 0
    for (const c of chunks) {
      out.set(c, o)
      o += c.length
    }
    return out
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error(t('main:skills.errors.timeout'))
    throw e
  } finally {
    clearTimeout(timer)
  }
}

async function loadGithub(url: string): Promise<Loaded> {
  const g = parseGithubUrl(url)
  if (!g) throw new Error(t('main:skills.errors.badUrl'))
  const ref = g.ref ?? 'HEAD'
  const label = `${g.owner}/${g.repo}${g.path ? '/' + g.path : ''}`
  const base = { type: 'github' as const, location: `https://github.com/${g.owner}/${g.repo}`, ref: g.ref ?? undefined }
  const isFile = /\.md$/i.test(g.path)
  if (isFile && !/(^|\/)skill\.md$/i.test(g.path)) {
    // A single Markdown file (not part of a SKILL.md folder).
    const bytes = await download(`https://raw.githubusercontent.com/${g.owner}/${g.repo}/${ref}/${g.path}`, SKILL_LIMITS.maxFileBytes)
    return { label, base: { ...base, type: 'github' }, files: new Map(), subpath: g.path, markdown: { name: basename(g.path, extname(g.path)), text: decodeText(bytes).text }, notes: [] }
  }
  const subpath = isFile ? g.path.split('/').slice(0, -1).join('/') : g.path
  const zip = await download(`https://github.com/${g.owner}/${g.repo}/archive/${ref}.zip`, SKILL_LIMITS.maxArchiveBytes)
  const { files, skipped } = unzipBounded(zip, () => true)
  return { label, base, files: stripCommonRoot(files), subpath, notes: skipped.length ? [t('main:skills.notes.skippedLarge', { count: skipped.length })] : [] }
}

function loadFolder(dir: string): Loaded {
  const files: Files = new Map()
  const notes: string[] = []
  let total = 0
  let skipped = 0
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const full = join(d, name)
      const rel = relative(dir, full).split(sep).join('/')
      if (SKIP_PATH.test(rel)) continue
      const st = lstatSync(full)
      if (st.isSymbolicLink()) continue // never follow links out of the folder
      if (st.isDirectory()) walk(full)
      else if (st.isFile()) {
        if (files.size >= SKILL_LIMITS.maxFiles * 4) throw new Error(t('main:skills.errors.tooManyFiles'))
        if (st.size > SKILL_LIMITS.maxFileBytes) {
          skipped++
          continue
        }
        total += st.size
        if (total > SKILL_LIMITS.maxArchiveBytes) throw new Error(t('main:skills.errors.tooLarge'))
        files.set(rel, readFileSync(full))
      }
    }
  }
  walk(dir)
  if (skipped) notes.push(t('main:skills.notes.skippedLarge', { count: skipped }))
  return { label: dir, base: { type: 'folder', location: dir }, files, subpath: '', notes }
}

function loadPath(path: string): Loaded {
  let st
  try {
    st = statSync(path)
  } catch {
    throw new Error(t('main:skills.errors.pathMissing', { path }))
  }
  if (st.isDirectory()) return loadFolder(path)
  const ext = extname(path).toLowerCase()
  if (ext === '.zip') {
    if (st.size > SKILL_LIMITS.maxArchiveBytes) throw new Error(t('main:skills.errors.tooLarge'))
    const { files, skipped } = unzipBounded(readFileSync(path), () => true)
    return {
      label: path,
      base: { type: 'zip', location: path },
      files: stripCommonRoot(files),
      subpath: '',
      notes: skipped.length ? [t('main:skills.notes.skippedLarge', { count: skipped.length })] : []
    }
  }
  if (ext === '.md' || ext === '.markdown') {
    if (st.size > SKILL_LIMITS.maxFileBytes) throw new Error(t('main:skills.errors.tooLarge'))
    const text = decodeText(readFileSync(path)).text
    // A SKILL.md picked on its own: take its whole folder.
    if (/^skill\.md$/i.test(basename(path))) return loadFolder(join(path, '..'))
    return { label: path, base: { type: 'markdown', location: path }, files: new Map(), subpath: '', markdown: { name: basename(path, extname(path)), text }, notes: [] }
  }
  throw new Error(t('main:skills.errors.badFile'))
}

/** SKILL.md folders inside the loaded files (case-insensitive name), limited to `subpath`. */
function findSkillDirs(files: Files, subpath: string): string[] {
  const prefix = subpath ? subpath.replace(/\/+$/, '') + '/' : ''
  const dirs = [...files.keys()]
    .filter((p) => (prefix ? p.startsWith(prefix) || p === subpath : true) && /(^|\/)skill\.md$/i.test(p))
    .map((p) => p.split('/').slice(0, -1).join('/'))
  return [...new Set(dirs)].sort()
}

function candidateFrom(dir: string, all: Files, otherDirs: string[], notes: string[]): { candidate: SkillCandidate; files: Files } {
  const prefix = dir ? dir + '/' : ''
  const nested = otherDirs.filter((d) => d !== dir && (dir ? d.startsWith(prefix) : true))
  const files: Files = new Map()
  const own = [...all.entries()]
    .filter(([p]) => p.startsWith(prefix) && !nested.some((d) => p.startsWith(d + '/')))
    .sort(([a], [b]) => a.localeCompare(b))
  const myNotes = [...notes]
  let size = 0
  let dropped = 0
  for (const [p, b] of own) {
    let rel = p.slice(prefix.length)
    if (/^skill\.md$/i.test(rel)) rel = 'SKILL.md'
    if (files.size >= SKILL_LIMITS.maxFiles || size + b.length > SKILL_LIMITS.maxSkillBytes) {
      if (rel !== 'SKILL.md') {
        dropped++
        continue
      }
    }
    files.set(rel, b)
    size += b.length
  }
  if (dropped) myNotes.push(t('main:skills.notes.droppedFiles', { count: dropped }))
  const md = decodeText(files.get('SKILL.md') ?? new Uint8Array()).text
  const fallback = dir.split('/').pop() || 'skill'
  const id = skillIdentity(md, fallback)
  if (!id.hasFrontmatter) myNotes.push(t('main:skills.notes.noFrontmatter'))
  if (!id.description) myNotes.push(t('main:skills.notes.noDescription'))
  const paths = [...files.keys()]
  const mdTexts = paths.filter((p) => /\.md$/i.test(p)).map((p) => decodeText(files.get(p)!).text)
  const existing = skillsRepo.byName(id.name)
  return {
    files,
    candidate: {
      key: dir || '.',
      name: id.name,
      description: id.description,
      subpath: dir,
      fileCount: files.size,
      size,
      hasScripts: paths.some((p) => SCRIPT_EXT.test(p)),
      hasBinaries: paths.some((p) => BINARY_EXT.test(p)),
      suspicious: findSuspicious(mdTexts.join('\n'), 5),
      notes: myNotes,
      existingId: existing?.id ?? null,
      skillMdPreview: md.slice(0, 6000)
    }
  }
}

function markdownCandidate(m: { name: string; text: string }, notes: string[]): { candidate: SkillCandidate; files: Files } {
  const id = skillIdentity(m.text, m.name)
  const md = id.hasFrontmatter ? m.text : buildSkillMd(id.name, id.description, m.text)
  const files: Files = new Map([['SKILL.md', new TextEncoder().encode(md)]])
  const myNotes = [...notes]
  if (!id.hasFrontmatter) myNotes.push(t('main:skills.notes.generatedFrontmatter'))
  const existing = skillsRepo.byName(id.name)
  return {
    files,
    candidate: {
      key: '.',
      name: id.name,
      description: id.description,
      subpath: '',
      fileCount: 1,
      size: files.get('SKILL.md')!.length,
      hasScripts: false,
      hasBinaries: false,
      suspicious: findSuspicious(m.text, 5),
      notes: myNotes,
      existingId: existing?.id ?? null,
      skillMdPreview: md.slice(0, 6000)
    }
  }
}

async function load(input: SkillSourceInput): Promise<Loaded> {
  return input.type === 'github' ? loadGithub(input.url) : loadPath(input.path)
}

function candidatesOf(l: Loaded): { candidate: SkillCandidate; files: Files }[] {
  if (l.markdown) return [markdownCandidate(l.markdown, l.notes)]
  const dirs = findSkillDirs(l.files, l.subpath)
  if (!dirs.length) throw new Error(t('main:skills.errors.noSkillMd'))
  return dirs.map((d) => candidateFrom(d, l.files, dirs, l.notes))
}

/** Reads a source and returns the skills found in it (nothing is installed yet). */
export async function previewSkills(input: SkillSourceInput): Promise<SkillPreview> {
  for (const [id, s] of staging) if (Date.now() - s.createdAt > STAGING_TTL) staging.delete(id)
  const l = await load(input)
  const items = candidatesOf(l)
  const stagingId = randomUUID()
  staging.set(stagingId, { base: l.base, createdAt: Date.now(), items })
  return { stagingId, sourceLabel: l.label, candidates: items.map((i) => i.candidate) }
}

function warningsOf(c: SkillCandidate): string[] {
  const w: string[] = []
  if (c.hasBinaries) w.push(t('main:skills.warnings.binaries'))
  if (c.hasScripts) w.push(t('main:skills.warnings.scripts'))
  if (c.suspicious.length) w.push(t('main:skills.warnings.suspicious', { count: c.suspicious.length }))
  return w
}

/** Installs the picked candidates of a preview; a skill with the same name is updated in place (assignments kept). */
export function installSkills(stagingId: string, keys: string[]): Skill[] {
  const s = staging.get(stagingId)
  if (!s) throw new Error(t('main:skills.errors.previewExpired'))
  const out: Skill[] = []
  for (const it of s.items.filter((i) => keys.includes(i.candidate.key))) {
    const c = it.candidate
    const existing = skillsRepo.byName(c.name)
    out.push(
      skillsRepo.write(
        {
          name: c.name,
          description: c.description,
          source: { ...s.base, subpath: c.subpath },
          hasScripts: c.hasScripts,
          warnings: warningsOf(c),
          files: it.files
        },
        existing?.id
      )
    )
  }
  staging.delete(stagingId)
  return out
}

/** Re-reads an installed skill from where it came from (GitHub / zip / folder / .md) and replaces its files. */
export async function updateSkillFromSource(id: string): Promise<Skill> {
  const skill = skillsRepo.get(id)
  if (!skill) throw new Error(t('main:skills.errors.notInstalled'))
  const src = skill.source
  if (src.type === 'created' || !src.location) throw new Error(t('main:skills.errors.noSource'))
  const input: SkillSourceInput =
    src.type === 'github'
      ? { type: 'github', url: `${src.location}/tree/${src.ref ?? 'HEAD'}/${src.subpath ?? ''}`.replace(/\/+$/, '') }
      : { type: 'path', path: src.location }
  const l = await load(input)
  const items = candidatesOf(l)
  const it = items.find((i) => i.candidate.subpath === (src.subpath ?? '')) ?? items.find((i) => i.candidate.name === skill.name) ?? (items.length === 1 ? items[0] : null)
  if (!it) throw new Error(t('main:skills.errors.goneFromSource'))
  const other = skillsRepo.byName(it.candidate.name)
  if (other && other.id !== id) throw new Error(t('main:skills.errors.nameTaken', { name: it.candidate.name }))
  return skillsRepo.write(
    {
      name: it.candidate.name,
      description: it.candidate.description,
      source: { ...l.base, subpath: it.candidate.subpath, ref: src.ref },
      hasScripts: it.candidate.hasScripts,
      warnings: warningsOf(it.candidate),
      files: it.files
    },
    id
  )
}

/** Creates a skill written in the app, or saves an edited SKILL.md (other files of the skill are kept). */
export function saveSkillMd(content: string, id?: string): Skill {
  const text = content.replace(/\r\n?/g, '\n')
  if (!text.trim()) throw new Error(t('main:skills.errors.empty'))
  if (text.length > SKILL_LIMITS.maxFileBytes) throw new Error(t('main:skills.errors.tooLarge'))
  const existing = id ? skillsRepo.get(id) : null
  if (id && !existing) throw new Error(t('main:skills.errors.notInstalled'))
  const ident = skillIdentity(text, existing?.name ?? 'skill')
  if (!ident.hasFrontmatter) throw new Error(t('main:skills.errors.needFrontmatter'))
  if (!ident.description) throw new Error(t('main:skills.errors.needDescription'))
  const clash = skillsRepo.byName(ident.name)
  if (clash && clash.id !== id) throw new Error(t('main:skills.errors.nameTaken', { name: ident.name }))
  const files = new Map<string, Uint8Array>(existing ? [...skillsRepo.allFiles(existing.id)].map(([p, b]) => [p, new Uint8Array(b)] as [string, Uint8Array]) : [])
  files.set('SKILL.md', new TextEncoder().encode(text))
  const paths = [...files.keys()]
  return skillsRepo.write(
    {
      name: ident.name,
      description: ident.description,
      source: existing?.source ?? { type: 'created' },
      hasScripts: paths.some((p) => SCRIPT_EXT.test(p)),
      warnings: existing?.warnings ?? [],
      files,
      modified: !!existing && existing.source.type !== 'created'
    },
    existing?.id
  )
}
