// Type-checked translation keys: `t('org:templates.title')` fails to compile if the key is not in the English files.
// `defaultNS` is the namespace list (common first) so `useTranslation()` accepts both `'actions.save'` (common)
// and `'ns:key'` for every other namespace; at runtime the default namespace is 'common'.
import 'i18next'
import type { en, NAMESPACES } from './locales'

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: typeof NAMESPACES
    resources: typeof en
    returnNull: false
  }
}
