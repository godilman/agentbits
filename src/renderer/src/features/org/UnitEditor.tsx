import { useMemo, useState } from 'react'
import { ChevronRight, FolderKanban, IdCard, Plus, Star, Trash2, TriangleAlert, UserPlus, Users, X } from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'
import type { Agent, OrgUnit, OrgUnitInput } from '@shared/types'
import { descendantIds, unitMemberIds, unitPath } from '@shared/org'
import { PixelAvatar } from '@/components/common/PixelAvatar'
import { Segmented } from '@/components/common/ui'
import { apiError, call } from '@/lib/api'
import { cn } from '@/lib/format'
import { useAppStore } from '@/store/useAppStore'
import { NewAgentModal } from '@/features/agents/NewAgentModal'
import { Field, SavedIndicator, Section, useSavedFlash } from '@/features/agents/parts'
import { AddMembersModal } from './AddMembersModal'
import { ShareCard } from './Share'
import { CHILD_KINDS, childrenMap, flattenTree, indentLabel, KIND_META, projectsForUnit, UNIT_COLORS } from './meta'

export function UnitEditor({ unit, autoFocusName, onCreateChild }: { unit: OrgUnit; autoFocusName?: boolean; onCreateChild: (parentId: string) => void }) {
  const { t } = useTranslation()
  const units = useAppStore((s) => s.units)
  const agents = useAppStore((s) => s.agents)
  const toast = useAppStore((s) => s.toast)
  const selectUnit = useAppStore((s) => s.selectUnit)
  const { saved, flash } = useSavedFlash()
  const [form, setForm] = useState({ name: unit.name, description: unit.description })
  const [nameError, setNameError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [creatingAgent, setCreatingAgent] = useState(false)

  const isRoot = !unit.parentId
  const agentsById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents])
  const path = useMemo(() => unitPath(units, unit.id), [units, unit.id])
  const children = useMemo(() => childrenMap(units).get(unit.id) ?? [], [units, unit.id])
  const parentOptions = useMemo(() => {
    const blocked = new Set(descendantIds(units, unit.id))
    return flattenTree(units).filter(({ unit: u }) => !blocked.has(u.id))
  }, [units, unit.id])
  const members = useMemo(
    () => unit.members.flatMap((m) => (agentsById.has(m.agentId) ? [{ agent: agentsById.get(m.agentId)!, title: m.title }] : [])),
    [unit.members, agentsById]
  )
  const deepCount = useMemo(() => unitMemberIds(units, unit.id, true).filter((id) => agentsById.has(id)).length, [units, unit.id, agentsById])

  const run = async (fn: () => Promise<unknown>): Promise<boolean> => {
    try {
      await fn()
      flash()
      return true
    } catch (e) {
      toast('error', apiError(e))
      return false
    }
  }
  const save = (patch: OrgUnitInput): Promise<boolean> => run(() => call('units:save', patch, unit.id))

  const blur = (k: 'name' | 'description'): void => {
    const v = form[k].trim()
    if (k === 'name') {
      if (!v) return setNameError(t('org:unit.nameRequired'))
      setNameError(null)
    }
    if (v !== unit[k]) void save({ [k]: v })
  }

  const meta = KIND_META[unit.kind]

  return (
    <div className="pb-16">
      <div className="sticky top-0 z-10 border-b border-line bg-canvas/90 backdrop-blur">
        <div className="mx-auto flex max-w-[880px] items-center gap-4 px-8 py-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg" style={{ background: `${unit.color}22`, color: unit.color }}>
            <meta.icon size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1 truncate text-[11.5px] text-zinc-500">
              {path.slice(0, -1).map((p) => (
                <span key={p.id} className="flex items-center gap-1">
                  <button className="hover:text-zinc-300" onClick={() => selectUnit(p.id)}>
                    {p.name}
                  </button>
                  <ChevronRight size={11} className="text-zinc-700" />
                </span>
              ))}
              <span className="text-zinc-400">{meta.label}</span>
            </div>
            <h2 className="truncate text-[16px] font-semibold text-zinc-100">{unit.name}</h2>
          </div>
          <SavedIndicator saved={saved} />
          <span className="shrink-0 rounded-md border border-line bg-surface px-2 py-1 text-[11.5px] text-zinc-400">
            <Trans i18nKey="org:unit.agentCount" count={deepCount} components={{ n: <span className="font-mono text-zinc-200" /> }} />
          </span>
        </div>
      </div>

      <div className="mx-auto max-w-[880px] space-y-4 px-8 pt-6">
        {/* identity */}
        <Section icon={IdCard} title={t('org:unit.info.title')} desc={t('org:unit.info.desc')}>
          <div className="grid grid-cols-2 gap-4">
            <Field label={t('org:unit.fields.name')}>
              <input
                autoFocus={autoFocusName}
                onFocus={(e) => autoFocusName && e.target.select()}
                className={cn('input', nameError && 'border-rose-500/60')}
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                onBlur={() => blur('name')}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              />
              {nameError && <div className="mt-1 text-[11.5px] text-rose-400">{nameError}</div>}
            </Field>
            <Field label={t('org:unit.fields.kind')}>
              {isRoot ? (
                <div className="flex h-8 items-center text-[12.5px] text-zinc-400">{t('org:unit.fields.rootKind')}</div>
              ) : (
                <div className="flex h-8 items-center">
                  <Segmented value={unit.kind} options={CHILD_KINDS.map((k) => ({ value: k, label: KIND_META[k].label }))} onChange={(k) => void save({ kind: k })} />
                </div>
              )}
            </Field>
            <Field label={t('org:unit.fields.description')} className="col-span-2">
              <textarea
                className="textarea"
                rows={3}
                placeholder={t('org:unit.fields.descriptionPlaceholder')}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                onBlur={() => blur('description')}
              />
            </Field>
            <Field label={t('org:unit.fields.parent')}>
              <select
                className="input"
                disabled={isRoot}
                value={unit.parentId ?? ''}
                onChange={(e) => e.target.value && void save({ parentId: e.target.value })}
              >
                {isRoot && <option value="">{t('org:unit.fields.topLevel')}</option>}
                {parentOptions.map(({ unit: u, depth }) => (
                  <option key={u.id} value={u.id}>
                    {indentLabel(u.name, depth)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('org:unit.fields.lead')}>
              <select className="input" value={unit.leadAgentId ?? ''} onChange={(e) => void save({ leadAgentId: e.target.value || null })}>
                <option value="">{t('org:unit.fields.noLead')}</option>
                {members.map(({ agent }) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name} · {agent.role}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('org:unit.fields.color')} className="col-span-2">
              <div className="flex flex-wrap gap-1.5">
                {UNIT_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => void save({ color: c })}
                    className={cn(
                      'h-5 w-5 rounded-[5px] ring-offset-2 ring-offset-surface transition-transform hover:scale-110',
                      unit.color === c ? 'ring-2 ring-indigo-400' : 'ring-1 ring-inset ring-white/10'
                    )}
                    style={{ background: c }}
                  />
                ))}
              </div>
            </Field>
          </div>
        </Section>

        <MembersCard
          unit={unit}
          members={members}
          deepCount={deepCount}
          onAdd={() => setAdding(true)}
          onCreate={() => setCreatingAgent(true)}
          run={run}
        />

        {/* sub-units */}
        <Section
          icon={KIND_META.department.icon}
          title={t('org:unit.subUnits.title')}
          desc={t('org:unit.subUnits.desc')}
          action={
            <button className="btn-ghost h-6 shrink-0 text-[11.5px]" onClick={() => onCreateChild(unit.id)}>
              <Plus size={12} /> {t('org:unit.subUnits.add')}
            </button>
          }
        >
          {children.length === 0 ? (
            <div className="text-[12px] text-zinc-600">{t('org:unit.subUnits.none')}</div>
          ) : (
            <div className="-my-1 divide-y divide-line-soft">
              {children.map((c) => {
                const Icon = KIND_META[c.kind].icon
                const count = unitMemberIds(units, c.id, true).filter((id) => agentsById.has(id)).length
                return (
                  <button key={c.id} onClick={() => selectUnit(c.id)} className="group flex w-full items-center gap-3 py-2 text-left">
                    <Icon size={14} style={{ color: c.color }} />
                    <span className="flex-1 truncate text-[12.5px] text-zinc-200 group-hover:text-white">{c.name}</span>
                    <span className="text-[11px] text-zinc-600">{KIND_META[c.kind].label}</span>
                    <span className="w-14 text-right font-mono text-[11px] text-zinc-500">{t('org:counts.agents', { count })}</span>
                    <ChevronRight size={13} className="text-zinc-700 group-hover:text-zinc-400" />
                  </button>
                )
              })}
            </div>
          )}
        </Section>

        <ProjectsCard unit={unit} run={run} />

        <ShareCard target={{ type: 'unit', id: unit.id }} />

        <DangerZone unit={unit} />
      </div>

      <AddMembersModal open={adding} unit={unit} onClose={() => setAdding(false)} />
      <NewAgentModal open={creatingAgent} unitId={unit.id} onClose={() => setCreatingAgent(false)} onCreated={() => flash()} />
    </div>
  )
}

