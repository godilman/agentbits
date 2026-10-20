import type { Provider, ProviderTestResult, UsageDelta } from '@shared/types'
import { execFile } from 'child_process'
import { toolsFor } from '../core/permissions'
import { spawnLines, which } from './cli'
import { zeroUsage, type ProviderAdapter, type RunContext, type RunResult } from './types'
import { t } from '../i18n'
import { agentEnv } from '@shared/settingsRules'
import { settingsRepo } from '../db/repos'

/* eslint-disable @typescript-eslint/no-explicit-any */

async function resolveBin(provider: Provider): Promise<string> {
  const bin = provider.cliPath || (await which('claude'))
  if (!bin) throw new Error(t('orchestrator:providers.claudeNotFound'))
  return bin
}

/** `claude --version` per binary (cached): newer CLIs get the stricter isolation flags. */
const versions = new Map<string, Promise<number[] | null>>()
function cliVersion(bin: string): Promise<number[] | null> {
  let v = versions.get(bin)
  if (!v) {
    v = new Promise((resolve) =>
      execFile(bin, ['--version'], { timeout: 15000, windowsHide: true, shell: /\.(cmd|bat)$/i.test(bin) }, (e, so) => {
        const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(so ?? ''))
        resolve(e || !m ? null : [Number(m[1]), Number(m[2]), Number(m[3])])
      })
    )
    versions.set(bin, v)
  }
  return v
}
/**
 * Does this CLI stream text as it is written (`--include-partial-messages`)? Read once from `claude --help`, before any
 * run: a CLI without it keeps the per-message text, and nothing is ever started twice (a retry could repeat a tool).
 */
const partialSupport = new Map<string, Promise<boolean>>()
function supportsPartial(bin: string): Promise<boolean> {
  let v = partialSupport.get(bin)
  if (!v) {
    v = new Promise((resolve) =>
      execFile(bin, ['--help'], { timeout: 15000, windowsHide: true, shell: /\.(cmd|bat)$/i.test(bin) }, (e, so) =>
        resolve(!e && String(so ?? '').includes('--include-partial-messages'))
      )
    )
    partialSupport.set(bin, v)
  }
  return v
}

const atLeastVersion = (v: number[] | null, want: number[]): boolean => {
  if (!v) return false
  for (let i = 0; i < 3; i++) if (v[i] !== want[i]) return v[i] > want[i]
  return true
}

/**
 * Settings / hooks isolation. `--restricted` (Claude Code 2.1.248+) loads only managed settings, keeps the file
 * tools inside the working directories and leaves out shell tools unless `--tools` names them. Older CLIs get
 * `--setting-sources user`, so a repository's `.claude/settings*.json` (hooks, allow rules) is not loaded.
 */
export async function isolationArgs(bin: string): Promise<string[]> {
  return atLeastVersion(await cliVersion(bin), [2, 1, 248]) ? ['--restricted'] : ['--setting-sources', 'user']
}

/**
 * Claude Code adapter — runs `claude -p` headless with stream-json output.
 * The whole prompt (persona + memory + task) is sent on stdin so no long text
 * ever goes through command-line quoting. Tool access is derived from the
 * agent's permission matrix.
 */
