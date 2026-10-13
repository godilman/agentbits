import { randomUUID } from 'crypto'
import type {
  AgentInstruction,
  InstructionMode,
  InstructionStatus,
  UsageDelta,
  UsageMode,
  UsageTotals
} from '@shared/types'
import { getDb } from './index'
import { t } from '../i18n'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>

const now = (): string => new Date().toISOString()

/** Identifies this app run; "oturum" token figures are everything recorded under it. */
export const APP_SESSION_ID = randomUUID()
export const APP_SESSION_STARTED_AT = now()

export const emptyTotals = (): UsageTotals => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  costUsd: 0,
  total: 0,
  calls: 0,
  estimated: false
})

const toTotals = (r: Row | undefined): UsageTotals => {
  if (!r) return emptyTotals()
  const t: UsageTotals = {
    input: r.input ?? 0,
    output: r.output ?? 0,
    cacheRead: r.cache_read ?? 0,
    cacheWrite: r.cache_write ?? 0,
    costUsd: r.cost_usd ?? 0,
    calls: r.calls ?? 0,
    estimated: !!r.estimated,
    total: 0
  }
  t.total = t.input + t.output + t.cacheRead + t.cacheWrite
  return t
}

const SUMS = `COALESCE(SUM(input),0) AS input, COALESCE(SUM(output),0) AS output,
  COALESCE(SUM(cache_read),0) AS cache_read, COALESCE(SUM(cache_write),0) AS cache_write,
  COALESCE(SUM(cost_usd),0) AS cost_usd, COUNT(*) AS calls, COALESCE(MAX(estimated),0) AS estimated`

