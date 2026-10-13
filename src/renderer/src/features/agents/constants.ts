import { Eye, FilePen, Globe, Hand, Network, SquareTerminal } from 'lucide-react'
import type { ComponentType } from 'react'
import type { Agent, AgentPermissions, PermissionsPatch } from '@shared/types'
import { locale, t } from '@/i18n'

/** Appearance palettes shared by the agent editor and the new-agent modal. */
export const SHIRTS = ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#06b6d4', '#ef4444', '#8b5cf6', '#84cc16', '#f97316', '#64748b']
export const HAIRS = ['#1f1b2e', '#111827', '#44403c', '#7c2d12', '#b45309', '#fbbf24', '#e5e7eb', '#be185d', '#1d4ed8']
export const SKINS = ['#ffdbac', '#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#5c3a1e']

/** Number of worker desks in the office map (see features/office/map.ts WORKER_DESKS). */
export const WORKER_DESK_COUNT = 10

export type PermKey = keyof Omit<AgentPermissions, 'agentId' | 'updatedAt' | 'allowedPaths'>

/**
 * The six toggles of the permission matrix, in display order. label / hint / desc are getters so they always read the
 * current language (`PERMISSIONS[i].label`); tool-name hints stay untranslated.
 */
export const PERMISSIONS: {
  key: PermKey
  readonly label: string
  readonly hint: string // short, for the matrix header
  readonly desc: string // one-liner, for the agent profile
  icon: ComponentType<{ size?: number; className?: string }>
}[] = [
  { key: 'fsRead', get label() { return t('agents:perms.fsRead.label') }, hint: 'Read, Glob, Grep', get desc() { return t('agents:perms.fsRead.desc') }, icon: Eye },
  { key: 'fsWrite', get label() { return t('agents:perms.fsWrite.label') }, hint: 'Edit, Write', get desc() { return t('agents:perms.fsWrite.desc') }, icon: FilePen },
  { key: 'terminal', get label() { return t('agents:perms.terminal.label') }, hint: 'Bash / shell', get desc() { return t('agents:perms.terminal.desc') }, icon: SquareTerminal },
  { key: 'network', get label() { return t('agents:perms.network.label') }, hint: 'WebFetch, WebSearch', get desc() { return t('agents:perms.network.desc') }, icon: Network },
  { key: 'browser', get label() { return t('agents:perms.browser.label') }, get hint() { return t('agents:perms.browser.hint') }, get desc() { return t('agents:perms.browser.desc') }, icon: Globe },
  { key: 'requireApproval', get label() { return t('agents:perms.requireApproval.label') }, get hint() { return t('agents:perms.requireApproval.hint') }, get desc() { return t('agents:perms.requireApproval.desc') }, icon: Hand }
]

export type PermTemplateId = 'readonly' | 'developer' | 'full'

export const PERM_TEMPLATES: { id: PermTemplateId; readonly label: string; readonly desc: string; perms: Required<Omit<PermissionsPatch, 'allowedPaths'>> }[] = [
  {
    id: 'readonly',
    get label() { return t('agents:permTemplates.readonly.label') },
    get desc() { return t('agents:permTemplates.readonly.desc') },
    perms: { fsRead: true, fsWrite: false, terminal: false, network: false, browser: false, requireApproval: true }
  },
  {
    id: 'developer',
    get label() { return t('agents:permTemplates.developer.label') },
    get desc() { return t('agents:permTemplates.developer.desc') },
    perms: { fsRead: true, fsWrite: true, terminal: false, network: false, browser: false, requireApproval: true }
  },
  {
    id: 'full',
    get label() { return t('agents:permTemplates.full.label') },
    get desc() { return t('agents:permTemplates.full.desc') },
    perms: { fsRead: true, fsWrite: true, terminal: true, network: true, browser: true, requireApproval: true }
  }
]

const pickOne = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]

/** Random but pleasant look; prefers a shirt colour nobody on the team wears yet. */
export function randomLook(team: Pick<Agent, 'color'>[]): Pick<Agent, 'color' | 'hair' | 'skin'> {
  const used = new Set(team.map((a) => a.color))
  const free = SHIRTS.filter((c) => !used.has(c))
  return { color: pickOne(free.length ? free : SHIRTS), hair: pickOne(HAIRS), skin: pickOne(SKINS) }
}

/** Splits free text ("React, CSS") into trimmed, de-duplicated tags appended to `current`. */
export function addTags(current: string[], raw: string): string[] {
  const seen = new Set(current.map((tag) => tag.toLocaleLowerCase(locale())))
  const out = [...current]
  for (const part of raw.split(',')) {
    const tag = part.trim().slice(0, 40)
    if (!tag || seen.has(tag.toLocaleLowerCase(locale()))) continue
    seen.add(tag.toLocaleLowerCase(locale()))
    out.push(tag)
  }
  return out
}
