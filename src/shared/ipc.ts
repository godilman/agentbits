import type { ReplyStreamEvent } from './replyStream'
import type { FeedbackKind } from './support'
import type { AppImportCandidate, AppServer, AppServerInput, AppTestResult, ToolPolicy } from './apps'
import type { AgentSkill, Skill, SkillDetail, SkillPreview, SkillSourceInput, SkillTargetType } from './skills'
import type { SharePreview } from './share'
import type { NavTarget } from './notify'
import type { UpdateState } from './update'
import type {
  Agent,
  ProviderKind,
  AccessLevel,
  AuditEntry,
  AuditResult,
  Connection,
  ConnectionApproval,
  ConnectionInput,
  ConnectionPermission,
  ConnectionTestResult,
  SchemaInfo,
  AgentInstruction,
  InstructionInput,
  UsageSummary,
  BackupInfo,
  DataPart,
  FolderInspection,
  FolderStatus,
  DataUsage,
  ResetMode,
  AgentInput,
  AgentLog,
  AgentPermissions,
  AppSettings,
  CancelScope,
  RecoveryInfo,
  Decision,
  DecisionInput,
  Memory,
  MemoryGraph,
  MemorySuggestion,
  MemoryKind,
  Message,
  NeedsAction,
  NeedsActResult,
  MessageDraft,
  TaskResult,
  OrgUnit,
  OrgUnitInput,
  Project,
  ProjectInput,
  TeamTemplate,
  PermissionsPatch,
  Provider,
  ProviderInput,
  ProviderTestResult,
  Report,
  Run,
  Stats,
  Task,
  TaskInput,
  TaskListOpts,
  TaskPage,
  TaskBoard,
  TaskStatus,
  TerminalSession,
  FileDetail,
  FileListOpts,
  FilePreview,
  FileRecord,
  FileSearchHit,
  SendOptions
} from './types'

/**
 * Typed request/response contract. Every method is invoked through the single
 * `api` IPC channel: ipcRenderer.invoke('api', method, ...args).
 */
export interface Api {
  // settings
  'settings:get': () => AppSettings
  /** A clicked notification's place kept while there was no window (`main/notify.ts`); taken once. */
  'notify:takePending': () => NavTarget | null
  'settings:update': (patch: Partial<AppSettings>) => AppSettings
  'app:pickFolder': () => string | null
  'app:info': () => { version: string; dbPath: string; platform: string }
  /** New-version check (`main/update.ts`): its state, a check now, and the official release page in the browser. */
  'update:status': () => UpdateState
  'update:check': () => UpdateState
  'update:openPage': () => void
  /** Opens the developer's fixed support page (Buy Me a Coffee) in the system browser. */
  'app:openSupport': () => void
  /**
   * Opens the user's mail app with a new message to the developer's fixed feedback address: subject and a body
   * template for the kind (a bug report includes app version, OS and language). `rating` 1–5 goes into a thanks mail.
   */
  'app:feedbackMail': (kind: FeedbackKind, rating?: number) => void

  // providers
  'providers:list': () => Provider[]
  'providers:save': (input: ProviderInput, id?: string) => Provider
  'providers:delete': (id: string) => void
  'providers:test': (id: string) => ProviderTestResult
  'providers:detectCli': () => { claude: string | null; codex: string | null }
  /**
   * The account's live model list for API providers (Anthropic / OpenAI), using the saved key of `providerId` or a key
   * typed in the form. `live` is null for kinds without a live list; `error` when the request failed (the UI then
   * shows the built-in catalog only).
   */
  'providers:models': (input: { kind: ProviderKind; providerId?: string; apiKey?: string; baseUrl?: string }) => { live: { id: string; label: string }[] | null; error?: string }

  // agents & permissions
  'agents:list': () => Agent[]
  /** Creates (no id) or updates an agent. `permissions` is applied in the same transaction. */
  'agents:save': (input: AgentInput, id?: string, permissions?: PermissionsPatch) => Agent
  'agents:delete': (id: string) => void
  /** A twin for parallel work (profile, permissions, units, skill / app / connection / file grants; new name). */
  'agents:duplicate': (id: string) => Agent
  'agents:setStatus': (id: string, status: Agent['status']) => void
  'permissions:list': () => AgentPermissions[]
  'permissions:update': (agentId: string, patch: PermissionsPatch) => AgentPermissions

