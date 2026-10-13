import type { ProviderKind } from './types'

/**
 * Model choices offered in the provider form and the agent editor (a dropdown instead of a free-text field, so model
 * names can't be mistyped). The catalog is the curated, known-good list; for the API providers main also fetches the
 * account's live list (`providers:models`), and "Custom model name…" stays available for anything newer.
 * Labels are product names (not translated); `note` → `settings:models.notes.<note>`.
 *
 * Checked 2026-10-13 against the Anthropic, Claude Code, OpenAI and Codex model docs — update when models change.
 */
export interface ModelOption {
  /** Exact value passed to the provider ('' = let the CLI pick its own default). */
  id: string
  label: string
  note?: string
}

export const MODEL_CATALOG: Record<ProviderKind, ModelOption[]> = {
  // Claude Code aliases always resolve to the newest model of that family for the account.
  'claude-cli': [
    { id: 'sonnet', label: 'Sonnet (Claude Sonnet 5.5)', note: 'balanced' },
    { id: 'opus', label: 'Opus (Claude Opus 5.5)', note: 'complex' },
    { id: 'haiku', label: 'Haiku (Claude Haiku 5.5)', note: 'fast' },
    { id: 'fable', label: 'Fable (Claude Fable 5.1)', note: 'hardest' },
    { id: 'opusplan', label: 'Opus plan + Sonnet', note: 'opusplan' },
    { id: '', label: 'Claude Code', note: 'cliDefault' }
  ],
  anthropic: [
    { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', note: 'balanced' },
    { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', note: 'complex' },
    { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', note: 'fast' },
    { id: 'claude-fable-5-1', label: 'Claude Fable 5.1', note: 'hardest' }
  ],
  // Agentbits calls OpenAI through Chat Completions with function calling; GPT-6 models don't support tool calls
  // there (Responses API only), so they are left out of this list and of the live list (see OPENAI_NO_TOOLS).
  openai: [
    { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', note: 'balanced' },
    { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', note: 'complex' },
    { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', note: 'fast' },
    { id: 'gpt-5', label: 'GPT-5', note: 'previous' }
  ],
  'codex-cli': [
    { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', note: 'codexRecommended' },
    { id: 'gpt-6-astra', label: 'GPT-6 Astra', note: 'mostCapable' },
    { id: 'gpt-6-luna', label: 'GPT-6 Luna', note: 'focused' },
    { id: '', label: 'Codex', note: 'cliDefault' }
  ],
  mock: [{ id: 'simulated', label: 'Demo', note: 'simulated' }]
}

/** Model a new provider of this kind starts with. */
export const DEFAULT_MODEL: Record<ProviderKind, string> = {
  'claude-cli': 'sonnet',
  anthropic: 'claude-sonnet-5-5',
  openai: 'gpt-5.6-terra',
  'codex-cli': '',
  mock: 'simulated'
}

/** Kinds whose account model list main can fetch live (needs the API key). */
export const LIVE_MODEL_KINDS: ProviderKind[] = ['anthropic', 'openai']

/** OpenAI models that can't call tools through Chat Completions (Agentbits' OpenAI adapter). */
export const OPENAI_NO_TOOLS = /^gpt-6/

/** Keeps text/chat models from an OpenAI `/v1/models` listing (drops image, audio, embeddings, …). */
export function isOpenAiChatModel(id: string): boolean {
  if (!/^(gpt-|o\d|chatgpt-)/.test(id)) return false
  if (OPENAI_NO_TOOLS.test(id)) return false
  return !/(image|audio|realtime|transcribe|tts|search|embedding|moderation|whisper|dall-e|live|instruct|chat-latest|codex|-\d{4}-\d{2}-\d{2}$)/.test(id)
}
