import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import { createConnection, createServer, isIP, type AddressInfo } from 'net'
import type { Connection, SchemaInfo, SchemaTable } from '@shared/types'
import { t } from '../i18n'
import { cancellable as runCancellable } from '@shared/cancel'

/**
 * Database / SSH drivers. One short-lived connection per call (no pools): simple,
 * nothing stays open between agent tool calls, and a revoked permission takes
 * effect immediately. All are pure-JS packages (no native build).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface Credentials {
  username: string
  password: string | null
}

/**
 * - `readonly`: inside a transaction the database itself treats as read-only where it can
 *   (PostgreSQL / MySQL), and always rolled back
 * - `write`: inside a transaction, committed on success, rolled back on error
 * - `direct`: as is (DDL / several statements; admin only)
 */
export type QueryMode = 'readonly' | 'write' | 'direct'

export interface QueryOptions {
  mode: QueryMode
  timeoutMs: number
  maxRows: number
  /** Longest text kept from one cell (default 4000, cut with a note); exports keep whole cells. */
  maxCell?: number
  /** Aborted when the run is stopped (by the user or a run limit): the connection is dropped at once. */
  signal?: AbortSignal
}

export interface QueryResult {
  columns: string[]
  rows: unknown[][]
  rowCount: number
  truncated: boolean
  affected: number | null
}

const CONNECT_TIMEOUT = 10_000
const MAX_SCHEMA_COLUMNS = 4000
/** Longest text kept from one cell (the rest is cut with a note). */
const MAX_CELL = 4000
/**
 * Rows are streamed: only the first `maxRows` are kept, the rest are counted. A read that keeps going past
 * this many rows is cancelled (the connection is dropped; the read-only transaction is rolled back with it).
 */
const HARD_ROW_LIMIT = 100_000

function cell(v: unknown, max = MAX_CELL): unknown {
  if (v === null || v === undefined) return null
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'bigint') return v.toString()
  if (Buffer.isBuffer(v)) return `<binary ${v.length} bytes>`
  if (typeof v === 'string') return v.length > max ? `${v.slice(0, max)}… [${v.length} chars]` : v
  if (typeof v === 'object') {
    try {
      const text = JSON.stringify(v)
      return text.length > max ? `${text.slice(0, max)}… [${text.length} chars]` : JSON.parse(text)
    } catch {
      return String(v).slice(0, max)
    }
  }
  return v
}

/** Collects streamed rows: keeps the first `max`, counts the rest. `over` is called once past the hard limit. */
class RowSink {
  columns: string[] = []
  rows: unknown[][] = []
  count = 0
  stopped = false
  private max: number
  private maxCell: number
  constructor(
    limits: Pick<QueryOptions, 'maxRows' | 'maxCell'>,
    private over: () => void
  ) {
    this.max = limits.maxRows
    this.maxCell = limits.maxCell ?? MAX_CELL
  }
  reset(columns: string[]): void {
    this.columns = columns
    this.rows = []
    this.count = 0
  }
  add(row: unknown[]): void {
    this.count++
    if (this.rows.length < this.max) this.rows.push(row.map((v) => cell(v, this.maxCell)))
    if (this.count > HARD_ROW_LIMIT && !this.stopped) {
      this.stopped = true
      this.over()
    }
  }
  result(affected: number | null): QueryResult {
    return { columns: this.columns, rows: this.rows, rowCount: this.count, truncated: this.count > this.rows.length, affected }
  }
}

const tooManyRows = (): Error => new Error(t('main:connections.errors.tooManyRows', { max: HARD_ROW_LIMIT }))
const cancelled = (): Error => new Error(t('main:connections.errors.cancelled'))

const cancellable = <T>(signal: AbortSignal | undefined, fn: (onAbort: (drop: () => void) => void) => Promise<T>): Promise<T> =>
  runCancellable(signal, fn, cancelled)

/** Cleanup on a connection that may already be dropped must never hang the agent. */
async function quietly(p: Promise<unknown> | undefined, ms = 3000): Promise<void> {
  if (!p) return
  await Promise.race([p.catch(() => undefined), new Promise((r) => setTimeout(r, ms))])
}

