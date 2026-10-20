/**
 * Checking for a new Agentbits version. Only the check: the app says a newer published stable release exists and opens
 * its official GitHub Releases page; it doesn't download or install anything (owner's decision, 2026-10-20: not until
 * signed builds and a real signed-to-signed upgrade test — ADR-032). The address is fixed here; nothing the user or a
 * release enters can change it. `main/update.ts` runs it; tests: `tests/update.test.ts`.
 */
export const REPO = 'godilman/agentbits'
/** Latest published release: GitHub never returns drafts or prereleases here. */
export const LATEST_RELEASE_API = `https://api.github.com/repos/${REPO}/releases/latest`
export const RELEASES_PAGE = `https://github.com/${REPO}/releases`
export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000

export type UpdateError = 'offline' | 'rateLimited' | 'badResponse' | 'failed'
export interface UpdateState {
  status: 'idle' | 'checking' | 'upToDate' | 'available' | 'error'
  /** The running version. */
  current: string
  /** Newest published stable version, when newer than `current`. */
  latest?: string
  /** When the last check finished (ms since epoch). */
  checkedAt?: number
  error?: UpdateError
}

/** "1.2.3" or "v1.2.3" → [1, 2, 3]; anything else (prerelease "1.2.3-beta.1", build metadata, junk) → null. */
export function parseStable(v: unknown): [number, number, number] | null {
  const m = typeof v === 'string' ? /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/.exec(v) : null
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** True only when `a` is a newer stable version than `b` (never a downgrade, never a prerelease). */
export function isNewer(a: string, b: string): boolean {
  const x = parseStable(a)
  const y = parseStable(b)
  if (!x || !y) return false
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]
  return false
}

/** The version of a `releases/latest` answer, or null unless it is a published, stable release with a plain tag. */
export function readRelease(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const r = body as { draft?: unknown; prerelease?: unknown; tag_name?: unknown }
  if (r.draft !== false || r.prerelease !== false) return null
  const v = parseStable(r.tag_name)
  return v ? v.join('.') : null
}

/** The release page opened for a version: built from the checked version number, never from a URL in the answer. */
export function releasePage(version: string | undefined): string {
  const v = version !== undefined ? parseStable(version) : null
  return v ? `${RELEASES_PAGE}/tag/v${v.join('.')}` : RELEASES_PAGE
}

export interface Checker {
  /** One check at a time: a second call while one runs gets the same answer (double clicks, timer + click). */
  check: () => Promise<UpdateState>
  state: () => UpdateState
  /** An automatic check is due: none was started in the last `CHECK_EVERY_MS` (a failed one counts, so no retry storm). */
  due: () => boolean
}

/**
 * `fetchLatest` answers with the HTTP status and parsed body, or throws when the network is unreachable.
 * `now` is wall-clock time, so a computer back from sleep sees one check due, not every missed one.
 */
export function createChecker(deps: {
  current: string
  fetchLatest: () => Promise<{ status: number; body: unknown }>
  now: () => number
  onChange: (s: UpdateState) => void
}): Checker {
  let state: UpdateState = { status: 'idle', current: deps.current }
  let running: Promise<UpdateState> | null = null
  let startedAt = -Infinity
  const set = (s: UpdateState): UpdateState => {
    state = s
    deps.onChange(s)
    return s
  }
  const run = async (): Promise<UpdateState> => {
    startedAt = deps.now()
    // A version already found stays shown while checking again.
    set({ ...state, status: 'checking', error: undefined })
    const done = (s: Omit<UpdateState, 'current' | 'checkedAt'>): UpdateState => set({ current: deps.current, checkedAt: deps.now(), ...s })
    let res: { status: number; body: unknown }
    try {
      res = await deps.fetchLatest()
    } catch {
      return done({ status: 'error', error: 'offline', latest: state.latest })
    }
    if (res.status === 403 || res.status === 429) return done({ status: 'error', error: 'rateLimited', latest: state.latest })
    // 404: no published release at all.
    if (res.status === 404) return done({ status: 'upToDate' })
    if (res.status !== 200) return done({ status: 'error', error: 'failed', latest: state.latest })
    const version = readRelease(res.body)
    if (!version) return done({ status: 'error', error: 'badResponse', latest: state.latest })
    return isNewer(version, deps.current) ? done({ status: 'available', latest: version }) : done({ status: 'upToDate' })
  }
  return {
    check: () => (running ??= run().finally(() => (running = null))),
    state: () => state,
    // A clock set back counts as due too (else no automatic check until it catches up).
    due: () => deps.now() < startedAt || deps.now() - startedAt >= CHECK_EVERY_MS
  }
}
