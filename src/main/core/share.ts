import { randomUUID } from 'crypto'
import { readFileSync, statSync } from 'fs'
import { basename } from 'path'
import {
  SHARE_FORMAT,
  SHARE_LIMITS,
  SHARE_VERSION,
  ShareError,
  grantedPermissions,
  parseSharePackage,
  type ShareAgent,
  type SharePackage,
  type SharePreview,
  type ShareSkill,
  type ShareUnit
} from '@shared/share'
import { BINARY_EXT, SCRIPT_EXT, parseGithubUrl, slugifySkillName } from '@shared/skills'
import type { Agent, OrgUnit } from '@shared/types'
import { appsRepo } from '../apps/repo'
import { connPermsRepo, connectionsRepo } from '../connections/repo'
import { getDb } from '../db'
import { agentsRepo, permissionsRepo, providersRepo, unitsRepo } from '../db/repos'
import { decodeText, findSuspicious } from '../files/extract'
import { t } from '../i18n'
import { skillsRepo } from '../skills/repo'
import { skillsForAgent } from '../skills/service'
import { githubFetch } from '../skills/source'
import { uniqueName } from './templates'

/** Export / import of units, teams and agents (`shared/share.ts` has the format and the validator). */

/* ───────────────────────────── export ───────────────────────────── */

export function buildPackage(target: { type: 'unit' | 'agent'; id: string }, appVersion: string): SharePackage {
  const all = unitsRepo.list()
  let units: OrgUnit[] = []
  let agents: Agent[]
  if (target.type === 'unit') {
    const top = all.find((u) => u.id === target.id)
    if (!top) throw new Error(t('main:share.errors.unitNotFound'))
    units = [top]
    for (let i = 0; i < units.length; i++) units.push(...all.filter((u) => u.parentId === units[i].id))
    const ids = new Set(units.flatMap((u) => u.members.map((m) => m.agentId)))
    agents = agentsRepo.list().filter((a) => ids.has(a.id))
  } else {
    const a = agentsRepo.get(target.id)
    if (!a) throw new Error(t('orchestrator:errors.agentNotFound'))
    agents = [a]
  }
  const aRef = new Map(agents.map((a, i) => [a.id, `a${i + 1}`]))
  const uRef = new Map(units.map((u, i) => [u.id, `u${i + 1}`]))

  const shareUnits: ShareUnit[] = units.map((u, i) => ({
    ref: uRef.get(u.id)!,
    parentRef: i === 0 ? null : uRef.get(u.parentId!) ?? null,
    name: u.name,
    kind: u.kind,
    description: u.description,
    color: u.color,
    leadRef: u.leadAgentId ? aRef.get(u.leadAgentId) ?? null : null,
    members: u.members.filter((m) => aRef.has(m.agentId)).map((m) => ({ agentRef: aRef.get(m.agentId)!, title: m.title }))
  }))

  const shareAgents: ShareAgent[] = agents.map((a) => {
    const prov = a.providerId ? providersRepo.get(a.providerId) : null
    const p = permissionsRepo.get(a.id)
    const needs = [
      ...connPermsRepo.forAgent(a.id).map((c) => connectionsRepo.get(c.connectionId)?.name),
      ...appsRepo.forAgent(a.id).map((s) => s.name)
    ].filter((x): x is string => !!x)
    return {
      ref: aRef.get(a.id)!,
      name: a.name,
      role: a.role,
      persona: a.persona,
      jobDescription: a.jobDescription,
      skills: a.skills,
      color: a.color,
      hair: a.hair,
      skin: a.skin,
      // Type and model only: provider records, keys and endpoints stay here.
      provider: prov ? { kind: prov.kind, model: a.model || prov.model } : null,
      perms: { fsRead: p.fsRead, fsWrite: p.fsWrite, terminal: p.terminal, network: p.network, browser: p.browser },
      needs
    }
  })

  // Skills each agent has; assigned to a unit of the package when it came from one, otherwise to the agent.
  const skills = new Map<string, ShareSkill>()
  for (const a of agents) {
    for (const { skill, via } of skillsForAgent(a.id)) {
      let s = skills.get(skill.id)
      if (!s) {
        const files: Record<string, string> = {}
        for (const [path, data] of skillsRepo.allFiles(skill.id)) if (!BINARY_EXT.test(path)) files[path] = data.toString('base64')
        s = { name: skill.name, description: skill.description, files, assign: [] }
        skills.set(skill.id, s)
      }
      for (const v of via) {
        const to = v.type === 'unit' && uRef.has(v.id) ? { type: 'unit' as const, ref: uRef.get(v.id)! } : { type: 'agent' as const, ref: aRef.get(a.id)! }
        if (!s.assign.some((x) => x.type === to.type && x.ref === to.ref)) s.assign.push(to)
      }
    }
  }

  return {
    format: SHARE_FORMAT,
    version: SHARE_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion,
    kind: target.type === 'unit' ? 'unit' : 'agents',
    title: target.type === 'unit' ? units[0].name : agents[0].name,
    units: shareUnits,
    agents: shareAgents,
    skills: [...skills.values()]
  }
}

