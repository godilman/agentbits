import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import type { FileChunkView, FileKind, FileLinkRole, FileOrigin, FileRecord, FileSearchHit, FileStatus, FileTargetType } from '@shared/types'
import { getDb } from '../db'
import { projectsRepo } from '../db/repos'
import { blobPath, insideRoot } from './storage'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>
const now = (): string => new Date().toISOString()
const json = <T,>(v: unknown, fallback: T): T => {
  try {
    return v ? (JSON.parse(String(v)) as T) : fallback
  } catch {
    return fallback
  }
}

/** Absolute path of a file's original bytes (blob, or the live workspace file). */
export function originalPath(f: Pick<FileRecord, 'origin' | 'sha256' | 'relPath' | 'projectId'>): string | null {
  if (f.origin === 'workspace') {
    const root = projectsRepo.get(f.projectId)?.rootPath
    return root && f.relPath ? insideRoot(root, f.relPath) : null
  }
  return f.sha256 ? blobPath(f.sha256) : null
}

const mapFile = (r: Row): FileRecord => {
  const f: FileRecord = {
    id: r.id,
    projectId: r.project_id ?? null,
    name: r.name,
    ext: r.ext,
    mime: r.mime,
    kind: r.kind as FileKind,
    size: r.size,
    sha256: r.sha256,
    origin: r.origin as FileOrigin,
    createdByType: r.created_by_type,
    createdById: r.created_by_id ?? null,
    relPath: r.rel_path ?? null,
    status: r.status as FileStatus,
    statusMessage: r.status_message ?? null,
    warnings: json<string[]>(r.warnings, []),
    suspicious: json<string[]>(r.suspicious, []),
    pages: r.pages ?? null,
    sheets: r.sheets ? json<string[]>(r.sheets, []) : null,
    width: r.width ?? null,
    height: r.height ?? null,
    encoding: r.encoding ?? null,
    chars: r.chars,
    chunkCount: r.chunk_count,
    projectShared: !!r.project_shared,
    hasOriginal: false,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
  const p = originalPath(f)
  f.hasOriginal = !!p && existsSync(p)
  return f
}

export interface NewFile {
  projectId: string | null
  name: string
  ext: string
  mime: string
  kind: FileKind
  size: number
  sha256: string
  origin: FileOrigin
  createdByType: 'user' | 'agent'
  createdById: string | null
  relPath?: string | null
  status?: FileStatus
}

export type FilePatch = Partial<{
  name: string
  mime: string
  kind: FileKind
  size: number
  sha256: string
  status: FileStatus
  statusMessage: string | null
  warnings: string[]
  suspicious: string[]
  pages: number | null
  sheets: string[] | null
  width: number | null
  height: number | null
  encoding: string | null
  chars: number
  chunkCount: number
  projectShared: boolean
}>

const COLS: Record<keyof FilePatch, string> = {
  name: 'name',
  mime: 'mime',
  kind: 'kind',
  size: 'size',
  sha256: 'sha256',
  status: 'status',
  statusMessage: 'status_message',
  warnings: 'warnings',
  suspicious: 'suspicious',
  pages: 'pages',
  sheets: 'sheets',
  width: 'width',
  height: 'height',
  encoding: 'encoding',
  chars: 'chars',
  chunkCount: 'chunk_count',
  projectShared: 'project_shared'
}

/** FTS5 query from free text: every word must match (prefix), quotes neutralised. */
function ftsQuery(q: string): string | null {
  const words = q
    .normalize('NFC')
    .split(/[^\p{L}\p{N}_-]+/u)
    .filter((w) => w.length >= 2)
    .slice(0, 8)
  return words.length ? words.map((w) => `"${w.replace(/"/g, '')}"*`).join(' ') : null
}

export const filesRepo = {
  create(input: NewFile): FileRecord {
    const id = randomUUID()
    getDb()
      .prepare(
        `INSERT INTO files (id, project_id, name, ext, mime, kind, size, sha256, origin, created_by_type, created_by_id, rel_path, status, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        id,
        input.projectId,
        input.name,
        input.ext,
        input.mime,
        input.kind,
        input.size,
        input.sha256,
        input.origin,
        input.createdByType,
        input.createdById,
        input.relPath ?? null,
        input.status ?? 'processing',
        now(),
        now()
      )
    return this.get(id)!
  },
  get(id: string): FileRecord | null {
    const r = getDb().prepare('SELECT * FROM files WHERE id = ?').get(id) as Row | undefined
    return r ? mapFile(r) : null
  },
  byIds(ids: string[]): FileRecord[] {
    if (!ids.length) return []
    const rows = getDb()
      .prepare(`SELECT * FROM files WHERE id IN (${ids.map(() => '?').join(',')})`)
      .all(...ids) as Row[]
    const byId = new Map(rows.map((r) => [r.id, mapFile(r)]))
    return ids.map((id) => byId.get(id)).filter((f): f is FileRecord => !!f)
  },
  list(opts: { projectId?: string | null; origin?: FileOrigin; ids?: string[]; limit?: number }): FileRecord[] {
    const where: string[] = []
    const vals: unknown[] = []
    if (opts.projectId) (where.push('project_id = ?'), vals.push(opts.projectId))
    if (opts.origin) (where.push('origin = ?'), vals.push(opts.origin))
    if (opts.ids) {
      if (!opts.ids.length) return []
      where.push(`id IN (${opts.ids.map(() => '?').join(',')})`)
      vals.push(...opts.ids)
    }
    const sql = `SELECT * FROM files ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ?`
    return (getDb().prepare(sql).all(...vals, Math.min(2000, opts.limit ?? 500)) as Row[]).map(mapFile)
  },
  findWorkspace(projectId: string, relPath: string): FileRecord | null {
    const r = getDb().prepare("SELECT * FROM files WHERE project_id = ? AND rel_path = ? AND origin = 'workspace'").get(projectId, relPath) as Row | undefined
    return r ? mapFile(r) : null
  },
  update(id: string, patch: FilePatch): void {
    const sets: string[] = []
    const vals: unknown[] = []
    for (const [k, v] of Object.entries(patch) as [keyof FilePatch, unknown][]) {
      if (v === undefined) continue
      sets.push(`${COLS[k]} = ?`)
      vals.push(Array.isArray(v) ? JSON.stringify(v) : typeof v === 'boolean' ? (v ? 1 : 0) : v)
    }
    if (!sets.length) return
    sets.push('updated_at = ?')
    vals.push(now())
    getDb().prepare(`UPDATE files SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id)
  },
  delete(id: string): void {
    getDb().prepare('DELETE FROM files WHERE id = ?').run(id)
  },

  /* chunks */
  setChunks(fileId: string, chunks: { label: string; text: string }[]): void {
    const db = getDb()
    db.transaction(() => {
      db.prepare('DELETE FROM file_chunks WHERE file_id = ?').run(fileId)
      const ins = db.prepare('INSERT INTO file_chunks (file_id, idx, label, text) VALUES (?,?,?,?)')
      chunks.forEach((c, i) => ins.run(fileId, i, c.label, c.text))
    })()
  },
  chunks(fileId: string, offset = 0, limit = 20): FileChunkView[] {
    return (
      getDb().prepare('SELECT idx, label, text FROM file_chunks WHERE file_id = ? AND idx >= ? ORDER BY idx LIMIT ?').all(fileId, offset, limit) as Row[]
    ).map((r) => ({ idx: r.idx, label: r.label, text: r.text }))
  },
  chunkLabels(fileId: string): { idx: number; label: string; chars: number }[] {
    return (getDb().prepare('SELECT idx, label, length(text) AS chars FROM file_chunks WHERE file_id = ? ORDER BY idx').all(fileId) as Row[]).map((r) => ({
      idx: r.idx,
      label: r.label,
      chars: r.chars
    }))
  },
  search(query: string, fileIds: string[], limit = 12): FileSearchHit[] {
    const q = ftsQuery(query)
    if (!q || !fileIds.length) return []
    const sql = `
      SELECT c.file_id, f.name, c.idx, c.label,
             snippet(file_chunks_fts, 0, '«', '»', '…', 24) AS snip
      FROM file_chunks_fts
      JOIN file_chunks c ON c.id = file_chunks_fts.rowid
      JOIN files f ON f.id = c.file_id
      WHERE file_chunks_fts MATCH ? AND c.file_id IN (${fileIds.map(() => '?').join(',')})
      ORDER BY bm25(file_chunks_fts) LIMIT ?`
    try {
      return (getDb().prepare(sql).all(q, ...fileIds, limit) as Row[]).map((r) => ({
        fileId: r.file_id,
        fileName: r.name,
        chunkIdx: r.idx,
        label: r.label,
        snippet: String(r.snip ?? '').replace(/\s+/g, ' ')
      }))
    } catch {
      return []
    }
  },

  /* links */
  link(fileId: string, targetType: FileTargetType, targetId: string, role: FileLinkRole = 'attached'): void {
    getDb()
      .prepare('INSERT OR IGNORE INTO file_links (file_id, target_type, target_id, role, created_at) VALUES (?,?,?,?,?)')
      .run(fileId, targetType, targetId, role, now())
  },
  unlink(fileId: string, targetType: FileTargetType, targetId: string): void {
    getDb().prepare('DELETE FROM file_links WHERE file_id = ? AND target_type = ? AND target_id = ?').run(fileId, targetType, targetId)
  },
  links(fileId: string): { targetType: FileTargetType; targetId: string; role: FileLinkRole; createdAt: string }[] {
    return (getDb().prepare('SELECT * FROM file_links WHERE file_id = ? ORDER BY created_at').all(fileId) as Row[]).map((r) => ({
      targetType: r.target_type,
      targetId: r.target_id,
      role: r.role,
      createdAt: r.created_at
    }))
  },
  linkedTo(targetType: FileTargetType, targetId: string, roles?: FileLinkRole[]): string[] {
    const rows = getDb()
      .prepare(
        `SELECT file_id, MIN(created_at) AS t FROM file_links WHERE target_type = ? AND target_id = ?
         ${roles ? `AND role IN (${roles.map(() => '?').join(',')})` : ''} GROUP BY file_id ORDER BY t`
      )
      .all(targetType, targetId, ...(roles ?? [])) as Row[]
    return rows.map((r) => r.file_id)
  },
  /** Files linked to many messages at once (chat rendering). */
  forMessages(messageIds: string[]): Map<string, string[]> {
    const out = new Map<string, string[]>()
    if (!messageIds.length) return out
    const rows = getDb()
      .prepare(`SELECT file_id, target_id FROM file_links WHERE target_type = 'message' AND target_id IN (${messageIds.map(() => '?').join(',')}) ORDER BY created_at`)
      .all(...messageIds) as Row[]
    for (const r of rows) out.set(r.target_id, [...(out.get(r.target_id) ?? []), r.file_id])
    return out
  },

  /* access (deny by default) */
  grant(fileId: string, agentId: string, by = 'user'): void {
    getDb().prepare('INSERT OR IGNORE INTO file_access (file_id, agent_id, granted_by, created_at) VALUES (?,?,?,?)').run(fileId, agentId, by, now())
  },
  revoke(fileId: string, agentId: string): void {
    getDb().prepare('DELETE FROM file_access WHERE file_id = ? AND agent_id = ?').run(fileId, agentId)
  },
  accessAgents(fileId: string): string[] {
    return (getDb().prepare('SELECT agent_id FROM file_access WHERE file_id = ? ORDER BY created_at').all(fileId) as Row[]).map((r) => r.agent_id)
  },
  hasGrant(fileId: string, agentId: string): boolean {
    return !!getDb().prepare('SELECT 1 FROM file_access WHERE file_id = ? AND agent_id = ?').get(fileId, agentId)
  },
  /** Files of a project an agent may read through a grant or a project-wide share (task links are added by the service). */
  readableIds(agentId: string, projectId: string): string[] {
    return (
      getDb()
        .prepare(
          `SELECT id FROM files WHERE project_id = ? AND (project_shared = 1 OR id IN (SELECT file_id FROM file_access WHERE agent_id = ?))
           ORDER BY created_at`
        )
        .all(projectId, agentId) as Row[]
    ).map((r) => r.id)
  },
  projectStats(projectId: string): { files: number; bytes: number } {
    const r = getDb().prepare('SELECT COUNT(*) AS c, COALESCE(SUM(size), 0) AS b FROM files WHERE project_id = ?').get(projectId) as Row
    return { files: r.c, bytes: r.b }
  },
  /** Interrupted extractions (app closed mid-way). */
  stuck(): FileRecord[] {
    return (getDb().prepare("SELECT * FROM files WHERE status = 'processing'").all() as Row[]).map(mapFile)
  }
}
