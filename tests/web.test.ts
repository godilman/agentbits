/** Agents' web access: SSRF guard and HTML to text. Run: npm run test:unit */
import assert from 'node:assert/strict'
import { checkWebUrl, isPublicAddress } from '../src/main/web/netGuard.ts'
import { decodeEntities, htmlToText } from '../src/shared/html.ts'

for (const ip of ['8.8.8.8', '1.1.1.1', '140.82.112.3', '2606:4700:4700::1111', '2a00:1450:4001:82a::200e', '::ffff:8.8.8.8']) {
  assert.equal(isPublicAddress(ip), true, ip)
}
for (const ip of [
  '127.0.0.1', '127.8.8.8', '10.0.0.5', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1',
  '0.0.0.0', '224.0.0.1', '255.255.255.255', '192.0.2.10', '198.51.100.1', '203.0.113.9',
  '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1', '2001:db8::1',
  '::ffff:127.0.0.1', '::ffff:169.254.169.254', '::ffff:7f00:1', '64:ff9b::a9fe:a9fe', '2002:c0a8:0101::1', '::127.0.0.1',
  'not-an-ip', ''
]) {
  assert.equal(isPublicAddress(ip), false, ip)
}
assert.equal(checkWebUrl('https://example.com/docs?a=1').ok, true)
assert.equal(checkWebUrl('https://example.com:8443/x').ok, true)
for (const bad of [
  'file:///etc/passwd', 'ftp://example.com', 'javascript:alert(1)', 'https://user:pw@example.com', 'http://localhost:3000',
  'http://printer.local', 'http://metadata.google.internal/computeMetadata', 'http://169.254.169.254/latest/meta-data',
  'http://[::1]/', 'http://10.1.2.3/admin', 'https://example.com:22/', 'not a url'
]) {
  assert.equal(checkWebUrl(bad).ok, false, bad)
}

const page = `<!doctype html><html><head><title>Docs &amp; Guide</title><style>.x{}</style><script>evil()</script></head>
<body><nav aria-hidden="true">menu</nav><h1>Install</h1><p>Run <code>npm&nbsp;ci</code> first.</p>
<ul><li>One</li><li>Two &#8212; done</li></ul><a href="https://example.com/next">Next page</a><!-- hidden comment -->
<div hidden>secret</div></body></html>`
const r = htmlToText(page)
assert.equal(r.title, 'Docs & Guide')
assert.match(r.text, /^# Install/m)
assert.match(r.text, /Run npm ci first\./)
assert.match(r.text, /- Two — done/)
assert.match(r.text, /Next page \(https:\/\/example\.com\/next\)/)
for (const gone of ['evil()', 'menu', 'hidden comment', 'secret', '.x{}']) assert.ok(!r.text.includes(gone), gone)
assert.equal(decodeEntities('&lt;b&gt; &#x41;&#66; &unknown;'), '<b> AB &unknown;')
console.log('web: SSRF guard and page text ok')
