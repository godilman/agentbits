/** Agent CLI environment and settings validation (security review #03, #13, #18). Run: npm run test:unit */
import assert from 'node:assert/strict'
import { agentEnv, SettingsError, validateSettingsPatch } from '../src/shared/settingsRules.ts'

const parent = {
  Path: 'C:\\Windows',
  HOME: '/home/u',
  APPDATA: 'C:\\Users\\u\\AppData\\Roaming',
  LC_ALL: 'tr_TR.UTF-8',
  HTTPS_PROXY: 'http://proxy:8080',
  CLAUDE_CONFIG_DIR: '/c',
  ANTHROPIC_BASE_URL: 'https://x',
  CODEX_HOME: '/codex',
  OPENAI_API_KEY: 'sk-user',
  AWS_SECRET_ACCESS_KEY: 'aws',
  GITHUB_TOKEN: 'ghp',
  DATABASE_URL: 'postgres://u:p@db',
  SSH_AUTH_SOCK: '/tmp/agent.sock',
  NODE_OPTIONS: '--require evil.js',
  ELECTRON_RUN_AS_NODE: '1',
  MY_CORP_CA: '/ca.pem',
  EMPTY: undefined
}

const claude = agentEnv(parent, 'claude')
assert.deepEqual(Object.keys(claude).sort(), ['ANTHROPIC_BASE_URL', 'APPDATA', 'CLAUDE_CONFIG_DIR', 'HOME', 'HTTPS_PROXY', 'LC_ALL', 'Path'])
const codex = agentEnv(parent, 'codex')
assert.ok(codex.CODEX_HOME && codex.OPENAI_API_KEY && !codex.CLAUDE_CONFIG_DIR && !codex.ANTHROPIC_BASE_URL)
// secrets of other services and dangerous variables never pass, not even when listed
for (const env of [claude, codex, agentEnv(parent, 'claude', ['SSH_AUTH_SOCK', 'node_options'])]) {
  for (const k of ['AWS_SECRET_ACCESS_KEY', 'GITHUB_TOKEN', 'DATABASE_URL', 'SSH_AUTH_SOCK', 'NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE', 'EMPTY']) assert.ok(!(k in env), k)
}
// the user's extra list (case-insensitive)
assert.equal(agentEnv(parent, 'claude', ['my_corp_ca']).MY_CORP_CA, '/ca.pem')

// settings patches
assert.deepEqual(validateSettingsPatch({ autopilot: false, runMaxMinutes: 30, runMaxCostUsd: 2.5 }), { autopilot: false, runMaxMinutes: 30, runMaxCostUsd: 2.5 })
assert.deepEqual(validateSettingsPatch({ cliEnvPassthrough: [' MY_CA ', 'MY_CA', ''] }), { cliEnvPassthrough: ['MY_CA'] })
const bad = (patch: unknown, code = 'invalid'): void =>
  assert.throws(() => validateSettingsPatch(patch), (e: unknown) => e instanceof SettingsError && e.code === code, JSON.stringify(patch))
bad(null)
bad([])
bad({ autopilot: 'yes' })
bad({ logRetentionDays: 'abc' })
bad({ logRetentionDays: -1 })
bad({ runMaxMinutes: 1.5 })
bad({ runMaxTokens: Infinity })
bad({ runMaxCostUsd: 1e9 })
bad({ startupProjects: 'always' })
bad({ language: 42 })
bad({ __proto__: { autopilot: true }, isAdmin: true })
bad({ unknownKey: 1 })
assert.deepEqual(validateSettingsPatch({ filesQuotaMb: 0, auditRetentionDays: 365 }), { filesQuotaMb: 0, auditRetentionDays: 365 })
bad({ filesQuotaMb: 1.5 })
bad({ filesQuotaMb: -10 })
bad({ cliEnvPassthrough: 'PATH' })
bad({ cliEnvPassthrough: ['SSH_AUTH_SOCK'] }, 'envName')
bad({ cliEnvPassthrough: ['A B'] }, 'envName')
bad({ cliEnvPassthrough: ['X=1'] }, 'envName')
console.log('settings: agent env and patch validation ok')
