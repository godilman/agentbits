/** Checking for a new version: stable releases only, never a downgrade, one check at a time, no retry storm. Run: npm run test:unit */
import assert from 'node:assert/strict'
import { CHECK_EVERY_MS, LATEST_RELEASE_API, createChecker, isNewer, parseStable, readRelease, releasePage, type UpdateState } from '../src/shared/update.ts'

assert.equal(LATEST_RELEASE_API, 'https://api.github.com/repos/godilman/agentbits/releases/latest', 'fixed, HTTPS, the public repository')
assert.equal(CHECK_EVERY_MS, 6 * 3600_000)

// Versions: stable x.y.z only.
assert.deepEqual(parseStable('v0.8.0'), [0, 8, 0])
for (const bad of ['0.9.0-beta.1', 'v1.0.0+build', '1.0', 'latest', '', ' 1.0.0', 1]) assert.equal(parseStable(bad), null, String(bad))
assert.ok(isNewer('0.9.0', '0.8.0') && isNewer('0.10.0', '0.9.9') && isNewer('1.0.0', '0.99.99'))
assert.ok(!isNewer('0.8.0', '0.8.0') && !isNewer('0.7.1', '0.8.0'), 'same or older is never offered (no downgrade)')
assert.ok(!isNewer('0.9.0-rc.1', '0.8.0'), 'a prerelease tag is never offered')

// The answer: published and stable, or nothing.
const rel = (o: object) => ({ draft: false, prerelease: false, tag_name: 'v0.9.0', html_url: 'https://evil.example/', ...o })
assert.equal(readRelease(rel({})), '0.9.0')
assert.equal(readRelease(rel({ draft: true })), null)
assert.equal(readRelease(rel({ prerelease: true })), null)
assert.equal(readRelease(rel({ draft: undefined })), null, 'missing flags are not "published"')
assert.equal(readRelease(rel({ tag_name: 'v0.9.0-beta' })), null)
assert.equal(readRelease(null), null)
// The page opened is built from the version, never from the answer's URL.
assert.equal(releasePage('0.9.0'), 'https://github.com/godilman/agentbits/releases/tag/v0.9.0')
assert.equal(releasePage('../../evil'), 'https://github.com/godilman/agentbits/releases')
assert.equal(releasePage(undefined), 'https://github.com/godilman/agentbits/releases')

function rig(answer: () => Promise<{ status: number; body: unknown }>) {
  let clock = 1_000_000
  let calls = 0
  const seen: UpdateState[] = []
  const c = createChecker({
    current: '0.8.0',
    now: () => clock,
    fetchLatest: () => {
      calls++
      return answer()
    },
    onChange: (s) => void seen.push(s)
  })
  return { c, seen, calls: () => calls, tick: (ms: number) => void (clock += ms) }
}

async function main(): Promise<void> {
  // Newer → available; same → up to date.
  {
    const r = rig(async () => ({ status: 200, body: rel({}) }))
    assert.deepEqual(r.c.state(), { status: 'idle', current: '0.8.0' })
    const s = await r.c.check()
    assert.equal(s.status, 'available')
    assert.equal(s.latest, '0.9.0')
    assert.deepEqual(r.seen.map((x) => x.status), ['checking', 'available'])
    const same = rig(async () => ({ status: 200, body: rel({ tag_name: 'v0.8.0' }) }))
    assert.equal((await same.c.check()).status, 'upToDate')
    const older = rig(async () => ({ status: 200, body: rel({ tag_name: 'v0.7.1' }) }))
    assert.equal((await older.c.check()).status, 'upToDate', 'an older latest release is not a downgrade offer')
    const none = rig(async () => ({ status: 404, body: {} }))
    assert.equal((await none.c.check()).status, 'upToDate', 'no published release yet')
  }
  // One check at a time: a double click and the timer share one request.
  {
    let release!: () => void
    const r = rig(() => new Promise((ok) => (release = () => ok({ status: 200, body: rel({}) }))))
    const a = r.c.check()
    const b = r.c.check()
    assert.equal(a, b)
    release()
    await a
    assert.equal(r.calls(), 1)
    const again = r.c.check()
    release()
    await again
    assert.equal(r.calls(), 2, 'after it finished, a new check runs')
  }
  // Errors are told apart; a found version stays shown when a later check fails.
  {
    const offline = rig(async () => {
      throw new Error('ENOTFOUND')
    })
    assert.deepEqual(await offline.c.check(), { status: 'error', error: 'offline', current: '0.8.0', checkedAt: 1_000_000, latest: undefined })
    assert.equal((await rig(async () => ({ status: 403, body: {} })).c.check()).error, 'rateLimited')
    assert.equal((await rig(async () => ({ status: 500, body: {} })).c.check()).error, 'failed')
    assert.equal((await rig(async () => ({ status: 200, body: { tag_name: 'v9.9.9' } })).c.check()).error, 'badResponse')
    let fail = false
    const r = rig(async () => {
      if (fail) throw new Error('offline')
      return { status: 200, body: rel({}) }
    })
    await r.c.check()
    fail = true
    const s = await r.c.check()
    assert.equal(s.status, 'error')
    assert.equal(s.latest, '0.9.0')
  }
  // Due: once per 6 hours of wall-clock time, counted from the last start (a failed check counts too).
  {
    const r = rig(async () => {
      throw new Error('offline')
    })
    assert.ok(r.c.due(), 'never checked → due')
    await r.c.check()
    assert.ok(!r.c.due())
    r.tick(CHECK_EVERY_MS - 1)
    assert.ok(!r.c.due(), 'a failure does not bring the next try forward')
    r.tick(1)
    assert.ok(r.c.due())
    r.tick(3 * CHECK_EVERY_MS) // back from a long sleep: one check is due, not three
    await r.c.check()
    assert.ok(!r.c.due())
    r.tick(-3600_000) // the clock set back an hour: due, not silent until it catches up
    assert.ok(r.c.due())
  }
  console.log('update: ok')
  finished = true
}
// A promise that never settles would end the process quietly with code 0.
let finished = false
process.on('beforeExit', () => {
  if (!finished) {
    console.error('update: a check never finished')
    process.exit(1)
  }
})

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