function buildSchema(rows: { schema: string; table: string; kind: string; column: string; type: string; nullable: unknown }[]): SchemaInfo {
  const map = new Map<string, SchemaTable>()
  for (const r of rows.slice(0, MAX_SCHEMA_COLUMNS)) {
    const key = `${r.schema}.${r.table}`
    let t = map.get(key)
    if (!t) {
      t = { schema: r.schema, name: r.table, kind: /view/i.test(r.kind) ? 'view' : 'table', columns: [] }
      map.set(key, t)
    }
    t.columns.push({ name: r.column, type: r.type, nullable: r.nullable === true || r.nullable === 'YES' || r.nullable === 1 })
  }
  return { fetchedAt: new Date().toISOString(), tables: [...map.values()], truncated: rows.length > MAX_SCHEMA_COLUMNS }
}

/* ───────────────────────────── PostgreSQL ───────────────────────────── */

/** Runs one PostgreSQL query, streaming rows into a sink (the last result set wins for multi-statement text). */
async function pgStream(client: any, text: string, limits: Pick<QueryOptions, 'maxRows' | 'maxCell'>): Promise<QueryResult> {
  const { Query } = await import('pg')
  return new Promise((resolve, reject) => {
    const sink = new RowSink(limits, () => {
      client.__dropped = true
      client.connection?.stream?.destroy()
      reject(tooManyRows())
    })
    let affected: number | null = null
    const q = new (Query as any)({ text, rowMode: 'array' })
    q.on('row', (row: unknown[]) => sink.add(row))
    // A new result set (multi-statement text): keep the last one, like before.
    const describe = q.handleRowDescription.bind(q)
    q.handleRowDescription = (msg: any) => {
      describe(msg)
      sink.reset((msg.fields ?? []).map((f: any) => f.name))
    }
    const complete = q.handleCommandComplete.bind(q)
    q.handleCommandComplete = (msg: any, con: any) => {
      complete(msg, con)
      // "SELECT 5" / "INSERT 0 5" / "UPDATE 3"
      const parts = String(msg.text ?? '').split(' ')
      const n = Number(parts[parts.length - 1])
      affected = parts[0] === 'SELECT' || !Number.isFinite(n) ? null : n
    }
    q.on('error', reject)
    q.on('end', () => !sink.stopped && resolve(sink.result(sink.columns.length ? null : affected)))
    client.query(q)
  })
}

/** Through an SSH tunnel `host` is 127.0.0.1; TLS must still check the certificate against the real server name. */
export type DriverConn = Connection & { tlsHost?: string }
const tlsHostOf = (c: DriverConn): string | null => (c.tlsHost && c.tlsHost !== c.host ? c.tlsHost : null)

async function pgClient(c: DriverConn, cred: Credentials): Promise<any> {
  const tlsHost = tlsHostOf(c)
  const { Client } = await import('pg')
  const client = new Client({
    host: c.host,
    port: c.port,
    user: cred.username,
    password: cred.password ?? undefined,
    database: c.database || undefined,
    // pg copies `ssl` into tls.connect: `host` is what the certificate is checked against, `servername` the SNI (never an IP).
    ssl: c.ssl ? { rejectUnauthorized: !c.trustServerCertificate, ...(tlsHost ? { host: tlsHost, ...(isIP(tlsHost) ? {} : { servername: tlsHost }) } : {}) } : undefined,
    connectionTimeoutMillis: CONNECT_TIMEOUT,
    application_name: 'Agentbits'
  })
  // A dropped connection (row limit, network) emits 'error' on the client; unhandled, it would crash the main process.
  client.on('error', () => undefined)
  await client.connect()
  return client
}

