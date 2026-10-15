import type { Agent, AgentPermissions, LogLevel, Provider, ProviderTestResult, UsageDelta } from '@shared/types'
import { t } from '../i18n'

export interface RunContext {
  mode: 'task' | 'chat' | 'review'
  agent: Agent
  permissions: AgentPermissions
  provider: Provider
  model: string
  apiKey: string | null
  cwd: string
  /** Project members, when known (lets the demo provider assign planned tasks realistically). */
  team?: Agent[]
  system: string
  prompt: string
  /**
   * Earlier turns of the same conversation (API / demo providers), used to continue a
   * task after a direct user instruction: [user: original prompt, assistant: partial output].
   */
  history?: { role: 'user' | 'assistant'; content: string }[]
  /** Claude Code: continue this CLI conversation (`--resume`) instead of starting a new one. */
  resumeSessionId?: string | null
  /** Claude Code reports cost cumulatively for a resumed conversation; this is what was already counted. */
  priorSessionCostUsd?: number
  signal: AbortSignal
  onText: (chunk: string) => void
  onLog: (level: LogLevel, message: string, meta?: Record<string, unknown>) => void
  /** Token usage as soon as the provider reports it (may be called several times per run). */
  onUsage?: (delta: UsageDelta) => void
  /** Claude Code conversation id (for `--resume`). */
  onSession?: (sessionId: string) => void
  /** A file the agent wrote (as the provider names it; may be absolute) — team awareness / conflict warnings. */
  onFileWritten?: (path: string) => void
  /** Connection tools the agent may call (API providers: native function calling; demo: simulated use). */
  tools?: { name: string; description: string; inputSchema: Record<string, unknown> }[]
  callTool?: (name: string, args: Record<string, unknown>) => Promise<{ text: string; isError: boolean; images?: { mime: string; data: string }[] }>
  /** Images / scanned PDFs for the first user turn (API providers with vision). */
  attachments?: { name: string; mime: string; kind: 'image' | 'pdf'; data: string }[]
  /** Image files for CLIs that take them as arguments (Codex `--image`). */
  imagePaths?: string[]
  /** Claude Code: MCP config serving the same tools (`--mcp-config … --strict-mcp-config`). */
  mcpConfigPath?: string | null
  /** Same server for CLIs configured on the command line (Codex `-c mcp_servers.agentbits.*`). */
  mcpServer?: { command: string; args: string[]; env: Record<string, string> } | null
  onProgress: (pct: number) => void
  /** Resolves immediately unless the run is paused; then waits until resumed. */
  checkpoint: () => Promise<void>
}

export interface RunResult {
  text: string
  tokensIn: number
  tokensOut: number
  costUsd: number
  /** Claude Code conversation id, when known. */
  sessionId?: string | null
}

export const zeroUsage = (): UsageDelta => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 })

export interface ProviderAdapter {
  run(ctx: RunContext): Promise<RunResult>
  test(provider: Provider, apiKey: string | null): Promise<ProviderTestResult>
}

export class AbortedError extends Error {
  constructor() {
    super(t('orchestrator:runs.stopped'))
    this.name = 'AbortedError'
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AbortedError())
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(t)
      reject(new AbortedError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** Reads a fetch body as Server-Sent Events, yielding the JSON payload of each `data:` line. */
export async function* readSse(res: Response, signal: AbortSignal): AsyncGenerator<Record<string, unknown>> {
  if (!res.body) return
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  try {
    while (true) {
      if (signal.aborted) throw new AbortedError()
      const { value, done } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let idx: number
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim()
        buf = buf.slice(idx + 1)
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (!data || data === '[DONE]') continue
        try {
          yield JSON.parse(data)
        } catch {
          /* ignore malformed keep-alive lines */
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}