export const usageRepo = {
  record(e: {
    agentId: string
    runId?: string | null
    taskId?: string | null
    projectId?: string | null
    mode: UsageMode
    provider: string
    model: string
    usage: UsageDelta
    estimated?: boolean
  }): void {
    const u = e.usage
    if (!u.input && !u.output && !u.cacheRead && !u.cacheWrite && !u.costUsd) return
    getDb()
      .prepare(
        `INSERT INTO token_usage (agent_id, run_id, task_id, project_id, mode, provider, model, input, output, cache_read, cache_write, cost_usd, estimated, session_id, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        e.agentId,
        e.runId ?? null,
        e.taskId ?? null,
        e.projectId ?? null,
        e.mode,
        e.provider,
        e.model || '',
        Math.max(0, Math.round(u.input)),
        Math.max(0, Math.round(u.output)),
        Math.max(0, Math.round(u.cacheRead)),
        Math.max(0, Math.round(u.cacheWrite)),
        Math.max(0, u.costUsd),
        e.estimated ? 1 : 0,
        APP_SESSION_ID,
        now()
      )
  },

  /** Per-agent totals: all time, this app session, and per task. */
  byAgent(projectId?: string | null): Map<string, { allTime: UsageTotals; session: UsageTotals }> {
    const db = getDb()
    const scope = projectId ? 'WHERE project_id = ?' : ''
    const args = projectId ? [projectId] : []
    const out = new Map<string, { allTime: UsageTotals; session: UsageTotals }>()
    for (const r of db.prepare(`SELECT agent_id, ${SUMS} FROM token_usage ${scope} GROUP BY agent_id`).all(...args) as Row[]) {
      out.set(r.agent_id, { allTime: toTotals(r), session: emptyTotals() })
    }
    const sessionScope = projectId ? 'WHERE session_id = ? AND project_id = ?' : 'WHERE session_id = ?'
    for (const r of db
      .prepare(`SELECT agent_id, ${SUMS} FROM token_usage ${sessionScope} GROUP BY agent_id`)
      .all(APP_SESSION_ID, ...args) as Row[]) {
      const cur = out.get(r.agent_id) ?? { allTime: emptyTotals(), session: emptyTotals() }
      cur.session = toTotals(r)
      out.set(r.agent_id, cur)
    }
    return out
  },

  forTask(taskId: string, agentId?: string): UsageTotals {
    const sql = agentId
      ? `SELECT ${SUMS} FROM token_usage WHERE task_id = ? AND agent_id = ?`
      : `SELECT ${SUMS} FROM token_usage WHERE task_id = ?`
    return toTotals(getDb().prepare(sql).get(...(agentId ? [taskId, agentId] : [taskId])) as Row)
  },

  forRun(runId: string): UsageTotals {
    return toTotals(getDb().prepare(`SELECT ${SUMS} FROM token_usage WHERE run_id = ?`).get(runId) as Row)
  },

  totals(projectId?: string | null): { allTime: UsageTotals; session: UsageTotals } {
    const db = getDb()
    const p = projectId ? ' AND project_id = ?' : ''
    const args = projectId ? [projectId] : []
    return {
      allTime: toTotals(db.prepare(`SELECT ${SUMS} FROM token_usage WHERE 1=1${p}`).get(...args) as Row),
      session: toTotals(db.prepare(`SELECT ${SUMS} FROM token_usage WHERE session_id = ?${p}`).get(APP_SESSION_ID, ...args) as Row)
    }
  },

  /** Daily totals (last `days` days) for charts. */
  daily(days: number, projectId?: string | null): { day: string; input: number; output: number; cache: number }[] {
    const since = new Date(Date.now() - days * 86_400_000).toISOString()
    const p = projectId ? ' AND project_id = ?' : ''
    return (
      getDb()
        .prepare(
          `SELECT substr(created_at, 1, 10) AS day, SUM(input) AS input, SUM(output) AS output, SUM(cache_read + cache_write) AS cache
           FROM token_usage WHERE created_at >= ?${p} GROUP BY day ORDER BY day`
        )
        .all(since, ...(projectId ? [projectId] : [])) as Row[]
    ).map((r) => ({ day: r.day, input: r.input ?? 0, output: r.output ?? 0, cache: r.cache ?? 0 }))
  }
}

/* ───────────────────────────── direct instructions ───────────────────────────── */

const mapInstruction = (r: Row): AgentInstruction => ({
  id: r.id,
  agentId: r.agent_id,
  projectId: r.project_id ?? null,
  taskId: r.task_id ?? null,
  runId: r.run_id ?? null,
  text: r.text,
  mode: r.mode,
  status: r.status,
  note: r.note ?? null,
  createdAt: r.created_at,
  appliedAt: r.applied_at ?? null
})

export const instructionsRepo = {
  create(e: {
    agentId: string
    projectId: string | null
    taskId: string | null
    runId: string | null
    text: string
    mode: InstructionMode
    status: InstructionStatus
    note?: string | null
  }): AgentInstruction {
    const id = randomUUID()
    getDb()
      .prepare(
        `INSERT INTO agent_instructions (id, agent_id, project_id, task_id, run_id, text, mode, status, note, created_at, applied_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        id,
        e.agentId,
        e.projectId,
        e.taskId,
        e.runId,
        e.text,
        e.mode,
        e.status,
        e.note ?? null,
        now(),
        e.status === 'applied' || e.status === 'started_task' ? now() : null
      )
    return this.get(id)!
  },
  get(id: string): AgentInstruction | null {
    const r = getDb().prepare('SELECT * FROM agent_instructions WHERE id = ?').get(id) as Row | undefined
    return r ? mapInstruction(r) : null
  },
  setStatus(id: string, status: InstructionStatus, patch: { note?: string | null; taskId?: string | null; runId?: string | null } = {}): void {
    getDb()
      .prepare(
        `UPDATE agent_instructions SET status = ?, note = COALESCE(?, note), task_id = COALESCE(?, task_id), run_id = COALESCE(?, run_id),
         applied_at = CASE WHEN ? IN ('applied','started_task') THEN ? ELSE applied_at END WHERE id = ?`
      )
      .run(status, patch.note ?? null, patch.taskId ?? null, patch.runId ?? null, status, now(), id)
  },
  queuedFor(runId: string): AgentInstruction[] {
    return (getDb().prepare("SELECT * FROM agent_instructions WHERE run_id = ? AND status = 'queued' ORDER BY created_at").all(runId) as Row[]).map(
      mapInstruction
    )
  },
  list(opts: { agentId?: string; projectId?: string; limit?: number }): AgentInstruction[] {
    const where: string[] = []
    const vals: unknown[] = []
    if (opts.agentId) (where.push('agent_id = ?'), vals.push(opts.agentId))
    if (opts.projectId) (where.push('project_id = ?'), vals.push(opts.projectId))
    const sql = `SELECT * FROM agent_instructions ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ?`
    return (getDb().prepare(sql).all(...vals, opts.limit ?? 50) as Row[]).map(mapInstruction)
  },
  /** Recent direct interventions in a project, for the lead's context. */
  recentForProject(projectId: string, limit = 6): AgentInstruction[] {
    return (
      getDb()
        .prepare(
          "SELECT * FROM agent_instructions WHERE project_id = ? AND status IN ('queued','applied','started_task') ORDER BY created_at DESC LIMIT ?"
        )
        .all(projectId, limit) as Row[]
    ).map(mapInstruction)
  },
  /** On startup: instructions queued for runs that no longer exist can never be delivered. */
  cancelStale(): number {
    return getDb()
      .prepare("UPDATE agent_instructions SET status = 'cancelled', note = ? WHERE status = 'queued'")
      .run(t('orchestrator:db.instructionCancelledOnRestart')).changes
  }
}
