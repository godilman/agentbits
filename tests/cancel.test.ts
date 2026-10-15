/** Stopping a run cuts off its database / SSH call at once (security review #08). Run: npm run test:unit */
import assert from 'node:assert/strict'
import { cancellable } from '../src/shared/cancel.ts'

const cancelled = (): Error => new Error('cancelled')
const never = (): Promise<string> => new Promise(() => undefined)

// no signal: plain passthrough
assert.equal(await cancellable(undefined, async () => 'ok', cancelled), 'ok')
await assert.rejects(cancellable(undefined, async () => Promise.reject(new Error('db down')), cancelled), /db down/)

// already aborted: fn never runs
{
  const c = new AbortController()
  c.abort()
  let ran = false
  await assert.rejects(cancellable(c.signal, async () => ((ran = true), 'x'), cancelled), /cancelled/)
  assert.equal(ran, false)
}

// abort while running: rejects at once (does not wait for the hanging call) and drops the connection
{
  const c = new AbortController()
  let dropped = 0
  const t0 = Date.now()
  const p = cancellable(c.signal, (onAbort) => (onAbort(() => dropped++), never()), cancelled)
  setTimeout(() => c.abort(), 20)
  await assert.rejects(p, /cancelled/)
  assert.ok(Date.now() - t0 < 1000)
  assert.equal(dropped, 1)
}

// a drop registered after the abort runs immediately
{
  const c = new AbortController()
  let dropped = 0
  const p = cancellable(c.signal, async (onAbort) => {
    await new Promise((r) => setTimeout(r, 30))
    onAbort(() => dropped++)
    return never()
  }, cancelled)
  setTimeout(() => c.abort(), 5)
  await assert.rejects(p, /cancelled/)
  await new Promise((r) => setTimeout(r, 50))
  assert.equal(dropped, 1)
}

// finishing normally leaves no listener behind: a later abort does not drop anything
{
  const c = new AbortController()
  let dropped = 0
  assert.equal(await cancellable(c.signal, async (onAbort) => (onAbort(() => dropped++), 'rows'), cancelled), 'rows')
  c.abort()
  assert.equal(dropped, 0)
}
console.log('cancel: stopped runs cut off their calls')
