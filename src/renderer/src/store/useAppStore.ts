import { DEFAULT_SETTINGS } from '@shared/settingsRules'
import { create } from 'zustand'
import type { Skill } from '@shared/skills'
import type { AppServer } from '@shared/apps'
import type { AppEvent } from '@shared/ipc'
import type {
  Agent,
  AgentLog,
  AgentPermissions,
  UsageSummary,
  Connection,
  ConnectionApproval,
  ConnectionPermission,
  AppSettings,
  Decision,
  MemorySuggestion,
  Message,
  OrgUnit,
  Project,
  Provider,
  Report,
  Run,
  Stats,
  Task,
  TeamTemplate
} from '@shared/types'
import { apiError, bridge, call } from '@/lib/api'
import { t } from '@/i18n'
import { applyNav } from '@/lib/notifyNav'
import type { UpdateState } from '@shared/update'

/** Sections inside a project tab. */
export type Tab = 'chat' | 'office' | 'team' | 'terminal' | 'tasks' | 'files' | 'reports' | 'decisions' | 'browser'
/** Top level: the organization page or one of the open project tabs. */
export type View = 'org' | 'project'
export type OrgTab = 'chart' | 'teams' | 'agents' | 'templates' | 'skills' | 'apps' | 'connections' | 'memory'
export type SettingsSection = 'agents' | 'permissions' | 'providers' | 'memory' | 'data' | 'limits' | 'general'

export interface Toast {
  id: number
  level: 'info' | 'success' | 'error'
  text: string
}

type Resource =
  | 'agents'
  | 'skills'
  | 'apps'
  | 'permissions'
  | 'providers'
  | 'tasks'
  | 'runs'
  | 'decisions'
  | 'reports'
  | 'settings'
  | 'stats'
  | 'orchestrator'
  | 'units'
  | 'projects'
  /** What agents learned from chat, waiting for the user's yes. */
  | 'memory'
  /** Chat feed, per-channel caches and agent logs (after bulk deletes). */
  | 'messages'
  /** Token usage summary (all projects). */
  | 'usage'
  /** Connections + per-agent connection permissions. */
  | 'connections'
  /** Production operations waiting for the user's approval. */
  | 'approvals'

interface State {
  ready: boolean
  settings: AppSettings
  /** New-version check (`main/update.ts`); null until loaded. */
  update: UpdateState | null
  providers: Provider[]
  agents: Agent[]
  permissions: AgentPermissions[]
  /** Every project's tasks; views filter by `activeProjectId`. Same for runs, feed, decisions, reports. */
  tasks: Task[]
  /** Done tasks per project in the database (the store holds the newest `DONE_WINDOW` unless expanded). */
  doneTotals: Record<string, number>
  /** Projects whose older done tasks the user loaded. */
  fullDoneProjects: string[]
  /** Reports kept per project (newest first); "Show older reports" raises it. */
  reportsWindow: number
  loadMoreReports: () => Promise<void>
  loadAllDone: (projectId: string) => Promise<void>
  units: OrgUnit[]
  projects: Project[]
  templates: TeamTemplate[]
  activeRuns: Run[]
  recentRuns: Run[]
  feed: Message[]
  /** Keyed by `channelKey(projectId, channel)`. */
  channels: Record<string, Message[]>
  logs: AgentLog[]
  decisions: Decision[]
  reports: Report[]
  /** Stats of the active project. */
  stats: Stats | null
  /** Token usage per agent (organization-wide; agents are shared across projects). */
  usage: UsageSummary | null
  /** Bumped on `instructions:changed`; agent terminals refetch their instruction queue. */
  instructionsVersion: number
  connections: Connection[]
  /** Installed skills (instruction packages), for the Skills page and agent / unit assignment. */
  skills: Skill[]
  /** Connected apps (MCP servers). */
  apps: AppServer[]
  connPerms: ConnectionPermission[]
  approvals: ConnectionApproval[]
  /** Bumped on `audit:changed`; audit views refetch. */
  auditVersion: number
  orchestratorPaused: boolean
  /** Held tasks → reason; done tasks not merged yet; reviews the lead left to the user. */
  orchestratorWaits: { held: Record<string, string>; unmerged: string[]; undecided: string[]; undecidedWhy: Record<string, string>; startedProjects: string[]; deferredReviews: string[]; simulatedWork: string[]; simulatedReview: string[]; waitEvents: string[] }
  /** A "needs you" card asked to show this connection / app request in the approval panel. */
  focusApproval: string | null
  /** A "needs you" card asked to open the merge preview of this task. */
  mergeReviewFor: string | null
  toasts: Toast[]
  memoryVersion: number
  memorySuggestions: MemorySuggestion[]
  /** Bumped on `files:changed`; file lists, chips and previews refetch. */
  filesVersion: number
  /** Setup guide drawer (Kılavuz). */
  guideOpen: boolean
  /** File open in the preview modal (`part` = 0-based chunk to scroll to). */
  filePreview: { id: string; part?: number } | null

