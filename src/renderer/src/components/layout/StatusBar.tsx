import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Cpu, Database, FolderOpen, MessageSquareHeart, Network, TriangleAlert, Zap } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { locale } from '@/i18n'
import { call } from '@/lib/api'
import { compact, cn } from '@/lib/format'
import { shortPath } from '@/lib/org'
import { useAppStore } from '@/store/useAppStore'
import { FeedbackModal } from '@/features/feedback/FeedbackModal'

export function StatusBar() {
  const { t } = useTranslation()
  const agents = useAppStore((s) => s.agents)
  const providers = useAppStore((s) => s.providers)
  const stats = useAppStore((s) => s.stats)
  const usage = useAppStore((s) => s.usage)
  const settings = useAppStore((s) => s.settings)
  const paused = useAppStore((s) => s.orchestratorPaused)
  const openSettings = useAppStore((s) => s.openSettings)
  const view = useAppStore((s) => s.view)
  const project = useAppStore((s) => s.projects.find((p) => p.id === s.activeProjectId))
  const openProjectModal = useAppStore((s) => s.openProjectModal)
  const def = providers.find((p) => p.isDefault) ?? providers[0]
  const working = agents.filter((a) => a.status === 'working').length
  const errors = agents.filter((a) => a.status === 'error').length

  return (
    <footer className="flex h-6 shrink-0 items-center gap-4 overflow-hidden whitespace-nowrap border-t border-line bg-[#0c0c0e] px-3 text-[11px] text-zinc-400">
      <span className="flex items-center gap-1.5">
        <span className={cn('h-1.5 w-1.5 rounded-full', paused ? 'bg-amber-400' : 'bg-emerald-400')} />
        {paused ? t('statusBar.paused') : settings.autopilot ? t('statusBar.autopilotOn') : t('statusBar.autopilotOff')}
      </span>
      <span>
        {t('statusBar.agents', { count: agents.filter((a) => a.enabled).length })} ·{' '}
        <span className="text-emerald-400/80">{t('statusBar.working', { count: working })}</span>
        {errors > 0 && <span className="text-rose-400"> · {t('statusBar.errors', { count: errors })}</span>}
      </span>
      <button className="flex items-center gap-1 hover:text-zinc-300" onClick={() => openSettings('providers')}>
        <Cpu size={11} /> {def ? `${def.label}${def.model ? ' · ' + def.model : ''}` : t('statusBar.demoProvider')}
      </button>
      {view === 'org' ? (
        <span className="flex items-center gap-1.5">
          <Network size={11} /> {t('statusBar.organization')}
        </span>
      ) : (
        project && (
          <button className="flex min-w-0 items-center gap-1.5 hover:text-zinc-300" onClick={() => openProjectModal(project.id)} title={t('statusBar.projectSettings')}>
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: project.color }} />
            <span className="truncate text-zinc-300">{project.name}</span>
            {project.rootPath ? (
              <span className="flex min-w-0 items-center gap-1 font-mono">
                <FolderOpen size={11} className="shrink-0" />
                <span className="truncate">{shortPath(project.rootPath, 56)}</span>
              </span>
            ) : (
              <span className="flex items-center gap-1 text-amber-300/90">
                <TriangleAlert size={11} /> {t('statusBar.noFolder')}
              </span>
            )}
          </button>
        )
      )}
      <span
        className="ml-auto flex shrink-0 items-center gap-1"
        title={t('statusBar.tokensTitle', {
          session: (usage?.session.total ?? 0).toLocaleString(locale()),
          total: (usage?.allTime.total ?? 0).toLocaleString(locale())
        })}
      >
        <Zap size={11} /> {t('statusBar.tokens', { session: compact(usage?.session.total ?? 0), total: compact(usage?.allTime.total ?? 0) })}
      </span>
      <span className="flex shrink-0 items-center gap-1">
        <Database size={11} /> {t('statusBar.memories', { count: stats?.memories ?? 0 })}
      </span>
      <FeedbackButton />
      <SupportButton />
    </footer>
  )
}

/** Opens the feedback modal (suggestion / bug / thanks → mail to the developer). Icon only on narrow windows. */
function FeedbackButton() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={t('feedback.title')}
        aria-label={t('feedback.title')}
        data-testid="feedback-button"
        className="flex h-[18px] shrink-0 items-center gap-1 rounded-sm border border-indigo-400/35 bg-indigo-400/[0.08] px-1.5 font-medium text-indigo-200 transition-colors hover:border-indigo-300/70 hover:bg-indigo-400/[0.16] hover:text-indigo-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-indigo-300/70"
      >
        <MessageSquareHeart size={11} aria-hidden />
        <span className="hidden min-[1400px]:inline">{t('feedback.button')}</span>
      </button>
      {/* Portal: the status bar's nowrap / small-text styles must not leak into the modal. */}
      {open && createPortal(<FeedbackModal open onClose={() => setOpen(false)} />, document.body)}
    </>
  )
}

/** Opens the developer's support page in the system browser (fixed URL, handled in main). Icon only on narrow windows. */
function SupportButton() {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={() => void call('app:openSupport').catch(() => undefined)}
      title={t('app.support')}
      aria-label={t('app.support')}
      data-testid="support-button"
      className="flex h-[18px] shrink-0 items-center gap-1 rounded-sm border border-amber-400/35 bg-amber-400/[0.08] px-1.5 font-medium text-amber-300 transition-colors hover:border-amber-300/70 hover:bg-amber-400/[0.16] hover:text-amber-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-300/70"
    >
      <span aria-hidden className="text-[11px] leading-none">☕</span>
      <span className="hidden min-[1400px]:inline">{t('app.supportLabel')}</span>
    </button>
  )
}
