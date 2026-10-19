import { useEffect, useMemo, useState } from 'react'
import { Archive, Check, Database, FolderOpen, Info, Trash2, TriangleAlert, X } from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'
import type { ProjectInput } from '@shared/types'
import { descendantIds, projectMemberIds } from '@shared/org'
import { PixelAvatar } from '@/components/common/PixelAvatar'
import { Modal, Toggle } from '@/components/common/ui'
import { flattenTree, KIND_META } from '@/features/org/meta'
import { locale, t as tr } from '@/i18n'
import { apiError, call } from '@/lib/api'
import { cn } from '@/lib/format'
import { autoProjectLead, isCliProvider, PROJECT_COLORS } from '@/lib/org'
import { useAppStore } from '@/store/useAppStore'

interface Form {
  name: string
  description: string
  rootPath: string
  color: string
  unitIds: string[]
  leadAgentId: string | null
  archived: boolean
  worktree: boolean
  projectMemory: boolean
}

const EMPTY: Form = { name: '', description: '', rootPath: '', color: PROJECT_COLORS[0], unitIds: [], leadAgentId: null, archived: false, worktree: false, projectMemory: true }

/** Create / edit a project: name, folder, color, assigned units (teams), lead, archive & delete. */
export function ProjectModal() {
  const { t } = useTranslation()
  const { open, projectId, draft } = useAppStore((s) => s.projectModal)
  const close = useAppStore((s) => s.closeProjectModal)
  const projects = useAppStore((s) => s.projects)
  const units = useAppStore((s) => s.units)
  const agents = useAppStore((s) => s.agents)
  const providers = useAppStore((s) => s.providers)
  const openProject = useAppStore((s) => s.openProject)
  const toast = useAppStore((s) => s.toast)
  const openSettings = useAppStore((s) => s.openSettings)
  const project = projectId ? projects.find((p) => p.id === projectId) : undefined
  const editing = !!project
  // Deleting the default project hands its role to another one; the last project cannot be deleted.
  const canDelete = !!project && (!project.isDefault || projects.length > 1)
  const [form, setForm] = useState<Form>(EMPTY)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  /** Problem with the chosen / saved folder (shown under the folder field). */
  const [folderError, setFolderError] = useState<string | null>(null)

  // Reset the form whenever the modal opens (or switches project).
  useEffect(() => {
    if (!open) return
    setError(null)
    setConfirmDelete(false)
    setBusy(false)
    setFolderError(null)
    const p = projectId ? useAppStore.getState().projects.find((x) => x.id === projectId) : undefined
    if (p?.rootPath) {
      // An existing project may point at a folder that was moved or deleted.
      call('projects:inspectFolder', p.rootPath)
        .then((f) => !f.exists && setFolderError(tr('project:modal.folderMissing')))
        .catch(() => undefined)
    }
    if (p) {
      setForm({
        name: p.name,
        description: p.description,
        rootPath: p.rootPath,
        color: p.color,
        unitIds: p.unitIds,
        leadAgentId: p.leadAgentId,
        archived: p.status === 'archived',
        worktree: p.isolation === 'worktree',
        projectMemory: p.projectMemory
      })
    } else {
      const used = new Set(useAppStore.getState().projects.map((x) => x.color))
      setForm({
        ...EMPTY,
        name: draft?.name ?? '',
        rootPath: draft?.rootPath ?? '',
        color: PROJECT_COLORS.find((c) => !used.has(c)) ?? PROJECT_COLORS[0]
      })
    }
  }, [open, projectId, draft])

  const set = <K extends keyof Form>(k: K, v: Form[K]): void => setForm((f) => ({ ...f, [k]: v }))

  const tree = useMemo(() => flattenTree(units), [units])
  /** Units covered by an ancestor that is checked → shown as "dahil" and disabled. */
  const implied = useMemo(() => {
    const out = new Set<string>()
    for (const id of form.unitIds) for (const d of descendantIds(units, id)) if (d !== id) out.add(d)
    return out
  }, [form.unitIds, units])
  const memberIds = useMemo(() => new Set(projectMemberIds({ unitIds: form.unitIds }, units)), [form.unitIds, units])
  const members = useMemo(() => agents.filter((a) => memberIds.has(a.id)), [agents, memberIds])
  const autoLead = useMemo(() => autoProjectLead({ unitIds: form.unitIds }, units, agents), [form.unitIds, units, agents])
  const leadValid = form.leadAgentId && memberIds.has(form.leadAgentId) ? form.leadAgentId : null

  const defaultProvider = providers.find((p) => p.isDefault) ?? providers[0]
  const cli = isCliProvider(defaultProvider)

  const toggleUnit = (id: string): void => {
    if (implied.has(id)) return
    setForm((f) => {
      if (f.unitIds.includes(id)) return { ...f, unitIds: f.unitIds.filter((x) => x !== id) }
      // Checking a parent makes its explicitly checked sub-units redundant.
      const sub = new Set(descendantIds(units, id))
      return { ...f, unitIds: [...f.unitIds.filter((x) => !sub.has(x)), id] }
    })
  }

  const pickFolder = async (): Promise<void> => {
    try {
      const dir = await call('app:pickFolder')
      if (!dir) return
      const f = await call('projects:inspectFolder', dir)
      if (!f.exists || !f.isDirectory) return setFolderError(t('project:folderNotFoundPath', { path: f.path }))
      if (f.isAppFolder) return setFolderError(t('project:modal.folderIsApp'))
      if (f.tooBroad) return setFolderError(t('project:folderTooBroad'))
      if (f.projectId && f.projectId !== projectId) {
        const other = useAppStore.getState().projects.find((x) => x.id === f.projectId)
        return setFolderError(t('project:modal.folderInUse', { name: other?.name ?? t('project:modal.otherProject') }))
      }
      setFolderError(null)
      set('rootPath', f.path)
      // New project without a name yet: suggest the folder name.
      if (!editing && !form.name.trim()) set('name', f.suggestedName)
    } catch (e) {
      setFolderError(apiError(e))
    }
  }

  const submit = async (): Promise<void> => {
    if (!form.name.trim() || busy) return
    setBusy(true)
    setError(null)
    const input: ProjectInput = {
      name: form.name.trim(),
      description: form.description.trim(),
      rootPath: form.rootPath,
      color: form.color,
      unitIds: form.unitIds,
      leadAgentId: leadValid,
      isolation: form.worktree ? 'worktree' : 'shared',
      projectMemory: form.projectMemory,
      ...(editing ? { status: form.archived ? 'archived' : 'active' } : {})
    }
    try {
      const saved = await call('projects:save', input, project?.id)
      // Put it in the store right away so the new tab can render before the change event lands.
      useAppStore.setState((s) => ({ projects: s.projects.some((p) => p.id === saved.id) ? s.projects.map((p) => (p.id === saved.id ? saved : p)) : [...s.projects, saved] }))
      if (!editing) {
        openProject(saved.id)
        toast('success', t('project:modal.created', { name: saved.name }))
      } else {
        toast('success', saved.status === 'archived' ? t('project:modal.archived', { name: saved.name }) : t('project:modal.saved'))
      }
      close()
    } catch (e) {
      setError(apiError(e))
      setBusy(false)
    }
  }

  const remove = async (): Promise<void> => {
    if (!project) return
    setBusy(true)
    try {
      await call('projects:delete', project.id)
      toast('success', t('project:modal.deleted', { name: project.name }))
      close()
    } catch (e) {
      setError(apiError(e))
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      width={640}
      title={editing ? t('project:settings') : t('project:newProject')}
      footer={
        <>
          <button className="btn-ghost" onClick={close}>
            {t('actions.cancel')}
          </button>
          <button className="btn-primary" disabled={!form.name.trim() || busy} onClick={() => void submit()}>
            {editing ? t('actions.save') : t('project:modal.create')}
          </button>
        </>
      }
    >
      <div className="space-y-5" onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && void submit()}>
        <div className="grid grid-cols-[1fr_auto] gap-4">
          <div>
            <label className="label">{t('project:modal.name')}</label>
            <input
              autoFocus
              className="input"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.ctrlKey && void submit()}
              placeholder={t('project:modal.namePlaceholder')}
            />
          </div>
          <div>
            <label className="label">{t('project:modal.color')}</label>
            <div className="flex h-8 items-center gap-1">
              {PROJECT_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => set('color', c)}
                  title={c}
                  className={cn('flex h-5 w-5 items-center justify-center rounded-full ring-offset-2 ring-offset-surface transition', form.color === c ? 'ring-2 ring-zinc-300' : 'hover:scale-110')}
                  style={{ background: c }}
                >
                  {form.color === c && <Check size={11} className="text-white" />}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div>
          <label className="label">{t('project:modal.description')}</label>
          <textarea className="textarea" rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} placeholder={t('project:modal.descriptionPlaceholder')} />
        </div>

        <div>
          <label className="label">{t('project:modal.folder')}</label>
          <div className={cn('flex items-center gap-2.5 rounded-md border px-3 py-2', form.rootPath ? 'border-line bg-surface-2' : 'border-dashed border-line bg-surface-2/50')}>
            <FolderOpen size={16} className={form.rootPath ? 'text-indigo-300' : 'text-zinc-500'} />
            <div className={cn('selectable min-w-0 flex-1 truncate font-mono text-[12px]', form.rootPath ? 'text-zinc-200' : 'text-zinc-500')} title={form.rootPath}>
              {form.rootPath || t('project:modal.noFolder')}
            </div>
            <button className="btn-outline h-7" onClick={() => void pickFolder()}>
              {form.rootPath ? t('actions.change') : t('actions.chooseFolder')}
            </button>
            {form.rootPath && (
              <button
                className="btn-ghost h-7 px-2"
                title={t('project:modal.removeFolder')}
                onClick={() => {
                  set('rootPath', '')
                  setFolderError(null)
                }}
              >
                <X size={13} /> {t('actions.remove')}
              </button>
            )}
          </div>
          {folderError && (
            <div className="mt-1.5 flex items-start gap-1.5 text-[11.5px] text-rose-300">
              <TriangleAlert size={12} className="mt-px shrink-0" />
              {folderError}
            </div>
          )}
          {cli && !form.rootPath ? (
            <div className="mt-1.5 flex items-start gap-1.5 text-[11.5px] text-amber-300/90">
              <TriangleAlert size={12} className="mt-px shrink-0" />
              {t('project:modal.folderRequired', { provider: defaultProvider?.label })}
            </div>
          ) : (
            <div className="mt-1.5 text-[11.5px] text-zinc-500">{t('project:modal.folderHint')}</div>
          )}
          <div className="mt-3 flex items-start gap-3 rounded-md border border-line bg-surface-2/60 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] text-zinc-200">{t('project:modal.worktree.title')}</div>
              <div className="mt-0.5 text-[11.5px] text-zinc-400">{t('project:modal.worktree.desc')}</div>
            </div>
            <Toggle checked={form.worktree} onChange={(v) => set('worktree', v)} />
          </div>
          <div className="mt-2 flex items-start gap-3 rounded-md border border-line bg-surface-2/60 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] text-zinc-200">{t('project:modal.projectMemory.title')}</div>
              <div className="mt-0.5 text-[11.5px] text-zinc-400">{t('project:modal.projectMemory.desc')}</div>
            </div>
            <Toggle checked={form.projectMemory} onChange={(v) => set('projectMemory', v)} />
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-baseline justify-between">
            <label className="label mb-0">{t('project:modal.teams')}</label>
            <span className="text-[11px] text-zinc-500">{t('project:modal.teamsHint')}</span>
          </div>
          <div className="max-h-[220px] overflow-y-auto rounded-md border border-line bg-surface-2/60 py-1">
            {tree.length === 0 && <div className="px-3 py-3 text-[12px] text-zinc-400">{t('project:modal.noUnits')}</div>}
            {tree.map(({ unit, depth }) => {
              const checked = form.unitIds.includes(unit.id)
              const inc = implied.has(unit.id)
              const Icon = KIND_META[unit.kind].icon
              const count = unit.members.length
              return (
                <button
                  key={unit.id}
                  disabled={inc}
                  onClick={() => toggleUnit(unit.id)}
                  className={cn('flex w-full items-center gap-2 py-1.5 pr-3 text-left transition-colors', inc ? 'cursor-default' : 'hover:bg-white/[0.04]')}
                  style={{ paddingLeft: 10 + depth * 18 }}
                >
                  <span
                    className={cn(
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                      checked ? 'border-indigo-500 bg-indigo-500 text-white' : inc ? 'border-indigo-500/40 bg-indigo-500/20 text-indigo-200' : 'border-zinc-600'
                    )}
                  >
                    {(checked || inc) && <Check size={11} />}
                  </span>
                  <Icon size={13} className="shrink-0" style={{ color: unit.color }} />
                  <span className={cn('truncate text-[12.5px]', checked ? 'text-zinc-100' : inc ? 'text-zinc-400' : 'text-zinc-300')}>{unit.name}</span>
                  {unit.kind !== 'organization' && <span className="shrink-0 text-[10.5px] text-zinc-500">{KIND_META[unit.kind].label.toLocaleLowerCase(locale())}</span>}
                  {inc && <span className="shrink-0 rounded bg-indigo-500/10 px-1 text-[10px] text-indigo-300">{t('project:modal.included')}</span>}
                  <span className="ml-auto shrink-0 font-mono text-[10.5px] text-zinc-500">{count > 0 ? t('project:people', { count }) : ''}</span>
                </button>
              )
            })}
          </div>
          <div className="mt-2 flex items-center gap-3">
            <div className="flex -space-x-1.5">
              {members.slice(0, 12).map((a) => (
                <PixelAvatar key={a.id} agent={a} size={24} className="rounded-md ring-2 ring-surface" />
              ))}
            </div>
            <span className="text-[12px] text-zinc-400">
              {members.length ? (
                <>
                  <Trans i18nKey="project:modal.membersWillWork" count={members.length} components={{ hl: <span className="text-zinc-200" /> }} />
                  {members.length > 12 && ` (+${members.length - 12})`}
                </>
              ) : (
                t('project:modal.noTeams')
              )}
            </span>
          </div>
        </div>

        <div>
          <label className="label">{t('project:lead')}</label>
          <select className="input" value={leadValid ?? ''} onChange={(e) => set('leadAgentId', e.target.value || null)}>
            <option value="">{autoLead ? t('project:autoLeadNamed', { name: autoLead.name }) : t('project:autoLead')}</option>
            {members.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.role}
              </option>
            ))}
          </select>
          <div className="mt-1.5 text-[11.5px] text-zinc-500">{t('project:modal.leadHint')}</div>
        </div>

        {editing && project && (
          <div className="space-y-3 border-t border-line pt-4">
            <div className="flex items-center gap-3">
              <Archive size={15} className="text-zinc-400" />
              <div className="flex-1">
                <div className="text-[13px] text-zinc-200">{t('project:modal.archive')}</div>
                <div className="text-[11.5px] text-zinc-400">{t('project:modal.archiveHint')}</div>
              </div>
              <Toggle checked={form.archived} onChange={(v) => set('archived', v)} />
            </div>
            <div className="flex items-center gap-3">
              <Database size={15} className="text-zinc-400" />
              <div className="flex-1">
                <div className="text-[13px] text-zinc-200">{t('project:modal.clearData')}</div>
                <div className="text-[11.5px] text-zinc-400">{t('project:modal.clearDataHint')}</div>
              </div>
              <button
                className="btn-outline h-7"
                onClick={() => {
                  // Going to settings: do not bounce back to the project picker.
                  useAppStore.setState((st) => ({ projectModal: { ...st.projectModal, fromLauncher: false } }))
                  close()
                  openSettings('data', project.id)
                }}
              >
                {t('project:modal.manageData')}
              </button>
            </div>
            {canDelete ? (
              confirmDelete ? (
                <div className="rounded-md border border-rose-500/30 bg-rose-500/[0.06] p-3" ref={(el) => el?.scrollIntoView({ block: 'nearest' })}>
                  <div className="text-[12.5px] text-rose-200">
                    <Trans i18nKey="project:modal.deleteConfirm" values={{ name: project.name }} components={{ b: <span className="font-semibold" /> }} />
                  </div>
                  <div className="mt-1 text-[11.5px] text-rose-200/70">
                    {t('project:modal.deleteDetail')} <span className="font-semibold text-zinc-200">{t('project:modal.deleteKeepsFolder')}</span>
                    {project.isDefault && ` ${t('project:modal.deleteDefaultNote')}`}
                  </div>
                  <div className="mt-2.5 flex gap-2">
                    <button className="btn h-7 bg-rose-600 text-white hover:bg-rose-500" disabled={busy} onClick={() => void remove()}>
                      <Trash2 size={13} /> {t('actions.yesDelete')}
                    </button>
                    <button className="btn-ghost h-7" onClick={() => setConfirmDelete(false)}>
                      {t('actions.cancel')}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <Trash2 size={15} className="text-rose-400/80" />
                  <div className="flex-1">
                    <div className="text-[13px] text-zinc-200">{t('project:modal.deleteTitle')}</div>
                    <div className="text-[11.5px] text-zinc-400">{t('project:modal.deleteHint')}</div>
                  </div>
                  <button className="btn-danger h-7 border border-rose-500/30" onClick={() => setConfirmDelete(true)}>
                    {t('actions.deleteEllipsis')}
                  </button>
                </div>
              )
            ) : (
              <div className="flex items-center gap-2 text-[11.5px] text-zinc-500">
                <Info size={12} /> {t('project:modal.cannotDelete')}
              </div>
            )}
          </div>
        )}

        {error && <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-200">{error}</div>}
      </div>
    </Modal>
  )
}
