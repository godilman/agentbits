import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { Agent, AgentPermissions } from '@shared/types'
import { cleanPromptOutput, PROMPT_BUILDER_ID, PROMPT_BUILDER_KINDS, PROMPT_BUILDER_MAX, promptBuilderPrompt, promptBuilderSystem } from '@shared/promptBuilder'
import { providersRepo } from '../db/repos'
import { usageRepo } from '../db/usage'
import { getAdapter } from '../providers'
import { t } from '../i18n'
import { explainError } from './orchestrator'

/**
 * The prompt builder's model call: only the given message (no history, project, memory, files, connections, apps or
 * tools), with the chosen provider's own model, in an empty temporary folder. The text and the answer are never written
 * anywhere (no log, no table, no file); only the token count goes to the usage table, without any text.
 */
const running = new Map<string, AbortController>()

const NO_PERMISSIONS: AgentPermissions = {
  agentId: PROMPT_BUILDER_ID,
  fsRead: false,
  fsWrite: false,
  terminal: false,
  network: false,
  browser: false,
  requireApproval: false,
  allowedPaths: [],
  updatedAt: ''
}

export async function generatePrompt(requestId: string, text: string, providerId?: string | null): Promise<{ prompt: string; provider: string; model: string }> {
  const message = String(text ?? '').trim()
  if (!message) throw new Error(t('main:promptBuilder.empty'))
  if (message.length > PROMPT_BUILDER_MAX) throw new Error(t('main:promptBuilder.tooLong', { max: PROMPT_BUILDER_MAX }))
  const provider = providerId ? providersRepo.get(providerId) : providersRepo.getDefault()
  if (!provider) throw new Error(t('main:promptBuilder.noProvider'))
  if (provider.kind === 'mock') throw new Error(t('main:promptBuilder.demo'))
  if (!PROMPT_BUILDER_KINDS.includes(provider.kind)) throw new Error(t('main:promptBuilder.codex', { provider: provider.label }))
  running.get(requestId)?.abort()
  const controller = new AbortController()
  running.set(requestId, controller)
  const cwd = mkdtempSync(join(tmpdir(), 'agentbits-prompt-'))
  const agent = { id: PROMPT_BUILDER_ID, name: 'Prompt builder', role: '', persona: '', jobDescription: '', skills: [], isLead: false, enabled: true } as unknown as Agent
  try {
    const result = await getAdapter(provider.kind).run({
      mode: 'chat',
      agent,
      permissions: NO_PERMISSIONS,
      provider,
      model: provider.model,
      apiKey: providersRepo.getApiKey(provider.id),
      cwd,
      system: promptBuilderSystem(),
      prompt: promptBuilderPrompt(message),
      signal: controller.signal,
      onText: () => undefined,
      onLog: () => undefined,
      onUsage: (usage) => {
        try {
          usageRepo.record({ agentId: PROMPT_BUILDER_ID, mode: 'chat', provider: provider.kind, model: provider.model, usage })
        } catch {
          /* counting must never fail the call */
        }
      },
      onProgress: () => undefined,
      checkpoint: async () => undefined
    })
    if (controller.signal.aborted) throw new Error(t('main:promptBuilder.cancelled'))
    const prompt = cleanPromptOutput(result.text)
    if (!prompt) throw new Error(t('main:promptBuilder.emptyAnswer'))
    return { prompt, provider: provider.label, model: provider.model }
  } catch (e) {
    if (controller.signal.aborted) throw new Error(t('main:promptBuilder.cancelled'))
    throw new Error(explainError((e as Error).message || String(e), provider).text)
  } finally {
    if (running.get(requestId) === controller) running.delete(requestId)
    rmSync(cwd, { recursive: true, force: true })
  }
}

export function cancelPrompt(requestId: string): void {
  running.get(requestId)?.abort()
  running.delete(requestId)
}

export function cancelAllPrompts(): void {
  for (const c of running.values()) c.abort()
  running.clear()
}