export const claudeCliAdapter: ProviderAdapter = {
  async run(ctx: RunContext): Promise<RunResult> {
    const bin = await resolveBin(ctx.provider)
    const tools = ctx.mode === 'task' ? toolsFor(ctx.permissions) : []
    // `--tools` decides what exists at all. File tools are NOT pre-approved: in
    // acceptEdits mode Claude Code only auto-accepts edits inside the working
    // directories (cwd + --add-dir); anything outside needs a prompt, which a
    // headless run denies. Only shell / network tools are pre-approved.
    const autoApproved: string[] = tools.filter((t) => t === 'Bash' || t === 'WebFetch' || t === 'WebSearch')
    const args = ['-p', '--output-format', 'stream-json', '--verbose', ...(await isolationArgs(bin)), '--tools', tools.join(',')]
    if (ctx.mcpConfigPath) {
      // Only the Agentbits connection server: project .mcp.json files are ignored (--strict-mcp-config),
      // so a repository cannot hand the agent its own database / server access. The server checks
      // permissions itself, so its tools are pre-approved.
      args.push('--mcp-config', ctx.mcpConfigPath, '--strict-mcp-config')
      autoApproved.push('mcp__agentbits')
    }
    if (autoApproved.length) args.push('--allowedTools', autoApproved.join(','))
    args.push('--permission-mode', ctx.permissions.fsWrite && ctx.mode === 'task' ? 'acceptEdits' : 'default')
    if (ctx.model) args.push('--model', ctx.model)
    // Chat replies appear while they are written (tasks keep whole messages in the transcript).
    const partial = ctx.mode === 'chat' && (await supportsPartial(bin))
    if (partial) args.push('--include-partial-messages')
    const textBlocks = new Set<number>()
    for (const p of ctx.permissions.allowedPaths) args.push('--add-dir', p)
    // A direct user instruction continues the same conversation (documented `--resume <id>`).
    const resuming = !!ctx.resumeSessionId
    if (resuming) args.push('--resume', ctx.resumeSessionId!)

    const env: Record<string, string | undefined> = {}
    if (ctx.apiKey) env.ANTHROPIC_API_KEY = ctx.apiKey

    let text = ''
    let tokensIn = 0
    let tokensOut = 0
    let costUsd = 0
    // File-tool calls waiting for their result (tool_use id → path).
    const writes = new Map<string, string>()
    let toolUses = 0
    let resultError: string | null = null
    let sessionId: string | null = ctx.resumeSessionId ?? null
    // Usage is reported per API message; the same message can arrive in several events.
    const perMessage = new Map<string, UsageDelta>()
    const report = (d: UsageDelta): void => {
      tokensIn += d.input + d.cacheRead + d.cacheWrite
      tokensOut += d.output
      ctx.onUsage?.(d)
    }
    const setSession = (id: unknown): void => {
      if (typeof id === 'string' && id && id !== sessionId) {
        sessionId = id
        ctx.onSession?.(id)
      }
    }

    ctx.onLog('debug', `$ claude ${args.join(' ')}`)
    const { code, stderr } = await spawnLines({
      bin,
      args,
      cwd: ctx.cwd,
      // Only what a CLI needs plus the user's extra names: no other secrets of the machine (security review #03).
      inherit: agentEnv(process.env, 'claude', settingsRepo.get().cliEnvPassthrough),
      env,
      signal: ctx.signal,
      // On resume the conversation already has the system/task context; send only the new turn.
      stdin: resuming ? ctx.prompt : `${ctx.system}\n\n---\n\n${ctx.prompt}`,
      onStderr: (l) => ctx.onLog('warn', l),
      onLine: async (line) => {
        await ctx.checkpoint()
        let ev: any
        try {
          ev = JSON.parse(line)
        } catch {
          if (line.trim()) ctx.onLog('output', line)
          return
        }
        if (ev.session_id) setSession(ev.session_id)
        if (ev.type === 'stream_event') {
          const se = ev.event ?? {}
          if (se.type === 'message_start') textBlocks.clear()
          else if (se.type === 'content_block_start' && se.content_block?.type === 'text') textBlocks.add(se.index)
          else if (se.type === 'content_block_delta' && se.delta?.type === 'text_delta' && se.delta.text) ctx.onText(se.delta.text)
          else if (se.type === 'content_block_stop' && textBlocks.has(se.index)) ctx.onText('\n')
        } else if (ev.type === 'assistant') {
          const msg = ev.message ?? {}
          for (const block of msg.content ?? []) {
            if (block.type === 'text' && block.text) {
              if (!partial) ctx.onText(block.text + '\n')
            } else if (block.type === 'tool_use') {
              toolUses++
              const detail = block.input?.file_path ?? block.input?.command ?? block.input?.sql ?? block.input?.pattern ?? block.input?.url ?? block.input?.connection ?? ''
              ctx.onLog('tool', `${block.name} ${String(detail).slice(0, 240)}`, { toolUseId: block.id })
              // A write is reported once its result says it worked (an attempt that fails or is refused wrote nothing).
              if (/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(block.name)) {
                const written = block.input?.file_path ?? block.input?.notebook_path
                if (typeof written === 'string' && block.id) writes.set(block.id, written)
              }
              ctx.onProgress(Math.min(90, 10 + toolUses * 6))
            }
          }
          const u = msg.usage
          if (u && msg.id) {
            const next: UsageDelta = {
              input: u.input_tokens ?? 0,
              output: u.output_tokens ?? 0,
              cacheRead: u.cache_read_input_tokens ?? 0,
              cacheWrite: u.cache_creation_input_tokens ?? 0,
              costUsd: 0
            }
            const prev = perMessage.get(msg.id) ?? zeroUsage()
            perMessage.set(msg.id, next)
            const delta: UsageDelta = {
              input: Math.max(0, next.input - prev.input),
              output: Math.max(0, next.output - prev.output),
              cacheRead: Math.max(0, next.cacheRead - prev.cacheRead),
              cacheWrite: Math.max(0, next.cacheWrite - prev.cacheWrite),
              costUsd: 0
            }
            if (delta.input || delta.output || delta.cacheRead || delta.cacheWrite) report(delta)
          }
        } else if (ev.type === 'user') {
          // Tool results: show a short excerpt so commands and their outcome are visible.
          for (const block of ev.message?.content ?? []) {
            if (block?.type !== 'tool_result') continue
            const body = Array.isArray(block.content)
              ? block.content.map((c: any) => (typeof c?.text === 'string' ? c.text : '')).join('\n')
              : String(block.content ?? '')
            const first = body.trim().split('\n').slice(0, 3).join(' ⏎ ').slice(0, 300)
            // Always recorded (also without output): the result of every tool call is evidence (`core/evidence.ts`).
            ctx.onLog(block.is_error ? 'error' : 'debug', `↳ ${first || (block.is_error ? '✗' : '✓')}`, { toolUseId: block.tool_use_id })
            const written = writes.get(block.tool_use_id)
            if (written && !block.is_error) ctx.onFileWritten?.(written)
          }
        } else if (ev.type === 'result') {
          text = ev.result ?? text
          // Cost is cumulative for a resumed conversation; count only what is new.
          const totalCost = Number(ev.total_cost_usd ?? 0)
          costUsd = Math.max(0, totalCost - (resuming ? ctx.priorSessionCostUsd ?? 0 : 0))
          if (!perMessage.size && ev.usage) {
            report({
              input: ev.usage.input_tokens ?? 0,
              output: ev.usage.output_tokens ?? 0,
              cacheRead: ev.usage.cache_read_input_tokens ?? 0,
              cacheWrite: ev.usage.cache_creation_input_tokens ?? 0,
              costUsd: 0
            })
          }
          if (costUsd) ctx.onUsage?.({ ...zeroUsage(), costUsd })
          for (const d of ev.permission_denials ?? []) {
            const target = d.tool_input?.file_path ?? d.tool_input?.command ?? d.tool_input?.url ?? ''
            ctx.onLog('warn', t('orchestrator:providers.permissionDenied', { tool: d.tool_name, target: String(target).slice(0, 160) }), {
              denied: { tool: d.tool_name, target: String(target).slice(0, 160) }
            })
          }
          if (ev.is_error) resultError = ev.result || ev.subtype || t('orchestrator:providers.claudeError')
        } else if (ev.type === 'system' && ev.subtype === 'init') {
          ctx.onLog(
            'info',
            resuming
              ? t('orchestrator:providers.claudeResumed', { id: String(sessionId).slice(0, 8) })
              : t('orchestrator:providers.claudeStarted', { model: ev.model ?? ctx.model })
          )
        }
      }
    })
    if (resultError) throw new Error(resultError)
    // A non-zero exit is a failure even when some output arrived (it is kept in the transcript).
    if (code !== 0) throw new Error(t('orchestrator:providers.exitCode', { cli: 'claude', code: String(code), stderr: stderr.slice(-500) }))
    return { text, tokensIn, tokensOut, costUsd, sessionId }
  },

  async test(provider: Provider): Promise<ProviderTestResult> {
    try {
      const bin = await resolveBin(provider)
      const out = await new Promise<string>((resolve, reject) =>
        execFile(bin, ['--version'], { timeout: 15000, windowsHide: true, shell: /\.(cmd|bat)$/i.test(bin) }, (e, so) =>
          e ? reject(e) : resolve(so.trim())
        )
      )
      // `claude auth status` exits 1 when logged out (older CLIs may not have it).
      const auth = await new Promise<{ code: number | null; out: string }>((resolve) =>
        execFile(bin, ['auth', 'status'], { timeout: 15000, windowsHide: true, shell: /\.(cmd|bat)$/i.test(bin) }, (e, so) =>
          resolve({ code: e ? ((e as { code?: number }).code ?? 1) : 0, out: so })
        )
      )
      if (auth.code !== 0) {
        return { ok: false, message: t('orchestrator:providers.claudeNotLoggedIn', { version: out }) }
      }
      return { ok: true, message: t('orchestrator:providers.claudeReady', { version: out }) }
    } catch (e) {
      return { ok: false, message: (e as Error).message }
    }
  }
}
