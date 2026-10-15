/**
 * Sharing units, teams and agents with other Agentbits users: a `.agentbits` file (JSON) with the unit tree, agent
 * profiles, titles, suggested provider type + model, requested permissions and skill files. Never in it: API keys,
 * connection / app secrets or records, provider records, tasks, chat, memories, files, local paths. Importing is
 * previewed first and can't raise permissions (every imported agent starts with "ask for approval").
 * Pure: the validator runs on untrusted input and is covered by `tests/share.test.ts`.
 */
import type { PermissionsPatch, ProviderKind, UnitKind } from './types'

export const SHARE_FORMAT = 'agentbits-share'
export const SHARE_VERSION = 1
export const SHARE_EXT = 'agentbits'

export const SHARE_LIMITS = {
  maxBytes: 25 * 1024 * 1024,
  maxUnits: 100,
  maxAgents: 200,
  maxSkills: 50,
  maxSkillFiles: 300,
  maxSkillBytes: 10 * 1024 * 1024,
  maxText: 20_000
}

export interface SharePerms {
  fsRead: boolean
  fsWrite: boolean
  terminal: boolean
  network: boolean
  browser: boolean
}

export interface ShareAgent {
  ref: string
  name: string
  role: string
  persona: string
  jobDescription: string
  skills: string[]
  color: string
  hair: string
  skin: string
  /** Suggested provider type and model; the importer picks one of their own providers. */
  provider: { kind: ProviderKind; model: string } | null
  perms: SharePerms
  /** Names of connections / apps this agent used: the importer has to set up their own (shown as a note). */
  needs: string[]
}

export interface ShareUnit {
  ref: string
  parentRef: string | null
  name: string
  kind: UnitKind
  description: string
  color: string
  leadRef: string | null
  members: { agentRef: string; title: string }[]
}

export interface ShareSkill {
  name: string
  description: string
  /** path → base64 */
  files: Record<string, string>
  assign: { type: 'agent' | 'unit'; ref: string }[]
}

export interface SharePackage {
  format: typeof SHARE_FORMAT
  version: number
  exportedAt: string
  appVersion: string
  /** What was exported: a unit (with everything under it) or loose agents. */
  kind: 'unit' | 'agents'
  title: string
  units: ShareUnit[]
  agents: ShareAgent[]
  skills: ShareSkill[]
}

/** What the import screen shows; `stagingId` holds the validated package in main. */
export interface SharePreview {
  stagingId: string
  sourceLabel: string
  title: string
  kind: SharePackage['kind']
  exportedAt: string
  appVersion: string
  units: { ref: string; parentRef: string | null; name: string; kind: UnitKind; description: string; lead: string | null; members: { name: string; title: string }[] }[]
  agents: {
    ref: string
    name: string
    role: string
    persona: string
    jobDescription: string
    skills: string[]
    /** Lines in persona / job description that look like prompt injection (shown, not blocked). */
    suspicious: string[]
    provider: { kind: ProviderKind; model: string } | null
    /** Which of the importer's providers it will use ('' = the default provider). */
    providerLabel: string
    requested: SharePerms
    granted: PermissionsPatch
    needs: string[]
  }[]
  skills: { name: string; description: string; fileCount: number; size: number; hasScripts: boolean; suspicious: string[]; existing: boolean }[]
}

/* ───────────────────────────── validation ───────────────────────────── */

const KINDS: UnitKind[] = ['company', 'department', 'team', 'organization']
const PROVIDERS: ProviderKind[] = ['anthropic', 'openai', 'claude-cli', 'codex-cli', 'mock']
const COLOR = /^#[0-9a-f]{6}$/i

class ShareError extends Error {
  /** A newer app made it: the user should update rather than read a technical reason. */
  newer = false
}

