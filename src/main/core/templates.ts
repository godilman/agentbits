import type { PermissionsPatch, TeamTemplate, TemplateNodePreview, UnitKind } from '@shared/types'
import { getDb } from '../db'
import { agentsRepo, unitsRepo } from '../db/repos'
import type { I18nKey } from '@shared/i18n'
import { t } from '../i18n'

/**
 * Built-in ready-made teams. Instantiating one creates the units (with unlimited
 * nesting, e.g. a whole e-commerce company) and brand-new agents with role, job
 * description, skills and a permission preset. Every unit the user creates is
 * itself reusable: assign it to as many projects as needed.
 */

type Preset = 'readonly' | 'developer' | 'full'

/**
 * Texts (names, descriptions, roles, job descriptions, skills, personas) live in the `templates` namespace and are
 * read at call time, so they follow the current language. Agent person names are names and are not translated.
 */
interface AgentDef {
  /** Key under the unit's `agents` (`templates:<unit>.agents.<id>`). */
  id: string
  name: string
  preset: Preset
  lead?: boolean
  /** Has a fixed persona text (`….persona`); otherwise none. */
  persona?: boolean
  /** Optional fixed look / permissions (otherwise derived from the position and the preset). */
  look?: { color: string; hair: string; skin: string }
  perms?: PermissionsPatch
}

interface UnitDef {
  /** Key under the template (`templates:<template>.units.<id>`); empty for the root unit. */
  id?: string
  kind: UnitKind
  color: string
  agents: AgentDef[]
  children?: UnitDef[]
}

interface TemplateDef {
  id: string
  root: UnitDef
}

const PRESETS: Record<Preset, PermissionsPatch> = {
  readonly: { fsRead: true, fsWrite: false, terminal: false, network: false, browser: false, requireApproval: true },
  developer: { fsRead: true, fsWrite: true, terminal: false, network: false, browser: false, requireApproval: true },
  full: { fsRead: true, fsWrite: true, terminal: true, network: true, browser: true, requireApproval: true }
}

const SHIRTS = ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#06b6d4', '#ef4444', '#8b5cf6', '#84cc16', '#f97316', '#64748b']
const HAIRS = ['#1f1b2e', '#111827', '#44403c', '#7c2d12', '#b45309', '#fbbf24', '#e5e7eb', '#be185d', '#1d4ed8']
const SKINS = ['#ffdbac', '#f1c27d', '#e0ac69', '#c68642', '#8d5524']

