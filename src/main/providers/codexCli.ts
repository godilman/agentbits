import type { Provider, ProviderTestResult } from '@shared/types'
import { execFile } from 'child_process'
import { spawnLines, which } from './cli'
import type { ProviderAdapter, RunContext, RunResult } from './types'
import { t } from '../i18n'
import { agentEnv } from '@shared/settingsRules'
import { settingsRepo } from '../db/repos'

async function resolveBin(provider: Provider): Promise<string> {
  const bin = provider.cliPath || (await which('codex'))
  if (!bin) throw new Error(t('orchestrator:providers.codexNotFound'))
  return bin
}

/** Codex has no resumable headless session here; earlier turns are replayed as text. */
function historyText(history: RunContext['history']): string {
  if (!history?.length) return ''
  return (
    history.map((h) => `### ${h.role === 'user' ? 'Earlier request' : 'Your earlier (interrupted) output'}\n${h.content}`).join('\n\n') +
    '\n\n### New instruction from the user\n'
  )
}

/** OpenAI Codex CLI adapter — `codex exec` with a sandbox derived from permissions. */
export const codexCliAdapter: ProviderAdapter = {
  async run(ctx: RunContext): Promise<RunResult> {
    const bin = await resolveBin(ctx.provider)
    const p = ctx.permissions
    // Codex always reads and runs commands inside its sandbox; reading can't be switched off there.
    if (!p.fsRead) throw new Error(t('orchestrator:providers.codexNeedsRead'))
    // Never `danger-full-access`: writes stay inside the project folder (the OS sandbox enforces it); network only
    // when the agent has the network permission.
    const sandbox = ctx.mode !== 'task' || !p.fsWrite ? 'read-only' : 'workspace-write'
    const args = ['exec', '--skip-git-repo-check', '--sandbox', sandbox]
    if (sandbox === 'workspace-write' && p.network) args.push('-c', 'sandbox_workspace_write.network_access=true')
    if (ctx.model) args.push('-m', ctx.model)
    // Attached images (documented `codex exec --image <FILE>`).
    for (const img of ctx.imagePaths ?? []) args.push('--image', img)
    // Agentbits tools (apps, files, skills…) through the per-run MCP server; permissions are enforced by the
    // bridge (deny by default, the user's approval dock, audit), so Codex pre-approves this one server's tools with
    // `default_tools_approval_mode = "approve"` — `codex exec` has nobody to answer a prompt. Documented
    // `[mcp_servers.<name>]` keys as `-c` overrides; the Electron-as-Node server may start slowly, hence 30 s.
    if (ctx.mcpServer) {
      const s = ctx.mcpServer
      const env = Object.entries(s.env).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ')
      args.push(
        '-c', `mcp_servers.agentbits.command=${JSON.stringify(s.command)}`,
        '-c', `mcp_servers.agentbits.args=${JSON.stringify(s.args)}`,
        '-c', `mcp_servers.agentbits.env={ ${env} }`,
        '-c', 'mcp_servers.agentbits.default_tools_approval_mode="approve"',
        '-c', 'mcp_servers.agentbits.startup_timeout_sec=30',
        '-c', 'mcp_servers.agentbits.tool_timeout_sec=900'
      )
    }
    args.push('-')

    const env: Record<string, string | undefined> = {}
    if (ctx.apiKey) env.OPENAI_API_KEY = ctx.apiKey

    let text = ''
    let lines = 0
    // `codex exec` prints only a total ("tokens used: N"); it is recorded as input (no split available).
    let totalTokens = 0
    const sniff = (l: string): boolean => {
      const m = /tokens used:?\s*([\d.,]+)/i.exec(l)
      if (!m) return false
      totalTokens = Number(m[1].replace(/[.,]/g, '')) || totalTokens
      return true
    }
    const token = ctx.mcpServer?.env.AGENTBITS_TOKEN
    ctx.onLog('debug', `$ codex ${args.join(' ')}`.split(token || '\u0000').join('••••'))
    const { code, stderr } = await spawnLines({
      bin,
      args,
      cwd: ctx.cwd,
      // Only what a CLI needs plus the user's extra names: no other secrets of the machine (security review #03).
      inherit: agentEnv(process.env, 'codex', settingsRepo.get().cliEnvPassthrough),
      env,
      signal: ctx.signal,
      stdin: `${ctx.system}\n\n---\n\n${historyText(ctx.history)}${ctx.prompt}`,
      onStderr: (l) => {
        if (!sniff(l)) ctx.onLog('debug', l)
      },
      onLine: async (line) => {
        await ctx.checkpoint()
        if (sniff(line)) return
        text += line + '\n'
        ctx.onText(line + '\n')
        ctx.onProgress(Math.min(90, 10 + ++lines))
      }
    })
    if (code !== 0) throw new Error(t('orchestrator:providers.exitCode', { cli: 'codex', code: String(code), stderr: stderr.slice(-500) }))
    if (totalTokens) ctx.onUsage?.({ input: totalTokens, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 })
    return { text: text.trim(), tokensIn: totalTokens, tokensOut: 0, costUsd: 0 }
  },

  async test(provider: Provider): Promise<ProviderTestResult> {
    try {
      const bin = await resolveBin(provider)
      const out = await new Promise<string>((resolve, reject) =>
        execFile(bin, ['--version'], { timeout: 15000, windowsHide: true, shell: /\.(cmd|bat)$/i.test(bin) }, (e, so) =>
          e ? reject(e) : resolve(so.trim())
        )
      )
      return { ok: true, message: t('orchestrator:providers.codexFound', { version: out }) }
    } catch (e) {
      return { ok: false, message: (e as Error).message }
    }
  }
}
