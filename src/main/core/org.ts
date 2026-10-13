import type { Agent, Project } from '@shared/types'
import { projectMemberIds } from '@shared/org'
import { getDb } from '../db'
import { agentsRepo, projectsRepo, settingsRepo, unitsRepo } from '../db/repos'
import type { I18nKey } from '@shared/i18n'
import { allTranslations, t } from '../i18n'

/**
 * Organization / project resolution used by the orchestrator and IPC handlers.
 * Agents are shared across projects; a project's members are everyone in the
 * units assigned to it (including sub-units).
 */

/**
 * Idempotent: makes sure there is an organization root, at least one project,
 * and that legacy rows (pre-v3) belong to the default project. Safe on every boot.
 */
export function ensureOrgDefaults(): void {
  const db = getDb()
  db.transaction(() => {
    let root = unitsRepo.root()
    if (!root) root = unitsRepo.save({ name: t('main:defaults.organization'), kind: 'organization', parentId: null, color: '#6366f1' })

    let defaultId = projectsRepo.defaultId()
    const agents = agentsRepo.list()
    if (!defaultId) {
      // First run after migration v3 (or a fresh DB): put the existing team into a core unit
      // and create a default project from the legacy workspace folder.
      const units = unitsRepo.list().filter((u) => u.id !== root.id)
      let teamId = units[0]?.id
      if (!teamId && agents.length) {
        const lead = agents.find((a) => a.isLead) ?? null
        const team = unitsRepo.save({
          name: t('main:defaults.coreTeam'),
          kind: 'team',
          parentId: root.id,
          description: t('main:defaults.coreTeamDescription'),
          color: '#6366f1',
          leadAgentId: lead?.id ?? null
        })
        for (const a of agents) unitsRepo.addMember(team.id, a.id, a.isLead ? t('main:defaults.teamLead') : '')
        teamId = team.id
      }
      const project = projectsRepo.save(
        {
          name: t('main:defaults.project'),
          description: t('main:defaults.projectDescription'),
          rootPath: settingsRepo.get().workspaceRoot || '',
          color: '#6366f1',
          leadAgentId: agents.find((a) => a.isLead)?.id ?? null,
          unitIds: teamId ? [teamId] : []
        },
        undefined,
        { isDefault: true }
      )
      defaultId = project.id
    }
    for (const table of ['tasks', 'runs', 'messages', 'decisions', 'reports']) {
      db.prepare(`UPDATE ${table} SET project_id = ? WHERE project_id IS NULL`).run(defaultId)
    }
    // Task-bound memories belong to the task's project; free-standing ones stay organization-wide.
    db.prepare(
      `UPDATE memories SET project_id = (SELECT project_id FROM tasks WHERE tasks.id = memories.task_id)
       WHERE project_id IS NULL AND task_id IS NOT NULL`
    ).run()
  })()
}

/**
 * After a language change: default names nobody has edited yet ("Organizasyon" → "Organization",
 * "Varsayılan Proje" → "Default Project", …) follow the new language. Edited names are left alone.
 */
export function relabelDefaults(): void {
  const db = getDb()
  const pairs: [string, string, I18nKey][] = [
    ['units', 'name', 'main:defaults.organization'],
    ['units', 'name', 'main:defaults.coreTeam'],
    ['units', 'description', 'main:defaults.coreTeamDescription'],
    ['projects', 'name', 'main:defaults.project'],
    ['projects', 'description', 'main:defaults.projectDescription'],
    ['unit_members', 'title', 'main:defaults.teamLead']
  ]
  db.transaction(() => {
    for (const [table, col, key] of pairs) {
      const all = allTranslations(key)
      const now = t(key)
      const others = all.filter((x) => x !== now)
      if (!others.length) continue
      db.prepare(`UPDATE ${table} SET ${col} = ? WHERE ${col} IN (${others.map(() => '?').join(',')})`).run(now, ...others)
    }
  })()
}

export function getProject(projectId: string | null | undefined): Project | null {
  return projectsRepo.get(projectId) ?? projectsRepo.get(projectsRepo.defaultId())
}

/** Agents working on the project (callers filter `enabled` where it matters). */
export function projectMembers(projectId: string): Agent[] {
  const project = projectsRepo.get(projectId)
  if (!project) return []
  const ids = new Set(projectMemberIds(project, unitsRepo.list()))
  return agentsRepo.list().filter((a) => ids.has(a.id))
}

/**
 * Who leads the project: explicit project lead → lead of the first assigned unit
 * that has one → organization lead (`isLead`) → first member.
 */
export function projectLead(projectId: string): Agent | null {
  const project = projectsRepo.get(projectId)
  const agents = agentsRepo.list()
  const byId = new Map(agents.map((a) => [a.id, a]))
  const ok = (id: string | null | undefined): Agent | null => {
    const a = id ? byId.get(id) : undefined
    return a && a.enabled ? a : null
  }
  if (project) {
    const explicit = ok(project.leadAgentId)
    if (explicit) return explicit
    const units = unitsRepo.list()
    for (const uid of project.unitIds) {
      const u = units.find((x) => x.id === uid)
      const l = ok(u?.leadAgentId)
      if (l) return l
    }
  }
  const org = agents.find((a) => a.isLead && a.enabled)
  if (org) return org
  return project ? projectMembers(project.id).find((a) => a.enabled) ?? null : null
}

/** Active projects the agent is a member of (for picking unassigned work). */
export function memberProjectIds(agentId: string): string[] {
  const units = unitsRepo.list()
  return projectsRepo
    .list()
    .filter((p) => p.status === 'active' && projectMemberIds(p, units).includes(agentId))
    .map((p) => p.id)
}

export function activeProjectIds(): string[] {
  return projectsRepo
    .list()
    .filter((p) => p.status === 'active')
    .map((p) => p.id)
}
