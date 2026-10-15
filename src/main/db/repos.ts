import { randomUUID } from 'crypto'
import { getDb } from './index'
import { encryptSecret, decryptSecret } from '../secrets'
import { DEFAULT_MODEL } from '@shared/models'
import { t } from '../i18n'
import type {
  Agent,
  AgentInput,
  AgentLog,
  AgentPermissions,
  AgentStatus,
  AppSettings,
  Decision,
  DecisionInput,
  LogLevel,
  Memory,
  MemoryKind,
  MemoryScope,
  Message,
  OrgUnit,
  OrgUnitInput,
  PermissionsPatch,
  Project,
  ProjectInput,
  Provider,
  ProviderInput,
  ProviderKind,
  Report,
  Run,
  RunStatus,
  SenderType,
  Stats,
  Task,
  TaskInput,
  TaskListOpts,
  TaskPage,
  TaskBoard,
  TaskStatus
} from '@shared/types'
import { redactDeep, redactSecrets } from '@shared/redact'
import { DEFAULT_SETTINGS } from '@shared/settingsRules'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>
const now = (): string => new Date().toISOString()
const bool = (v: unknown): boolean => v === 1 || v === true

/* ───────────────────────────── settings ───────────────────────────── */


export const settingsRepo = {
  get(): AppSettings {
    const rows = getDb().prepare('SELECT key, value FROM settings').all() as Row[]
    const out: AppSettings = { ...DEFAULT_SETTINGS }
    for (const r of rows) {
      if (r.key in out) (out as any)[r.key] = JSON.parse(r.value)
    }
    return out
  },
  update(patch: Partial<AppSettings>): AppSettings {
    const stmt = getDb().prepare(
      'INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    )
    getDb().transaction(() => {
      for (const [k, v] of Object.entries(patch)) stmt.run(k, JSON.stringify(v))
    })()
    return this.get()
  }
}

/* ───────────────────────────── providers ──────────────────────────── */

const DEFAULT_MODELS: Record<ProviderKind, string> = DEFAULT_MODEL
const DEFAULT_LABELS: Record<ProviderKind, string> = {
  anthropic: 'Anthropic API',
  openai: 'OpenAI API',
  'claude-cli': 'Claude Code CLI',
  'codex-cli': 'Codex CLI',
  get mock() {
    return t('orchestrator:providers.mockLabel')
  }
}

const mapProvider = (r: Row): Provider => ({
  id: r.id,
  kind: r.kind,
  label: r.label,
  model: r.model,
  hasKey: !!r.api_key_enc && (r.api_key_enc as Buffer).length > 0,
  cliPath: r.cli_path,
  baseUrl: r.base_url ?? '',
  isDefault: bool(r.is_default),
  createdAt: r.created_at
})

export const providersRepo = {
  list(): Provider[] {
    return (getDb().prepare('SELECT * FROM providers ORDER BY is_default DESC, created_at').all() as Row[]).map(
      mapProvider
    )
  },
  get(id: string): Provider | null {
    const r = getDb().prepare('SELECT * FROM providers WHERE id = ?').get(id) as Row | undefined
    return r ? mapProvider(r) : null
  },
  getDefault(): Provider | null {
    const r = getDb().prepare('SELECT * FROM providers ORDER BY is_default DESC, created_at LIMIT 1').get() as
      | Row
      | undefined
    return r ? mapProvider(r) : null
  },
  getApiKey(id: string): string | null {
    const r = getDb().prepare('SELECT api_key_enc FROM providers WHERE id = ?').get(id) as Row | undefined
    return r ? decryptSecret(r.api_key_enc) : null
  },
  save(input: ProviderInput, id?: string): Provider {
    const db = getDb()
    const pid = id ?? randomUUID()
    db.transaction(() => {
      if (input.isDefault) db.prepare('UPDATE providers SET is_default = 0').run()
      if (id) {
        const sets: string[] = []
        const vals: unknown[] = []
        if (input.label !== undefined) (sets.push('label = ?'), vals.push(input.label))
        if (input.model !== undefined) (sets.push('model = ?'), vals.push(input.model))
        if (input.cliPath !== undefined) (sets.push('cli_path = ?'), vals.push(input.cliPath))
        if (input.baseUrl !== undefined) (sets.push('base_url = ?'), vals.push(input.baseUrl))
        if (input.isDefault !== undefined) (sets.push('is_default = ?'), vals.push(input.isDefault ? 1 : 0))
        if (input.apiKey) (sets.push('api_key_enc = ?'), vals.push(encryptSecret(input.apiKey)))
        if (sets.length) db.prepare(`UPDATE providers SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id)
      } else {
        const isFirst = (db.prepare('SELECT COUNT(*) AS c FROM providers').get() as Row).c === 0
        db.prepare(
          `INSERT INTO providers(id, kind, label, model, api_key_enc, cli_path, is_default, base_url)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          pid,
          input.kind,
          input.label || DEFAULT_LABELS[input.kind],
          input.model ?? DEFAULT_MODELS[input.kind],
          input.apiKey ? encryptSecret(input.apiKey) : null,
          input.cliPath ?? null,
          input.isDefault || isFirst ? 1 : 0,
          input.kind === 'openai' ? input.baseUrl ?? '' : ''
        )
      }
    })()
    return this.get(pid)!
  },
  delete(id: string): void {
    getDb().prepare('DELETE FROM providers WHERE id = ?').run(id)
  }
}

/* ─────────────────────────────── agents ───────────────────────────── */

const parseSkills = (v: unknown): string[] => {
  try {
    const arr = JSON.parse(String(v ?? '[]'))
    return Array.isArray(arr) ? arr.map(String) : []
  } catch {
    return []
  }
}

/** Trims, drops empties and de-duplicates (case-insensitive) skill tags. */
const cleanSkills = (skills: string[]): string[] => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of skills) {
    const s = String(raw).trim().slice(0, 40)
    if (!s || seen.has(s.toLocaleLowerCase('tr'))) continue
    seen.add(s.toLocaleLowerCase('tr'))
    out.push(s)
  }
  return out.slice(0, 24)
}

