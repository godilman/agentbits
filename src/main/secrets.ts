import { safeStorage } from 'electron'
import { t } from './i18n'

/**
 * Secrets (API keys, connection passwords, app tokens) are encrypted with the OS keychain: DPAPI on Windows,
 * Keychain on macOS, libsecret / kwallet on Linux. Without a real keychain nothing secret is stored — saving fails
 * with a clear message (Linux `basic_text` is not encryption). Developers can opt into the old base64 fallback
 * with `AGENTBITS_ALLOW_PLAIN_SECRETS=1` (tests only; never for real keys).
 */

const plainAllowed = (): boolean => process.env.AGENTBITS_ALLOW_PLAIN_SECRETS === '1'

/** True when secrets can be stored encrypted by the OS (not just obfuscated). */
export function secureStorageAvailable(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false
  if (process.platform === 'linux') {
    const backend = safeStorage.getSelectedStorageBackend?.()
    if (backend === 'basic_text' || backend === 'unknown') return false
  }
  return true
}

export function encryptSecret(plain: string): Buffer {
  if (secureStorageAvailable()) return safeStorage.encryptString(plain)
  if (plainAllowed()) return Buffer.from('plain:' + Buffer.from(plain, 'utf8').toString('base64'), 'utf8')
  throw new Error(t('main:errors.noSecureStorage'))
}

export function decryptSecret(buf: Buffer | null | undefined): string | null {
  if (!buf || buf.length === 0) return null
  const asText = buf.toString('utf8')
  if (asText.startsWith('plain:')) return Buffer.from(asText.slice(6), 'base64').toString('utf8')
  try {
    return safeStorage.decryptString(buf)
  } catch {
    return null
  }
}

/** A value an older version stored as base64 (`plain:`) that should be encrypted now. */
export function isPlainSecret(buf: Buffer | null | undefined): boolean {
  return !!buf && buf.length > 6 && buf.subarray(0, 6).toString('utf8') === 'plain:'
}
