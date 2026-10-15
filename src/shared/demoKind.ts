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
