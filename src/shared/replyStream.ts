/**
 * Live chat replies (the text appears while the agent writes). Pure parts shared by main, renderer and tests:
 * the hidden-block filter (also used for the final message, so both follow the same rules) and the stream state.
 * `tests/replyStream.test.ts`.
 */

/** Blocks of a reply that Agentbits acts on and never shows (tasks, decisions, notes to the team, learning). */
export const HIDDEN_BLOCKS = ['tasks', 'decision', 'message', 'learn'] as const
export type HiddenBlock = (typeof HIDDEN_BLOCKS)[number]

/** One update per reply at most this often (ms). */
export const REPLY_STREAM_MS = 60

const OPEN = new RegExp('```(' + HIDDEN_BLOCKS.join('|') + ')\\s*\\n', 'g')

/** A tail that could still grow into a hidden block's opening fence (e.g. "``", "```ta", "```tasks  "). */
function couldOpen(tail: string): boolean {
  const m = /^(`{1,3})([a-z]*)(\s*)$/.exec(tail)
  if (!m) return false
  const [, ticks, name, space] = m
  if (ticks.length < 3) return !name && !space
  if (!name) return !space
  return HIDDEN_BLOCKS.some((b) => (space ? b === name : b.startsWith(name)))
}

/**
 * What the user sees of a reply. Complete hidden blocks are removed; a hidden block that is not closed hides everything
 * after its fence (`hiding` names it). While streaming (`final` false), a tail that might become a hidden fence is held
 * back until it is clear, so a block name split across chunks ("```ta" + "sks") never shows. Normal code blocks stay.
 */
export function visibleReply(text: string, final: boolean): { text: string; hiding: HiddenBlock | null } {
  let out = ''
  let i = 0
  OPEN.lastIndex = 0
  for (;;) {
    OPEN.lastIndex = i
    const m = OPEN.exec(text)
    if (!m) break
    out += text.slice(i, m.index)
    const close = text.indexOf('```', m.index + m[0].length)
    if (close < 0) return { text: out.trim(), hiding: final ? null : (m[1] as HiddenBlock) }
    i = close + 3
  }
  let rest = text.slice(i)
  if (!final) {
    for (let k = Math.max(0, rest.length - 40); k < rest.length; k++) {
      if (rest[k] === '`' && (k === 0 || rest[k - 1] !== '`') && couldOpen(rest.slice(k))) {
        rest = rest.slice(0, k)
        break
      }
    }
  }
  return { text: (out + rest).trim(), hiding: null }
}

export type ReplyStreamState = 'start' | 'update' | 'complete' | 'error' | 'cancelled'

/** One event of a live reply (main → renderer). `text` is the whole visible text so far. */
export interface ReplyStreamEvent {
  replyId: string
  projectId: string
  channel: string
  agentId: string
  state: ReplyStreamState
  text?: string
  hiding?: HiddenBlock | null
  /** complete: the stored message that replaces the live one (its meta.replyId is the same). */
  messageId?: string
}

export interface LiveReply {
  replyId: string
  projectId: string
  channel: string
  agentId: string
  text: string
  hiding: HiddenBlock | null
  /** Set when the reply is complete: shown until that message is in the channel. */
  messageId: string | null
}

export interface LiveReplies {
  live: Record<string, LiveReply>
  /** Replies that ended (complete / error / cancelled): a late update never brings them back. */
  ended: Record<string, true>
}

export const EMPTY_LIVE: LiveReplies = { live: {}, ended: {} }

/** Applies one stream event (returns the same object when nothing changes). */
export function applyReplyEvent(s: LiveReplies, e: ReplyStreamEvent): LiveReplies {
  const cur = s.live[e.replyId]
  if (e.state === 'start' || e.state === 'update') {
    if (s.ended[e.replyId]) return s
    const next: LiveReply = {
      replyId: e.replyId,
      projectId: e.projectId,
      channel: e.channel,
      agentId: e.agentId,
      text: e.text ?? cur?.text ?? '',
      hiding: e.hiding ?? null,
      messageId: null
    }
    if (cur && cur.text === next.text && cur.hiding === next.hiding) return s
    return { ...s, live: { ...s.live, [e.replyId]: next } }
  }
  const ended: Record<string, true> = { ...s.ended, [e.replyId]: true }
  const keys = Object.keys(ended)
  if (keys.length > 500) for (const k of keys.slice(0, keys.length - 500)) delete ended[k]
  const live = { ...s.live }
  // Complete with a message: keep the last text until that message shows, so there is no gap and no double.
  if (e.state === 'complete' && e.messageId && cur) live[e.replyId] = { ...cur, text: e.text ?? cur.text, hiding: null, messageId: e.messageId }
  else delete live[e.replyId]
  return { live, ended }
}

/** Live replies to show in a channel: not yet replaced by their stored message (matched by id or meta.replyId). */
export function liveFor(
  s: LiveReplies,
  projectId: string,
  channel: string,
  messages: { id: string; meta?: Record<string, unknown> | null }[]
): LiveReply[] {
  const stored = new Set<string>()
  for (const m of messages) {
    stored.add(m.id)
    if (typeof m.meta?.replyId === 'string') stored.add(m.meta.replyId)
  }
  return Object.values(s.live).filter(
    (r) => r.projectId === projectId && r.channel === channel && !stored.has(r.replyId) && !(r.messageId && stored.has(r.messageId))
  )
}

/** Forgets replies whose stored message has arrived (`replyIds` from liveFor's caller). */
export function dropReplies(s: LiveReplies, replyIds: string[]): LiveReplies {
  if (!replyIds.some((id) => s.live[id])) return s
  const live = { ...s.live }
  for (const id of replyIds) delete live[id]
  return { ...s, live }
}
