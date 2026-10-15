import { app, BrowserWindow, shell } from 'electron'
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readdirSync, readSync, renameSync, statSync, unlinkSync } from 'fs'
import { basename, dirname, join } from 'path'
import type { BackupInfo, DataPart, DataUsage, ProjectUsage, ResetMode } from '@shared/types'
import Database from 'better-sqlite3'
import { closeDb, getDb, getDbPath } from '../db'
import { LATEST_SCHEMA } from '../db/schema'
import { projectsRepo, settingsRepo } from '../db/repos'
import { emit } from '../events'
import { terminals } from '../terminal/manager'
import { orchestrator } from './orchestrator'
import { t } from '../i18n'
import { ensureOrgDefaults } from './org'
import { rejectAllApprovals } from '../connections/service'
import { gcBlobs, storageUsage } from '../files/storage'

/**
 * Data management: usage figures, scoped clean-up, log retention, backups and
 * factory reset. Everything runs inside the open database (no file swapping),
 * so it is safe on Windows where the DB file stays locked while the app runs.
 */

const MAX_BACKUPS = 10
const DAY = 86_400_000

const dataDir = (): string => dirname(getDbPath())
const backupsDir = (): string => join(dataDir(), 'backups')
const fileSize = (p: string): number => (existsSync(p) ? statSync(p).size : 0)
const count = (sql: string, ...params: unknown[]): number => (getDb().prepare(sql).get(...params) as { c: number }).c

/** Every change event, so the renderer refetches everything. */
function emitAll(): void {
  for (const type of [
    'agents:changed',
    'permissions:changed',
    'providers:changed',
    'tasks:changed',
    'runs:changed',
    'decisions:changed',
    'reports:changed',
    'memory:changed',
    'settings:changed',
    'units:changed',
    'projects:changed',
    'messages:changed',
    'files:changed'
  ] as const)
    emit({ type })
}

/** Reclaims disk space after large deletes. */
function compact(): void {
  const db = getDb()
  db.pragma('wal_checkpoint(TRUNCATE)')
  db.exec('VACUUM')
}


/* ───────────────────────────── usage ───────────────────────────── */

export function dataUsage(): DataUsage {
  const db = getDb()
  const projects: ProjectUsage[] = projectsRepo.list().map((p) => ({
    projectId: p.id,
    name: p.name,
    color: p.color,
    status: p.status,
    tasks: count('SELECT COUNT(*) AS c FROM tasks WHERE project_id = ?', p.id),
    runs: count('SELECT COUNT(*) AS c FROM runs WHERE project_id = ?', p.id),
    messages: count('SELECT COUNT(*) AS c FROM messages WHERE project_id = ?', p.id),
    logs: count(
      `SELECT COUNT(*) AS c FROM agent_logs WHERE project_id = ? OR task_id IN (SELECT id FROM tasks WHERE project_id = ?)
       OR run_id IN (SELECT id FROM runs WHERE project_id = ?)`,
      p.id,
      p.id,
      p.id
    ),
    memories: count('SELECT COUNT(*) AS c FROM memories WHERE project_id = ?', p.id),
    decisions: count('SELECT COUNT(*) AS c FROM decisions WHERE project_id = ?', p.id),
    reports: count('SELECT COUNT(*) AS c FROM reports WHERE project_id = ?', p.id),
    files: count('SELECT COUNT(*) AS c FROM files WHERE project_id = ?', p.id),
    fileBytes: (db.prepare("SELECT COALESCE(SUM(size), 0) AS b FROM files WHERE project_id = ? AND origin <> 'workspace'").get(p.id) as { b: number }).b
  }))
  const backups = listBackups()
  const store = storageUsage()
  return {
    dataDir: dataDir(),
    dbBytes: fileSize(getDbPath()),
    walBytes: fileSize(getDbPath() + '-wal'),
    backupsBytes: backups.reduce((s, b) => s + b.bytes, 0),
    filesBytes: store.bytes,
    filesCount: store.count,
    orgMemories: count('SELECT COUNT(*) AS c FROM memories WHERE project_id IS NULL'),
    orgDecisionMemories: count("SELECT COUNT(*) AS c FROM memories WHERE project_id IS NULL AND kind = 'decision'"),
    agents: count('SELECT COUNT(*) AS c FROM agents'),
    units: count('SELECT COUNT(*) AS c FROM units'),
    logs: count('SELECT COUNT(*) AS c FROM agent_logs'),
    oldestLogAt: (db.prepare('SELECT MIN(created_at) AS m FROM agent_logs').get() as { m: string | null }).m,
    projects
  }
}

