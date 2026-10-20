// Domain types shared between the main process and the renderer.

export type ProviderKind = 'anthropic' | 'openai' | 'claude-cli' | 'codex-cli' | 'mock'

export interface Provider {
  id: string
  kind: ProviderKind
  label: string
  model: string
  hasKey: boolean // the key itself never leaves the main process
  cliPath: string | null
  /** OpenAI kind only: an OpenAI-compatible endpoint (Gemini, Ollama, LM Studio…); '' = OpenAI. `shared/endpoints.ts`. */
  baseUrl: string
  isDefault: boolean
  createdAt: string
}

export interface ProviderInput {
  kind: ProviderKind
  label?: string
  model?: string
  apiKey?: string
  cliPath?: string | null
  baseUrl?: string
  isDefault?: boolean
}

export type AgentStatus = 'idle' | 'working' | 'break' | 'error' | 'offline'

export interface Agent {
  id: string
  name: string
  role: string
  persona: string
  jobDescription: string // responsibilities, scope, deliverables
  skills: string[] // expertise tags, used for prompts and auto-assignment
  providerId: string | null
  model: string | null
  color: string // shirt colour
  hair: string
  skin: string
  deskIndex: number
  status: AgentStatus
  statusNote: string | null
  isLead: boolean
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export type AgentInput = Partial<
  Pick<
    Agent,
    | 'name'
    | 'role'
    | 'persona'
    | 'jobDescription'
    | 'skills'
    | 'providerId'
    | 'model'
    | 'color'
    | 'hair'
    | 'skin'
    | 'enabled'
    | 'isLead'
  >
>

export interface AgentPermissions {
  agentId: string
  fsRead: boolean
  fsWrite: boolean
  terminal: boolean
  network: boolean
  browser: boolean
  requireApproval: boolean
  allowedPaths: string[]
  updatedAt: string
}

export type PermissionsPatch = Partial<Omit<AgentPermissions, 'agentId' | 'updatedAt'>>

export type TaskStatus = 'todo' | 'in_progress' | 'in_review' | 'done'
export const TASK_STATUSES: TaskStatus[] = ['todo', 'in_progress', 'in_review', 'done']

export interface Task {
  id: string
  projectId: string
  seq: number
  key: string
  title: string
  description: string
  status: TaskStatus
  priority: 0 | 1 | 2 | 3
  assigneeId: string | null
  progress: number
  sortOrder: number
  createdBy: string
  reviewNote: string | null
  createdAt: string
  updatedAt: string
  startedAt: string | null
  completedAt: string | null
  /** Who made it done: the lead (review / race) or the user by hand (no review); null for other states and older tasks. */
  completedBy: 'lead' | 'user' | null
  /** Ids of tasks that must be done before this one starts (autopilot waits; the user can start it after confirming). */
  dependsOn: string[]
  /** Race mode: the original task this one is a challenger copy of (null for an ordinary task). */
  raceOf: string | null
  /** Race mode: the lead's comparison picked this attempt (`won`) or the other one (`lost`). */
  raceResult: 'won' | 'lost' | null
  /** Acceptance criteria, one per line ('' = none): in the assignee's prompt and checked one by one in the lead's review. */
  acceptance: string
  /** The lead's check of each criterion at the last review (null = not reviewed against criteria). */
  acceptanceCheck: CriterionCheck[] | null
}

export interface CriterionCheck {
  text: string
  met: boolean
  note: string
}

export interface TaskInput {
  title: string
  /** Defaults to the default project when omitted. */
  projectId?: string
  description?: string
  priority?: 0 | 1 | 2 | 3
  assigneeId?: string | null
  status?: TaskStatus
  /** Attachments linked to the new task (its assignee may read them while working on it). */
  fileIds?: string[]
  /** Ids of tasks (same project) that must be done first. */
  dependsOn?: string[]
  /** Race mode: this is a challenger copy of that task. */
  raceOf?: string | null
  /** Acceptance criteria, one per line. */
  acceptance?: string
}

export interface TaskListOpts {
  cursor?: string
  projectId?: string
  limit?: number
  status?: TaskStatus
}

export interface TaskPage {
  items: Task[]
  nextCursor: string | null
  total: number
}

/** What the renderer keeps in memory: every unfinished task plus the newest done tasks of each project. */
export interface TaskBoard {
  tasks: Task[]
  /** All done tasks per project id (the board shows how many older ones were left out). */
  doneTotals: Record<string, number>
}

export type RunStatus = 'awaiting_approval' | 'running' | 'paused' | 'succeeded' | 'failed' | 'cancelled'

export interface Run {
  id: string
  projectId: string | null
  taskId: string
  agentId: string
  status: RunStatus
  output: string | null
  error: string | null
  tokensIn: number
  tokensOut: number
  costUsd: number
  startedAt: string
  endedAt: string | null
  /** Memories that went into this run's prompt ("What did this task know?"). */
  recalled: RecalledMemory[]
}

/** What the latest run of a task really did, from the tool record (not from the worker's report). */
export interface RunEvidence {
  runId: string
  status: RunStatus
  endedAt: string | null
  /** Provider kind that did the run (from its usage record); null when unknown. */
  provider: string | null
  /** The Demo provider: nothing real happened. */
  simulated: boolean
  /** The provider reports each tool call and its result (Claude Code). Otherwise commands / files are not known. */
  toolRecord: boolean
  /** It should have a tool record but none was found for this run (e.g. cleaned up): nothing can be said either way. */
  recordMissing: boolean
  /**
   * Shell commands, a shortened list: every failure is kept, then the latest ones. `error` = the tool reported a
   * failure (`fixedLater`: the same command succeeded afterwards), `unknown` = no result was recorded.
   */
  commands: { command: string; result: 'ok' | 'error' | 'unknown'; fixedLater?: boolean }[]
  /** All shell commands of the run (not only the ones listed): totals, and how many (failures among them) aren't listed. */
  commandCount: { total: number; failed: number; failedNotFixed: number; unknown: number; notListed: number; failedNotListed: number }
  /**
   * Files the agent tried to write with file tools, a shortened list (written ones first): `written` = at least one
   * attempt worked (a later failure doesn't undo it); `last` = how the latest attempt ended — `ok`, `error`, `refused`
   * (not allowed), `unknown` (no result). Files changed by shell commands are not in it (git shows them in worktree mode).
   */
  fileWrites: { path: string; written: boolean; last: 'ok' | 'error' | 'refused' | 'unknown' }[]
  /** All files of the run (not only the ones listed). */
  fileCount: { total: number; written: number; notWritten: number; notListed: number; writtenNotListed: number }
  /** Refused: a tool the agent wasn't allowed to use, a connection call that was denied. */
  denied: string[]
  /** The report was longer than what the lead's review reads. */
  reportCut: boolean
}

/** The task's result as shown first in its details: evidence, who reviewed, what changed (worktree). */
export interface TaskResult {
  evidence: RunEvidence | null
  /** The lead review of that run (null: none since it). `simulated`: the Demo provider; `race`: a comparison of two
   *  attempts' reports (the tool record isn't part of it). */
  review: { by: string | null; simulated: boolean; race: boolean } | null
  /** Worktree projects: the changes in git (`merged`: brought into the project folder). */
  changes: { files: number; added: number; removed: number; merged: boolean } | null
}

/** An unsent message, per project + channel. `files`: attachments whose upload finished (name / size kept so a file
 *  deleted meanwhile can still be named). */
export interface MessageDraft {
  projectId: string
  channel: string
  text: string
  files: { id: string; name: string; size: number }[]
}

export type SenderType = 'user' | 'agent' | 'system'

export interface Message {
  id: string
  projectId: string | null
  channel: string // 'general' | `task:${id}` | `agent:${id}`
  senderType: SenderType
  senderId: string | null
  content: string
  meta: Record<string, unknown> | null
  createdAt: string
}

/**
 * Agent transcript entry kinds. `prompt` = input handed to the agent (by the lead,
 * the review or the system), `instruction` = the user's direct instruction,
 * `status` = lifecycle markers (start / end / redirect).
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'tool' | 'output' | 'prompt' | 'instruction' | 'status'

export interface AgentLog {
  id: number
  runId: string | null
  agentId: string | null
  taskId: string | null
  projectId: string | null
  level: LogLevel
  message: string
  /** Extra structured data, e.g. `{ from: 'lead', fullPrompt }` for prompts. */
  meta: Record<string, unknown> | null
  createdAt: string
}

