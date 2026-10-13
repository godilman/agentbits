/**
 * Main-process translations: errors shown to the user, toasts, notifications, default names, templates and
 * the Demo provider's texts. Follows `settings.language` (see `applyLanguageSetting`).
 */
import { app } from 'electron'
import { createI18n, resolveLanguage, type I18nKey, type Language } from '@shared/i18n'

const i18n = createI18n(resolveLanguage('auto', safeLocale()))

function safeLocale(): string {
  try {
    return app.getLocale()
  } catch {
    return ''
  }
}

/** Translate (same keys as the renderer; e.g. `t('main:errors.projectNotFound')`). */
export const t = i18n.t.bind(i18n) as typeof i18n.t

export function currentLanguage(): Language {
  return i18n.language as Language
}

/** Applies the saved preference ('auto' → system language). Returns the effective language. */
export function applyLanguageSetting(pref: string | null | undefined): Language {
  const lng = resolveLanguage(pref, safeLocale())
  if (i18n.language !== lng) void i18n.changeLanguage(lng)
  return lng
}

/** The same key in every language (used to recognise untouched default names). */
export function allTranslations(key: I18nKey): string[] {
  return (i18n.options.supportedLngs || []).filter((l) => l !== 'cimode').map((lng) => String(i18n.t(key, { lng })))
}
