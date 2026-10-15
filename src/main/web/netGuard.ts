import { isIP } from 'node:net'

/**
 * Agents' web access (`web_fetch`, the `browser` permission) may only reach the public internet: never this computer,
 * the local network, link-local / cloud metadata (169.254.169.254) or other special ranges — otherwise a page or a
 * prompt could make an agent read the router, an intranet service or a cloud credential endpoint (SSRF).
 * `tests/web.test.ts`.
 */

function v4Parts(ip: string): number[] | null {
  const p = ip.split('.').map(Number)
  return p.length === 4 && p.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? p : null
}

function publicV4(ip: string): boolean {
  const p = v4Parts(ip)
  if (!p) return false
  const [a, b] = p
  if (a === 0 || a === 10 || a === 127) return false // this network, private, loopback
  if (a === 100 && b >= 64 && b <= 127) return false // carrier-grade NAT
  if (a === 169 && b === 254) return false // link-local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false // private
  if (a === 192 && b === 168) return false // private
  if (a === 192 && b === 0 && (p[2] === 0 || p[2] === 2)) return false // IETF protocol assignments, documentation
  if (a === 198 && (b === 18 || b === 19)) return false // benchmarking
  if (a === 198 && b === 51 && p[2] === 100) return false // documentation
  if (a === 203 && b === 0 && p[2] === 113) return false // documentation
  if (a >= 224) return false // multicast, reserved, broadcast
  return true
}

/** Expands an IPv6 address to 8 groups (null if not one). */
function v6Groups(ip: string): number[] | null {
  let s = ip.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0]
  // embedded IPv4 at the end (::ffff:1.2.3.4)
  const m = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(s)
  if (m) {
    const p = v4Parts(m[2])
    if (!p) return null
    s = `${m[1]}${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`
  }
  const halves = s.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0
  const all = [...head, ...Array(Math.max(0, fill)).fill('0'), ...tail]
  if (all.length !== 8 || !all.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null
  return all.map((g) => parseInt(g, 16))
}

function publicV6(ip: string): boolean {
  const g = v6Groups(ip)
  if (!g) return false
  const v4 = (): string => `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`
  if (g.every((x) => x === 0)) return false // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return false // ::1
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return publicV4(v4()) // ::ffff:a.b.c.d (mapped)
  if (g.slice(0, 6).every((x) => x === 0)) return publicV4(v4()) // ::a.b.c.d (compatible, deprecated)
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return publicV4(v4()) // NAT64
  if ((g[0] & 0xfe00) === 0xfc00) return false // unique local
  if ((g[0] & 0xffc0) === 0xfe80) return false // link-local
  if ((g[0] & 0xff00) === 0xff00) return false // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false // documentation
  if (g[0] === 0x2002) return publicV4(`${g[1] >> 8}.${g[1] & 255}.${g[2] >> 8}.${g[2] & 255}`) // 6to4
  return true
}

/** True only for an address on the public internet. */
export function isPublicAddress(ip: string): boolean {
  const kind = isIP(ip.replace(/^\[|\]$/g, '').split('%')[0])
  return kind === 4 ? publicV4(ip) : kind === 6 ? publicV6(ip) : false
}

/** A URL an agent may ask for: http(s), no credentials, default or common ports. */
export function checkWebUrl(raw: string): { ok: true; url: URL } | { ok: false; reason: string } {
  let u: URL
  try {
    u = new URL(String(raw).trim())
  } catch {
    return { ok: false, reason: 'not a valid URL' }
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, reason: 'only http and https pages' }
  if (u.username || u.password) return { ok: false, reason: 'URLs with credentials are not allowed' }
  if (u.port && !['80', '443', '8080', '8443'].includes(u.port)) return { ok: false, reason: 'unusual port' }
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(u.hostname)) return { ok: false, reason: 'local host name' }
  if (isIP(u.hostname.replace(/^\[|\]$/g, '')) && !isPublicAddress(u.hostname)) return { ok: false, reason: 'not a public address' }
  return { ok: true, url: u }
}