const mapAgent = (r: Row): Agent => ({
  id: r.id,
  name: r.name,
  role: r.role,
  persona: r.persona,
  jobDescription: r.job_description ?? '',
  skills: parseSkills(r.skills),
  providerId: r.provider_id,
  model: r.model,
  color: r.color,
  hair: r.hair,
  skin: r.skin,
  deskIndex: r.desk_index,
  status: r.status,
  statusNote: r.status_note,
  isLead: bool(r.is_lead),
  enabled: bool(r.enabled),
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

const mapPerm = (r: Row): AgentPermissions => ({
  agentId: r.agent_id,
  fsRead: bool(r.fs_read),
  fsWrite: bool(r.fs_write),
  terminal: bool(r.terminal),
  network: bool(r.network),
  browser: bool(r.browser),
  requireApproval: bool(r.require_approval),
  allowedPaths: JSON.parse(r.allowed_paths || '[]'),
  updatedAt: r.updated_at
})

const duplicateName = (name: string): Error => new Error(t('orchestrator:db.duplicateAgent', { name }))

export const agentsRepo = {
  list(): Agent[] {
    return (getDb().prepare('SELECT * FROM agents ORDER BY is_lead DESC, desk_index').all() as Row[]).map(mapAgent)
  },
  get(id: string): Agent | null {
    const r = getDb().prepare('SELECT * FROM agents WHERE id = ?').get(id) as Row | undefined
    return r ? mapAgent(r) : null
  },
  /**
   * A twin of an agent for parallel work: same profile, provider, permissions, units (with titles), skills, app,
   * connection and file grants — a new name and shirt, never the lead flag. One transaction.
   */
  duplicate(id: string): Agent {
    const src = this.get(id)
    if (!src) throw new Error(t('orchestrator:errors.agentNotFound'))
    const db = getDb()
    const base = src.name.replace(/\s+\d+$/, '')
    let n = 2
    while (this.findByName(`${base} ${n}`)) n++
    const shirts = ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#06b6d4', '#ef4444', '#8b5cf6', '#84cc16', '#f97316', '#64748b']
    const color = shirts[(shirts.indexOf(src.color) + n) % shirts.length] ?? src.color
    const newId = randomUUID()
    db.transaction(() => {
      const desk = (db.prepare('SELECT COALESCE(MAX(desk_index), -1) + 1 AS d FROM agents').get() as Row).d
      db.prepare(
        `INSERT INTO agents(id, name, role, persona, job_description, skills, provider_id, model, color, hair, skin, desk_index, is_lead, enabled)
         SELECT ?, ?, role, persona, job_description, skills, provider_id, model, ?, hair, skin, ?, 0, enabled FROM agents WHERE id = ?`
      ).run(newId, `${base} ${n}`, color, desk, id)
      db.prepare(
        `INSERT INTO agent_permissions(agent_id, fs_read, fs_write, terminal, network, browser, require_approval, allowed_paths)
         SELECT ?, fs_read, fs_write, terminal, network, browser, require_approval, allowed_paths FROM agent_permissions WHERE agent_id = ?`
      ).run(newId, id)
      db.prepare('INSERT INTO unit_members(unit_id, agent_id, title) SELECT unit_id, ?, title FROM unit_members WHERE agent_id = ?').run(newId, id)
      db.prepare(
        "INSERT INTO skill_assignments(skill_id, target_type, target_id) SELECT skill_id, 'agent', ? FROM skill_assignments WHERE target_type = 'agent' AND target_id = ?"
      ).run(newId, id)
      db.prepare('INSERT INTO mcp_permissions(server_id, agent_id) SELECT server_id, ? FROM mcp_permissions WHERE agent_id = ?').run(newId, id)
      db.prepare('INSERT INTO connection_permissions(connection_id, agent_id, level) SELECT connection_id, ?, level FROM connection_permissions WHERE agent_id = ?').run(newId, id)
      db.prepare('INSERT INTO file_access(file_id, agent_id, granted_by) SELECT file_id, ?, granted_by FROM file_access WHERE agent_id = ?').run(newId, id)
    })()
    return this.get(newId)!
  },
  findByName(name: string): Agent | null {
    const r = getDb().prepare('SELECT * FROM agents WHERE lower(name) = lower(?)').get(name.trim()) as
      | Row
      | undefined
    return r ? mapAgent(r) : null
  },
  lead(): Agent | null {
    const r = getDb().prepare('SELECT * FROM agents WHERE is_lead = 1 LIMIT 1').get() as Row | undefined
    return r ? mapAgent(r) : null
  },
  save(input: AgentInput, id?: string, permissions?: PermissionsPatch): Agent {
    const db = getDb()
    const aid = id ?? randomUUID()
    if (input.name !== undefined) {
      const name = input.name.trim()
      if (!name && id) throw new Error(t('orchestrator:db.agentNameEmpty'))
      const clash = name ? this.findByName(name) : null
      if (clash && clash.id !== id) throw duplicateName(clash.name)
      input = { ...input, name }
    }
    if (input.skills !== undefined) input = { ...input, skills: cleanSkills(input.skills) }
    try {
      db.transaction(() => {
        if (input.isLead) db.prepare('UPDATE agents SET is_lead = 0').run()
        if (id) {
          const map: Record<string, string> = {
            name: 'name',
            role: 'role',
            persona: 'persona',
            jobDescription: 'job_description',
            skills: 'skills',
            providerId: 'provider_id',
            model: 'model',
            color: 'color',
            hair: 'hair',
            skin: 'skin',
            enabled: 'enabled',
            isLead: 'is_lead'
          }
          const sets: string[] = []
          const vals: unknown[] = []
          for (const [k, col] of Object.entries(map)) {
            const v = (input as any)[k]
            if (v === undefined) continue
            sets.push(`${col} = ?`)
            vals.push(typeof v === 'boolean' ? (v ? 1 : 0) : Array.isArray(v) ? JSON.stringify(v) : v)
          }
          sets.push('updated_at = ?')
          vals.push(now())
          db.prepare(`UPDATE agents SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id)
        } else {
          const desk = (db.prepare('SELECT COALESCE(MAX(desk_index), -1) + 1 AS d FROM agents').get() as Row).d
          db.prepare(
            `INSERT INTO agents(id, name, role, persona, job_description, skills, provider_id, model, color, hair, skin,
                                desk_index, is_lead, enabled)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            aid,
            input.name || `Ajan-${desk + 1}`,
            input.role ?? 'Engineer',
            input.persona ?? '',
            input.jobDescription ?? '',
            JSON.stringify(input.skills ?? []),
            input.providerId ?? null,
            input.model ?? null,
            input.color ?? '#6366f1',
            input.hair ?? '#3f2a1d',
            input.skin ?? '#f1c27d',
            desk,
            input.isLead ? 1 : 0,
            input.enabled === false ? 0 : 1
          )
          db.prepare('INSERT INTO agent_permissions(agent_id) VALUES (?)').run(aid)
        }
        if (permissions && Object.keys(permissions).length) permissionsRepo.update(aid, permissions)
      })()
    } catch (e) {
      // Race-safe fallback: the UNIQUE(name) constraint is the source of truth.
      if ((e as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE' && /agents\.name/.test(String((e as Error).message)))
        throw duplicateName(input.name ?? '')
      throw e
    }
    return this.get(aid)!
  },
  setStatus(id: string, status: AgentStatus, note: string | null = null): void {
    getDb()
      .prepare('UPDATE agents SET status = ?, status_note = ?, updated_at = ? WHERE id = ?')
      .run(status, note, now(), id)
  },
  delete(id: string): void {
    getDb().prepare('DELETE FROM agents WHERE id = ?').run(id)
  }
}

export const permissionsRepo = {
  list(): AgentPermissions[] {
    return (getDb().prepare('SELECT * FROM agent_permissions').all() as Row[]).map(mapPerm)
  },
  get(agentId: string): AgentPermissions {
    let r = getDb().prepare('SELECT * FROM agent_permissions WHERE agent_id = ?').get(agentId) as Row | undefined
    if (!r) {
      getDb().prepare('INSERT INTO agent_permissions(agent_id) VALUES (?)').run(agentId)
      r = getDb().prepare('SELECT * FROM agent_permissions WHERE agent_id = ?').get(agentId) as Row
    }
    return mapPerm(r)
  },
  update(agentId: string, patch: PermissionsPatch): AgentPermissions {
    this.get(agentId)
    const map: Record<string, string> = {
      fsRead: 'fs_read',
      fsWrite: 'fs_write',
      terminal: 'terminal',
      network: 'network',
      browser: 'browser',
      requireApproval: 'require_approval',
      allowedPaths: 'allowed_paths'
    }
    const sets: string[] = []
    const vals: unknown[] = []
    for (const [k, col] of Object.entries(map)) {
      const v = (patch as any)[k]
      if (v === undefined) continue
      sets.push(`${col} = ?`)
      vals.push(Array.isArray(v) ? JSON.stringify(v) : v ? 1 : 0)
    }
    sets.push('updated_at = ?')
    vals.push(now())
    getDb().prepare(`UPDATE agent_permissions SET ${sets.join(', ')} WHERE agent_id = ?`).run(...vals, agentId)
    return this.get(agentId)
  }
}

/* ─────────────────────────────── tasks ────────────────────────────── */

const mapTask = (r: Row): Task => ({
  id: r.id,
  projectId: r.project_id,
  seq: r.seq,
  key: r.key,
  title: r.title,
  description: r.description,
  status: r.status,
  priority: r.priority,
  assigneeId: r.assignee_id,
  progress: r.progress,
  sortOrder: r.sort_order,
  createdBy: r.created_by,
  reviewNote: r.review_note,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  startedAt: r.started_at,
  completedAt: r.completed_at,
  dependsOn: JSON.parse(r.depends_on || '[]')
})

/** SQL condition: every dependency of the `tasks` row is done (a deleted dependency no longer blocks). */
const DEPS_DONE = `NOT EXISTS (SELECT 1 FROM json_each(tasks.depends_on) d JOIN tasks dep ON dep.id = d.value WHERE dep.status <> 'done')`

type CursorPayload = { status: string; sortOrder: number; seq: number }

function encodeCursor(t: Task): string {
  return Buffer.from(JSON.stringify({ status: t.status, sortOrder: t.sortOrder, seq: t.seq })).toString('base64url')
}

function decodeCursor(cursor: string): CursorPayload | null {
  try {
    const c = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Partial<CursorPayload> | null
    // A malformed cursor must not reach SQL as `undefined` bindings.
    if (!c || typeof c.status !== 'string' || !Number.isFinite(c.sortOrder) || !Number.isInteger(c.seq)) return null
    return c as CursorPayload
  } catch {
    return null
  }
}

export const tasksRepo = {
  list(opts: TaskListOpts = {}): TaskPage {
    const db = getDb()
    const limit = Math.min(Math.max(1, Math.trunc(Number(opts.limit) || 50)), 200)
    const statusFilter = (opts.status ? ' AND status = ?' : '') + (opts.projectId ? ' AND project_id = ?' : '')
    const countSql = `SELECT COUNT(*) AS c FROM tasks WHERE 1=1${statusFilter}`
    const countVals: unknown[] = [...(opts.status ? [opts.status] : []), ...(opts.projectId ? [opts.projectId] : [])]
    const total = (db.prepare(countSql).get(...countVals) as Row).c as number

    let rows: Row[]
    if (opts.cursor) {
      const cur = decodeCursor(opts.cursor)
      if (!cur) {
        rows = []
      } else {
        const sql = `SELECT * FROM tasks
          WHERE (status > ? OR (status = ? AND sort_order > ?) OR (status = ? AND sort_order = ? AND seq > ?))
          ${statusFilter}
          ORDER BY status, sort_order, seq LIMIT ?`
        const vals: unknown[] = [
          cur.status, cur.status, cur.sortOrder,
          cur.status, cur.sortOrder, cur.seq,
          ...countVals,
          limit + 1
        ]
        rows = db.prepare(sql).all(...vals) as Row[]
      }
    } else {
      const sql = `SELECT * FROM tasks WHERE 1=1${statusFilter} ORDER BY status, sort_order, seq LIMIT ?`
      rows = db.prepare(sql).all(...countVals, limit + 1) as Row[]
    }

    const hasMore = rows.length > limit
    if (hasMore) rows.pop()
    const items = rows.map(mapTask)
    const nextCursor = hasMore && items.length > 0 ? encodeCursor(items[items.length - 1]) : null
    return { items, nextCursor, total }
  },
  listAll(): Task[] {
    return (getDb().prepare('SELECT * FROM tasks ORDER BY status, sort_order, seq').all() as Row[]).map(mapTask)
  },
  /** Every unfinished task + the newest `doneLimit` done tasks of each project, and how many are done per project. */
  board(doneLimit: number): TaskBoard {
    const db = getDb()
    const open = db.prepare("SELECT * FROM tasks WHERE status <> 'done'").all() as Row[]
    const done = db
      .prepare(
        `SELECT * FROM (
           SELECT *, ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY COALESCE(completed_at, updated_at) DESC, seq DESC) AS rn
           FROM tasks WHERE status = 'done'
         ) WHERE rn <= ?`
      )
      .all(doneLimit) as Row[]
    const doneTotals: Record<string, number> = {}
    for (const r of db.prepare("SELECT project_id AS p, COUNT(*) AS c FROM tasks WHERE status = 'done' GROUP BY project_id").all() as Row[]) {
      doneTotals[r.p] = r.c
    }
    return { tasks: [...open, ...done].map(mapTask), doneTotals }
  },
  /** A project's tasks that are in review or done, most recently updated first (the lead's follow-up context). */
  recentlyFinished(projectId: string, limit: number): Task[] {
    return (
      getDb()
        .prepare("SELECT * FROM tasks WHERE project_id = ? AND status IN ('in_review','done') ORDER BY updated_at DESC LIMIT ?")
        .all(projectId, limit) as Row[]
    ).map(mapTask)
  },
  get(id: string): Task | null {
    const r = getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Row | undefined
    return r ? mapTask(r) : null
  },
  findByKey(key: string): Task | null {
    const r = getDb().prepare('SELECT * FROM tasks WHERE upper(key) = upper(?)').get(key) as Row | undefined
    return r ? mapTask(r) : null
  },
  create(input: TaskInput, createdBy = 'user'): Task {
    const db = getDb()
    const id = randomUUID()
    db.transaction(() => {
      const seq = (db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS s FROM tasks').get() as Row).s
      const status = input.status ?? 'todo'
      const order = (
        db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS o FROM tasks WHERE status = ?').get(status) as Row
      ).o
      db.prepare(
        `INSERT INTO tasks(id, seq, key, title, description, status, priority, assignee_id, sort_order, created_by, project_id, depends_on)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        seq,
        `TA-${seq}`,
        input.title.trim(),
        input.description ?? '',
        status,
        input.priority ?? 1,
        input.assigneeId ?? null,
        order,
        createdBy,
        input.projectId ?? projectsRepo.defaultId(),
        JSON.stringify([...new Set(input.dependsOn ?? [])])
      )
    })()
    return this.get(id)!
  },
  update(id: string, patch: Partial<Task>): Task {
    const map: Record<string, string> = {
      title: 'title',
      description: 'description',
      priority: 'priority',
      assigneeId: 'assignee_id',
      status: 'status',
      progress: 'progress',
      sortOrder: 'sort_order',
      reviewNote: 'review_note',
      startedAt: 'started_at',
      completedAt: 'completed_at'
    }
    const sets: string[] = []
    const vals: unknown[] = []
    for (const [k, col] of Object.entries(map)) {
      const v = (patch as any)[k]
      if (v === undefined) continue
      sets.push(`${col} = ?`)
      vals.push(v)
    }
    sets.push('updated_at = ?')
    vals.push(now())
    getDb().prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id)
    return this.get(id)!
  },
  move(id: string, status: TaskStatus, sortOrder?: number): Task {
    const order =
      sortOrder ??
      (getDb().prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS o FROM tasks WHERE status = ?').get(status) as Row)
        .o
    const patch: Partial<Task> = { status, sortOrder: order }
    if (status === 'done') (patch.completedAt = now()), (patch.progress = 100)
    if (status === 'todo') patch.progress = 0
    return this.update(id, patch)
  },
  /**
   * Next todo task for this agent: tasks assigned to it (in any active project) first,
   * then unassigned tasks of the projects it is a member of.
   */
  nextFor(agentId: string, exclude: Set<string>, assignedIn: string[], unassignedIn: string[]): Task | null {
    if (!assignedIn.length && !unassignedIn.length) return null
    const ph = (n: number): string => (n ? Array(n).fill('?').join(',') : 'NULL')
    const rows = getDb()
      .prepare(
        `SELECT * FROM tasks WHERE status = 'todo' AND ${DEPS_DONE} AND (
           (assignee_id = ? AND project_id IN (${ph(assignedIn.length)}))
           OR (assignee_id IS NULL AND project_id IN (${ph(unassignedIn.length)}))
         )
         ORDER BY (assignee_id IS NULL), priority DESC, sort_order LIMIT 25`
      )
      .all(agentId, ...assignedIn, ...unassignedIn) as Row[]
    const r = rows.find((x) => !exclude.has(x.id))
    return r ? mapTask(r) : null
  },
  /** `todo` tasks queued for the given agents in the given projects, without a revision note, most urgent first. */
  queuedFor(agentIds: string[], projectIds: string[]): Task[] {
    if (!agentIds.length || !projectIds.length) return []
    const ph = (n: number): string => Array(n).fill('?').join(',')
    return (
      getDb()
        .prepare(
          `SELECT * FROM tasks WHERE status = 'todo' AND review_note IS NULL AND ${DEPS_DONE}
             AND assignee_id IN (${ph(agentIds.length)}) AND project_id IN (${ph(projectIds.length)})
           ORDER BY priority DESC, sort_order LIMIT 25`
        )
        .all(...agentIds, ...projectIds) as Row[]
    ).map(mapTask)
  },
  delete(id: string): void {
    getDb().prepare('DELETE FROM tasks WHERE id = ?').run(id)
  }
}

/* ──────────────────────────────── runs ────────────────────────────── */

const mapRun = (r: Row): Run => ({
  id: r.id,
  projectId: r.project_id,
  taskId: r.task_id,
  agentId: r.agent_id,
  status: r.status,
  output: r.output,
  error: r.error,
  tokensIn: r.tokens_in,
  tokensOut: r.tokens_out,
  costUsd: r.cost_usd,
  startedAt: r.started_at,
  endedAt: r.ended_at
})

export const runsRepo = {
  list(opts: { activeOnly?: boolean; taskId?: string; limit?: number } = {}): Run[] {
    const where: string[] = []
    const vals: unknown[] = []
    if (opts.activeOnly) where.push(`status IN ('awaiting_approval','running','paused')`)
    if (opts.taskId) (where.push('task_id = ?'), vals.push(opts.taskId))
    const sql = `SELECT * FROM runs ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                 ORDER BY started_at DESC LIMIT ?`
    return (getDb().prepare(sql).all(...vals, opts.limit ?? 200) as Row[]).map(mapRun)
  },
  get(id: string): Run | null {
    const r = getDb().prepare('SELECT * FROM runs WHERE id = ?').get(id) as Row | undefined
    return r ? mapRun(r) : null
  },
  create(taskId: string, agentId: string, status: RunStatus, projectId: string | null): Run {
    const id = randomUUID()
    getDb()
      .prepare('INSERT INTO runs(id, task_id, agent_id, status, project_id) VALUES (?, ?, ?, ?, ?)')
      .run(id, taskId, agentId, status, projectId)
    return this.get(id)!
  },
  update(id: string, patch: Partial<Run>): void {
    const map: Record<string, string> = {
      status: 'status',
      output: 'output',
      error: 'error',
      tokensIn: 'tokens_in',
      tokensOut: 'tokens_out',
      costUsd: 'cost_usd',
      endedAt: 'ended_at'
    }
    const sets: string[] = []
    const vals: unknown[] = []
    for (const [k, col] of Object.entries(map)) {
      const v = (patch as any)[k]
      if (v === undefined) continue
      sets.push(`${col} = ?`)
      vals.push(v)
    }
    if (sets.length) getDb().prepare(`UPDATE runs SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id)
  },
  /** Runs left running when the app quit are marked cancelled on boot. */
  cancelStale(): number {
    return getDb()
      .prepare(
        `UPDATE runs SET status = 'cancelled', ended_at = ?, error = ?
         WHERE status IN ('awaiting_approval','running','paused')`
      )
      .run(now(), t('orchestrator:db.appClosed')).changes
  }
}

/* ────────────────────────────── messages ──────────────────────────── */

const mapMessage = (r: Row): Message => ({
  id: r.id,
  projectId: r.project_id,
  channel: r.channel,
  senderType: r.sender_type,
  senderId: r.sender_id,
  content: r.content,
  meta: r.meta ? JSON.parse(r.meta) : null,
  createdAt: r.created_at
})

export const messagesRepo = {
  list(channel?: string, limit = 200, projectId?: string): Message[] {
    const where: string[] = []
    const vals: unknown[] = []
    if (channel) (where.push('channel = ?'), vals.push(channel))
    if (projectId) (where.push('project_id = ?'), vals.push(projectId))
    const rows = getDb()
      .prepare(`SELECT * FROM messages ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ?`)
      .all(...vals, limit)
    return (rows as Row[]).map(mapMessage).reverse()
  },
  create(
    channel: string,
    senderType: SenderType,
    senderId: string | null,
    content: string,
    projectId: string | null,
    meta?: Record<string, unknown>
  ): Message {
    const id = randomUUID()
    getDb()
      .prepare(
        'INSERT INTO messages(id, channel, sender_type, sender_id, content, meta, created_at, project_id) VALUES (?,?,?,?,?,?,?,?)'
      )
      .run(id, channel, senderType, senderId, content, meta ? JSON.stringify(meta) : null, now(), projectId)
    return mapMessage(getDb().prepare('SELECT * FROM messages WHERE id = ?').get(id) as Row)
  },
  get(id: string): Message | null {
    const r = getDb().prepare('SELECT * FROM messages WHERE id = ?').get(id) as Row | undefined
    return r ? mapMessage(r) : null
  }
}

/* ──────────────────────────────── logs ────────────────────────────── */

const parseMeta = (v: unknown): Record<string, unknown> | null => {
  if (typeof v !== 'string' || !v) return null
  try {
    return JSON.parse(v) as Record<string, unknown>
  } catch {
    return null
  }
}

const mapLog = (r: Row): AgentLog => ({
  id: r.id,
  runId: r.run_id,
  agentId: r.agent_id,
  taskId: r.task_id,
  projectId: r.project_id ?? null,
  level: r.level,
  message: r.message,
  meta: parseMeta(r.meta),
  createdAt: r.created_at
})

export const logsRepo = {
  add(entry: {
    runId?: string | null
    agentId?: string | null
    taskId?: string | null
    projectId?: string | null
    level: LogLevel
    message: string
    meta?: Record<string, unknown> | null
  }): AgentLog {
    const info = getDb()
      .prepare('INSERT INTO agent_logs(run_id, agent_id, task_id, project_id, level, message, meta, created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(
        entry.runId ?? null,
        entry.agentId ?? null,
        entry.taskId ?? null,
        entry.projectId ?? null,
        entry.level,
        // Transcripts keep tool output and full prompts: secret-looking text is masked before it is stored.
        redactSecrets(entry.message),
        entry.meta ? JSON.stringify(redactDeep(entry.meta)) : null,
        now()
      )
    return mapLog(getDb().prepare('SELECT * FROM agent_logs WHERE id = ?').get(info.lastInsertRowid) as Row)
  },
  /** Newest `limit` entries (returned oldest first); `beforeId` pages further back. */
  list(opts: { runId?: string; taskId?: string; agentId?: string; projectId?: string; beforeId?: number; limit?: number }): AgentLog[] {
    const where: string[] = []
    const vals: unknown[] = []
    if (opts.runId) (where.push('run_id = ?'), vals.push(opts.runId))
    if (opts.taskId) (where.push('task_id = ?'), vals.push(opts.taskId))
    if (opts.agentId) (where.push('agent_id = ?'), vals.push(opts.agentId))
    if (opts.projectId) (where.push('project_id = ?'), vals.push(opts.projectId))
    if (opts.beforeId) (where.push('id < ?'), vals.push(opts.beforeId))
    const limit = Math.max(1, Math.min(5000, opts.limit ?? 500))
    const sql = `SELECT * FROM agent_logs ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`
    return (getDb().prepare(sql).all(...vals, limit) as Row[]).map(mapLog).reverse()
  }
}

/* ────────────────────────────── memories ──────────────────────────── */

export const mapMemory = (r: Row): Memory => ({
  id: r.id,
  projectId: r.project_id ?? null,
  agentId: r.agent_id,
  scope: r.scope,
  kind: r.kind,
  content: r.content,
  importance: r.importance,
  source: r.source,
  taskId: r.task_id,
  accessCount: r.access_count,
  createdAt: r.created_at,
  lastAccessedAt: r.last_accessed_at
})

export const memoriesRepo = {
  add(m: {
    content: string
    kind: MemoryKind
    scope?: MemoryScope
    agentId?: string | null
    importance?: number
    source?: string | null
    taskId?: string | null
    projectId?: string | null
  }): Memory {
    const id = randomUUID()
    const scope: MemoryScope = m.scope ?? (m.taskId ? 'task' : m.agentId ? 'agent' : 'global')
    getDb()
      .prepare(
        `INSERT INTO memories(id, agent_id, scope, kind, content, importance, source, task_id, created_at, project_id)
         VALUES (?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        id,
        m.agentId ?? null,
        scope,
        m.kind,
        m.content,
        m.importance ?? 0.5,
        m.source ?? null,
        m.taskId ?? null,
        now(),
        m.projectId ?? null
      )
    return mapMemory(getDb().prepare('SELECT * FROM memories WHERE id = ?').get(id) as Row)
  },
  /** `projectId`: undefined = all, null = organization-wide only, id = that project + organization-wide. */
  list(opts: { agentId?: string | null; limit?: number; projectId?: string | null } = {}): Memory[] {
    const where: string[] = []
    const vals: unknown[] = []
    if (opts.agentId !== undefined) (where.push('agent_id IS ?'), vals.push(opts.agentId))
    if (opts.projectId === null) where.push('project_id IS NULL')
    else if (opts.projectId) (where.push('(project_id IS NULL OR project_id = ?)'), vals.push(opts.projectId))
    const rows = getDb()
      .prepare(`SELECT * FROM memories ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ?`)
      .all(...vals, opts.limit ?? 200)
    return (rows as Row[]).map(mapMemory)
  },
  delete(id: string): void {
    getDb().prepare('DELETE FROM memories WHERE id = ?').run(id)
  }
}

/* ────────────────────────────── decisions ─────────────────────────── */

const mapDecision = (r: Row): Decision => ({
  id: r.id,
  projectId: r.project_id ?? null,
  seq: r.seq,
  title: r.title,
  context: r.context,
  decision: r.decision,
  rationale: r.rationale,
  status: r.status,
  decidedBy: r.decided_by,
  taskId: r.task_id,
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

export const decisionsRepo = {
  list(): Decision[] {
    return (getDb().prepare('SELECT * FROM decisions ORDER BY seq DESC').all() as Row[]).map(mapDecision)
  },
  get(id: string): Decision | null {
    const r = getDb().prepare('SELECT * FROM decisions WHERE id = ?').get(id) as Row | undefined
    return r ? mapDecision(r) : null
  },
  save(input: DecisionInput, id?: string): Decision {
    const db = getDb()
    if (id) {
      const cur = this.get(id)!
      const next = { ...cur, ...input }
      db.prepare(
        `UPDATE decisions SET title=?, context=?, decision=?, rationale=?, status=?, decided_by=?, task_id=?, project_id=?, updated_at=? WHERE id=?`
      ).run(next.title, next.context, next.decision, next.rationale, next.status, next.decidedBy, next.taskId, next.projectId, now(), id)
      return this.get(id)!
    }
    const nid = randomUUID()
    const seq = (db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS s FROM decisions').get() as Row).s
    db.prepare(
      `INSERT INTO decisions(id, seq, title, context, decision, rationale, status, decided_by, task_id, project_id)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).run(
      nid,
      seq,
      input.title,
      input.context ?? '',
      input.decision ?? '',
      input.rationale ?? '',
      input.status ?? 'proposed',
      input.decidedBy ?? null,
      input.taskId ?? null,
      input.projectId ?? null
    )
    return this.get(nid)!
  },
  delete(id: string): void {
    getDb().prepare('DELETE FROM decisions WHERE id = ?').run(id)
  }
}

/* ─────────────────────────────── reports ──────────────────────────── */

const mapReport = (r: Row): Report => ({
  id: r.id,
  projectId: r.project_id ?? null,
  title: r.title,
  kind: r.kind,
  bodyMd: r.body_md,
  agentId: r.agent_id,
  taskId: r.task_id,
  createdAt: r.created_at
})

export const reportsRepo = {
  list(perProject?: number): Report[] {
    if (!perProject) return (getDb().prepare('SELECT * FROM reports ORDER BY created_at DESC').all() as Row[]).map(mapReport)
    return (
      getDb()
        .prepare(
          `SELECT * FROM (
             SELECT *, ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY created_at DESC) AS rn FROM reports
           ) WHERE rn <= ? ORDER BY created_at DESC`
        )
        .all(perProject) as Row[]
    ).map(mapReport)
  },
  create(r: Omit<Report, 'id' | 'createdAt'>): Report {
    const id = randomUUID()
    getDb()
      .prepare(
        'INSERT INTO reports(id, title, kind, body_md, agent_id, task_id, created_at, project_id) VALUES (?,?,?,?,?,?,?,?)'
      )
      .run(id, r.title, r.kind, r.bodyMd, r.agentId, r.taskId, now(), r.projectId)
    return mapReport(getDb().prepare('SELECT * FROM reports WHERE id = ?').get(id) as Row)
  },
  delete(id: string): void {
    getDb().prepare('DELETE FROM reports WHERE id = ?').run(id)
  },
  latestForTask(taskId: string): Report | null {
    const r = getDb().prepare("SELECT * FROM reports WHERE task_id = ? AND kind = 'task' ORDER BY created_at DESC LIMIT 1").get(taskId) as Row | undefined
    return r ? mapReport(r) : null
  }
}

/* ──────────────────────────────── stats ───────────────────────────── */

export function getStats(projectId?: string): Stats {
  const db = getDb()
  const pf = projectId ? 'WHERE project_id = @p' : ''
  const pa = projectId ? 'AND project_id = @p' : ''
  const P = { p: projectId ?? null }
  const tasksByStatus = { todo: 0, in_progress: 0, in_review: 0, done: 0 } as Stats['tasksByStatus']
  for (const r of db.prepare(`SELECT status, COUNT(*) AS c FROM tasks ${pf} GROUP BY status`).all(P) as Row[]) {
    tasksByStatus[r.status as TaskStatus] = r.c
  }
  const runs = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(status = 'succeeded') AS ok,
              SUM(status = 'failed') AS failed
       FROM runs ${pf}`
    )
    .get(P) as Row
  // Token figures come from token_usage (task + chat + review), not just task runs.
  const usage = db
    .prepare(
      `SELECT COALESCE(SUM(input + cache_read + cache_write), 0) AS tin, COALESCE(SUM(output), 0) AS tout, COALESCE(SUM(cost_usd), 0) AS cost
       FROM token_usage ${pf}`
    )
    .get(P) as Row
  const perAgent = (
    db
      .prepare(
        `SELECT a.id AS agentId,
                (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id = a.id AND t.status = 'done' ${pa}) AS done,
                (SELECT COUNT(*) FROM runs r WHERE r.agent_id = a.id ${pa}) AS runs,
                (SELECT COALESCE(SUM(input + output + cache_read + cache_write), 0) FROM token_usage u WHERE u.agent_id = a.id ${pa}) AS tokens
         FROM agents a ORDER BY a.desk_index`
      )
      .all(P) as Row[]
  ).map((r) => ({ agentId: r.agentId, done: r.done, runs: r.runs, tokens: r.tokens }))
  return {
    tasksByStatus,
    runsTotal: runs.total ?? 0,
    runsSucceeded: runs.ok ?? 0,
    runsFailed: runs.failed ?? 0,
    tokensIn: usage.tin,
    tokensOut: usage.tout,
    costUsd: usage.cost,
    perAgent,
    memories: (db.prepare(`SELECT COUNT(*) AS c FROM memories ${projectId ? 'WHERE project_id IS NULL OR project_id = @p' : ''}`).get(P) as Row).c,
    decisions: (db.prepare(`SELECT COUNT(*) AS c FROM decisions ${pf}`).get(P) as Row).c
  }
}

/* ───────────────────────────── organization ───────────────────────── */

const mapUnit = (r: Row, members: UnitMemberRow[]): OrgUnit => ({
  id: r.id,
  parentId: r.parent_id,
  name: r.name,
  kind: r.kind,
  description: r.description,
  color: r.color,
  leadAgentId: r.lead_agent_id,
  sortOrder: r.sort_order,
  members: members.filter((m) => m.unit_id === r.id).map((m) => ({ agentId: m.agent_id, title: m.title })),
  createdAt: r.created_at,
  updatedAt: r.updated_at
})
type UnitMemberRow = { unit_id: string; agent_id: string; title: string }

export const unitsRepo = {
  list(): OrgUnit[] {
    const db = getDb()
    const members = db.prepare('SELECT unit_id, agent_id, title FROM unit_members ORDER BY created_at').all() as UnitMemberRow[]
    return (db.prepare('SELECT * FROM units ORDER BY sort_order, created_at').all() as Row[]).map((r) => mapUnit(r, members))
  },
  get(id: string): OrgUnit | null {
    const db = getDb()
    const r = db.prepare('SELECT * FROM units WHERE id = ?').get(id) as Row | undefined
    if (!r) return null
    const members = db.prepare('SELECT unit_id, agent_id, title FROM unit_members WHERE unit_id = ? ORDER BY created_at').all(id) as UnitMemberRow[]
    return mapUnit(r, members)
  },
  root(): OrgUnit | null {
    const r = getDb().prepare("SELECT id FROM units WHERE parent_id IS NULL ORDER BY (kind = 'organization') DESC, created_at LIMIT 1").get() as Row | undefined
    return r ? this.get(r.id) : null
  },
  save(input: OrgUnitInput, id?: string): OrgUnit {
    const db = getDb()
    if (id) {
      const map: Record<string, string> = {
        parentId: 'parent_id',
        name: 'name',
        kind: 'kind',
        description: 'description',
        color: 'color',
        leadAgentId: 'lead_agent_id'
      }
      const sets: string[] = []
      const vals: unknown[] = []
      for (const [k, col] of Object.entries(map)) {
        const v = (input as any)[k]
        if (v === undefined) continue
        sets.push(`${col} = ?`)
        vals.push(typeof v === 'string' && k === 'name' ? v.trim() : v)
      }
      sets.push('updated_at = ?')
      vals.push(now())
      db.prepare(`UPDATE units SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id)
      return this.get(id)!
    }
    const nid = randomUUID()
    const parentId = input.parentId === undefined ? this.root()?.id ?? null : input.parentId
    const order = (db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS o FROM units WHERE parent_id IS ?').get(parentId) as Row).o
    db.prepare(
      `INSERT INTO units(id, parent_id, name, kind, description, color, lead_agent_id, sort_order) VALUES (?,?,?,?,?,?,?,?)`
    ).run(
      nid,
      parentId,
      (input.name ?? t('orchestrator:db.newTeam')).trim() || t('orchestrator:db.newTeam'),
      input.kind ?? 'team',
      input.description ?? '',
      input.color ?? '#6366f1',
      input.leadAgentId ?? null,
      order
    )
    return this.get(nid)!
  },
  delete(id: string): void {
    getDb().prepare('DELETE FROM units WHERE id = ?').run(id)
  },
  addMember(unitId: string, agentId: string, title?: string): OrgUnit {
    getDb()
      .prepare(
        `INSERT INTO unit_members(unit_id, agent_id, title) VALUES (?, ?, ?)
         ON CONFLICT(unit_id, agent_id) DO UPDATE SET title = COALESCE(?, title)`
      )
      .run(unitId, agentId, title ?? '', title ?? null)
    return this.get(unitId)!
  },
  removeMember(unitId: string, agentId: string): OrgUnit {
    const db = getDb()
    db.transaction(() => {
      db.prepare('DELETE FROM unit_members WHERE unit_id = ? AND agent_id = ?').run(unitId, agentId)
      db.prepare('UPDATE units SET lead_agent_id = NULL WHERE id = ? AND lead_agent_id = ?').run(unitId, agentId)
    })()
    return this.get(unitId)!
  }
}

const mapProject = (r: Row, links: { project_id: string; unit_id: string }[]): Project => ({
  id: r.id,
  name: r.name,
  description: r.description,
  rootPath: r.root_path,
  color: r.color,
  leadAgentId: r.lead_agent_id,
  status: r.status,
  isDefault: bool(r.is_default),
  unitIds: links.filter((l) => l.project_id === r.id).map((l) => l.unit_id),
  sortOrder: r.sort_order,
  lastOpenedAt: r.last_opened_at ?? null,
  isolation: r.isolation === 'worktree' ? 'worktree' : 'shared',
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

export const projectsRepo = {
  list(): Project[] {
    const db = getDb()
    const links = db.prepare('SELECT project_id, unit_id FROM project_units').all() as { project_id: string; unit_id: string }[]
    return (db.prepare('SELECT * FROM projects ORDER BY is_default DESC, sort_order, created_at').all() as Row[]).map((r) =>
      mapProject(r, links)
    )
  },
  get(id: string | null | undefined): Project | null {
    if (!id) return null
    const db = getDb()
    const r = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Row | undefined
    if (!r) return null
    const links = db.prepare('SELECT project_id, unit_id FROM project_units WHERE project_id = ?').all(id) as {
      project_id: string
      unit_id: string
    }[]
    return mapProject(r, links)
  },
  /** Marks projects as opened now (recent list order). Unknown ids are ignored. */
  touch(ids: string[]): void {
    const stmt = getDb().prepare('UPDATE projects SET last_opened_at = ? WHERE id = ?')
    const t = now()
    getDb().transaction(() => {
      for (const id of ids) stmt.run(t, id)
    })()
  },
  /** The default project (created on first boot / migration); falls back to the oldest project. */
  defaultId(): string | null {
    const r = getDb().prepare('SELECT id FROM projects ORDER BY is_default DESC, created_at LIMIT 1').get() as Row | undefined
    return r?.id ?? null
  },
  save(input: ProjectInput, id?: string, opts: { isDefault?: boolean } = {}): Project {
    const db = getDb()
    const pid = id ?? randomUUID()
    db.transaction(() => {
      if (id) {
        const map: Record<string, string> = {
          name: 'name',
          description: 'description',
          rootPath: 'root_path',
          color: 'color',
          leadAgentId: 'lead_agent_id',
          status: 'status',
          isolation: 'isolation'
        }
        const sets: string[] = []
        const vals: unknown[] = []
        for (const [k, col] of Object.entries(map)) {
          const v = (input as any)[k]
          if (v === undefined) continue
          sets.push(`${col} = ?`)
          vals.push(typeof v === 'string' && k === 'name' ? v.trim() : v)
        }
        sets.push('updated_at = ?')
        vals.push(now())
        db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id)
      } else {
        const order = (db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS o FROM projects').get() as Row).o
        db.prepare(
          `INSERT INTO projects(id, name, description, root_path, color, lead_agent_id, status, is_default, sort_order, isolation)
           VALUES (?,?,?,?,?,?,?,?,?,?)`
        ).run(
          pid,
          (input.name ?? t('orchestrator:db.newProject')).trim() || t('orchestrator:db.newProject'),
          input.description ?? '',
          input.rootPath ?? '',
          input.color ?? '#6366f1',
          input.leadAgentId ?? null,
          input.status ?? 'active',
          opts.isDefault ? 1 : 0,
          order,
          input.isolation === 'worktree' ? 'worktree' : 'shared'
        )
      }
      if (input.unitIds) {
        db.prepare('DELETE FROM project_units WHERE project_id = ?').run(pid)
        const ins = db.prepare('INSERT OR IGNORE INTO project_units(project_id, unit_id) VALUES (?, ?)')
        for (const u of input.unitIds) ins.run(pid, u)
      }
    })()
    return this.get(pid)!
  },
  /** Makes `id` the default project (the fallback for records without a project). */
  setDefault(id: string): void {
    const db = getDb()
    db.transaction(() => {
      db.prepare('UPDATE projects SET is_default = 0').run()
      db.prepare('UPDATE projects SET is_default = 1 WHERE id = ?').run(id)
    })()
  },
  /** Removes the project and everything scoped to it. */
  delete(id: string): void {
    const db = getDb()
    db.transaction(() => {
      db.prepare('DELETE FROM runs WHERE project_id = ?').run(id)
      db.prepare('DELETE FROM agent_logs WHERE project_id = ? OR task_id IN (SELECT id FROM tasks WHERE project_id = ?)').run(id, id)
      db.prepare('DELETE FROM agent_instructions WHERE project_id = ?').run(id)
      // token_usage is kept: it is the agents' consumption history (all-time totals stay correct).
      db.prepare('DELETE FROM tasks WHERE project_id = ?').run(id)
      db.prepare('DELETE FROM messages WHERE project_id = ?').run(id)
      db.prepare('DELETE FROM decisions WHERE project_id = ?').run(id)
      db.prepare('DELETE FROM reports WHERE project_id = ?').run(id)
      db.prepare('DELETE FROM memories WHERE project_id = ?').run(id)
      db.prepare('DELETE FROM projects WHERE id = ?').run(id)
    })()
  }
}