/* ───────────────────────────── preview ───────────────────────────── */

const staged = new Map<string, SharePackage>()

async function readSource(source: { type: 'file'; path: string } | { type: 'url'; url: string }): Promise<{ text: string; label: string }> {
  if (source.type === 'file') {
    if (statSync(source.path).size > SHARE_LIMITS.maxBytes) throw new Error(t('main:share.errors.tooLarge'))
    return { text: readFileSync(source.path, 'utf8'), label: basename(source.path) }
  }
  // GitHub only (public, or private with the stored GitHub token), like skills.
  const g = parseGithubUrl(source.url)
  if (!g || !g.path) throw new Error(t('main:share.errors.badUrl'))
  const ref = g.ref ?? 'HEAD'
  const bytes = await githubFetch(
    `https://raw.githubusercontent.com/${g.owner}/${g.repo}/${ref}/${g.path}`,
    `/repos/${encodeURIComponent(g.owner)}/${encodeURIComponent(g.repo)}/contents/${g.path.split('/').map(encodeURIComponent).join('/')}${g.ref ? `?ref=${encodeURIComponent(g.ref)}` : ''}`,
    'application/vnd.github.raw+json',
    SHARE_LIMITS.maxBytes
  ).catch((e: Error) => {
    // The skills screen's wording points at a token field that isn't here.
    throw e.message === t('main:skills.errors.notFoundPrivate') ? new Error(t('main:share.errors.notFound')) : e
  })
  return { text: decodeText(bytes).text, label: `${g.owner}/${g.repo}/${g.path}` }
}

/** Which of the user's providers an imported agent will use: same type (the default one first), else the default. */
function matchProvider(p: ShareAgent['provider']): { providerId: string | null; model: string | null; label: string } {
  const list = providersRepo.list()
  const hit = p ? (list.find((x) => x.kind === p.kind && x.isDefault) ?? list.find((x) => x.kind === p.kind)) : null
  if (hit) return { providerId: hit.id, model: p!.model || null, label: `${hit.label}${p!.model ? ` · ${p!.model}` : ''}` }
  return { providerId: null, model: null, label: '' }
}

export async function previewPackage(source: { type: 'file'; path: string } | { type: 'url'; url: string }): Promise<SharePreview> {
  const { text, label } = await readSource(source)
  let pkg: SharePackage
  try {
    pkg = parseSharePackage(text)
  } catch (e) {
    if (e instanceof ShareError) throw new Error(e.newer ? t('main:share.errors.newer') : t('main:share.errors.invalid', { reason: e.message }))
    throw e
  }
  const stagingId = randomUUID()
  staged.set(stagingId, pkg)
  while (staged.size > 5) staged.delete(staged.keys().next().value!)
  const name = new Map(pkg.agents.map((a) => [a.ref, a.name]))
  return {
    stagingId,
    sourceLabel: label,
    title: pkg.title,
    kind: pkg.kind,
    exportedAt: pkg.exportedAt,
    appVersion: pkg.appVersion,
    units: pkg.units.map((u) => ({
      ref: u.ref,
      parentRef: u.parentRef,
      name: u.name,
      kind: u.kind,
      description: u.description,
      lead: u.leadRef ? (name.get(u.leadRef) ?? null) : null,
      members: u.members.map((m) => ({ name: name.get(m.agentRef) ?? '?', title: m.title }))
    })),
    agents: pkg.agents.map((a) => ({
      ref: a.ref,
      name: a.name,
      role: a.role,
      persona: a.persona,
      jobDescription: a.jobDescription,
      skills: a.skills,
      suspicious: findSuspicious(`${a.persona}\n${a.jobDescription}`, 5),
      provider: a.provider,
      providerLabel: matchProvider(a.provider).label,
      requested: a.perms,
      granted: grantedPermissions(a.perms),
      needs: a.needs
    })),
    skills: pkg.skills.map((s) => {
      const files = Object.entries(s.files)
      const md = files.filter(([p]) => /\.md$/i.test(p)).map(([, b]) => decodeText(Buffer.from(b, 'base64')).text)
      return {
        name: slugifySkillName(s.name),
        description: s.description,
        fileCount: files.length,
        size: files.reduce((n, [, b]) => n + Buffer.from(b, 'base64').length, 0),
        hasScripts: files.some(([p]) => SCRIPT_EXT.test(p)),
        suspicious: findSuspicious(md.join('\n'), 5),
        existing: !!skillsRepo.byName(slugifySkillName(s.name))
      }
    })
  }
}

