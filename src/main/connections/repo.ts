import { randomUUID } from 'crypto'
import type {
  AccessLevel,
  AuditEntry,
  AuditResult,
  Connection,
  ConnectionInput,
  ConnectionPermission,
  SchemaInfo
} from '@shared/types'
import { DEFAULT_PORT, DEFAULT_SSH_READ, LEVEL_ORDER, plaintextTarget } from '@shared/connections'
import { getDb } from '../db'
import { decryptSecret, encryptSecret } from '../secrets'
import { t } from '../i18n'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>
const now = (): string => new Date().toISOString()
const list = (v: unknown): string[] => {
  try {
    const a = JSON.parse(String(v ?? '[]'))
    return Array.isArray(a) ? a.map(String) : []
  } catch {
    return []
  }
}
const cleanList = (a: string[] | undefined): string | undefined =>
  a === undefined ? undefined : JSON.stringify([...new Set(a.map((x) => x.trim()).filter(Boolean))].slice(0, 200))

const enc = (plain: string): string => encryptSecret(plain).toString('base64')
const dec = (b64: string | null): string | null => (b64 ? decryptSecret(Buffer.from(b64, 'base64')) : null)

const mapConnection = (r: Row): Connection => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  env: r.env,
  description: r.description,
  purpose: r.purpose,
  notes: r.notes,
  host: r.host,
  port: r.port,
  username: r.username,
  database: r.database,
  sshAuth: r.ssh_auth,
  keyPath: r.key_path,
  ssl: !!r.ssl,
  trustServerCertificate: !!r.trust_server_cert,
  viaSshId: r.via_ssh_id ?? null,
  // The yes counts only for the target it was given for.
  allowPlaintext: !!r.allow_plaintext && r.plaintext_target === plaintextTarget({ viaSshId: r.via_ssh_id ?? null, host: r.host ?? '', port: r.port }),
  readOnlyUsername: r.ro_username,
  sshRead: list(r.ssh_read),
  sshWrite: list(r.ssh_write),
  sshExecute: list(r.ssh_execute),
  hasSecret: !!r.secret_enc,
  hasReadOnlySecret: !!r.ro_secret_enc,
  hostKey: r.host_key ?? null,
  lastTestAt: r.last_test_at ?? null,
  lastTestOk: r.last_test_ok === null || r.last_test_ok === undefined ? null : !!r.last_test_ok,
  lastTestMessage: r.last_test_message ?? null,
  schemaFetchedAt: r.schema_fetched_at ?? null,
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

/** Everything a driver needs, including decrypted secrets. Main process only. */
export interface ConnectionSecrets {
  secret: string | null
  readOnlySecret: string | null
}

