// Prompt builder end to end (main process): what reaches the model, what is stored, cancel, errors.
// Real SQLite and IPC handlers; the provider is a stub (this checks the plumbing, not a real model's answers).
// Run: npm run test:e2e
import assert from 'node:assert/strict'
import { getDb, openDb } from '../../src/main/db'
import { agentsRepo, memoriesRepo, messagesRepo, providersRepo } from '../../src/main/db/repos'
import { handlers } from '../../src/main/ipc'
import { ensureOrgDefaults } from '../../src/main/core/org'
import { getAdapter } from '../../src/main/providers'
import type { RunContext } from '../../src/main/providers/types'
import { PROMPT_BUILDER_ID } from '../../src/shared/promptBuilder'

let count = 0
const step = async (name: string, fn: () => Promise<void> | void): Promise<void> => {
  await fn()
  count++
  console.log(`  ✓ ${name}`)
}
const call = <T = any>(name: string, ...args: unknown[]): Promise<T> => Promise.resolve((handlers as any)[name](...args))

// Anything printed while the builder works (a log line must never carry the user's text or the answer).
const printed: string[] = []
for (const k of ['log', 'warn', 'error', 'info', 'debug'] as const) {
  const orig = console[k].bind(console)
  console[k] = (...a: unknown[]) => {
    printed.push(a.map(String).join(' '))
    orig(...a)
  }
}

const seen: RunContext[] = []
let behave: (ctx: RunContext) => Promise<string> = async (ctx) => `PROMPT-OUT-4411 for ${ctx.prompt.length} chars`
const anthropic = getAdapter('anthropic')
anthropic.run = async (ctx) => {
  seen.push(ctx)
  ctx.onUsage?.({ input: 120, output: 30, cacheRead: 0, cacheWrite: 0, costUsd: 0 })
  return { text: await behave(ctx), tokensIn: 120, tokensOut: 30, costUsd: 0 }
}

