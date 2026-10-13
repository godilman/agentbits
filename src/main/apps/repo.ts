import { randomUUID } from 'crypto'
import { getDb } from '../db'
import { decryptSecret, encryptSecret } from '../secrets'
import type { AppServer, AppServerInput, AppTool, SecretPair, ToolPolicy } from '@shared/apps'

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

function parse<T>(s: string | null | undefined, fallback: T): T {
  try {
    return s ? (JSON.parse(s) as T) : fallback
  } catch {
    return fallback
  }
}

/** OAuth state kept per server (client registration, tokens, PKCE verifier) — encrypted. */
export interface OAuthState {
  client?: Record<string, unknown>
  tokens?: Record<string, unknown>
  verifier?: string
  redirectUrl?: string
}

function readSecretMap(buf: Buffer | null | undefined): Record<string, string> {
  return parse<Record<string, string>>(decryptSecret(buf), {})
}

/** Applies a write-only key/value list to the stored map: listed keys stay (new value or old one), others go. */
function mergeSecrets(old: Record<string, string>, pairs: SecretPair[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const p of pairs) {
    const key = p.key.trim()
    if (!key) continue
    if (p.value !== undefined) out[key] = p.value
    else if (key in old) out[key] = old[key]
  }
  return out
}

function map(r: Row, policies: Row[], perms: Row[]): AppServer {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    transport: r.transport,
    command: r.command,
    args: parse<string[]>(r.args, []),
    cwd: r.cwd,
    envKeys: parse<string[]>(r.env_keys, []),
    url: r.url,
    headerKeys: parse<string[]>(r.header_keys, []),
    oauth: !!r.oauth,
    signedIn: !!parse<OAuthState>(decryptSecret(r.oauth_enc), {}).tokens,
    enabled: !!r.enabled,
    tools: parse<AppTool[]>(r.tools, []),
    toolsAt: r.tools_at,
    policies: Object.fromEntries(policies.filter((p) => p.server_id === r.id).map((p) => [p.tool, p.policy as ToolPolicy])),
    agentIds: perms.filter((p) => p.server_id === r.id).map((p) => p.agent_id),
    lastOk: r.last_ok === null || r.last_ok === undefined ? null : !!r.last_ok,
    lastMessage: r.last_message,
    lastAt: r.last_at,
    serverName: r.server_name,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

export const appsRepo = {
  list(): AppServer[] {
    const db = getDb()
    const policies = db.prepare('SELECT * FROM mcp_tool_policies').all() as Row[]
    const perms = db.prepare('SELECT * FROM mcp_permissions ORDER BY created_at').all() as Row[]
    return (db.prepare('SELECT * FROM mcp_servers ORDER BY name COLLATE NOCASE').all() as Row[]).map((r) => map(r, policies, perms))
  },

  get(id: string): AppServer | null {
    return this.list().find((s) => s.id === id) ?? null
  },

  byName(name: string): AppServer | null {
    const r = getDb().prepare('SELECT id FROM mcp_servers WHERE name = ? COLLATE NOCASE').get(name) as Row | undefined
    return r ? this.get(r.id) : null
  },

  /** Secrets for connecting (main only). */
  secrets(id: string): { env: Record<string, string>; headers: Record<string, string> } {
    const r = getDb().prepare('SELECT env_enc, headers_enc FROM mcp_servers WHERE id = ?').get(id) as Row | undefined
    return { env: readSecretMap(r?.env_enc), headers: readSecretMap(r?.headers_enc) }
  },

  save(input: AppServerInput, id?: string): AppServer {
    const db = getDb()
    const sid = id ?? randomUUID()
    const old = id ? this.secrets(id) : { env: {}, headers: {} }
    const sets: string[] = []
    const vals: unknown[] = []
    const set = (col: string, v: unknown): void => {
      sets.push(`${col} = ?`)
      vals.push(v)
    }
    if (input.name !== undefined) set('name', input.name.trim())
    if (input.description !== undefined) set('description', input.description)
    if (input.transport !== undefined) set('transport', input.transport)
    if (input.command !== undefined) set('command', input.command.trim())
    if (input.args !== undefined) set('args', JSON.stringify(input.args))
    if (input.cwd !== undefined) set('cwd', input.cwd.trim())
    if (input.url !== undefined) set('url', input.url.trim())
    if (input.oauth !== undefined) set('oauth', input.oauth ? 1 : 0)
    if (input.enabled !== undefined) set('enabled', input.enabled ? 1 : 0)
    if (input.env !== undefined) {
      const env = mergeSecrets(old.env, input.env)
      set('env_keys', JSON.stringify(Object.keys(env)))
      set('env_enc', Object.keys(env).length ? encryptSecret(JSON.stringify(env)) : null)
    }
    if (input.headers !== undefined) {
      const headers = mergeSecrets(old.headers, input.headers)
      set('header_keys', JSON.stringify(Object.keys(headers)))
      set('headers_enc', Object.keys(headers).length ? encryptSecret(JSON.stringify(headers)) : null)
    }
    db.transaction(() => {
      if (!id) db.prepare('INSERT INTO mcp_servers(id, name, transport) VALUES (?, ?, ?)').run(sid, (input.name ?? '').trim(), input.transport ?? 'stdio')
      if (sets.length) db.prepare(`UPDATE mcp_servers SET ${sets.join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(...vals, sid)
    })()
    return this.get(sid)!
  },

  delete(id: string): void {
    getDb().prepare('DELETE FROM mcp_servers WHERE id = ?').run(id)
  },

  setTools(id: string, tools: AppTool[], serverName: string | null): void {
    getDb()
      .prepare(`UPDATE mcp_servers SET tools = ?, tools_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), server_name = ? WHERE id = ?`)
      .run(JSON.stringify(tools), serverName, id)
  },

  setStatus(id: string, ok: boolean, message: string | null): void {
    getDb()
      .prepare(`UPDATE mcp_servers SET last_ok = ?, last_message = ?, last_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`)
      .run(ok ? 1 : 0, message, id)
  },

  oauth(id: string): OAuthState {
    const r = getDb().prepare('SELECT oauth_enc FROM mcp_servers WHERE id = ?').get(id) as Row | undefined
    return parse<OAuthState>(decryptSecret(r?.oauth_enc), {})
  },

  setOAuth(id: string, state: OAuthState | null): void {
    getDb().prepare('UPDATE mcp_servers SET oauth_enc = ? WHERE id = ?').run(state && Object.keys(state).length ? encryptSecret(JSON.stringify(state)) : null, id)
  },

  setPolicy(id: string, tool: string, policy: ToolPolicy | null): void {
    const db = getDb()
    if (policy) db.prepare('INSERT INTO mcp_tool_policies(server_id, tool, policy) VALUES (?, ?, ?) ON CONFLICT(server_id, tool) DO UPDATE SET policy = excluded.policy').run(id, tool, policy)
    else db.prepare('DELETE FROM mcp_tool_policies WHERE server_id = ? AND tool = ?').run(id, tool)
  },

  setPermission(id: string, agentId: string, on: boolean): void {
    const db = getDb()
    if (on) db.prepare('INSERT OR IGNORE INTO mcp_permissions(server_id, agent_id) VALUES (?, ?)').run(id, agentId)
    else db.prepare('DELETE FROM mcp_permissions WHERE server_id = ? AND agent_id = ?').run(id, agentId)
  },

  /** Enabled apps an agent may use. */
  forAgent(agentId: string): AppServer[] {
    return this.list().filter((s) => s.enabled && s.agentIds.includes(agentId))
  }
}
