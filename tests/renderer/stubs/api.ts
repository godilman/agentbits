// Test stand-in for '@/lib/api': calls go to the handlers the test sets; every call is recorded.
type Handler = (...args: any[]) => unknown
export const fake: { handlers: Record<string, Handler>; calls: { name: string; args: any[] }[] } = { handlers: {}, calls: [] }
export async function call(name: string, ...args: any[]): Promise<any> {
  fake.calls.push({ name, args })
  const h = fake.handlers[name]
  if (!h) throw new Error(`no fake for ${name}`)
  return h(...args)
}
export const apiError = (e: unknown): string => (e instanceof Error ? e.message : String(e))
