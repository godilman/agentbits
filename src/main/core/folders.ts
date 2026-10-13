import { app } from 'electron'
import { readFileSync, realpathSync, statSync } from 'fs'
import { basename, dirname, join, resolve, sep } from 'path'
import type { FolderInspection, FolderStatus } from '@shared/types'
import { projectsRepo } from '../db/repos'
import { getDbPath } from '../db'
import { t } from '../i18n'

/**
 * Project folder checks. Agents really edit files in a project's folder, so the
 * Agentbits application folder itself must never become one (it happened once).
 */

const isWin = process.platform === 'win32'

export function normalizePath(p: string): string {
  let out = resolve(p.trim())
  while (out.length > 1 && (out.endsWith('/') || out.endsWith('\\')) && !/^[A-Za-z]:\\$/.test(out)) out = out.slice(0, -1)
  return out
}

/** The real location (symlinks / junctions resolved) when the path exists; otherwise the normalised path. */
export function canonicalPath(p: string): string {
  const n = normalizePath(p)
  try {
    return normalizePath(realpathSync.native(n))
  } catch {
    return n
  }
}

const key = (p: string): string => (isWin ? normalizePath(p).toLowerCase() : normalizePath(p))

/** `child` is `parent` or inside it. */
function within(child: string, parent: string): boolean {
  const c = key(child)
  const pa = key(parent)
  return c === pa || c.startsWith(pa.endsWith(sep) ? pa : pa + sep)
}

function looksLikeAgentbitsRepo(dir: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name?: string; productName?: string }
    return pkg.name === 'agentbits' || pkg.productName === 'Agentbits'
  } catch {
    return false
  }
}

/** Folders Agentbits itself lives in: the install / source folder and its data folder. */
function appDirs(): string[] {
  const out: string[] = []
  const roots = [app.getAppPath(), dirname(app.getPath('exe'))]
  if (!app.isPackaged) roots.push(process.cwd())
  for (const r of roots) {
    // app.getAppPath() is an .asar file when packaged; its folder is the install dir.
    const dir = r.endsWith('.asar') ? dirname(r) : r
    if (app.isPackaged || looksLikeAgentbitsRepo(dir)) out.push(dir)
  }
  return out
}

/**
 * The app's own source/install folder, anything inside it, or a folder that contains it (a parent would hand
 * agents the app too). Checked on the real path as well, so a symlink / junction can't hide it.
 */
export function isAppFolder(raw: string): boolean {
  for (const p of new Set([normalizePath(raw), canonicalPath(raw)])) {
    for (const dir of appDirs()) {
      for (const d of new Set([dir, canonicalPath(dir)])) if (within(p, d) || within(d, p)) return true
    }
    if (repoAround(p)) return true
  }
  return false
}

/** Too broad to give agents: a drive / filesystem root, the user's home folder or one of its parents, or a folder holding Agentbits' data. */
export function isTooBroad(raw: string): boolean {
  const data = dirname(getDbPath())
  for (const p of new Set([normalizePath(raw), canonicalPath(raw)])) {
    if (dirname(p) === p) return true
    for (const h of new Set([app.getPath('home'), canonicalPath(app.getPath('home'))])) if (within(h, p)) return true
    for (const d of new Set([data, canonicalPath(data)])) if (within(d, p) || within(p, d)) return true
  }
  return false
}

/** A copy of the repo elsewhere (e.g. a renamed folder) is just as dangerous: the folder or one of 5 parents. */
function repoAround(p: string): boolean {
  let d = normalizePath(p)
  for (let i = 0; i < 6; i++) {
    if (looksLikeAgentbitsRepo(d)) return true
    const up = dirname(d)
    if (up === d) break
    d = up
  }
  return false
}

export function inspectFolder(raw: string): FolderInspection {
  if (!raw || !raw.trim()) throw new Error(t('main:folders.pathEmpty'))
  const path = normalizePath(raw)
  let exists = false
  let isDirectory = false
  try {
    const st = statSync(path)
    exists = true
    isDirectory = st.isDirectory()
  } catch {
    /* missing or not accessible */
  }
  const k = key(path)
  const owner = projectsRepo.list().find((p) => p.rootPath && key(p.rootPath) === k)
  return {
    path,
    exists,
    isDirectory,
    isAppFolder: exists && isAppFolder(path),
    tooBroad: exists && isTooBroad(path),
    projectId: owner?.id ?? null,
    suggestedName: basename(path) || path
  }
}

/** Throws a user-facing (translated) error when `raw` cannot be a project folder. */
export function assertUsableFolder(raw: string, projectId?: string): string {
  const f = inspectFolder(raw)
  if (!f.exists) throw new Error(t('main:folders.notFound', { path: f.path }))
  if (!f.isDirectory) throw new Error(t('main:folders.notAFolder', { path: f.path }))
  if (f.isAppFolder) throw new Error(t('main:folders.appFolder'))
  if (f.tooBroad) throw new Error(t('main:folders.tooBroad'))
  if (f.projectId && f.projectId !== projectId) {
    const other = projectsRepo.get(f.projectId)
    throw new Error(t('main:folders.inUse', { name: other?.name ?? t('main:folders.otherProject') }))
  }
  return f.path
}

/**
 * Right before a CLI agent starts in a project's folder: it must still exist, and (resolved through any link that
 * may have been swapped since it was saved) must not be the app's folder or a folder that is too broad.
 */
export function assertRunFolder(raw: string): string {
  const real = canonicalPath(raw)
  let ok = false
  try {
    ok = statSync(real).isDirectory()
  } catch {
    ok = false
  }
  if (!ok) throw new Error(t('main:folders.notFound', { path: real }))
  if (isAppFolder(raw)) throw new Error(t('main:folders.appFolder'))
  if (isTooBroad(raw)) throw new Error(t('main:folders.tooBroad'))
  return real
}

export function folderStatus(): Record<string, FolderStatus> {
  const out: Record<string, FolderStatus> = {}
  for (const p of projectsRepo.list()) {
    if (!p.rootPath) out[p.id] = 'unset'
    else {
      try {
        out[p.id] = statSync(p.rootPath).isDirectory() ? 'ok' : 'missing'
      } catch {
        out[p.id] = 'missing'
      }
    }
  }
  return out
}

