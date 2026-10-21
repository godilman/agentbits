import type { Message } from '@shared/types'
import { apiError, call } from '@/lib/api'

/** A chat message to show (e.g. a question's card, from "Needs you"). */
export interface JumpTarget {
  projectId: string
  channel: string
  id: string
}

/**
 * The loaded history plus older messages fetched to show one of them: each message once — the loaded copy wins (it has
 * the live updates) — oldest first. Nothing loaded is dropped. Tests: `tests/renderer/chatJump.test.ts`.
 */
export function mergeHistory(loaded: Message[], fetched: Message[]): Message[] {
  const byId = new Map<string, Message>()
  const order = new Map<string, number>()
  for (const m of [...fetched, ...loaded]) if (!order.has(m.id)) order.set(m.id, order.size)
  for (const m of fetched) byId.set(m.id, m)
  for (const m of loaded) byId.set(m.id, m)
  return [...byId.values()].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : order.get(a.id)! - order.get(b.id)!))
}

export interface JumpEnv {
  activeProjectId: string | null
  channel: string
  /** The channel's loaded messages; undefined while they load. */
  loaded: Message[] | undefined
  setChannel: (channel: string) => void
  /** Adds older messages to the channel's history (merged, never replacing it). */
  addMessages: (projectId: string, channel: string, messages: Message[]) => void
  /** The rendered message, to scroll to and focus; null when it isn't rendered. */
  element: (id: string) => { scrollIntoView: (o?: ScrollIntoViewOptions) => void; focus: (o?: FocusOptions) => void } | null
  toast: (level: 'info' | 'error', text: string) => void
  /** Said when the message can't be shown after loading it. */
  goneText: string
}

/**
 * `wait`: nothing to do yet (its project is opening, the channel is loading). `switched`: its channel is being opened.
 * `loading`: older history was added; look again. `shown`: scrolled to and focused (keyboard users land on it). `gone`:
 * it isn't there (deleted, cleared, another project) — said, and the history is left as it was.
 */
export type JumpStep = 'wait' | 'switched' | 'loading' | 'shown' | 'gone'

/** One step of showing a message in the chat. `loadedOnce`: its history was fetched already (don't fetch again). */
export async function jumpStep(target: JumpTarget, env: JumpEnv, loadedOnce: boolean): Promise<JumpStep> {
  if (env.activeProjectId !== target.projectId) return 'wait'
  if (env.channel !== target.channel) {
    env.setChannel(target.channel)
    return 'switched'
  }
  if (!env.loaded) return 'wait'
  if (env.loaded.some((m) => m.id === target.id)) {
    const el = env.element(target.id)
    if (!el) {
      if (!loadedOnce) return 'wait' // rendered on the next pass
      env.toast('info', env.goneText)
      return 'gone'
    }
    el.scrollIntoView({ block: 'center' })
    el.focus({ preventScroll: true })
    return 'shown'
  }
  if (loadedOnce) {
    env.toast('info', env.goneText)
    return 'gone'
  }
  try {
    // Main checks that it is in this project's channel; only then is its part of the history added.
    const older = await call('messages:from', target.projectId, target.channel, target.id)
    env.addMessages(target.projectId, target.channel, older)
    return 'loading'
  } catch (e) {
    env.toast('info', apiError(e))
    return 'gone'
  }
}
