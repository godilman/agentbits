import { app, net, shell } from 'electron'
import { LATEST_RELEASE_API, createChecker, releasePage, type Checker, type UpdateState } from '@shared/update'
import { settingsRepo } from './db/repos'
import { emit } from './events'

/**
 * New-version check (ADR-032): only checks and tells; the user installs from the official Releases page. No download,
 * no install, no token. Automatic checks run in packaged builds while "Check for new versions automatically" is on:
 * the first a little after start-up, then at most once every 6 hours (wall clock, so waking from sleep runs one).
 * Background failures stay quiet (shown only in Settings); there are no toasts or notifications from here.
 */
const FIRST_CHECK_MS = 30_000
const TICK_MS = 10 * 60_000

let checker: Checker | null = null
let timers: ReturnType<typeof setTimeout>[] = []

function get(): Checker {
  return (checker ??= createChecker({
    current: app.getVersion(),
    now: Date.now,
    fetchLatest: async () => {
      const res = await net.fetch(LATEST_RELEASE_API, {
        headers: { accept: 'application/vnd.github+json', 'user-agent': `Agentbits/${app.getVersion()}` },
        // Only GitHub's own answer counts (a redirect elsewhere would be someone else's).
        redirect: 'error',
        // A connection that never answers (captive portal) must not keep the check running for good.
        signal: AbortSignal.timeout(15_000)
      })
      return { status: res.status, body: res.status === 200 ? await res.json().catch(() => null) : null }
    },
    onChange: (state) => emit({ type: 'update:changed', state })
  }))
}

const auto = (): boolean => app.isPackaged && settingsRepo.get().autoUpdateCheck

function tick(): void {
  if (auto() && get().due()) void get().check()
}

export function startUpdates(): void {
  timers = [setTimeout(tick, FIRST_CHECK_MS), setInterval(tick, TICK_MS)]
  for (const x of timers) x.unref?.()
}

export function stopUpdates(): void {
  for (const x of timers) clearTimeout(x)
  timers = []
}

export const updateState = (): UpdateState => get().state()
/** "Check for updates": works with the automatic check off, and in unpackaged runs. */
export const checkForUpdate = (): Promise<UpdateState> => get().check()
/** Opens the official page of the version found (or the releases list); the address is built here, not received. */
export const openReleasePage = (): Promise<void> => shell.openExternal(releasePage(get().state().latest))
