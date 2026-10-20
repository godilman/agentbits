import { useState } from 'react'
import { CircleAlert, CircleCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Message, NeedsAction, NeedsCard as Card, NeedsOutcome, NeedsResolution } from '@shared/types'
import { apiError, call } from '@/lib/api'
import { cn } from '@/lib/format'
import { useAppStore } from '@/store/useAppStore'

/**
 * A "needs you" card in the project chat: what waits, why, what is asked, and only the actions the app has for it.
 * Whether it still waits comes from the app's current state, not from the card; the action itself is checked again in
 * the main process (`needs:act`). A connection / app request opens the approval panel (no approve button here).
 */
export function NeedsCard({ m, card }: { m: Message; card: Card }) {
  const { t } = useTranslation()
  const resolution = (m.meta?.resolution as NeedsResolution | undefined) ?? null
  const open = useAppStore((s) => {
    if (card.kind === 'runApproval') return s.activeRuns.some((r) => r.id === card.runId && r.status === 'awaiting_approval')
    if (card.kind === 'connApproval') return s.approvals.some((a) => a.id === card.approvalId)
    return s.orchestratorWaits.waitEvents.includes(card.event)
  })
  // The card can arrive a moment before the app's state that lists its wait: not "over" in that first moment.
  const fresh = Date.now() - Date.parse(m.createdAt) < 5000
  const [busy, setBusy] = useState<NeedsAction | null>(null)
  const [sent, setSent] = useState<NeedsOutcome | 'gone' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const live = !resolution && (open || fresh) && !sent

  const run = async (action: NeedsAction): Promise<void> => {
    const s = useAppStore.getState()
    if (action === 'openTask' || action === 'reviewMerge') {
      if (!card.taskId) return
      s.setTab('tasks')
      s.selectTask(card.taskId)
      if (action === 'reviewMerge') useAppStore.setState({ mergeReviewFor: card.taskId })
      return
    }
    if (action === 'openApproval') {
      useAppStore.setState({ focusApproval: card.approvalId ?? null })
      return
    }
    setBusy(action)
    setError(null)
    try {
      const r = await call('needs:act', m.projectId ?? '', card.event, action)
      // "Taken" is not "done": the card closes when the wait really ends (the app writes how).
      setSent(r.result === 'done' ? (r.outcome ?? 'gone') : 'gone')
    } catch (e) {
      setError(apiError(e))
    } finally {
      setBusy(null)
    }
  }

  const status = resolution
    ? t(`chat:card.outcome.${resolution.outcome}`)
    : sent === 'gone'
      ? t('chat:card.gone')
      : sent
        ? t('chat:card.taken')
        : !open && !fresh
          ? t('chat:card.gone')
          : null
  const label = (a: NeedsAction): string =>
    ({
      approve: t('actions.approve'),
      reject: t('actions.reject'),
      retry: t('tasks:drawer.retry'),
      retryReview: t('tasks:drawer.retryReview'),
      rerunWorker: t('tasks:drawer.rerunWorker'),
      reviewMerge: t('tasks:drawer.reviewAndMerge'),
      openApproval: t('chat:card.openApproval'),
      openTask: t('chat:card.openTask')
    })[a]
  // Navigation stays available after the wait ended; deciding doesn't.
  const actions = card.actions.filter((a) => live || a === 'openTask')

  return (
    <div
      data-testid="chat-needs-you"
      data-card-event={card.event}
      className={cn(
        'rounded-md border px-3 py-2 text-[13px] leading-relaxed',
        live ? 'border-amber-500/30 bg-amber-500/[0.06] text-zinc-100' : 'border-line bg-white/[0.02] text-zinc-300'
      )}
    >
      <div className="flex items-start gap-2">
        {live ? <CircleAlert size={14} className="mt-0.5 shrink-0 text-amber-300" /> : <CircleCheck size={14} className="mt-0.5 shrink-0 text-zinc-400" />}
        <span className="min-w-0">{m.content}</span>
      </div>
      {status && (
        <div className="mt-1.5 pl-[22px] text-[12px] text-zinc-400" role="status">
          {status}
        </div>
      )}
      {error && (
        <div className="mt-1.5 pl-[22px] text-[12px] text-rose-300" role="alert">
          {t('chat:card.failed', { error })}
        </div>
      )}
      {actions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5 pl-[22px]">
          {actions.map((a) => (
            <button
              key={a}
              type="button"
              data-action={a}
              disabled={busy !== null}
              onClick={() => void run(a)}
              className={cn('h-7 text-[12px]', a === 'openTask' || a === 'reject' ? 'btn-ghost' : 'btn-outline')}
            >
              {busy === a ? t('chat:card.working') : label(a)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