export const connectionsRepo = {
  list(): Connection[] {
    return (getDb().prepare('SELECT * FROM connections ORDER BY name COLLATE NOCASE').all() as Row[]).map(mapConnection)
  },
  get(id: string): Connection | null {
    const r = getDb().prepare('SELECT * FROM connections WHERE id = ?').get(id) as Row | undefined
    return r ? mapConnection(r) : null
  },
  findByName(name: string): Connection | null {
    const r = getDb().prepare('SELECT * FROM connections WHERE name = ? COLLATE NOCASE').get(name.trim()) as Row | undefined
    return r ? mapConnection(r) : null
  },
  secrets(id: string): ConnectionSecrets {
    const r = getDb().prepare('SELECT secret_enc, ro_secret_enc FROM connections WHERE id = ?').get(id) as Row | undefined
    return { secret: dec(r?.secret_enc ?? null), readOnlySecret: dec(r?.ro_secret_enc ?? null) }
  },
  save(input: ConnectionInput, id?: string): Connection {
    const db = getDb()
    const cid = id ?? randomUUID()
    const cols: Record<string, unknown> = {
      name: input.name?.trim(),
      kind: input.kind,
      env: input.env,
      description: input.description,
      purpose: input.purpose,
      notes: input.notes,
      host: input.host?.trim(),
      port: input.port,
      username: input.username?.trim(),
      database: input.database?.trim(),
      ssh_auth: input.sshAuth,
      key_path: input.keyPath?.trim(),
      ssl: input.ssl === undefined ? undefined : input.ssl ? 1 : 0,
      trust_server_cert: input.trustServerCertificate === undefined ? undefined : input.trustServerCertificate ? 1 : 0,
      via_ssh_id: input.viaSshId === undefined ? undefined : input.viaSshId || null,
      allow_plaintext: input.allowPlaintext === undefined ? undefined : input.allowPlaintext ? 1 : 0,
      ro_username: input.readOnlyUsername?.trim(),
      ssh_read: cleanList(input.sshRead),
      ssh_write: cleanList(input.sshWrite),
      ssh_execute: cleanList(input.sshExecute),
      secret_enc: input.secret === undefined ? undefined : input.secret === '' ? null : enc(input.secret),
      ro_secret_enc: input.readOnlySecret === undefined ? undefined : input.readOnlySecret === '' ? null : enc(input.readOnlySecret)
    }
    if (input.resetHostKey) cols.host_key = null
    db.transaction(() => {
      if (!id) {
        const kind = input.kind ?? 'postgres'
        db.prepare('INSERT INTO connections (id, name, kind, port, ssh_read, created_at, updated_at) VALUES (?,?,?,?,?,?,?)').run(
          cid,
          input.name?.trim() || t('main:connections.newName'),
          kind,
          input.port || DEFAULT_PORT[kind],
          JSON.stringify(kind === 'ssh' ? DEFAULT_SSH_READ : []),
          now(),
          now()
        )
      }
      const sets: string[] = []
      const vals: unknown[] = []
      for (const [k, v] of Object.entries(cols)) {
        if (v === undefined) continue
        sets.push(`${k} = ?`)
        vals.push(v)
      }
      sets.push('updated_at = ?')
      vals.push(now())
      db.prepare(`UPDATE connections SET ${sets.join(', ')} WHERE id = ?`).run(...vals, cid)
      // An unencrypted yes is tied to the target as saved now (route, host, port).
      if (input.allowPlaintext !== undefined) {
        const r = db.prepare('SELECT via_ssh_id, host, port FROM connections WHERE id = ?').get(cid) as Row
        const target = input.allowPlaintext ? plaintextTarget({ viaSshId: r.via_ssh_id ?? null, host: r.host ?? '', port: r.port }) : null
        db.prepare('UPDATE connections SET plaintext_target = ? WHERE id = ?').run(target, cid)
      }
    })()
    return this.get(cid)!
  },
  delete(id: string): void {
    getDb().prepare('DELETE FROM connections WHERE id = ?').run(id)
  },
  /** Databases that reach their server through this SSH connection. */
  tunnelUsers(sshId: string): Connection[] {
    return (getDb().prepare('SELECT * FROM connections WHERE via_ssh_id = ? ORDER BY name COLLATE NOCASE').all(sshId) as Row[]).map(mapConnection)
  },
  setTestResult(id: string, ok: boolean, message: string): void {
    getDb()
      .prepare('UPDATE connections SET last_test_at = ?, last_test_ok = ?, last_test_message = ? WHERE id = ?')
      .run(now(), ok ? 1 : 0, message.slice(0, 500), id)
  },
  pinHostKey(id: string, fingerprint: string): void {
    getDb().prepare('UPDATE connections SET host_key = ? WHERE id = ? AND host_key IS NULL').run(fingerprint, id)
  },
  setSchema(id: string, schema: SchemaInfo): void {
    getDb().prepare('UPDATE connections SET schema_json = ?, schema_fetched_at = ? WHERE id = ?').run(JSON.stringify(schema), schema.fetchedAt, id)
  },
  schema(id: string): SchemaInfo | null {
    const r = getDb().prepare('SELECT schema_json FROM connections WHERE id = ?').get(id) as Row | undefined
    if (!r?.schema_json) return null
    try {
      return JSON.parse(r.schema_json) as SchemaInfo
    } catch {
      return null
    }
  }
}