  // organization (units = companies / departments / teams, unlimited nesting)
  'units:list': () => OrgUnit[]
  'units:save': (input: OrgUnitInput, id?: string) => OrgUnit
  /** Deletes the unit and all of its sub-units. Agents are kept (only memberships go). */
  'units:delete': (id: string) => void
  /** Adds the agent to the unit, or updates its title if already a member. */
  'units:addMember': (unitId: string, agentId: string, title?: string) => OrgUnit
  'units:removeMember': (unitId: string, agentId: string) => OrgUnit
  'templates:list': () => TeamTemplate[]
  /** Creates the template's units and agents under `parentId` (default: organization root). */
  /** `projectId`: the new team is added to that project too (set up from inside it, "Add to this project"). */
  'templates:instantiate': (templateId: string, opts?: { parentId?: string | null; name?: string; projectId?: string }) => { unitId: string; agentIds: string[] }
  /** Saves a unit (with everything under it) or an agent as a .agentbits file; null = cancelled. */
  'share:export': (target: { type: 'unit' | 'agent'; id: string }) => string | null
  /** Reads a package from a file the user picks (null = cancelled) or a GitHub link, for the import preview. */
  'share:preview': (source: { type: 'file' } | { type: 'url'; url: string }) => SharePreview | null
  'share:import': (stagingId: string, parentId: string | null) => { unitId: string | null; agentIds: string[]; reusedSkills: string[] }

  // projects
  'projects:list': () => Project[]
  'projects:save': (input: ProjectInput, id?: string) => Project
  /** Deletes the project with its tasks, runs, chat, decisions, reports and project memories. */
  'projects:delete': (id: string) => void
  /** Records that the projects were opened (recent order in the startup picker). */
  'projects:touch': (ids: string[]) => void
  /** Checks every project's folder on disk. */
  'projects:folderStatus': () => Record<string, FolderStatus>
  /** Validates a folder picked as a project folder (exists, not the app itself, already used by a project?). */
  'projects:inspectFolder': (path: string) => FolderInspection

  // tasks
  'tasks:list': (opts?: TaskListOpts) => TaskPage
  /** Unfinished tasks + the newest `doneLimit` done tasks of each project (security review #27). */
  'tasks:board': (doneLimit: number) => TaskBoard
  /** Worktree mode: merge a done task's branch now (true while it still waits, e.g. uncommitted changes in the folder). */
  /** Merges the task's copy if it still is what `basis` (from tasks:changes) says; otherwise throws the reason. */
  'tasks:merge': (id: string, basis: string) => boolean
  'tasks:mergePending': (id: string) => boolean
  /** The latest run's result: what really ran (tool record), who reviewed it, what changed (worktree). */
  'tasks:result': (id: string) => TaskResult
  /** "What changed?" from git (worktree projects): files with +/- lines and the diff; null without git history. */
  'tasks:changes': (id: string) => { files: { path: string; added: number; removed: number }[]; diff: string; truncated: boolean; basis: string } | null
  'tasks:create': (input: TaskInput) => Task
  'tasks:update': (id: string, patch: Partial<Pick<Task, 'title' | 'description' | 'priority' | 'assigneeId' | 'acceptance'>>) => Task
  /** `force`: start even though tasks it depends on aren't done (the user confirmed). */
  'tasks:move': (id: string, status: TaskStatus, sortOrder?: number, force?: boolean) => Task
  'tasks:delete': (id: string) => void
  'tasks:start': (id: string, force?: boolean) => void
  /** Keys of the unfinished tasks this one waits for (asked before a manual start). */
  /** Only the lead's review again (the worker is not run again); 'pending' when one is already queued or running. */
  'tasks:retryReview': (id: string) => 'queued' | 'pending'
  /** What cancelling covers (for the confirmation). */
  'tasks:cancelScope': (id: string) => CancelScope
  /** Cancels the task (and its race attempt); `stopped`: no run of it is still running (else only requested). */
  'tasks:cancel': (id: string) => { keys: string[]; stopped: boolean }
  /** Lifts the cancel; nothing starts on its own. */
  'tasks:reopen': (id: string) => string[]
  /** A "needs you" card's action from the chat (checked again in main; `orchestrator.act`). */
  'needs:act': (projectId: string, event: string, action: NeedsAction) => NeedsActResult
  /** Start autopilot for this project in this session (opening a project starts nothing; held tasks stay held). */
  'projects:startWork': (id: string) => void
  'tasks:waitingFor': (id: string) => string[]
  /** Prompt builder: one stateless model call on this message only (no tools, nothing stored but the token count). */
  'promptBuilder:generate': (requestId: string, text: string, providerId?: string | null) => { prompt: string; provider: string; model: string }
  'promptBuilder:cancel': (requestId: string) => void

