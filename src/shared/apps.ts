/**
 * Apps (MCP servers) the user connects — like Claude Desktop / ChatGPT connectors: a local program (stdio) or a
 * remote server (Streamable HTTP / SSE, optionally with OAuth sign-in). Agents use their tools only when granted,
 * per tool policy (auto / ask the user / blocked), always through the main process (audit log, approvals).
 */

export type AppTransport = 'stdio' | 'http'
export type ToolPolicy = 'auto' | 'approve' | 'block'

export interface AppTool {
  name: string
  title?: string
  description: string
  inputSchema: Record<string, unknown>
  /** MCP tool annotations as reported by the server (hints, not guarantees). */
  readOnly?: boolean
  destructive?: boolean
}

export interface AppServer {
  id: string
  name: string
  description: string
  transport: AppTransport
  command: string
  args: string[]
  cwd: string
  /** Names of the environment variables set for the program (values are secret, never sent to the UI). */
  envKeys: string[]
  url: string
  /** Names of extra HTTP headers (values are secret). */
  headerKeys: string[]
  /** Remote server signs in with OAuth in the browser. */
  oauth: boolean
  signedIn: boolean
  enabled: boolean
  tools: AppTool[]
  toolsAt: string | null
  /** Per-tool overrides; tools without one use the default (read-only → auto, otherwise approve). */
  policies: Record<string, ToolPolicy>
  /** Agents allowed to use this app. */
  agentIds: string[]
  lastOk: boolean | null
  lastMessage: string | null
  lastAt: string | null
  serverName: string | null
  createdAt: string
  updatedAt: string
}

/** Key + value; a missing `value` keeps the stored one (secrets are write-only). */
export interface SecretPair {
  key: string
  value?: string
}

export interface AppServerInput {
  name?: string
  description?: string
  transport?: AppTransport
  command?: string
  args?: string[]
  cwd?: string
  /** Full list of variables; keys not listed are removed. */
  env?: SecretPair[]
  url?: string
  headers?: SecretPair[]
  oauth?: boolean
  enabled?: boolean
}

/** A server definition found in a pasted config / Claude Desktop's config, not saved yet. */
export interface AppImportCandidate {
  name: string
  transport: AppTransport
  command: string
  args: string[]
  env: { key: string; value: string }[]
  url: string
  headers: { key: string; value: string }[]
  exists: boolean
}

export interface AppTestResult {
  ok: boolean
  message: string
  tools: number
  /** The server wants an OAuth sign-in first. */
  needsSignIn?: boolean
}

export function defaultPolicy(tool: AppTool): ToolPolicy {
  return tool.readOnly === true && tool.destructive !== true ? 'auto' : 'approve'
}

export function policyOf(server: Pick<AppServer, 'policies'>, tool: AppTool): ToolPolicy {
  return server.policies[tool.name] ?? defaultPolicy(tool)
}

/** Name an agent sees for a tool: `app_<server>__<tool>`, [A-Za-z0-9_-], ≤ 64 characters. */
export function agentToolName(serverName: string, tool: string): string {
  // Accents dropped first (s-cedilla → s, e-acute → e, dotless i → i) so names stay readable.
  const clean = (s: string): string =>
    s
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\u0131/g, 'i')
      .replace(/[^A-Za-z0-9_-]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
  const server = clean(serverName.toLowerCase()).slice(0, 20) || 'app'
  let name = `app_${server}__${clean(tool)}`
  if (name.length > 64) {
    let h = 0
    for (const c of tool) h = (h * 31 + c.charCodeAt(0)) >>> 0
    name = name.slice(0, 57) + '_' + h.toString(36).slice(0, 6)
  }
  return name
}

/**
 * Reads MCP server definitions in the common JSON shape (Claude Desktop's claude_desktop_config.json, Cursor,
 * README snippets): `{ "mcpServers": { "name": { "command", "args", "env" } | { "url" / "serverUrl", "headers" } } }`,
 * also accepting the inner object alone or `{ "servers": … }` (VS Code). Throws on invalid JSON.
 */
export function parseMcpConfig(text: string): Omit<AppImportCandidate, 'exists'>[] {
  const trimmed = text.trim()
  // A bare `"name": { … }` pair copied from a README.
  const json = /^"[^"]+"\s*:/.test(trimmed) ? `{${trimmed.replace(/,\s*$/, '')}}` : trimmed
  const data = JSON.parse(json) as Record<string, unknown>
  const servers = (data.mcpServers ?? data.servers ?? data['mcp-servers'] ?? data) as Record<string, unknown>
  const out: Omit<AppImportCandidate, 'exists'>[] = []
  for (const [name, raw] of Object.entries(servers ?? {})) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const s = raw as Record<string, unknown>
    const pairs = (o: unknown): { key: string; value: string }[] =>
      o && typeof o === 'object' ? Object.entries(o as Record<string, unknown>).map(([key, value]) => ({ key, value: String(value ?? '') })) : []
    const url = typeof s.url === 'string' ? s.url : typeof s.serverUrl === 'string' ? s.serverUrl : ''
    if (url) {
      out.push({ name, transport: 'http', command: '', args: [], env: [], url, headers: pairs(s.headers) })
    } else if (typeof s.command === 'string' && s.command.trim()) {
      out.push({
        name,
        transport: 'stdio',
        command: s.command.trim(),
        args: Array.isArray(s.args) ? s.args.map((a) => String(a)) : [],
        env: pairs(s.env),
        url: '',
        headers: []
      })
    }
  }
  return out
}
