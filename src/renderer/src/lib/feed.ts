import type { Message } from '@shared/types'

/**
 * One event, one line: main posts some events to #general and to task threads with a shared `meta.event`
 * (`orchestrator.ts` `sameEvent`); the live feed keeps the #general copy (or the first, when none is in #general).
 * Nothing else is merged — not by matching text, sender or a task key — so different notes always stay.
 * Tests: `tests/renderer/feed.test.ts`.
 */
export function dedupeFeed(messages: Message[]): Message[] {
  const keep = new Map<string, Message>()
  for (const m of messages) {
    const ev = typeof m.meta?.event === 'string' ? m.meta.event : null
    if (!ev) continue
    const k = keep.get(ev)
    if (!k || (k.channel !== 'general' && m.channel === 'general')) keep.set(ev, m)
  }
  return messages.filter((m) => {
    const ev = typeof m.meta?.event === 'string' ? m.meta.event : null
    return !ev || keep.get(ev) === m
  })
}
