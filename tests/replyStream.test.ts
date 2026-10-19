/** Live chat replies: hidden-block filter at every chunk boundary, and the stream state. Run: npm run test:unit */
import assert from 'node:assert/strict'
import { EMPTY_LIVE, applyReplyEvent, dropReplies, liveFor, visibleReply, type LiveReplies, type ReplyStreamEvent } from '../src/shared/replyStream.ts'

// ── Filter ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const SECRET = 'GIZLI'
const samples = [
  // a lead's plan: text, a tasks block, more text
  `Tamam, işi böldüm.\n\`\`\`tasks\n[{"title":"${SECRET}-1"}]\n\`\`\`\nBaşlıyoruz.`,
  // several hidden blocks, back to back, and a normal code block that must stay
  `Önce şu:\n\`\`\`js\nconst x = 1\n\`\`\`\n\`\`\`decision\n{"title":"${SECRET}-2"}\n\`\`\`\n\`\`\`learn\n[{"text":"${SECRET}-3"}]\n\`\`\`\nSon.`,
  // a hidden block that is never closed
  `Not alıyorum.\n\`\`\`message\n[{"to":"Ada","text":"${SECRET}-4"`,
  // inline code and backticks that are not fences
  'Komut: `ls -la` ve ``çift`` tırnak.',
  // a code block named like the start of a hidden one
  'Örnek:\n```ta-ble\nx\n```\nbitti'
]
for (const full of samples) {
  const final = visibleReply(full, true).text
  assert.ok(!final.includes(SECRET), 'the final text hides every block')
  for (let cut = 0; cut <= full.length; cut++) {
    const v = visibleReply(full.slice(0, cut), false)
    assert.ok(!v.text.includes(SECRET), `no hidden text at ${cut}: ${JSON.stringify(v.text)}`)
    assert.doesNotMatch(v.text, /```(t|ta|tas|task|tasks|d|de|dec|deci|decis|decisi|decisio|decision|m|me|mes|mess|messa|messag|message|l|le|lea|lear|learn)\s*$/, `no half fence at ${cut}`)
    assert.ok(final.startsWith(v.text), `the live text is always the start of the final one (cut ${cut}): ${JSON.stringify(v.text)}`)
  }
}
assert.match(visibleReply(samples[1], true).text, /```js\nconst x = 1\n```/, 'a normal code block stays')
assert.match(visibleReply(samples[4], true).text, /```ta-ble/, 'a code block that only starts like one stays')
assert.equal(visibleReply(samples[2], true).text, 'Not alıyorum.', 'an unclosed hidden block is hidden in the final text too')
assert.equal(visibleReply('Tamam.\n```tas', false).text, 'Tamam.', '"```ta" + "sks": held back until clear')
assert.equal(visibleReply('Tamam.\n```tasks\n[', false).hiding, 'tasks', 'the open block is named (shown as "preparing tasks")')
assert.equal(visibleReply('Tamam.\n```js', false).text, 'Tamam.\n```js', 'not a hidden name: shown right away')
assert.equal(visibleReply('a `', false).text, 'a', 'a lone backtick may become a fence: held')
assert.equal(visibleReply('a `x`', false).text, 'a `x', 'a closing backtick at the very end waits for the next chunk')
assert.equal(visibleReply('a `x` b', false).text, 'a `x` b')
assert.equal(visibleReply('a `x`', true).text, 'a `x`', 'the final text has it')

// ── Stream state ────────────────────────────────────────────────────────────────────────────────────────────────────
const base = { projectId: 'p1', channel: 'general', agentId: 'atlas' }
const ev = (replyId: string, state: ReplyStreamEvent['state'], extra: Partial<ReplyStreamEvent> = {}): ReplyStreamEvent => ({ replyId, state, ...base, ...extra })
let s: LiveReplies = EMPTY_LIVE

// Two replies in the same channel at the same time: each keeps its own bubble.
s = applyReplyEvent(s, ev('r1', 'start'))
s = applyReplyEvent(s, ev('r2', 'start'))
s = applyReplyEvent(s, ev('r1', 'update', { text: 'birinci' }))
s = applyReplyEvent(s, ev('r2', 'update', { text: 'ikinci' }))
assert.deepEqual(liveFor(s, 'p1', 'general', []).map((r) => r.text).sort(), ['birinci', 'ikinci'])

// r1 completes; its stored message arrives: no gap (shown until the message is there), no double (hidden once it is).
s = applyReplyEvent(s, ev('r1', 'complete', { messageId: 'm1' }))
assert.deepEqual(liveFor(s, 'p1', 'general', []).map((r) => r.replyId).sort(), ['r1', 'r2'], 'before the message arrives: still shown')
const withMsg = [{ id: 'm1', meta: { replyId: 'r1' } }]
assert.deepEqual(liveFor(s, 'p1', 'general', withMsg).map((r) => r.replyId), ['r2'], 'r1 replaced by its message, r2 untouched')
assert.deepEqual(liveFor(s, 'p1', 'general', [{ id: 'other', meta: { replyId: 'r1' } }]).map((r) => r.replyId), ['r2'], 'matched by meta.replyId too')
s = dropReplies(s, ['r1'])
assert.equal(s.live.r1, undefined)

// A late update after the end never brings a bubble back.
s = applyReplyEvent(s, ev('r1', 'update', { text: 'geç parça' }))
assert.equal(s.live.r1, undefined)

// Error before the first chunk: the bubble goes, nothing stays behind.
s = applyReplyEvent(s, ev('r3', 'start'))
s = applyReplyEvent(s, ev('r3', 'error'))
assert.equal(s.live.r3, undefined)
assert.equal(applyReplyEvent(s, ev('r3', 'update', { text: 'x' })), s, 'nothing after an error')

// Cancel racing the last chunk: whichever comes second, cancelled wins.
s = applyReplyEvent(s, ev('r4', 'start'))
s = applyReplyEvent(s, ev('r4', 'cancelled'))
s = applyReplyEvent(s, ev('r4', 'update', { text: 'son parça' }))
assert.equal(s.live.r4, undefined)

// Switching projects: replies belong to their project and channel; the other project sees none, coming back shows it.
s = applyReplyEvent(s, ev('r5', 'update', { projectId: 'p2', text: 'p2 yanıtı' }))
assert.deepEqual(liveFor(s, 'p1', 'general', []).map((r) => r.replyId), ['r2'])
assert.deepEqual(liveFor(s, 'p2', 'general', []).map((r) => r.text), ['p2 yanıtı'])
assert.deepEqual(liveFor(s, 'p1', 'agent:atlas', []), [], 'and channels are separate')

// An update with nothing new returns the same state (no re-render).
assert.equal(applyReplyEvent(s, ev('r2', 'update', { text: 'ikinci' })), s)

// The "ended" list is bounded.
let big = EMPTY_LIVE
for (let i = 0; i < 700; i++) big = applyReplyEvent(big, ev(`x${i}`, 'cancelled'))
assert.equal(Object.keys(big.ended).length, 500)
assert.ok(big.ended.x699 && !big.ended.x0)

console.log('replyStream: filter at every chunk boundary and stream state ok')