const postgres = {
  async version(c: Connection, cred: Credentials): Promise<string> {
    const client = await pgClient(c, cred)
    try {
      return String((await client.query('SELECT version() AS v')).rows[0]?.v ?? '')
    } finally {
      await client.end().catch(() => undefined)
    }
  },
  query(c: Connection, cred: Credentials, sql: string, o: QueryOptions): Promise<QueryResult> {
    return cancellable(o.signal, (onAbort) => postgres.run(c, cred, sql, o, onAbort))
  },
  async run(c: Connection, cred: Credentials, sql: string, o: QueryOptions, onAbort: (drop: () => void) => void): Promise<QueryResult> {
    const client = await pgClient(c, cred)
    onAbort(() => {
      client.__dropped = true
      client.connection?.stream?.destroy()
    })
    const ms = Math.max(1000, Math.round(o.timeoutMs))
    try {
      if (o.mode === 'direct') {
        await client.query(`SET statement_timeout = ${ms}`)
        return await pgStream(client, sql, o)
      }
      await client.query(o.mode === 'readonly' ? 'BEGIN TRANSACTION READ ONLY' : 'BEGIN')
      try {
        await client.query(`SET LOCAL statement_timeout = ${ms}`)
        const res = await pgStream(client, sql, o)
        await client.query(o.mode === 'readonly' ? 'ROLLBACK' : 'COMMIT')
        return res
      } catch (e) {
        // A dropped connection rolls back by itself; ROLLBACK there would wait forever.
        if (!client.__dropped) await quietly(client.query('ROLLBACK'))
        throw e
      }
    } finally {
      await quietly(client.__dropped ? undefined : client.end())
    }
  },
  async schema(c: Connection, cred: Credentials): Promise<SchemaInfo> {
    const r = await postgres.query(
      c,
      cred,
      `SELECT c.table_schema, c.table_name, t.table_type, c.column_name, c.data_type, c.is_nullable
       FROM information_schema.columns c
       JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
       WHERE c.table_schema NOT IN ('pg_catalog','information_schema') AND c.table_schema NOT LIKE 'pg_toast%'
       ORDER BY c.table_schema, c.table_name, c.ordinal_position`,
      { mode: 'readonly', timeoutMs: 30_000, maxRows: MAX_SCHEMA_COLUMNS + 1 }
    )
    return buildSchema(r.rows.map((x) => ({ schema: String(x[0]), table: String(x[1]), kind: String(x[2]), column: String(x[3]), type: String(x[4]), nullable: x[5] })))
  }
}

/* ───────────────────────────── MySQL / MariaDB ───────────────────────────── */

async function myConn(c: DriverConn, cred: Credentials, multi: boolean): Promise<any> {
  const mysql = await import('mysql2/promise')
  const tlsHost = tlsHostOf(c)
  const conn = await mysql.createConnection({
    // mysql2 checks the certificate against `host`: through a tunnel that stays the real server, and the socket
    // goes to the tunnel instead. `_host` is what Node checks an IP address against (servername is never an IP).
    host: tlsHost ?? c.host,
    port: c.port,
    ...(tlsHost
      ? {
          stream: () => {
            const s = createConnection(c.port, c.host)
            ;(s as unknown as { _host: string })._host = tlsHost
            return s
          }
        }
      : {}),
    user: cred.username,
    password: cred.password ?? undefined,
    database: c.database || undefined,
    // verifyIdentity: without it mysql2 checks only the chain, not that the certificate belongs to this server.
    ssl: c.ssl ? { rejectUnauthorized: !c.trustServerCertificate, verifyIdentity: !c.trustServerCertificate } : undefined,
    connectTimeout: CONNECT_TIMEOUT,
    multipleStatements: multi,
    rowsAsArray: true,
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true
  })
  ;(conn as any).connection.on('error', () => undefined)
  return conn
}

