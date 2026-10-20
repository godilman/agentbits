import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, FolderKanban, Star, UserRoundX } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Agent, OrgUnit, Project } from '@shared/types'
import { unitMemberIds } from '@shared/org'
import { PixelAvatar } from '@/components/common/PixelAvatar'
import { cn } from '@/lib/format'
import { useAppStore } from '@/store/useAppStore'
import { childrenMap, KIND_META, projectsForUnit, rootUnit } from './meta'

const MAX_AVATARS = 6

interface ChartCtx {
  kids: Map<string, OrgUnit[]>
  units: OrgUnit[]
  agentsById: Map<string, Agent>
  projects: Project[]
  collapsed: Set<string>
  toggle: (id: string) => void
  open: (id: string) => void
}

/** Top-down org chart: root on top, sub-units below with connector lines; nodes collapse. */
export function OrgChart() {
  const { t } = useTranslation()
  const units = useAppStore((s) => s.units)
  const agents = useAppStore((s) => s.agents)
  const projects = useAppStore((s) => s.projects)
  const selectUnit = useAppStore((s) => s.selectUnit)
  const showOrg = useAppStore((s) => s.showOrg)
  const openAgentProfile = useAppStore((s) => s.openAgentProfile)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const scrollRef = useRef<HTMLDivElement>(null)

  // Wide trees scroll horizontally; open centred on the root.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollLeft = Math.max(0, (el.scrollWidth - el.clientWidth) / 2)
  }, [])

  const kids = useMemo(() => childrenMap(units), [units])
  const agentsById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents])
  const root = useMemo(() => rootUnit(units), [units])
  const unassigned = useMemo(() => {
    const inUnit = new Set(units.flatMap((u) => u.members.map((m) => m.agentId)))
    return agents.filter((a) => !inUnit.has(a.id))
  }, [units, agents])

  const ctx: ChartCtx = {
    kids,
    units,
    agentsById,
    projects,
    collapsed,
    toggle: (id) =>
      setCollapsed((s) => {
        const n = new Set(s)
        if (n.has(id)) n.delete(id)
        else n.add(id)
        return n
      }),
    open: (id) => {
      selectUnit(id)
      showOrg('teams')
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        <div className="flex w-max min-w-full justify-center px-10 pb-12 pt-8">{root ? <ChartNode unit={root} ctx={ctx} /> : null}</div>
      </div>

      <div className="flex shrink-0 items-center gap-4 border-t border-line bg-[#0c0c0e] px-5 py-3">
        <div className="flex shrink-0 items-center gap-2">
          <UserRoundX size={14} className="text-zinc-500" />
          <span className="panel-title">{t('org:chart.unassigned')}</span>
          <span className="font-mono text-[11px] text-zinc-500">{unassigned.length}</span>
        </div>
        {unassigned.length === 0 ? (
          <span className="text-[13px] text-zinc-500">{t('org:chart.allAssigned')}</span>
        ) : (
          <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto">
            {unassigned.map((a) => (
              <button
                key={a.id}
                onClick={() => openAgentProfile(a.id)}
                className="flex shrink-0 items-center gap-2 rounded-md border border-line bg-surface px-2 py-1 hover:border-zinc-600"
                title={`${a.name} · ${a.role}`}
              >
                <PixelAvatar agent={a} size={20} showStatus />
                <span className="text-[12px] text-zinc-300">{a.name}</span>
                <span className="text-[12px] text-zinc-500">{a.role}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ChartNode({ unit, ctx }: { unit: OrgUnit; ctx: ChartCtx }) {
  const children = ctx.kids.get(unit.id) ?? []
  const isCollapsed = ctx.collapsed.has(unit.id)
  return (
    <div className="flex flex-col items-center">
      <NodeCard unit={unit} ctx={ctx} childCount={children.length} collapsed={isCollapsed} />
      {children.length > 0 && !isCollapsed && (
        <>
          <div className="h-6 w-px bg-zinc-700" />
          <div className="flex">
            {children.map((c, i) => (
              <div key={c.id} className="relative flex flex-col items-center px-3 pt-6">
                {children.length > 1 && (
                  <span
                    className="absolute top-0 h-px bg-zinc-700"
                    style={{ left: i === 0 ? '50%' : 0, right: i === children.length - 1 ? '50%' : 0 }}
                  />
                )}
                <span className="absolute left-1/2 top-0 h-6 w-px bg-zinc-700" />
                <ChartNode unit={c} ctx={ctx} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function NodeCard({ unit, ctx, childCount, collapsed }: { unit: OrgUnit; ctx: ChartCtx; childCount: number; collapsed: boolean }) {
  const { t } = useTranslation()
  const meta = KIND_META[unit.kind]
  const members = unit.members.map((m) => ctx.agentsById.get(m.agentId)).filter((a): a is Agent => !!a)
  // Lead first so it is always visible in the avatar row.
  members.sort((a, b) => Number(b.id === unit.leadAgentId) - Number(a.id === unit.leadAgentId))
  const deep = childCount ? unitMemberIds(ctx.units, unit.id, true).filter((id) => ctx.agentsById.has(id)).length : members.length
  const projectCount = projectsForUnit(ctx.projects, ctx.units, unit.id).length
  const lead = unit.leadAgentId ? ctx.agentsById.get(unit.leadAgentId) : undefined
  const isRoot = !unit.parentId

  return (
    <div className="relative">
      <button
        onClick={() => ctx.open(unit.id)}
        className={cn(
          'group block w-[232px] overflow-hidden rounded-lg border bg-surface text-left shadow-[0_1px_0_rgba(255,255,255,0.02)] transition-colors hover:border-zinc-600',
          isRoot ? 'border-zinc-700' : 'border-line'
        )}
      >
        <div className="h-[3px]" style={{ background: unit.color }} />
        <div className="px-3.5 pb-3 pt-2.5">
          {/* The unit color (any color the user picked) on the icon only: as text it can be unreadable. */}
          <div className="flex items-center gap-1.5 text-[12px] font-medium uppercase tracking-wider text-zinc-400">
            <meta.icon size={12} style={{ color: unit.color }} />
            {meta.label}
          </div>
          <div className="mt-0.5 truncate text-[13px] font-semibold text-zinc-100 group-hover:text-white">{unit.name}</div>
          {lead && (
            <div className="mt-0.5 flex items-center gap-1 truncate text-[12px] text-zinc-500">
              <Star size={10} className="shrink-0 fill-amber-300 text-amber-300" /> {lead.name}
            </div>
          )}

          <div className="mt-2.5 flex h-[24px] items-center gap-1">
            {members.slice(0, MAX_AVATARS).map((a) => (
              <div key={a.id} className="relative">
                <PixelAvatar agent={a} size={22} className={a.id === unit.leadAgentId ? 'rounded-md ring-1 ring-amber-300/70' : ''} />
              </div>
            ))}
            {members.length > MAX_AVATARS && (
              <span className="flex h-[22px] min-w-[22px] items-center justify-center rounded-md bg-white/5 px-1 font-mono text-[10px] text-zinc-400">
                +{members.length - MAX_AVATARS}
              </span>
            )}
            {members.length === 0 && <span className="text-[12px] text-zinc-500">{t('org:chart.noDirectMembers')}</span>}
          </div>

          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 gap-y-1 text-[12px]">
            <span className="text-zinc-500">
              {t('org:counts.agents', { count: members.length })}
              {deep > members.length && <span className="text-zinc-500"> · {t('org:chart.total', { count: deep })}</span>}
            </span>
            {projectCount > 0 ? (
              <span className="inline-flex items-center gap-1 rounded bg-indigo-500/10 px-1.5 py-px text-indigo-300">
                <FolderKanban size={10} /> {t('org:chart.inProjects', { count: projectCount })}
              </span>
            ) : (
              <span className="text-zinc-500">{t('org:chart.notInProject')}</span>
            )}
          </div>
        </div>
      </button>
      {childCount > 0 && (
        <button
          onClick={() => ctx.toggle(unit.id)}
          title={collapsed ? t('org:chart.showChildren') : t('org:chart.hideChildren')}
          className="absolute -bottom-2.5 left-1/2 z-10 flex h-5 -translate-x-1/2 items-center gap-0.5 rounded-full border border-zinc-700 bg-[#121215] px-1.5 text-[10px] text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
        >
          {collapsed ? <ChevronDown size={11} /> : <ChevronUp size={11} />}
          {childCount}
        </button>
      )}
    </div>
  )
}
