/**
 * Questions the lead asks the user in the chat, and the user's answers (ADR-040; pure helpers, `tests/questions.test.ts`).
 * A question has a lasting key per project (Q-1, Q-2…). The user answers one directly by starting with its key
 * ("Q-3: …"); otherwise the lead may tie the answer to the one open question it clearly answers (```answered).
 * An answer never approves anything: approvals and permissions have their own buttons.
 */
import { hiddenBlockBodies } from './replyStream.ts'

export interface AskedQuestion {
  text: string
  /** Task key the question is about, e.g. "TA-3" (upper-cased), or null. */
  task: string | null
}

export interface TiedAnswer {
  /** Question key, e.g. "Q-3" (upper-cased). */
  question: string
}

export const MAX_QUESTIONS = 5
export const MAX_QUESTION_CHARS = 600
const TASK_KEY = /^[A-Za-z][A-Za-z0-9]{0,9}-\d{1,6}$/
const Q_KEY = /^Q-\d{1,6}$/i

const items = (text: string, tag: 'question' | 'answered'): Record<string, unknown>[] => {
  const out: Record<string, unknown>[] = []
  for (const body of hiddenBlockBodies(text, tag)) {
    let v: unknown
    try {
      v = JSON.parse(body)
    } catch {
      continue
    }
    for (const x of Array.isArray(v) ? v : [v]) if (x && typeof x === 'object') out.push(x as Record<string, unknown>)
  }
  return out
}

/** ```question blocks of the lead's reply → questions (text required; an invalid task key is dropped, not the question). */
export function parseQuestions(text: string): AskedQuestion[] {
  const out: AskedQuestion[] = []
  for (const x of items(text, 'question')) {
    const q = typeof x.text === 'string' ? x.text.trim() : ''
    if (!q) continue
    const task = typeof x.task === 'string' && TASK_KEY.test(x.task.trim()) ? x.task.trim().toUpperCase() : null
    out.push({ text: q.slice(0, MAX_QUESTION_CHARS), task })
    if (out.length >= MAX_QUESTIONS) break
  }
  return out
}

/** ```answered blocks: the open questions the lead says this message answers (keys only; the user's words are the answer). */
export function parseAnswered(text: string): TiedAnswer[] {
  const out: TiedAnswer[] = []
  for (const x of items(text, 'answered')) {
    const q = typeof x.question === 'string' ? x.question.trim() : ''
    if (!Q_KEY.test(q)) continue
    const key = q.toUpperCase()
    if (!out.some((a) => a.question === key)) out.push({ question: key })
    if (out.length >= MAX_QUESTIONS) break
  }
  return out
}

/**
 * Question keys the user addresses directly: a message (or a line of it) that starts with "Q-3:" / "Q-3 -" / "Q3:".
 * A key mentioned in passing ("like Q-3 said") is not an answer.
 */
export function addressedKeys(message: string): string[] {
  const out: string[] = []
  for (const line of message.split('\n')) {
    const m = /^\s*(?:@)?Q-?(\d{1,6})\s*[:.\-–—)]/i.exec(line)
    if (m && !out.includes(`Q-${m[1]}`)) out.push(`Q-${m[1]}`)
  }
  return out
}

/**
 * The part of a message that answers `key`: its line (after the key) and the lines below it up to the next addressed
 * key — or, for a message addressing one question, the whole message without the key.
 */
export function answerPart(message: string, key: string, several: boolean): string {
  const strip = (line: string): string => line.replace(/^\s*(?:@)?Q-?\d{1,6}\s*[:.\-–—)]\s*/i, '')
  const lines = message.split('\n')
  if (!several) {
    const i = lines.findIndex((l) => addressedKeys(l)[0] === key)
    return lines.map((l, j) => (j === i ? strip(l) : l)).join('\n').trim()
  }
  const out: string[] = []
  let inside = false
  for (const line of lines) {
    const k = addressedKeys(line)[0]
    if (k) {
      inside = k === key
      if (inside) out.push(strip(line))
    } else if (inside) out.push(line)
  }
  return out.join('\n').trim()
}