const mysql = {
  async version(c: Connection, cred: Credentials): Promise<string> {
    const conn = await myConn(c, cred, false)
    try {
      const [rows] = await conn.query('SELECT VERSION()')
      return String((rows as unknown[][])[0]?.[0] ?? '')
    } finally {
      await conn.end().catch(() => undefined)
    }
  },
  query(c: Connection, cred: Credentials, sql: string, o: QueryOptions): Promise<QueryResult> {
    return cancellable(o.signal, (onAbort) => mysql.run(c, cred, sql, o, onAbort))
  },
  async run(c: Connection, cred: Credentials, sql: string, o: QueryOptions, onAbort: (drop: () => void) => void): Promise<QueryResult> {
    const conn = await myConn(c, cred, o.mode === 'direct')
    const ms = Math.max(1000, Math.round(o.timeoutMs))
    let dropped = false
    onAbort(() => {
      dropped = true
      conn.connection.destroy()
    })
    // Streamed through the underlying connection so a huge result never sits in memory.
    const run = (): Promise<QueryResult> =>
      new Promise((resolve, reject) => {
        const sink = new RowSink(o, () => {
          dropped = true
          conn.connection.destroy()
          reject(tooManyRows())
        })
        let affected: number | null = null
        let hasRows = false
        const q = conn.connection.query({ sql, timeout: ms, rowsAsArray: true })
        q.on('fields', (fields: any[]) => {
          hasRows = true
          sink.reset((fields ?? []).map((f: any) => f.name))
        })
        q.on('result', (row: any) => {
          if (Array.isArray(row)) sink.add(row)
          else if (row && typeof row === 'object' && 'affectedRows' in row) affected = (affected ?? 0) + Number(row.affectedRows ?? 0)
        })
        q.on('error', reject)
        q.on('end', () => !sink.stopped && resolve(sink.result(hasRows ? null : affected)))
      })
    try {
      if (o.mode === 'direct') return await run()
      // MySQL rejects writes inside a READ ONLY transaction (DDL is classified as admin and never gets here).
      await conn.query(o.mode === 'readonly' ? 'START TRANSACTION READ ONLY' : 'START TRANSACTION')
      try {
        const r = await run()
        await conn.query(o.mode === 'readonly' ? 'ROLLBACK' : 'COMMIT')
        return r
      } catch (e) {
        if (!dropped) await quietly(conn.query('ROLLBACK'))
        throw e
      }
    } finally {
      if (!dropped) await quietly(conn.end())
    }
  },
  async schema(c: Connection, cred: Credentials): Promise<SchemaInfo> {
    const r = await mysql.query(
      c,
      cred,
      `SELECT c.TABLE_SCHEMA, c.TABLE_NAME, t.TABLE_TYPE, c.COLUMN_NAME, c.COLUMN_TYPE, c.IS_NULLABLE
       FROM information_schema.COLUMNS c
       JOIN information_schema.TABLES t ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME
       WHERE c.TABLE_SCHEMA = COALESCE(DATABASE(), c.TABLE_SCHEMA)
         AND c.TABLE_SCHEMA NOT IN ('mysql','information_schema','performance_schema','sys')
       ORDER BY c.TABLE_SCHEMA, c.TABLE_NAME, c.ORDINAL_POSITION`,
      { mode: 'readonly', timeoutMs: 30_000, maxRows: MAX_SCHEMA_COLUMNS + 1 }
    )
    return buildSchema(r.rows.map((x) => ({ schema: String(x[0]), table: String(x[1]), kind: String(x[2]), column: String(x[3]), type: String(x[4]), nullable: x[5] })))
  }
}

/* ───────────────────────────── SQL Server ───────────────────────────── */

async function msPool(c: DriverConn, cred: Credentials, timeoutMs: number): Promise<any> {
  const sql = (await import('mssql')).default
  const pool = new sql.ConnectionPool({
    server: c.host,
    port: c.port,
    user: cred.username,
    password: cred.password ?? undefined,
    database: c.database || undefined,
    connectionTimeout: CONNECT_TIMEOUT,
    requestTimeout: Math.max(1000, Math.round(timeoutMs)),
    pool: { max: 1, min: 0 },
    // tedious checks the certificate against `serverName` when given (the real server, not the tunnel's 127.0.0.1).
    options: { encrypt: c.ssl, trustServerCertificate: c.trustServerCertificate, appName: 'Agentbits', ...(tlsHostOf(c) ? { serverName: tlsHostOf(c)! } : {}) }
  })
  await pool.connect()
  return { pool, sql }
}

