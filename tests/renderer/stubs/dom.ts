// A tiny DOM for tests that need focus, z-index and key events (imported first, instead of ./window).
type Listener = { fn: (e: any) => void; capture: boolean }
const on = (list: Map<string, Listener[]>) => (type: string, fn: (e: any) => void, capture = false): void => {
  list.set(type, [...(list.get(type) ?? []), { fn, capture: !!capture }])
}
const off = (list: Map<string, Listener[]>) => (type: string, fn: (e: any) => void): void => {
  list.set(type, (list.get(type) ?? []).filter((l) => l.fn !== fn))
}
const winListeners = new Map<string, Listener[]>()
const docListeners = new Map<string, Listener[]>()

export class El {
  parentElement: El | null = null
  kids: El[] = []
  connected = true
  constructor(
    public name: string,
    public z = 'auto',
    public focusable = false
  ) {}
  add(...kids: El[]): this {
    for (const k of kids) {
      k.parentElement = this
      this.kids.push(k)
    }
    return this
  }
  contains(o: unknown): boolean {
    for (let e = o as El | null; e; e = e.parentElement) if (e === this) return true
    return false
  }
  get isConnected(): boolean {
    for (let e: El | null = this; e; e = e.parentElement) if (!e.connected) return false
    return true
  }
  get offsetParent(): object | null {
    return this.isConnected ? {} : null
  }
  querySelectorAll(): El[] {
    return this.kids.flatMap((k) => [...(k.focusable ? [k] : []), ...k.querySelectorAll()])
  }
  querySelector(): El | null {
    return this.querySelectorAll()[0] ?? null
  }
  focus(): void {
    ;(globalThis as any).document.activeElement = this
    for (const l of docListeners.get('focusin') ?? []) l.fn({ target: this })
  }
}

;(globalThis as any).window = { addEventListener: on(winListeners), removeEventListener: off(winListeners) }
;(globalThis as any).document = { activeElement: null, addEventListener: on(docListeners), removeEventListener: off(docListeners) }
;(globalThis as any).getComputedStyle = (e: El) => ({ zIndex: e.z })

/** A key press as the browser delivers it: capture listeners first; stopImmediatePropagation stops the rest. */
export function press(key: string, shiftKey = false): void {
  let stopped = false
  const e = { key, shiftKey, preventDefault: () => undefined, stopImmediatePropagation: () => (stopped = true) }
  const ls = winListeners.get('keydown') ?? []
  for (const l of [...ls.filter((x) => x.capture), ...ls.filter((x) => !x.capture)]) {
    if (stopped) break
    l.fn(e)
  }
}
export const active = (): El | null => (globalThis as any).document.activeElement
