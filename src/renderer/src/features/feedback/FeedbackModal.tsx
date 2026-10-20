import { useState, type ReactNode } from 'react'
import { Bug, Copy, Heart, Lightbulb, Mail, Star } from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'
import { FEEDBACK_EMAIL, type FeedbackKind } from '@shared/support'
import { Modal } from '@/components/common/ui'
import { call, apiError } from '@/lib/api'
import { cn } from '@/lib/format'
import { useAppStore } from '@/store/useAppStore'

/**
 * Feedback without a form: explains what to write for a suggestion, a bug or a thank-you, and opens the user's mail
 * app with a prepared message to the developer's fixed address (main builds the mailto; see `app:feedbackMail`).
 */
export function FeedbackModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const toast = useAppStore((s) => s.toast)
  const [rating, setRating] = useState(0)
  const [hover, setHover] = useState(0)

  const mail = (kind: FeedbackKind, stars?: number): void => {
    call('app:feedbackMail', kind, stars).catch((e) => toast('error', apiError(e)))
  }
  const copy = (): void => {
    navigator.clipboard
      .writeText(FEEDBACK_EMAIL)
      .then(() => toast('success', t('feedback.copied')))
      .catch(() => undefined)
  }
  const email = (
    <button type="button" onClick={copy} className="font-medium text-indigo-300 underline decoration-indigo-400/40 underline-offset-2 hover:text-indigo-200" title={t('feedback.copy')} />
  )

  return (
    <Modal open={open} onClose={onClose} width={560} title={<span className="flex items-center gap-2"><Mail size={15} className="text-indigo-300" /> {t('feedback.title')}</span>}>
      <div className="space-y-3" data-testid="feedback-modal">
        <p className="text-[13px] leading-relaxed text-zinc-300">
          <Trans t={t} i18nKey="feedback.intro" values={{ email: FEEDBACK_EMAIL }} components={{ mail: email }} />
        </p>

        <Card icon={<Lightbulb size={15} />} tone="text-sky-300" title={t('feedback.idea.title')} testId="feedback-idea">
          <Trans t={t} i18nKey="feedback.idea.text" values={{ email: FEEDBACK_EMAIL }} components={{ mail: email }} />
          <div className="mt-2.5">
            <button type="button" className="btn btn-outline" onClick={() => mail('idea')}>
              <Mail size={13} /> {t('feedback.idea.action')}
            </button>
          </div>
        </Card>

        <Card icon={<Bug size={15} />} tone="text-rose-300" title={t('feedback.bug.title')} testId="feedback-bug">
          <Trans t={t} i18nKey="feedback.bug.text" values={{ email: FEEDBACK_EMAIL }} components={{ mail: email }} />
          <div className="mt-2.5">
            <button type="button" className="btn btn-outline" onClick={() => mail('bug')}>
              <Mail size={13} /> {t('feedback.bug.action')}
            </button>
          </div>
        </Card>

        <Card icon={<Heart size={15} />} tone="text-amber-300" title={t('feedback.thanks.title')} testId="feedback-thanks">
          <Trans t={t} i18nKey="feedback.thanks.text" components={{ b: <b className="text-zinc-100" /> }} />
          <div className="mt-2.5">
            <button
              type="button"
              onClick={() => void call('app:openSupport').catch(() => undefined)}
              data-testid="feedback-coffee"
              className="inline-flex items-center gap-1.5 rounded-md border border-amber-400/40 bg-amber-400/[0.1] px-3 py-1.5 text-[13px] font-medium text-amber-200 transition-colors hover:border-amber-300/70 hover:bg-amber-400/[0.18]"
            >
              <span aria-hidden>☕</span> {t('app.supportLabel')}
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <span className="text-[12px] text-zinc-400">{t('feedback.thanks.rate')}</span>
            <div className="flex items-center" onMouseLeave={() => setHover(0)} role="radiogroup" aria-label={t('feedback.thanks.rate')}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={rating === n}
                  title={t('feedback.thanks.rateStar', { n })}
                  aria-label={t('feedback.thanks.rateStar', { n })}
                  data-testid={`feedback-star-${n}`}
                  onMouseEnter={() => setHover(n)}
                  onClick={() => setRating(n)}
                  className="p-0.5"
                >
                  <Star size={17} className={cn('transition-colors', (hover || rating) >= n ? 'fill-amber-300 text-amber-300' : 'text-zinc-500')} />
                </button>
              ))}
            </div>
            <button type="button" className="btn btn-ghost ml-auto" onClick={() => mail('thanks', rating || undefined)}>
              <Mail size={13} /> {rating ? t('feedback.thanks.sendRating') : t('feedback.thanks.sendThanks')}
            </button>
          </div>
        </Card>

        <div className="flex flex-wrap items-center justify-between gap-3 gap-y-1 text-[12px] text-zinc-500">
          <span className="min-w-0">{t('feedback.noMailApp')}</span>
          <button type="button" className="btn btn-ghost shrink-0" onClick={copy} data-testid="feedback-copy">
            <Copy size={12} /> {t('feedback.copy')}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function Card({ icon, tone, title, testId, children }: { icon: ReactNode; tone: string; title: string; testId: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-surface-2/60 p-3" data-testid={testId}>
      <div className={cn('mb-1.5 flex items-center gap-2 text-[13px] font-semibold', tone)}>
        {icon}
        <span className="text-zinc-100">{title}</span>
      </div>
      <div className="text-[13px] leading-relaxed text-zinc-300">{children}</div>
    </section>
  )
}