const obj = (v: unknown, what: string): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new ShareError(`${what}: not an object`)
  return v as Record<string, unknown>
}
const arr = (v: unknown, what: string, max: number): unknown[] => {
  if (v === undefined) return []
  if (!Array.isArray(v)) throw new ShareError(`${what}: not a list`)
  if (v.length > max) throw new ShareError(`${what}: more than ${max}`)
  return v
}
// Control characters (except tab / newline) are dropped: they have no place in profile text.
// eslint-disable-next-line no-control-regex
const clean = (s: string): string => s.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
const str = (v: unknown, max: number, fallback = ''): string => (typeof v === 'string' ? clean(v).slice(0, max) : fallback)
const color = (v: unknown, fallback: string): string => (typeof v === 'string' && COLOR.test(v) ? v : fallback)
const ref = (v: unknown, what: string): string => {
  if (typeof v !== 'string' || !/^[\w-]{1,64}$/.test(v)) throw new ShareError(`${what}: bad ref`)
  return v
}
const bool = (v: unknown): boolean => v === true

/** Safe relative path inside a skill, or null. */
export function cleanSkillPath(p: string): string | null {
  const parts = p.replace(/\\/g, '/').split('/').filter((x) => x && x !== '.')
  if (!parts.length || parts.some((x) => x === '..' || /[\0:]/.test(x)) || /^[a-z]:/i.test(p)) return null
  return parts.join('/')
}