const mssql = {
  async version(c: Connection, cred: Credentials): Promise<string> {
    const { pool } = await msPool(c, cred, 15_000)
    try {
      const r = await pool.request().query('SELECT @@VERSION AS v')
      return String(r.recordset?.[0]?.v ?? '').split('\n')[0]
    } finally {
      await pool.close().catch(() => undefined)
    }
  },
  query(c: Connection, cred: Credentials, text: string, o: QueryOptions): Promise<QueryResult> {
    return cancellable(o.signal, (onAbort) => mssql.run(c, cred, text, o, onAbort))
  },
  async run(c: Connection, cred: Credentials, text: string, o: QueryOptions, onAbort: (drop: () => void) => void): Promise<QueryResult> {
    const { pool, sql } = await msPool(c, cred, o.timeoutMs)
    let current: any = null
    // SQL Server supports a real cancel of the running request (attention signal).
    onAbort(() => {
      current?.cancel()
      void quietly(pool.close())
    })
    /** Streams a request's rows (the last result set wins), cancelling past the hard limit. */
    const stream = (req: any): Promise<QueryResult> =>
      new Promise((resolve, reject) => {
        current = req
        const sink = new RowSink(o, () => {
          req.cancel()
          reject(tooManyRows())
        })
        let affected: number | null = null
        let hasRows = false
        req.stream = true
        req.arrayRowMode = true
        req.on('recordset', (columns: any) => {
          hasRows = true
          const cols = Array.isArray(columns)
            ? columns.map((c: any) => c.name)
            : Object.keys(columns ?? {}).sort((a, b) => (columns[a].index ?? 0) - (columns[b].index ?? 0))
          sink.reset(cols)
        })
        req.on('row', (row: unknown) => sink.add(Array.isArray(row) ? row : Object.values(row as object)))
        req.on('rowsaffected', (n: number) => {
          affected = (affected ?? 0) + n
        })
        req.on('error', reject)
        req.on('done', () => !sink.stopped && resolve(sink.result(hasRows ? null : affected)))
        req.query(text)
      })
    try {
      if (o.mode === 'direct') return await stream(pool.request())
      // SQL Server has no read-only transaction: the read path is classified as SELECT-only and always rolled back.
      const tx = new sql.Transaction(pool)
      await tx.begin()
      try {
        const r = await stream(new sql.Request(tx))
        if (o.mode === 'readonly') await tx.rollback()
        else await tx.commit()
        return r
      } catch (e) {
        await quietly(tx.rollback())
        throw e
      }
    } finally {
      await quietly(pool.close())
    }
  },
  async schema(c: Connection, cred: Credentials): Promise<SchemaInfo> {
    const r = await mssql.query(
      c,
      cred,
      `SELECT c.TABLE_SCHEMA, c.TABLE_NAME, t.TABLE_TYPE, c.COLUMN_NAME, c.DATA_TYPE, c.IS_NULLABLE
       FROM INFORMATION_SCHEMA.COLUMNS c
       JOIN INFORMATION_SCHEMA.TABLES t ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME
       ORDER BY c.TABLE_SCHEMA, c.TABLE_NAME, c.ORDINAL_POSITION`,
      { mode: 'readonly', timeoutMs: 30_000, maxRows: MAX_SCHEMA_COLUMNS + 1 }
    )
    return buildSchema(r.rows.map((x) => ({ schema: String(x[0]), table: String(x[1]), kind: String(x[2]), column: String(x[3]), type: String(x[4]), nullable: x[5] })))
  }
}

export const dbDrivers = { postgres, mysql, mssql }

/* ───────────────────────────── SSH ───────────────────────────── */

export interface SshResult {
  stdout: string
  stderr: string
  code: number | null
  truncated: boolean
  timedOut: boolean
}

const MAX_OUT = 64 * 1024

export const fingerprint = (key: Buffer): string => 'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, '')

function sshAgentPath(): string | undefined {
  if (process.platform === 'win32') return '\\\\.\\pipe\\openssh-ssh-agent'
  return process.env.SSH_AUTH_SOCK || undefined
}

/**
 * Runs one command over SSH. The host key is pinned on first contact (`onNewHostKey`)
 * and must match afterwards, so a swapped server is refused instead of trusted.
 */
/** ssh2 connect options: the login and the host key check (pinned on first contact only via `onNewHostKey`). */
function sshConfig(c: Connection, secret: string | null, onNewHostKey: ((fp: string) => void) | undefined, onHostKeyError: (msg: string) => void): Record<string, unknown> {
  const auth: Record<string, unknown> = {}
  if (c.sshAuth === 'password') auth.password = secret ?? ''
  else if (c.sshAuth === 'agent') auth.agent = sshAgentPath()
  else if (c.sshAuth === 'key') {
    auth.privateKey = secret ?? ''
  } else {
    if (!c.keyPath) throw new Error(t('main:connections.errors.noKeyFile'))
    auth.privateKey = readFileSync(c.keyPath)
    if (secret) auth.passphrase = secret
  }
  if (c.sshAuth === 'agent' && !auth.agent) throw new Error(t('main:connections.errors.noSshAgent'))
  return {
    host: c.host,
    port: c.port,
    username: c.username,
    readyTimeout: CONNECT_TIMEOUT,
    hostVerifier: (key: Buffer) => {
      const fp = fingerprint(key)
      if (!c.hostKey) {
        if (!onNewHostKey) {
          onHostKeyError(t('main:connections.errors.hostKeyNotPinned', { got: fp }))
          return false
        }
        onNewHostKey(fp)
        return true
      }
      if (c.hostKey === fp) return true
      onHostKeyError(t('main:connections.errors.hostKeyChanged', { expected: c.hostKey, got: fp }))
      return false
    },
    ...auth
  }
}