  // runs
  'runs:list': (opts?: { activeOnly?: boolean; taskId?: string; limit?: number }) => Run[]
  'runs:pause': (runId: string) => void
  'runs:resume': (runId: string) => void
  'runs:stop': (runId: string) => void
  'runs:approve': (runId: string, approved: boolean) => void
  /** Transcript entries, newest `limit` (oldest first); `beforeId` pages back. */
  'logs:list': (opts: { runId?: string; taskId?: string; agentId?: string; projectId?: string; beforeId?: number; limit?: number }) => AgentLog[]

  // connections (servers / databases), permissions, approvals, audit
  'connections:list': () => Connection[]
  'connections:save': (input: ConnectionInput, id?: string) => Connection
  'connections:delete': (id: string) => void
  'connections:test': (id: string) => ConnectionTestResult
  /** Cached schema; `refresh` reads it from the database again. */
  'connections:schema': (id: string, refresh?: boolean) => SchemaInfo | null
  'connections:permissions': () => ConnectionPermission[]
  'connections:setPermission': (connectionId: string, agentId: string, level: AccessLevel) => void
  'approvals:list': () => ConnectionApproval[]
  'approvals:resolve': (id: string, ok: boolean) => void
  'audit:list': (opts: { connectionId?: string; actorId?: string; result?: AuditResult; beforeId?: number; limit?: number }) => AuditEntry[]
  'app:pickFile': (title?: string) => string | null

  // skills (instruction packages; see src/shared/skills.ts)
  'skills:list': () => Skill[]
  'skills:get': (id: string) => SkillDetail
  /** A file's text inside a skill (text files only). */
  'skills:file': (id: string, path: string) => string
  /** Reads a GitHub location / folder / .zip / .md and lists the skills found; nothing is installed yet. */
  'skills:preview': (source: SkillSourceInput) => SkillPreview
  'skills:install': (stagingId: string, keys: string[]) => Skill[]
  /** Creates a skill (no id) or saves an edited SKILL.md (front matter with name + description required). */
  'skills:saveMd': (content: string, id?: string) => Skill
  'skills:update': (id: string) => Skill
  'skills:setEnabled': (id: string, enabled: boolean) => void
  'skills:delete': (id: string) => void
  'skills:assign': (id: string, target: { type: SkillTargetType; id: string }, on: boolean) => void
  /** Skills an agent can use (direct + through its units), with where they come from. */
  'skills:forAgent': (agentId: string) => AgentSkill[]
  /** Folder or .zip / .md file picker for installing from the computer. */
  'skills:pickSource': (kind: 'folder' | 'file') => string | null
  /** Private GitHub repositories: whether a token is stored / store one ('' removes). The token never comes back. */
  'skills:githubToken': () => boolean
  'skills:setGithubToken': (token: string) => boolean

  // apps (MCP servers; see src/shared/apps.ts)
  'apps:list': () => AppServer[]
  /** Creates (no id) or updates an app; secrets in `env` / `headers` are write-only. Closes its live connection. */
  'apps:save': (input: AppServerInput, id?: string) => AppServer
  'apps:delete': (id: string) => void
  /** Connects, lists the tools and stores them. */
  'apps:test': (id: string) => AppTestResult
  /** OAuth sign-in in the browser (remote apps), then lists the tools. */
  'apps:signIn': (id: string) => AppTestResult
  'apps:signOut': (id: string) => void
  /** Per-tool override; null returns to the default (read-only → auto, otherwise approve). */
  'apps:setPolicy': (id: string, tool: string, policy: ToolPolicy | null) => void
  'apps:setPermission': (id: string, agentId: string, on: boolean) => void
  /** Server definitions from Claude Desktop's config or pasted JSON (not saved). */
  'apps:import': (source: { type: 'claude-desktop' } | { type: 'json'; text: string }) => AppImportCandidate[]

