/**
 * OpenAI-compatible endpoints for the OpenAI provider (`Provider.baseUrl`; empty = OpenAI itself). Gemini, Ollama and
 * LM Studio speak the Chat Completions API. An API key only goes over HTTPS or to this computer. `tests/endpoints.test.ts`.
 */
export type EndpointPreset = 'openai' | 'gemini' | 'ollama' | 'lmstudio' | 'custom'

export const ENDPOINTS: { id: EndpointPreset; url: string; needsKey: boolean; model: string }[] = [
  { id: 'openai', url: '', needsKey: true, model: '' },
  // https://github.com/google-gemini/cookbook → quickstarts/Get_started_OpenAI_Compatibility
  { id: 'gemini', url: 'https://generativelanguage.googleapis.com/v1beta/openai', needsKey: true, model: 'gemini-2.5-flash' },
  { id: 'ollama', url: 'http://127.0.0.1:11434/v1', needsKey: false, model: '' },
  { id: 'lmstudio', url: 'http://127.0.0.1:1234/v1', needsKey: false, model: '' },
  { id: 'custom', url: '', needsKey: false, model: '' }
]

const LOCAL_HOSTS = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])$/i

/** True for an address on this computer (no key or data leaves the machine). */
export function isLocalUrl(url: string): boolean {
  try {
    return LOCAL_HOSTS.test(new URL(url).hostname)
  } catch {
    return false
  }
}

/** Normalised base URL (no trailing slash), or why it is refused. Empty = OpenAI. */
export function checkBaseUrl(raw: string): { ok: true; url: string } | { ok: false; reason: 'invalid' | 'insecure' } {
  const s = raw.trim()
  if (!s) return { ok: true, url: '' }
  let u: URL
  try {
    u = new URL(s)
  } catch {
    return { ok: false, reason: 'invalid' }
  }
  if (u.username || u.password || u.search || u.hash) return { ok: false, reason: 'invalid' }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false, reason: 'invalid' }
  if (u.protocol === 'http:' && !LOCAL_HOSTS.test(u.hostname)) return { ok: false, reason: 'insecure' }
  return { ok: true, url: `${u.origin}${u.pathname}`.replace(/\/+$/, '') }
}

/** Which preset a stored base URL belongs to (for the provider form). */
export function presetOf(baseUrl: string): EndpointPreset {
  if (!baseUrl) return 'openai'
  return ENDPOINTS.find((e) => e.url && e.url === baseUrl.replace(/\/+$/, ''))?.id ?? 'custom'
}

/** Model ids from a /models listing: Gemini prefixes them with "models/". */
export const cleanModelId = (id: string): string => id.replace(/^models\//, '')
