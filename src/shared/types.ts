// Domain types shared between the main process and the renderer.

export type ProviderKind = 'anthropic' | 'openai' | 'claude-cli' | 'codex-cli' | 'mock'

export interface Provider {
  id: string
  kind: ProviderKind
  label: string
  model: string
  hasKey: boolean // the key itself never leaves the main process
  cliPath: string | null
  isDefault: boolean
  createdAt: string
}

export interface ProviderInput {
  kind: ProviderKind
  label?: string
  model?: string
  apiKey?: string
  cliPath?: string | null
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
  /** Agent logs older than this are pruned automatically (0 = keep forever). */
  logRetentionDays: number
  /** On launch: 'ask' shows the project picker, 'restore' reopens the last open projects. */
  startupProjects: 'ask' | 'restore'
  /** Interface language code ('en', 'tr', …) or 'auto' = operating system language. */
  language: string
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
  Pick<Project, 'name' | 'description' | 'rootPath' | 'color' | 'leadAgentId' | 'status' | 'unitIds'>
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