/* ───────────────────────────── clean-up ───────────────────────────── */

export async function clearProject(
  projectId: string,
  parts: DataPart[],
  opts: { keepDecisionMemories?: boolean } = {}
): Promise<{ deleted: number }> {
  if (!projectsRepo.get(projectId)) throw new Error(t('orchestrator:errors.projectNotFound'))
  const want = new Set(parts)
  const db = getDb()
  const taskIds = (db.prepare('SELECT id FROM tasks WHERE project_id = ?').all(projectId) as { id: string }[]).map((r) => r.id)

  // Anything running in this project must stop before its rows disappear.
  if (want.has('tasks') || want.has('logs')) {
    await orchestrator.stopProject(projectId)
  }

  let deleted = 0
  const run = (sql: string, ...params: unknown[]): void => {
    deleted += db.prepare(sql).run(...params).changes
  }
  db.transaction(() => {
    if (want.has('memories')) {
      run(
        `DELETE FROM memories WHERE project_id = ? ${opts.keepDecisionMemories ? "AND kind <> 'decision'" : ''}`,
        projectId
      )
    }
    if (want.has('messages')) run('DELETE FROM messages WHERE project_id = ?', projectId)
    if (want.has('reports')) run('DELETE FROM reports WHERE project_id = ?', projectId)
    if (want.has('decisions')) run('DELETE FROM decisions WHERE project_id = ?', projectId)
    if (want.has('logs') || want.has('tasks')) {
      run(
        `DELETE FROM agent_logs WHERE project_id = ? OR task_id IN (SELECT id FROM tasks WHERE project_id = ?)
         OR run_id IN (SELECT id FROM runs WHERE project_id = ?)`,
        projectId,
        projectId,
        projectId
      )
      run(`DELETE FROM agent_instructions WHERE project_id = ? AND status <> 'queued'`, projectId)
      // Finished runs are history; active ones were stopped above.
      run(
        `DELETE FROM runs WHERE project_id = ? AND status NOT IN ('awaiting_approval','running','paused')`,
        projectId
      )
    }
    if (want.has('tasks')) {
      run(`DELETE FROM messages WHERE project_id = ? AND channel LIKE 'task:%'`, projectId)
      run('DELETE FROM tasks WHERE project_id = ?', projectId) // remaining runs cascade
    }
    // Attachments: rows (chunks, links, access cascade); originals go below unless a backup still needs them.
    if (want.has('files')) run('DELETE FROM files WHERE project_id = ?', projectId)
  })()
  if (want.has('files')) gcQuietly()
  compact()
  emitAll()
  return { deleted }
}

export function clearOrgMemory(opts: { keepDecisions: boolean }): { deleted: number } {
  const deleted = getDb()
    .prepare(`DELETE FROM memories WHERE project_id IS NULL ${opts.keepDecisions ? "AND kind <> 'decision'" : ''}`)
    .run().changes
  compact()
  emit({ type: 'memory:changed' })
  return { deleted }
}

/** Deletes agent logs older than `days` (0 = everything). */
export function pruneLogs(days: number, opts: { compact?: boolean } = {}): { deleted: number } {
  const cutoff = new Date(Date.now() - Math.max(0, days) * DAY).toISOString()
  const deleted = getDb().prepare('DELETE FROM agent_logs WHERE created_at < ?').run(days > 0 ? cutoff : '9999').changes
  if (deleted && opts.compact !== false) compact()
  return { deleted }
}