  // direct instructions & token usage
  /** Sends a direct instruction to one agent (serialised per agent; rejected if the agent moved on). */
  'agents:instruct': (input: InstructionInput) => { instruction: AgentInstruction; message: string }
  'instructions:list': (opts: { agentId?: string; projectId?: string; limit?: number }) => AgentInstruction[]
  /** Token usage per agent (all time / this app session / current task) + totals; optionally for one project. */
  'usage:summary': (projectId?: string | null) => UsageSummary
  'usage:daily': (days: number, projectId?: string | null) => { day: string; input: number; output: number; cache: number }[]

  // chat
  'messages:list': (channel?: string, limit?: number, projectId?: string) => Message[]
  /** `opts.fileIds`: attachments uploaded with files:add; `opts.share` overrides who receives them (default: by channel). */
  'messages:send': (channel: string, content: string, projectId: string, opts?: SendOptions) => Message
  /** Unsent drafts (all projects); saving an empty one removes it. */
  'drafts:list': () => MessageDraft[]
  'drafts:save': (draft: MessageDraft) => void

  // attachments
  'files:list': (opts: FileListOpts) => FileRecord[]
  'files:byIds': (ids: string[]) => FileRecord[]
  'files:get': (id: string) => FileDetail
  /** Native multi-select dialog; returns file paths. */
  'files:pick': () => string[]
  /** Copies files into the store; extraction continues in the background (files:changed). */
  'files:add': (projectId: string, paths: string[]) => FileRecord[]
  /** Data without a path (pasted screenshot…). */
  'files:addData': (projectId: string, name: string, data: Uint8Array) => FileRecord
  'files:delete': (id: string) => void
  'files:preview': (id: string, offset?: number, limit?: number) => FilePreview
  'files:search': (projectId: string, query: string) => FileSearchHit[]
  /** Save-as dialog; returns the written path. */
  'files:saveAs': (id: string) => string | null
  /** Opens with the system app (safe document/image types only). */
  'files:open': (id: string) => void
  /** Shows a project-folder file in the OS file manager. */
  'files:reveal': (id: string) => void
  'files:setAccess': (id: string, agentId: string, allowed: boolean) => void
  'files:setProjectShared': (id: string, shared: boolean) => void
  'files:attachToTask': (taskId: string, fileIds: string[]) => void
  'files:detachFromTask': (taskId: string, fileId: string) => void

  // memory
  'memory:list': (opts?: { agentId?: string | null; query?: string; limit?: number; projectId?: string | null }) => Memory[]
  /** `projectId` null/omitted = organization-wide memory. */
  'memory:add': (content: string, kind: MemoryKind, agentId?: string | null, projectId?: string | null) => Memory
  'memory:delete': (id: string) => void
  /** Edit a memory's text and topics (re-embedded when semantic memory is on). */
  'memory:update': (id: string, content: string, topics: string[]) => Memory
  /** The memory graph (organization-wide + the project's, or everything when omitted). */
  'memory:graph': (projectId?: string | null) => MemoryGraph
  /** What agents learned from chat and wait for the user's yes. */
  'memory:suggestions': () => MemorySuggestion[]
  /** Save a suggestion (optionally with edited text); it replaces the memory it names. A project memory note is appended to its file (null). */
  'memory:accept': (id: string, content?: string) => Memory | null
  'memory:dismiss': (id: string) => void
  /** Semantic memory: on, how many memories have a vector for the current model, last error ('' = none). */
  'memory:vectorStatus': () => { enabled: boolean; indexed: number; total: number; error: string }

  // decisions
  'decisions:list': () => Decision[]
  'decisions:save': (input: DecisionInput, id?: string) => Decision
  'decisions:delete': (id: string) => void

  // reports
  /** Newest `perProject` reports of each project (all when omitted). */
  'reports:list': (perProject?: number) => Report[]
  'reports:generateDaily': (projectId: string) => Report
  /** The project lead writes a report on the user's request from the project's data (kind "custom"). */
  'reports:generateCustom': (projectId: string, request: string) => Report
  'reports:delete': (id: string) => void
  'stats:get': (projectId?: string) => Stats

  // terminal
  'terminal:list': () => TerminalSession[]
  'terminal:create': (cwd?: string) => TerminalSession
  'terminal:write': (id: string, data: string) => void
  'terminal:resize': (id: string, cols: number, rows: number) => void
  'terminal:kill': (id: string) => void
  'terminal:buffer': (id: string) => string

