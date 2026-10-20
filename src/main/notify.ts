import { BrowserWindow, Notification } from 'electron'
import { redactSecrets } from '@shared/redact'
import { clip, createNotifier, taskLabel as plainLabel, type NavTarget, type NotifyEvent, type NotifyKind, type Shown } from '@shared/notify'
import { projectsRepo, settingsRepo, tasksRepo } from './db/repos'
import { emit, onEvent } from './events'
import { t } from './i18n'

/**
 * Operating-system notifications while no app window has focus (owner's rules: docs/UX_REVIEW_2026-10-19.md §8).
 * The only entry point is `notifyUser`; callers are the live event sources (replies, approvals, held / undecided
 * tasks, finished tasks) — never startup, so old events are not announced after a restart. Off with
 * `settings.notifications` (the taskbar flash too, and whatever was being collected). Back in the app → what was
 * collected is dropped and the flash stops. A click brings the window up and opens the place; nothing starts, retries,
 * is approved or merged. The flash doesn't depend on whether Windows shows the notification (it can't be known).
 * Showing never throws into the caller (a task or a chat reply goes on). When / grouping: `@shared/notify`
 * (`tests/notify.test.ts`); the sources and the clicks: `tests/e2e/notify.e2e.ts`.
 */
let started = false
let recreate: (() => void) | null = null
/** A click while there was no window: the place, until the new window's renderer is ready and asks for it. */
let pendingNav: NavTarget | null = null
// The last notifications are kept: on Windows a toast moves to the notification center when it times out ('close'
// fires) and can still be clicked there; one garbage-collected before that loses its click handler.
const alive: Notification[] = []
const KEEP = 20

/** Names an agent can write (task titles) or a user typed: secret-looking text is masked before the lock screen sees it. */
const safe = (s: string, max: number): string => clip(redactSecrets(s), max)
const taskLabel = (task: { key: string; title: string }): string => plainLabel({ key: task.key, title: redactSecrets(task.title) })

const windows = (): BrowserWindow[] => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed())
// Windows: a minimized window can stay the active ("focused") one — the user isn't looking at it.
const focused = (): boolean => windows().some((w) => w.isFocused() && !w.isMinimized() && w.isVisible())
const enabled = (): boolean => started && settingsRepo.get().notifications && !focused()

function flash(on: boolean): void {
  for (const w of windows()) w.flashFrame(on)
}

function summary(events: NotifyEvent[]): string {
  const n = (kind: NotifyKind): number => events.filter((e) => e.kind === kind).length
  return (['approval', 'needsYou', 'reply'] as const)
    .filter((k) => n(k) > 0)
    .map((k) => t(`main:notify.count.${k}`, { count: n(k) }))
    .join(' · ')
}

function show(s: Shown): void {
  // Checked again: the user may have come back, or turned notifications off, while a group was being collected.
  if (!enabled()) return
  const project = projectsRepo.get(s.projectId)
  if (!project) return // deleted meanwhile
  const urgent = s.kind === 'urgent'
  // The taskbar flash (owner's choice): for an approval or a decision waiting, not for replies or finished work.
  if (s.events.some((e) => e.kind === 'approval' || e.kind === 'needsYou')) flash(true)
  if (!Notification.isSupported()) return
  const name = safe(project.name, 40)
  const one = s.events.length === 1
  const title = one ? name : `${name} — ${t(urgent ? 'main:notify.groupUrgent' : 'main:notify.groupDone', { count: s.events.length })}`
  const lines = s.events.slice(0, 3).map((e) => e.line)
  if (s.events.length > 3) lines.push(t('main:notify.more', { count: s.events.length - 3 }))
  if (!one && urgent) lines.unshift(summary(s.events))
  const n = new Notification({ title, body: lines.join('\n'), silent: !urgent })
  const forget = (): void => {
    const i = alive.indexOf(n)
    if (i >= 0) alive.splice(i, 1)
  }
  alive.push(n)
  if (alive.length > KEEP) alive.shift()
  n.on('click', () => {
    forget()
    open(s.target)
  })
  n.on('failed', forget)
  n.show()
}

function open(target: NavTarget): void {
  let w = windows()[0]
  // A new window whose renderer hasn't taken the earlier click yet: the latest click wins, nothing is sent before.
  if (w && pendingNav) {
    pendingNav = target
    w.show()
    w.focus()
    return
  }
  if (!w) {
    // macOS: the window was closed but the app kept running — open it again; its renderer takes the place once it
    // has loaded its data and listens (`notify:takePending`), not before.
    pendingNav = target
    recreate?.()
    return
  }
  if (w.isMinimized()) w.restore()
  w.show()
  w.focus()
  emit({ type: 'navigate', target })
}