  // ui
  view: View
  orgTab: OrgTab
  /** Templates opened from inside this project ("Add to this project" offered); null from the organization. */
  templateFor: string | null
  activeProjectId: string | null
  /** Project tabs open in the tab strip (persisted per viewer). */
  openProjectIds: string[]
  selectedUnitId: string | null
  /** `draft` pre-fills a new project (e.g. from a picked folder). */
  /** `fromLauncher`: closing the modal returns to the project picker. */
  projectModal: { open: boolean; projectId: string | null; draft?: ProjectDraft; fromLauncher?: boolean }
  /** Startup / "Open project…" picker. `preselect` = tabs open in the last session. */
  launcher: { open: boolean; preselect: string[] }
  /** Set when the first load failed (shown with a retry button). */
  initError: string | null
  tab: Tab
  chatChannel: string
  selectedTaskId: string | null
  selectedAgentId: string | null
  settingsOpen: boolean
  settingsSection: SettingsSection
  /** Project to expand in Ayarlar → Veri yönetimi (from the project modal shortcut). */
  dataFocusProjectId: string | null
  newTaskOpen: boolean
  newTaskAssigneeId: string | null // pre-selected assignee for the new-task modal

  init: () => Promise<void>
  openGuide: () => void
  closeGuide: () => void
  toggleGuide: () => void
  openFile: (id: string, part?: number) => void
  closeFile: () => void
  refresh: (r: Resource) => Promise<void>
  loadChannel: (channel: string) => Promise<void>
  setTab: (tab: Tab) => void
  /** Activates (and opens) a project tab. */
  openProject: (id: string) => void
  /** Opens several project tabs at once (from the picker) and activates the first. */
  openProjects: (ids: string[]) => void
  openLauncher: () => void
  closeLauncher: () => void
  /** Ctrl+Tab / Ctrl+Shift+Tab: activates the next / previous open project tab. */
  cycleProject: (dir: 1 | -1) => void
  closeProject: (id: string) => void
  /** `forProject`: opened from inside that project (templates offer to add the new team to it). */
  showOrg: (tab?: OrgTab, forProject?: string | null) => void
  selectUnit: (id: string | null) => void
  /** Opens the create (null) / edit project modal. */
  openProjectModal: (projectId?: string | null, draft?: ProjectDraft, opts?: { fromLauncher?: boolean }) => void
  closeProjectModal: () => void
  setChatChannel: (c: string) => void
  selectTask: (id: string | null) => void
  selectAgent: (id: string | null) => void
  openSettings: (section?: SettingsSection, focusProjectId?: string | null) => void
  closeSettings: () => void
  setNewTaskOpen: (v: boolean, assigneeId?: string | null) => void
  /** Opens Organizasyon → Ajanlar with the given agent selected (closes settings). */
  openAgentProfile: (id?: string | null) => void
  toast: (level: Toast['level'], text: string) => void
  dismissToast: (id: number) => void
}

/** Done tasks kept per project; older ones load on request ("Load all" in the Done column). */
export const DONE_WINDOW = 200
/** Reports kept per project at first; each "Show older reports" adds this many. */
const REPORTS_WINDOW = 300