/**
 * Runs one command over SSH. The host key is pinned on first contact (`onNewHostKey`)
 * and must match afterwards, so a swapped server is refused instead of trusted.
 */
export async function sshExec(
  c: Connection,
  secret: string | null,
  command: string | null,
  /** `onNewHostKey`: only the user's "Test" may pin a key; without it an unpinned server is refused. */
  opts: { timeoutMs: number; onNewHostKey?: (fp: string) => void; signal?: AbortSignal }
): Promise<SshResult & { banner?: string }> {
  const { Client } = await import('ssh2')
  let hostKeyError: string | null = null
  const config = sshConfig(c, secret, opts.onNewHostKey, (m) => (hostKeyError = m))

  return cancellable(opts.signal, (onAbort) => new Promise((resolve, reject) => {
    const client = new Client()
    // Closing the session ends the remote command's channel (sshd sends it SIGHUP).
    onAbort(() => client.end())
    let settled = false
    const done = (fn: () => void): void => {
      if (settled) return
      settled = true
      fn()
      client.end()
    }
    client
      .on('ready', () => {
        if (command === null) return done(() => resolve({ stdout: '', stderr: '', code: 0, truncated: false, timedOut: false }))
        client.exec(command, (err, stream) => {
          if (err) return done(() => reject(err))
          let stdout = ''
          let stderr = ''
          let truncated = false
          let timedOut = false
          let exitCode: number | null = null
          stream.on('exit', (code: number | null) => {
            exitCode = typeof code === 'number' ? code : null
          })
          const timer = setTimeout(() => {
            timedOut = true
            stream.close()
          }, Math.max(1000, opts.timeoutMs))
          stream.on('data', (d: Buffer) => {
            if (stdout.length < MAX_OUT) stdout += d.toString('utf8')
            else truncated = true
          })
          stream.stderr.on('data', (d: Buffer) => {
            if (stderr.length < MAX_OUT) stderr += d.toString('utf8')
            else truncated = true
          })
          stream.on('close', () => {
            clearTimeout(timer)
            done(() => resolve({ stdout: stdout.slice(0, MAX_OUT), stderr: stderr.slice(0, MAX_OUT), code: exitCode, truncated, timedOut }))
          })
        })
      })
      .on('error', (e) => done(() => reject(hostKeyError ? new Error(hostKeyError) : e)))
      .connect(config as any)
  }))
}

export interface Tunnel {
  /** Local port on 127.0.0.1 that leads to the database server. */
  port: number
  /** Why the SSH server refused to forward (e.g. AllowTcpForwarding no), if it did. */
  error(): Error | null
  close(): void
}

/**
 * Opens an SSH tunnel to `dstHost:dstPort` (as seen from the SSH server) behind a random local port, so
 * every database driver connects to it unchanged. Same host key rule as `sshExec`.
 * ponytail: one tunnel per database call (the drivers open a connection per call too); pool it if it gets slow.
 */
export async function openTunnel(ssh: Connection, secret: string | null, dstHost: string, dstPort: number, opts: { onNewHostKey?: (fp: string) => void } = {}): Promise<Tunnel> {
  const { Client } = await import('ssh2')
  let hostKeyError: string | null = null
  let forwardError: Error | null = null
  const config = sshConfig(ssh, secret, opts.onNewHostKey, (m) => (hostKeyError = m))
  const client = new Client()
  await new Promise<void>((resolve, reject) => {
    client.once('ready', () => resolve())
    client.once('error', (e) => reject(hostKeyError ? new Error(hostKeyError) : e))
    client.connect(config as any)
  })
  // Later errors (dropped link) end up in the driver as a closed socket; unhandled they would crash main.
  client.on('error', () => undefined)
  const server = createServer((sock) => {
    sock.on('error', () => undefined)
    client.forwardOut('127.0.0.1', 0, dstHost, dstPort, (err, stream) => {
      if (err) {
        forwardError = new Error(t('main:connections.errors.tunnelRefused', { message: err.message }))
        return sock.destroy()
      }
      stream.on('error', () => undefined)
      sock.pipe(stream).pipe(sock)
      stream.on('close', () => sock.destroy())
      sock.on('close', () => stream.close())
    })
  })
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
  } catch (e) {
    client.end()
    throw e
  }
  return {
    port: (server.address() as AddressInfo).port,
    error: () => forwardError,
    close: () => {
      server.close()
      client.end()
    }
  }
}
