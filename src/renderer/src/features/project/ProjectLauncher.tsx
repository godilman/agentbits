import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Archive, Check, ChevronRight, FolderOpen, FolderPlus, Plus, Search, Settings2, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { FolderStatus, Project } from '@shared/types'
import { Logo } from '@/components/common/Logo'
import { Modal } from '@/components/common/ui'
import { locale, t } from '@/i18n'
import { apiError, call } from '@/lib/api'
import { cn, timeAgo } from '@/lib/format'
import { shortPath } from '@/lib/org'
import { useAppStore } from '@/store/useAppStore'

/**
 * Startup project picker ("Which projects should we open?") and the start screen shown
 * when no project tab is open. Both share the recent list and the
 * "New project" / "Open folder…" actions.
 */

/** "5 min ago" / "just now" / "never opened". */
function openedAgo(iso: string | null | undefined): string {
  if (!iso) return t('project:launcher.neverOpened')
  const ago = timeAgo(iso)
  return ago === t('time.now') ? t('project:launcher.justNow') : t('project:launcher.ago', { time: ago })
}

/** Most recently opened first; never-opened projects after, by creation. */
function byRecent(a: Project, b: Project): number {
  if (a.lastOpenedAt && b.lastOpenedAt) return b.lastOpenedAt.localeCompare(a.lastOpenedAt)
  if (a.lastOpenedAt) return -1
  if (b.lastOpenedAt) return 1
  return a.createdAt.localeCompare(b.createdAt)
}

function useRecentProjects(): { active: Project[]; archived: Project[] } {
  const projects = useAppStore((s) => s.projects)
  return useMemo(
    () => ({
      active: projects.filter((p) => p.status === 'active').sort(byRecent),
      archived: projects.filter((p) => p.status === 'archived').sort(byRecent)
    }),
    [projects]
  )
}

/** Folder state per project, refreshed whenever `trigger` changes. */
function useFolderStatus(trigger: unknown): Record<string, FolderStatus> {
  const [status, setStatus] = useState<Record<string, FolderStatus>>({})
  useEffect(() => {
    let alive = true
    call('projects:folderStatus')
      .then((s) => alive && setStatus(s))
      .catch(() => alive && setStatus({}))
    return () => {
      alive = false
    }
  }, [trigger])
  return status
}

function useRunningByProject(): Map<string, number> {
  const activeRuns = useAppStore((s) => s.activeRuns)
  return useMemo(() => {
    const m = new Map<string, number>()
    for (const r of activeRuns) if (r.projectId && r.status === 'running') m.set(r.projectId, (m.get(r.projectId) ?? 0) + 1)
    return m
  }, [activeRuns])
}

/** Unarchives where needed, then opens the projects as tabs. */
async function openSelected(ids: string[]): Promise<boolean> {
  const st = useAppStore.getState()
  const ok: string[] = []
  for (const id of ids) {
    const p = st.projects.find((x) => x.id === id)
    if (!p) continue
    if (p.status === 'archived') {
      try {
        const saved = await call('projects:save', { status: 'active' }, p.id)
        useAppStore.setState((s) => ({ projects: s.projects.map((x) => (x.id === saved.id ? saved : x)) }))
      } catch (e) {
        st.toast('error', t('project:launcher.unarchiveFailed', { name: p.name, error: apiError(e) }))
        continue
      }
    }
    ok.push(id)
  }
  if (!ok.length) {
    st.toast('error', t('project:launcher.openFailed'))
    return false
  }
  useAppStore.getState().openProjects(ok)
  return true
}

/** "Open folder…": pick a folder → open its project, or start a new project for it. */
export function useOpenFolder(): { openFolder: () => Promise<void>; busy: boolean } {
  const [busy, setBusy] = useState(false)
  const openFolder = useCallback(async () => {
    const st = useAppStore.getState()
    setBusy(true)
    try {
      const dir = await call('app:pickFolder')
      if (!dir) return
      const f = await call('projects:inspectFolder', dir)
      if (!f.exists || !f.isDirectory) {
        st.toast('error', t('project:folderNotFoundPath', { path: f.path }))
        return
      }
      if (f.isAppFolder || f.tooBroad) {
        st.toast('error', t(f.isAppFolder ? 'project:launcher.appFolder' : 'project:folderTooBroad'))
        return
      }
      if (f.projectId) {
        const p = st.projects.find((x) => x.id === f.projectId)
        if (p && (await openSelected([p.id]))) st.toast('info', t('project:launcher.alreadyProject', { name: p.name }))
        return
      }
      st.openProjectModal(null, { name: f.suggestedName, rootPath: f.path })
    } catch (e) {
      st.toast('error', apiError(e))
    } finally {
      setBusy(false)
    }
  }, [])
  return { openFolder, busy }
}

/* ───────────────────────────── startup picker ───────────────────────────── */