/**
 * Unfinished tasks + the newest done tasks of each project; projects whose done tasks the user expanded get all of them
 * (`tasks:list` is cursor-paged). Keeps memory and reloads bounded however many tasks pile up.
 */
async function fetchBoardTasks(fullDone: string[]): Promise<{ tasks: Task[]; doneTotals: Record<string, number> }> {
  const board = await call('tasks:board', DONE_WINDOW)
  const byId = new Map(board.tasks.map((x) => [x.id, x]))
  for (const projectId of fullDone) {
    if ((board.doneTotals[projectId] ?? 0) <= DONE_WINDOW) continue
    let cursor: string | undefined
    do {
      const page = await call('tasks:list', { status: 'done', projectId, cursor, limit: 200 })
      for (const x of page.items) byId.set(x.id, x)
      cursor = page.nextCursor ?? undefined
    } while (cursor)
  }
  return { tasks: [...byId.values()], doneTotals: board.doneTotals }
}

export interface ProjectDraft {
  name?: string
  rootPath?: string
}

export const channelKey = (projectId: string | null | undefined, channel: string): string => `${projectId ?? '-'}::${channel}`

const LS_OPEN = 'agentbits:openProjects'
const LS_ACTIVE = 'agentbits:activeProject'
function lsGet<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v ? (JSON.parse(v) as T) : fallback
  } catch {
    return fallback
  }
}
function lsSet(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage unavailable */
  }
}

/** Keeps open tabs valid (existing, non-archived) and always non-empty. */
function normalizeTabs(projects: Project[], open: string[], active: string | null): { open: string[]; active: string | null } {
  const live = new Set(projects.filter((p) => p.status === 'active').map((p) => p.id))
  // No fallback: with nothing open the project area shows the start screen.
  const o = [...new Set(open.filter((id) => live.has(id)))]
  const a = active && o.includes(active) ? active : o[0] ?? null
  return { open: o, active: a }
}

let toastId = 0
let initStarted = false
let unsubscribe: (() => void) | null = null
const pending = new Set<Resource>()
let flushTimer: ReturnType<typeof setTimeout> | null = null

/** First load of everything (called by init; separate so a failed load can be retried). */
async function loadAll(): Promise<void> {
  const set = useAppStore.setState
  const [settings, providers, agents, permissions, board, activeRuns, recentRuns, feed, logs, decisions, reports, orch, units, projects, templates] =
    await Promise.all([
      call('settings:get'),
      call('providers:list'),
      call('agents:list'),
      call('permissions:list'),
      fetchBoardTasks([]),
      call('runs:list', { activeOnly: true }),
      call('runs:list', { limit: 60 }),
      call('messages:list', undefined, 200),
      call('logs:list', { limit: 400 }),
      call('decisions:list'),
      call('reports:list', REPORTS_WINDOW),
      call('orchestrator:state'),
      call('units:list'),
      call('projects:list'),
      call('templates:list')
    ])
  void call('usage:summary')
    .then((usage) => set({ usage }))
    .catch(() => undefined)
  void call('skills:list')
    .then((skills) => set({ skills }))
    .catch(() => undefined)
  void call('apps:list')
    .then((apps) => set({ apps }))
    .catch(() => undefined)
  void Promise.all([call('connections:list'), call('connections:permissions'), call('approvals:list')])
    .then(([connections, connPerms, approvals]) => set({ connections, connPerms, approvals }))
    .catch(() => undefined)
  const last = normalizeTabs(projects, lsGet<string[]>(LS_OPEN, []), lsGet<string | null>(LS_ACTIVE, null))
  // On launch either ask which projects to open, or restore the last session's tabs.
  // Before onboarding nothing opens; onboarding opens the project it set up.
  const restore = settings.onboarded && settings.startupProjects === 'restore' && last.open.length > 0
  const tabs = restore ? last : { open: [] as string[], active: null }
  if (restore) void call('projects:touch', tabs.open).catch(() => undefined)
  set({
    settings,
    providers,
    agents,
    permissions,
    tasks: board.tasks,
    doneTotals: board.doneTotals,
    activeRuns,
    recentRuns,
    feed,
    logs,
    decisions,
    reports,
    units,
    projects,
    templates,
    openProjectIds: tabs.open,
    activeProjectId: tabs.active,
    stats: tabs.active ? await call('stats:get', tabs.active) : null,
    orchestratorPaused: orch.paused,
    orchestratorWaits: waitsOf(orch),
    launcher: { open: settings.onboarded && !restore, preselect: last.open.length ? (last.active ? [last.active, ...last.open.filter((x) => x !== last.active)] : last.open) : [] },
    ready: true
  })
  if (!unsubscribe) unsubscribe = bridge().on(handleEvent)
  // A notification clicked while there was no window (macOS): its place, once the app is ready to show it.
  void call('update:status').then((update) => useAppStore.setState({ update }), () => undefined)
  void call('notify:takePending').then((target) => target && handleEvent({ type: 'navigate', target }), () => undefined)
  void useAppStore.getState().refresh('memory')
}

