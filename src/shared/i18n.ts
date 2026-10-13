/**
 * Internationalization shared by main and renderer (i18next).
 *
 * - Texts live in `src/shared/locales/<language>/<namespace>.json`; English is the reference language.
 * - Keys are type-checked against the English files (see `i18n-types.d.ts`): `t('settings:general.title')`.
 * - Interpolation `{{name}}`, plurals with `count` (`key_one` / `key_other`).
 * - Main and renderer each create their own instance with `createI18n()`; the language comes from
 *   `settings.language` ('auto' = operating system language) via `resolveLanguage()`.
 */
import i18next, { type i18n as I18n, type ParseKeys } from 'i18next'
import { NAMESPACES, resources } from './locales'

/**
 * Any translation key (`'actions.save'` = common, `'org:templates.title'` = other namespaces). Use it for tables of
 * labels kept outside components: `{ labelKey: 'tasks:status.todo' as I18nKey }` → `t(labelKey)`.
 */
export type I18nKey = ParseKeys<[...typeof NAMESPACES]>

export const LANGUAGES = [
  { code: 'en', name: 'English', intl: 'en-US' },
  { code: 'tr', name: 'Türkçe', intl: 'tr-TR' } // i18n-ignore
] as const

export type Language = (typeof LANGUAGES)[number]['code']
/** Stored in settings: a language code, or 'auto' to follow the operating system. */
export type LanguagePref = Language | 'auto'

export const FALLBACK_LANGUAGE: Language = 'en'

export function isLanguage(v: unknown): v is Language {
  return LANGUAGES.some((l) => l.code === v)
}

/** Picks the UI language: the saved preference, else the system locale (e.g. "tr-TR" → tr), else English. */
export function resolveLanguage(pref: string | null | undefined, systemLocale: string | null | undefined): Language {
  if (pref && pref !== 'auto' && isLanguage(pref)) return pref
  const base = (systemLocale ?? '').toLowerCase().split(/[-_]/)[0]
  return isLanguage(base) ? base : FALLBACK_LANGUAGE
}

/** BCP 47 tag for Intl / toLocaleString (dates, numbers). */
export function intlLocale(lng: string): string {
  return LANGUAGES.find((l) => l.code === lng)?.intl ?? 'en-US'
}

export function languageName(lng: string): string {
  return LANGUAGES.find((l) => l.code === lng)?.name ?? lng
}

let active: I18n | null = null

/**
 * Translate from code in `src/shared/` (it runs in main and in the renderer): uses the instance of whichever
 * process is running. Without one (e.g. the MCP helper process) the key itself is returned.
 */
export const ts = ((...args: unknown[]) =>
  active ? (active.t as unknown as (...a: unknown[]) => string)(...args) : String(args[0])) as unknown as I18n["t"]

/** New, synchronously initialized i18next instance (all resources are bundled, nothing is loaded lazily). */
export function createI18n(lng: Language, plugins: Parameters<I18n['use']>[0][] = []): I18n {
  const inst = i18next.createInstance()
  for (const p of plugins) inst.use(p)
  void inst.init({
    resources,
    lng,
    fallbackLng: FALLBACK_LANGUAGE,
    supportedLngs: LANGUAGES.map((l) => l.code),
    ns: [...NAMESPACES],
    defaultNS: 'common',
    interpolation: { escapeValue: false },
    returnNull: false,
    initAsync: false
  })
  active = inst
  return inst
}
