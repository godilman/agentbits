import type { NavTarget } from '@shared/notify'
import { t } from '@/i18n'

/**
 * Where a clicked notification goes (`navigate` from `main/notify.ts`). A single event opens its place (the task's
 * details, the chat channel); a group the project's list. What changed since the notification is said, not hidden:
 * a deleted project or task, an approval answered meanwhile. Only opens screens — nothing starts, retries, is
 * approved or merged. Tests: `tests/renderer/notifyNav.test.ts`.
 */
export interface NavPlan {
  projectId: string | null
  tab?: 'tasks' | 'chat'
  taskId?: string
  channel?: string
  notice?: 'projectGone' | 'projectArchived' | 'taskGone' | 'agentGone' | 'approvalDone'
}

export function planNav(
  target: NavTarget,
  s: {
    projects: { id: string; status: string }[]
    tasks: { id: string; projectId: string | null }[]
    agents: { id: string }[]
    approvals: { id: string }[]
    activeRuns: { id: string; status: string }[]
  }
): NavPlan {
  const pid = target.projectId
  const project = s.projects.find((p) => p.id === pid)
  if (!project) return { projectId: null, notice: 'projectGone' }
  if (project.status !== 'active') return { projectId: null, notice: 'projectArchived' } // it can't be opened as it is
  if (target.view === 'chat') {
    const agentId = target.channel.startsWith('agent:') ? target.channel.slice(6) : null
    if (agentId && !s.agents.some((a) => a.id === agentId)) return { projectId: pid, tab: 'chat', channel: 'general', notice: 'agentGone' }
    return { projectId: pid, tab: 'chat', channel: target.channel }
  }
  if (target.view === 'tasks') {
    // An approval without a task (asked from a chat reply): the board, and a notice when it no longer waits.
    const answered = target.approvalId !== undefined && !s.approvals.some((x) => x.id === target.approvalId)
    return { projectId: pid, tab: 'tasks', ...(answered ? { notice: 'approvalDone' as const } : {}) }
  }
  if (!s.tasks.some((x) => x.id === target.taskId && x.projectId === pid)) return { projectId: pid, tab: 'tasks', notice: 'taskGone' }
  const answered =
    (target.approvalId !== undefined && !s.approvals.some((a) => a.id === target.approvalId)) ||
    (target.runId !== undefined && !s.activeRuns.some((r) => r.id === target.runId && r.status === 'awaiting_approval'))
  return { projectId: pid, tab: 'tasks', taskId: target.taskId, ...(answered ? { notice: 'approvalDone' as const } : {}) }
}

/** What `applyNav` needs from the store (the real one in the app, a fake in `tests/renderer/notifyNav.test.ts`). */
export interface NavStore {
  projects: { id: string; status: string }[]
  tasks: { id: string; projectId: string | null }[]
  agents: { id: string }[]
  approvals: { id: string }[]
  activeRuns: { id: string; status: string }[]
  activeProjectId: string | null
  newTaskOpen: boolean
  projectModal: { open: boolean }
  settingsOpen: boolean
  closeSettings: () => void
  openProject: (id: string) => void
  setTab: (tab: 'tasks' | 'chat') => void
  setChatChannel: (channel: string) => void
  selectTask: (id: string) => void
  toast: (level: 'info', text: string) => void
}

/** Opens the place of a clicked notification. `get` reads the store again after each step (openProject may refuse). */
export function applyNav(target: NavTarget, get: () => NavStore): void {
  const s = get()
  const plan = planNav(target, s)
  if (plan.projectId) {
    // A dialog with unsaved input (a new task, the project's settings) stays: switching the project under it would
    // lose what was typed or create the task in the other project.
    if (s.newTaskOpen || s.projectModal.open) return s.toast('info', t('layout:notifyNav.dialogOpen'))
    // Settings stay too: a provider form there holds unsaved input (a key, a model). Nothing is saved or tested here.
    if (s.settingsOpen) return s.toast('info', t('layout:notifyNav.settingsOpen'))
    s.closeSettings()
    s.openProject(plan.projectId)
    // openProject can refuse (the project changed meanwhile): then nothing else opens on another project.
    if (get().activeProjectId !== plan.projectId) return
    if (plan.tab) s.setTab(plan.tab)
    if (plan.channel) s.setChatChannel(plan.channel)
    if (plan.taskId) s.selectTask(plan.taskId)
  }
  if (plan.notice) s.toast('info', t(`layout:notifyNav.${plan.notice}`))
}
