import { useEffect, useRef, useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { LEVEL_LABEL } from '@shared/connections'
import { apiError, call } from '@/lib/api'
import { useAppStore } from '@/store/useAppStore'

/**
 * Production operations waiting for the user. Always visible (bottom-left) while
 * any is pending; the agent's tool call blocks until it is approved, denied or expires.
 */
export function ApprovalsDock() {
  const { t } = useTranslation(['common', 'connections'])
  const approvals = useAppStore((s) => s.approvals)
  const toast = useAppStore((s) => s.toast)
  const [busy, setBusy] = useState<string | null>(null)
  const [, tick] = useState(0)
  // A chat card asked to show a request here: bring it into view and give it focus (not to its approve button).
  const focus = useAppStore((s) => s.focusApproval)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!focus) return
    const el = root.current?.querySelector<HTMLElement>(`[data-approval="${CSS.escape(focus)}"]`)
    el?.scrollIntoView({ block: 'nearest' })
    el?.focus()
    useAppStore.setState({ focusApproval: null })
  }, [focus, approvals])
  useEffect(() => {
    if (!approvals.length) return
    const timer = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(timer)
  }, [approvals.length])
  if (!approvals.length) return null

  const resolve = async (id: string, ok: boolean): Promise<void> => {
    setBusy(id)
    try {
      await call('approvals:resolve', id, ok)
      await useAppStore.getState().refresh('approvals')
    } catch (e) {
      toast('error', apiError(e))
      void useAppStore.getState().refresh('approvals')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div ref={root} className="fixed bottom-9 left-3 z-[55] w-[440px] space-y-2">
      {approvals.map((a) => {
        const left = Math.max(0, Math.round((Date.parse(a.expiresAt) - Date.now()) / 1000))
        return (
          <div key={a.id} data-approval={a.id} tabIndex={-1} className="card shadow-pop border-rose-500/40 bg-[#160d10] p-3 animate-fade-in focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/60">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-rose-200">
              <ShieldAlert size={14} /> {a.operation === 'app' ? t('connections:approvals.appTitle') : t('connections:approvals.title')}
              <span className="ml-auto font-mono text-[11px] font-normal text-rose-200/60">
                {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
              </span>
            </div>
            <div className="mt-1 text-[13px] text-zinc-300">
              <b className="text-zinc-100">{a.agentName}</b>
              {a.taskKey ? ` (${a.taskKey})` : ''} → <b className="text-zinc-100">{a.connectionName}</b> ·{' '}
              {a.operation === 'app' ? (
                t('connections:approvals.appTool', { tool: a.tool ?? '' })
              ) : (
                <>
                  {a.operation === 'query' ? 'SQL' : t('connections:approvals.sshCommand')} · {t('connections:approvals.level', { level: LEVEL_LABEL[a.needs] })}
                </>
              )}
            </div>
            <pre className="mt-1.5 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-black/40 px-2 py-1.5 font-mono text-[12px] text-zinc-200">{a.detail}</pre>
            <div className="mt-2 flex justify-end gap-2">
              <button className="btn-ghost h-7" disabled={busy === a.id} onClick={() => void resolve(a.id, false)}>
                {t('actions.reject')}
              </button>
              <button className="btn h-7 bg-rose-600 text-white hover:bg-rose-500" disabled={busy === a.id} onClick={() => void resolve(a.id, true)}>
                {t('connections:approvals.approveRun')}
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