/* ───────────────────────────── token usage ───────────────────────────── */

export type UsageMode = 'task' | 'chat' | 'review'

/** One usage record as reported (or estimated) for a model call / run segment. */
export interface UsageDelta {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  costUsd: number
}

export interface UsageTotals extends UsageDelta {
  total: number
  calls: number
  /** Some of the numbers are estimates (demo provider) rather than provider-reported. */
  estimated: boolean
}

/** How much usage a provider reports. */
export type UsageReporting = 'full' | 'partial' | 'none' | 'simulated'

export interface AgentUsage {
  agentId: string
  allTime: UsageTotals
  /** Since the app was started. */
  session: UsageTotals
  /** The task the agent is working on right now (all runs of it), if any. */
  currentTaskId: string | null
  currentTask: UsageTotals | null
  reporting: UsageReporting
}

export interface UsageSummary {
  sessionStartedAt: string
  agents: AgentUsage[]
  allTime: UsageTotals
  session: UsageTotals
}

/* ───────────────────────────── direct instructions ───────────────────────────── */

/**
 * - `redirect`: interrupt the current step and continue the same task with the instruction
 * - `queue`: deliver after the current step finishes (before review)
 * - `task`: agent is free → start a new task from the instruction
 */
export type InstructionMode = 'redirect' | 'queue' | 'task'
export type InstructionStatus = 'queued' | 'applied' | 'started_task' | 'cancelled' | 'rejected'

