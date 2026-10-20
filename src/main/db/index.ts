import Database from 'better-sqlite3'
import { app } from 'electron'
import { basename, dirname, join } from 'path'
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs'
import { LATEST_SCHEMA, migrate, schemaVersion } from './schema'

let db: Database.Database | null = null
let dbPath = ''

/** Automatic backups taken before a schema upgrade; the newest `KEEP_PRE_MIGRATION` are kept, other backups untouched. */
export const PRE_MIGRATION_PREFIX = 'agentbits-pre-migration-'
const KEEP_PRE_MIGRATION = 3

/**
 * The database couldn't be opened safely; nothing was reset. `backup`: the pre-upgrade backup, when one was made.
 * - `tooNew`: written by a newer Agentbits (this build doesn't know its schema); nothing changed.
 * - `backup`: the backup before the upgrade failed, so the upgrade didn't run; nothing changed.
 * - `migrate`: the upgrade failed; all its steps run in one transaction, so the file is still at the version it had.
 */
export class DbStartError extends Error {
  constructor(
    readonly kind: 'tooNew' | 'backup' | 'migrate',
    readonly backup: string | null,
    readonly version: { found: number; latest: number },
    cause: unknown
  ) {
    super(cause instanceof Error ? cause.message : String(cause))
  }
}

export function getDbPath(): string {
  return dbPath
}

export const backupsDir = (): string => join(dirname(dbPath), 'backups')

/** A consistent copy of the open database (`VACUUM INTO` reads a snapshot; copying a WAL database's file isn't one). */
function backupBeforeUpgrade(d: Database.Database, from: number): string {
  const dir = backupsDir()
  mkdirSync(dir, { recursive: true })
  // Milliseconds too: VACUUM INTO refuses an existing file (two starts within a second).
  const stamp = new Date().toISOString().replace(/[:.T]/g, '-').slice(0, 23)
  const file = join(dir, `${PRE_MIGRATION_PREFIX}v${from}-v${LATEST_SCHEMA}-${stamp}.db`)
  try {
    d.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`)
    if (statSync(file).size === 0) throw new Error(`backup not written: ${file}`)
  } catch (e) {
    // A half-written file (disk full) must not sit in the list as a backup.
    if (existsSync(file)) unlinkSync(file)
    throw e
  }
  return file
}

/** After a successful upgrade only, and best effort: a file that can't be removed (open elsewhere) blocks nothing. */
function prunePreUpgradeBackups(keep: string): void {
  const dir = backupsDir()
  const old = readdirSync(dir)
    .filter((f) => f.startsWith(PRE_MIGRATION_PREFIX) && f.endsWith('.db') && f !== basename(keep))
    .map((f) => ({ p: join(dir, f), at: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.at - a.at)
    .slice(KEEP_PRE_MIGRATION - 1)
  for (const x of old) {
    try {
      unlinkSync(x.p)
    } catch (e) {
      console.warn('[agentbits] old upgrade backup not removed', x.p, e)
    }
  }
}

export function openDb(): Database.Database {
  if (db) return db
  const dir = process.env.AGENTBITS_DATA_DIR || app.getPath('userData')
  dbPath = join(dir, 'agentbits.db') // set first: the error window names it even when the folder can't be made
  mkdirSync(dir, { recursive: true })
  const d = new Database(dbPath)
  const fail = (kind: DbStartError['kind'], backup: string | null, found: number, e: unknown): never => {
    d.close()
    throw new DbStartError(kind, backup, { found, latest: LATEST_SCHEMA }, e)
  }
  d.pragma('journal_mode = WAL')
  d.pragma('foreign_keys = ON')
  d.pragma('synchronous = NORMAL')
  d.pragma('busy_timeout = 5000')
  const from = schemaVersion(d)
  // An older build must not run on a newer build's data (its code doesn't know the new tables).
  if (from > LATEST_SCHEMA) fail('tooNew', null, from, `schema ${from} > ${LATEST_SCHEMA}`)
  let backup: string | null = null
  if (from > 0 && from < LATEST_SCHEMA) {
    try {
      backup = backupBeforeUpgrade(d, from)
    } catch (e) {
      fail('backup', null, from, e)
    }
  }
  try {
    migrate(d)
  } catch (e) {
    fail('migrate', backup, from, e)
  }
  if (backup) {
    try {
      prunePreUpgradeBackups(backup)
    } catch (e) {
      console.warn('[agentbits] upgrade backups not pruned', e)
    }
  }
  db = d
  return db
}

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not opened')
  return db
}

export function closeDb(): void {
  db?.close()
  db = null
}
