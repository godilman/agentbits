/**
 * Runs `fn` so that aborting `signal` drops its connection (`onAbort` registers how) and rejects at once
 * (security review #08: a stopped run must not keep a query or command running for its whole timeout).
 * An open transaction dies with the dropped connection, so the server rolls it back. `tests/cancel.test.ts`.
 */
export async function cancellable<T>(
  signal: AbortSignal | undefined,
  fn: (onAbort: (drop: () => void) => void) => Promise<T>,
  cancelled: () => Error
): Promise<T> {
  if (signal?.aborted) throw cancelled()
  const drops: (() => void)[] = []
  let stop: (() => void) | null = null
  const onSignal = (): void => {
    for (const d of drops.splice(0)) {
      try {
        d()
      } catch {
        /* already closed */
      }
    }
    stop?.()
  }
  signal?.addEventListener('abort', onSignal, { once: true })
  try {
    const work = fn((d) => {
      if (signal?.aborted) d()
      else drops.push(d)
    })
    if (!signal) return await work
    work.catch(() => undefined) // its error after an abort is not interesting any more
    return await Promise.race([work, new Promise<never>((_, reject) => (stop = () => reject(cancelled())))])
  } finally {
    signal?.removeEventListener('abort', onSignal)
  }
}
