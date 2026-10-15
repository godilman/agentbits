import http from 'node:http'
import https from 'node:https'

/**
 * Fetches a public web page for an agent (`web_fetch`). Every hop (redirects included) is resolved first and must
 * point only to public addresses; the connection is then pinned to the checked address, so DNS can't switch it to a
 * private one in between (rebinding). Size and time are capped. The rules come in as `deps` (wired in `web/tool.ts`),
 * so the fetcher has no imports of its own and the test runs it against a local server. `tests/webFetch.test.ts`.
 */

export const MAX_BYTES = 3 * 1024 * 1024
const MAX_HOPS = 5
const TIMEOUT_MS = 20_000

export interface PageResult {
  url: string
  status: number
  contentType: string
  title: string
  text: string
  truncated: boolean
}

export interface FetchDeps {
  lookup: (host: string) => Promise<{ address: string; family: number }[]>
  isPublic: (ip: string) => boolean
  checkUrl: (raw: string) => { ok: true; url: URL } | { ok: false; reason: string }
  toText: (html: string) => { title: string; text: string }
}

export class WebError extends Error {}

function request(url: URL, address: { address: string; family: number }, signal: AbortSignal): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http
    const req = lib.request(
      url,
      {
        method: 'GET',
        headers: { 'user-agent': 'Agentbits (agent web_fetch)', accept: 'text/html,text/plain,application/json;q=0.9,*/*;q=0.1' },
        // Pinned to the address that was checked (TLS still verifies the host name).
        lookup: (_h: string, opts: { all?: boolean }, cb: (...a: unknown[]) => void) =>
          opts?.all ? cb(null, [{ address: address.address, family: address.family }]) : cb(null, address.address, address.family),
        signal,
        timeout: TIMEOUT_MS
      } as https.RequestOptions,
      (res) => {
        const chunks: Buffer[] = []
        let size = 0
        let truncated = false
        res.on('data', (c: Buffer) => {
          if (truncated) return
          size += c.length
          if (size > MAX_BYTES) {
            truncated = true
            chunks.push(c.subarray(0, c.length - (size - MAX_BYTES)))
            res.destroy()
            resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks), truncated })
            return
          }
          chunks.push(c)
        })
        res.on('end', () => !truncated && resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks), truncated }))
        res.on('error', (e) => !truncated && reject(e))
      }
    )
    req.on('timeout', () => req.destroy(new WebError('the page took too long')))
    req.on('error', reject)
    req.end()
  })
}

function decode(body: Buffer, contentType: string): string {
  const charset = /charset=([\w-]+)/i.exec(contentType)?.[1]
  try {
    return new TextDecoder(charset || 'utf-8').decode(body)
  } catch {
    return new TextDecoder('utf-8').decode(body)
  }
}

export async function fetchPage(raw: string, signal: AbortSignal, deps: FetchDeps): Promise<PageResult> {
  let current = raw
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    const c = deps.checkUrl(current)
    if (!c.ok) throw new WebError(c.reason)
    const url = c.url
    const host = url.hostname.replace(/^\[|\]$/g, '')
    let addrs: { address: string; family: number }[]
    try {
      addrs = await deps.lookup(host)
    } catch {
      throw new WebError(`could not resolve ${host}`)
    }
    if (!addrs.length || addrs.some((a) => !deps.isPublic(a.address))) throw new WebError(`${host} is not a public address`)
    const res = await request(url, addrs[0], signal)
    const location = res.headers.location
    if (res.status >= 300 && res.status < 400 && location) {
      current = new URL(location, url).toString()
      continue
    }
    const contentType = String(res.headers['content-type'] ?? '')
    if (!/^(text\/|application\/(json|xhtml\+xml|xml|ld\+json))/i.test(contentType || 'text/html')) {
      throw new WebError(`not a text page (${contentType.split(';')[0]})`)
    }
    const raw2 = decode(res.body, contentType)
    const isHtml = /html/i.test(contentType) || (!contentType && /<html|<body/i.test(raw2))
    const { title, text } = isHtml ? deps.toText(raw2) : { title: '', text: raw2 }
    return { url: url.toString(), status: res.status, contentType, title, text, truncated: res.truncated }
  }
  throw new WebError('too many redirects')
}