export interface AgentInstruction {
  id: string
  agentId: string
  projectId: string | null
  taskId: string | null
  runId: string | null
  text: string
  mode: InstructionMode
  status: InstructionStatus
  /** `lead`: a note the project lead sent to a running task (the user's own instructions are `user`). */
  source: 'user' | 'lead'
  note: string | null
  createdAt: string
  appliedAt: string | null
}

export interface InstructionInput {
  agentId: string
  projectId: string
  text: string
  mode: InstructionMode
  /** The run the user was looking at; if the agent moved on meanwhile the instruction is rejected. */
  expectedRunId: string | null
  /** Attachments (already uploaded with files:add) handed to the agent with this instruction. */
  fileIds?: string[]
}

/** What an agent's provider can do with an instruction while it is working. */
export interface SteeringCapability {
  /** `resume`: same CLI conversation continues (claude --resume); `restart`: run restarts with the partial output + instruction; `simulated`: demo provider. */
  live: 'resume' | 'restart' | 'simulated'
  label: string
}

export type MemoryScope = 'global' | 'agent' | 'task'
export type MemoryKind = 'fact' | 'decision' | 'context' | 'preference' | 'summary'

export interface Memory {
  id: string
  /** NULL = organization-wide memory, otherwise scoped to one project. */
  projectId: string | null
  agentId: string | null
  scope: MemoryScope
  kind: MemoryKind
  content: string
  importance: number
  source: string | null
  taskId: string | null
  accessCount: number
  createdAt: string
  lastAccessedAt: string | null
  /** The memory that replaced this one ("yerini aldı"): kept as history, never sent to agents. */
  supersededBy: string | null
  /** Topics it is linked to in the memory graph. */
  topics: string[]
}

/** A memory that went into a prompt: snapshot, so the trace stays readable after the memory changes. */
export interface RecalledMemory {
  id: string
  kind: MemoryKind
  content: string
  /** profile = about the user (always sent); match = found by words / meaning; graph = one step away in the graph. */
  via: 'profile' | 'match' | 'graph'
}

