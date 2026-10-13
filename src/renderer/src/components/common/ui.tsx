import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/format'

export function ProgressBar({ value, className, tone = 'emerald' }: { value: number; className?: string; tone?: 'emerald' | 'indigo' | 'violet' | 'amber' }) {
  const tones = {
    emerald: 'from-emerald-500 to-emerald-300',
    indigo: 'from-indigo-500 to-indigo-300',
    violet: 'from-violet-500 to-violet-300',
    amber: 'from-amber-500 to-amber-300'
  }
  return (
    <div className={cn('h-1 w-full overflow-hidden rounded-full bg-white/[0.06]', className)}>
      <div
        className={cn('h-full rounded-full bg-gradient-to-r transition-[width] duration-500 ease-out', tones[tone])}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  )
}

export function Toggle({ checked, onChange, disabled, size = 'md' }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; size?: 'sm' | 'md' }) {
  const sm = size === 'sm'
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex shrink-0 items-center rounded-full transition-colors duration-150 disabled:opacity-40',
        sm ? 'h-4 w-7' : 'h-5 w-9',
        checked ? 'bg-accent' : 'bg-zinc-700'
      )}
    >
      <span
        className={cn(
          'inline-block rounded-full bg-white shadow transition-transform duration-150',
          sm ? 'h-3 w-3' : 'h-4 w-4',
          checked ? (sm ? 'translate-x-3.5' : 'translate-x-[18px]') : 'translate-x-0.5'
        )}
      />
    </button>
  )
}

export function Modal({ open, onClose, title, children, width = 520, footer }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; width?: number; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px] animate-fade-in" onMouseDown={onClose}>
      <div className="card shadow-pop flex max-h-[85vh] flex-col" style={{ width }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div className="text-[14px] font-semibold text-zinc-100">{title}</div>
          <button className="icon-btn" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-4 py-3">{footer}</div>}
      </div>
    </div>
  )
}

export function Empty({ icon, title, hint, action }: { icon: ReactNode; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-surface-2 text-zinc-400">{icon}</div>
      <div className="text-[13px] font-medium text-zinc-300">{title}</div>
      {hint && <div className="max-w-xs text-[12px] text-zinc-400">{hint}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function Badge({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded px-1.5 py-px text-[10.5px] font-medium ring-1 ring-inset', className)}>
      {children}
    </span>
  )
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-md border border-line bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'h-6 rounded px-2 text-[11.5px] font-medium transition-colors',
            value === o.value ? 'bg-white/10 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
