import { useEffect, useRef, useState, type ReactElement, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/format'

interface Opts {
  min: number
  max: number
  /** 'x' resizes a width, 'y' a height. */
  axis?: 'x' | 'y'
  /** The panel grows when the handle moves left / up (it sits on the panel's left / top edge). */
  invert?: boolean
  /** Drag starts from this element's rendered size (a max-height panel may be shorter than its limit). */
  measure?: RefObject<HTMLElement | null>
  /** Positions the handle; by default it is a zero-size sibling between two panels. */
  className?: string
}

/** A panel size the user drags (and the keyboard arrows move), kept per panel; double-click resets it. */
export function useResize(key: string, def: number, { min, max, axis = 'x', invert = false, measure, className }: Opts): [number, ReactElement] {
  const { t } = useTranslation()
  const lsKey = `agentbits:size:${key}`
  const clamp = (v: number): number => Math.round(Math.min(max, Math.max(min, v)))
  const [size, setSize] = useState(() => {
    try {
      const v = Number(localStorage.getItem(lsKey))
      return v ? clamp(v) : def
    } catch {
      return def
    }
  })
  const first = useRef(true)
  useEffect(() => {
    if (first.current) return void (first.current = false)
    try {
      localStorage.setItem(lsKey, String(size))
    } catch {
      /* storage unavailable */
    }
  }, [lsKey, size])

  const current = (): number => {
    const r = measure?.current?.getBoundingClientRect()
    return r ? Math.min(size, axis === 'x' ? r.width : r.height) : size
  }
  const onPointerDown = (e: React.PointerEvent): void => {
    if (e.button !== 0) return
    e.preventDefault()
    const start = axis === 'x' ? e.clientX : e.clientY
    const from = current()
    const move = (ev: PointerEvent): void => {
      const d = (axis === 'x' ? ev.clientX : ev.clientY) - start
      setSize(clamp(from + (invert ? -d : d)))
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up, { once: true })
    document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'
  }
  const onKeyDown = (e: React.KeyboardEvent): void => {
    const keys = axis === 'x' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown']
    const i = keys.indexOf(e.key)
    if (i < 0) return
    e.preventDefault()
    const d = (i === 1 ? 16 : -16) * (invert ? -1 : 1)
    setSize(clamp(current() + d))
  }

  const handle = (
    <div className={cn('z-20 shrink-0', axis === 'x' ? 'w-0' : 'h-0', className ?? 'relative')}>
      <div
        role="separator"
        aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
        aria-valuenow={size}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-label={t('common:resize')}
        title={t('common:resize')}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
        onDoubleClick={() => setSize(clamp(def))}
        className={cn(
          'absolute outline-none transition-colors hover:bg-accent/40 focus-visible:bg-accent/60',
          axis === 'x' ? 'inset-y-0 -left-[3px] w-[6px] cursor-col-resize' : 'inset-x-0 -top-[3px] h-[6px] cursor-row-resize'
        )}
      />
    </div>
  )
  return [size, handle]
}
