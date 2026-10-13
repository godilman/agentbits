import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, Crown, ExternalLink, LayoutTemplate, Plus, Settings2, Users, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Agent, OrgUnit, ProjectInput, Run } from '@shared/types'
import { descendantIds, unitPath } from '@shared/org'
import { PixelAvatar } from '@/components/common/PixelAvatar'
import { usageTitle } from '@/components/common/TokenUsage'
import { Empty } from '@/components/common/ui'
import { flattenTree, KIND_META } from '@/features/org/meta'
import { apiError, call } from '@/lib/api'
import { cn, compact, STATUS_META } from '@/lib/format'
import { autoProjectLead, useProjectScope } from '@/lib/org'
import { useAppStore } from '@/store/useAppStore'

/** Project → Team section: teams assigned to the active project and their members. */
export function ProjectTeamView() {
  const { t } = useTranslation()
  const { project, members, lead } = useProjectScope()
  const units = useAppStore((s) => s.units)
  const agents = useAppStore((s) => s.agents)
  const activeRuns = useAppStore((s) => s.activeRuns)
  const projects = useAppStore((s) => s.projects)
  const showOrg = useAppStore((s) => s.showOrg)
  const openProjectModal = useAppStore((s) => s.openProjectModal)
  const toast = useAppStore((s) => s.toast)
  const [picker, setPicker] = useState<'header' | 'empty' | null>(null)

  const assigned = useMemo(
    () => (project ? project.unitIds.map((id) => units.find((u) => u.id === id)).filter((u): u is OrgUnit => !!u) : []),
    [project, units]
  )
  const autoLead = useMemo(() => (project ? autoProjectLead(project, units, agents) : null), [project, units, agents])
  /** agentId → run in another project (agents are shared; one task at a time). */
  const elsewhere = useMemo(() => {
    const m = new Map<string, Run>()
    for (const r of activeRuns) if (r.projectId && r.projectId !== project?.id) m.set(r.agentId, r)
    return m
  }, [activeRuns, project?.id])

  if (!project) return <Empty icon={<Users size={18} />} title={t('project:team.noProject')} />

  const save = async (patch: ProjectInput): Promise<void> => {
    try {
      const saved = await call('projects:save', patch, project.id)
      useAppStore.setState((s) => ({ projects: s.projects.map((p) => (p.id === saved.id ? saved : p)) }))
    } catch (e) {
      toast('error', apiError(e))
    }
  }

  const addUnit = (id: string): void => {
    setPicker(null)
    const sub = new Set(descendantIds(units, id))
    void save({ unitIds: [...project.unitIds.filter((x) => !sub.has(x)), id] })
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-4 border-b border-line px-6 py-4">
        <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: project.color }} />
        <div className="min-w-0">
          <h1 className="truncate text-[15px] font-semibold text-zinc-100">{t('project:team.title', { name: project.name })}</h1>
          <div className="text-[11.5px] text-zinc-400">
            {t('project:agents', { count: members.length })} · {t('project:team.unitsAssigned', { count: assigned.length })} · {t('project:team.sharedNote')}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-md border border-line bg-surface-2 py-0.5 pl-2 pr-0.5">
            <Crown size={13} className="text-amber-300" />
            <span className="text-[11.5px] text-zinc-400">{t('project:lead')}</span>
            {lead && <PixelAvatar agent={lead} size={18} />}
            <select
              className="h-6 max-w-[220px] rounded bg-transparent pr-1 text-[12px] text-zinc-200 outline-none"
              value={project.leadAgentId && members.some((m) => m.id === project.leadAgentId) ? project.leadAgentId : ''}
              onChange={(e) => void save({ leadAgentId: e.target.value || null })}
            >
              <option value="">{autoLead ? t('project:autoLeadNamed', { name: autoLead.name }) : t('project:autoLead')}</option>
              {members.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {a.role}
                </option>
              ))}
            </select>
          </div>
          <div className="relative">
            <button className="btn-primary" onClick={() => setPicker((v) => (v === 'header' ? null : 'header'))}>
              <Plus size={14} /> {t('project:team.addTeam')}
            </button>
            {picker === 'header' && <UnitPicker assignedIds={project.unitIds} onPick={addUnit} onClose={() => setPicker(null)} />}
          </div>
          <button className="icon-btn h-7 w-7" title={t('project:settings')} onClick={() => openProjectModal(project.id)}>
            <Settings2 size={14} />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {assigned.length === 0 ? (
          <Empty
            icon={<Users size={18} />}
            title={t('project:team.emptyTitle')}
            hint={t('project:team.emptyHint')}
            action={
              <div className="flex gap-2">
                <div className="relative">
                  <button className="btn-primary" onClick={() => setPicker((v) => (v === 'empty' ? null : 'empty'))}>
                    <Plus size={14} /> {t('project:team.addTeam')}
                  </button>
                  {picker === 'empty' && <UnitPicker assignedIds={project.unitIds} onPick={addUnit} onClose={() => setPicker(null)} />}
                </div>
                <button className="btn-outline" onClick={() => showOrg('templates')}>
                  <LayoutTemplate size={14} /> {t('project:team.fromTemplate')}
                </button>
              </div>
            }
          />
        ) : (
          <div className="grid gap-4 p-6 [grid-template-columns:repeat(auto-fill,minmax(380px,1fr))]">
            {assigned.map((u) => (
              <UnitCard
                key={u.id}
                unit={u}
                projectLeadId={lead?.id ?? null}
                elsewhere={elsewhere}
                projectName={(pid) => projects.find((p) => p.id === pid)?.name ?? t('project:team.otherProject')}
                projectColor={(pid) => projects.find((p) => p.id === pid)?.color ?? '#71717a'}
                onRemove={() => void save({ unitIds: project.unitIds.filter((x) => x !== u.id) })}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function UnitCard({
  unit,
  projectLeadId,
  elsewhere,
  projectName,
  projectColor,
  onRemove
}: {
  unit: OrgUnit
  projectLeadId: string | null
  elsewhere: Map<string, Run>
  projectName: (pid: string) => string
  projectColor: (pid: string) => string
  onRemove: () => void
}) {
  const { t } = useTranslation()
  const units = useAppStore((s) => s.units)
  const agents = useAppStore((s) => s.agents)
  const showOrg = useAppStore((s) => s.showOrg)
  const selectUnit = useAppStore((s) => s.selectUnit)
  const selectAgent = useAppStore((s) => s.selectAgent)
  const setTab = useAppStore((s) => s.setTab)
  const Icon = KIND_META[unit.kind].icon
  const crumbs = useMemo(() => unitPath(units, unit.id).slice(0, -1), [units, unit.id])

  /** The unit and its sub-units (tree order), each with its direct members. */
  const groups = useMemo(() => {
    const inside = new Set(descendantIds(units, unit.id))
    const seen = new Set<string>()
    return flattenTree(units)
      .filter(({ unit: u }) => inside.has(u.id))
      .map(({ unit: u }) => ({
        unit: u,
        rows: u.members
          .filter((m) => !seen.has(m.agentId) && (seen.add(m.agentId), true))
          .map((m) => ({ agent: agents.find((a) => a.id === m.agentId), title: m.title }))
          .filter((r): r is { agent: Agent; title: string } => !!r.agent)
      }))
      .filter((g) => g.rows.length > 0 || g.unit.id === unit.id)
  }, [units, unit.id, agents])
  const total = groups.reduce((n, g) => n + g.rows.length, 0)

  return (
    <div className="card flex flex-col overflow-hidden">
      <div className="flex items-start gap-3 border-b border-line px-4 py-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md" style={{ background: `${unit.color}22` }}>
          <Icon size={15} style={{ color: unit.color }} />
        </div>
        <div className="min-w-0 flex-1">
          {crumbs.length > 0 && (
            <div className="flex items-center gap-0.5 truncate text-[10.5px] text-zinc-500">
              {crumbs.map((c, i) => (
                <span key={c.id} className="flex items-center gap-0.5">
                  {i > 0 && <ChevronRight size={10} />}
                  {c.name}
                </span>
              ))}
            </div>
          )}
          <div className="truncate text-[13.5px] font-semibold text-zinc-100">{unit.name}</div>
          <div className="text-[11px] text-zinc-400">
            {KIND_META[unit.kind].label} · {t('project:agents', { count: total })}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            className="btn-ghost h-6 px-2 text-[11.5px]"
            onClick={() => {
              showOrg('teams')
              selectUnit(unit.id)
            }}
          >
            <ExternalLink size={12} /> {t('project:team.editInOrg')}
          </button>
          <button className="icon-btn hover:text-rose-400" title={t('project:team.removeFromProject')} onClick={onRemove}>
            <X size={13} />
          </button>
        </div>
      </div>
      <div className="flex-1 py-1">
        {total === 0 && <div className="px-4 py-3 text-[12px] text-zinc-500">{t('project:team.noAgentsInUnit')}</div>}
        {groups.map((g) => (
          <div key={g.unit.id}>
            {g.unit.id !== unit.id && g.rows.length > 0 && (
              <div className="flex items-center gap-1.5 px-4 pb-0.5 pt-2 text-[10.5px] font-medium uppercase tracking-wider text-zinc-500">
                {(() => {
                  const SubIcon = KIND_META[g.unit.kind].icon
                  return <SubIcon size={11} style={{ color: g.unit.color }} />
                })()}
                {g.unit.name}
              </div>
            )}
            {g.rows.map(({ agent: a, title }) => {
              const away = elsewhere.get(a.id)
              return (
                <button
                  key={a.id}
                  onClick={() => {
                    selectAgent(a.id)
                    setTab('office')
                  }}
                  className="flex w-full items-center gap-2.5 px-4 py-1.5 text-left hover:bg-white/[0.03]"
                >
                  <PixelAvatar agent={a} size={26} showStatus className={a.enabled ? '' : 'opacity-40 grayscale'} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[12.5px] font-medium text-zinc-200">{a.name}</span>
                      {a.id === projectLeadId && (
                        <span className="rounded bg-amber-500/15 px-1 text-[9.5px] font-semibold uppercase tracking-wide text-amber-300">{t('project:projectLead')}</span>
                      )}
                      {g.unit.leadAgentId === a.id && a.id !== projectLeadId && (
                        <span className="rounded bg-indigo-500/15 px-1 text-[9.5px] font-semibold uppercase tracking-wide text-indigo-300">{t('project:lead')}</span>
                      )}
                    </div>
                    <div className="truncate text-[11px] text-zinc-400">{title ? `${title} · ${a.role}` : a.role}</div>
                  </div>
                  {away ? (
                    <span className="flex max-w-[140px] shrink-0 items-center gap-1 text-[10.5px] text-zinc-500" title={t('project:team.busyIn')}>
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: projectColor(away.projectId!) }} />
                      <span className="truncate">{projectName(away.projectId!)}</span>
                    </span>
                  ) : (
                    <span className={cn('shrink-0 text-[10.5px]', STATUS_META[a.status].text)}>{STATUS_META[a.status].label}</span>
                  )}
                  <MemberTokens agentId={a.id} />
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

/** Popover listing organization units to assign to the project. */
function UnitPicker({ assignedIds, onPick, onClose }: { assignedIds: string[]; onPick: (id: string) => void; onClose: () => void }) {
  const { t } = useTranslation()
  const units = useAppStore((s) => s.units)
  const showOrg = useAppStore((s) => s.showOrg)
  const ref = useRef<HTMLDivElement>(null)
  const tree = useMemo(() => flattenTree(units), [units])
  const covered = useMemo(() => {
    const out = new Set<string>()
    for (const id of assignedIds) for (const d of descendantIds(units, id)) out.add(d)
    return out
  }, [assignedIds, units])

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      // the wrapper also holds the toggle button, which handles its own clicks
      if (!ref.current?.parentElement?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div ref={ref} className="card shadow-pop absolute right-0 top-9 z-40 w-[320px] p-1.5 text-left animate-fade-in">
      <div className="panel-title px-2 pb-1 pt-1">{t('project:team.pickerTitle')}</div>
      <div className="max-h-[320px] overflow-y-auto">
        {tree.map(({ unit, depth }) => {
          const Icon = KIND_META[unit.kind].icon
          const done = covered.has(unit.id)
          return (
            <button
              key={unit.id}
              disabled={done}
              onClick={() => onPick(unit.id)}
              className={cn('flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left', done ? 'cursor-default opacity-50' : 'hover:bg-white/[0.05]')}
              style={{ paddingLeft: 8 + depth * 16 }}
            >
              <Icon size={13} style={{ color: unit.color }} className="shrink-0" />
              <span className="truncate text-[12.5px] text-zinc-200">{unit.name}</span>
              <span className="ml-auto shrink-0 text-[10.5px] text-zinc-500">{done ? t('project:team.added') : t('project:people', { count: unit.members.length })}</span>
            </button>
          )
        })}
      </div>
      <div className="mt-1 border-t border-line pt-1">
        <button className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-200" onClick={() => showOrg('templates')}>
          <LayoutTemplate size={13} /> {t('project:team.newFromTemplate')}
        </button>
      </div>
    </div>
  )
}

function MemberTokens({ agentId }: { agentId: string }) {
  const { t } = useTranslation()
  const u = useAppStore((s) => s.usage?.agents.find((x) => x.agentId === agentId))
  return (
    <span className="w-14 shrink-0 text-right font-mono text-[10.5px] text-zinc-500" title={usageTitle(t('office:allTime'), u?.allTime, u?.reporting)}>
      {u?.allTime.calls ? `${compact(u.allTime.total)} tk` : '—'}
    </span>
  )
}
