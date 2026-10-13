import { getDb } from '../db'
import { t } from '../i18n'
import { decryptSecret, encryptSecret, isPlainSecret, secureStorageAvailable } from '../secrets'

/**
 * One-time, idempotent boot fixes for data written by older versions.
 *
 * `renameLegacyDefne`: the starter team that older versions seeded had a QA agent called "Defne"; the team is now the
 * optional "Çekirdek Ekip" template where she is "Zeynep". Existing databases get the same rename once:
 * the agent, plus her name in stored texts (chat, tasks, runs, logs, memories, decisions, reports, instructions).
 * Turkish suffixes after an apostrophe are adjusted ("Defne'ye" → "Zeynep'e"). Files and the audit log are not touched.
 * Runs only once per database (settings flag; the flag is not part of AppSettings) and only when no agent is already
 * called Zeynep — an agent the user names "Defne" after this has run is never renamed.
 */
const FLAG = 'legacy.defneRenamed'
const OLD = 'Defne'
const NEW = 'Zeynep'

// Same vowel harmony (both end in a front vowel / "e"); only the buffer letters and d→t after "p" change.
const SUFFIX: Record<string, string> = {
  nin: 'in', ye: 'e', yi: 'i', yle: 'le', de: 'te', den: 'ten', dir: 'tir', yla: 'la', ya: 'a', nın: 'ın' // i18n-ignore (suffix data)
}
const WORD = new RegExp(`\\b${OLD}(?:(['’])(\\p{L}+))?(?!\\p{L})`, 'gu')

export function replaceLegacyName(text: string): string {
  return text.replace(WORD, (_m, apos: string | undefined, suf: string | undefined) =>
    apos && suf ? `${NEW}${apos}${SUFFIX[suf.toLowerCase()] ?? suf}` : NEW
  )
}

/** Free-text tables and the TEXT columns that may contain agent names. */
const TEXT_TABLES = ['agents', 'messages', 'tasks', 'runs', 'agent_logs', 'memories', 'decisions', 'reports', 'agent_instructions']

export function renameLegacyDefne(): void {
  const db = getDb()
  const done = db.prepare('SELECT 1 FROM settings WHERE key = ?').get(FLAG)
  if (done) return
  const markDone = (): void => {
    db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(FLAG, 'true')
  }
  const agent = db.prepare(`SELECT id FROM agents WHERE name = ? COLLATE NOCASE`).get(OLD) as { id: string } | undefined
  const taken = db.prepare('SELECT 1 FROM agents WHERE name = ? COLLATE NOCASE').get(NEW)
  if (!agent || taken) return markDone()

  db.transaction(() => {
    db.prepare('UPDATE agents SET name = ? WHERE id = ?').run(NEW, agent.id)
    const tables = new Set((db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map((r) => r.name))
    for (const table of TEXT_TABLES) {
      if (!tables.has(table)) continue
      const cols = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string; type: string; pk: number }[])
        .filter((c) => /TEXT/i.test(c.type) && !c.pk && c.name !== 'id' && !c.name.endsWith('_id'))
        .map((c) => c.name)
      const key = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string; pk: number }[]).find((c) => c.pk)?.name ?? 'rowid'
      for (const col of cols) {
        const rows = db.prepare(`SELECT ${key} AS k, ${col} AS v FROM ${table} WHERE ${col} LIKE ?`).all(`%${OLD}%`) as { k: unknown; v: string }[]
        const upd = db.prepare(`UPDATE ${table} SET ${col} = ? WHERE ${key} = ?`)
        for (const r of rows) {
          const next = replaceLegacyName(r.v)
          if (next !== r.v) upd.run(next, r.k)
        }
      }
    }
    markDone()
  })()
}

/**
 * Secrets that older versions stored as base64 (`plain:`, when no keychain was available) are encrypted as soon as
 * the OS keychain works. Runs on every start; cheap when there is nothing to do.
 */
export function upgradePlainSecrets(): number {
  if (!secureStorageAvailable()) return 0
  const db = getDb()
  let n = 0
  const fix = (table: string, col: string, asBase64Text: boolean): void => {
    const rows = db.prepare(`SELECT rowid AS rid, ${col} AS v FROM ${table} WHERE ${col} IS NOT NULL`).all() as { rid: number; v: Buffer | string }[]
    for (const r of rows) {
      const buf = asBase64Text ? Buffer.from(String(r.v), 'base64') : (r.v as Buffer)
      if (!isPlainSecret(buf)) continue
      const plain = decryptSecret(buf)
      if (plain === null) continue
      const enc = encryptSecret(plain)
      db.prepare(`UPDATE ${table} SET ${col} = ? WHERE rowid = ?`).run(asBase64Text ? enc.toString('base64') : enc, r.rid)
      n++
    }
  }
  db.transaction(() => {
    fix('providers', 'api_key_enc', false)
    fix('connections', 'secret_enc', true)
    fix('connections', 'ro_secret_enc', true)
    fix('mcp_servers', 'env_enc', false)
    fix('mcp_servers', 'headers_enc', false)
    fix('mcp_servers', 'oauth_enc', false)
  })()
  return n
}

/**
 * OAuth sign-ins saved before the MCP SDK 1.31.0 fix (GHSA-6qxp-vccf-f47h) carry no `issuer`, so the SDK would still
 * hand their refresh token / client secret to whatever authorization server an MCP server names. As the advisory
 * advises, they are cleared: the user signs in again (the new sign-in records its issuer). Runs on every start.
 */
export function dropUnboundOAuth(): number {
  const db = getDb()
  const rows = db.prepare('SELECT id, oauth_enc FROM mcp_servers WHERE oauth_enc IS NOT NULL').all() as { id: string; oauth_enc: Buffer }[]
  let n = 0
  for (const r of rows) {
    let state: { tokens?: { issuer?: unknown }; client?: { issuer?: unknown } } = {}
    try {
      state = JSON.parse(decryptSecret(r.oauth_enc) ?? '{}')
    } catch {
      state = {}
    }
    const unbound = (state.tokens && !state.tokens.issuer) || (state.client && !state.client.issuer)
    if (!unbound) continue
    db.prepare(
      "UPDATE mcp_servers SET oauth_enc = NULL, last_ok = 0, last_message = ?, last_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?"
    ).run(t('main:apps.errors.reSignIn'), r.id)
    n++
  }
  return n
}
