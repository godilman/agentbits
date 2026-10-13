/**
 * Translation checks (run by `npm run test:unit`):
 *  1. Every language has the same files and exactly the same keys as English (the reference).
 *  2. Each value keeps the same {{placeholders}} as English, and no value is empty.
 *  3. Every namespace file is registered in `src/shared/locales/index.ts`.
 *  4. No hard-coded user-facing Turkish text is left in the source (strings or JSX text containing
 *     Turkish letters). Lines that must keep such text (e.g. the language name "Türkçe", test data,
 *     agent-facing samples) end with `// i18n-ignore`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = join(import.meta.dirname, '..')
const localesDir = join(root, 'src/shared/locales')
const REF = 'en'
const errors: string[] = []

type Json = { [k: string]: unknown }

function flatten(obj: Json, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v as Json, key, out)
    else if (Array.isArray(v)) errors.push(`${key}: arrays are not allowed, use separate keys`)
    else out[key] = String(v)
  }
  return out
}

const placeholders = (s: string): string => [...s.matchAll(/\{\{\s*([\w.]+)[^}]*\}\}/g)].map((m) => m[1]).sort().join(',')

const languages = readdirSync(localesDir).filter((d) => statSync(join(localesDir, d)).isDirectory())
const refFiles = readdirSync(join(localesDir, REF)).filter((f) => f.endsWith('.json')).sort()
const load = (lng: string, file: string): Record<string, string> =>
  flatten(JSON.parse(readFileSync(join(localesDir, lng, file), 'utf8')) as Json)

// 1–2
for (const lng of languages) {
  const files = readdirSync(join(localesDir, lng)).filter((f) => f.endsWith('.json')).sort()
  for (const f of refFiles) if (!files.includes(f)) errors.push(`${lng}/${f}: missing file`)
  for (const f of files) if (!refFiles.includes(f)) errors.push(`${lng}/${f}: not in ${REF}/`)
  for (const f of refFiles) {
    if (!files.includes(f)) continue
    const ref = load(REF, f)
    const cur = lng === REF ? ref : load(lng, f)
    // Plural keys (`x_one`, `x_other`, `x_few`…) are compared by their base; each language must have exactly the
    // plural forms its own grammar uses (Intl.PluralRules), e.g. en/tr: one + other, ru: one + few + many + other.
    const categories = new Intl.PluralRules(lng).resolvedOptions().pluralCategories as string[]
    const PLURAL = /_(zero|one|two|few|many|other)$/
    const bases = (o: Record<string, string>): Map<string, string> => {
      const m = new Map<string, string>()
      for (const k of Object.keys(o)) m.set(k.replace(PLURAL, ''), PLURAL.test(k) ? 'plural' : 'single')
      return m
    }
    const refBases = bases(ref)
    const curBases = bases(cur)
    for (const [base, kind] of refBases) {
      if (!curBases.has(base)) errors.push(`${lng}/${f}: missing key ${base}`)
      else if (curBases.get(base) !== kind) errors.push(`${lng}/${f}: ${base} must be ${kind === 'plural' ? 'plural (_one/_other…)' : 'a plain key'}`)
      else if (kind === 'plural') {
        for (const c of categories) if (!(`${base}_${c}` in cur)) errors.push(`${lng}/${f}: missing plural form ${base}_${c}`)
      }
    }
    for (const base of curBases.keys()) if (!refBases.has(base)) errors.push(`${lng}/${f}: extra key ${base} (not in ${REF})`)
    const refText = (k: string): string | undefined => ref[k] ?? ref[k.replace(PLURAL, '_other')]
    for (const [k, v] of Object.entries(cur)) {
      if (!v.trim()) errors.push(`${lng}/${f}: empty value ${k}`)
      const r = refText(k)
      if (r !== undefined && placeholders(r).replace(/(^|,)count(,|$)/, '$1$2') !== placeholders(v).replace(/(^|,)count(,|$)/, '$1$2'))
        errors.push(`${lng}/${f}: ${k} placeholders differ ({{${placeholders(r)}}} vs {{${placeholders(v)}}})`)
    }
  }
}

// 3
const index = readFileSync(join(localesDir, 'index.ts'), 'utf8')
for (const lng of languages)
  for (const f of readdirSync(join(localesDir, lng)).filter((x) => x.endsWith('.json')))
    if (!index.includes(`'./${lng}/${f}'`)) errors.push(`locales/index.ts: ${lng}/${f} is not imported`)

// 4
const TURKISH = /[çğıöşüÇĞİÖŞÜ]/
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name !== 'locales') walk(p, out)
    } else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts')) out.push(p)
  }
  return out
}
for (const file of [...walk(join(root, 'src/main')), ...walk(join(root, 'src/renderer/src')), ...walk(join(root, 'src/shared'))]) {
  const src = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  src.split('\n').forEach((line, i) => {
    if (/\/\/\s*i18n-ignore\b/.test(line)) return
    const code = line.replace(/(^|\s)\/\/.*$/, '')
    if (TURKISH.test(code)) errors.push(`${relative(root, file)}:${i + 1}: hard-coded Turkish text → move it to a locale file`)
  })
}

if (errors.length) {
  const all = process.argv.includes('--all')
  console.error((all ? errors : errors.slice(0, 200)).join('\n') + (!all && errors.length > 200 ? `\n… ${errors.length - 200} more (--all)` : ''))
  console.error(`\ni18n: ${errors.length} problem(s)`)
  process.exitCode = 1
} else {
  console.log(`i18n: ${languages.length} languages, ${refFiles.length} namespaces, all keys consistent, no hard-coded text`)
}
