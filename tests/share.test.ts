/** Shared packages (.agentbits): the validator on untrusted input and the permission ceiling. Run: npm run test:unit */
import assert from 'node:assert/strict'
import { SHARE_FORMAT, cleanSkillPath, grantedPermissions, parseSharePackage } from '../src/shared/share.ts'

const perms = { fsRead: true, fsWrite: true, terminal: true, network: false, browser: false }
const agent = (ref: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ ref, name: `Agent ${ref}`, role: 'Dev', persona: '', jobDescription: 'Builds', perms, ...extra })
const pkg = (extra: Record<string, unknown> = {}): string =>
  JSON.stringify({
    format: SHARE_FORMAT,
    version: 1,
    kind: 'unit',
    title: 'Web team',
    units: [
      { ref: 'u1', parentRef: null, name: 'Web', kind: 'team', leadRef: 'a1', members: [{ agentRef: 'a1', title: 'Lead' }, { agentRef: 'a2', title: '' }] },
      { ref: 'u2', parentRef: 'u1', name: 'QA', kind: 'organization', members: [] }
    ],
    agents: [agent('a1', { provider: { kind: 'claude-cli', model: 'opus' } }), agent('a2', { provider: { kind: 'evil', model: 'x' }, color: 'red;}' })],
    skills: [{ name: 'review', description: 'd', files: { 'SKILL.md': Buffer.from('# Review').toString('base64') }, assign: [{ type: 'unit', ref: 'u1' }] }],
    ...extra
  })

// A good package round-trips; unknown provider kinds and bad colours are dropped, not trusted.
const p = parseSharePackage(pkg())
assert.equal(p.units.length, 2)
assert.equal(p.units[0].leadRef, 'a1')
assert.equal(p.agents[0].provider?.kind, 'claude-cli')
assert.equal(p.agents[1].provider, null)
assert.equal(p.agents[1].color, '#6366f1')
assert.equal(p.skills[0].assign[0].ref, 'u1')

const bad = (extra: Record<string, unknown>, why: RegExp): void => assert.throws(() => parseSharePackage(pkg(extra)), why)
assert.throws(() => parseSharePackage('{'), /JSON/)
assert.throws(() => parseSharePackage(JSON.stringify({ format: 'x' })), /not an Agentbits/)
bad({ version: 99 }, /newer/)
bad({ agents: [agent('a1'), agent('a1')] }, /duplicate agent/)
bad({ agents: [agent('../x')] }, /bad ref/)
bad({ units: [{ ref: 'u1', parentRef: null, name: 'A', members: [{ agentRef: 'nobody' }] }] }, /unknown member/)
bad({ units: [{ ref: 'u1', parentRef: null, name: 'A' }, { ref: 'u2', parentRef: null, name: 'B' }] }, /exactly one top/)
bad({ units: [{ ref: 'u1', parentRef: null, name: 'A' }, { ref: 'u2', parentRef: 'u3', name: 'B' }, { ref: 'u3', parentRef: 'u2', name: 'C' }] }, /cycle/)
bad({ skills: [{ name: 's', files: { '../../etc/passwd': '' } }] }, /bad file/)
bad({ skills: [{ name: 's', files: { 'C:/x/SKILL.md': '' } }] }, /bad file/)
bad({ skills: [{ name: 's', files: { 'a.md': '' } }] }, /no SKILL.md/)
bad({ skills: [{ name: 's', files: { 'SKILL.md': '' }, assign: [{ type: 'agent', ref: 'ghost' }] }] }, /unknown assignment/)
bad({ agents: Array.from({ length: 201 }, (_, i) => agent(`a${i}`)) }, /more than 200/)
bad({ units: [], agents: [], skills: [] }, /empty/)

assert.equal(cleanSkillPath('ref/./api.md'), 'ref/api.md')
assert.equal(cleanSkillPath('a/../b'), null)

// A package can never skip approval or hand out folders.
const g = grantedPermissions({ ...perms, requireApproval: false, allowedPaths: ['/'] } as never)
assert.equal(g.requireApproval, true)
assert.deepEqual(g.allowedPaths, [])

console.log('share: package validation and permission ceiling ok')
