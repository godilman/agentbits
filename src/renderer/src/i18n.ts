/**
 * Renderer translations. Components: `const { t } = useTranslation()` (react-i18next) — re-renders on
 * language change. Outside components (store actions, helpers): `t` from this module.
 */
import { initReactI18next } from 'react-i18next'
import { createI18n, intlLocale, resolveLanguage, type Language } from '@shared/i18n'

export const i18n = createI18n(resolveLanguage('auto', navigator.language), [initReactI18next])

export const t = i18n.t.bind(i18n) as typeof i18n.t

/** Current BCP 47 locale for dates and numbers, e.g. `n.toLocaleString(locale())`. */
export function locale(): string {
  return intlLocale(i18n.language)
}

export function setLanguage(pref: string | null | undefined): Language {
  const lng = resolveLanguage(pref, navigator.language)
  if (i18n.language !== lng) void i18n.changeLanguage(lng)
  document.documentElement.lang = lng
  return lng
}
