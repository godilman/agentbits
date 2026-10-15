import type { Provider, ProviderTestResult } from '@shared/types'
import { AbortedError, cutShort, readSse, type ProviderAdapter, type RunContext, type RunResult } from './types'

/** One model request (streamed) may take at most this long. */
const REQUEST_TIMEOUT_MS = 10 * 60_000
import { t } from '../i18n'

const API = 'https://api.anthropic.com/v1/messages'

function headers(apiKey: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01'
  }
}

async function errorText(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { error?: { message?: string } }
    return j.error?.message ?? res.statusText
  } catch {
    return res.statusText
  }
}

const MAX_TOOL_ROUNDS = 16

/* eslint-disable @typescript-eslint/no-explicit-any */
export const anthropicAdapter: ProviderAdapter = {
  async run(ctx: RunContext): Promise<RunResult> {
    if (!ctx.apiKey) throw new Error(t('orchestrator:providers.anthropicKeyMissing'))
    const tools = ctx.callTool && ctx.tools?.length ? ctx.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema })) : undefined
    const messages: any[] = [...(ctx.history ?? []), { role: 'user', content: ctx.prompt }]
    // Images / scanned PDFs go into the first user turn (the original task prompt).
    if (ctx.attachments?.length) {
      const first = messages.find((m) => m.role === 'user')
      first.content = [
        ...ctx.attachments.map((a) =>
          a.kind === 'pdf'
            ? { type: 'document', title: a.name, source: { type: 'base64', media_type: 'application/pdf', data: a.data } }
            : { type: 'image', source: { type: 'base64', media_type: a.mime, data: a.data } }
        ),
        { type: 'text', text: String(first.content) }
      ]
    }
    let text = ''
    let totalIn = 0
    let totalOut = 0

    // Native tool use: the model may call connection tools; results go back as tool_result blocks.
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const res = await fetch(API, {
        method: 'POST',
        headers: headers(ctx.apiKey),
        // A request that never answers can't hold the agent forever (stop still cancels it at once).
        signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
        body: JSON.stringify({
          model: ctx.model,
          max_tokens: ctx.mode === 'task' ? 8000 : 2000,
          system: ctx.system,
          stream: true,
          messages,
          ...(tools ? { tools } : {})
        })
      }).catch((e) => {
        if (ctx.signal.aborted) throw new AbortedError()
        throw e
      })
      if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await errorText(res)}`)

      let tokensIn = 0
      let tokensOut = 0
      let cacheRead = 0
      let cacheWrite = 0
      let stop = ''
      const blocks: any[] = []
      for await (const ev of readSse(res, ctx.signal)) {
        await ctx.checkpoint()
        const type = ev.type as string
        if (type === 'message_start') {
          const usage = (ev.message as any)?.usage
          tokensIn = usage?.input_tokens ?? 0
          cacheRead = usage?.cache_read_input_tokens ?? 0
          cacheWrite = usage?.cache_creation_input_tokens ?? 0
        } else if (type === 'content_block_start') {
          const b = ev.content_block as any
          blocks[ev.index as number] = b.type === 'tool_use' ? { ...b, _json: '' } : { ...b, text: b.text ?? '' }
        } else if (type === 'content_block_delta') {
          const delta = ev.delta as any
          const b = blocks[ev.index as number]
          if (delta.type === 'text_delta' && delta.text) {
            if (b) b.text += delta.text
            text += delta.text
            ctx.onText(delta.text)
          } else if (delta.type === 'input_json_delta' && b) {
            b._json += delta.partial_json ?? ''
          }
        } else if (type === 'message_delta') {
          tokensOut = (ev.usage as any)?.output_tokens ?? tokensOut
          stop = (ev.delta as any)?.stop_reason ?? stop
        } else if (type === 'error') {
          throw new Error(`Anthropic: ${(ev.error as any)?.message ?? 'stream error'}`)
        }
      }
      // No stop_reason: the connection dropped mid-answer — a cut-off reply must not count as finished work.
      if (!stop) throw new Error(t('orchestrator:providers.streamIncomplete', { provider: 'Anthropic' }))
      ctx.onUsage?.({ input: tokensIn, output: tokensOut, cacheRead, cacheWrite, costUsd: 0 })
      totalIn += tokensIn + cacheRead + cacheWrite
      totalOut += tokensOut
      // Stopped by the output token limit: the answer is unfinished.
      if (stop === 'max_tokens') text += cutShort(ctx, t('orchestrator:providers.tokenLimit', { provider: 'Anthropic' }))

      const calls = blocks.filter((b) => b?.type === 'tool_use')
      if (stop !== 'tool_use' || !calls.length || !ctx.callTool) break
      if (round === MAX_TOOL_ROUNDS) {
        text += cutShort(ctx, t('orchestrator:providers.toolRoundLimit', { max: MAX_TOOL_ROUNDS }))
        break
      }
      const content = blocks
        .filter(Boolean)
        .map((b) => (b.type === 'tool_use' ? { type: 'tool_use', id: b.id, name: b.name, input: safeJson(b._json) } : { type: 'text', text: b.text }))
        .filter((b) => b.type !== 'text' || b.text)
      messages.push({ role: 'assistant', content })
      const results: any[] = []
      for (const c of calls) {
        await ctx.checkpoint()
        const out = await ctx.callTool(c.name, safeJson(c._json))
        const images = (out.images ?? []).map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.mime, data: i.data } }))
        results.push({ type: 'tool_result', tool_use_id: c.id, content: images.length ? [{ type: 'text', text: out.text }, ...images] : out.text, is_error: out.isError })
      }
      messages.push({ role: 'user', content: results })
      text += '\n'
    }
    return { text: text.trim(), tokensIn: totalIn, tokensOut: totalOut, costUsd: 0 }
  },

  async test(provider: Provider, apiKey: string | null): Promise<ProviderTestResult> {
    if (!apiKey) return { ok: false, message: t('orchestrator:providers.apiKeyMissing') }
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: headers(apiKey),
        body: JSON.stringify({ model: provider.model, max_tokens: 8, messages: [{ role: 'user', content: 'ping' }] }),
        signal: AbortSignal.timeout(20_000)
      })
      if (!res.ok) return { ok: false, message: `${res.status}: ${await errorText(res)}` }
      return { ok: true, message: t('orchestrator:providers.connectionOk', { model: provider.model }) }
    } catch (e) {
      return { ok: false, message: (e as Error).message }
    }
  }
}

function safeJson(s: string): Record<string, unknown> {
  try {
    return s ? (JSON.parse(s) as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}
