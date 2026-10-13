/**
 * Minimal MCP (Model Context Protocol) stdio server, started by Claude Code via
 * `--mcp-config`. It holds no secrets and no logic: every tool call is forwarded
 * to the Agentbits main process over the local bridge with this run's token,
 * where permissions, approvals and auditing happen. Runs under Electron's
 * binary with ELECTRON_RUN_AS_NODE=1.
 */
import { createInterface } from 'readline'

const BRIDGE = process.env.AGENTBITS_BRIDGE ?? ''
const TOKEN = process.env.AGENTBITS_TOKEN ?? ''

type Json = Record<string, unknown>

function send(msg: Json): void {
  process.stdout.write(JSON.stringify(msg) + '\n')
}

async function bridge(path: string, body?: Json): Promise<Json> {
  const res = await fetch(BRIDGE + path, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  })
  if (res.status === 401) throw new Error('The Agentbits session has ended (the run finished or was stopped)')
  return (await res.json()) as Json
}

async function handle(msg: Json): Promise<void> {
  const id = msg.id as string | number | undefined
  const method = msg.method as string
  const params = (msg.params ?? {}) as Json
  if (id === undefined) return // notifications (initialized, cancelled…)
  try {
    if (method === 'initialize') {
      return send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: (params.protocolVersion as string) ?? '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'agentbits', version: '1.0.0' }
        }
      })
    }
    if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} })
    if (method === 'tools/list') {
      const r = await bridge('/tools')
      const tools = (r.tools as { name: string; description: string; inputSchema: Json }[]).map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema
      }))
      return send({ jsonrpc: '2.0', id, result: { tools } })
    }
    if (method === 'tools/call') {
      const r = await bridge('/call', { name: params.name as string, args: (params.arguments ?? {}) as Json })
      const images = Array.isArray(r.images) ? (r.images as { mime: string; data: string }[]) : []
      const content = [{ type: 'text', text: String(r.text ?? '') }, ...images.map((i) => ({ type: 'image', data: i.data, mimeType: i.mime }))]
      return send({ jsonrpc: '2.0', id, result: { content, isError: !!r.isError } })
    }
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } })
  } catch (e) {
    send({ jsonrpc: '2.0', id, error: { code: -32000, message: e instanceof Error ? e.message : String(e) } })
  }
}

createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return
  let msg: Json
  try {
    msg = JSON.parse(line) as Json
  } catch {
    return
  }
  void handle(msg)
})
