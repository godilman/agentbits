import { useEffect, useRef, type RefObject } from 'react'

/**
 * Overlays (dialogs, side panels, popovers) as a stack: Escape closes only the top one, and closing gives focus back to
 * what opened it. `trap`: Tab stays inside (a modal dialog) and focus moves into it on open.
 * The stack follows what is painted on top (z-index), not only the opening order: a layer opened under an open dialog
 * (F1 while Settings is open, the guide turning into an overlay) doesn't take its focus or its Escape.
 * Tests: `tests/renderer/layer.test.ts`.
 */
type Layer = { close: () => void; z: number; el: HTMLElement | null; trap: boolean; opener: HTMLElement | null }
const stack: Layer[] = []

window.addEventListener(
  'keydown',
  (e) => {
    if (e.key !== 'Escape' || !stack.length) return
    e.preventDefault()
    e.stopImmediatePropagation()
    stack[stack.length - 1].close()
  },
  true
)

// The element focused before the current one: a dialog's autoFocus field takes focus before its layer is set up, so the
// opener is the one before that.
let current: HTMLElement | null = null
let previous: HTMLElement | null = null
document.addEventListener(
  'focusin',
  (e) => {
    previous = current
    current = e.target as HTMLElement
  },
  true
)

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
const focusInto = (el: HTMLElement): void => (el.querySelector<HTMLElement>(FOCUSABLE) ?? el).focus()

/** Paint order at the root: the outermost z-index above the element (a popover inside the z-40 top bar paints at 40). */
function levelOf(el: HTMLElement | null): number {
  let z = 0
  for (let e = el; e; e = e.parentElement) {
    const v = getComputedStyle(e).zIndex
    if (v !== 'auto') z = Number(v) || 0
  }
  return z
}

/** Registers an open layer; the returned function unregisters it (when it closes or stops being a layer). */
export function openLayer(el: HTMLElement | null, onClose: () => void, trap: boolean): () => void {
  const opener = el && el.contains(document.activeElement) ? previous : (document.activeElement as HTMLElement | null)
  const layer: Layer = { close: onClose, z: levelOf(el), el, trap, opener }
  let at = stack.length
  while (at > 0 && stack[at - 1].z > layer.z) at--
  stack.splice(at, 0, layer)
  const isTop = (): boolean => stack[stack.length - 1] === layer
  // Into the dialog, unless something inside already took focus (an autoFocus field) or a dialog is open above it.
  if (trap && el && isTop() && !el.contains(document.activeElement)) focusInto(el)
  const onTab = (e: KeyboardEvent): void => {
    if (!trap || e.key !== 'Tab' || !isTop() || !el) return
    const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null)
    if (!items.length) return e.preventDefault()
    const first = items[0]
    const last = items[items.length - 1]
    if (e.shiftKey && (document.activeElement === first || !el.contains(document.activeElement))) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && (document.activeElement === last || !el.contains(document.activeElement))) {
      e.preventDefault()
      first.focus()
    }
  }
  window.addEventListener('keydown', onTab)
  return () => {
    window.removeEventListener('keydown', onTab)
    const wasTop = isTop()
    const i = stack.indexOf(layer)
    if (i >= 0) stack.splice(i, 1)
    if (!wasTop) {
      // A layer under another one leaves the focus where it is. A layer above it that was opened from inside it
      // (a confirm dialog in Settings) gets its opener instead — both may be closing at once (a notification click).
      // Only when it really left the page (not the guide merely turning back into a side panel).
      if (el && !el.isConnected) for (const above of stack.slice(i)) if (above.opener && el.contains(above.opener)) above.opener = layer.opener
      return
    }
    // Not when the layer is still on screen with focus in it (it only stopped being a layer, e.g. the guide moving
    // beside the content).
    const { opener } = layer
    if (opener?.isConnected && !(el?.isConnected && el.contains(document.activeElement))) opener.focus()
    // A dialog now on top (one that opened under this one) gets the focus if it doesn't have it.
    const next = stack[stack.length - 1]
    if (next?.trap && next.el && !next.el.contains(document.activeElement)) focusInto(next.el)
  }
}

export function useLayer(open: boolean, onClose: () => void, ref: RefObject<HTMLElement | null>, { trap = false }: { trap?: boolean } = {}): void {
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => (open ? openLayer(ref.current, () => closeRef.current(), trap) : undefined), [open, ref, trap])
}