const waitsOf = (o: { held: { taskId: string; reason: string }[]; unmerged: string[]; undecided: string[]; undecidedWhy: Record<string, string>; startedProjects: string[]; deferredReviews: string[]; simulatedWork: string[]; simulatedReview: string[]; waitEvents: string[] }): State['orchestratorWaits'] => ({
  held: Object.fromEntries(o.held.map((h) => [h.taskId, h.reason])),
  unmerged: o.unmerged,
  undecided: o.undecided,
  undecidedWhy: o.undecidedWhy,
  startedProjects: o.startedProjects,
  deferredReviews: o.deferredReviews,
  simulatedWork: o.simulatedWork,
  simulatedReview: o.simulatedReview,
  waitEvents: o.waitEvents
})

export const useAppStore = create<State>((set, get) => ({
  ready: false,
  settings: { ...DEFAULT_SETTINGS },
  update: null,
  providers: [],
  agents: [],
  permissions: [],
  tasks: [],
  doneTotals: {},
  fullDoneProjects: [],
  reportsWindow: REPORTS_WINDOW,
  loadMoreReports: async () => {
    const reportsWindow = get().reportsWindow + REPORTS_WINDOW
    set({ reportsWindow, reports: await call('reports:list', reportsWindow) })
  },
  loadAllDone: async (projectId) => {
    const fullDoneProjects = [...new Set([...get().fullDoneProjects, projectId])]
    set({ fullDoneProjects, ...(await fetchBoardTasks(fullDoneProjects)) })
  },
  units: [],
  projects: [],
  templates: [],
  activeRuns: [],
  recentRuns: [],
  feed: [],
  channels: {},
  logs: [],
  decisions: [],
  reports: [],
  stats: null,
  usage: null,
  instructionsVersion: 0,
  connections: [],
  skills: [],
  apps: [],
  connPerms: [],
  approvals: [],
  auditVersion: 0,
  orchestratorPaused: false,
  orchestratorWaits: { held: {}, unmerged: [], undecided: [], undecidedWhy: {}, startedProjects: [], deferredReviews: [], simulatedWork: [], simulatedReview: [], waitEvents: [] },
  focusApproval: null,
  mergeReviewFor: null,
  toasts: [],
  memoryVersion: 0,
  memorySuggestions: [],
  filesVersion: 0,
  filePreview: null,
  guideOpen: false,

  view: 'project',
  orgTab: 'chart',
  templateFor: null,
  activeProjectId: null,
  openProjectIds: [],
  selectedUnitId: null,
  projectModal: { open: false, projectId: null },
  launcher: { open: false, preselect: [] },
  initError: null,
  tab: 'office',
  chatChannel: 'general',
  selectedTaskId: null,
  selectedAgentId: null,
  settingsOpen: false,
  settingsSection: 'agents',
  dataFocusProjectId: null,
  newTaskOpen: false,
  newTaskAssigneeId: null,

  openGuide: () => set({ guideOpen: true }),
  closeGuide: () => set({ guideOpen: false }),
  toggleGuide: () => set((s) => ({ guideOpen: !s.guideOpen })),
  openFile: (id, part) => set({ filePreview: { id, part } }),
  closeFile: () => set({ filePreview: null }),
  init: async () => {
    // React StrictMode runs effects twice in dev; subscribe/load only once.
    if (initStarted) return
    initStarted = true
    set({ initError: null })
    try {
      await loadAll()
    } catch (e) {
      initStarted = false
      set({ initError: apiError(e) })
    }
  },

  refresh: async (r) => {
    switch (r) {
      case 'agents':
        return set({ agents: await call('agents:list') })
      case 'permissions':
        return set({ permissions: await call('permissions:list') })
      case 'providers':
        return set({ providers: await call('providers:list') })
      case 'tasks':
        return set(await fetchBoardTasks(get().fullDoneProjects))
      case 'runs': {
        const [activeRuns, recentRuns] = await Promise.all([call('runs:list', { activeOnly: true }), call('runs:list', { limit: 60 })])
        return set({ activeRuns, recentRuns })
      }
      case 'decisions':
        return set({ decisions: await call('decisions:list') })
      case 'reports':
        return set({ reports: await call('reports:list', get().reportsWindow) })
      case 'settings':
        return set({ settings: await call('settings:get') })
      case 'stats': {
        const pid = get().activeProjectId
        return set({ stats: pid ? await call('stats:get', pid) : null })
      }
      case 'units':
        return set({ units: await call('units:list') })
      case 'memory':
        return set({ memorySuggestions: await call('memory:suggestions') })
      case 'projects': {
        const projects = await call('projects:list')
        const before = get()
        const tabs = normalizeTabs(projects, before.openProjectIds, before.activeProjectId)
        const changed = tabs.active !== before.activeProjectId || tabs.open.join() !== before.openProjectIds.join()
        if (!changed) return set({ projects })
        // A project open in a tab was deleted or archived elsewhere.
        lsSet(LS_OPEN, tabs.open)
        lsSet(LS_ACTIVE, tabs.active)
        set({ projects, openProjectIds: tabs.open, activeProjectId: tabs.active })
        if (tabs.active !== before.activeProjectId) {
          set({ chatChannel: 'general', selectedTaskId: null, selectedAgentId: null })
          void get().refresh('stats')
        }
        return
      }
      case 'orchestrator':
      {
        const orch = await call('orchestrator:state')
        return set({ orchestratorPaused: orch.paused, orchestratorWaits: waitsOf(orch) })
      }
      case 'usage':
        return set({ usage: await call('usage:summary') })
      case 'skills':
        return set({ skills: await call('skills:list') })
      case 'apps':
        return set({ apps: await call('apps:list') })
      case 'connections': {
        const [connections, connPerms] = await Promise.all([call('connections:list'), call('connections:permissions')])
        return set({ connections, connPerms })
      }
      case 'approvals':
        return set({ approvals: await call('approvals:list') })
      case 'messages': {
        const [feed, logs] = await Promise.all([call('messages:list', undefined, 200), call('logs:list', { limit: 400 })])
        set({ feed, logs, channels: {} })
        return get().loadChannel(get().chatChannel)
      }
    }
  },

  loadChannel: async (channel) => {
    const pid = get().activeProjectId
    if (!pid) return
    const msgs = await call('messages:list', channel, 200, pid)
    set((s) => ({ channels: { ...s.channels, [channelKey(pid, channel)]: msgs } }))
  },

  setTab: (tab) => set({ tab, view: 'project' }),
  openProject: (id) => {
    const p = get().projects.find((x) => x.id === id)
    if (!p) {
      get().toast('error', t('layout:store.projectNotFound'))
      void get().refresh('projects')
      return
    }
    if (p.status !== 'active') {
      get().toast('error', t('layout:store.projectArchived', { name: p.name }))
      return
    }
    void call('projects:touch', [id]).catch(() => undefined)
    const open = get().openProjectIds.includes(id) ? get().openProjectIds : [...get().openProjectIds, id]
    lsSet(LS_OPEN, open)
    lsSet(LS_ACTIVE, id)
    if (get().activeProjectId === id) {
      set({ openProjectIds: open, view: 'project', launcher: { ...get().launcher, open: false } })
      return
    }
    set({
      openProjectIds: open,
      activeProjectId: id,
      view: 'project',
      launcher: { ...get().launcher, open: false },
      chatChannel: 'general',
      selectedTaskId: null,
      selectedAgentId: null
    })
    void get().refresh('stats')
  },
  openProjects: (ids) => {
    const live = new Set(get().projects.filter((p) => p.status === 'active').map((p) => p.id))
    const valid = [...new Set(ids)].filter((id) => live.has(id))
    if (!valid.length) {
      get().toast('error', t('layout:store.noValidProjects'))
      return
    }
    if (valid.length < ids.length) get().toast('info', t('layout:store.someNotOpened', { count: ids.length - valid.length }))
    const open = [...get().openProjectIds, ...valid.filter((id) => !get().openProjectIds.includes(id))]
    set({ openProjectIds: open })
    get().openProject(valid[0])
    void call('projects:touch', valid).catch(() => undefined)
  },
  openLauncher: () => set({ launcher: { open: true, preselect: [] } }),
  closeLauncher: () => set((s) => ({ launcher: { ...s.launcher, open: false } })),
  cycleProject: (dir) => {
    const { openProjectIds: open, activeProjectId, view } = get()
    if (!open.length) return
    const idx = open.indexOf(activeProjectId ?? '')
    // From the org page, Ctrl+Tab returns to the active project first.
    const next = view === 'org' && idx >= 0 ? open[idx] : open[(idx + dir + open.length) % open.length]
    get().openProject(next)
  },
  closeProject: (id) => {
    const s = get()
    const idx = s.openProjectIds.indexOf(id)
    const open = s.openProjectIds.filter((x) => x !== id)
    // Closing the last tab leaves the start screen.
    const active = s.activeProjectId === id ? (open[Math.max(0, idx - 1)] ?? null) : s.activeProjectId
    lsSet(LS_OPEN, open)
    lsSet(LS_ACTIVE, active)
    if (active !== s.activeProjectId) {
      set({ openProjectIds: open, activeProjectId: active, chatChannel: 'general', selectedTaskId: null, selectedAgentId: null })
      void get().refresh('stats')
    } else set({ openProjectIds: open })
  },
  showOrg: (orgTab, forProject) => set((s) => ({ view: 'org', orgTab: orgTab ?? s.orgTab, templateFor: forProject ?? null })),
  selectUnit: (selectedUnitId) => set({ selectedUnitId }),
  openProjectModal: (projectId, draft, opts) =>
    set((s) => ({ projectModal: { open: true, projectId: projectId ?? null, draft, fromLauncher: !!opts?.fromLauncher }, launcher: { ...s.launcher, open: false } })),
  closeProjectModal: () =>
    set((s) => ({
      projectModal: { open: false, projectId: null },
      launcher: s.projectModal.fromLauncher ? { ...s.launcher, open: true } : s.launcher
    })),
  setChatChannel: (chatChannel) => {
    set({ chatChannel })
    void get().loadChannel(chatChannel)
  },
  selectTask: (selectedTaskId) => set({ selectedTaskId }),
  selectAgent: (selectedAgentId) => set({ selectedAgentId }),
  openSettings: (section, focusProjectId) =>
    set((s) => ({ settingsOpen: true, settingsSection: section ?? s.settingsSection, dataFocusProjectId: focusProjectId ?? null })),
  closeSettings: () => set({ settingsOpen: false }),
  setNewTaskOpen: (newTaskOpen, assigneeId) => set({ newTaskOpen, newTaskAssigneeId: newTaskOpen ? assigneeId ?? null : null }),
  openAgentProfile: (id) =>
    set((s) => ({ view: 'org', orgTab: 'agents', settingsOpen: false, selectedAgentId: id === undefined ? s.selectedAgentId : id })),
  toast: (level, text) => {
    const id = ++toastId
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, level, text }] }))
    setTimeout(() => get().dismissToast(id), 4200)
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}))

