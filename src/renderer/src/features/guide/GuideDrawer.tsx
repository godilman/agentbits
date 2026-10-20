import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { BookOpen, Check, ChevronDown, ChevronRight, X } from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'
import type { I18nKey } from '@shared/i18n'
import { Segmented } from '@/components/common/ui'
import { useLayer } from '@/components/common/Layer'
import { useGuideOverlay } from '@/components/layout/Sidebar'
import { cn } from '@/lib/format'
import { resolveProjectLead, useProjectScope } from '@/lib/org'
import { useAppStore } from '@/store/useAppStore'

/**
 * Guide: a setup checklist whose steps tick themselves off from real app state
 * (provider, units, agents, lead, project, first message…), each with the why /
 * where / how and a button that takes the user there; plus a "where is what"
 * reference and the shortcuts. Opens after onboarding; F1 or the TopBar button.
 */

const VISIT_KEY = 'agentbits:guide:visited'

function readVisited(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(VISIT_KEY) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}
function markVisited(id: string): void {
  try {
    const v = readVisited()
    v.add(id)
    localStorage.setItem(VISIT_KEY, JSON.stringify([...v]))
  } catch {
    /* storage unavailable: the step just stays open */
  }
}

const STEP_IDS = ['provider', 'org', 'agents', 'lead', 'perms', 'project', 'work', 'watch'] as const
type StepId = (typeof STEP_IDS)[number]

interface Step {
  id: StepId
  title: string
  why: string
  how: ReactNode
  done: boolean
  actions: { label: string; run: () => void }[]
}

/** Checklist state, shared by the drawer and the TopBar badge. */
export function useGuideSteps(): Step[] {
  const providers = useAppStore((s) => s.providers)
  const agents = useAppStore((s) => s.agents)
  const units = useAppStore((s) => s.units)
  const feed = useAppStore((s) => s.feed)
  const tasks = useAppStore((s) => s.tasks)
  const recentRuns = useAppStore((s) => s.recentRuns)
  const activeRuns = useAppStore((s) => s.activeRuns)
  const guideOpen = useAppStore((s) => s.guideOpen)
  const { pid, project } = useProjectScope()
  // `t` changes identity with the language, so the memo below re-translates on a language switch.
  const { t } = useTranslation()
  const [visited, setVisited] = useState(readVisited)
  // Re-read when the drawer opens (visits recorded elsewhere, e.g. the terminal tab).
  useEffect(() => setVisited(readVisited()), [guideOpen])

  return useMemo(() => {
    const st = useAppStore.getState()
    const go = (fn: () => void, visit?: string) => () => {
      if (visit) {
        markVisited(visit)
        setVisited(readVisited())
      }
      fn()
    }
    const teams = units.filter((u) => u.parentId)
    const hasLead = !!(project && resolveProjectLead(project, units, agents)) && agents.length > 0
    const projectReady = !!project && project.unitIds.length > 0
    const firstWork = feed.some((m) => m.projectId === pid && m.senderType === 'user') || tasks.some((t) => t.projectId === pid)
    const how = (id: StepId): ReactNode => <Trans i18nKey={`guide:steps.${id}.how`} components={{ b: <b />, i: <i /> }} />
    const step = (id: StepId, done: boolean, actions: Step['actions']): Step => ({
      id,
      title: t(`guide:steps.${id}.title`),
      why: t(`guide:steps.${id}.why`),
      how: how(id),
      done,
      actions
    })
    return [
      step('provider', providers.length > 0, [{ label: t('guide:actions.providers'), run: go(() => st.openSettings('providers')) }]),
      step('org', teams.length > 0, [
        { label: t('guide:actions.templates'), run: go(() => st.showOrg('templates', st.activeProjectId)) },
        { label: t('guide:actions.chart'), run: go(() => st.showOrg('chart')) }
      ]),
      step('agents', agents.length > 0, [{ label: t('guide:actions.agents'), run: go(() => st.showOrg('agents')) }]),
      step('lead', hasLead, [{ label: t('guide:actions.teams'), run: go(() => st.showOrg('teams')) }]),
      step('perms', visited.has('perms'), [
        { label: t('guide:actions.permissions'), run: go(() => st.openSettings('permissions'), 'perms') },
        { label: t('guide:actions.connections'), run: go(() => st.showOrg('connections'), 'perms') }
      ]),
      step(
        'project',
        projectReady,
        project
          ? [{ label: t('guide:actions.projectSettings'), run: go(() => st.openProjectModal(project.id)) }]
          : [{ label: t('guide:actions.pickProject'), run: go(() => st.openLauncher()) }]
      ),
      step('work', firstWork, [
        { label: t('guide:actions.chat'), run: go(() => st.setTab('chat')) },
        { label: t('guide:actions.tasks'), run: go(() => st.setTab('tasks')) }
      ]),
      step(
        'watch',
        visited.has('watch') || recentRuns.some((r) => r.projectId === pid) || activeRuns.some((r) => r.projectId === pid),
        [
          { label: t('guide:actions.agentTerminals'), run: go(() => st.setTab('terminal'), 'watch') },
          { label: t('guide:actions.office'), run: go(() => st.setTab('office'), 'watch') }
        ]
      )
    ]
  }, [providers, agents, units, feed, tasks, recentRuns, activeRuns, pid, project, visited, t])
}

