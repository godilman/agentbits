/** web_fetch against a local test server: redirects re-checked, DNS answers checked, size cap. Run: npm run test:unit */
import assert from 'node:assert/strict'
import http from 'node:http'
import { fetchPage, MAX_BYTES } from '../src/main/web/fetchPage.ts'
import { checkWebUrl, isPublicAddress } from '../src/main/web/netGuard.ts'
import { htmlToText } from '../src/shared/html.ts'

const server = http.createServer((req, res) => {
  if (req.url === '/page') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    return res.end('<html><head><title>Hello</title></head><body><h2>Ünlü</h2><p>Sayfa &amp; metin</p><script>x()</script></body></html>') // i18n-ignore
  }
  if (req.url === '/go') {
    res.writeHead(302, { location: '/page' })
    return res.end()
  }
  if (req.url === '/escape') {
    res.writeHead(302, { location: 'http://internal.example/secret' })
    return res.end()
  }
  if (req.url === '/latin1') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=iso-8859-9' })
    return res.end(Buffer.from([0x47, 0xfc, 0x6e, 0x61, 0x79])) // "Günay" in ISO-8859-9
  }
  if (req.url === '/big') {
    res.writeHead(200, { 'content-type': 'text/plain' })
    return res.end('x'.repeat(MAX_BYTES + 1000))
  }
  if (req.url === '/bin') {
    res.writeHead(200, { 'content-type': 'application/octet-stream' })
    return res.end(Buffer.alloc(10))
  }
  res.writeHead(404)
  res.end()
})
await new Promise<void>((r) => server.listen(8080, '127.0.0.1', () => r()))
// Test DNS: "site.example" → the local test server, treated as public; "internal.example" → a private address.
const deps = {
  lookup: async (host: string) => {
    if (host === 'site.example') return [{ address: '127.0.0.1', family: 4 }]
    if (host === 'internal.example') return [{ address: '10.0.0.7', family: 4 }]
    if (host === 'mixed.example') return [{ address: '127.0.0.1', family: 4 }, { address: '192.168.1.5', family: 4 }]
    throw new Error('NXDOMAIN')
  },
  isPublic: (ip: string) => ip === '127.0.0.1',
  checkUrl: checkWebUrl,
  toText: htmlToText
}
const sig = new AbortController().signal
try {
  const p = await fetchPage('http://site.example:8080/go', sig, deps)
  assert.equal(p.status, 200)
  assert.equal(p.url, 'http://site.example:8080/page')
  assert.equal(p.title, 'Hello')
  assert.match(p.text, /## Ünlü/) // i18n-ignore
  assert.match(p.text, /Sayfa & metin/)
  assert.ok(!p.text.includes('x()'))
  // a redirect to a private address is refused
  await assert.rejects(fetchPage('http://site.example:8080/escape', sig, deps), /not a public address/)
  // a name with any private answer is refused (no "pick the public one")
  await assert.rejects(fetchPage('http://mixed.example:8080/page', sig, deps), /not a public address/)
  await assert.rejects(fetchPage('http://nowhere.example:8080/page', sig, deps), /could not resolve/)
  // with the real guard, the local server itself is unreachable
  await assert.rejects(fetchPage('http://site.example:8080/page', sig, { ...deps, isPublic: () => false }), /not a public address/)
  await assert.rejects(fetchPage('http://127.0.0.1:8080/page', sig, { ...deps, isPublic: isPublicAddress }), /not a public address/)
  assert.equal((await fetchPage('http://site.example:8080/latin1', sig, deps)).text, 'Günay') // i18n-ignore
  const big = await fetchPage('http://site.example:8080/big', sig, deps)
  assert.equal(big.truncated, true)
  assert.ok(big.text.length <= MAX_BYTES)
  await assert.rejects(fetchPage('http://site.example:8080/bin', sig, deps), /not a text page/)
  console.log('webFetch: redirects and DNS answers checked, size capped, charsets decoded')
} finally {
  server.close()
}
