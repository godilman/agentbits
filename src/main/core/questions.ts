import { randomUUID } from 'crypto'
import { getDb } from '../db'

/** A question the lead asked the user in the chat (ADR-040). Its key (`Q-<seq>`) stays the same for good. */
export interface Question {
  id: string
  projectId: string
  seq: number
  key: string
  channel: string
  requestId: string | null
  taskId: string | null
  text: string
  status: 'open' | 'answered' | 'dropped'
  askedMessageId: string | null
  answer: string | null
  answerMessageId: string | null
  createdAt: string
  closedAt: string | null
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>
const map = (r: Row): Question => ({
  id: r.id,
  projectId: r.project_id,
  seq: r.seq,
  key: `Q-${r.seq}`,
  channel: r.channel,
  requestId: r.request_id ?? null,
  taskId: r.task_id ?? null,
  text: r.text,
  status: r.status,
  askedMessageId: r.asked_message_id ?? null,
  answer: r.answer ?? null,
  answerMessageId: r.answer_message_id ?? null,
  createdAt: r.created_at,
  closedAt: r.closed_at ?? null
})

export const questionsRepo = {
  create(q: { projectId: string; channel: string; requestId: string | null; taskId: string | null; text: string }): Question {
    const db = getDb()
    const id = randomUUID()
    db.transaction(() => {
      const seq = (db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM questions WHERE project_id = ?').get(q.projectId) as { n: number }).n
      db.prepare('INSERT INTO questions (id, project_id, seq, channel, request_id, task_id, text, created_at) VALUES (?,?,?,?,?,?,?,?)').run(
        id,
        q.projectId,
        seq,
        q.channel,
        q.requestId,
        q.taskId,
        q.text,
        new Date().toISOString()
      )
    })()
    return this.get(id)!
  },
  get(id: string): Question | null {
    const r = getDb().prepare('SELECT * FROM questions WHERE id = ?').get(id) as Row | undefined
    return r ? map(r) : null
  },
  byKey(projectId: string, key: string): Question | null {
    const m = /^Q-(\d+)$/i.exec(key.trim())
    if (!m) return null
    const r = getDb().prepare('SELECT * FROM questions WHERE project_id = ? AND seq = ?').get(projectId, Number(m[1])) as Row | undefined
    return r ? map(r) : null
  },
  open(projectId?: string): Question[] {
    const rows = projectId
      ? getDb().prepare("SELECT * FROM questions WHERE project_id = ? AND status = 'open' ORDER BY seq").all(projectId)
      : getDb().prepare("SELECT * FROM questions WHERE status = 'open' ORDER BY created_at").all()
    return (rows as Row[]).map(map)
  },
  forRequest(requestId: string): Question[] {
    return (getDb().prepare('SELECT * FROM questions WHERE request_id = ? ORDER BY seq').all(requestId) as Row[]).map(map)
  },
  /** Open questions about a request: asked with it, or later about one of its tasks. */
  openForRequest(requestId: string, taskIds: string[] = []): Question[] {
    const ids = taskIds.length ? ` OR task_id IN (${taskIds.map(() => '?').join(',')})` : ''
    return (getDb().prepare(`SELECT * FROM questions WHERE status = 'open' AND (request_id = ?${ids}) ORDER BY seq`).all(requestId, ...taskIds) as Row[]).map(map)
  },
  setAsked(id: string, messageId: string): void {
    getDb().prepare('UPDATE questions SET asked_message_id = ? WHERE id = ?').run(messageId, id)
  },
  /** Closes an open question (only an open one: a second answer or a late one changes nothing). True when it closed it. */
  close(id: string, status: 'answered' | 'dropped', answer: string | null, answerMessageId: string | null): boolean {
    const r = getDb()
      .prepare("UPDATE questions SET status = ?, answer = ?, answer_message_id = ?, closed_at = ? WHERE id = ? AND status = 'open'")
      .run(status, answer, answerMessageId, new Date().toISOString(), id)
    return r.changes > 0
  }
}