/** "Where things are": area → item ids; texts are `guide:places.<area>.title` / `.<item>.name` / `.<item>.desc`. */
const PLACES = [
  { area: 'sections', items: ['chat', 'office', 'team', 'terminal', 'tasks', 'reports', 'decisions', 'browser', 'files'] },
  { area: 'org', items: ['chart', 'teams', 'agents', 'templates', 'skills', 'apps', 'connections'] },
  { area: 'settings', items: ['agents', 'permissions', 'providers', 'memory', 'data', 'general'] },
  { area: 'statusBar', items: ['feedback', 'coffee'] }
] as const

/** Keys (not translated) → `guide:shortcuts.<id>`. */
const SHORTCUTS = [
  ['F1', 'toggleGuide'],
  ['Ctrl+P', 'projectPicker'],
  ['Ctrl+O', 'organization'],
  ['Ctrl+,', 'settings'],
  ['Ctrl+1…9', 'sections'],
  ['Ctrl+Tab', 'nextProject'],
  ['Ctrl+Enter', 'sendInstruction']
] as const

type Pane = 'setup' | 'places' | 'keys'

export function GuideDrawer() {
  const { t } = useTranslation()
  const open = useAppStore((s) => s.guideOpen)
  const close = useAppStore((s) => s.closeGuide)
  const steps = useGuideSteps()
  const [pane, setPane] = useState<Pane>('setup')
  const firstOpen = steps.find((s) => !s.done)?.id ?? null
  const [expanded, setExpanded] = useState<string | null>(firstOpen)
  // On open, and whenever a step gets done, jump to the next unfinished one.
  useEffect(() => {
    if (open) setExpanded(firstOpen)
  }, [open, firstOpen])

  // Over the content (a narrow window) it is a dialog. The same element either way, so switching keeps the open pane,
  // step and scroll position.
  const overlay = useGuideOverlay((s) => s.overlay)
  const panel = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useLayer(open && overlay, close, panel, { trap: true })
  // Closed with nothing to give the focus back to (it was opened while a dialog that has closed since was open): the
  // Guide button.
  const wasOpen = useRef(open)
  useEffect(() => {
    if (wasOpen.current && !open && (!document.activeElement || document.activeElement === document.body))
      document.querySelector<HTMLElement>('[data-testid="guide-button"]')?.focus()
    wasOpen.current = open
  }, [open])

  if (!open) return null
  const done = steps.filter((s) => s.done).length
  return (
    <>
      {overlay && <div className="absolute inset-0 z-30 bg-black/40" onMouseDown={close} />}
      <div
        ref={panel}
        role={overlay ? 'dialog' : 'complementary'}
        aria-modal={overlay || undefined}
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          'flex w-[380px] max-w-full shrink-0 flex-col border-l border-line bg-[#0e0e11] outline-none animate-slide-in',
          overlay && 'absolute bottom-0 right-0 top-0 z-30 shadow-pop'
        )}
        data-testid="guide"
        data-overlay={overlay || undefined}
      >
        <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
          <BookOpen size={15} className="shrink-0 text-indigo-300" />
          <span id={titleId} className="min-w-0 truncate text-[15px] font-semibold text-zinc-100">
            {t('guide:title')}
          </span>
          <span className="min-w-0 truncate text-[11px] text-zinc-500">{t('guide:progress', { done, total: steps.length })}</span>
          <button className="icon-btn ml-auto shrink-0" onClick={close} title={t('guide:closeTitle')} aria-label={t('guide:closeTitle')} data-testid="guide-close">
            <X size={14} />
          </button>
        </div>
        <div className="h-1 bg-white/[0.04]">
          <div className="h-full bg-indigo-500 transition-all" style={{ width: `${(done / steps.length) * 100}%` }} />
        </div>
        <div className="px-4 pb-1 pt-3">
          <Segmented<Pane>
            value={pane}
            onChange={setPane}
            options={[
              { value: 'setup', label: t('guide:panes.setup') },
              { value: 'places', label: t('guide:panes.places') },
              { value: 'keys', label: t('guide:panes.keys') }
            ]}
          />
        </div>

        <div className="selectable min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {pane === 'setup' && (
            <div className="space-y-2">
              <p className="mb-3 text-[13px] leading-relaxed text-zinc-400">
                <Trans i18nKey="guide:intro" components={{ b: <b className="text-zinc-300" /> }} />
              </p>
              {steps.map((s, i) => {
                const isOpen = expanded === s.id
                return (
                  <div key={s.id} className={cn('rounded-md border', s.done ? 'border-line' : isOpen ? 'border-indigo-500/40 bg-indigo-500/[0.04]' : 'border-line')} data-guide-step={s.id}>
                    <button className="flex w-full items-center gap-2.5 px-3 py-2 text-left" onClick={() => setExpanded(isOpen ? null : s.id)}>
                      <span
                        className={cn(
                          'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold',
                          s.done ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/[0.06] text-zinc-300'
                        )}
                      >
                        {s.done ? <Check size={11} /> : i + 1}
                      </span>
                      <span className={cn('min-w-0 flex-1 text-[13px]', s.done ? 'text-zinc-400' : 'text-zinc-100')}>{s.title}</span>
                      {isOpen ? <ChevronDown size={13} className="text-zinc-500" /> : <ChevronRight size={13} className="text-zinc-500" />}
                    </button>
                    {isOpen && (
                      <div className="space-y-2 px-3 pb-3 pl-[42px] text-[13px] leading-relaxed">
                        <p className="text-zinc-300">
                          <span className="text-zinc-500">{t('guide:why')}</span>
                          {s.why}
                        </p>
                        <p className="text-zinc-400">
                          <span className="text-zinc-500">{t('guide:how')}</span>
                          {s.how}
                        </p>
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {s.actions.map((a) => (
                            <button key={a.label} className="btn-outline h-7 text-[12px]" onClick={a.run}>
                              {a.label} <ChevronRight size={12} />
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
              {done === steps.length && (
                <div className="mt-3 rounded-md border border-emerald-500/30 bg-emerald-500/[0.06] px-3 py-2 text-[13px] text-emerald-200">
                  {t('guide:allDone')}
                </div>
              )}
            </div>
          )}

          {pane === 'places' && (
            <div className="space-y-4">
              {PLACES.map((g) => (
                <div key={g.area}>
                  <div className="panel-title mb-1.5">{t(`guide:places.${g.area}.title`)}</div>
                  <dl className="space-y-1.5">
                    {g.items.map((k) => (
                      <div key={k} className="text-[13px] leading-relaxed">
                        <dt className="inline font-medium text-zinc-200">{t(`guide:places.${g.area}.${k}.name` as I18nKey)}</dt>
                        <dd className="inline text-zinc-400"> — {t(`guide:places.${g.area}.${k}.desc` as I18nKey)}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
              <div className="text-[12px] leading-relaxed text-zinc-500">{t('guide:places.security')}</div>
            </div>
          )}

          {pane === 'keys' && (
            <div className="divide-y divide-line rounded-md border border-line">
              {SHORTCUTS.map(([k, id]) => (
                <div key={k} className="flex items-center gap-3 px-3 py-1.5 text-[13px]">
                  <span className="kbd w-24 justify-center">{k}</span>
                  <span className="text-zinc-300">{t(`guide:shortcuts.${id}`)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