/* ───────────────────────────── members ───────────────────────────── */

function MembersCard({
  unit,
  members,
  deepCount,
  onAdd,
  onCreate,
  run
}: {
  unit: OrgUnit
  members: { agent: Agent; title: string }[]
  deepCount: number
  onAdd: () => void
  onCreate: () => void
  run: (fn: () => Promise<unknown>) => Promise<boolean>
}) {
  const { t } = useTranslation()
  const units = useAppStore((s) => s.units)
  const openAgentProfile = useAppStore((s) => s.openAgentProfile)
  // Other units each agent belongs to, for the small "Ayrıca" line.
  const otherUnits = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const u of units) {
      if (u.id === unit.id) continue
      for (const mem of u.members) m.set(mem.agentId, [...(m.get(mem.agentId) ?? []), u.name])
    }
    return m
  }, [units, unit.id])

  return (
    <Section
      icon={Users}
      title={t('org:unit.members.title', { n: members.length })}
      desc={
        deepCount > members.length
          ? t('org:unit.members.descDeep', { count: deepCount })
          : t('org:unit.members.desc')
      }
      action={
        <div className="flex shrink-0 gap-1">
          <button className="btn-ghost h-6 text-[11.5px]" onClick={onCreate}>
            <Plus size={12} /> {t('org:unit.members.createAgent')}
          </button>
          <button className="btn-outline h-6 text-[11.5px]" onClick={onAdd}>
            <UserPlus size={12} /> {t('org:unit.members.add')}
          </button>
        </div>
      }
    >
      {members.length === 0 ? (
        <div className="rounded-md border border-dashed border-line px-4 py-5 text-center text-[12px] text-zinc-500">
          {t('org:unit.members.empty')}
        </div>
      ) : (
        <div className="-my-1 divide-y divide-line-soft">
          {members.map(({ agent, title }) => (
            <MemberRow
              key={agent.id}
              agent={agent}
              title={title}
              isLead={unit.leadAgentId === agent.id}
              others={otherUnits.get(agent.id) ?? []}
              onOpen={() => openAgentProfile(agent.id)}
              onTitle={(title) => void run(() => call('units:addMember', unit.id, agent.id, title))}
              onLead={() => void run(() => call('units:save', { leadAgentId: unit.leadAgentId === agent.id ? null : agent.id }, unit.id))}
              onRemove={() => void run(() => call('units:removeMember', unit.id, agent.id))}
            />
          ))}
        </div>
      )}
    </Section>
  )
}

