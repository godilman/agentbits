import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BriefcaseBusiness,
  Check,
  Copy,
  Cpu,
  FolderOpen,
  IdCard,
  MessageSquare,
  Plus,
  Shield,
  Shuffle,
  SquarePlus,
  Star,
  Trash2,
  TriangleAlert,
  X
} from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'
import { ModelSelect } from '@/features/settings/ModelSelect'
import { AgentSkills } from '@/features/skills/AgentSkills'
import { AgentApps } from '@/features/apps/AgentApps'
import type { Agent, AgentInput, PermissionsPatch } from '@shared/types'
import { PixelAvatar } from '@/components/common/PixelAvatar'
import { ProgressBar, Toggle } from '@/components/common/ui'
import { apiError, call } from '@/lib/api'
import { cn, STATUS_META } from '@/lib/format'
import { useAppStore } from '@/store/useAppStore'
import { HAIRS, PERMISSIONS, SHIRTS, SKINS, randomLook } from './constants'
import { AgentUnits } from './AgentUnits'
import { ShareCard } from '@/features/org/Share'
import { Field, Section, Swatches, TagInput } from './parts'

type TextKey = 'name' | 'role' | 'jobDescription' | 'persona'

export function AgentEditor({ agent }: { agent: Agent }) {
  const { t } = useTranslation()
  const agents = useAppStore((s) => s.agents)
  const providers = useAppStore((s) => s.providers)
  const toast = useAppStore((s) => s.toast)
  const [form, setForm] = useState<Record<TextKey, string>>({
    name: agent.name,
    role: agent.role,
    jobDescription: agent.jobDescription,
    persona: agent.persona
  })
  const [nameError, setNameError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])

  const flash = (): void => {
    setSaved(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setSaved(false), 1600)
  }

  const save = async (patch: AgentInput): Promise<boolean> => {
    try {
      await call('agents:save', patch, agent.id)
      flash()
      return true
    } catch (e) {
      const msg = apiError(e)
      if (patch.name !== undefined) setNameError(msg)
      else toast('error', msg)
      return false
    }
  }

  const savePerms = async (patch: PermissionsPatch): Promise<void> => {
    try {
      await call('permissions:update', agent.id, patch)
      flash()
    } catch (e) {
      toast('error', apiError(e))
    }
  }

  const blur = (k: TextKey): void => {
    const v = form[k].trim()
    if (k === 'name') {
      if (!v) return setNameError(t('agents:editor.nameRequired'))
      setNameError(null)
    }
    if (v === (agent[k] ?? '')) return
    void save({ [k]: v })
  }

  const text = (k: TextKey) => ({
    value: form[k],
    onChange: (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value })),
    onBlur: () => blur(k)
  })

  const defaultProvider = providers.find((p) => p.isDefault) ?? providers[0]
  const agentProvider = providers.find((p) => p.id === agent.providerId) ?? defaultProvider

  return (
    <div className="pb-16">
      {/* sticky profile header */}
      <div className="sticky top-0 z-10 border-b border-line bg-canvas/90 backdrop-blur">
        <div className="mx-auto flex max-w-[880px] items-center gap-4 px-8 py-4">
          <PixelAvatar agent={agent} size={44} showStatus className={!agent.enabled ? 'opacity-50 grayscale' : ''} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-[16px] font-semibold text-zinc-100">{agent.name}</h2>
              {agent.isLead && (
                <span className="rounded bg-indigo-500/15 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-indigo-300">{t('agents:editor.badges.lead')}</span>
              )}
              {!agent.enabled && <span className="rounded bg-white/5 px-1.5 py-px text-[10px] font-medium text-zinc-400">{t('agents:editor.badges.inactive')}</span>}
            </div>
            <div className="truncate text-[12.5px] text-zinc-400">{agent.role || t('agents:editor.noRole')}</div>
          </div>
          <span
            className={cn(
              'flex items-center gap-1 text-[11.5px] text-emerald-400 transition-opacity duration-300',
              saved ? 'opacity-100' : 'opacity-0'
            )}
            aria-live="polite"
          >
            <Check size={13} /> {t('status.saved')}
          </span>
          <AgentActions agent={agent} />
        </div>
      </div>

      <div className="mx-auto max-w-[880px] space-y-4 px-8 pt-6">
        <StatusCard agent={agent} />

        {/* identity */}
        <Section icon={IdCard} title={t('agents:editor.identity.title')} desc={t('agents:editor.identity.desc')}>
          <div className="flex gap-6">
            <div className="flex w-[112px] shrink-0 flex-col items-center gap-2">
              <div className="rounded-xl border border-line bg-surface-2 p-2">
                <PixelAvatar agent={agent} size={92} />
              </div>
              <button
                className="btn-ghost h-6 text-[11.5px]"
                title={t('agents:editor.identity.randomLook')}
                onClick={() => void save(randomLook(agents.filter((a) => a.id !== agent.id)))}
              >
                <Shuffle size={12} /> {t('agents:fields.shuffle')}
              </button>
            </div>
            <div className="min-w-0 flex-1 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label={t('agents:fields.name')}>
                  <input className={cn('input', nameError && 'border-rose-500/60 focus:border-rose-500/60 focus:ring-rose-500/15')} {...text('name')} />
                  {nameError && <div className="mt-1 text-[11.5px] text-rose-400">{nameError}</div>}
                </Field>
                <Field label={t('agents:fields.role')}>
                  <input className="input" placeholder={t('agents:editor.identity.rolePlaceholder')} {...text('role')} />
                </Field>
              </div>
              <div>
                <label className="label">{t('agents:editor.identity.look')}</label>
                <div className="space-y-2">
                  <Swatches label={t('agents:editor.identity.shirt')} colors={SHIRTS} value={agent.color} onPick={(c) => void save({ color: c })} />
                  <Swatches label={t('agents:editor.identity.hair')} colors={HAIRS} value={agent.hair} onPick={(c) => void save({ hair: c })} />
                  <Swatches label={t('agents:editor.identity.skin')} colors={SKINS} value={agent.skin} onPick={(c) => void save({ skin: c })} />
                </div>
              </div>
            </div>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3 border-t border-line-soft pt-4">
            <ToggleRow
              title={t('agents:editor.identity.active')}
              desc={t('agents:editor.identity.activeDesc')}
              checked={agent.enabled}
              onChange={(v) => void save({ enabled: v })}
            />
            <ToggleRow
              title={t('agents:editor.identity.lead')}
              desc={agent.isLead ? t('agents:editor.identity.leadDescIsLead') : t('agents:editor.identity.leadDesc')}
              checked={agent.isLead}
              disabled={agent.isLead}
              onChange={(v) => void save({ isLead: v })}
            />
          </div>
        </Section>

        {/* duty & job description */}
        <Section icon={BriefcaseBusiness} title={t('agents:editor.duty.title')} desc={t('agents:editor.duty.desc')}>
          <div className="space-y-4">
            <Field label={t('agents:fields.jobDescription')} hint={t('agents:editor.duty.jobDescHint')}>
              <textarea
                className="textarea min-h-[132px]"
                rows={6}
                placeholder={t('agents:editor.duty.jobDescPlaceholder')}
                {...text('jobDescription')}
              />
            </Field>
            <Field label={t('agents:fields.skills')} hint={t('agents:editor.duty.skillsHint')}>
              <TagInput value={agent.skills} onChange={(skills) => void save({ skills })} placeholder={t('agents:editor.duty.skillsPlaceholder')} />
            </Field>
            <Field label={t('agents:editor.duty.persona')} hint={t('agents:editor.duty.personaHint')}>
              <textarea className="textarea" rows={3} placeholder={t('agents:editor.duty.personaPlaceholder')} {...text('persona')} />
            </Field>
          </div>
        </Section>

        <AgentUnits agent={agent} onSaved={flash} />

        {/* model */}
        <Section icon={Cpu} title={t('agents:editor.model.title')} desc={t('agents:editor.model.desc')}>
          <div className="grid grid-cols-2 gap-3">
            <Field
              label={t('agents:editor.model.provider')}
              hint={defaultProvider ? t('agents:editor.model.defaultHint', { name: defaultProvider.label }) : t('agents:editor.model.noProvider')}
            >
              <select
                className="input"
                value={agent.providerId ?? ''}
                onChange={(e) => {
                  const next = providers.find((p) => p.id === e.target.value) ?? defaultProvider
                  // A model name only fits its provider kind ('sonnet' means nothing to OpenAI): switching kinds resets it.
                  const resetModel = agent.model && next?.kind !== agentProvider?.kind
                  void save({ providerId: e.target.value || null, ...(resetModel ? { model: null } : {}) })
                }}
              >
                <option value="">{t('agents:editor.model.default')}</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('agents:editor.model.model')}>
              <ModelSelect
                key={agentProvider?.id ?? 'none'}
                kind={agentProvider?.kind ?? 'mock'}
                providerId={agentProvider?.id}
                baseUrl={agentProvider?.baseUrl || undefined}
                value={agent.model ?? ''}
                onChange={(m) => void save({ model: m || null })}
                inheritLabel={t('settings:models.inherit', { model: agentProvider?.model || t('settings:models.inheritCliDefault') })}
                disabled={!agentProvider || agentProvider.kind === 'mock'}
                testId="agent-model"
              />
            </Field>
          </div>
        </Section>

        <AgentSkills agent={agent} />

        <AgentApps agent={agent} />

        <PermissionsCard agent={agent} onSave={savePerms} />

        <DuplicateCard agent={agent} />
        <ShareCard target={{ type: 'agent', id: agent.id }} />
        <DangerZone agent={agent} />
      </div>
    </div>
  )
}

