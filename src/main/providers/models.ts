import type { ProviderKind } from '@shared/types'
import { isOpenAiChatModel } from '@shared/models'
import { cleanModelId, isLocalUrl } from '@shared/endpoints'
import { t } from '../i18n'

/** Live model list of an API account (Anthropic / OpenAI). Errors come back as text; the UI falls back to the catalog. */
export async function fetchLiveModels(
  kind: ProviderKind,
  apiKey: string | null,
  baseUrl = ''
): Promise<{ live: { id: string; label: string }[] | null; error?: string }> {
  if (kind !== 'anthropic' && kind !== 'openai') return { live: null }
  // A local OpenAI-compatible server (Ollama, LM Studio) usually needs no key.
  if (!apiKey && !(kind === 'openai' && baseUrl && isLocalUrl(baseUrl))) return { live: null, error: t('orchestrator:providers.apiKeyMissing') }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 10_000)
  try {
    if (kind === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/models?limit=100', {
        headers: { 'x-api-key': apiKey ?? '', 'anthropic-version': '2023-06-01' },
        signal: ctrl.signal
      })
      if (!res.ok) return { live: null, error: `${res.status} ${res.statusText}` }
      const body = (await res.json()) as { data?: { id: string; display_name?: string }[] }
      return { live: (body.data ?? []).map((m) => ({ id: m.id, label: m.display_name || m.id })) }
    }
    const res = await fetch(`${baseUrl || 'https://api.openai.com/v1'}/models`, {
      headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
      signal: ctrl.signal
    })
    if (!res.ok) return { live: null, error: `${res.status} ${res.statusText}` }
    const body = (await res.json()) as { data?: { id: string }[] }
    // OpenAI lists embeddings, audio… too; a compatible server lists what it serves.
    const ids = (body.data ?? []).map((m) => cleanModelId(m.id)).filter((id) => (baseUrl ? !!id : isOpenAiChatModel(id)))
    ids.sort((a, b) => b.localeCompare(a, 'en', { numeric: true }))
    return { live: ids.map((id) => ({ id, label: id })) }
  } catch (e) {
    return { live: null, error: (e as Error).name === 'AbortError' ? t('main:errors.modelsTimeout') : (e as Error).message }
  } finally {
    clearTimeout(timer)
  }
}
