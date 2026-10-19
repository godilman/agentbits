import { REPLY_STREAM_MS, visibleReply, type ReplyStreamEvent } from '@shared/replyStream'
import { emit } from '../events'

type Base = Pick<ReplyStreamEvent, 'replyId' | 'projectId' | 'channel' | 'agentId'>

/**
 * A chat reply shown while it is written: `push` collects the provider's chunks and sends the visible text at most
 * every REPLY_STREAM_MS for this reply; `end` sends the last state once (later chunks and timers are dropped). A stop
 * ends it at once (cancelled), without waiting for the provider to return.
 */
export function startReplyStream(base: Base, signal: AbortSignal) {
  let raw = ''
  let shown = ''
  let shownHiding: string | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let done = false
  const flush = (): void => {
    timer = null
    if (done || signal.aborted) return
    const v = visibleReply(raw, false)
    if (v.text === shown && v.hiding === shownHiding) return
    shown = v.text
    shownHiding = v.hiding
    emit({ type: 'reply:stream', ...base, state: 'update', text: v.text, hiding: v.hiding })
  }
  emit({ type: 'reply:stream', ...base, state: 'start' })
  const onAbort = (): void => stream.end('cancelled')
  const stream = {
    replyId: base.replyId,
    push(chunk: string): void {
      if (done || signal.aborted) return
      raw += chunk
      if (!timer) timer = setTimeout(flush, REPLY_STREAM_MS)
    },
    end(state: 'complete' | 'error' | 'cancelled', messageId?: string): void {
      if (done) return
      done = true
      signal.removeEventListener('abort', onAbort)
      if (timer) clearTimeout(timer)
      timer = null
      emit({ type: 'reply:stream', ...base, state, ...(messageId ? { messageId } : {}) })
    },
    get ended(): boolean {
      return done
    }
  }
  if (signal.aborted) stream.end('cancelled')
  else signal.addEventListener('abort', onAbort)
  return stream
}