function ToggleRow({ title, desc, checked, disabled, onChange }: { title: string; desc: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={cn('flex items-start gap-3 rounded-md px-1 py-1', disabled ? 'cursor-default' : 'cursor-pointer')}>
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-medium text-zinc-200">{title}</div>
        <div className="text-[11.5px] leading-snug text-zinc-400">{desc}</div>
      </div>
      <Toggle checked={checked} disabled={disabled} onChange={onChange} />
    </label>
  )
}

/* ───────────────────────────── header actions ───────────────────────────── */

function AgentActions({ agent }: { agent: Agent }) {
  const { t } = useTranslation()
  const setNewTaskOpen = useAppStore((s) => s.setNewTaskOpen)
  const setChatChannel = useAppStore((s) => s.setChatChannel)
  const setTab = useAppStore((s) => s.setTab)
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <button
        className="btn-ghost"
        onClick={() => {
          setChatChannel(agent.isLead ? 'general' : `agent:${agent.id}`)
          setTab('chat')
        }}
      >
        <MessageSquare size={13} /> {t('agents:editor.actions.message')}
      </button>
      {!agent.isLead && (
        <button className="btn-outline" onClick={() => setNewTaskOpen(true, agent.id)}>
          <SquarePlus size={13} /> {t('agents:editor.actions.assignTask')}
        </button>
      )}
    </div>
  )
}