function MemberRow({
  agent,
  title,
  isLead,
  others,
  onOpen,
  onTitle,
  onLead,
  onRemove
}: {
  agent: Agent
  title: string
  isLead: boolean
  others: string[]
  onOpen: () => void
  onTitle: (t: string) => void
  onLead: () => void
  onRemove: () => void
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(title)
  return (
    <div className="group flex items-center gap-3 py-2">
      <PixelAvatar agent={agent} size={32} showStatus className={!agent.enabled ? 'opacity-50 grayscale' : ''} />
      <button className="min-w-0 flex-1 text-left" onClick={onOpen} title={t('org:unit.member.openProfile')}>
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[12.5px] font-medium text-zinc-100 hover:text-white">{agent.name}</span>
          <span className="truncate text-[11.5px] text-zinc-500">{agent.role}</span>
        </div>
        <div className="truncate text-[11px] text-zinc-600">{others.length ? t('org:unit.member.alsoIn', { units: others.join(', ') }) : t('org:unit.member.onlyHere')}</div>
      </button>
      <input
        className="input h-7 w-[190px] text-[12px]"
        placeholder={t('org:unit.member.titlePlaceholder')}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft.trim() !== title && onTitle(draft.trim())}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <button
        className={cn('icon-btn', isLead ? 'text-amber-300 hover:text-amber-200' : 'opacity-0 group-hover:opacity-100')}
        title={isLead ? t('org:unit.member.isLead') : t('org:unit.member.makeLead')}
        onClick={onLead}
      >
        <Star size={13} className={isLead ? 'fill-amber-300' : ''} />
      </button>
      <button className="icon-btn hover:text-rose-400" title={t('org:unit.member.remove')} onClick={onRemove}>
        <X size={13} />
      </button>
    </div>
  )
}

