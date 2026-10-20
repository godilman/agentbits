/** When notifications are shown: one per event, urgent at once, more grouped, stale dropped. Run: npm run test:unit */
import assert from 'node:assert/strict'
import { NOTIFY_WINDOW_MS, clip, createNotifier, taskLabel, type NotifyEvent, type Shown } from '../src/shared/notify.ts'

function rig(): { push: (e: NotifyEvent) => void; clear: () => void; tick: (ms: number) => void; shown: Shown[]; timers: () => number } {
  let clock = 0
  let timers: { at: number; fn: () => void; live: boolean }[] = []
  const shown: Shown[] = []
  const n = createNotifier({
    now: () => clock,
    later: (fn, ms) => {
      const x = { at: clock + ms, fn, live: true }
      timers.push(x)
      return () => void (x.live = false)
    },
    show: (s) => void shown.push(s)
  })
  const tick = (ms: number): void => {
    clock += ms
    const due = timers.filter((x) => x.at <= clock)
    timers = timers.filter((x) => x.at > clock)
    for (const x of due) if (x.live) x.fn()
  }
  return { push: n.push, clear: n.clear, tick, shown, timers: () => timers.filter((x) => x.live).length }
}
const ev = (kind: NotifyEvent['kind'], key: string, extra: Partial<NotifyEvent> = {}): NotifyEvent => ({
  kind,
  key,
  projectId: 'p1',
  line: `${kind} ${key}`,
  target: { projectId: extra.projectId ?? 'p1', view: 'task', taskId: key },
  ...extra
})

assert.equal(NOTIFY_WINDOW_MS, 10_000, "the owner's window: 10 s")

// The first approval is shown at once; urgent events within the window are held and shown as one group at its end.
{
  const r = rig()
  r.push(ev('approval', 'a'))
  assert.equal(r.shown.length, 1)
  r.tick(3000)
  r.push(ev('needsYou', 'b'))
  r.push(ev('approval', 'c'))
  assert.equal(r.shown.length, 1, 'held until the window ends')
  r.tick(7000)
  assert.equal(r.shown.length, 2)
  assert.deepEqual(r.shown[1].events.map((e) => e.kind), ['needsYou', 'approval'], 'the group keeps each kind (the text counts them)')
  assert.deepEqual(r.shown[1].target, { projectId: 'p1', view: 'tasks' }, 'different places → the project board')
  r.tick(1)
  r.push(ev('approval', 'd'))
  assert.equal(r.shown.length, 3, 'after the window: at once again')
}
// A reply never holds back an approval (the owner's "at once" rule), and an approval never holds back a reply.
{
  const r = rig()
  r.push(ev('reply', 'r', { target: { projectId: 'p1', view: 'chat', channel: 'general' } }))
  r.tick(2000)
  r.push(ev('approval', 'a'))
  assert.deepEqual(r.shown.map((s) => s.events[0].key), ['r', 'a'], 'the approval 2 s after a reply is shown at once')
}
// Replies only, in different channels → the chat.
{
  const r = rig()
  r.push(ev('reply', 'r0', { target: { projectId: 'p1', view: 'chat', channel: 'general' } }))
  r.push(ev('reply', 'r1', { target: { projectId: 'p1', view: 'chat', channel: 'general' } }))
  r.push(ev('reply', 'r2', { target: { projectId: 'p1', view: 'chat', channel: 'agent:a2' } }))
  r.tick(10_000)
  assert.deepEqual(r.shown[1].target, { projectId: 'p1', view: 'chat', channel: 'general' }, "a group of replies → the first one's chat")
}
// The same event from two sources → one notification; the same task failing again (a new run) → a new one.
{
  const r = rig()
  r.push(ev('needsYou', 'run:1:held'))
  r.push(ev('needsYou', 'run:1:held'))
  r.tick(10_000)
  assert.equal(r.shown.length, 1)
  r.push(ev('needsYou', 'run:2:held'))
  assert.equal(r.shown.length, 2, 'the retried run failed again: not silenced by the first')
}
// What no longer waits when the group is due is dropped; a group with nothing left is not shown.
{
  const r = rig()
  let waiting = true
  r.push(ev('approval', 'first'))
  r.push(ev('approval', 'second', { stillPending: () => waiting }))
  r.push(ev('needsYou', 'third'))
  waiting = false // answered meanwhile
  r.tick(10_000)
  assert.deepEqual(r.shown[1].events.map((e) => e.key), ['third'])
  const s = rig()
  s.push(ev('approval', 'one'))
  s.push(ev('approval', 'two', { stillPending: () => false }))
  s.tick(10_000)
  assert.equal(s.shown.length, 1, 'nothing left → nothing shown')
}
// Back in the app (or notifications turned off): what was collected is dropped, not shown later; timers cancelled.
{
  const r = rig()
  r.push(ev('approval', 'a'))
  r.push(ev('needsYou', 'b'))
  r.push(ev('done', 'c'))
  assert.equal(r.timers(), 2)
  r.clear()
  assert.equal(r.timers(), 0)
  r.tick(60_000)
  assert.equal(r.shown.length, 1)
  r.push(ev('approval', 'e'))
  assert.equal(r.shown.length, 2, 'after clear the next urgent event is shown at once')
}
// Finished tasks are collected and shown together; an approval meanwhile is not delayed by them.
{
  const r = rig()
  r.push(ev('done', 'x'))
  r.push(ev('done', 'y'))
  r.push(ev('approval', 'z'))
  assert.deepEqual(r.shown.map((s) => s.events[0].key), ['z'])
  r.tick(10_000)
  assert.equal(r.shown[1].kind, 'done')
  assert.deepEqual(r.shown[1].events.map((e) => e.key), ['x', 'y'])
}
// Projects are separate.
{
  const r = rig()
  r.push(ev('approval', 'a'))
  r.push(ev('approval', 'b', { projectId: 'p2' }))
  assert.equal(r.shown.length, 2)
}
// Text limits: user-perceived characters, nothing cut in half, whitespace folded.
assert.equal(taskLabel({ key: 'TA-1', title: 'Short' }), 'Short · TA-1', 'the name first, the key last (owner, 2026-10-20)')
assert.equal(taskLabel({ key: 'TA-2', title: 'x'.repeat(80) }), `${'x'.repeat(49)}… · TA-2`)
assert.equal(clip('👩‍👩‍👧‍👦'.repeat(6), 4), '👩‍👩‍👧‍👦'.repeat(3) + '…', 'a family emoji stays whole')
assert.equal(clip('İçerik düzeltmesi: ÇĞÖŞÜ ağaç', 12), 'İçerik düze…')
assert.equal(clip('a\n\n  b', 10), 'a b')
assert.equal(clip('Onayla\u202Eesrever\u200B\u0007 son', 30), 'Onaylaesrever son', 'direction overrides and control characters are dropped')
console.log('notify: ok')
