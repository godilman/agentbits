// The new-version check through the real IPC handlers: a fixed HTTPS address with no token, a published stable newer
// version only, one request at a time, and the page opened is the official one built from the version.
// Run: npm run test:e2e
import assert from 'node:assert/strict'
import { openDb } from '../../src/main/db'
import { handlers } from '../../src/main/ipc'
import { applyLanguageSetting } from '../../src/main/i18n'

const e2e = (globalThis as any).__e2e
e2e.version = '0.8.0' // before the checker is made (it reads the version once)
let count = 0
const step = async (name: string, fn: () => Promise<void> | void): Promise<void> => {
  await fn()
  count++
  console.log(`  ✓ ${name}`)
}
const call = <T = any>(name: string, ...args: unknown[]): Promise<T> => Promise.resolve().then(() => (handlers as any)[name](...args))
const requests: { url: string; init: any }[] = []
let answer: () => Promise<{ status: number; json: () => Promise<unknown> }> = async () => ({ status: 404, json: async () => ({}) })
e2e.netFetch = (url: string, init: unknown) => {
  requests.push({ url, init })
  return answer()
}
const ok = (body: object) => async () => ({ status: 200, json: async () => ({ draft: false, prerelease: false, tag_name: 'v0.9.0', ...body }) })

async function main(): Promise<void> {
  openDb()
  applyLanguageSetting('en')

  await step('before any check: idle, the running version', async () => {
    assert.deepEqual(await call('update:status'), { status: 'idle', current: '0.8.0' })
    assert.equal(requests.length, 0, 'unpackaged and not started: nothing is fetched by itself')
  })

  await step('a check: the fixed GitHub address over HTTPS, no token, no redirects followed', async () => {
    answer = ok({ html_url: 'https://evil.example/download' })
    const s = await call('update:check')
    assert.equal(s.status, 'available')
    assert.equal(s.latest, '0.9.0')
    const [r] = requests
    assert.equal(r.url, 'https://api.github.com/repos/godilman/agentbits/releases/latest')
    assert.equal(r.init.redirect, 'error')
    assert.ok(!Object.keys(r.init.headers).some((h) => /authorization/i.test(h)), 'no token is sent')
    assert.ok(r.init.signal instanceof AbortSignal, 'a time limit: a connection that never answers ends the check')
  })

  await step("the page opened is the official release page of that version, not the answer's link", async () => {
    await call('update:openPage')
    assert.deepEqual(e2e.opened, ['https://github.com/godilman/agentbits/releases/tag/v0.9.0'])
  })

  await step('a double click and a check already running share one request', async () => {
    requests.length = 0
    let release!: () => void
    answer = () => new Promise((r) => (release = () => r({ status: 200, json: async () => ({ draft: false, prerelease: false, tag_name: 'v0.8.0' }) })))
    const a = call('update:check')
    const b = call('update:check')
    await new Promise((r) => setTimeout(r, 10))
    release()
    const [x, y] = await Promise.all([a, b])
    assert.equal(requests.length, 1)
    assert.equal(x.status, 'upToDate')
    assert.deepEqual(x, y)
  })

  await step('a prerelease or an older version is never offered; no network is an error the app shrugs off', async () => {
    answer = ok({ prerelease: true, tag_name: 'v1.0.0-rc.1' })
    assert.equal((await call('update:check')).error, 'badResponse')
    answer = ok({ tag_name: 'v0.7.1' })
    assert.equal((await call('update:check')).status, 'upToDate')
    answer = () => Promise.reject(new Error('getaddrinfo ENOTFOUND api.github.com'))
    const s = await call('update:check')
    assert.equal(s.status, 'error')
    assert.equal(s.error, 'offline')
  })

  console.log(`update e2e: ${count} steps ok`)
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e)
    process.exit(1)
  }
)
