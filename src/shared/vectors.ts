/**
 * Semantic memory (optional, off by default): memories are embedded through an OpenAI-compatible `/embeddings` endpoint
 * the user picked (OpenAI, Gemini, Ollama, LM Studio…) and recalled by meaning as well as by words (FTS). Pure helpers;
 * `tests/vectors.test.ts`.
 */

/** Unit-length copy (cosine similarity becomes a dot product); null for an empty or zero vector. */
export function normalize(v: ArrayLike<number>): Float32Array | null {
  let n = 0
  for (let i = 0; i < v.length; i++) n += v[i] * v[i]
  if (!v.length || !Number.isFinite(n) || n === 0) return null
  const s = 1 / Math.sqrt(n)
  const out = new Float32Array(v.length)
  for (let i = 0; i < v.length; i++) out[i] = v[i] * s
  return out
}

export function dot(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

export const toBlob = (v: Float32Array): Uint8Array => new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength))
export const fromBlob = (b: Uint8Array): Float32Array => new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))

/**
 * Cosine similarity → 0..1 relevance. Unrelated text still scores ~0.1–0.3 with common embedding models, so the floor is
 * cut off. ponytail: fixed thresholds; per-model calibration if a model's scale differs a lot.
 */
export function semanticRelevance(cos: number): number {
  return Math.max(0, Math.min(1, (cos - 0.25) / 0.5))
}

/** The `/embeddings` response → vectors in input order (`index` field), normalized. Throws on a malformed answer. */
export function parseEmbeddings(json: unknown, count: number): Float32Array[] {
  const data = (json as { data?: { index?: number; embedding?: unknown }[] })?.data
  if (!Array.isArray(data) || data.length !== count) throw new Error('unexpected embeddings response')
  const out: Float32Array[] = new Array(count)
  data.forEach((d, i) => {
    const at = typeof d.index === 'number' ? d.index : i
    const v = Array.isArray(d.embedding) && d.embedding.every((x) => typeof x === 'number') ? normalize(d.embedding as number[]) : null
    if (!v || at < 0 || at >= count) throw new Error('unexpected embeddings response')
    out[at] = v
  })
  // `some` skips holes: check every slot (a repeated index leaves one empty).
  for (let i = 0; i < count; i++) if (!out[i]) throw new Error('unexpected embeddings response')
  return out
}
