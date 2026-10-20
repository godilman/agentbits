import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { Check, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/format'
import { addTags } from './constants'

/** A titled card used for each block of the agent profile. */
export function Section({
  icon: Icon,
  title,
  desc,
  action,
  children,
  className
}: {
  icon: ComponentType<{ size?: number; className?: string }>
  title: string
  desc?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('card scroll-mt-24', className)}>
      <header className="flex items-start gap-3 border-b border-line-soft px-5 py-3.5">
        <div className="mt-px flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line bg-surface-2 text-zinc-400">
          <Icon size={14} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-semibold text-zinc-100">{title}</h3>
          {desc && <p className="mt-0.5 text-[12px] text-zinc-400">{desc}</p>}
        </div>
        {action}
      </header>
      <div className="p-5">{children}</div>
    </section>
  )
}

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="label">{label}</label>
      {children}
      {hint && <div className="mt-1 text-[11px] text-zinc-400">{hint}</div>}
    </div>
  )
}

export function Swatches({ label, colors, value, onPick }: { label: string; colors: string[]; value: string; onPick: (c: string) => void }) {
  return (
    <div className="flex items-center gap-3">
      <span className="min-w-14 shrink-0 text-[12px] text-zinc-400">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {colors.map((c) => (
          <button
            key={c}
            type="button"
            title={c}
            onClick={() => onPick(c)}
            className={cn(
              'h-5 w-5 rounded-[5px] ring-offset-2 ring-offset-surface transition-transform hover:scale-110',
              value === c ? 'ring-2 ring-indigo-400' : 'ring-1 ring-inset ring-white/10'
            )}
            style={{ background: c }}
          />
        ))}
      </div>
    </div>
  )
}

/** Chip input: Enter or comma adds a tag, × or Backspace (on empty input) removes one. */
export function TagInput({
  value,
  onChange,
  placeholder,
  autoCommitOnBlur = true
}: {
  value: string[]
  onChange: (tags: string[]) => void
  placeholder?: string
  autoCommitOnBlur?: boolean
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState('')
  const commit = (raw: string): void => {
    const next = addTags(value, raw)
    if (next.length !== value.length) onChange(next)
    setDraft('')
  }
  return (
    <div
      className="flex min-h-8 w-full cursor-text flex-wrap items-center gap-1.5 rounded-md border border-line bg-surface-2 px-1.5 py-1 transition-colors focus-within:border-accent-soft focus-within:ring-2 focus-within:ring-accent/15"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          e.preventDefault()
          ;(e.currentTarget.querySelector('input') as HTMLInputElement | null)?.focus()
        }
      }}
    >
      {value.map((tag) => (
        <span key={tag} className="inline-flex h-6 items-center gap-1 rounded bg-indigo-500/[0.12] pl-2 pr-1 text-[12px] text-indigo-200 ring-1 ring-inset ring-indigo-400/20">
          {tag}
          <button
            type="button"
            className="flex h-4 w-4 items-center justify-center rounded text-indigo-300/70 hover:bg-white/10 hover:text-indigo-100"
            onClick={() => onChange(value.filter((x) => x !== tag))}
            title={t('agents:fields.removeTag', { tag })}
          >
            <X size={11} />
          </button>
        </span>
      ))}
      <input
        className="h-6 min-w-[120px] flex-1 bg-transparent px-1 text-[13px] text-zinc-200 outline-none placeholder:text-zinc-400"
        value={draft}
        placeholder={value.length ? '' : placeholder}
        onChange={(e) => {
          const v = e.target.value
          if (v.includes(',')) commit(v)
          else setDraft(v)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            e.stopPropagation()
            if (draft.trim()) commit(draft)
          } else if (e.key === 'Backspace' && !draft && value.length) {
            onChange(value.slice(0, -1))
          }
        }}
        onBlur={() => autoCommitOnBlur && draft.trim() && commit(draft)}
      />
    </div>
  )
}

/** Brief "Kaydedildi" feedback after a save; `flash()` restarts the timer. */
export function useSavedFlash(ms = 1600): { saved: boolean; flash: () => void } {
  const [saved, setSaved] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])
  const flash = (): void => {
    setSaved(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setSaved(false), ms)
  }
  return { saved, flash }
}

export function SavedIndicator({ saved }: { saved: boolean }) {
  const { t } = useTranslation()
  return (
    <span
      className={cn('flex items-center gap-1 text-[12px] text-emerald-400 transition-opacity duration-300', saved ? 'opacity-100' : 'opacity-0')}
      aria-live="polite"
    >
      <Check size={13} /> {t('status.saved')}
    </span>
  )
}