async function main(): Promise<void> {
  openDb()

  await step('no provider set up → a clear pointer to Settings → Providers', async () => {
    await assert.rejects(call('promptBuilder:generate', 'r0', 'Bir şey'), /Ayarlar → Sağlayıcılar/)
  })

  ensureOrgDefaults()
  const demo = providersRepo.save({ kind: 'mock', label: 'Demo', model: '' })
  const codex = providersRepo.save({ kind: 'codex-cli', label: 'Codex', model: '' })
  const api = providersRepo.save({ kind: 'anthropic', label: 'Claude API', model: 'claude-sonnet-5-5', apiKey: 'sk-test' })
  // Things that must never reach this call: project chat, memory, an agent, a connection.
  const lead = agentsRepo.save({ name: 'Atlas', role: 'Lead' } as never)
  messagesRepo.create('general', 'user', null, 'GİZLİ-SOHBET-9921', null)
  memoriesRepo.add({ content: 'GİZLİ-HAFIZA-5512', kind: 'fact' })
  await call('connections:save', { name: 'gizli-db', kind: 'postgres', env: 'staging', host: 'db.local', port: 5432, username: 'u' })
  const before = (getDb().prepare('SELECT COUNT(*) AS n FROM agent_logs').get() as { n: number }).n

  await step('Demo and Codex are refused with what to choose instead; nothing is sent', async () => {
    await assert.rejects(call('promptBuilder:generate', 'r1', 'Bir şey', demo.id), /Demo bir simülasyon/)
    await assert.rejects(call('promptBuilder:generate', 'r2', 'Bir şey', codex.id), /Codex'in her zaman bir kabuğu var/)
    assert.equal(seen.length, 0)
  })

  await step('empty or blank input is refused', async () => {
    await assert.rejects(call('promptBuilder:generate', 'r3', '   \n ', api.id), /Önce ne yapmak istediğini yaz/)
    assert.equal(seen.length, 0)
  })

  await step('only the message reaches the model: no history, project, memory, connections, tools or files', async () => {
    const r = await call<{ prompt: string; provider: string; model: string }>('promptBuilder:generate', 'r4', "ZEBRA-7781 Türkiye'nin başkenti neresidir?", api.id)
    assert.match(r.prompt, /^PROMPT-OUT-4411/)
    assert.equal(r.provider, 'Claude API')
    assert.equal(r.model, 'claude-sonnet-5-5')
    const ctx = seen.at(-1)!
    const all = `${ctx.system}\n${ctx.prompt}`
    assert.ok(ctx.prompt.includes("ZEBRA-7781 Türkiye'nin başkenti neresidir?"))
    for (const leak of ['GİZLİ-SOHBET-9921', 'GİZLİ-HAFIZA-5512', 'gizli-db', 'db.local', 'Atlas', '## Project', 'Relevant memory']) assert.ok(!all.includes(leak), leak)
    assert.equal(ctx.tools, undefined)
    assert.equal(ctx.callTool, undefined)
    assert.equal(ctx.mcpConfigPath, undefined)
    assert.equal(ctx.mcpServer, undefined)
    assert.equal(ctx.history, undefined)
    assert.equal(ctx.attachments, undefined)
    assert.deepEqual(
      [ctx.permissions.fsRead, ctx.permissions.fsWrite, ctx.permissions.terminal, ctx.permissions.network, ctx.permissions.browser, ctx.permissions.allowedPaths.length],
      [false, false, false, false, false, 0]
    )
    assert.match(ctx.cwd, /agentbits-prompt-/)
    assert.equal(ctx.agent.id, PROMPT_BUILDER_ID)
    assert.notEqual(ctx.agent.id, lead.id)
  })

  await step('each message is independent: the next call carries nothing from the previous one', async () => {
    await call('promptBuilder:generate', 'r5', 'Bir stok takip uygulaması istiyorum.', api.id)
    const ctx = seen.at(-1)!
    assert.ok(!ctx.prompt.includes('ZEBRA-7781') && !ctx.system.includes('ZEBRA-7781') && !ctx.prompt.includes('PROMPT-OUT-4411'))
    assert.ok(ctx.prompt.includes('Bir stok takip uygulaması istiyorum.'))
  })

  await step('with no provider chosen, the default provider is used', async () => {
    providersRepo.save({ isDefault: true } as never, api.id)
    await call('promptBuilder:generate', 'r6', 'Bir rapor şablonu', null)
    assert.equal(seen.at(-1)!.provider.id, api.id)
  })

  await step('a running request is cancelled (closing the dialog) and says so', async () => {
    behave = (ctx) => new Promise((_, reject) => ctx.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
    const p = call('promptBuilder:generate', 'r7', 'Uzun sürecek bir istek', api.id)
    await new Promise((r) => setTimeout(r, 30))
    await call('promptBuilder:cancel', 'r7')
    await assert.rejects(p, /İptal edildi/)
  })

  await step('a provider error is shown in plain words (a rejected key points to the fix)', async () => {
    behave = async () => {
      throw new Error('529 overloaded_error: Overloaded')
    }
    await assert.rejects(call('promptBuilder:generate', 'r8', 'Bir şey', api.id), /529 overloaded_error/)
    behave = async () => {
      throw new Error('401 authentication_error: invalid x-api-key')
    }
    await assert.rejects(call('promptBuilder:generate', 'r9', 'Bir şey', api.id), (e: Error) => !/authentication_error/.test(e.message) && e.message.length > 10)
    behave = async () => 'PROMPT-OUT-4411'
    const again = await call<{ prompt: string }>('promptBuilder:generate', 'r10', 'Bir şey', api.id)
    assert.equal(again.prompt, 'PROMPT-OUT-4411')
  })

  await step('nothing is stored or logged: no table holds the text or the answer; only a token count', async () => {
    const db = getDb()
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%fts%'").all() as { name: string }[]).map((r) => r.name)
    for (const table of tables) {
      const cols = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string; type: string }[]).filter((c) => /TEXT|^$/i.test(c.type)).map((c) => c.name)
      for (const col of cols) {
        const hit = db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col} LIKE '%ZEBRA-7781%' OR ${col} LIKE '%PROMPT-OUT-4411%' OR ${col} LIKE '%stok takip%'`).get() as { n: number }
        assert.equal(hit.n, 0, `${table}.${col}`)
      }
    }
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM agent_logs').get() as { n: number }).n, before)
    const usage = db.prepare('SELECT COUNT(*) AS n, SUM(input) AS i FROM token_usage WHERE agent_id = ?').get(PROMPT_BUILDER_ID) as { n: number; i: number }
    assert.ok(usage.n >= 4 && usage.i >= 480, JSON.stringify(usage))
    assert.ok(!printed.some((l) => /ZEBRA-7781|PROMPT-OUT-4411|stok takip/.test(l)), 'console')
    const summary = await call<{ agents: { agentId: string }[] }>('usage:summary', null)
    assert.ok(summary.agents.some((a) => a.agentId === PROMPT_BUILDER_ID), 'shown in Reports → Token usage')
  })

  console.log(`promptBuilder e2e: ${count} ok`)
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
