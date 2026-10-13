import { Building2, Layers, Network, Users } from 'lucide-react'
import type { ComponentType, CSSProperties } from 'react'
import type { OrgUnit, Project, UnitKind } from '@shared/types'
import { unitPath } from '@shared/org'
import { t } from '@/i18n'

// Labels are getters so they always read the current language (`KIND_META[kind].label`).
export const KIND_META: Record<UnitKind, { readonly label: string; icon: ComponentType<{ size?: number; className?: string; style?: CSSProperties }> }> = {
  organization: { get label() { return t('org:kinds.organization') }, icon: Network },
  company: { get label() { return t('org:kinds.company') }, icon: Building2 },
  department: { get label() { return t('org:kinds.department') }, icon: Layers },
  team: { get label() { return t('org:kinds.team') }, icon: Users }
}

/** Kinds a user can pick for a non-root unit. */
export const CHILD_KINDS: UnitKind[] = ['company', 'department', 'team']

export const UNIT_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#06b6d4', '#ef4444', '#8b5cf6', '#84cc16', '#f97316', '#64748b']

/** parentId → children, ordered like the repo returns them (sort_order, created_at). */
export function childrenMap(units: OrgUnit[]): Map<string, OrgUnit[]> {
  const m = new Map<string, OrgUnit[]>()
  for (const u of units) {
    if (!u.parentId) continue
    const list = m.get(u.parentId) ?? []
    list.push(u)
    m.set(u.parentId, list)
  }
  return m
}

export function rootUnit(units: OrgUnit[]): OrgUnit | undefined {
  return units.find((u) => !u.parentId && u.kind === 'organization') ?? units.find((u) => !u.parentId)
}

/** Depth-first flattening (root first) for indented selects and trees. */
export function flattenTree(units: OrgUnit[]): { unit: OrgUnit; depth: number }[] {
  const kids = childrenMap(units)
  const out: { unit: OrgUnit; depth: number }[] = []
  const seen = new Set<string>()
  const walk = (u: OrgUnit, depth: number): void => {
    if (seen.has(u.id)) return
    seen.add(u.id)
    out.push({ unit: u, depth })
    for (const c of kids.get(u.id) ?? []) walk(c, depth + 1)
  }
  for (const r of units.filter((u) => !u.parentId)) walk(r, 0)
  return out
}

/** Label for an indented <option>. */
export const indentLabel = (name: string, depth: number): string => `${'   '.repeat(depth)}${name}`

/**
 * Projects that use this unit, either directly or because an ancestor unit is assigned.
 * `direct` is true when the unit itself is in the project's unitIds.
 */
export function projectsForUnit(projects: Project[], units: OrgUnit[], unitId: string): { project: Project; direct: boolean }[] {
  const path = new Set(unitPath(units, unitId).map((u) => u.id))
  const out: { project: Project; direct: boolean }[] = []
  for (const p of projects) {
    if (p.unitIds.includes(unitId)) out.push({ project: p, direct: true })
    else if (p.unitIds.some((id) => path.has(id))) out.push({ project: p, direct: false })
  }
  return out
}

/** Next sensible default name for a new unit of the given kind. */
export function nextUnitName(units: OrgUnit[], kind: UnitKind): string {
  const base = t(`org:newUnitName.${kind}`)
  const names = new Set(units.map((u) => u.name))
  if (!names.has(base)) return base
  for (let i = 2; ; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`
}