/** Something an agent learned from the user's chat message, waiting for the user's yes (Settings → Memory → learning). */
export interface MemorySuggestion {
  id: string
  content: string
  kind: 'preference' | 'fact'
  topics: string[]
  /** The memory it would replace, if any. */
  replaces: string | null
  replacesText: string | null
  projectId: string | null
  channel: string
  agentId: string | null
  /** A note for a project memory file (null = a memory row): the file, what is done to it and, for a new file, its guide line. */
  targetFile: string | null
  targetOp: 'append' | null
  targetNote: string | null
  createdAt: string
}

export type MemoryNodeType = 'you' | 'memory' | 'topic' | 'task' | 'decision' | 'agent' | 'chat'
export interface MemoryGraph {
  /** Memory nodes also carry their full `text` and `topics`. */
  nodes: { id: string; type: MemoryNodeType; label: string; kind?: MemoryKind; faded?: boolean; text?: string; topics?: string[] }[]
  edges: { from: string; to: string; kind: 'about' | 'task' | 'agent' | 'decision' | 'you' | 'learned' | 'supersedes' }[]
  /** More memories exist than the graph shows (the most important / recent are drawn). */
  truncated: boolean
}

export type DecisionStatus = 'proposed' | 'accepted' | 'rejected' | 'superseded'

export interface Decision {
  id: string
  projectId: string | null
  seq: number
  title: string
  context: string
  decision: string
  rationale: string
  status: DecisionStatus
  decidedBy: string | null
  taskId: string | null
  createdAt: string
  updatedAt: string
}

export type DecisionInput = Pick<Decision, 'title'> &
  Partial<Pick<Decision, 'context' | 'decision' | 'rationale' | 'status' | 'decidedBy' | 'taskId' | 'projectId'>>

export interface Report {
  id: string
  projectId: string | null
  title: string
  kind: 'task' | 'daily' | 'custom'
  bodyMd: string
  agentId: string | null
  taskId: string | null
  createdAt: string
}

export interface Stats {
  tasksByStatus: Record<TaskStatus, number>
  runsTotal: number
  runsSucceeded: number
  runsFailed: number
  tokensIn: number
  tokensOut: number
  costUsd: number
  perAgent: { agentId: string; done: number; runs: number; tokens: number }[]
  memories: number
  decisions: number
}

export interface AppSettings {
  onboarded: boolean
  workspaceRoot: string
  autopilot: boolean // scheduler picks up todo tasks automatically
  reviewByLead: boolean
  /** Operating-system notifications (and the taskbar flash) while no app window has focus (`main/notify.ts`). */
  notifications: boolean
  /** Look for a newer published Agentbits version every 6 hours (packaged builds); only tells, never installs (`main/update.ts`). */
  autoUpdateCheck: boolean
  /** Agent logs older than this are pruned automatically (0 = keep forever). */
  logRetentionDays: number
  /** On launch: 'ask' shows the project picker, 'restore' reopens the last open projects. */
  startupProjects: 'ask' | 'restore'
  /** Interface language code ('en', 'tr', …) or 'auto' = operating system language. */
  language: string
  /** Audit log entries (connections, apps) older than this are pruned automatically (0 = keep forever). */
  auditRetentionDays: number
  /** Limits on one task run; reaching one stops the run and holds the task (0 = no limit). */
  runMaxMinutes: number
  runMaxTokens: number
  runMaxCostUsd: number
  /** Extra environment variable names an agent CLI may inherit (see `shared/settingsRules.ts` → `agentEnv`). */
  cliEnvPassthrough: string[]
  /** Disk quota of the file store in MB (stored originals; project-folder files don't count). 0 = none. */
  filesQuotaMb: number
  /** An idle agent takes over a task queued for a busy twin (same role and skills). */
  shareWithTwins: boolean
  /** Race mode: each task also goes to a member with another provider / model; the lead keeps the better result. */
  raceMode: boolean
  /** Semantic memory: OpenAI-kind provider whose `/embeddings` endpoint embeds memories ('' = off, words only). */
  memoryEmbedProviderId: string
  /** Embedding model of that provider (e.g. text-embedding-3-small, nomic-embed-text). */
  memoryEmbedModel: string
  /** Learning from chat (graph memory): 'ask' = suggest and wait for the user, 'auto' = save right away, 'off'. */
  memoryLearn: 'ask' | 'auto' | 'off'
  /** Project memory folder: agents' notes — 'ask' = the user approves each, 'auto' = saved right away, 'off' = read only. */
  projectMemoryWrite: 'ask' | 'auto' | 'off'
}