const TEMPLATES: TemplateDef[] = [
  {
    // The team that used to be created on first run; now optional (the user builds the organization).
    id: 'core',
    root: {
      kind: 'team',
      color: '#6366f1',
      agents: [
        {
          id: 'atlas',
          name: 'Atlas',
          lead: true,
          preset: 'readonly',
          persona: true,
          look: { color: '#6366f1', hair: '#1f1b2e', skin: '#e0ac69' },
          perms: { fsRead: true, fsWrite: false, terminal: false, network: true, browser: true, requireApproval: false }
        },
        { id: 'nehir', name: 'Nehir', preset: 'developer', persona: true, look: { color: '#10b981', hair: '#7c2d12', skin: '#f1c27d' } },
        { id: 'zeki', name: 'Zeki', preset: 'developer', persona: true, look: { color: '#f59e0b', hair: '#111827', skin: '#c68642' } },
        { id: 'zeynep', name: 'Zeynep', preset: 'readonly', persona: true, look: { color: '#ec4899', hair: '#fbbf24', skin: '#ffdbac' } },
        { id: 'kaan', name: 'Kaan', preset: 'full', persona: true, look: { color: '#06b6d4', hair: '#44403c', skin: '#8d5524' } }
      ]
    }
  },
  {
    id: 'software',
    root: {
      kind: 'team',
      color: '#6366f1',
      agents: [
        { id: 'selin', name: 'Selin', lead: true, preset: 'readonly' },
        { id: 'emre', name: 'Emre', preset: 'developer' },
        { id: 'burak', name: 'Burak', preset: 'developer' },
        { id: 'ceren', name: 'Ceren', preset: 'readonly' },
        { id: 'onur', name: 'Onur', preset: 'full' }
      ]
    }
  },
  {
    id: 'research',
    root: {
      kind: 'team',
      color: '#06b6d4',
      agents: [
        { id: 'deniz', name: 'Deniz', lead: true, preset: 'readonly' },
        { id: 'ece', name: 'Ece', preset: 'readonly' },
        { id: 'mert', name: 'Mert', preset: 'developer' },
        { id: 'ipek', name: 'İpek', preset: 'readonly' } // i18n-ignore (person name)
      ]
    }
  },
  {
    id: 'product',
    root: {
      kind: 'team',
      color: '#8b5cf6',
      agents: [
        { id: 'asli', name: 'Aslı', lead: true, preset: 'readonly' }, // i18n-ignore (person name)
        { id: 'bora', name: 'Bora', preset: 'readonly' },
        { id: 'gizem', name: 'Gizem', preset: 'developer' },
        { id: 'kerem', name: 'Kerem', preset: 'developer' }
      ]
    }
  },
  {
    id: 'marketing',
    root: {
      kind: 'team',
      color: '#ec4899',
      agents: [
        { id: 'melis', name: 'Melis', lead: true, preset: 'readonly' },
        { id: 'can', name: 'Can', preset: 'developer' },
        { id: 'elif', name: 'Elif', preset: 'readonly' },
        { id: 'tolga', name: 'Tolga', preset: 'readonly' }
      ]
    }
  },
  {
    id: 'ecommerce',
    root: {
      kind: 'company',
      color: '#f59e0b',
      agents: [{ id: 'kaya', name: 'Kaya', lead: true, preset: 'readonly' }],
      children: [
        {
          id: 'catalog',
          kind: 'team',
          color: '#84cc16',
          agents: [
            { id: 'nazli', name: 'Nazlı', lead: true, preset: 'readonly' }, // i18n-ignore (person name)
            { id: 'arda', name: 'Arda', preset: 'developer' }
          ]
        },
        {
          id: 'marketing',
          kind: 'team',
          color: '#ec4899',
          agents: [
            { id: 'sena', name: 'Sena', lead: true, preset: 'readonly' },
            { id: 'ozan', name: 'Ozan', preset: 'developer' }
          ]
        },
        {
          id: 'support',
          kind: 'team',
          color: '#06b6d4',
          agents: [
            { id: 'pelin', name: 'Pelin', lead: true, preset: 'readonly' },
            { id: 'umut', name: 'Umut', preset: 'readonly' }
          ]
        },
        {
          id: 'operations',
          kind: 'team',
          color: '#64748b',
          agents: [{ id: 'volkan', name: 'Volkan', lead: true, preset: 'readonly' }]
        },
        {
          id: 'technology',
          kind: 'team',
          color: '#6366f1',
          agents: [
            { id: 'baris', name: 'Barış', lead: true, preset: 'readonly' }, // i18n-ignore (person name)
            { id: 'ezgi', name: 'Ezgi', preset: 'developer' }
          ]
        }
      ]
    }
  }
]

/* ── texts (current language, read at call time) ── */

const tk = (key: string): string => t(`templates:${key}` as I18nKey)

/** Key prefix of a unit: the template itself for the root, `<template>.units.<id>` for a child. */
const unitKey = (tplId: string, u: UnitDef): string => (u.id ? `${tplId}.units.${u.id}` : tplId)

const unitName = (tplId: string, u: UnitDef): string => tk(`${unitKey(tplId, u)}.name`)

const unitDescription = (tplId: string, u: UnitDef): string =>
  tk(`${unitKey(tplId, u)}.${u.id ? 'description' : 'unitDescription'}`)

