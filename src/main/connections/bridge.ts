import { randomBytes } from 'crypto'
import { app } from 'electron'
import { mkdirSync, unlinkSync, writeFileSync } from 'fs'
import { createServer, type Server } from 'http'
import type { AddressInfo } from 'net'
import { dirname, join } from 'path'
import { getDbPath } from '../db'
import type { AgentCtx } from './service'
import { agentTools, runAgentTool } from '../agentTools'

/**
 * Local bridge between the MCP server process (spawned by Claude Code) and the
 * main process. Bound to 127.0.0.1; every request carries a random per-run token
 * that maps to exactly one agent + run, so a token can never do more than that
 * agent is allowed to do anyway, and it dies when the run ends.
 */

/** How to start the Agentbits MCP server for one run (Claude Code: config file; Codex: `-c` overrides). */
export interface McpServerSpec {
  command: string
  args: string[]
  env: Record<string, string>
}

let server: Server | null = null
/** The listening port, once; concurrent first runs (several agents starting together) share the same promise. */
let listening: Promise<number> | null = null
const tokens = new Map<string, AgentCtx>()

function ensureServer(): Promise<number> {
  listening ??= startServer().catch((e) => {
    listening = null
    throw e
  })
  return listening
}

async function startServer(): Promise<number> {
  server = createServer((req, res) => {
    const reply = (code: number, body: unknown): void => {
      res.writeHead(code, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    const auth = String(req.headers.authorization ?? '')
    const ctx = auth.startsWith('Bearer ') ? tokens.get(auth.slice(7)) : undefined
    if (!ctx) return reply(401, { error: 'invalid token' })
    if (req.method === 'GET' && req.url === '/tools') return reply(200, { tools: agentTools(ctx) })
    if (req.method !== 'POST' || req.url !== '/call') return reply(404, { error: 'not found' })
    let body = ''
    req.on('data', (d) => {
      body += d
      if (body.length > 4_000_000) req.destroy()
    })
    req.on('end', async () => {
      try {
        const { name, args } = JSON.parse(body) as { name: string; args: Record<string, unknown> }
        reply(200, await runAgentTool(ctx, name, args ?? {}))
      } catch (e) {
        reply(400, { text: `ERROR: ${(e as Error).message}`, isError: true })
      }
    })
  })
  const srv = server
  await new Promise<void>((resolve, reject) => {
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      srv.off('error', reject)
      resolve()
    })
  })
  return (srv.address() as AddressInfo).port
}

/** Path of the bundled MCP server script (unpacked from asar in packaged builds). */
function mcpScript(): string {
  return join(__dirname, 'mcp-connections.js').replace('app.asar', 'app.asar.unpacked')
}

/**
 * Creates the per-run MCP config for Claude Code. Returns the config path and a
 * cleanup function that revokes the token and deletes the file.
 */
export async function prepareMcp(ctx: AgentCtx, runKey: string): Promise<{ configPath: string; server: McpServerSpec; dispose: () => void }> {
  const p = await ensureServer()
  const token = randomBytes(24).toString('hex')
  tokens.set(token, ctx)
  const dir = join(dirname(getDbPath()), 'mcp')
  mkdirSync(dir, { recursive: true })
  const configPath = join(dir, `${runKey.replace(/[^\w-]/g, '')}.json`)
  const server: McpServerSpec = {
    command: process.execPath,
    args: [mcpScript()],
    env: { ELECTRON_RUN_AS_NODE: '1', AGENTBITS_BRIDGE: `http://127.0.0.1:${p}`, AGENTBITS_TOKEN: token }
  }
  writeFileSync(configPath, JSON.stringify({ mcpServers: { agentbits: { type: 'stdio', ...server } } }), { mode: 0o600 })
  return {
    configPath,
    server,
    dispose: () => {
      tokens.delete(token)
      try {
        unlinkSync(configPath)
      } catch {
        /* already gone */
      }
    }
  }
}

export function stopBridge(): void {
  tokens.clear()
  server?.close()
  server = null
  listening = null
  void app
}