  // data management
  'data:usage': () => DataUsage
  /** Clears the chosen parts of one project. `keepDecisionMemories` keeps accepted-decision memories when clearing memories. */
  'data:clearProject': (projectId: string, parts: DataPart[], opts?: { keepDecisionMemories?: boolean }) => { deleted: number }
  /** Clears organization-wide memories (project_id IS NULL). */
  'data:clearOrgMemory': (opts: { keepDecisions: boolean }) => { deleted: number }
  /** Deletes agent logs older than N days (0 = all logs). */
  'data:pruneLogs': (olderThanDays: number) => { deleted: number }
  'data:backup': () => BackupInfo
  'data:listBackups': () => BackupInfo[]
  'data:deleteBackup': (name: string) => void
  /** Swaps the live DB for the backup (after backing up the current one) and restarts the app. */
  'data:restoreBackup': (name: string) => void
  'data:openFolder': () => void
  /** Takes a backup first, then wipes data; every window reloads afterwards. */
  'data:factoryReset': (mode: ResetMode) => { backup: BackupInfo }

  // orchestrator
  'orchestrator:pauseAll': () => void
  'orchestrator:resumeAll': () => void
  /** Pause state + what waits for the user: held tasks (with reason), done tasks not merged yet, reviews the lead left open. */
  'orchestrator:state': () => {
    paused: boolean
    held: { taskId: string; reason: string }[]
    unmerged: string[]
    undecided: string[]
    /** Why each undecided task waits for the user (review failed, no lead, no report, unclear verdict). */
    undecidedWhy: Record<string, string>
    /** Projects whose work the user started in this session (autopilot runs only there). */
    startedProjects: string[]
    deferredReviews: string[]
    /** Tasks whose latest run was a Demo simulation / whose review since that run was. Labelled separately. */
    simulatedWork: string[]
    simulatedReview: string[]
    /** Card events of the waits that are still open (held, undecided, merge): a card whose event isn't here is over. */
    waitEvents: string[]
    recovering: Record<string, RecoveryInfo>
  }
}

export type ApiMethod = keyof Api
export type ApiArgs<M extends ApiMethod> = Parameters<Api[M]>
export type ApiResult<M extends ApiMethod> = ReturnType<Api[M]>

/** Push events from main → renderer on the `event` channel. */
export type AppEvent =
  | { type: 'agents:changed' }
  | { type: 'permissions:changed' }
  | { type: 'providers:changed' }
  | { type: 'tasks:changed' }
  | { type: 'runs:changed' }
  | { type: 'decisions:changed' }
  | { type: 'reports:changed' }
  | { type: 'memory:changed' }
  | { type: 'settings:changed' }
  | { type: 'orchestrator:changed' }
  | { type: 'units:changed' }
  | { type: 'projects:changed' }
  | { type: 'usage:changed' }
  | { type: 'connections:changed' }
  | { type: 'approvals:changed' }
  | { type: 'audit:changed' }
  | { type: 'instructions:changed' }
  | { type: 'files:changed' }
  | { type: 'skills:changed' }
  | { type: 'apps:changed' }
  /** Messages/logs were bulk-deleted: refetch feed, channels and logs. */
  | { type: 'messages:changed' }
  | { type: 'message:new'; message: Message }
  /** A message's meta changed in place (a "needs you" card was resolved). */
  | { type: 'message:updated'; message: Message }
  /** A chat reply while it is written (not stored; the stored message follows as message:new, meta.replyId). */
  | ({ type: 'reply:stream' } & ReplyStreamEvent)
  | { type: 'log:new'; log: AgentLog }
  | { type: 'terminal:data'; id: string; data: string }
  | { type: 'terminal:exit'; id: string; code: number | null }
  | { type: 'toast'; level: 'info' | 'success' | 'error'; text: string }
  /** A notification was clicked: open this place (`main/notify.ts`). */
  | { type: 'navigate'; target: NavTarget }
  | { type: 'update:changed'; state: UpdateState }

export interface PreloadBridge {
  invoke<M extends ApiMethod>(method: M, ...args: ApiArgs<M>): Promise<Awaited<ApiResult<M>>>
  on(listener: (event: AppEvent) => void): () => void
  platform: string
  /** Real path of a dropped / picked File ('' when it has none, e.g. pasted data). */
  pathForFile(file: File): string
}