/** Audit log entries (connection and app calls) older than `days` (security review #21: it had no retention). */
export function pruneAudit(days: number): { deleted: number } {
  if (days <= 0) return { deleted: 0 }
  const cutoff = new Date(Date.now() - days * DAY).toISOString()
  return { deleted: getDb().prepare('DELETE FROM audit_log WHERE at < ?').run(cutoff).changes }
}

let maintenanceTimer: NodeJS.Timeout | null = null

/** Applies the log and audit retention settings now and every 6 hours. */
export function startMaintenance(): void {
  const apply = (): void => {
    const { logRetentionDays, auditRetentionDays } = settingsRepo.get()
    const logs = logRetentionDays > 0 ? pruneLogs(logRetentionDays, { compact: false }).deleted : 0
    const audit = pruneAudit(auditRetentionDays).deleted
    if (logs + audit > 500) compact()
  }
  try {
    apply()
  } catch (e) {
    console.warn('[agentbits] log retention failed', e)
  }
  maintenanceTimer = setInterval(() => {
    try {
      apply()
    } catch (e) {
      console.warn('[agentbits] log retention failed', e)
    }
  }, 6 * 3_600_000)
}

export function stopMaintenance(): void {
  if (maintenanceTimer) clearInterval(maintenanceTimer)
}

/** Removes attachment originals nothing refers to any more (never fails the caller). */
function gcQuietly(): void {
  try {
    gcBlobs()
  } catch (e) {
    console.warn('[agentbits] file clean-up failed', e)
  }
}

/* ───────────────────────────── backups ───────────────────────────── */

