/**
 * Masks secret-looking text before it is stored in agent transcripts (security review #21). Pattern based: it catches
 * well-known key formats and `password=…` style assignments, not every secret a tool might print. `tests/redact.test.ts`.
 */
const MASK = '••••'

const PATTERNS: [RegExp, (m: string, ...g: string[]) => string][] = [
  // PEM private keys (whole block)
  [/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g, () => `-----PRIVATE KEY ${MASK}-----`],
  // provider / platform tokens with a recognisable prefix
  [/\b(sk-ant-[A-Za-z0-9_-]{4})[A-Za-z0-9_-]{16,}/g, (_m, p) => `${p}${MASK}`],
  [/\b((?:sk|rk)-(?:proj-|live-|test-)?[A-Za-z0-9]{3})[A-Za-z0-9_-]{17,}/g, (_m, p) => `${p}${MASK}`],
  [/\b((?:ghp|gho|ghu|ghs|ghr)_)[A-Za-z0-9]{30,}/g, (_m, p) => `${p}${MASK}`],
  [/\b(github_pat_)[A-Za-z0-9_]{30,}/g, (_m, p) => `${p}${MASK}`],
  [/\b(glpat-)[A-Za-z0-9_-]{16,}/g, (_m, p) => `${p}${MASK}`],
  [/\b(xox[abprs]-)[A-Za-z0-9-]{10,}/g, (_m, p) => `${p}${MASK}`],
  [/\b(AKIA|ASIA)[A-Z0-9]{16}\b/g, (_m, p) => `${p}${MASK}`],
  [/\b(AIza)[A-Za-z0-9_-]{35}\b/g, (_m, p) => `${p}${MASK}`],
  // JSON Web Tokens
  [/\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, () => `eyJ${MASK}`],
  // credentials inside URLs: scheme://user:password@host
  [/\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+@/gi, (_m, p) => `${p}${MASK}@`],
  // key = value / "key": "value" assignments with a secret-sounding key
  [
    /((?:^|[\s,{;"'])["']?(?:[A-Za-z0-9_.-]*?)(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret|private[_-]?key)["']?\s*[:=]\s*["']?)([^\s"',;}]{4,})/gi,
    (_m, k) => `${k}${MASK}`
  ]
]

export function redactSecrets(text: string): string {
  if (!text) return text
  let out = text
  for (const [re, fn] of PATTERNS) out = out.replace(re, fn as (m: string, ...g: string[]) => string)
  return out
}

/** `redactSecrets` over every string inside a JSON-like value (log meta: prompts, tool arguments). */
export function redactDeep<T>(value: T): T {
  if (typeof value === 'string') return redactSecrets(value) as T
  if (Array.isArray(value)) return value.map((v) => redactDeep(v)) as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = redactDeep(v)
    return out as T
  }
  return value
}
