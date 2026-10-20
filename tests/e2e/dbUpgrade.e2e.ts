// Opening data from an older or newer version: a consistent backup before any schema upgrade, no upgrade without it,
// never an empty profile or a reset when something fails, and a small separate limit for these backups.
// Real SQLite (better-sqlite3), each case in its own data folder. Run: npm run test:e2e
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DbStartError, PRE_MIGRATION_PREFIX, closeDb, getDb, openDb } from '../../src/main/db'
import { LATEST_SCHEMA, MIGRATIONS } from '../../src/main/db/schema'
import { createBackup, listBackups } from '../../src/main/core/maintenance'
import { applyLanguageSetting } from '../../src/main/i18n'

let count = 0
const step = async (name: string, fn: () => Promise<void> | void): Promise<void> => {
  await fn()
  count++
  console.log(`  ✓ ${name}`)
}

/** A fresh data folder; `version`: build its database as that schema version, with a marker row and a project. */
function dataDir(version?: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'ab-up-'))
  process.env.AGENTBITS_DATA_DIR = dir
  if (version !== undefined) {
    const d = new Database(join(dir, 'agentbits.db'))
    d.pragma('journal_mode = WAL')
    d.exec(`CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT '')`)
    for (const m of MIGRATIONS.filter((x) => x.version <= version)) {
      d.exec(m.sql)
      d.prepare('INSERT INTO schema_migrations(version) VALUES (?)').run(m.version)
    }
    d.prepare("INSERT INTO settings(key, value) VALUES ('e2e.marker', '\"kept\"')").run()
    d.prepare("INSERT INTO projects(id, name) VALUES ('p-old', 'Old project')").run()
    d.close() // leaves the -wal file behind like a crash would not; WAL content is checkpointed on close
  }
  return dir
}
const versionOf = (file: string): number => {
  const d = new Database(file, { readonly: true })
  try {
    return (d.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number }).v
  } finally {
    d.close()
  }
}
const marker = (file: string): string | undefined => {
  const d = new Database(file, { readonly: true })
  try {
    return (d.prepare("SELECT value FROM settings WHERE key = 'e2e.marker'").get() as { value: string } | undefined)?.value
  } finally {
    d.close()
  }
}
const backupsOf = (dir: string): string[] => (existsSync(join(dir, 'backups')) ? readdirSync(join(dir, 'backups')).sort() : [])
const startError = (fn: () => unknown): DbStartError => {
  try {
    fn()
  } catch (e) {
    assert.ok(e instanceof DbStartError, String(e))
    return e
  }
  assert.fail('expected the database not to open')
}

