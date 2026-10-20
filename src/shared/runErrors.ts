/**
 * What kind of failure a provider error is, so the user gets a short explanation in their language and a next step
 * (the raw text stays in the run record). Pure; `tests/runErrors.test.ts`.
 */
export type RunErrorKind = 'auth' | 'timeout' | 'network' | 'overloaded' | 'exit' | 'other'

/** Kept exactly as the orchestrator's auth check was (a broader one would pause all agents on unrelated errors). */
const AUTH = /authentication_error|access token has expired|re-?authenticate|invalid api key|invalid x-api-key|incorrect api key|not logged in|please run \/login|\b401\b/i
const TIMEOUT = /timed? ?out|timeout|aborted due to timeout|ETIMEDOUT|deadline exceeded/i
const NETWORK = /fetch failed|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|socket hang up|network (error|is unreachable)|getaddrinfo/i
const OVERLOADED = /\b(429|5\d\d)\b|overloaded|rate[ _-]?limit|too many requests|service unavailable|bad gateway|internal server error/i
const EXIT = /exit code|exited with code|\bexit(ed)? \d+\b/i

export function runErrorKind(raw: string): RunErrorKind {
  if (AUTH.test(raw)) return 'auth'
  if (TIMEOUT.test(raw)) return 'timeout'
  if (NETWORK.test(raw)) return 'network'
  if (OVERLOADED.test(raw)) return 'overloaded'
  if (EXIT.test(raw)) return 'exit'
  return 'other'
}

/** First line of a raw error, at most `max` characters (the detail shown next to the explanation). */
export function errorDetail(raw: string, max = 200): string {
  const first = raw.split('\n').find((l) => l.trim()) ?? raw
  return first.length > max ? first.slice(0, max) + '…' : first
}
