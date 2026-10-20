// Test stand-in for '@/i18n': the key and its values, so a test can see which text was shown.
export const t = (key: string, vars?: Record<string, unknown>): string => (vars ? `${key} ${JSON.stringify(vars)}` : key)
export const locale = (): string => 'en-US'
