import type { NeedsCard, NeedsOutcome, NeedsResolution } from '@shared/types'
import { getDb } from '../db'
import { messagesRepo } from '../db/repos'
import { emit } from '../events'

/**
 * "Needs you" cards: a system message in the project's #general (and the same event in the task's thread) that says
 * what waits for the user and offers the actions the app really has for it. Every copy shares `meta.event`, so the live
 * feed shows it once and a decision taken anywhere closes all of them (`resolveCards`). The card is never the authority:
 * `orchestrator.act` checks the wait itself. Tests: `tests/e2e/needsCards.e2e.ts`.
 */
export function postCard(
  projectId: string | null,
  taskId: string | null,
  text: string,
  card: NeedsCard,
  taskText = text,
  opts: { event?: string; general?: boolean } = {}
): void {
  // `event`: the live-feed event when several cards belong to one (a race's two attempts); default the card's own.
  const meta = { event: opts.event ?? card.event, needsYou: true, card }
  if (opts.general !== false) emit({ type: 'message:new', message: messagesRepo.create('general', 'system', null, text, projectId, meta) })
  if (taskId) emit({ type: 'message:new', message: messagesRepo.create(`task:${taskId}`, 'system', null, taskText, projectId, meta) })
}

/** Marks every still-open copy of a wait's card with how it ended. Throws when it can't be written (callers decide). */
export function resolveCards(projectId: string | null, event: string, outcome: NeedsOutcome): number {
  const rows = getDb()
    .prepare(
      `SELECT id FROM messages WHERE project_id IS ? AND json_extract(meta, '$.card.event') = ?
         AND json_extract(meta, '$.resolution') IS NULL`
    )
    .all(projectId, event) as { id: string }[]
  const resolution: NeedsResolution = { outcome, at: new Date().toISOString() }
  for (const r of rows) {
    const m = messagesRepo.setMeta(r.id, { resolution })
    if (m) emit({ type: 'message:updated', message: m })
  }
  return rows.length
}

/** The wait ended: close its cards. A failed write is logged, never undoes or repeats the action (the wait is gone). */
export function endWait(projectId: string | null, event: string | null | undefined, outcome: NeedsOutcome): boolean {
  if (!event) return true
  try {
    resolveCards(projectId, event, outcome)
    return true
  } catch (e) {
    console.warn('[agentbits] could not record how a wait ended', event, e)
    return false
  }
}
