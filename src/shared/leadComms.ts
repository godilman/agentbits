/**
 * Lead ↔ team communication (pure helpers; `tests/leadComms.test.ts`). Only the project lead talks to the team:
 * it sees finished work through report excerpts and leaves notes on tasks with a ```message block.
 * Team members never message each other — the orchestrator parses these blocks only from the lead's chat reply.
 */

export interface LeadMessage {
  /** Task key, e.g. "TA-12" (upper-cased). */
  task: string
  text: string
}

export const MAX_LEAD_MESSAGES = 10
export const MAX_LEAD_MESSAGE_CHARS = 4000

const KEY = /^[A-Za-z][A-Za-z0-9]{0,9}-\d{1,6}$/

/** ```message blocks → valid notes (a task key and non-empty text); anything else is dropped. */
export function parseLeadMessages(text: string): LeadMessage[] {
  const out: LeadMessage[] = []
  for (const m of text.matchAll(/```message\s*\n([\s\S]*?)```/g)) {
    let v: unknown
    try {
      v = JSON.parse(m[1])
    } catch {
      continue
    }
    for (const item of Array.isArray(v) ? v : [v]) {
      if (!item || typeof item !== 'object') continue
      const { task, text: body } = item as Record<string, unknown>
      if (typeof task !== 'string' || typeof body !== 'string') continue
      const key = task.trim().replace(/^\[|\]$/g, '')
      const msg = body.trim()
      if (!KEY.test(key) || !msg) continue
      out.push({ task: key.toUpperCase(), text: msg.slice(0, MAX_LEAD_MESSAGE_CHARS) })
      if (out.length >= MAX_LEAD_MESSAGES) return out
    }
  }
  return out
}

/** Summary + Notes of a work report, cut to `max` chars — what the lead needs to know about finished work. */
export function reportExcerpt(md: string, max = 400): string {
  const section = (name: RegExp): string => {
    const m = new RegExp(`^##\\s*(?:${name.source})[^\\n]*\\n([\\s\\S]*?)(?=^##\\s|$(?![\\s\\S]))`, 'im').exec(md)
    return m ? m[1].trim() : ''
  }
  const summary = section(/summary|özet/) // i18n-ignore
  const notes = section(/notes|notlar/)
  const body = [summary, notes && `Notes: ${notes}`].filter(Boolean).join(' · ') || md
  const flat = body.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat
}

/**
 * "after" of a planned task → dependency ids. Numbers (or digit strings) are 1-based positions of EARLIER tasks in the
 * same block, anything else an existing task key resolved by `byKey` (same project only). Later or own positions are
 * ignored, so a block can never create a cycle.
 */
export function resolveAfter(after: unknown, position: number, earlierIds: string[], byKey: (key: string) => string | undefined): string[] {
  const refs = Array.isArray(after) ? after : after === undefined || after === null ? [] : [after]
  const out: string[] = []
  for (const ref of refs.slice(0, 20)) {
    const text = String(ref).trim()
    const n = typeof ref === 'number' ? ref : /^\d+$/.test(text) ? Number(text) : NaN
    const id = Number.isFinite(n) ? (Number.isInteger(n) && n >= 1 && n <= position ? earlierIds[n - 1] : undefined) : text ? byKey(text) : undefined
    if (id && !out.includes(id)) out.push(id)
  }
  return out
}
