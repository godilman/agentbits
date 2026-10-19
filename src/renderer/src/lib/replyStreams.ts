import { useEffect, useMemo, useSyncExternalStore } from 'react'
import type { Message } from '@shared/types'
import { EMPTY_LIVE, applyReplyEvent, dropReplies, liveFor, type LiveReplies, type LiveReply } from '@shared/replyStream'
import { bridge } from './api'

/**
 * Chat replies while they are written (`reply:stream`), kept outside the global store like agent transcripts:
 * updates arrive every ~60 ms per reply and only the chat that shows them re-renders.
 */
let state: LiveReplies = EMPTY_LIVE
const listeners = new Set<() => void>()
let started = false

function set(next: LiveReplies): void {
  if (next === state) return
  state = next
  listeners.forEach((l) => l())
}

function start(): void {
  if (started) return
  started = true
  bridge().on((e) => {
    if (e.type === 'reply:stream') {
      const { type: _t, ...ev } = e
      set(applyReplyEvent(state, ev))
    } else if (e.type === 'messages:changed') set(EMPTY_LIVE)
  })
}

function subscribe(l: () => void): () => void {
  start()
  listeners.add(l)
  return () => listeners.delete(l)
}

/** Live replies of a channel, until their stored message is in `messages`. */
export function useLiveReplies(projectId: string, channel: string, messages: Message[]): LiveReply[] {
  const s = useSyncExternalStore(subscribe, () => state)
  const shown = useMemo(() => liveFor(s, projectId, channel, messages), [s, projectId, channel, messages])
  // Replies whose stored message arrived are forgotten (they would be hidden anyway).
  useEffect(() => {
    const done = Object.values(s.live).filter((r) => r.projectId === projectId && r.channel === channel && !shown.includes(r))
    if (done.length) set(dropReplies(state, done.map((r) => r.replyId)))
  }, [s, shown, projectId, channel])
  return shown
}
