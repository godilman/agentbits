import { getDb } from '../db'
import { decryptSecret, encryptSecret } from '../secrets'
import { t } from '../i18n'

/**
 * GitHub token for installing skills from private repositories. Encrypted with the OS keychain (`safeStorage`), kept in
 * `settings` under a key `AppSettings` doesn't have (so `settings:update` can't touch it), never sent to the renderer,
 * and only ever sent to api.github.com.
 */
const KEY = 'secrets.githubToken'

/** Classic (ghp_…), fine-grained (github_pat_…) and other GitHub token shapes: letters, digits, underscores. */
const TOKEN = /^[A-Za-z0-9_]{20,255}$/

export function getGithubToken(): string | null {
  const r = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(KEY) as { value: string } | undefined
  if (!r) return null
  try {
    return decryptSecret(Buffer.from(JSON.parse(r.value) as string, 'base64'))
  } catch {
    return null
  }
}

export const hasGithubToken = (): boolean => !!getGithubToken()

/** '' removes the token. */
export function setGithubToken(token: string): void {
  const v = token.trim()
  if (!v) {
    getDb().prepare('DELETE FROM settings WHERE key = ?').run(KEY)
    return
  }
  if (!TOKEN.test(v)) throw new Error(t('main:skills.errors.badToken'))
  const enc = encryptSecret(v).toString('base64')
  getDb().prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(KEY, JSON.stringify(enc))
}