export interface TerminalSession {
  id: string
  title: string
  shell: string
  cwd: string
  alive: boolean
  /** `pty`: real interactive terminal (node-pty); `pipe`: fallback without TTY. */
  mode: 'pty' | 'pipe'
}

export interface ProviderTestResult {
  ok: boolean
  message: string
}

/* ───────────────────────── organization & projects ───────────────────────── */

/** Organization tree node. Any unit can hold sub-units and agents; nesting is unlimited. */
export type UnitKind = 'organization' | 'company' | 'department' | 'team'

export interface UnitMember {
  agentId: string
  /** Optional title inside this unit, e.g. "Takım lideri", "Kıdemli analist". */
  title: string
}

export interface OrgUnit {
  id: string
  parentId: string | null
  name: string
  kind: UnitKind
  description: string
  color: string
  leadAgentId: string | null
  sortOrder: number
  members: UnitMember[]
  createdAt: string
  updatedAt: string
}

export type OrgUnitInput = Partial<Pick<OrgUnit, 'parentId' | 'name' | 'kind' | 'description' | 'color' | 'leadAgentId'>>

export type ProjectStatus = 'active' | 'archived'

/**
 * A project = a working folder + the units (teams) assigned to it. Agents are shared
 * across projects (one agent works on one task at a time); tasks, chat, decisions,
 * reports and project memories are scoped by `projectId`.
 */
export interface Project {
  id: string
  name: string
  description: string
  rootPath: string
  color: string
  leadAgentId: string | null
  status: ProjectStatus
  isDefault: boolean
  unitIds: string[]
  sortOrder: number
  /** Last time the project was opened in a tab (null = never). */
  lastOpenedAt: string | null
  /** `worktree`: each task works on its own git branch in a separate working copy and is merged when done. */
  isolation: 'shared' | 'worktree'
  /** Project memory folder (`.agentbits/memory` in the project folder) is read and written by agents. */
  projectMemory: boolean
  createdAt: string
  updatedAt: string
}

/** Folder state of a project, checked on disk by main. */
export type FolderStatus = 'ok' | 'missing' | 'unset'

/** Result of inspecting a folder the user picked as a project folder. */
export interface FolderInspection {
  /** Normalised absolute path. */
  path: string
  exists: boolean
  isDirectory: boolean
  /** The Agentbits application folder itself — never allowed as a project folder. */
  isAppFolder: boolean
  /** A drive root, the home folder (or a parent of it) or a folder holding Agentbits' data: too broad for agents. */
  tooBroad: boolean
  /** Project already using this folder, if any. */
  projectId: string | null
  /** Folder name, suggested as the project name. */
  suggestedName: string
}

export type ProjectInput = Partial<
  Pick<Project, 'name' | 'description' | 'rootPath' | 'color' | 'leadAgentId' | 'status' | 'unitIds' | 'isolation' | 'projectMemory'>
>

export interface TemplateAgentPreview {
  name: string
  role: string
  lead: boolean
}

export interface TemplateNodePreview {
  name: string
  kind: UnitKind
  agents: TemplateAgentPreview[]
  children: TemplateNodePreview[]
}

/** Built-in ready-made team / company blueprint. */
export interface TeamTemplate {
  id: string
  name: string
  description: string
  kind: UnitKind
  color: string
  agentCount: number
  unitCount: number
  tree: TemplateNodePreview
}

/* ───────────────────────────── data management ───────────────────────────── */

/** What can be cleared from a single project. */
export type DataPart = 'memories' | 'messages' | 'logs' | 'reports' | 'decisions' | 'tasks' | 'files'