const notifier = createNotifier({
  now: () => performance.now(), // monotonic: a clock set back doesn't stretch the 10 s window
  later: (fn, ms) => {
    const timer = setTimeout(() => {
      try {
        fn()
      } catch (e) {
        console.warn('[notify]', e)
      }
    }, ms)
    return () => clearTimeout(timer)
  },
  show
})

/** The place of a notification clicked while there was no window (taken once). */
export function takePendingNav(): NavTarget | null {
  const target = pendingNav
  pendingNav = null
  return target
}

/** Drops what was being collected and stops the flash (back in the app, or notifications turned off). */
function reset(): void {
  notifier.clear()
  flash(false)
}

/** From now on events are notified (called once the window exists, after startup). `reopen`: creates the window again. */
export function startNotifications(win: BrowserWindow, reopen: () => void): void {
  recreate = reopen
  win.on('focus', reset)
  win.on('restore', reset) // restoring a window that was still the active one may fire no 'focus'
  if (started) return
  started = true
  onEvent((e) => {
    if (e.type === 'settings:changed' && !settingsRepo.get().notifications) reset()
  })
}

/** Why a task is held, as shown in a notification (never the raw error). */
export type HoldKind = 'failed' | 'limit' | 'revision' | 'commit' | 'isolation' | 'auth'
/** A finished task and its copy: no copy (shared folder) / merged into the project / waiting for a merge / conflict. */
export type MergeState = 'none' | 'merged' | 'waiting' | 'conflict'

/**
 * `event`: the event's own identity (a run, a review, an approval, a reply) — the same event from two sources is shown
 * once, a new run that fails again is a new event. `stillPending`: checked before a collected group is shown.
 */
export type UserEvent =
  | { kind: 'reply'; projectId: string; channel: string; agentName: string; replyId: string }
  | { kind: 'runApproval'; taskId: string; runId: string; stillPending: () => boolean }
  | { kind: 'connectionApproval'; projectId: string; approvalId: string; taskId: string | null; agentName: string; target: string; stillPending: () => boolean }
  | { kind: 'held'; taskId: string; why: HoldKind; event: string; stillPending: () => boolean }
  | { kind: 'undecided'; taskId: string; event: string; stillPending: () => boolean }
  | { kind: 'done'; taskId: string; event: string; merge: MergeState; raceLoser?: string }

export function notifyUser(e: UserEvent): void {
  try {
    if (!enabled()) return
    const ev = describe(e)
    if (ev) notifier.push(ev)
  } catch (err) {
    console.warn('[notify]', err) // a notification never breaks the task or the chat that caused it
  }
}

function describe(e: UserEvent): NotifyEvent | null {
  if (e.kind === 'reply') {
    return { kind: 'reply', key: `reply:${e.replyId}`, projectId: e.projectId, line: t('main:notify.reply', { agent: safe(e.agentName, 30) }), target: { projectId: e.projectId, view: 'chat', channel: e.channel } }
  }
  if (e.kind === 'connectionApproval') {
    const task = e.taskId ? tasksRepo.get(e.taskId) : null
    const target = safe(e.target, 40)
    return {
      kind: 'approval',
      key: `approval:${e.approvalId}`,
      projectId: e.projectId,
      // With a task, the task says who: the agent's name is left out (a toast shows three or four lines).
      line: task ? t('main:notify.connectionApprovalTask', { task: taskLabel(task), target }) : t('main:notify.connectionApproval', { agent: safe(e.agentName, 30), target }),
      target: task ? { projectId: e.projectId, view: 'task', taskId: task.id, approvalId: e.approvalId } : { projectId: e.projectId, view: 'tasks', approvalId: e.approvalId },
      stillPending: e.stillPending
    }
  }
  const task = tasksRepo.get(e.taskId)
  if (!task?.projectId) return null
  const label = taskLabel(task)
  const at = { projectId: task.projectId, view: 'task' as const, taskId: task.id }
  const exists = (): boolean => !!tasksRepo.get(task.id)
  switch (e.kind) {
    case 'runApproval':
      return { kind: 'approval', key: `run:${e.runId}:approval`, projectId: task.projectId, line: t('main:notify.runApproval', { task: label }), target: { ...at, runId: e.runId }, stillPending: e.stillPending }
    case 'held':
      return { kind: 'needsYou', key: e.event, projectId: task.projectId, line: t(`main:notify.held.${e.why}`, { task: label }), target: at, stillPending: e.stillPending }
    case 'undecided':
      return { kind: 'needsYou', key: e.event, projectId: task.projectId, line: t('main:notify.undecided', { task: label }), target: at, stillPending: e.stillPending }
    case 'done': {
      const line = e.raceLoser ? t(`main:notify.race.${e.merge}`, { task: label, loser: e.raceLoser }) : t(`main:notify.done.${e.merge}`, { task: label })
      return { kind: 'done', key: e.event, projectId: task.projectId, line, target: at, stillPending: exists }
    }
  }
}
