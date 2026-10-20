/**
 * When an operating-system notification is shown (pure; `main/notify.ts` builds the text and shows it; tests:
 * `tests/notify.test.ts`). Owner's rules: docs/UX_REVIEW_2026-10-19.md §8.
 *  - One notification per event: `key` is the event's own identity (a run, a review, an approval, a reply), so the
 *    same event reported by two sources is shown once, while a task that runs again and fails again is a new event.
 *  - Per project and lane: the first urgent event is shown at once; urgent events of the same lane within `windowMs`
 *    after it are collected and shown as one group when the window ends. Two lanes: approvals / "needs you" (the
 *    owner's "at once" rule — never held back by a reply) and replies. Finished tasks are always collected for
 *    `windowMs` and shown together.
 *  - Before a collected group is shown every event is checked again (`stillPending`): what no longer waits is dropped.
 *  - `clear()` (the user came back to the app, or turned notifications off) drops everything collected; nothing is
 *    shown later for it.
 */
export type NotifyKind = 'reply' | 'approval' | 'needsYou' | 'done'

/**
 * Where a click takes the user. Nothing starts, retries, is approved or merged by a click. `approvalId` / `runId`: the
 * approval the notification was about (the renderer says so when it has been answered since).
 */
export type NavTarget =
  | { projectId: string; view: 'task'; taskId: string; approvalId?: string; runId?: string }
  | { projectId: string; view: 'chat'; channel: string }
  | { projectId: string; view: 'tasks'; approvalId?: string }

export interface NotifyEvent {
  kind: NotifyKind
  /** The event's identity (see above). */
  key: string
  projectId: string
  /** One line: what happened and the step expected (no raw error, output or chat text). */
  line: string
  target: NavTarget
  /** Still true when a collected group is about to be shown? (the approval still waits, the task is still held…) */
  stillPending?: () => boolean
}

/** What is shown: one event (`events.length === 1`) or a group of one project. */
export interface Shown {
  projectId: string
  kind: 'urgent' | 'done'
  events: NotifyEvent[]
  target: NavTarget
}

export const NOTIFY_WINDOW_MS = 10_000
/** How long an event's key is remembered (the same event reported again later is still the same event). */
const KEEP_KEYS_MS = 30 * 60_000

export interface Notifier {
  push: (ev: NotifyEvent) => void
  clear: () => void
}

export function createNotifier(opts: {
  now: () => number
  /** Runs `fn` after `ms`; returns a function that cancels it. */
  later: (fn: () => void, ms: number) => () => void
  show: (s: Shown) => void
  windowMs?: number
}): Notifier {
  const windowMs = opts.windowMs ?? NOTIFY_WINDOW_MS
  const seen = new Map<string, number>()
  const urgentUntil = new Map<string, number>()
  const queues = new Map<string, { events: NotifyEvent[]; cancel: () => void }>() // `${projectId}\0action|reply|done`

  const targetOf = (projectId: string, events: NotifyEvent[]): NavTarget => {
    const first = JSON.stringify(events[0].target)
    if (events.every((e) => JSON.stringify(e.target) === first)) return events[0].target
    // Several places: the project's list for them — replies → the chat (on the first one's channel; the others are in
    // the channel list beside it), anything else → the task board.
    if (events.every((e) => e.kind === 'reply')) return events[0].target
    return { projectId, view: 'tasks' }
  }
  const queue = (projectId: string, kind: 'urgent' | 'done', lane: string, ev: NotifyEvent, flushIn: number): void => {
    const q = `${projectId}\u0000${lane}`
    const found = queues.get(q)
    if (found) return void found.events.push(ev)
    const entry = {
      events: [ev],
      cancel: opts.later(() => {
        queues.delete(q)
        const events = entry.events.filter((e) => !e.stillPending || e.stillPending())
        if (events.length) opts.show({ projectId, kind, events, target: targetOf(projectId, events) })
      }, flushIn)
    }
    queues.set(q, entry)
  }

  return {
    push(ev) {
      const t = opts.now()
      for (const [k, at] of seen) if (t - at >= KEEP_KEYS_MS) seen.delete(k)
      if (seen.has(ev.key)) return
      seen.set(ev.key, t)
      if (ev.kind === 'done') return queue(ev.projectId, 'done', 'done', ev, windowMs)
      const lane = ev.kind === 'reply' ? 'reply' : 'action'
      const w = `${ev.projectId}\u0000${lane}`
      const until = urgentUntil.get(w) ?? 0
      if (t >= until) {
        urgentUntil.set(w, t + windowMs)
        opts.show({ projectId: ev.projectId, kind: 'urgent', events: [ev], target: ev.target })
      } else queue(ev.projectId, 'urgent', lane, ev, until - t)
    },
    clear() {
      for (const q of queues.values()) q.cancel()
      queues.clear()
      urgentUntil.clear()
    }
  }
}

/** Shortens to `max` characters (user-perceived: an emoji or an accented letter is never cut in half). */
export function clip(s: string, max: number): string {
  // Direction overrides and invisible characters could make a line read differently than it is: dropped (not the
  // zero-width joiners: emoji and some scripts need them).
  const text = s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B\u200E\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  const parts = typeof Intl.Segmenter === 'function' ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map((x) => x.segment) : Array.from(text)
  return parts.length > max ? parts.slice(0, max - 1).join('').trimEnd() + '…' : text
}

/** A task as it appears in a notification: key and a short title. */
export const taskLabel = (task: { key: string; title: string }, max = 50): string => `${clip(task.title, max)} · ${task.key}`