/* ───────────────────────────── status (read-only) ───────────────────────────── */

function StatusCard({ agent }: { agent: Agent }) {
  const { t } = useTranslation()
  const runs = useAppStore((s) => s.activeRuns)
  const tasks = useAppStore((s) => s.tasks)
  const run = useMemo(() => runs.find((r) => r.agentId === agent.id), [runs, agent.id])
  const task = useMemo(() => (run ? tasks.find((x) => x.id === run.taskId) : undefined), [run, tasks])
  const counts = useMemo(() => {
    const c = { todo: 0, active: 0, done: 0 }
    for (const task of tasks) {
      if (task.assigneeId !== agent.id) continue
      if (task.status === 'todo') c.todo++
      else if (task.status === 'done') c.done++
      else c.active++
    }
    return c
  }, [tasks, agent.id])
  const meta = STATUS_META[agent.status]

  return (
    <section className="card grid grid-cols-[minmax(0,1.4fr)_minmax(0,2fr)_repeat(3,minmax(0,0.6fr))] divide-x divide-line-soft">
      <Cell label={t('agents:editor.status.label')}>
        <div className={cn('flex items-center gap-1.5 text-[13px] font-medium', meta.text)}>
          <span className={cn('h-1.5 w-1.5 rounded-full', meta.dot, agent.status === 'working' && 'animate-pulse')} />
          {meta.label}
        </div>
        <div className="mt-0.5 truncate text-[11.5px] text-zinc-400">{agent.statusNote || '—'}</div>
      </Cell>
      <Cell label={t('agents:editor.status.current')}>
        {task && run ? (
          <>
            <div className="truncate text-[12.5px] text-zinc-200">
              <span className="font-mono text-zinc-400">{task.key}</span> {task.title}
            </div>
            {run.status === 'awaiting_approval' ? (
              <div className="mt-1 text-[11.5px] text-amber-300">{t('agents:editor.status.awaitingApproval')}</div>
            ) : (
              <div className="mt-1.5 flex items-center gap-2">
                <ProgressBar value={task.progress} tone={run.status === 'paused' ? 'amber' : 'emerald'} />
                <span className="font-mono text-[10.5px] text-zinc-400">{task.progress}%</span>
              </div>
            )}
          </>
        ) : (
          <div className="text-[12.5px] text-zinc-400">{t('agents:editor.status.idle')}</div>
        )}
      </Cell>
      <Stat label={t('agents:editor.status.queued')} value={counts.todo} />
      <Stat label={t('agents:editor.status.inProgress')} value={counts.active} />
      <Stat label={t('agents:editor.status.done')} value={counts.done} />
    </section>
  )
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 px-4 py-3">
      <div className="mb-1 text-[10.5px] uppercase tracking-wide text-zinc-400">{label}</div>
      {children}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Cell label={label}>
      <div className="font-mono text-[17px] leading-tight text-zinc-100">{value}</div>
    </Cell>
  )
}

