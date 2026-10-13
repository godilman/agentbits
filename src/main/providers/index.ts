import type { ProviderKind } from '@shared/types'
import { anthropicAdapter } from './anthropic'
import { claudeCliAdapter } from './claudeCli'
import { codexCliAdapter } from './codexCli'
import { mockAdapter } from './mock'
import { openaiAdapter } from './openai'
import type { ProviderAdapter } from './types'

const ADAPTERS: Record<ProviderKind, ProviderAdapter> = {
  anthropic: anthropicAdapter,
  openai: openaiAdapter,
  'claude-cli': claudeCliAdapter,
  'codex-cli': codexCliAdapter,
  mock: mockAdapter
}

export function getAdapter(kind: ProviderKind): ProviderAdapter {
  return ADAPTERS[kind]
}

/** Providers that can actually touch the file system / terminal. */
export function canAct(kind: ProviderKind): boolean {
  return kind === 'claude-cli' || kind === 'codex-cli' || kind === 'mock'
}

export * from './types'
