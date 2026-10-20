import { useEffect, useMemo, useRef, useState } from 'react'
import { Bot, LayoutGrid } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Empty, Segmented } from '@/components/common/ui'
import { useProjectScope } from '@/lib/org'
import { useAppStore } from '@/store/useAppStore'
import { AgentPane } from './AgentPane'

type Cols = 'auto' | '1' | '2' | '3' | '4'
type Filter = 'all' | 'active'

const MIN_PANE_W = 440
const MIN_PANE_H = 340
const GAP = 10

/**
 * Every agent of the project in one responsive grid, each with its own live
 * terminal. A pane can be maximised (fills the grid) or put in full screen.
 */
export function AgentGrid() {
  const { t } = useTranslation()
  const { pid, team, lead } = useProjectScope()
  const orgAgentCount = useAppStore((s) => s.agents.length)
  const activeRuns = useAppStore((s) => s.activeRuns)
  const [filter, setFilter] = useState<Filter>('all')
  const [cols, setCols] = useState<Cols>('auto')
  const [maxId, setMaxId] = useState<string | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 1000, h: 700 })

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const busyIds = useMemo(() => new Set(activeRuns.map((r) => r.agentId)), [activeRuns])
  const shown = useMemo(() => {
    const list = filter === 'active' ? team.filter((a) => busyIds.has(a.id) || a.status === 'working') : team
    // Lead first, then working agents, then the rest.
    return [...list].sort((a, b) => Number(b.id === lead?.id) - Number(a.id === lead?.id) || Number(busyIds.has(b.id)) - Number(busyIds.has(a.id)))
  }, [team, filter, busyIds, lead])

  // Leave maximised mode if that agent is no longer in the list.
  useEffect(() => {
    if (maxId && !shown.some((a) => a.id === maxId)) setMaxId(null)
  }, [shown, maxId])

  const n = shown.length
  const colCount = cols === 'auto' ? Math.max(1, Math.min(4, n, Math.floor((size.w + GAP) / (MIN_PANE_W + GAP)))) : Number(cols)
  const rows = Math.max(1, Math.ceil(n / colCount))
  // Fill the height when everything fits; otherwise scroll with a comfortable pane height.
  const fitH = (size.h - GAP * (rows - 1)) / rows
  const paneH = fitH >= MIN_PANE_H ? fitH : Math.max(MIN_PANE_H, Math.min(460, size.h))

  if (!pid) return null

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-line px-3 py-2">
        <Segmented<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: t('terminal:grid.all', { count: team.length }) },
            { value: 'active', label: t('terminal:grid.active', { count: team.filter((a) => busyIds.has(a.id) || a.status === 'working').length }) }
          ]}
        />
        <div className="ml-auto flex items-center gap-2 text-[12px] text-zinc-500">
          <LayoutGrid size={12} /> {t('terminal:grid.columns')}
          <Segmented<Cols>
            value={cols}
            onChange={setCols}
            options={[
              { value: 'auto', label: t('terminal:grid.auto') },
              { value: '1', label: '1' },
              { value: '2', label: '2' },
              { value: '3', label: '3' },
              { value: '4', label: '4' }
            ]}
          />
        </div>
      </div>
      <div ref={wrapRef} className="relative min-h-0 flex-1 overflow-y-auto p-2.5">
        {n === 0 ? (
          <Empty
            icon={<Bot size={18} />}
            title={filter === 'active' ? t('terminal:grid.noneWorking') : orgAgentCount === 0 ? t('terminal:grid.noAgents') : t('terminal:grid.noProjectAgents')}
            hint={
              filter === 'active'
                ? t('terminal:grid.noneWorkingHint')
                : orgAgentCount === 0
                  ? t('terminal:grid.noAgentsHint')
                  : t('terminal:grid.noProjectAgentsHint')
            }
            action={
              filter !== 'active' && orgAgentCount === 0 ? (
                <button className="btn-primary" onClick={() => useAppStore.getState().openGuide()}>
                  {t('terminal:grid.openGuide')}
                </button>
              ) : undefined
            }
          />
        ) : (
          <div
            className="grid"
            style={
              maxId
                ? { gridTemplateColumns: '1fr', gap: GAP, height: '100%' }
                : { gridTemplateColumns: `repeat(${colCount}, minmax(0, 1fr))`, gridAutoRows: `${paneH}px`, gap: GAP }
            }
          >
            {shown.map((a) => (
              // Panes stay mounted when another one is maximised, so their state and scroll survive.
              <div key={a.id} className={maxId && maxId !== a.id ? 'hidden' : 'min-h-0'} style={maxId === a.id ? { height: '100%' } : undefined}>
                <div className="flex h-full min-h-0 flex-col">
                  <AgentPane
                    agent={a}
                    projectId={pid}
                    isLead={a.id === lead?.id}
                    maximized={maxId === a.id}
                    onToggleMaximize={() => setMaxId((cur) => (cur === a.id ? null : a.id))}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