export interface ProjectUsage {
  projectId: string
  name: string
  color: string
  status: ProjectStatus
  tasks: number
  runs: number
  messages: number
  logs: number
  memories: number
  decisions: number
  reports: number
  files: number
  fileBytes: number
}

export interface DataUsage {
  dataDir: string
  dbBytes: number
  walBytes: number
  backupsBytes: number
  /** Original attachment files on disk (content-addressed; kept while a backup still refers to them). */
  filesBytes: number
  filesCount: number
  /** Organization-wide memories (project_id IS NULL), and how many of them are accepted decisions. */
  orgMemories: number
  orgDecisionMemories: number
  agents: number
  units: number
  logs: number
  oldestLogAt: string | null
  projects: ProjectUsage[]
}

export interface BackupInfo {
  name: string
  path: string
  bytes: number
  createdAt: string
}

/** `work`: wipe tasks/chat/memory/logs/decisions/reports, keep organization, agents, projects, providers. `all`: back to first launch. */
export type ResetMode = 'work' | 'all'

/* ───────────────────────────── connections ───────────────────────────── */

export type { AccessLevel, ConnectionEnv, ConnectionKind, SshAuth } from './connections'
import type { AccessLevel, ConnectionEnv, ConnectionKind, SshAuth } from './connections'

/** A server / database the agents may use. Secrets never leave the main process. */
export interface Connection {
  id: string
  name: string
  kind: ConnectionKind
  env: ConnectionEnv
  /** What it is (e.g. "Şirketin ERP veritabanı"). */
  description: string
  /** What agents should use it for. */
  purpose: string
  /** Data / systems it contains, services it hosts. */
  notes: string
  host: string
  port: number
  username: string
  /** Databases only. */
  database: string
  /** SSH only. */
  sshAuth: SshAuth
  /** SSH `key-file`: path of the private key on this computer. */
  keyPath: string
  /** Databases: use TLS. */
  ssl: boolean
  /** SQL Server: accept a self-signed certificate. */
  trustServerCertificate: boolean
  /** Databases: reach the server through this SSH connection (the app opens the tunnel); null = directly. */
  viaSshId: string | null
  /** Databases: the user accepted an unencrypted production connection (private network addresses only). */
  allowPlaintext: boolean
  /** Optional read-only database login used for Read Only agents. */
  readOnlyUsername: string
  /** SSH command allow-lists per level (`*` = wildcard). */
  sshRead: string[]
  sshWrite: string[]
  sshExecute: string[]
  hasSecret: boolean
  hasReadOnlySecret: boolean
  /** SSH host key fingerprint pinned on first successful connection (TOFU). */
  hostKey: string | null
  lastTestAt: string | null
  lastTestOk: boolean | null
  lastTestMessage: string | null
  schemaFetchedAt: string | null
  createdAt: string
  updatedAt: string
}

export type ConnectionInput = Partial<
  Omit<Connection, 'id' | 'hasSecret' | 'hasReadOnlySecret' | 'hostKey' | 'lastTestAt' | 'lastTestOk' | 'lastTestMessage' | 'schemaFetchedAt' | 'createdAt' | 'updatedAt'>
> & {
  /** Password, private key text or key passphrase. `''` clears it; undefined keeps it. */
  secret?: string
  /** Password of the read-only login. `''` clears; undefined keeps. */
  readOnlySecret?: string
  /** Forget the pinned host key (after a legitimate server change). */
  resetHostKey?: boolean
}

export interface ConnectionPermission {
  connectionId: string
  agentId: string
  level: AccessLevel
}

export interface ConnectionTestResult {
  ok: boolean
  message: string
  latencyMs: number
  serverVersion?: string
  /** The server can't do TLS: the editor offers the SSH tunnel or the private-network exception. */
  hint?: 'serverNoTls'
}

export interface SchemaColumn {
  name: string
  type: string
  nullable: boolean
}
export interface SchemaTable {
  schema: string
  name: string
  kind: 'table' | 'view'
  columns: SchemaColumn[]
}
export interface SchemaInfo {
  fetchedAt: string
  tables: SchemaTable[]
  truncated: boolean
}