export function ProjectLauncher() {
  const { t } = useTranslation()
  const { open, preselect } = useAppStore((s) => s.launcher)
  const close = useAppStore((s) => s.closeLauncher)
  const openProjectModal = useAppStore((s) => s.openProjectModal)
  const startup = useAppStore((s) => s.settings.startupProjects)
  const openIds = useAppStore((s) => s.openProjectIds)
  const toast = useAppStore((s) => s.toast)
  const { active, archived } = useRecentProjects()
  const status = useFolderStatus(open)
  const running = useRunningByProject()
  const { openFolder, busy: picking } = useOpenFolder()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [busy, setBusy] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  /** The user changed the selection; stop adjusting the automatic preselection. */
  const touched = useRef(false)
  // Optimistic copy of the setting so the checkbox reacts immediately.
  const [restore, setRestore] = useState(startup === 'restore')
  useEffect(() => setRestore(startup === 'restore'), [startup])

  const firstRun = useMemo(() => active.every((p) => !p.lastOpenedAt) && preselect.length === 0, [active, preselect])

  // Pre-check the last session's tabs (or the most recent project) each time the picker opens.
  useEffect(() => {
    if (!open) return
    setQuery('')
    setShowArchived(false)
    setBusy(false)
    touched.current = false
    const st = useAppStore.getState()
    const live = new Set(st.projects.filter((p) => p.status === 'active').map((p) => p.id))
    let pre = preselect.filter((id) => live.has(id) && !st.openProjectIds.includes(id))
    if (!pre.length) {
      const recent = st.projects
        .filter((p) => p.status === 'active' && p.lastOpenedAt && !st.openProjectIds.includes(p.id))
        .sort(byRecent)[0]
      pre = recent ? [recent.id] : []
    }
    setSelected(new Set(pre))
  }, [open, preselect])

  // Don't pre-check projects whose folder is gone; they are still listed with a warning.
  useEffect(() => {
    if (!open || touched.current) return
    const missing = Object.entries(status).filter(([, v]) => v === 'missing').map(([id]) => id)
    if (missing.length) setSelected((sel) => new Set([...sel].filter((id) => !missing.includes(id))))
  }, [open, status])

  const q = query.trim().toLocaleLowerCase(locale())
  const match = useCallback(
    (p: Project) => !q || p.name.toLocaleLowerCase(locale()).includes(q) || p.rootPath.toLocaleLowerCase(locale()).includes(q),
    [q]
  )
  const shownActive = useMemo(() => active.filter(match), [active, match])
  const shownArchived = useMemo(() => archived.filter(match), [archived, match])

  const toggle = (id: string): void => {
    touched.current = true
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  // Keep only ids that still exist (a project may be deleted while the picker is open).
  const chosen = useMemo(() => {
    const all = new Set([...active, ...archived].map((p) => p.id))
    const order = [...active, ...archived].map((p) => p.id)
    return order.filter((id) => selected.has(id) && all.has(id))
  }, [selected, active, archived])

  const submit = async (ids = chosen): Promise<void> => {
    if (!ids.length || busy) return
    setBusy(true)
    try {
      await openSelected(ids)
    } finally {
      setBusy(false)
    }
  }

  const setStartup = async (value: boolean): Promise<void> => {
    setRestore(value)
    try {
      await call('settings:update', { startupProjects: value ? 'restore' : 'ask' })
    } catch (e) {
      setRestore(!value)
      toast('error', apiError(e))
    }
  }

  const total = active.length + archived.length

  return (
    <Modal
      open={open}
      onClose={close}
      width={620}
      title={
        <span className="flex items-center gap-2">
          <Logo size={18} /> {t('project:launcher.title')}
        </span>
      }
      footer={
        <div className="flex w-full items-center gap-3">
          <label className="mr-auto flex cursor-pointer items-center gap-2 text-[12px] text-zinc-400" title={t('project:launcher.restoreHint')}>
            <input
              type="checkbox"
              className="accent-indigo-500"
              checked={restore}
              onChange={(e) => void setStartup(e.target.checked)}
            />
            {t('project:launcher.restore')}
          </label>
          <button className="btn-ghost" onClick={close}>
            {openIds.length ? t('actions.close') : t('project:launcher.skip')}
          </button>
          <button id="launcher-open" className="btn-primary" disabled={!chosen.length || busy} onClick={() => void submit()}>
            <FolderOpen size={14} /> {chosen.length > 1 ? t('project:launcher.openCount', { count: chosen.length }) : t('actions.open')}
          </button>
        </div>
      }
    >
      <div
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
            e.preventDefault()
            void submit()
          }
        }}
      >
        {firstRun && (
          <p className="mb-3 text-[12.5px] text-zinc-400">
            {t('project:launcher.firstRun')}
          </p>
        )}
        <div className="mb-4 grid grid-cols-2 gap-2.5">
          <ActionCard
            icon={<Plus size={16} />}
            title={t('project:newProject')}
            desc={t('project:launcher.newProjectDesc')}
            onClick={() => openProjectModal(null)}
            highlight={firstRun}
          />
          <ActionCard
            icon={<FolderPlus size={16} />}
            title={t('project:openFolder')}
            desc={t('project:launcher.openFolderDesc')}
            onClick={() => void openFolder()}
            disabled={picking}
            highlight={firstRun}
          />
        </div>

        {total > 0 && (
          <>
            <div className="mb-2 flex items-center gap-3">
              <div className="panel-title">{firstRun ? t('project:launcher.existingProjects') : t('project:recentProjects')}</div>
              {total > 6 && (
                <div className="relative ml-auto w-56">
                  <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
                  <input
                    ref={searchRef}
                    className="input h-7 pl-7 text-[12px]"
                    placeholder={t('project:launcher.searchPlaceholder')}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
              )}
            </div>
            <div className="space-y-1" role="listbox" aria-multiselectable>
              {shownActive.map((p) => (
                <LauncherRow
                  key={p.id}
                  project={p}
                  checked={selected.has(p.id)}
                  isOpen={openIds.includes(p.id)}
                  folder={status[p.id]}
                  running={running.get(p.id) ?? 0}
                  onToggle={() => toggle(p.id)}
                  onOpenNow={() => void submit([p.id])}
                />
              ))}
              {shownActive.length === 0 && <div className="px-2 py-3 text-[12px] text-zinc-500">{t('project:launcher.noMatch')}</div>}
            </div>
            {archived.length > 0 && (
              <div className="mt-3">
                <button
                  className="flex items-center gap-1.5 px-1 text-[11.5px] text-zinc-400 hover:text-zinc-200"
                  onClick={() => setShowArchived((v) => !v)}
                >
                  <ChevronRight size={12} className={cn('transition-transform', showArchived && 'rotate-90')} />
                  <Archive size={12} /> {t('project:launcher.archivedCount', { count: archived.length })}
                </button>
                {showArchived && (
                  <div className="mt-1 space-y-1">
                    {shownArchived.map((p) => (
                      <LauncherRow
                        key={p.id}
                        project={p}
                        checked={selected.has(p.id)}
                        isOpen={false}
                        folder={status[p.id]}
                        running={0}
                        onToggle={() => toggle(p.id)}
                        onOpenNow={() => void submit([p.id])}
                      />
                    ))}
                    <div className="px-2 text-[11px] text-zinc-500">{t('project:launcher.archivedHint')}</div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}

function ActionCard({
  icon,
  title,
  desc,
  onClick,
  disabled,
  highlight
}: {
  icon: React.ReactNode
  title: string
  desc: string
  onClick: () => void
  disabled?: boolean
  highlight?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex items-start gap-3 rounded-lg border p-3 text-left transition-colors disabled:opacity-50',
        highlight ? 'border-indigo-500/40 bg-indigo-500/[0.07] hover:bg-indigo-500/[0.12]' : 'border-line bg-surface hover:bg-white/[0.03]'
      )}
    >
      <span className={cn('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md', highlight ? 'bg-indigo-500/20 text-indigo-200' : 'bg-white/5 text-zinc-300')}>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-zinc-100">{title}</span>
        <span className="block text-[11.5px] leading-snug text-zinc-400">{desc}</span>
      </span>
    </button>
  )
}

function FolderBadge({ folder }: { folder: FolderStatus | undefined }) {
  const { t } = useTranslation()
  if (folder === 'missing')
    return (
      <span className="flex shrink-0 items-center gap-1 rounded bg-amber-500/10 px-1.5 py-px text-[10.5px] text-amber-300" title={t('project:launcher.folderMissingTitle')}>
        <TriangleAlert size={10} /> {t('project:launcher.folderMissing')}
      </span>
    )
  if (folder === 'unset') return <span className="shrink-0 text-[10.5px] text-zinc-500">{t('project:launcher.folderUnset')}</span>
  return null
}

function LauncherRow({
  project,
  checked,
  isOpen,
  folder,
  running,
  onToggle,
  onOpenNow
}: {
  project: Project
  checked: boolean
  isOpen: boolean
  folder: FolderStatus | undefined
  running: number
  onToggle: () => void
  onOpenNow: () => void
}) {
  const { t } = useTranslation()
  const archived = project.status === 'archived'
  return (
    <div
      role="option"
      aria-selected={checked}
      tabIndex={0}
      data-project={project.name}
      onClick={onToggle}
      onDoubleClick={onOpenNow}
      onKeyDown={(e) => {
        if (e.key === ' ') {
          e.preventDefault()
          onToggle()
        }
      }}
      title={t('project:launcher.rowTitle')}
      className={cn(
        'group flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 outline-none transition-colors focus-visible:ring-1 focus-visible:ring-indigo-400',
        checked ? 'border-indigo-500/40 bg-indigo-500/[0.06]' : 'border-line hover:bg-white/[0.025]'
      )}
    >
      <span
        className={cn(
          'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
          checked ? 'border-indigo-400 bg-indigo-500 text-white' : 'border-zinc-600'
        )}
      >
        {checked && <Check size={11} strokeWidth={3} />}
      </span>
      <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', archived && 'opacity-50')} style={{ background: project.color }} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cn('truncate text-[13px]', archived ? 'text-zinc-400' : 'text-zinc-100')}>{project.name}</span>
          {isOpen && <span className="shrink-0 rounded bg-white/5 px-1.5 text-[10px] text-zinc-400">{t('project:launcher.open')}</span>}
          {running > 0 && (
            <span className="flex shrink-0 items-center gap-1 rounded bg-emerald-500/15 px-1.5 text-[10px] text-emerald-300">
              <span className="h-1 w-1 animate-pulse rounded-full bg-emerald-400" /> {t('project:launcher.running', { count: running })}
            </span>
          )}
        </div>
        <div className="truncate font-mono text-[10.5px] text-zinc-500" title={project.rootPath}>
          {project.rootPath ? shortPath(project.rootPath, 60) : '—'}
        </div>
      </div>
      <FolderBadge folder={folder} />
      <button
        className="icon-btn h-6 w-6 shrink-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
        title={t('project:launcher.settingsTitle')}
        aria-label={t('project:launcher.settingsAria', { name: project.name })}
        data-testid="launcher-project-settings"
        onClick={(e) => {
          e.stopPropagation()
          useAppStore.getState().openProjectModal(project.id, undefined, { fromLauncher: true })
        }}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <Settings2 size={13} />
      </button>
      <span className="w-16 shrink-0 text-right text-[11px] text-zinc-500">
        {openedAgo(project.lastOpenedAt)}
      </span>
    </div>
  )
}

/* ───────────────────────────── start screen (no tab open) ───────────────────────────── */

export function ProjectHome() {
  const { t } = useTranslation()
  const openLauncher = useAppStore((s) => s.openLauncher)
  const openProjectModal = useAppStore((s) => s.openProjectModal)
  const showOrg = useAppStore((s) => s.showOrg)
  const { active } = useRecentProjects()
  const status = useFolderStatus(active.length)
  const { openFolder, busy } = useOpenFolder()
  const recent = active.slice(0, 5)

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto p-8">
      <div className="w-[520px] max-w-full">
        <div className="mb-6 flex flex-col items-center text-center">
          <Logo size={40} />
          <h1 className="mt-3 text-[18px] font-semibold text-zinc-100">{t('project:home.title')}</h1>
          <p className="mt-1 text-[12.5px] text-zinc-400">{t('project:home.subtitle')}</p>
        </div>
        <div className="mb-6 grid grid-cols-3 gap-2">
          <button className="btn-primary h-9 justify-center" onClick={openLauncher} disabled={!active.length}>
            <FolderOpen size={14} /> {t('project:home.openProject')}
          </button>
          <button className="btn-outline h-9 justify-center" onClick={() => openProjectModal(null)}>
            <Plus size={14} /> {t('project:newProject')}
          </button>
          <button className="btn-outline h-9 justify-center" onClick={() => void openFolder()} disabled={busy}>
            <FolderPlus size={14} /> {t('project:openFolder')}
          </button>
        </div>
        {recent.length > 0 && (
          <>
            <div className="panel-title mb-2 px-1">{t('project:recentProjects')}</div>
            <div className="card divide-y divide-line">
              {recent.map((p) => (
                <button
                  key={p.id}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-white/[0.03]"
                  onClick={() => useAppStore.getState().openProject(p.id)}
                >
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: p.color }} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] text-zinc-100">{p.name}</div>
                    <div className="truncate font-mono text-[10.5px] text-zinc-500">{p.rootPath ? shortPath(p.rootPath, 56) : t('project:launcher.folderUnset')}</div>
                  </div>
                  <FolderBadge folder={status[p.id] === 'unset' ? undefined : status[p.id]} />
                  <span className="shrink-0 text-[11px] text-zinc-500">{openedAgo(p.lastOpenedAt)}</span>
                </button>
              ))}
            </div>
          </>
        )}
        <div className="mt-5 text-center text-[11.5px] text-zinc-500">
          <button className="hover:text-zinc-300 hover:underline" onClick={() => showOrg()}>
            {t('project:home.goToOrg')}
          </button>
          <span className="mx-2">·</span>
          <span>{t('project:home.shortcut')}</span>
        </div>
      </div>
    </div>
  )
}
