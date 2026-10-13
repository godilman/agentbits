import { useMemo } from 'react'
import type { Agent, OrgUnit, Project, Provider } from '@shared/types'
import { projectMemberIds } from '@shared/org'
import { useAppStore } from '@/store/useAppStore'
import { LANGUAGES } from '@shared/i18n'
import { i18n } from '@/i18n'

/**
 * Renderer mirror of the server-side project lead rule (`src/main/core/org.ts → projectLead`):
 * explicit project lead → lead of the first assigned unit that has one → organization lead
 * (`isLead`) → first member. Only enabled agents qualify.
 */
export function resolveProjectLead(project: Project | undefined, units: OrgUnit[], agents: Agent[]): Agent | null {
  const byId = new Map(agents.map((a) => [a.id, a]))
  const ok = (id: string | null | undefined): Agent | null => {
    const a = id ? byId.get(id) : undefined
    return a && a.enabled ? a : null
  }
  if (project) {
    const explicit = ok(project.leadAgentId)
    if (explicit) return explicit
    for (const uid of project.unitIds) {
      const l = ok(units.find((u) => u.id === uid)?.leadAgentId)
      if (l) return l
    }
  }
  const org = agents.find((a) => a.isLead && a.enabled)
  if (org) return org
  if (!project) return null
  const ids = new Set(projectMemberIds(project, units))
  return agents.find((a) => ids.has(a.id) && a.enabled) ?? null
}

/** Lead the project would get with "Auto": same rule, ignoring the explicit project lead. */
export function autoProjectLead(project: Pick<Project, 'unitIds'>, units: OrgUnit[], agents: Agent[]): Agent | null {
  return resolveProjectLead({ ...(project as Project), leadAgentId: null }, units, agents)
}

export const isCliProvider = (p: Provider | undefined | null): boolean => p?.kind === 'claude-cli' || p?.kind === 'codex-cli'

export const PROJECT_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#06b6d4', '#ef4444', '#8b5cf6', '#84cc16', '#f97316', '#64748b']

export interface ProjectScope {
  pid: string | null
  project: Project | undefined
  /** Agents in the project's units (incl. sub-units), org order. */
  members: Agent[]
  memberIds: Set<string>
  lead: Agent | null
  /** Members plus the resolved lead (who may come from outside the units, e.g. the org lead). */
  team: Agent[]
  teamIds: Set<string>
}

/** Active project + its members and lead, derived with useMemo from raw store slices. */
export function useProjectScope(): ProjectScope {
  const pid = useAppStore((s) => s.activeProjectId)
  const projects = useAppStore((s) => s.projects)
  const units = useAppStore((s) => s.units)
  const agents = useAppStore((s) => s.agents)
  return useMemo(() => {
    const project = pid ? projects.find((p) => p.id === pid) : undefined
    const memberIds = new Set(project ? projectMemberIds(project, units) : [])
    const members = agents.filter((a) => memberIds.has(a.id))
    const lead = resolveProjectLead(project, units, agents)
    const team = lead && !memberIds.has(lead.id) ? [lead, ...members] : members
    return { pid, project, members, memberIds, lead, team, teamIds: new Set(team.map((a) => a.id)) }
  }, [pid, projects, units, agents])
}

/** Shortens a folder path for chips: keeps the last segments. */
export function shortPath(p: string, max = 42): string {
  if (p.length <= max) return p
  const sep = p.includes('\\') ? '\\' : '/'
  const parts = p.split(sep).filter(Boolean)
  let out = parts.pop() ?? p
  while (parts.length && out.length + parts[parts.length - 1].length + 2 < max - 2) out = parts.pop() + sep + out
  return `…${sep}${out}`
}

/*
 * Agent status notes are written by the main process in the language that was active at that moment (they are
 * stored), so the few notes the UI reacts to are matched in every language. Keep these in sync with the
 * orchestrator's texts via the same keys (`orchestrator:status.typing` / `.reviewing`).
 */
const inAllLanguages = (key: 'orchestrator:status.typing' | 'orchestrator:status.reviewing', vars?: object): string[] =>
  LANGUAGES.map((l) => String(i18n.t(key, { lng: l.code, ...vars })))

/** True when the agent's status note says it is typing a chat reply. */
export const isTypingNote = (note: string | null | undefined): boolean =>
  !!note && inAllLanguages('orchestrator:status.typing').includes(note)

/** True when the agent's status note says it (the lead) is reviewing a task ("Review · TA-3" / "İnceleme · TA-3"). */
export const isReviewNote = (note: string | null | undefined): boolean =>
  !!note && inAllLanguages('orchestrator:status.reviewing', { key: '' }).some((p) => note.startsWith(p.trim()))
