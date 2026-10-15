import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import {
  Archive,
  Building2,
  ChartColumnBig,
  Check,
  ChevronDown,
  FolderOpen,
  FolderPlus,
  Globe,
  MessagesSquare,
  Network,
  Pause,
  Play,
  Plus,
  Scale,
  Settings2,
  SlidersHorizontal,
  SquareKanban,
  SquareTerminal,
  TriangleAlert,
  Users,
  X,
  Paperclip,
  BookOpen,
  Brain
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Project } from '@shared/types'
import { t } from '@/i18n'
import { apiError, call } from '@/lib/api'
import { cn } from '@/lib/format'
import { shortPath } from '@/lib/org'
import { useAppStore, type Tab } from '@/store/useAppStore'
import { useGuideSteps } from '@/features/guide/GuideDrawer'
import { useOpenFolder } from '@/features/project/ProjectLauncher'
import { NeedsYouButton } from '@/features/inbox/NeedsYou'
import { Logo } from '@/components/common/Logo'

type TabDef = { id: Tab; readonly label: string; icon: ComponentType<{ size?: number; className?: string }>; key: string }
/** `label` is a getter: it is translated on every read (current language). */
const tab = (id: Tab, icon: TabDef['icon'], key: string): TabDef => ({
  id,
  icon,
  key,
  get label() {
    return t(`layout:topBar.tabs.${id}`)
  }
})
const TABS: TabDef[] = [
  tab('chat', MessagesSquare, '1'),
  tab('office', Building2, '2'),
  tab('team', Users, '3'),
  tab('terminal', SquareTerminal, '4'),
  tab('tasks', SquareKanban, '5'),
  tab('reports', ChartColumnBig, '6'),
  tab('decisions', Scale, '7'),
  tab('browser', Globe, '8'),
  tab('files', Paperclip, '9')
]
export { TABS, Logo }

export function TopBar() {
  const view = useAppStore((s) => s.view)
  const hasProject = useAppStore((s) => !!s.activeProjectId)
  return (
    <header className="relative z-20 shrink-0 border-b border-line bg-[#0c0c0e]">
      <ProjectStrip />
      {view === 'project' && hasProject && <SectionBar />}
    </header>
  )
}

/* ───────────────────────── row 1: org + project tabs ───────────────────────── */

function ProjectStrip() {
  const { t } = useTranslation()
  const view = useAppStore((s) => s.view)
  const showOrg = useAppStore((s) => s.showOrg)
  const projects = useAppStore((s) => s.projects)
  const openIds = useAppStore((s) => s.openProjectIds)
  const activeRuns = useAppStore((s) => s.activeRuns)
  const paused = useAppStore((s) => s.orchestratorPaused)
  const openSettings = useAppStore((s) => s.openSettings)
  const openProjectModal = useAppStore((s) => s.openProjectModal)
  const platform = window.agentbits?.platform
  const overlayRight = platform === 'win32' || platform === 'linux'

  const open = useMemo(() => openIds.map((id) => projects.find((p) => p.id === id)).filter((p): p is Project => !!p), [openIds, projects])
  const runCount = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of activeRuns) if (r.projectId && r.status === 'running') m.set(r.projectId, (m.get(r.projectId) ?? 0) + 1)
    return m
  }, [activeRuns])

  return (
    <div className={cn('drag flex h-10 items-center gap-2', platform === 'darwin' ? 'pl-[78px]' : 'pl-3', overlayRight ? 'pr-[150px]' : 'pr-3')}>
      <div className="flex shrink-0 items-center gap-2 pr-1">
        <Logo />
        <span className="text-[13px] font-semibold tracking-tight text-zinc-100">Agentbits</span>
      </div>

      <nav className="no-drag flex min-w-0 items-center gap-0.5">
        <button
          onClick={() => showOrg()}
          title={t('layout:topBar.organizationTitle')}
          className={cn(
            'relative flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-medium transition-colors',
            view === 'org' ? 'bg-white/[0.08] text-zinc-100' : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200'
          )}
        >
          <Network size={14} className={view === 'org' ? 'text-indigo-300' : ''} />
          {t('layout:topBar.organization')}
        </button>
        <span className="mx-1 h-4 w-px shrink-0 bg-line" />
        <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {open.map((p) => (
            <ProjectTab key={p.id} project={p} running={runCount.get(p.id) ?? 0} closable />
          ))}
        </div>
        <button className="icon-btn h-7 w-7 shrink-0" title={t('layout:topBar.newProject')} onClick={() => openProjectModal(null)}>
          <Plus size={15} />
        </button>
        <ProjectSwitcher />
      </nav>

      <div className="no-drag ml-auto flex shrink-0 items-center gap-1">
        <NeedsYouButton />
        <GuideButton />
        <MemoryButton />
        <button
          onClick={() => void call(paused ? 'orchestrator:resumeAll' : 'orchestrator:pauseAll')}
          className={cn(
            'btn h-7 border',
            paused
              ? 'border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/15'
              : 'border-line bg-surface-2 text-zinc-400 hover:text-zinc-200'
          )}
          title={paused ? t('layout:topBar.resumeAllTitle') : t('layout:topBar.pauseAllTitle')}
        >
          {paused ? <Play size={13} /> : <Pause size={13} />}
          {paused ? t('layout:topBar.resume') : t('layout:topBar.pauseAll')}
        </button>
        <button className="icon-btn h-7 w-7" onClick={() => openSettings()} title={t('layout:topBar.settings')}>
          <Settings2 size={15} />
        </button>
      </div>
    </div>
  )
}

