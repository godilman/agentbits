/** Graph memory helpers shared by main and tests (pure). `tests/memoryGraph.test.ts`. */
import { hiddenBlockBodies } from './replyStream.ts'

/** Short reference of a memory in prompts ("m:3fa9c1"), so an agent can say which one a new memory replaces. */
export function memoryRef(id: string): string {
  return 'm:' + id.replace(/-/g, '').slice(0, 6).toLowerCase()
}

export interface LearnedItem {
  text: string
  kind: 'preference' | 'fact'
  topics: string[]
  /** memoryRef of the memory this one replaces. */
  replaces: string | null
}

/**
 * ```learn blocks of an agent's chat reply: what it learned from the user's message. Malformed items are dropped;
 * at most 5 items, 500 characters each, 5 topics of 60 characters.
 */
export function parseLearn(text: string): LearnedItem[] {
  const out: LearnedItem[] = []
  for (const body of hiddenBlockBodies(text, 'learn')) {
    let v: unknown
    try {
      v = JSON.parse(body)
    } catch {
      continue
    }
    for (const it of Array.isArray(v) ? v : [v]) {
      if (!it || typeof it !== 'object') continue
      const o = it as { text?: unknown; kind?: unknown; topics?: unknown; replaces?: unknown }
      const body = typeof o.text === 'string' ? o.text.trim() : ''
      if (!body || body.length > 500) continue
      out.push({
        text: body,
        kind: o.kind === 'fact' ? 'fact' : 'preference',
        topics: Array.isArray(o.topics) ? o.topics.filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.trim().slice(0, 60)).slice(0, 5) : [],
        replaces: typeof o.replaces === 'string' && /^m:[0-9a-f]{6}$/.test(o.replaces.trim()) ? o.replaces.trim() : null
      })
    }
  }
  return out.slice(0, 5)
}
