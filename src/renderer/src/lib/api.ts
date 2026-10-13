import type { ApiArgs, ApiMethod, ApiResult } from '@shared/ipc'

/** Typed call into the main process. */
export function call<M extends ApiMethod>(method: M, ...args: ApiArgs<M>): Promise<Awaited<ApiResult<M>>> {
  return window.agentbits.invoke(method, ...args)
}

/** Human readable message of a rejected `call()` (strips Electron's "Error invoking remote method" prefix). */
export function apiError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.replace(/^Error invoking remote method '[^']*':\s*/, '').replace(/^Error:\s*/, '')
}

export const bridge =(): typeof window.agentbits => window.agentbits