/** Coalesce bursts of change events into one refetch per resource. */
function schedule(...rs: Resource[]): void {
  rs.forEach((r) => pending.add(r))
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    const list = [...pending]
    pending.clear()
    list.forEach((r) =>
      useAppStore
        .getState()
        .refresh(r)
        .catch((e) => console.warn(`[agentbits] refresh ${r} failed`, e))
    )
  }, 120)
}

function handleEvent(e: AppEvent): void {
  const s = useAppStore.getState()
  switch (e.type) {
    case 'agents:changed':
      return schedule('agents', 'stats')
    case 'permissions:changed':
      return schedule('permissions')
    case 'providers:changed':
      return schedule('providers')
    case 'tasks:changed':
      return schedule('tasks', 'stats', 'orchestrator')
    case 'runs:changed':
      return schedule('runs', 'stats', 'usage')
    case 'usage:changed':
      return schedule('usage', 'stats')
    case 'connections:changed':
      return schedule('connections')
    case 'approvals:changed':
      return schedule('approvals')
    case 'audit:changed':
      useAppStore.setState({ auditVersion: s.auditVersion + 1 })
      return
    case 'instructions:changed':
      useAppStore.setState({ instructionsVersion: s.instructionsVersion + 1 })
      return
    case 'skills:changed':
      return schedule('skills')
    case 'apps:changed':
      return schedule('apps')
    case 'files:changed':
      useAppStore.setState({ filesVersion: s.filesVersion + 1 })
      return
    case 'decisions:changed':
      return schedule('decisions', 'stats')
    case 'reports:changed':
      return schedule('reports')
    case 'settings:changed':
      return schedule('settings')
    case 'update:changed':
      return useAppStore.setState({ update: e.state })
    case 'navigate':
      // A clicked notification: open the place it was about (screens only — nothing starts or is approved).
      return applyNav(e.target, () => useAppStore.getState())
    case 'orchestrator:changed':
      return schedule('orchestrator')
    case 'units:changed':
      return schedule('units')
    case 'projects:changed':
      return schedule('projects', 'stats')
    case 'messages:changed':
      return schedule('messages', 'stats')
    case 'memory:changed':
      useAppStore.setState({ memoryVersion: s.memoryVersion + 1 })
      return schedule('stats', 'memory')
    case 'message:updated': {
      // In place (a card closed): the list keeps its order and scroll position.
      const m = e.message
      const swap = (list: typeof s.feed): typeof s.feed => list.map((x) => (x.id === m.id ? m : x))
      const key = channelKey(m.projectId, m.channel)
      const channels = s.channels[key] ? { ...s.channels, [key]: swap(s.channels[key]) } : s.channels
      useAppStore.setState({ feed: swap(s.feed), channels })
      return
    }
    case 'message:new': {
      const m = e.message
      if (s.feed.some((x) => x.id === m.id)) return
      const channels = { ...s.channels }
      const key = channelKey(m.projectId, m.channel)
      if (channels[key] && !channels[key].some((x) => x.id === m.id)) channels[key] = [...channels[key], m]
      useAppStore.setState({ feed: [...s.feed.slice(-199), m], channels })
      return
    }
    case 'log:new':
      if (s.logs.length && s.logs[s.logs.length - 1].id >= e.log.id) return
      useAppStore.setState({ logs: [...s.logs.slice(-1499), e.log] })
      return
    case 'toast':
      s.toast(e.level, e.text)
      return
    default:
      return
  }
}

/* selectors */
export const agentById = (agents: Agent[], id: string | null | undefined): Agent | undefined =>
  id ? agents.find((a) => a.id === id) : undefined

export const projectById = (projects: Project[], id: string | null | undefined): Project | undefined =>
  id ? projects.find((p) => p.id === id) : undefined
