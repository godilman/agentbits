import { app, shell } from 'electron'
import { readFileSync } from 'fs'
import { createServer, type Server } from 'http'
import { dirname, join } from 'path'
import type { AddressInfo } from 'net'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { UnauthorizedError, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import type { AppServer, AppTool } from '@shared/apps'
import { t } from '../i18n'
import { appsRepo, type OAuthState } from './repo'

/**
 * MCP client side of "Apps": one connection per server, opened on demand (agent call, test, sign-in), reused while in
 * use and closed after 10 idle minutes, on edit/delete and on quit. Local servers are spawned with the user's
 * command (cross-platform via the SDK's cross-spawn); remote ones use Streamable HTTP with an SSE fallback and
 * optional OAuth (browser sign-in to a loopback callback). Nothing here decides permissions — see service.ts.
 */

interface Live {
  client: Client
  close: () => Promise<void>
  lastUsed: number
  stderr: string[]
}

const live = new Map<string, Live>()
const connecting = new Map<string, Promise<Live>>()
/** Bumped by closeApp: a connection that finishes opening after its app was closed is closed again, not kept. */
const epoch = new Map<string, number>()
let shuttingDown = false

/**
 * The MCP SDK actually installed (not what package.json asks for): 1.30.x and older send stored OAuth credentials to
 * whatever authorization server an MCP server names (GHSA-6qxp-vccf-f47h). OAuth is refused on those.
 */
const MIN_SDK = [1, 31, 0]
let sdkVersionCache: number[] | null | undefined
export function installedSdkVersion(): number[] | null {
  if (sdkVersionCache !== undefined) return sdkVersionCache
  try {
    // …/sdk/dist/cjs/client/index.js → …/sdk/package.json
    const entry = require.resolve('@modelcontextprotocol/sdk/client/index.js')
    const pkg = JSON.parse(readFileSync(join(dirname(entry), '..', '..', '..', 'package.json'), 'utf8')) as { name?: string; version?: string }
    const m = pkg.name === '@modelcontextprotocol/sdk' ? /^(\d+)\.(\d+)\.(\d+)/.exec(pkg.version ?? '') : null
    sdkVersionCache = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
  } catch {
    sdkVersionCache = null
  }
  return sdkVersionCache
}
function sdkPatched(): boolean {
  const v = installedSdkVersion()
  if (!v) return false
  for (let i = 0; i < 3; i++) if (v[i] !== MIN_SDK[i]) return v[i] > MIN_SDK[i]
  return true
}

/**
 * Removes this app's secret values (environment, headers, OAuth tokens / client secret) from text that leaves the
 * client: server stderr and error messages end up in the UI, the audit log and agent transcripts.
 */
export function redactApp(serverId: string, text: string): string {
  if (!text) return text
  const { env, headers } = appsRepo.secrets(serverId)
  const o = appsRepo.oauth(serverId) as OAuthState & { tokens?: Record<string, unknown>; client?: Record<string, unknown> }
  const values = [
    ...Object.values(env),
    ...Object.values(headers),
    ...Object.values(headers).map((h) => h.replace(/^(Bearer|Basic|Token)\s+/i, '')),
    String(o.tokens?.access_token ?? ''),
    String(o.tokens?.refresh_token ?? ''),
    String(o.client?.client_secret ?? '')
  ].filter((v) => v && v.length >= 4)
  let out = text
  for (const v of values.sort((a, b) => b.length - a.length)) out = out.split(v).join('••••')
  return out
}
const CONNECT_TIMEOUT = 30_000
export const CALL_TIMEOUT = 120_000
const IDLE_MS = 10 * 60_000
let reaper: NodeJS.Timeout | null = null

export class NeedsSignInError extends Error {}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      }
    )
  })
}

/* ───────────────────────────── OAuth ───────────────────────────── */

const CALLBACK_PORT = 33418

