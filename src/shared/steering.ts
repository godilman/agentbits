import { ts } from './i18n'
import type { ProviderKind, SteeringCapability, UsageReporting } from './types'

/**
 * What a direct instruction does to a *running* agent, per provider. Shown in the
 * agent terminal so the UI never promises an interactive capability that does not exist.
 */
export function steeringFor(kind: ProviderKind): SteeringCapability {
  switch (kind) {
    case 'claude-cli':
      return { live: 'resume', label: ts('main:steering.resume') }
    case 'mock':
      return { live: 'simulated', label: ts('main:steering.simulated') }
    default:
      return { live: 'restart', label: ts('main:steering.restart') }
  }
}

/** How much token usage a provider reports. */
export function usageReportingFor(kind: ProviderKind): UsageReporting {
  switch (kind) {
    case 'claude-cli':
    case 'anthropic':
    case 'openai':
      return 'full'
    case 'codex-cli':
      return 'partial'
    case 'mock':
      return 'simulated'
    default:
      return 'none'
  }
}

/** Labels in the current UI language (getters: read at render time). */
export const USAGE_REPORTING_LABEL: Record<UsageReporting, string> = {
  get full() {
    return ts('main:usageReporting.full')
  },
  get partial() {
    return ts('main:usageReporting.partial')
  },
  get none() {
    return ts('main:usageReporting.none')
  },
  get simulated() {
    return ts('main:usageReporting.simulated')
  }
}
