import { create } from 'zustand'
import type { MessageDraft } from '@shared/types'
import { t } from '@/i18n'
import { apiError, call } from '@/lib/api'
import { useAppStore } from '@/store/useAppStore'

/**
 * Unsent messages, per project + channel, kept across restarts (main: `message_drafts`). The text and the attachments
 * whose upload finished; a successful send clears only what it sent, a failed one keeps it. Saves are batched per draft.
 * `textRev` marks a text edit; it comes from one counter that never repeats (not even when a draft is emptied and
 * written again), so a late send can't take a newer text for the one it sent. Not stored.
 * Regression tests: `tests/renderer/drafts.test.ts` (`npm run test:renderer`).
 */
type Files = MessageDraft['files']
type Draft = Pick<MessageDraft, 'text' | 'files'> & { textRev: number }
const EMPTY: Draft = { text: '', files: [], textRev: 0 }

let revs = 0
const nextRev = (): number => ++revs

export const useDrafts = create<{ drafts: Record<string, Draft>; loaded: boolean }>(() => ({ drafts: {}, loaded: false }))

export const draftKey = (projectId: string, channel: string): string => `${projectId}\u0000${channel}`
const keyParts = (k: string): [string, string] => k.split('\u0000') as [string, string]

/**
 * Until the saved list has arrived (from the start, across retries) an edit doesn't know the saved draft: what changed
 * is kept per field — the text, and which attachments were added or removed — and nothing is saved yet. When the list
 * arrives the two are merged (the user's changes win, the saved attachments they didn't remove stay) and then saved.
 */
type Early = { text: boolean; added: Map<string, Files[number]>; removed: Set<string> }
let early: Map<string, Early> | null = new Map()

function noteEarly(k: string, before: Files, patch: Partial<Pick<Draft, 'text' | 'files'>>): void {
  if (!early) return
  const e = early.get(k) ?? { text: false, added: new Map(), removed: new Set<string>() }
  if (patch.text !== undefined) e.text = true
  if (patch.files) {
    const was = new Set(before.map((f) => f.id))
    const now = new Set(patch.files.map((f) => f.id))
    for (const f of patch.files) {
      if (!was.has(f.id)) {
        e.added.set(f.id, f)
        e.removed.delete(f.id)
      }
    }
    for (const id of was) {
      if (!now.has(id)) {
        e.added.delete(id)
        e.removed.add(id)
      }
    }
  }
  early.set(k, e)
}

export async function loadDrafts(): Promise<void> {
  try {
    const list = await call('drafts:list')
    const merged: string[] = []
    useDrafts.setState((s) => {
      const drafts: Record<string, Draft> = {}
      for (const d of list) drafts[draftKey(d.projectId, d.channel)] = { text: d.text, files: d.files, textRev: nextRev() }
      for (const [k, e] of early ?? []) {
        const saved = drafts[k] ?? EMPTY
        const local = s.drafts[k] ?? EMPTY
        const files = [...saved.files.filter((f) => !e.removed.has(f.id)), ...[...e.added.values()].filter((f) => !saved.files.some((x) => x.id === f.id))]
        const next = e.text ? { text: local.text, files, textRev: local.textRev } : { ...saved, files }
        if (next.text || next.files.length) drafts[k] = next
        else delete drafts[k]
        merged.push(k)
      }
      return { drafts, loaded: true }
    })
    early = null
    // What was changed before the list arrived is saved now, merged.
    for (const k of merged) save(k)
  } catch (e) {
    // Shown, and tried again later; nothing changed meanwhile is lost (it merges the same way).
    useAppStore.getState().toast('error', t('layout:draftsLoadFailed', { error: apiError(e) }))
    setTimeout(() => void loadDrafts(), 5000)
  }
}

const pending = new Map<string, { timer: ReturnType<typeof setTimeout>; save: () => void }>()

function save(k: string): void {
  const before = pending.get(k)
  if (before) clearTimeout(before.timer)
  pending.delete(k)
  const [projectId, channel] = keyParts(k)
  const d = useDrafts.getState().drafts[k] ?? EMPTY
  void call('drafts:save', { projectId, channel, text: d.text, files: d.files }).catch((e) => useAppStore.getState().toast('error', apiError(e)))
}

function apply(projectId: string, channel: string, patch: Partial<Pick<Draft, 'text' | 'files'>>, rev: number | null, now: boolean): void {
  const k = draftKey(projectId, channel)
  const cur = useDrafts.getState().drafts[k] ?? EMPTY
  noteEarly(k, cur.files, patch)
  const next: Draft = { ...cur, ...patch, textRev: rev ?? cur.textRev }
  useDrafts.setState((s) => {
    const drafts = { ...s.drafts }
    if (next.text || next.files.length) drafts[k] = next
    else delete drafts[k]
    return { drafts }
  })
  if (early) return // saved once the list has arrived and been merged
  const before = pending.get(k)
  if (before) clearTimeout(before.timer)
  if (now) save(k)
  else pending.set(k, { timer: setTimeout(() => save(k), 400), save: () => save(k) })
}

/** Changes a draft (`now`: save at once — a removal; typing waits a moment). */
export function setDraft(projectId: string, channel: string, patch: Partial<Pick<Draft, 'text' | 'files'>>, now = false): void {
  apply(projectId, channel, patch, patch.text !== undefined ? nextRev() : null, now)
}

/** What a send starts from: the draft's text and its edit mark right now. */
export function draftSnapshot(projectId: string, channel: string): { text: string; textRev: number } {
  const d = useDrafts.getState().drafts[draftKey(projectId, channel)] ?? EMPTY
  return { text: d.text, textRev: d.textRev }
}

/**
 * After a successful send, for the draft it was sent from (not whatever is on screen now): the text goes only if it
 * wasn't edited since (`textRev`; pass -1 when the sent text didn't come from the draft), and only the sent attachments go.
 */
export function clearSent(projectId: string, channel: string, sent: { textRev: number; fileIds: string[] }): void {
  const cur = useDrafts.getState().drafts[draftKey(projectId, channel)]
  if (!cur) return
  const gone = new Set(sent.fileIds)
  const clearText = cur.textRev === sent.textRev && cur.text !== ''
  const files = cur.files.filter((f) => !gone.has(f.id))
  if (!clearText && files.length === cur.files.length) return
  apply(projectId, channel, { ...(clearText ? { text: '' } : {}), files }, clearText ? nextRev() : null, true)
}

export function useDraft(projectId: string | null, channel: string): Draft {
  return useDrafts((s) => (projectId ? s.drafts[draftKey(projectId, channel)] : undefined)) ?? EMPTY
}

// Closing the window: what was typed in the last moment is sent too (best effort; the IPC message leaves at once).
// Before the saved list arrived nothing is sent (it would overwrite attachments not known yet).
window.addEventListener('beforeunload', () => {
  for (const p of [...pending.values()]) {
    clearTimeout(p.timer)
    p.save()
  }
})