class AppOAuthProvider implements OAuthClientProvider {
  constructor(
    private serverId: string,
    private redirect: string,
    private interactive: boolean
  ) {}
  private get stored(): OAuthState {
    return appsRepo.oauth(this.serverId)
  }
  private patch(p: Partial<OAuthState>): void {
    appsRepo.setOAuth(this.serverId, { ...this.stored, ...p })
  }
  get redirectUrl(): string {
    return this.redirect
  }
  get clientMetadata() {
    return {
      client_name: 'Agentbits',
      redirect_uris: [this.redirect],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none'
    }
  }
  clientInformation() {
    const s = this.stored
    // A registration made for another callback address can't be reused.
    return s.redirectUrl === this.redirect ? (s.client as never) : undefined
  }
  saveClientInformation(info: unknown): void {
    this.patch({ client: info as Record<string, unknown>, redirectUrl: this.redirect })
  }
  tokens() {
    return this.stored.tokens as never
  }
  saveTokens(tokens: unknown): void {
    this.patch({ tokens: tokens as Record<string, unknown> })
  }
  redirectToAuthorization(url: URL): void {
    // Only an explicit "Sign in" opens the browser; an agent's call never does.
    if (!this.interactive) throw new NeedsSignInError(t('main:apps.errors.needsSignIn'))
    if (!/^https?:$/.test(url.protocol)) throw new Error(t('main:apps.errors.badAuthUrl'))
    void shell.openExternal(url.toString())
  }
  saveCodeVerifier(v: string): void {
    this.patch({ verifier: v })
  }
  codeVerifier(): string {
    return this.stored.verifier ?? ''
  }
  invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): void {
    const s = { ...this.stored }
    if (scope === 'all' || scope === 'client') delete s.client
    if (scope === 'all' || scope === 'tokens') delete s.tokens
    if (scope === 'all' || scope === 'verifier') delete s.verifier
    appsRepo.setOAuth(this.serverId, s)
  }
}

/** Loopback server receiving the OAuth redirect; resolves with the code. */
async function callbackServer(): Promise<{ url: string; code: Promise<string>; close: () => void }> {
  let resolveCode!: (c: string) => void
  let rejectCode!: (e: Error) => void
  const code = new Promise<string>((res, rej) => {
    resolveCode = res
    rejectCode = rej
  })
  const server: Server = createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (u.pathname !== '/callback') {
      res.writeHead(404).end()
      return
    }
    const c = u.searchParams.get('code')
    const err = u.searchParams.get('error')
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(`<!doctype html><meta charset="utf-8"><title>Agentbits</title><body style="font-family:system-ui;background:#09090b;color:#e4e4e7;display:grid;place-items:center;height:100vh"><p>${c ? t('main:apps.oauth.done') : t('main:apps.oauth.failed')}</p>`)
    if (c) resolveCode(c)
    else rejectCode(new Error(t('main:apps.errors.signInFailed', { error: err ?? '?' })))
  })
  const listen = (port: number): Promise<void> =>
    new Promise((res, rej) => {
      server.once('error', rej)
      server.listen(port, '127.0.0.1', () => {
        server.off('error', rej)
        res()
      })
    })
  try {
    await listen(CALLBACK_PORT)
  } catch {
    await listen(0) // the fixed port is taken: a new client registration will be made for this one
  }
  const port = (server.address() as AddressInfo).port
  const timer = setTimeout(() => rejectCode(new Error(t('main:apps.errors.signInTimeout'))), 5 * 60_000)
  return {
    url: `http://127.0.0.1:${port}/callback`,
    code,
    close: () => {
      clearTimeout(timer)
      server.close()
    }
  }
}

/* ───────────────────────────── connections ───────────────────────────── */

function httpTransports(server: AppServer, provider: OAuthClientProvider | undefined): { streamable: () => StreamableHTTPClientTransport; sse: () => SSEClientTransport } {
  const { headers } = appsRepo.secrets(server.id)
  const url = new URL(server.url)
  const requestInit = { headers }
  return {
    streamable: () => new StreamableHTTPClientTransport(url, { requestInit, authProvider: provider }),
    sse: () => new SSEClientTransport(url, { requestInit, authProvider: provider })
  }
}

