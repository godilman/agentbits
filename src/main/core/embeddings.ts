import { getDb } from '../db'
import { providersRepo, settingsRepo } from '../db/repos'
import { emit } from '../events'
import { dot, fromBlob, parseEmbeddings, toBlob } from '@shared/vectors'

/**
 * Semantic memory (Settings → Memory, off by default): memories are embedded in the background through the chosen
 * OpenAI-compatible provider's `/embeddings` endpoint and stored in `memory_vectors`, tagged with provider + model
 * (switching either re-embeds). Recall adds the closest memories by meaning to the FTS matches; any failure falls back to
 * words only. Memory text goes to that provider — with Ollama / LM Studio it stays on this computer.
 */

const OPENAI = 'https://api.openai.com/v1'
const BATCH = 32

function config(): { base: string; key: string | null; model: string; tag: string } | null {
  const s = settingsRepo.get()
  const model = s.memoryEmbedModel.trim()
  if (!s.memoryEmbedProviderId || !model) return null
  const p = providersRepo.get(s.memoryEmbedProviderId)
  if (!p || p.kind !== 'openai') return null
  return { base: p.baseUrl || OPENAI, key: providersRepo.getApiKey(p.id), model, tag: `${p.id}|${model}` }
}

async function embed(c: NonNullable<ReturnType<typeof config>>, texts: string[], timeoutMs: number): Promise<Float32Array[]> {
  const res = await fetch(`${c.base}/embeddings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(c.key ? { authorization: `Bearer ${c.key}` } : {}) },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({ model: c.model, input: texts })
  })
  if (!res.ok) {
    let detail = res.statusText
    try {
      detail = ((await res.json()) as { error?: { message?: string } }).error?.message ?? detail
    } catch {
      /* keep the status text */
    }
    throw new Error(`${res.status} ${detail}`.slice(0, 300))
  }
  return parseEmbeddings(await res.json(), texts.length)
}

let lastError = ''
let running = false
let again = false
let timer: ReturnType<typeof setTimeout> | null = null

/** Embeds memories that have no vector for the current provider + model, in batches (soon after a change). */
export function scheduleIndex(delayMs = 1500): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    void indexPending()
  }, delayMs)
}

async function indexPending(): Promise<void> {
  if (running) {
    again = true
    return
  }
  running = true
  try {
    for (;;) {
      const c = config()
      if (!c) break
      const rows = getDb()
        .prepare(
          `SELECT m.id, m.content FROM memories m LEFT JOIN memory_vectors v ON v.memory_id = m.id AND v.model = ?
           WHERE v.memory_id IS NULL ORDER BY m.created_at DESC LIMIT ?`
        )
        .all(c.tag, BATCH) as { id: string; content: string }[]
      if (!rows.length) break
      const vecs = await embed(c, rows.map((r) => r.content), 60_000)
      const put = getDb().prepare('INSERT OR REPLACE INTO memory_vectors(memory_id, model, vec) SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM memories WHERE id = ?)')
      getDb().transaction(() => rows.forEach((r, i) => put.run(r.id, c.tag, Buffer.from(toBlob(vecs[i])), r.id)))()
      lastError = ''
    }
  } catch (e) {
    // Stops here (no retry storm); the next new memory or a settings change tries again.
    lastError = (e as Error).name === 'TimeoutError' ? 'timeout' : (e as Error).message
  } finally {
    running = false
    emit({ type: 'memory:changed' })
    if (again) {
      again = false
      scheduleIndex()
    }
  }
}

export function vectorStatus(): { enabled: boolean; indexed: number; total: number; error: string } {
  const c = config()
  const db = getDb()
  const total = (db.prepare('SELECT COUNT(*) AS n FROM memories').get() as { n: number }).n
  const indexed = c ? (db.prepare('SELECT COUNT(*) AS n FROM memory_vectors WHERE model = ?').get(c.tag) as { n: number }).n : 0
  return { enabled: !!c, indexed, total, error: c ? lastError : '' }
}

/** The query's embedding, or null (off, or the provider didn't answer in time: recall then uses words only). */
export async function queryVector(text: string): Promise<{ vec: Float32Array; tag: string } | null> {
  const c = config()
  if (!c || !text.trim()) return null
  try {
    const [vec] = await embed(c, [text.slice(0, 8000)], 8_000)
    return { vec, tag: c.tag }
  } catch (e) {
    lastError = (e as Error).name === 'TimeoutError' ? 'timeout' : (e as Error).message
    return null
  }
}

/**
 * Memories closest in meaning within the caller's scope (`where` uses alias `m`). ponytail: brute-force scan over the
 * scoped vectors — fine for tens of thousands of memories; an ANN index (e.g. sqlite-vec) if it ever gets slow.
 */
export function semanticHits(q: { vec: Float32Array; tag: string }, where: string, params: Record<string, unknown>, limit = 40): { id: string; cos: number }[] {
  const rows = getDb()
    .prepare(`SELECT v.memory_id AS id, v.vec FROM memory_vectors v JOIN memories m ON m.id = v.memory_id WHERE v.model = @tag AND ${where}`)
    .all({ ...params, tag: q.tag }) as { id: string; vec: Buffer }[]
  return rows
    .map((r) => ({ id: r.id, cos: dot(q.vec, fromBlob(r.vec)) }))
    .sort((a, b) => b.cos - a.cos)
    .slice(0, limit)
}
