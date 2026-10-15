/** OpenAI-compatible endpoints (Gemini, Ollama, LM Studio). Run: npm run test:unit */
import assert from 'node:assert/strict'
import { checkBaseUrl, cleanModelId, isLocalUrl, presetOf } from '../src/shared/endpoints.ts'

assert.deepEqual(checkBaseUrl(''), { ok: true, url: '' })
assert.deepEqual(checkBaseUrl(' https://generativelanguage.googleapis.com/v1beta/openai/ '), { ok: true, url: 'https://generativelanguage.googleapis.com/v1beta/openai' })
assert.deepEqual(checkBaseUrl('http://127.0.0.1:11434/v1'), { ok: true, url: 'http://127.0.0.1:11434/v1' })
assert.deepEqual(checkBaseUrl('http://localhost:1234/v1/'), { ok: true, url: 'http://localhost:1234/v1' })
// an API key never goes unencrypted over a network
assert.deepEqual(checkBaseUrl('http://192.168.1.20:11434/v1'), { ok: false, reason: 'insecure' })
assert.deepEqual(checkBaseUrl('http://example.com/v1'), { ok: false, reason: 'insecure' })
assert.deepEqual(checkBaseUrl('http://localhost.evil.com/v1'), { ok: false, reason: 'insecure' })
for (const bad of ['ftp://x/v1', 'file:///etc/passwd', 'javascript:alert(1)', 'not a url', 'https://user:pass@x.com/v1', 'https://x.com/v1?key=1']) {
  assert.deepEqual(checkBaseUrl(bad), { ok: false, reason: 'invalid' }, bad)
}
assert.equal(isLocalUrl('http://[::1]:8080/v1'), true)
assert.equal(isLocalUrl('https://api.openai.com/v1'), false)
assert.equal(presetOf(''), 'openai')
assert.equal(presetOf('https://generativelanguage.googleapis.com/v1beta/openai'), 'gemini')
assert.equal(presetOf('http://127.0.0.1:11434/v1'), 'ollama')
assert.equal(presetOf('https://my-proxy.example.com/v1'), 'custom')
assert.equal(cleanModelId('models/gemini-2.5-flash'), 'gemini-2.5-flash')
console.log('endpoints: base URLs checked')