function agentTexts(tplId: string, u: UnitDef, a: AgentDef): { role: string; jobDescription: string; skills: string[]; persona: string } {
  const k = `${unitKey(tplId, u)}.agents.${a.id}`
  return {
    role: tk(`${k}.role`),
    jobDescription: tk(`${k}.jobDescription`),
    skills: tk(`${k}.skills`)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    persona: a.persona ? tk(`${k}.persona`) : ''
  }
}

function preview(tplId: string, u: UnitDef): TemplateNodePreview {
  return {
    name: unitName(tplId, u),
    kind: u.kind,
    agents: u.agents.map((a) => ({ name: a.name, role: agentTexts(tplId, u, a).role, lead: !!a.lead })),
    children: (u.children ?? []).map((c) => preview(tplId, c))
  }
}

function count(u: UnitDef): { units: number; agents: number } {
  return (u.children ?? []).reduce(
    (acc, c) => {
      const n = count(c)
      return { units: acc.units + n.units, agents: acc.agents + n.agents }
    },
    { units: 1, agents: u.agents.length }
  )
}

export function listTemplates(): TeamTemplate[] {
  return TEMPLATES.map((tpl) => {
    const n = count(tpl.root)
    return {
      id: tpl.id,
      name: tk(`${tpl.id}.name`),
      description: tk(`${tpl.id}.description`),
      kind: tpl.root.kind,
      color: tpl.root.color,
      agentCount: n.agents,
      unitCount: n.units,
      tree: preview(tpl.id, tpl.root)
    }
  })
}

/** Name not used by any agent yet ("Emre", then "Emre 2", …). */
function uniqueName(base: string): string {
  const taken = new Set(agentsRepo.list().map((a) => a.name.toLocaleLowerCase('tr')))
  if (!taken.has(base.toLocaleLowerCase('tr'))) return base
  for (let i = 2; ; i++) {
    const n = `${base} ${i}`
    if (!taken.has(n.toLocaleLowerCase('tr'))) return n
  }
}

export function instantiateTemplate(
  templateId: string,
  opts: { parentId?: string | null; name?: string } = {}
): { unitId: string; agentIds: string[] } {
  const tpl = TEMPLATES.find((x) => x.id === templateId)
  if (!tpl) throw new Error(t('templates:errors.notFound', { id: templateId }))
  const agentIds: string[] = []
  let k = agentsRepo.list().length

  const build = (u: UnitDef, parentId: string | null, nameOverride?: string): string => {
    const unit = unitsRepo.save(
      {
        name: nameOverride?.trim() || unitName(tpl.id, u),
        kind: u.kind,
        description: unitDescription(tpl.id, u),
        color: u.color,
        parentId
      },
      undefined
    )
    let leadId: string | null = null
    for (const a of u.agents) {
      k++
      const txt = agentTexts(tpl.id, u, a)
      const agent = agentsRepo.save(
        {
          name: uniqueName(a.name),
          role: txt.role,
          jobDescription: txt.jobDescription,
          skills: txt.skills,
          persona: txt.persona,
          color: a.look?.color ?? SHIRTS[k % SHIRTS.length],
          hair: a.look?.hair ?? HAIRS[(k * 3) % HAIRS.length],
          skin: a.look?.skin ?? SKINS[(k * 7) % SKINS.length]
        },
        undefined,
        { ...PRESETS[a.preset], ...a.perms }
      )
      agentIds.push(agent.id)
      unitsRepo.addMember(unit.id, agent.id, a.lead ? t('templates:memberTitle.lead') : '')
      if (a.lead) leadId = agent.id
    }
    if (leadId) unitsRepo.save({ leadAgentId: leadId }, unit.id)
    for (const c of u.children ?? []) build(c, unit.id)
    return unit.id
  }

  let rootUnitId = ''
  getDb().transaction(() => {
    const parentId = opts.parentId === undefined ? unitsRepo.root()?.id ?? null : opts.parentId
    rootUnitId = build(tpl.root, parentId, opts.name)
  })()
  return { unitId: rootUnitId, agentIds }
}
