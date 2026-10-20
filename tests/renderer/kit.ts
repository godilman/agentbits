// Shared helpers for the renderer tests (real modules, fake IPC).
import { fake } from './stubs/api'
export { fake }
export const P = 'p1'
export const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
/** A deferred result: `promise` resolves when the test says so (a slow IPC answer). */
export function later<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: Error) => void } {
  let resolve!: (v: T) => void
  let reject!: (e: Error) => void
  const promise = new Promise<T>((a, b) => ((resolve = a), (reject = b)))
  return { promise, resolve, reject }
}
/** What was saved for a draft, in order (`drafts:save` payloads). */
export const saves = (channel = 'general'): { text: string; files: { id: string }[] }[] =>
  fake.calls.filter((c) => c.name === 'drafts:save' && c.args[0].channel === channel).map((c) => c.args[0])
export const F = (id: string): { id: string; name: string; size: number } => ({ id, name: `${id}.txt`, size: 1 })
let n = 0
export async function step(name: string, fn: () => Promise<void> | void): Promise<void> {
  await fn()
  n++
  console.log(`  ✓ ${name}`)
}
export const done = (file: string): void => console.log(`${file}: ${n} ok`)