async function open(server: AppServer, opts: { redirect?: string; interactive?: boolean } = {}): Promise<{ live: Live; transport?: StreamableHTTPClientTransport }> {
  const client = new Client({ name: 'agentbits', version: app.getVersion() }, { capabilities: {} })
  const stderr: string[] = []
  if (server.transport === 'stdio') {
    if (!server.command) throw new Error(t('main:apps.errors.noCommand'))
    const { env } = appsRepo.secrets(server.id)
    const transport = new StdioClientTransport({
      command: server.command,
      args: server.args,
      env: { ...getDefaultEnvironment(), ...env },
      cwd: server.cwd || undefined,
      stderr: 'pipe'
    })
    transport.stderr?.on('data', (d: Buffer) => {
      stderr.push(d.toString())
      while (stderr.join('').length > 4000) stderr.shift()
    })
    await withTimeout(client.connect(transport), CONNECT_TIMEOUT, t('main:apps.errors.connectTimeout'))
    return { live: { client, close: () => client.close(), lastUsed: Date.now(), stderr } }
  }
  if (!server.url) throw new Error(t('main:apps.errors.noUrl'))
  if (server.oauth && !sdkPatched()) throw new Error(t('main:apps.errors.sdkOutdated', { version: installedSdkVersion()?.join('.') ?? '?' }))
  const provider = server.oauth ? new AppOAuthProvider(server.id, opts.redirect ?? appsRepo.oauth(server.id).redirectUrl ?? `http://127.0.0.1:${CALLBACK_PORT}/callback`, !!opts.interactive) : undefined
  const tr = httpTransports(server, provider)
  const streamable = tr.streamable()
  try {
    await withTimeout(client.connect(streamable), CONNECT_TIMEOUT, t('main:apps.errors.connectTimeout'))
    return { live: { client, close: () => client.close(), lastUsed: Date.now(), stderr }, transport: streamable }
  } catch (e) {
    if (e instanceof UnauthorizedError || e instanceof NeedsSignInError) throw Object.assign(e, { transport: streamable })
    // Older servers only speak HTTP+SSE.
    if (!/\b(404|405)\b/.test(String((e as Error).message))) throw e
    const client2 = new Client({ name: 'agentbits', version: app.getVersion() }, { capabilities: {} })
    await withTimeout(client2.connect(tr.sse()), CONNECT_TIMEOUT, t('main:apps.errors.connectTimeout'))
    return { live: { client: client2, close: () => client2.close(), lastUsed: Date.now(), stderr } }
  }
}

function startReaper(): void {
  if (reaper) return
  reaper = setInterval(() => {
    for (const [id, l] of live) {
      if (Date.now() - l.lastUsed > IDLE_MS) void closeApp(id)
    }
  }, 60_000)
  reaper.unref?.()
}

/** A connected client for the server (connects on first use). */
export async function clientFor(serverId: string): Promise<Live> {
  if (shuttingDown) throw new Error(t('main:apps.errors.shuttingDown'))
  const cur = live.get(serverId)
  if (cur) {
    cur.lastUsed = Date.now()
    return cur
  }
  const pending = connecting.get(serverId)
  if (pending) return pending
  const server = appsRepo.get(serverId)
  if (!server) throw new Error(t('main:apps.errors.notFound'))
  const started = epoch.get(serverId) ?? 0
  const p = open(server)
    .then(async ({ live: l }) => {
      // Closed (edited, deleted, app quitting) while this was opening: don't keep a stray process / session.
      if (shuttingDown || (epoch.get(serverId) ?? 0) !== started) {
        await l.close().catch(() => undefined)
        throw new Error(t('main:apps.errors.shuttingDown'))
      }
      live.set(serverId, l)
      startReaper()
      return l
    })
    .catch((e) => {
      throw normalizeError(e)
    })
    .finally(() => connecting.delete(serverId))
  connecting.set(serverId, p)
  return p
}

function normalizeError(e: unknown): Error {
  if (e instanceof NeedsSignInError) return e
  if (e instanceof UnauthorizedError) return new NeedsSignInError(t('main:apps.errors.needsSignIn'))
  const err = e as NodeJS.ErrnoException
  if (err?.code === 'ENOENT') return new Error(t('main:apps.errors.commandNotFound', { command: err.path ?? '' }))
  return e instanceof Error ? e : new Error(String(e))
}