export function listBackups(): BackupInfo[] {
  const dir = backupsDir()
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.db'))
    .map((f) => {
      const p = join(dir, f)
      const st = statSync(p)
      return { name: f, path: p, bytes: st.size, createdAt: st.mtime.toISOString() }
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function createBackup(label = t('orchestrator:maintenance.backupLabel.manual')): BackupInfo {
  const dir = backupsDir()
  mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
  const file = join(dir, `agentbits-${label}-${stamp}.db`)
  // VACUUM INTO writes a consistent, compact copy of the live database.
  getDb().exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`)
  const rotated = listBackups().slice(MAX_BACKUPS)
  for (const old of rotated) unlinkSync(old.path)
  if (rotated.length) gcQuietly()
  const st = statSync(file)
  return { name: basename(file), path: file, bytes: st.size, createdAt: st.mtime.toISOString() }
}

export function deleteBackup(name: string): void {
  const p = backupPath(name)
  if (existsSync(p)) unlinkSync(p)
  gcQuietly()
}

function backupPath(name: string): string {
  const safe = basename(name)
  if (!safe.endsWith('.db') || safe !== name) throw new Error(t('orchestrator:maintenance.invalidBackupName'))
  return join(backupsDir(), safe)
}

function isSqliteFile(p: string): boolean {
  const fd = openSync(p, 'r')
  try {
    const head = Buffer.alloc(16)
    readSync(fd, head, 0, 16, 0)
    return head.toString('latin1') === 'SQLite format 3\u0000'
  } finally {
    closeSync(fd)
  }
}

class BackupError extends Error {}

/** A backup must be an intact Agentbits database this version can open (not a newer one). */
function verifyBackup(p: string): void {
  let db: Database.Database | null = null
  try {
    db = new Database(p, { readonly: true, fileMustExist: true })
    const ok = (db.prepare('PRAGMA integrity_check').get() as Record<string, string> | undefined)?.integrity_check
    if (ok !== 'ok') throw new BackupError(t('orchestrator:maintenance.backupDamaged'))
    const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name))
    if (!['schema_migrations', 'settings', 'agents', 'tasks'].every((x) => tables.has(x))) throw new BackupError(t('orchestrator:maintenance.notABackup'))
    const v = (db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number | null }).v ?? 0
    if (v > LATEST_SCHEMA) throw new BackupError(t('orchestrator:maintenance.backupTooNew', { version: v, latest: LATEST_SCHEMA }))
  } catch (e) {
    if (e instanceof BackupError) throw e
    throw new Error(t('orchestrator:maintenance.backupDamaged'))
  } finally {
    db?.close()
  }
}

/**
 * Replaces the live database with a backup and restarts the app. The current
 * state is backed up first, so a restore can itself be undone.
 */
export function restoreBackup(name: string): void {
  const src = backupPath(name)
  if (!existsSync(src)) throw new Error(t('orchestrator:maintenance.backupNotFound'))
  if (!isSqliteFile(src)) throw new Error(t('orchestrator:maintenance.notABackup'))
  const dbPath = getDbPath()
  // Copy first: the safety backup below may rotate the chosen file out. The staged copy also keeps its
  // attachments' originals from being collected (gcBlobs reads it) until the restart.
  const staged = dbPath + '.restore'
  copyFileSync(src, staged)
  try {
    verifyBackup(staged)
  } catch (e) {
    unlinkSync(staged)
    throw e
  }
  createBackup(t('orchestrator:maintenance.backupLabel.beforeRestore'))

  stopMaintenance()
  orchestrator.shutdown()
  terminals.killAll()
  closeDb()
  for (const ext of ['-wal', '-shm']) if (existsSync(dbPath + ext)) unlinkSync(dbPath + ext)
  renameSync(staged, dbPath)
  // Migrations run on the next boot, so older backups are upgraded automatically.
  app.relaunch()
  app.exit(0)
}

export function openDataFolder(): void {
  void shell.openPath(dataDir())
}

/* ───────────────────────────── factory reset ───────────────────────────── */

export async function factoryReset(mode: ResetMode): Promise<{ backup: BackupInfo }> {
  const backup = createBackup(t(mode === 'all' ? 'orchestrator:maintenance.backupLabel.beforeReset' : 'orchestrator:maintenance.backupLabel.beforeCleanup'))
  rejectAllApprovals()
  // Cancels task runs, chat replies and reviews and waits until they have really ended.
  await orchestrator.resetRuntime()

  const db = getDb()
  const wipe = (tables: string[]): void => {
    for (const t of tables) db.prepare(`DELETE FROM ${t}`).run()
  }
  db.transaction(() => {
    wipe(['agent_logs', 'agent_instructions', 'token_usage', 'file_access', 'file_links', 'file_chunks', 'files', 'runs', 'messages', 'memories', 'decisions', 'reports', 'tasks'])
    if (mode === 'work') {
      db.prepare("UPDATE agents SET status = CASE WHEN enabled = 1 THEN 'idle' ELSE 'offline' END, status_note = NULL").run()
    } else {
      wipe(['mcp_permissions', 'mcp_tool_policies', 'mcp_servers', 'skill_assignments', 'skill_files', 'skills', 'connection_permissions', 'connections', 'audit_log', 'project_units', 'projects', 'unit_members', 'units', 'agent_permissions', 'agents', 'providers', 'settings'])
    }
    db.exec("INSERT INTO memories_fts(memories_fts) VALUES ('rebuild')")
    db.exec("INSERT INTO file_chunks_fts(file_chunks_fts) VALUES ('rebuild')")
  })()
  // Originals referenced by the backup taken above stay until that backup is deleted.
  gcQuietly()

  if (mode === 'all') {
    terminals.killAll()
    // Empty organization + one empty project; the user builds the rest (guided by the in-app guide).
    ensureOrgDefaults()
  }
  compact()
  emitAll()
  emit({ type: 'orchestrator:changed' })
  // Renderer state (open tabs, caches) is simplest to rebuild from scratch.
  setTimeout(() => {
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.reloadIgnoringCache()
  }, 600)
  return { backup }
}
