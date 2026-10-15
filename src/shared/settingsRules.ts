/**
 * Security-relevant settings rules (pure; `tests/settings.test.ts`): which environment variables an agent CLI inherits,
 * and validation of `settings:update` patches (the renderer is not trusted to send well-formed values).
 */
import type { AppSettings } from './types'

/**
 * Variables every agent CLI may inherit: what a program needs to start, find its sign-in, reach the network through
 * the user's proxy and print in the right language. Matched case-insensitively (Windows has "Path").
 * Deliberately absent: SSH_AUTH_SOCK (would hand the agent the user's SSH keys, bypassing Connections),
 * NODE_OPTIONS (code injection into a Node-based CLI), ELECTRON_RUN_AS_NODE and any cloud / token variable.
 */
const BASE_NAMES = new Set(
  [
    'PATH', 'PATHEXT', 'HOME', 'USER', 'USERNAME', 'LOGNAME', 'SHELL', 'TERM', 'COLORTERM', 'LANG', 'LANGUAGE', 'TZ',
    'TMP', 'TEMP', 'TMPDIR', 'SYSTEMROOT', 'SYSTEMDRIVE', 'WINDIR', 'COMSPEC', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH',
    'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PROGRAMW6432', 'COMMONPROGRAMFILES',
    'COMMONPROGRAMFILES(X86)', 'ALLUSERSPROFILE', 'PUBLIC', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'OS',
    'COMPUTERNAME', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'ALL_PROXY', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE',
    'SSL_CERT_DIR', 'XDG_RUNTIME_DIR', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'XDG_STATE_HOME'
  ]
)
const BASE_PREFIXES = ['LC_']
/** The CLI's own configuration (e.g. CLAUDE_CONFIG_DIR, ANTHROPIC_BASE_URL, CODEX_HOME). */
const CLI_PREFIXES: Record<'claude' | 'codex', string[]> = {
  claude: ['CLAUDE_', 'ANTHROPIC_'],
  codex: ['CODEX_', 'OPENAI_']
}
const NEVER = new Set(['SSH_AUTH_SOCK', 'NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE'])

/** A valid environment variable name for the "also pass" list. */
export const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/

/** The environment an agent CLI starts with (before adapter-specific values such as the API key are added). */
export function agentEnv(parent: Record<string, string | undefined>, cli: 'claude' | 'codex', extra: string[] = []): Record<string, string> {
  const extras = new Set(extra.map((n) => n.toUpperCase()))
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(parent)) {
    if (value === undefined) continue
    const up = name.toUpperCase()
    if (NEVER.has(up)) continue
    const pass =
      BASE_NAMES.has(up) || BASE_PREFIXES.some((p) => up.startsWith(p)) || CLI_PREFIXES[cli].some((p) => up.startsWith(p)) || extras.has(up)
    if (pass) out[name] = value
  }
  return out
}

/** Settings before the user changes anything (main reads stored values over these; the renderer starts with them). */
export const DEFAULT_SETTINGS: AppSettings = {
  onboarded: false,
  workspaceRoot: '',
  autopilot: true,
  reviewByLead: true,
  logRetentionDays: 30,
  startupProjects: 'ask',
  language: 'auto',
  auditRetentionDays: 180,
  runMaxMinutes: 120,
  runMaxTokens: 0,
  runMaxCostUsd: 0,
  cliEnvPassthrough: [],
  filesQuotaMb: 5120,
  shareWithTwins: true,
  raceMode: false
}

/** Upper bounds of the number settings (0 = no limit / keep forever). */
export const LIMIT_MAX = { runMaxMinutes: 24 * 60, runMaxTokens: 100_000_000, runMaxCostUsd: 10_000, auditRetentionDays: 3650, logRetentionDays: 3650, filesQuotaMb: 1_000_000 }

/** `invalid`: malformed patch (not something the UI sends); `envName`: a name that can't be passed to agents. */
export class SettingsError extends Error {
  readonly code: 'invalid' | 'envName'
  readonly detail: string
  constructor(code: 'invalid' | 'envName', detail = '') {
    super(`settings: ${code}${detail ? ` (${detail})` : ''}`)
    this.code = code
    this.detail = detail
  }
}

/**
 * Checks a settings patch from the renderer: only known keys with values of the right shape; throws otherwise.
 * Returns the cleaned patch (trimmed, de-duplicated env names).
 */
export function validateSettingsPatch(patch: unknown): Partial<AppSettings> {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new SettingsError('invalid')
  const out: Partial<AppSettings> = {}
  const bool = (k: string, v: unknown): boolean => {
    if (typeof v !== 'boolean') throw new SettingsError('invalid', k)
    return v
  }
  const num = (k: keyof typeof LIMIT_MAX, v: unknown, integer = true): number => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > LIMIT_MAX[k] || (integer && !Number.isInteger(v)))
      throw new SettingsError('invalid', k)
    return v
  }
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    switch (k) {
      case 'onboarded':
      case 'autopilot':
      case 'reviewByLead':
      case 'shareWithTwins':
      case 'raceMode':
        out[k] = bool(k, v)
        break
      case 'workspaceRoot':
      case 'language':
        if (typeof v !== 'string' || v.length > 1000) throw new SettingsError('invalid', k)
        out[k] = v
        break
      case 'startupProjects':
        if (v !== 'ask' && v !== 'restore') throw new SettingsError('invalid', k)
        out[k] = v
        break
      case 'logRetentionDays':
      case 'auditRetentionDays':
      case 'runMaxMinutes':
      case 'runMaxTokens':
      case 'filesQuotaMb':
        out[k] = num(k, v)
        break
      case 'runMaxCostUsd':
        out[k] = num(k, v, false)
        break
      case 'cliEnvPassthrough': {
        if (!Array.isArray(v) || v.length > 50) throw new SettingsError('invalid', k)
        const names = [...new Set(v.map((n) => (typeof n === 'string' ? n.trim() : '')).filter(Boolean))]
        const bad = names.find((n) => !ENV_NAME.test(n) || NEVER.has(n.toUpperCase()))
        if (bad !== undefined) throw new SettingsError('envName', bad)
        out[k] = names
        break
      }
      default:
        throw new SettingsError('invalid', k)
    }
  }
  return out
}
