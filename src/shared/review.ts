/** Parsing the project lead's review verdict (pure; tested in tests/review.test.ts). */

/** Top-level `{…}` blocks of a text (strings respected); objects nested inside another are part of their parent. */
function topLevelObjects(text: string): string[] {
  const out: string[] = []
  let i = 0
  while (i < text.length) {
    if (text[i] !== '{') {
      i++
      continue
    }
    let depth = 0
    let inStr = false
    let end = -1
    for (let j = i; j < text.length; j++) {
      const c = text[j]
      if (inStr) {
        if (c === '\\') j++
        else if (c === '"') inStr = false
      } else if (c === '"') inStr = true
      else if (c === '{') depth++
      else if (c === '}' && --depth === 0) {
        end = j
        break
      }
    }
    if (end < 0) break // unbalanced: nothing after this can be a complete top-level object
    out.push(text.slice(i, end + 1))
    i = end + 1
  }
  return out
}

/**
 * The lead's verdict. Only a top-level JSON object whose own `approved` is a real boolean counts: `"false"`,
 * "not approved", "onaylanmadı", a missing field, an `approved` nested deeper, a key given twice or bozuk JSON never
 * approve. Several verdicts that disagree are no verdict. `valid: false` = no usable verdict: the task waits for the user.
 */
export function parseReview(text: string): { approved: boolean; note: string; valid: boolean; criteria?: unknown } {
  const verdicts: { approved: boolean; note: string; criteria?: unknown }[] = []
  for (const raw of topLevelObjects(text)) {
    let v: unknown
    try {
      v = JSON.parse(raw)
    } catch {
      continue
    }
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue
    const o = v as { approved?: unknown; note?: unknown; criteria?: unknown }
    if (typeof o.approved !== 'boolean') continue
    // JSON.parse keeps the last of duplicate keys, and a nested "approved" could be mistaken for the verdict:
    // a verdict object that mentions approved more than once is not a verdict.
    if ((raw.match(/"approved"\s*:/g) ?? []).length !== 1) return { approved: false, note: text.trim().slice(0, 300), valid: false }
    verdicts.push({ approved: o.approved, note: String(o.note ?? '').slice(0, 2000), criteria: o.criteria })
  }
  if (!verdicts.length || verdicts.some((x) => x.approved !== verdicts[0].approved)) {
    return { approved: false, note: (verdicts.at(-1)?.note || text.trim()).slice(0, 300), valid: false }
  }
  const last = verdicts[verdicts.length - 1]
  return { approved: last.approved, note: last.note, valid: true, ...(last.criteria !== undefined ? { criteria: last.criteria } : {}) }
}

/** A task's acceptance criteria as a list: one per line, list markers removed, at most 20. */
export function acceptanceList(acceptance: string): string[] {
  return acceptance
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)]|\[[ xX]?\])\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 20)
}

/**
 * The lead's check of each acceptance criterion (`criteria` in the verdict: one `{met, note}` per criterion, in order).
 * Null when it's missing, has another length or a `met` that isn't a real boolean — then there is no usable verdict.
 */
export function judgeCriteria(lines: string[], raw: unknown): { text: string; met: boolean; note: string }[] | null {
  if (!Array.isArray(raw) || raw.length !== lines.length) return null
  const out: { text: string; met: boolean; note: string }[] = []
  for (let i = 0; i < lines.length; i++) {
    const c = raw[i] as { met?: unknown; note?: unknown } | null
    if (!c || typeof c !== 'object' || typeof c.met !== 'boolean') return null
    out.push({ text: lines[i], met: c.met, note: String(c.note ?? '').slice(0, 500) })
  }
  return out
}

/**
 * The lead's race verdict (race mode: two attempts at the same task). Same strictness as `parseReview`: only a
 * top-level object with exactly one "winner" that is "A" or "B"; several disagreeing verdicts or anything else =
 * no verdict (`valid: false`, the user decides).
 */
export function parseRaceVerdict(text: string): { winner: 'A' | 'B' | null; note: string; valid: boolean } {
  const found: { winner: 'A' | 'B'; note: string }[] = []
  for (const raw of topLevelObjects(text)) {
    let v: unknown
    try {
      v = JSON.parse(raw)
    } catch {
      continue
    }
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue
    const w = (v as { winner?: unknown }).winner
    if (w !== 'A' && w !== 'B') continue
    if ((raw.match(/"winner"\s*:/g) ?? []).length !== 1) return { winner: null, note: text.trim().slice(0, 300), valid: false }
    found.push({ winner: w, note: String((v as { note?: unknown }).note ?? '').slice(0, 2000) })
  }
  if (!found.length || found.some((x) => x.winner !== found[0].winner)) return { winner: null, note: text.trim().slice(0, 300), valid: false }
  const last = found[found.length - 1]
  return { winner: last.winner, note: last.note, valid: true }
}

/**
 * Race mode: the challenger for an attempt. `key` is "kind|baseUrl|model"; only a candidate on a different key counts,
 * and another provider kind beats the same provider with another model.
 */
export function pickRival<T extends { key: string }>(mine: string, free: T[]): T | null {
  const kind = (k: string): string => k.split('|')[0]
  const other = free.filter((a) => a.key !== mine)
  return other.find((a) => kind(a.key) !== kind(mine)) ?? other[0] ?? null
}
