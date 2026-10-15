import type { OrgUnit, Project } from './types'

/**
 * Pure helpers for the organization tree, shared by main and renderer so both
 * resolve "who belongs to this project" exactly the same way.
 */

/** The unit itself plus every unit below it. */
export function descendantIds(units: OrgUnit[], rootId: string): string[] {
  const children = new Map<string, string[]>()
  for (const u of units) {
    if (!u.parentId) continue
    const list = children.get(u.parentId) ?? []
    list.push(u.id)
    children.set(u.parentId, list)
  }
  const out: string[] = []
  const stack = [rootId]
  const seen = new Set<string>()
  while (stack.length) {
    const id = stack.pop()!
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
    stack.push(...(children.get(id) ?? []))
  }
  return out
}

/** Agent ids in a unit; with `deep` also everyone in its sub-units. */
export function unitMemberIds(units: OrgUnit[], unitId: string, deep = true): string[] {
  const ids = deep ? descendantIds(units, unitId) : [unitId]
  const byId = new Map(units.map((u) => [u.id, u]))
  const out = new Set<string>()
  for (const id of ids) for (const m of byId.get(id)?.members ?? []) out.add(m.agentId)
  return [...out]
}

/** Everyone working on a project: members of the assigned units and all their sub-units. */
export function projectMemberIds(project: Pick<Project, 'unitIds'>, units: OrgUnit[]): string[] {
  const out = new Set<string>()
  for (const uid of project.unitIds) for (const a of unitMemberIds(units, uid, true)) out.add(a)
  return [...out]
}

/** Path from the root to the unit (inclusive), for breadcrumbs. */
export function unitPath(units: OrgUnit[], unitId: string): OrgUnit[] {
  const byId = new Map(units.map((u) => [u.id, u]))
  const out: OrgUnit[] = []
  let cur = byId.get(unitId)
  const seen = new Set<string>()
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    out.unshift(cur)
    cur = cur.parentId ? byId.get(cur.parentId) : undefined
  }
  return out
}

/** True if `candidateParentId` is the unit itself or one of its descendants (would create a cycle). */
export function wouldCycle(units: OrgUnit[], unitId: string, candidateParentId: string | null): boolean {
  if (!candidateParentId) return false
  return descendantIds(units, unitId).includes(candidateParentId)
}

/**
 * Twins: same role and the same skill tags (case-insensitive) — e.g. a duplicated developer. A free twin may take over a
 * task queued for a busy one (`settings.shareWithTwins`). `tests/team.test.ts`.
 */
export function isTwin(a: { id: string; role: string; skills: string[] }, b: { id: string; role: string; skills: string[] }): boolean {
  if (a.id === b.id) return false
  const norm = (s: string): string => s.trim().toLocaleLowerCase('en')
  if (!norm(a.role) || norm(a.role) !== norm(b.role)) return false
  const sa = [...new Set(a.skills.map(norm))].sort()
  const sb = [...new Set(b.skills.map(norm))].sort()
  return sa.length === sb.length && sa.every((x, i) => x === sb[i])
}
