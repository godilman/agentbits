/**
 * Demo provider: guesses what kind of work a task is, so the simulation looks like that work (a marketing task
 * writes drafts instead of editing source files). Pure; `tests/demo.test.ts`.
 */
export type DemoKind = 'code' | 'research' | 'content' | 'data'

// Keywords in the task text and the agent's role / skills (Turkish + English).
const KIND_KEYWORDS: [DemoKind, RegExp][] = [
  ['code', /\b(kod|code|bug|api|frontend|backend|react|css|html|sql|deploy|refactor|component|endpoint|build|typescript|javascript|python|php|unit test|e2e|developer|engineer|devops|qa)\b|bileşen|geliştir|yazılım|software|arayüz|hata düzelt/gi], // i18n-ignore
  ['research', /araştır|research|rakip|competitor|literat|karşılaştır|compar|trend|kaynak|source|incele(me)?\b|analyst|benchmark|survey|pazar analizi|market analysis/gi], // i18n-ignore
  ['content', /pazarlama|marketing|içerik|content|blog|makale|article|kampanya|campaign|newsletter|bülten|sosyal medya|social media|\bseo\b|slogan|metin|copy|linkedin|instagram|duyuru|announcement|e-?posta|email|writer|yazar|basın|press/gi], // i18n-ignore
  ['data', /\bveri\b|\bdata\b|excel|\bcsv\b|spreadsheet|dashboard|metrik|metric|\bkpi\b|istatistik|statistic|tahmin|forecast|grafik|chart|satış raporu|sales report/gi] // i18n-ignore
]

// Plain lower case keeps "API" as "api" (the Turkish locale would give "apı"); drop the dot "İ" leaves behind.
const lower = (s: string): string => s.toLowerCase().replace(/\u0307/g, '')

const score = (text: string): Record<DemoKind, number> => {
  const out: Record<DemoKind, number> = { code: 0, research: 0, content: 0, data: 0 }
  for (const [kind, re] of KIND_KEYWORDS) out[kind] = text.match(re)?.length ?? 0
  return out
}

/** The task text decides; the agent's role and skills break ties. Unknown work is simulated as code (the default). */
export function demoKind(taskText: string, agentProfile = ''): DemoKind {
  const task = score(lower(taskText))
  const profile = score(lower(agentProfile))
  let best: DemoKind = 'code'
  let bestScore = 0
  for (const kind of ['code', 'research', 'content', 'data'] as DemoKind[]) {
    const s = task[kind] * 100 + profile[kind]
    if (s > bestScore) (best = kind), (bestScore = s)
  }
  return best
}

/**
 * Demo lead: the parts a request is split into, one task each. Only sentence ends (. ! ? ; followed by a space; not a
 * list number like "2.") and line
 * breaks split, so file names, version numbers and URLs stay whole and a one-sentence request stays one task. A part
 * under three words joins its neighbour; more than four parts end in one last part (nothing the user wrote is dropped).
 */
export function demoParts(msg: string): string[] {
  const words = (s: string): number => s.split(/\s+/).filter(Boolean).length
  const out: string[] = []
  for (const s of msg.split(/(?<=[.!?;])(?<!(?:^|\s)\d{1,3}\.)\s+|\n+/)) {
    const p = s.trim()
    if (!p) continue
    if (out.length && (words(p) < 3 || words(out[out.length - 1]) < 3)) out[out.length - 1] += ` ${p}`
    else out.push(p)
  }
  if (out.length > 4) out.splice(3, out.length, out.slice(3).join(' '))
  return out.map((p) => p.replace(/[.;]+$/, ''))
}

// Work verbs (Turkish + English): a short message with one is a work order, not small talk.
const ORDER = /\b(fix|add|write|make|update|create|remove|delete|build|implement|change|refactor|rename|test|check|review|prepare|draft|translate|design|research|find)\b|düzelt|ekle|yaz\b|yazın|yap\b|yapın|sil\b|güncelle|oluştur|kur\b|hazırla|değiştir|incele|kontrol et|test et|çevir|tasarla|araştır|bul\b/i // i18n-ignore

/**
 * Demo lead: is the message work to plan (tasks) or talk? A question is talk; a short message (under four words) is talk
 * unless it names work ("Fix math.js", "Hatayı düzelt"); anything longer is work.
 */
export function demoIsWork(msg: string): boolean {
  if (/\?\s*$/.test(msg)) return false
  return msg.split(/\s+/).filter(Boolean).length >= 4 || ORDER.test(msg)
}