export type AuditResult = 'ok' | 'error' | 'denied' | 'pending'

export interface AuditEntry {
  id: number
  at: string
  actorType: 'agent' | 'user' | 'system'
  actorId: string | null
  actorName: string
  connectionId: string | null
  connectionName: string
  projectId: string | null
  taskId: string | null
  runId: string | null
  action: string
  detail: string
  result: AuditResult
  message: string | null
  durationMs: number | null
}

/** A destructive / data-changing operation on a production connection waiting for the user. */
export interface ConnectionApproval {
  id: string
  connectionId: string
  connectionName: string
  agentId: string
  agentName: string
  projectId: string | null
  taskId: string | null
  taskKey: string | null
  /** query / exec: a connection; app: a tool of an MCP app (connectionId / connectionName = the app, `tool` = its tool). */
  operation: 'query' | 'exec' | 'app'
  tool?: string
  detail: string
  needs: AccessLevel
  requestedAt: string
  expiresAt: string
}

/* ───────────────────────────── attachments ───────────────────────────── */

export type FileKind = 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'csv' | 'text' | 'markdown' | 'json' | 'image' | 'other'
/** user = uploaded; agent = saved by an agent (file_save); workspace = changed in the project folder by a CLI agent. */
export type FileOrigin = 'user' | 'agent' | 'workspace'
export type FileStatus = 'processing' | 'ready' | 'partial' | 'unsupported' | 'failed'
export type FileTargetType = 'message' | 'task' | 'run' | 'instruction'
/** attached = handed over by the user/lead; given = put into a prompt; read = read through a tool; generated = produced there. */
export type FileLinkRole = 'attached' | 'given' | 'read' | 'generated'

export interface FileRecord {
  id: string
  projectId: string | null
  name: string
  ext: string
  mime: string
  kind: FileKind
  size: number
  sha256: string
  origin: FileOrigin
  createdByType: 'user' | 'agent'
  createdById: string | null
  /** Workspace files: path relative to the project folder (never copied). */
  relPath: string | null
  status: FileStatus
  statusMessage: string | null
  warnings: string[]
  /** Lines that look like instructions to an AI (heuristic). The content is treated as data regardless. */
  suspicious: string[]
  pages: number | null
  sheets: string[] | null
  width: number | null
  height: number | null
  encoding: string | null
  chars: number
  chunkCount: number
  /** Every agent of the project may read it. */
  projectShared: boolean
  /** The original bytes are available (false after a restore from a backup that outlived them, or a deleted workspace file). */
  hasOriginal: boolean
  createdAt: string
  updatedAt: string
}

export interface FileLink {
  fileId: string
  targetType: FileTargetType
  targetId: string
  role: FileLinkRole
  /** Human label: "TA-12 · Başlık", "Sohbet · general", "Çalışma · Nehir"… */
  label: string
  createdAt: string
}

export interface FileDetail {
  file: FileRecord
  links: FileLink[]
  /** Agents explicitly allowed to read it (deny by default). */
  accessAgentIds: string[]
}

/** Who receives attachments sent from the chat. */
export type FileShare =
  | { type: 'lead' }
  | { type: 'agent'; agentId: string }
  | { type: 'unit'; unitId: string }
  | { type: 'project' }
  | { type: 'task'; taskId: string }

export interface FileChunkView {
  idx: number
  label: string
  text: string
}

export interface FilePreview {
  file: FileRecord
  chunks: FileChunkView[]
  offset: number
  total: number
  /** Images (≤ 15 MB) as a data URL for <img>. */
  imageDataUrl: string | null
}

export interface FileSearchHit {
  fileId: string
  fileName: string
  chunkIdx: number
  label: string
  snippet: string
}

export interface FileListOpts {
  projectId: string
  origin?: FileOrigin
  query?: string
  taskId?: string
  limit?: number
}

export interface SendOptions {
  fileIds?: string[]
  share?: FileShare
}