/** Shortcut to Organization → Memory; the badge counts what agents learned and wait for the user's yes. */
function MemoryButton() {
  const { t } = useTranslation()
  const pending = useAppStore((s) => s.memorySuggestions.length)
  const showOrg = useAppStore((s) => s.showOrg)
  return (
    <button data-testid="memory-shortcut" className="icon-btn relative h-7 w-7" onClick={() => showOrg('memory')} title={t('layout:topBar.memory')}>
      <Brain size={15} />
      {pending > 0 && <span className="absolute -right-0.5 -top-0.5 rounded bg-pink-500 px-1 text-[9.5px] font-semibold leading-[14px] text-white">{pending}</span>}
    </button>
  )
}

/** Opens the setup guide; shows remaining setup steps until everything is done. */
function GuideButton() {
  const { t } = useTranslation()
  const open = useAppStore((s) => s.guideOpen)
  const toggle = useAppStore((s) => s.toggleGuide)
  const steps = useGuideSteps()
  const left = steps.filter((s) => !s.done).length
  return (
    <button
      onClick={toggle}
      title={t('layout:topBar.guideTitle')}
      data-testid="guide-button"
      className={cn(
        'btn h-7 border',
        open ? 'border-indigo-500/40 bg-indigo-500/10 text-indigo-200' : left ? 'border-indigo-500/30 bg-indigo-500/[0.06] text-indigo-200 hover:bg-indigo-500/10' : 'border-line bg-surface-2 text-zinc-400 hover:text-zinc-200'
      )}
    >
      <BookOpen size={13} /> {t('layout:topBar.guide')}
      {left > 0 && <span className="rounded bg-indigo-500/30 px-1 text-[10px] text-indigo-100">{steps.length - left}/{steps.length}</span>}
    </button>
  )
}

function ProjectTab({ project, running, closable }: { project: Project; running: number; closable: boolean }) {
  const { t } = useTranslation()
  const active = useAppStore((s) => s.view === 'project' && s.activeProjectId === project.id)
  const openProject = useAppStore((s) => s.openProject)
  const closeProject = useAppStore((s) => s.closeProject)
  return (
    <div
      role="tab"
      aria-selected={active}
      onClick={() => openProject(project.id)}
      onDoubleClick={() => useAppStore.getState().openProjectModal(project.id)}
      onAuxClick={(e) => e.button === 1 && closable && closeProject(project.id)}
      title={
        project.rootPath
          ? t('layout:topBar.projectTabTitle', { name: project.name, path: project.rootPath })
          : t('layout:topBar.projectTabTitleNoFolder', { name: project.name })
      }
      className={cn(
        'group relative flex h-7 max-w-[200px] shrink-0 cursor-pointer items-center gap-1.5 rounded-md pl-2.5 text-[12.5px] font-medium transition-colors',
        closable ? 'pr-1' : 'pr-2.5',
        active ? 'bg-white/[0.08] text-zinc-100' : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200'
      )}
    >
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: project.color }} />
      <span className="truncate">{project.name}</span>
      {running > 0 && (
        <span className="flex shrink-0 items-center gap-0.5 rounded bg-emerald-500/15 px-1 font-mono text-[10px] text-emerald-300" title={t('layout:topBar.runningJobs', { count: running })}>
          <span className="h-1 w-1 animate-pulse rounded-full bg-emerald-400" />
          {running}
        </span>
      )}
      {closable && (
        <button
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-zinc-500 opacity-0 transition-opacity hover:bg-white/10 hover:text-zinc-200 group-hover:opacity-100"
          title={t('layout:topBar.closeTab')}
          onClick={(e) => {
            e.stopPropagation()
            closeProject(project.id)
          }}
        >
          <X size={11} />
        </button>
      )}
      {active && <span className="absolute inset-x-2 bottom-0 h-[2px] rounded-full opacity-80" style={{ background: project.color }} />}
    </div>
  )
}