/* ───────────────────────────── import ───────────────────────────── */

/**
 * Creates the package's units (under `parentId`, default the organization), agents (new names when taken, never the
 * lead, "ask for approval" on) and skills (a skill with the same name already installed is reused, not overwritten).
 * One transaction.
 */
export function importPackage(stagingId: string, parentId: string | null): { unitId: string | null; agentIds: string[]; reusedSkills: string[] } {
  const pkg = staged.get(stagingId)
  if (!pkg) throw new Error(t('main:share.errors.expired'))
  const parent = parentId ? unitsRepo.get(parentId) : unitsRepo.root()
  if (parentId && !parent) throw new Error(t('main:share.errors.unitNotFound'))
  const aId = new Map<string, string>()
  const uId = new Map<string, string>()
  const reusedSkills: string[] = []
  getDb().transaction(() => {
    for (const a of pkg.agents) {
      const prov = matchProvider(a.provider)
      const agent = agentsRepo.save(
        {
          name: uniqueName(a.name),
          role: a.role,
          persona: a.persona,
          jobDescription: a.jobDescription,
          skills: a.skills,
          color: a.color,
          hair: a.hair,
          skin: a.skin,
          providerId: prov.providerId,
          model: prov.model
        },
        undefined,
        grantedPermissions(a.perms)
      )
      aId.set(a.ref, agent.id)
    }
    // Parents come first: the validator guarantees one top unit and no cycles.
    const pending = [...pkg.units]
    while (pending.length) {
      const i = pending.findIndex((u) => u.parentRef === null || uId.has(u.parentRef))
      const u = pending.splice(i, 1)[0]
      const unit = unitsRepo.save(
        {
          name: u.name,
          kind: u.kind === 'organization' ? 'company' : u.kind,
          description: u.description,
          color: u.color,
          parentId: u.parentRef ? uId.get(u.parentRef)! : (parent?.id ?? null)
        },
        undefined
      )
      uId.set(u.ref, unit.id)
      for (const m of u.members) unitsRepo.addMember(unit.id, aId.get(m.agentRef)!, m.title)
      if (u.leadRef) unitsRepo.save({ leadAgentId: aId.get(u.leadRef)! }, unit.id)
    }
    // Loose agents go into the chosen unit.
    if (!pkg.units.length && parentId && parent) for (const id of aId.values()) unitsRepo.addMember(parent.id, id, '')
    for (const s of pkg.skills) {
      const name = slugifySkillName(s.name)
      let skill = skillsRepo.byName(name)
      if (skill) reusedSkills.push(name)
      else {
        // Executables are never taken from a package (export leaves them out too).
        const files = new Map(
          Object.entries(s.files)
            .filter(([p]) => !BINARY_EXT.test(p))
            .map(([p, b]) => [p.toLowerCase() === 'skill.md' ? 'SKILL.md' : p, new Uint8Array(Buffer.from(b, 'base64'))])
        )
        skill = skillsRepo.write({
          name,
          description: s.description,
          source: { type: 'package', location: pkg.title },
          hasScripts: [...files.keys()].some((p) => SCRIPT_EXT.test(p)),
          warnings: [],
          files
        })
      }
      for (const a of s.assign) skillsRepo.assign(skill.id, a.type, (a.type === 'unit' ? uId : aId).get(a.ref)!, true)
    }
  })()
  staged.delete(stagingId)
  return { unitId: pkg.units.length ? uId.get(pkg.units.find((u) => u.parentRef === null)!.ref)! : null, agentIds: [...aId.values()], reusedSkills }
}