/* ───────────────────────────── projects ───────────────────────────── */

function ProjectsCard({ unit, run }: { unit: OrgUnit; run: (fn: () => Promise<unknown>) => Promise<boolean> }) {
  const { t } = useTranslation()
  const units = useAppStore((s) => s.units)
  const projects = useAppStore((s) => s.projects)
  const openProject = useAppStore((s) => s.openProject)
  const used = useMemo(() => projectsForUnit(projects, units, unit.id), [projects, units, unit.id])
  const addable = useMemo(
    () => projects.filter((p) => p.status !== 'archived' && !used.some((u) => u.project.id === p.id)),
    [projects, used]
  )

  return (
    <Section icon={FolderKanban} title={t('org:unit.projects.title')} desc={t('org:unit.projects.desc')}>
      {used.length === 0 ? (
        <div className="text-[12px] text-zinc-600">{t('org:unit.projects.none')}</div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {used.map(({ project: p, direct }) => (
            <span key={p.id} className="inline-flex h-7 items-center rounded-md border border-line bg-surface-2 text-[12px]">
              <button className="flex h-full items-center gap-1.5 pl-2.5 pr-2 text-zinc-200 hover:text-white" onClick={() => openProject(p.id)} title={t('org:unit.projects.open')}>
                <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
                {p.name}
                {!direct && <span className="text-[10.5px] text-zinc-600">{t('org:unit.projects.inherited')}</span>}
                {p.status === 'archived' && <span className="text-[10.5px] text-zinc-600">{t('org:unit.projects.archived')}</span>}
              </button>
              {direct && (
                <button
                  className="flex h-full items-center border-l border-line px-1.5 text-zinc-600 hover:text-rose-400"
                  title={t('org:unit.projects.removeFrom')}
                  onClick={() => void run(() => call('projects:save', { unitIds: p.unitIds.filter((id) => id !== unit.id) }, p.id))}
                >
                  <X size={11} />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      <div className="mt-3">
        <select
          className="input h-7 w-auto min-w-[240px] text-[12px]"
          value=""
          disabled={addable.length === 0}
          onChange={(e) => {
            const p = projects.find((x) => x.id === e.target.value)
            if (p) void run(() => call('projects:save', { unitIds: [...p.unitIds, unit.id] }, p.id))
          }}
        >
          <option value="">{addable.length ? t('org:unit.projects.add') : t('org:unit.projects.noneAddable')}</option>
          {addable.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
    </Section>
  )
}

/* ───────────────────────────── danger zone ───────────────────────────── */

function DangerZone({ unit }: { unit: OrgUnit }) {
  const { t } = useTranslation()
  const units = useAppStore((s) => s.units)
  const toast = useAppStore((s) => s.toast)
  const selectUnit = useAppStore((s) => s.selectUnit)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const subCount = useMemo(() => descendantIds(units, unit.id).length - 1, [units, unit.id])
  const isRoot = !unit.parentId

  const remove = async (): Promise<void> => {
    setBusy(true)
    try {
      await call('units:delete', unit.id)
      selectUnit(unit.parentId)
      toast('info', t('org:unit.danger.deleted', { name: unit.name }))
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
          <div className="text-[13px] font-semibold text-zinc-100">{t('org:unit.danger.title')}</div>
          <div className="text-[12px] text-zinc-500">
            {isRoot
              ? t('org:unit.danger.root')
              : subCount
                ? t('org:unit.danger.descWithSubs', { count: subCount })
                : t('org:unit.danger.desc')}
          </div>
        </div>
        {!confirming ? (
          <button className="btn-danger border border-rose-500/25" disabled={isRoot} onClick={() => setConfirming(true)}>
            <Trash2 size={13} /> {t('actions.delete')}
          </button>
        ) : (
          <div className="flex shrink-0 items-center gap-1.5 animate-fade-in">
            <span className="mr-1 text-[12px] text-rose-300">{subCount ? t('org:unit.danger.confirmWithSubs', { name: unit.name, count: subCount }) : t('org:unit.danger.confirm', { name: unit.name })}</span>
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