export const connPermsRepo = {
  list(): ConnectionPermission[] {
    return (getDb().prepare("SELECT * FROM connection_permissions WHERE level <> 'none'").all() as Row[]).map((r) => ({
      connectionId: r.connection_id,
      agentId: r.agent_id,
      level: r.level
    }))
  },
  /** Deny-all: missing row = 'none'. */
  level(connectionId: string, agentId: string): AccessLevel {
    const r = getDb().prepare('SELECT level FROM connection_permissions WHERE connection_id = ? AND agent_id = ?').get(connectionId, agentId) as Row | undefined
    return (r?.level as AccessLevel) ?? 'none'
  },
  set(connectionId: string, agentId: string, level: AccessLevel): void {
    if (!LEVEL_ORDER.includes(level)) throw new Error(t('main:connections.errors.invalidLevel'))
    if (level === 'none') {
      getDb().prepare('DELETE FROM connection_permissions WHERE connection_id = ? AND agent_id = ?').run(connectionId, agentId)
      return
    }
    getDb()
      .prepare(
        `INSERT INTO connection_permissions (connection_id, agent_id, level, updated_at) VALUES (?,?,?,?)
         ON CONFLICT(connection_id, agent_id) DO UPDATE SET level = excluded.level, updated_at = excluded.updated_at`
      )
      .run(connectionId, agentId, level, now())
  },
  forAgent(agentId: string): { connectionId: string; level: AccessLevel }[] {
    return (getDb().prepare("SELECT connection_id, level FROM connection_permissions WHERE agent_id = ? AND level <> 'none'").all(agentId) as Row[]).map(
      (r) => ({ connectionId: r.connection_id, level: r.level })
    )
  }
}

const mapAudit = (r: Row): AuditEntry => ({
  id: r.id,
  at: r.at,
  actorType: r.actor_type,
  actorId: r.actor_id ?? null,
  actorName: r.actor_name,
  connectionId: r.connection_id ?? null,
  connectionName: r.connection_name,
  projectId: r.project_id ?? null,
  taskId: r.task_id ?? null,
  runId: r.run_id ?? null,
  action: r.action,
  detail: r.detail,
  result: r.result,
  message: r.message ?? null,
  durationMs: r.duration_ms ?? null
})

export const auditRepo = {
  add(e: Omit<AuditEntry, 'id' | 'at'>): AuditEntry {
    const info = getDb()
      .prepare(
        `INSERT INTO audit_log (at, actor_type, actor_id, actor_name, connection_id, connection_name, project_id, task_id, run_id, action, detail, result, message, duration_ms)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        now(),
        e.actorType,
        e.actorId,
        e.actorName,
        e.connectionId,
        e.connectionName,
        e.projectId,
        e.taskId,
        e.runId,
        e.action,
        e.detail.slice(0, 4000),
        e.result,
        e.message ? e.message.slice(0, 1000) : null,
        e.durationMs
      )
    return mapAudit(getDb().prepare('SELECT * FROM audit_log WHERE id = ?').get(info.lastInsertRowid) as Row)
  },
  list(opts: { connectionId?: string; actorId?: string; runId?: string; result?: AuditResult; beforeId?: number; limit?: number }): AuditEntry[] {
    const where: string[] = []
    const vals: unknown[] = []
    if (opts.connectionId) (where.push('connection_id = ?'), vals.push(opts.connectionId))
    if (opts.runId) (where.push('run_id = ?'), vals.push(opts.runId))
    if (opts.actorId) (where.push('actor_id = ?'), vals.push(opts.actorId))
    if (opts.result) (where.push('result = ?'), vals.push(opts.result))
    if (opts.beforeId) (where.push('id < ?'), vals.push(opts.beforeId))
    const sql = `SELECT * FROM audit_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`
    return (getDb().prepare(sql).all(...vals, Math.min(1000, opts.limit ?? 200)) as Row[]).map(mapAudit)
  }
}