/** Parses and checks an untrusted package. Throws a short English reason (the caller translates the frame). */
export function parseSharePackage(text: string): SharePackage {
  if (text.length > SHARE_LIMITS.maxBytes * 1.4) throw new ShareError('file too large')
  let raw: unknown
  try {
    raw = JSON.parse(text.replace(/^﻿/, ''))
  } catch {
    throw new ShareError('not JSON')
  }
  const o = obj(raw, 'package')
  if (o.format !== SHARE_FORMAT) throw new ShareError('not an Agentbits package')
  if (typeof o.version !== 'number' || o.version > SHARE_VERSION) throw Object.assign(new ShareError('made by a newer Agentbits; update the app'), { newer: true })

  const agents: ShareAgent[] = arr(o.agents, 'agents', SHARE_LIMITS.maxAgents).map((x, i) => {
    const a = obj(x, `agent ${i + 1}`)
    const p = a.perms && typeof a.perms === 'object' ? (a.perms as Record<string, unknown>) : {}
    const prov = a.provider && typeof a.provider === 'object' ? (a.provider as Record<string, unknown>) : null
    const name = str(a.name, 80).trim()
    if (!name) throw new ShareError(`agent ${i + 1}: no name`)
    return {
      ref: ref(a.ref, `agent ${i + 1}`),
      name,
      role: str(a.role, 120),
      persona: str(a.persona, SHARE_LIMITS.maxText),
      jobDescription: str(a.jobDescription, SHARE_LIMITS.maxText),
      skills: arr(a.skills, 'agent skills', 50).map((s) => str(s, 60).trim()).filter(Boolean),
      color: color(a.color, '#6366f1'),
      hair: color(a.hair, '#1f1b2e'),
      skin: color(a.skin, '#f1c27d'),
      provider: prov && PROVIDERS.includes(prov.kind as ProviderKind) ? { kind: prov.kind as ProviderKind, model: str(prov.model, 120).trim() } : null,
      perms: { fsRead: bool(p.fsRead), fsWrite: bool(p.fsWrite), terminal: bool(p.terminal), network: bool(p.network), browser: bool(p.browser) },
      needs: arr(a.needs, 'agent needs', 50).map((s) => str(s, 120).trim()).filter(Boolean)
    }
  })
  const agentRefs = new Set(agents.map((a) => a.ref))
  if (agentRefs.size !== agents.length) throw new ShareError('duplicate agent refs')

  const units: ShareUnit[] = arr(o.units, 'units', SHARE_LIMITS.maxUnits).map((x, i) => {
    const u = obj(x, `unit ${i + 1}`)
    const name = str(u.name, 80).trim()
    if (!name) throw new ShareError(`unit ${i + 1}: no name`)
    const members = arr(u.members, 'unit members', SHARE_LIMITS.maxAgents).map((m) => {
      const mm = obj(m, 'member')
      const r = ref(mm.agentRef, 'member')
      if (!agentRefs.has(r)) throw new ShareError(`unit ${name}: unknown member`)
      return { agentRef: r, title: str(mm.title, 80) }
    })
    const lead = u.leadRef == null ? null : ref(u.leadRef, 'unit lead')
    return {
      ref: ref(u.ref, `unit ${i + 1}`),
      parentRef: u.parentRef == null ? null : ref(u.parentRef, 'unit parent'),
      name,
      kind: KINDS.includes(u.kind as UnitKind) ? (u.kind as UnitKind) : 'team',
      description: str(u.description, 4000),
      color: color(u.color, '#6366f1'),
      leadRef: lead && members.some((m) => m.agentRef === lead) ? lead : null,
      members
    }
  })
  const unitRefs = new Set(units.map((u) => u.ref))
  if (unitRefs.size !== units.length) throw new ShareError('duplicate unit refs')
  // Exactly one top unit (or none for loose agents) and every parent known, no cycles.
  const roots = units.filter((u) => u.parentRef === null)
  if (units.length && roots.length !== 1) throw new ShareError('the units need exactly one top unit')
  for (const u of units) {
    if (u.parentRef !== null && !unitRefs.has(u.parentRef)) throw new ShareError(`unit ${u.name}: unknown parent`)
    const seen = new Set<string>()
    for (let cur: ShareUnit | undefined = u; cur?.parentRef; cur = units.find((x) => x.ref === cur!.parentRef)) {
      if (seen.has(cur.ref)) throw new ShareError('units form a cycle')
      seen.add(cur.ref)
    }
  }

  const skills: ShareSkill[] = arr(o.skills, 'skills', SHARE_LIMITS.maxSkills).map((x, i) => {
    const s = obj(x, `skill ${i + 1}`)
    const name = str(s.name, 64).trim()
    if (!name || !/^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u.test(name)) throw new ShareError(`skill ${i + 1}: bad name`)
    const f = obj(s.files ?? {}, `skill ${name} files`)
    const entries = Object.entries(f)
    if (entries.length > SHARE_LIMITS.maxSkillFiles) throw new ShareError(`skill ${name}: too many files`)
    const files: Record<string, string> = {}
    let size = 0
    for (const [p, b64] of entries) {
      const path = cleanSkillPath(p)
      if (!path || typeof b64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) throw new ShareError(`skill ${name}: bad file ${p.slice(0, 80)}`)
      size += Math.floor((b64.length * 3) / 4)
      files[path] = b64
    }
    if (size > SHARE_LIMITS.maxSkillBytes) throw new ShareError(`skill ${name}: too large`)
    if (!Object.keys(files).some((p) => p.toLowerCase() === 'skill.md')) throw new ShareError(`skill ${name}: no SKILL.md`)
    const assign = arr(s.assign, 'skill assignments', 500).map((y) => {
      const a = obj(y, 'assignment')
      const type = a.type === 'unit' ? 'unit' : 'agent'
      const r = ref(a.ref, 'assignment')
      if (!(type === 'unit' ? unitRefs : agentRefs).has(r)) throw new ShareError(`skill ${name}: unknown assignment`)
      return { type, ref: r } as const
    })
    return { name, description: str(s.description, 1024), files, assign }
  })
  if (new Set(skills.map((s) => s.name.toLowerCase())).size !== skills.length) throw new ShareError('duplicate skill names')
  if (!agents.length && !units.length) throw new ShareError('the package is empty')

  return {
    format: SHARE_FORMAT,
    version: o.version,
    exportedAt: str(o.exportedAt, 40),
    appVersion: str(o.appVersion, 40),
    kind: o.kind === 'unit' && units.length ? 'unit' : 'agents',
    title: str(o.title, 120).trim() || units[0]?.name || agents[0].name,
    units,
    agents,
    skills
  }
}

/**
 * What an imported agent gets: at most what the package asks for, always "ask for approval" and no extra folders —
 * a package can never hand out more than the sender had, nor skip the importer's approval.
 */
export function grantedPermissions(requested: SharePerms): PermissionsPatch {
  return { ...requested, requireApproval: true, allowedPaths: [] }
}

export { ShareError }
