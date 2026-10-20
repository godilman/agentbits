import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/format'
import { useAppStore } from '@/store/useAppStore'

export function Toasts() {
  const toasts = useAppStore((s) => s.toasts)
  const dismiss = useAppStore((s) => s.dismissToast)
  const { t: tr } = useTranslation()
  return (
    <div className="pointer-events-none fixed bottom-9 right-4 z-[60] flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.id} className="card shadow-pop pointer-events-auto flex items-start gap-2 px-3 py-2.5 animate-fade-in">
          {t.level === 'success' ? (
            <CheckCircle2 size={15} className="mt-px text-emerald-400" />
          ) : t.level === 'error' ? (
            <AlertCircle size={15} className="mt-px text-rose-400" />
          ) : (
            <Info size={15} className="mt-px text-indigo-300" />
          )}
          <div className={cn('flex-1 text-[13px]', t.level === 'error' ? 'text-rose-100' : 'text-zinc-200')}>{t.text}</div>
          <button className="icon-btn h-5 w-5" onClick={() => dismiss(t.id)} title={tr('actions.close')} aria-label={tr('actions.close')}>
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}
