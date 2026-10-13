import { createHash } from 'crypto'
import { copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync, realpathSync } from 'fs'
import { dirname, isAbsolute, join, relative, resolve } from 'path'
import Database from 'better-sqlite3'
import { getDb, getDbPath } from '../db'

/**
 * Original attachment bytes, content-addressed under <data>/files/<sha[0:2]>/<sha>.
 * Identical files are stored once. A blob is removed only when neither the live
 * database nor any backup refers to it, so restoring a backup brings files back.
 */

export const filesDir = (): string => join(dirname(getDbPath()), 'files')
export const blobPath = (sha: string): string => join(filesDir(), sha.slice(0, 2), sha)

export function sha256File(path: string): Promise<string> {
  return new Promise((res, rej) => {
    const h = createHash('sha256')
    createReadStream(path)
      .on('data', (d) => h.update(d))
      .on('error', rej)
      .on('end', () => res(h.digest('hex')))
  })
}

/** Copies a file into the store; returns its hash. */
export async function storeFile(src: string): Promise<string> {
  const sha = await sha256File(src)
  const dst = blobPath(sha)
  if (!existsSync(dst)) {
    mkdirSync(dirname(dst), { recursive: true })
    const tmp = `${dst}.${process.pid}.tmp`
    copyFileSync(src, tmp)
    renameSync(tmp, dst)
  }
  return sha
}

export function storeBytes(bytes: Uint8Array): string {
  const sha = createHash('sha256').update(bytes).digest('hex')
  const dst = blobPath(sha)
  if (!existsSync(dst)) {
    mkdirSync(dirname(dst), { recursive: true })
    const tmp = `${dst}.${process.pid}.tmp`
    writeFileSync(tmp, bytes)
    renameSync(tmp, dst)
  }
  return sha
}

/**
 * `rel` resolved inside `root`, or null if it escapes it — also through a symlink / junction: when the file exists,
 * its real location must still be inside the real root.
 */
export function insideRoot(root: string, rel: string): string | null {
  if (!root || !rel) return null
  const abs = resolve(root, rel)
  const inside = (base: string, p: string): boolean => {
    const r = relative(base, p)
    return !!r && !r.startsWith('..') && !isAbsolute(r)
  }
  if (!inside(resolve(root), abs)) return null
  try {
    if (!inside(realpathSync.native(root), realpathSync.native(abs))) return null
  } catch {
    /* missing file: the caller reports it */
  }
  return abs
}

/** Total size and count of stored originals. */
export function storageUsage(): { bytes: number; count: number } {
  const dir = filesDir()
  if (!existsSync(dir)) return { bytes: 0, count: 0 }
  let bytes = 0
  let count = 0
  for (const sub of readdirSync(dir)) {
    const p = join(dir, sub)
    if (!statSync(p).isDirectory()) continue
    for (const f of readdirSync(p)) {
      if (f.endsWith('.tmp')) continue
      bytes += statSync(join(p, f)).size
      count++
    }
  }
  return { bytes, count }
}

/**
 * Deletes blobs nothing refers to any more (live DB and every backup in
 * <data>/backups). Backups are opened read-only; one that cannot be read keeps
 * everything (better to keep a file too long than to break a restore).
 */
export function gcBlobs(): { removed: number; bytes: number } {
  const dir = filesDir()
  if (!existsSync(dir)) return { removed: 0, bytes: 0 }
  const keep = new Set<string>((getDb().prepare("SELECT DISTINCT sha256 FROM files WHERE origin <> 'workspace'").all() as { sha256: string }[]).map((r) => r.sha256))
  const backups = join(dirname(getDbPath()), 'backups')
  // Backups keep their originals; so does a backup being restored right now (staged next to the live database).
  const refs: string[] = []
  if (existsSync(backups)) refs.push(...readdirSync(backups).filter((x) => x.endsWith('.db')).map((f) => join(backups, f)))
  if (existsSync(getDbPath() + '.restore')) refs.push(getDbPath() + '.restore')
  {
    for (const f of refs) {
      let bdb: Database.Database | null = null
      try {
        bdb = new Database(f, { readonly: true, fileMustExist: true })
        const has = bdb.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'files'").get()
        if (has) for (const r of bdb.prepare('SELECT DISTINCT sha256 FROM files').all() as { sha256: string }[]) keep.add(r.sha256)
      } catch {
        return { removed: 0, bytes: 0 }
      } finally {
        bdb?.close()
      }
    }
  }
  let removed = 0
  let bytes = 0
  for (const sub of readdirSync(dir)) {
    const p = join(dir, sub)
    if (!statSync(p).isDirectory()) continue
    for (const f of readdirSync(p)) {
      const full = join(p, f)
      const stale = f.endsWith('.tmp') ? Date.now() - statSync(full).mtimeMs > 3_600_000 : !keep.has(f)
      if (!stale) continue
      try {
        bytes += statSync(full).size
        unlinkSync(full)
        removed++
      } catch {
        /* in use / already gone */
      }
    }
  }
  return { removed, bytes }
}