/* ───────────────────────────── permissions ───────────────────────────── */

function PermissionsCard({ agent, onSave }: { agent: Agent; onSave: (patch: PermissionsPatch) => Promise<void> }) {
  const { t } = useTranslation()
  // `find` returns an existing object, so this selector is stable between renders.
  const perms = useAppStore((s) => s.permissions.find((p) => p.agentId === agent.id))
  const workspace = useAppStore((s) => s.settings.workspaceRoot)
  const openSettings = useAppStore((s) => s.openSettings)

  return (
    <Section
      icon={Shield}
      title={t('agents:editor.permissions.title')}
      desc={t('agents:editor.permissions.desc')}
      action={
        <button className="btn-ghost h-6 shrink-0 text-[11.5px]" onClick={() => openSettings('permissions')}>
          {t('agents:editor.permissions.matrix')}
        </button>
      }
    >
      {!perms ? (
        <div className="text-[12px] text-zinc-400">{t('agents:editor.permissions.loading')}</div>
      ) : (
        <>
          <div className="-my-1 divide-y divide-line-soft">
            {PERMISSIONS.map((p) => (
              <label key={p.key} className="flex cursor-pointer items-center gap-3 py-2.5">
                <div
                  className={cn(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-md border transition-colors',
                    perms[p.key] ? 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300' : 'border-line bg-surface-2 text-zinc-400'
                  )}
                >
                  <p.icon size={14} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[12.5px] font-medium text-zinc-200">{p.label}</span>
                    <span className="font-mono text-[10.5px] text-zinc-400">{p.hint}</span>
                  </div>
                  <div className="text-[11.5px] text-zinc-400">{p.desc}</div>
                </div>
                <Toggle checked={perms[p.key]} onChange={(v) => void onSave({ [p.key]: v })} />
              </label>
            ))}
          </div>

          <div className="mt-4 rounded-md border border-line-soft bg-surface-2/50 p-3">
            <div className="mb-1 flex items-center justify-between gap-3">
              <div>
                <div className="text-[12.5px] font-medium text-zinc-200">{t('agents:editor.permissions.extraFolders')}</div>
                <div className="text-[11.5px] text-zinc-400">
                  <Trans
                    i18nKey="agents:editor.permissions.extraFoldersDesc"
                    values={{ path: workspace || t('agents:editor.permissions.notSelected') }}
                    components={{ mono: <span className="font-mono" /> }}
                  />
                </div>
              </div>
              <button
                className="btn-outline h-7 shrink-0"
                onClick={async () => {
                  const dir = await call('app:pickFolder')
                  if (dir && !perms.allowedPaths.includes(dir)) void onSave({ allowedPaths: [...perms.allowedPaths, dir] })
                }}
              >
                <Plus size={13} /> {t('agents:editor.permissions.addFolder')}
              </button>
            </div>
            {perms.allowedPaths.map((path) => (
              <div key={path} className="flex items-center gap-2 border-t border-line-soft py-1.5 font-mono text-[11.5px] text-zinc-400 first-of-type:mt-2">
                <FolderOpen size={12} className="shrink-0 text-zinc-400" />
                <span className="selectable flex-1 truncate">{path}</span>
                <button className="icon-btn hover:text-rose-400" title={t('actions.remove')} onClick={() => void onSave({ allowedPaths: perms.allowedPaths.filter((x) => x !== path) })}>
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </Section>
  )
}

/* ───────────────────────────── duplicate ───────────────────────────── */

/** A twin for parallel work: the lead can then split work between them. */
function DuplicateCard({ agent }: { agent: Agent }) {
  const { t } = useTranslation()
  const toast = useAppStore((s) => s.toast)
  const selectAgent = useAppStore((s) => s.selectAgent)
  const [busy, setBusy] = useState(false)
  const duplicate = async (): Promise<void> => {
    setBusy(true)
    try {
      const twin = await call('agents:duplicate', agent.id)
      selectAgent(twin.id)
      toast('info', t('agents:editor.duplicate.done', { name: twin.name }))
    } catch (e) {
      toast('error', apiError(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="card">
      <div className="flex items-center gap-4 px-5 py-4">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line bg-white/[0.03] text-indigo-300">
          <Copy size={14} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-zinc-100">{t('agents:editor.duplicate.title')}</div>
          <div className="text-[12px] text-zinc-400">{t('agents:editor.duplicate.desc')}</div>
        </div>
        <button data-testid="agent-duplicate" className="btn-outline" disabled={busy} onClick={() => void duplicate()}>
          <Copy size={13} /> {t('agents:editor.duplicate.action')}
        </button>
      </div>
    </section>
  )
}

/* ───────────────────────────── danger zone ───────────────────────────── */

function DangerZone({ agent }: { agent: Agent }) {
  const { t } = useTranslation()
  const toast = useAppStore((s) => s.toast)
  const selectAgent = useAppStore((s) => s.selectAgent)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const remove = async (): Promise<void> => {
    setBusy(true)
    try {
      await call('agents:delete', agent.id)
      // Memberships go with the agent; units:changed is not emitted for this, so refetch.
      void useAppStore.getState().refresh('units')
      selectAgent(null)
      toast('info', t('agents:editor.danger.deleted', { name: agent.name }))
    } catch (e) {
      toast('error', apiError(e))
      setBusy(false)
      setConfirming(false)
    }
  }

  return (
    <section className="card border-rose-500/20">
      <div className="flex items-center gap-4 px-5 py-4">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-rose-500/20 bg-rose-500/[0.06] text-rose-400">
          <TriangleAlert size={14} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-zinc-100">{t('agents:editor.danger.title')}</div>
          <div className="text-[12px] text-zinc-400">
            {agent.isLead ? (
              <span className="inline-flex items-center gap-1">
                <Star size={11} className="fill-indigo-300 text-indigo-300" /> {t('agents:editor.danger.leadBlocked')}
              </span>
            ) : (
              t('agents:editor.danger.desc')
            )}
          </div>
        </div>
        {!confirming ? (
          <button className="btn-danger border border-rose-500/25" disabled={agent.isLead} onClick={() => setConfirming(true)}>
            <Trash2 size={13} /> {t('actions.delete')}
          </button>
        ) : (
          <div className="flex shrink-0 items-center gap-1.5 animate-fade-in">
            <span className="mr-1 text-[12px] text-rose-300">{t('agents:editor.danger.confirm', { name: agent.name })}</span>
            <button className="btn-ghost" disabled={busy} onClick={() => setConfirming(false)}>
              {t('actions.cancel')}
            </button>
            <button className="btn bg-rose-600 text-white hover:bg-rose-500" disabled={busy} onClick={() => void remove()}>
              {t('actions.yesDelete')}
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