export async function closeApp(serverId: string): Promise<void> {
  epoch.set(serverId, (epoch.get(serverId) ?? 0) + 1)
  const l = live.get(serverId)
  live.delete(serverId)
  if (l) await l.close().catch(() => undefined)
  // One that is still opening closes itself when it finishes (epoch changed); wait for that.
  const pending = connecting.get(serverId)
  if (pending) await pending.catch(() => undefined)
}

/** Quit: no new connections, close the open ones and the ones still opening. */
export async function closeAllApps(): Promise<void> {
  shuttingDown = true
  if (reaper) clearInterval(reaper)
  reaper = null
  await Promise.all([...new Set([...live.keys(), ...connecting.keys()])].map((id) => closeApp(id)))
}

function toAppTool(tl: { name: string; title?: string; description?: string; inputSchema?: unknown; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; title?: string } }): AppTool {
  return {
    name: tl.name,
    title: tl.title ?? tl.annotations?.title,
    description: (tl.description ?? '').slice(0, 2000),
    inputSchema: (tl.inputSchema as Record<string, unknown>) ?? { type: 'object', properties: {} },
    readOnly: tl.annotations?.readOnlyHint,
    destructive: tl.annotations?.destructiveHint
  }
}

/** Lists all tools (follows pagination) and stores them with the server. */
export async function refreshTools(serverId: string): Promise<AppTool[]> {
  const l = await clientFor(serverId)
  const tools: AppTool[] = []
  let cursor: string | undefined
  for (let i = 0; i < 20; i++) {
    const r = await l.client.listTools(cursor ? { cursor } : undefined)
    tools.push(...r.tools.map(toAppTool))
    cursor = r.nextCursor
    if (!cursor) break
  }
  const info = l.client.getServerVersion()
  appsRepo.setTools(serverId, tools, info ? `${info.name}${info.version ? ' ' + info.version : ''}` : null)
  return tools
}

export async function callAppTool(serverId: string, tool: string, args: Record<string, unknown>) {
  const l = await clientFor(serverId)
  l.lastUsed = Date.now()
  try {
    return await l.client.callTool({ name: tool, arguments: args }, undefined, { timeout: CALL_TIMEOUT })
  } catch (e) {
    // A dead process / dropped session: reconnect once on the next call.
    if (/closed|not connected|EPIPE|ECONNRESET/i.test(String((e as Error).message))) await closeApp(serverId)
    throw normalizeError(e)
  } finally {
    l.lastUsed = Date.now()
  }
}

/** Last lines the server wrote to stderr, with the app's secrets removed (shown to the user, never to agents). */
export function stderrTail(serverId: string): string {
  return redactApp(serverId, (live.get(serverId)?.stderr.join('') ?? '').trim().slice(-600))
}

/** Browser sign-in for an OAuth server: opens the provider's page, waits for the redirect, stores the tokens. */
export async function signIn(serverId: string): Promise<void> {
  const server = appsRepo.get(serverId)
  if (!server) throw new Error(t('main:apps.errors.notFound'))
  await closeApp(serverId)
  const cb = await callbackServer()
  try {
    try {
      const { live: l } = await open(server, { redirect: cb.url, interactive: true })
      // Already authorized (valid tokens).
      live.set(serverId, l)
      return
    } catch (e) {
      const transport = (e as { transport?: StreamableHTTPClientTransport }).transport
      if (!(e instanceof UnauthorizedError) || !transport) throw normalizeError(e)
      const code = await cb.code
      await transport.finishAuth(code)
    }
    const { live: l } = await open(appsRepo.get(serverId)!, { redirect: cb.url, interactive: false })
    live.set(serverId, l)
    startReaper()
  } finally {
    cb.close()
  }
}

export async function signOut(serverId: string): Promise<void> {
  await closeApp(serverId)
  appsRepo.setOAuth(serverId, null)
}