async function main(): Promise<void> {
  applyLanguageSetting('en')
  const previous = LATEST_SCHEMA - 1
  assert.ok(previous >= 1)

  await step('a new, empty data folder: no backup (nothing to protect), schema at the latest version', () => {
    const dir = dataDir()
    openDb()
    assert.deepEqual(backupsOf(dir), [])
    assert.equal(versionOf(join(dir, 'agentbits.db')), LATEST_SCHEMA)
    closeDb()
  })

  await step('older data: a consistent backup first (the old schema, the old rows), then the upgrade keeps every row', () => {
    const dir = dataDir(previous)
    openDb()
    const [file, ...rest] = backupsOf(dir)
    assert.equal(rest.length, 0)
    assert.ok(file.startsWith(`${PRE_MIGRATION_PREFIX}v${previous}-v${LATEST_SCHEMA}-`), file)
    const backup = join(dir, 'backups', file)
    assert.equal(versionOf(backup), previous, 'the backup is the data as it was before the upgrade')
    assert.equal(marker(backup), '"kept"')
    assert.equal(versionOf(join(dir, 'agentbits.db')), LATEST_SCHEMA)
    assert.equal((getDb().prepare("SELECT name FROM projects WHERE id = 'p-old'").get() as { name: string }).name, 'Old project')
    assert.equal(marker(join(dir, 'agentbits.db')), '"kept"')
    closeDb()
    openDb() // already up to date: no second backup
    assert.equal(backupsOf(dir).length, 1)
    closeDb()
  })

  await step('the backup fails: the upgrade does not run, the data stays as it was', () => {
    const dir = dataDir(previous)
    writeFileSync(join(dir, 'backups'), 'a file where the backups folder should be')
    const e = startError(() => openDb())
    assert.equal(e.kind, 'backup')
    assert.equal(e.backup, null)
    assert.deepEqual(e.version, { found: previous, latest: LATEST_SCHEMA })
    assert.equal(versionOf(join(dir, 'agentbits.db')), previous, 'not upgraded')
    assert.equal(marker(join(dir, 'agentbits.db')), '"kept"')
    assert.throws(() => getDb(), /not opened/, 'no empty database in its place')
  })

  await step('the upgrade fails: told apart from a backup failure, with the backup; nothing reset, and it never opens empty', () => {
    const dir = dataDir(previous)
    const d = new Database(join(dir, 'agentbits.db'))
    d.exec("CREATE TRIGGER e2e_fail BEFORE INSERT ON schema_migrations BEGIN SELECT RAISE(ABORT, 'e2e: upgrade step failed'); END;")
    d.close()
    const e = startError(() => openDb())
    assert.equal(e.kind, 'migrate')
    assert.match(e.message, /upgrade step failed/)
    assert.ok(e.backup && existsSync(e.backup) && versionOf(e.backup) === previous && marker(e.backup) === '"kept"')
    assert.equal(versionOf(join(dir, 'agentbits.db')), previous, 'the failed step was rolled back')
    assert.equal(marker(join(dir, 'agentbits.db')), '"kept"')
    assert.throws(() => getDb(), /not opened/)
    assert.equal(startError(() => openDb()).kind, 'migrate', 'a second start fails the same way (no empty profile)')
  })

  await step('several pending steps: all or none (a failure leaves the old schema), and failing again keeps the first backup', () => {
    const from = LATEST_SCHEMA - 2
    const dir = dataDir(from)
    const d = new Database(join(dir, 'agentbits.db'))
    d.exec(`CREATE TRIGGER e2e_fail BEFORE INSERT ON schema_migrations WHEN NEW.version = ${LATEST_SCHEMA} BEGIN SELECT RAISE(ABORT, 'e2e: last step failed'); END;`)
    d.close()
    for (let i = 0; i < 5; i++) assert.equal(startError(() => openDb()).kind, 'migrate')
    assert.equal(versionOf(join(dir, 'agentbits.db')), from, 'the steps before the failing one were rolled back too')
    const backups = backupsOf(dir)
    assert.equal(backups.length, 5, 'no pruning after a failed upgrade: the first backup is still there')
    assert.ok(backups.every((f) => versionOf(join(dir, 'backups', f)) === from))
  })

  await step('an old upgrade backup that cannot be removed does not stop the upgrade', () => {
    const dir = dataDir(previous)
    const aged = (p: string, days: number): void => {
      const t = Date.now() / 1000 - days * 86400
      utimesSync(p, t, t)
    }
    for (let i = 1; i <= 3; i++) {
      const p = join(dir, 'backups', `${PRE_MIGRATION_PREFIX}stuck${i}.db`)
      mkdirSync(p, { recursive: true }) // unlink fails on a folder
      aged(p, i)
    }
    for (let i = 1; i <= 2; i++) {
      writeFileSync(join(dir, 'backups', `${PRE_MIGRATION_PREFIX}older${i}.db`), 'x')
      aged(join(dir, 'backups', `${PRE_MIGRATION_PREFIX}older${i}.db`), 10 + i)
    }
    openDb()
    assert.equal(versionOf(join(dir, 'agentbits.db')), LATEST_SCHEMA)
    assert.ok(!backupsOf(dir).some((f) => f.includes('older')), 'the removable old ones still go')
    closeDb()
  })

  await step("data from a newer version: refused before anything is written (no backup, no change)", () => {
    const dir = dataDir(LATEST_SCHEMA)
    const d = new Database(join(dir, 'agentbits.db'))
    d.prepare('INSERT INTO schema_migrations(version) VALUES (?)').run(LATEST_SCHEMA + 1)
    d.close()
    const e = startError(() => openDb())
    assert.equal(e.kind, 'tooNew')
    assert.deepEqual(e.version, { found: LATEST_SCHEMA + 1, latest: LATEST_SCHEMA })
    assert.deepEqual(backupsOf(dir), [])
    assert.equal(versionOf(join(dir, 'agentbits.db')), LATEST_SCHEMA + 1)
  })

  await step('retention: the newest 3 upgrade backups stay; other backups are never removed by it', () => {
    const dir = dataDir(previous)
    mkdirSync(join(dir, 'backups'))
    const old = (name: string, ageDays: number): void => {
      const p = join(dir, 'backups', name)
      writeFileSync(p, 'x')
      const t = Date.now() / 1000 - ageDays * 86400
      utimesSync(p, t, t)
    }
    for (let i = 1; i <= 4; i++) old(`${PRE_MIGRATION_PREFIX}v1-v2-old${i}.db`, i)
    old('agentbits-backup-2020-01-01-00-00-00.db', 100)
    openDb()
    const files = backupsOf(dir)
    assert.ok(files.includes('agentbits-backup-2020-01-01-00-00-00.db'), 'a manual backup is kept')
    assert.deepEqual(
      files.filter((f) => f.startsWith(PRE_MIGRATION_PREFIX) && f.includes('old')),
      [`${PRE_MIGRATION_PREFIX}v1-v2-old1.db`, `${PRE_MIGRATION_PREFIX}v1-v2-old2.db`],
      'the new one + the two newest old ones'
    )
    assert.equal(files.filter((f) => f.startsWith(PRE_MIGRATION_PREFIX)).length, 3)
    // A manual backup's own limit (10) doesn't push the upgrade backups out.
    for (let i = 0; i < 11; i++) createBackup('backup')
    assert.equal(listBackups().filter((b) => b.name.startsWith(PRE_MIGRATION_PREFIX)).length, 3)
    closeDb()
  })

  console.log(`dbUpgrade e2e: ${count} steps ok`)
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e)
    process.exit(1)
  }
)