function ProjectSwitcher() {
  const { t } = useTranslation()
  const projects = useAppStore((s) => s.projects)
  const openIds = useAppStore((s) => s.openProjectIds)
  const activeId = useAppStore((s) => s.activeProjectId)
  const openProject = useAppStore((s) => s.openProject)
  const openProjectModal = useAppStore((s) => s.openProjectModal)
  const openLauncher = useAppStore((s) => s.openLauncher)
  const toast = useAppStore((s) => s.toast)
  const { openFolder } = useOpenFolder()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const active = useMemo(() => projects.filter((p) => p.status === 'active'), [projects])
  const archived = useMemo(() => projects.filter((p) => p.status === 'archived'), [projects])

  const pick = async (p: Project): Promise<void> => {
    setOpen(false)
    if (p.status === 'archived') {
      try {
        const saved = await call('projects:save', { status: 'active' }, p.id)
        useAppStore.setState((s) => ({ projects: s.projects.map((x) => (x.id === saved.id ? saved : x)) }))
        toast('info', t('layout:topBar.unarchived', { name: p.name }))
      } catch (e) {
        toast('error', apiError(e))
        return
      }
    }
    openProject(p.id)
  }

  return (
    <div ref={ref} className="relative shrink-0">
      <button className={cn('icon-btn h-7 w-7', open && 'bg-white/5 text-zinc-200')} title={t('layout:topBar.allProjects')} onClick={() => setOpen((v) => !v)}>
        <ChevronDown size={15} />
      </button>
      {open && (
        <div className="card shadow-pop absolute left-0 top-9 z-50 w-[300px] p-1.5 animate-fade-in">
          <div className="panel-title px-2 pb-1 pt-1">{t('layout:topBar.projects')}</div>
          <div className="max-h-[360px] overflow-y-auto">
            {active.map((p) => (
              <SwitcherRow key={p.id} project={p} isOpen={openIds.includes(p.id)} isActive={p.id === activeId} onPick={() => void pick(p)} />
            ))}
            {archived.length > 0 && (
              <>
                <div className="panel-title flex items-center gap-1.5 px-2 pb-1 pt-2.5">
                  <Archive size={11} /> {t('layout:topBar.archive')}
                </div>
                {archived.map((p) => (
                  <SwitcherRow key={p.id} project={p} isOpen={false} isActive={false} onPick={() => void pick(p)} />
                ))}
              </>
            )}
          </div>
          <div className="mt-1 border-t border-line pt-1">
            <button
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] text-zinc-300 hover:bg-white/[0.05]"
              onClick={() => {
                setOpen(false)
                openLauncher()
              }}
            >
              <FolderOpen size={14} className="text-indigo-300" /> {t('layout:topBar.openProject')}
              <span className="ml-auto font-mono text-[10.5px] text-zinc-500">Ctrl+P</span>
            </button>
            <button
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] text-zinc-300 hover:bg-white/[0.05]"
              onClick={() => {
                setOpen(false)
                void openFolder()
              }}
            >
              <FolderPlus size={14} className="text-indigo-300" /> {t('layout:topBar.openFolder')}
            </button>
            <button
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] text-zinc-300 hover:bg-white/[0.05]"
              onClick={() => {
                setOpen(false)
                openProjectModal(null)
              }}
            >
              <Plus size={14} className="text-indigo-300" /> {t('layout:topBar.newProject')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function SwitcherRow({ project, isOpen, isActive, onPick }: { project: Project; isOpen: boolean; isActive: boolean; onPick: () => void }) {
  const { t } = useTranslation()
  const archived = project.status === 'archived'
  return (
    <button onClick={onPick} className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-white/[0.05]">
      <span className={cn('h-2 w-2 shrink-0 rounded-full', archived && 'opacity-50')} style={{ background: project.color }} />
      <div className="min-w-0 flex-1">
        <div className={cn('truncate text-[12.5px]', archived ? 'text-zinc-400' : 'text-zinc-200')}>{project.name}</div>
        <div className="truncate font-mono text-[10.5px] text-zinc-500">{project.rootPath ? shortPath(project.rootPath, 38) : t('layout:topBar.noFolder')}</div>
      </div>
      {archived ? (
        <span className="shrink-0 text-[10.5px] text-zinc-500">{t('layout:topBar.archived')}</span>
      ) : isActive ? (
        <Check size={13} className="shrink-0 text-indigo-300" />
      ) : isOpen ? (
        <span className="shrink-0 text-[10.5px] text-zinc-500">{t('layout:topBar.open')}</span>
      ) : null}
    </button>
  )
}

/* ───────────────────────── row 2: project sections ───────────────────────── */

function SectionBar() {
  const { t } = useTranslation()
  const tab = useAppStore((s) => s.tab)
  const setTab = useAppStore((s) => s.setTab)
  const pid = useAppStore((s) => s.activeProjectId)
  const project = useAppStore((s) => s.projects.find((p) => p.id === s.activeProjectId))
  const openProjectModal = useAppStore((s) => s.openProjectModal)
  const inProgress = useAppStore((s) => s.tasks.filter((t) => t.projectId === s.activeProjectId && t.status === 'in_progress').length)
  const proposed = useAppStore((s) => s.decisions.filter((d) => d.projectId === s.activeProjectId && d.status === 'proposed').length)

  return (
    <div className="flex h-9 items-center gap-3 border-t border-line-soft pl-3 pr-3">
      <nav className="flex items-center gap-0.5">
        {TABS.map((x) => {
          const active = tab === x.id
          const count = x.id === 'tasks' ? inProgress : x.id === 'decisions' ? proposed : 0
          return (
            <button
              key={x.id}
              onClick={() => setTab(x.id)}
              title={t('layout:topBar.tabTitle', { label: x.label, key: x.key })}
              className={cn(
                'group relative flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-medium transition-colors',
                active ? 'bg-white/[0.07] text-zinc-100' : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200'
              )}
            >
              <x.icon size={14} className={active ? 'text-indigo-300' : 'text-zinc-400 group-hover:text-zinc-300'} />
              {x.label}
              {count > 0 && (
                <span className={cn('rounded px-1 font-mono text-[10px]', active ? 'bg-indigo-500/25 text-indigo-200' : 'bg-white/5 text-zinc-400')}>
                  {count}
                </span>
              )}
              {active && <span className="absolute inset-x-2.5 -bottom-[5px] h-px bg-indigo-400" />}
            </button>
          )
        })}
      </nav>

      <div className="ml-auto flex min-w-0 items-center gap-1">
        {project &&
          (project.rootPath ? (
            <button
              onClick={() => openProjectModal(pid)}
              title={t('layout:topBar.projectFolderTitle', { path: project.rootPath })}
              className="flex h-6 min-w-0 items-center gap-1.5 rounded-md border border-line bg-surface-2 px-2 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
            >
              <FolderOpen size={12} className="shrink-0" />
              <span className="truncate font-mono text-[11px]">{shortPath(project.rootPath, 48)}</span>
            </button>
          ) : (
            <button
              onClick={() => openProjectModal(pid)}
              title={t('layout:topBar.noFolderTitle')}
              className="flex h-6 shrink-0 items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 text-[11.5px] text-amber-300 hover:bg-amber-500/15"
            >
              <TriangleAlert size={12} /> {t('layout:topBar.noFolderChip')}
            </button>
          ))}
        <button className="icon-btn h-6 w-6 shrink-0" title={t('layout:topBar.projectSettings')} onClick={() => openProjectModal(pid)}>
          <SlidersHorizontal size={13} />
        </button>
      </div>
    </div>
  )
}
