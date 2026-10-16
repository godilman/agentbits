import { lookup } from 'node:dns/promises'
// Relative with the extension so `tests/connections.transport.test.ts` runs this file under plain Node.
import { isPrivateIp } from '../../shared/connectionRules.ts'

type Lookup = (host: string) => Promise<string[]>
const dnsLookup: Lookup = async (host) => (await lookup(host, { all: true })).map((r) => r.address)

/** For the audit line of an unencrypted connection: every address the host resolves to is private. */
export async function isPrivateHost(host: string, resolve: Lookup = dnsLookup): Promise<boolean> {
  const h = host.trim()
  if (!h) return false
  if (/^[\d.]+$|:/.test(h)) return isPrivateIp(h)
  try {
    const all = await resolve(h)
    return all.length > 0 && all.every(isPrivateIp)
  } catch {
    return false
  }
}

/** The driver error a server without TLS gives when TLS is asked for (MySQL / MariaDB, PostgreSQL, SQL Server). */
export function isNoTlsError(e: unknown): boolean {
  const err = e as { code?: string; message?: string; originalError?: { message?: string } } | null
  const text = `${err?.message ?? ''} ${err?.originalError?.message ?? ''}`
  return err?.code === 'HANDSHAKE_NO_SSL_SUPPORT' || /does not support (SSL|secure connection)|did not negotiate encryption/i.test(text)
}
