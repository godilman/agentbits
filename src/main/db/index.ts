import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { mkdirSync } from 'fs'
import { migrate } from './schema'

let db: Database.Database | null = null
let dbPath = ''

export function getDbPath(): string {
  return dbPath
}

export function openDb(): Database.Database {
  if (db) return db
  const dir = process.env.AGENTBITS_DATA_DIR || app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  dbPath = join(dir, 'agentbits.db')
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('synchronous = NORMAL')
  db.pragma('busy_timeout = 5000')
  migrate(db)
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
