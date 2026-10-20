import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { I18nKey } from '@shared/i18n'
import type { AuditEntry, AuditResult } from '@shared/types'
import { PixelAvatar } from '@/components/common/PixelAvatar'
import { Segmented } from '@/components/common/ui'
import { apiError, call } from '@/lib/api'
import { locale } from '@/i18n'
import { cn } from '@/lib/format'
import { agentById, useAppStore } from '@/store/useAppStore'

const RESULT_CLS: Record<AuditResult, string> = {
  ok: 'bg-emerald-500/10 text-emerald-300',
  error: 'bg-rose-500/10 text-rose-300',
  denied: 'bg-amber-500/15 text-amber-300',
  pending: 'bg-sky-500/10 text-sky-300'
}
const RESULT_LABEL = {
  ok: 'connections:audit.result.ok',
  error: 'connections:audit.result.error',
  denied: 'connections:audit.result.denied',
  pending: 'connections:audit.result.pending'
} as const satisfies Record<AuditResult, I18nKey>
const ACTION_KEYS = {
  list: 'connections:audit.action.list',
  schema: 'connections:audit.action.schema',
  query: 'connections:audit.action.query',
  exec: 'connections:audit.action.exec',
  test: 'connections:audit.action.test',
  permission: 'connections:audit.action.permission',
  'connection:create': 'connections:audit.action.connectionCreate',
  'connection:update': 'connections:audit.action.connectionUpdate',
  'connection:delete': 'connections:audit.action.connectionDelete',
  'query:approval': 'connections:audit.action.queryApproval',
  'exec:approval': 'connections:audit.action.execApproval',
  'approval:granted': 'connections:audit.action.approvalGranted',
  'approval:denied': 'connections:audit.action.approvalDenied'
} as const satisfies Record<string, I18nKey>
const APP_ACTION_KEYS = {
  'app:create': 'connections:audit.action.appCreate',
  'app:update': 'connections:audit.action.appUpdate',
  'app:delete': 'connections:audit.action.appDelete',
  'app:policy': 'connections:audit.action.appPolicy',
  'app:permission': 'connections:audit.action.appPermission'
} as const satisfies Record<string, I18nKey>
const APP_ACTIONS: Record<string, (typeof APP_ACTION_KEYS)[keyof typeof APP_ACTION_KEYS] | undefined> = APP_ACTION_KEYS
const ACTION_LABEL: Record<string, (typeof ACTION_KEYS)[keyof typeof ACTION_KEYS] | undefined> = ACTION_KEYS

type Filter = 'all' | AuditResult

/** Audit log of connection access and critical operations (optionally for one connection). */
export function AuditList({ connectionId }: { connectionId?: string }) {
  const { t } = useTranslation(['common', 'connections'])
  const agents = useAppStore((s) => s.agents)
  const tasks = useAppStore((s) => s.tasks)
  const version = useAppStore((s) => s.auditVersion)
  const [filter, setFilter] = useState<Filter>('all')
  const [items, setItems] = useState<AuditEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [more, setMore] = useState(false)
  const [expanded, setExpanded] = useState<number | null>(null)
  const actionLabel = (action: string): string => {
    const key = Object.hasOwn(ACTION_LABEL, action) ? ACTION_LABEL[action] : undefined
    if (key) return t(key)
    // Apps (MCP): user changes and tool calls (`app:<tool>`).
    const appKey = Object.hasOwn(APP_ACTIONS, action) ? APP_ACTIONS[action] : undefined
    if (appKey) return t(appKey)
    if (action.startsWith('app:')) return t('connections:audit.action.appTool', { tool: action.slice(4) })
    return action
  }

  useEffect(() => {
    let alive = true
    call('audit:list', { connectionId, result: filter === 'all' ? undefined : filter, limit: 200 })
      .then((l) => {
        if (!alive) return
        setItems(l)
        setMore(l.length >= 200)
        setError(null)
      })
      .catch((e) => alive && setError(apiError(e)))
    return () => {
      alive = false
    }
  }, [connectionId, filter, version])

  const older = async (): Promise<void> => {
    const last = items[items.length - 1]
    if (!last) return
    try {
      const l = await call('audit:list', { connectionId, result: filter === 'all' ? undefined : filter, beforeId: last.id, limit: 200 })
      setItems((cur) => [...cur, ...l])
      setMore(l.length >= 200)
    } catch (e) {
      setError(apiError(e))
    }
  }

  return (
    <div>
      <div className="mb-3">
        <Segmented<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: t('connections:audit.filter.all') },
            { value: 'denied', label: t('connections:audit.filter.denied') },
            { value: 'error', label: t('connections:audit.filter.error') },
            { value: 'pending', label: t('connections:audit.filter.pending') },
            { value: 'ok', label: t('connections:audit.filter.ok') }
          ]}
        />
      </div>
      {error && <div className="mb-3 text-[12px] text-rose-300">{error}</div>}
      <div className="card overflow-hidden">
        <table className="w-full table-fixed text-[13px] text-zinc-300">
          <thead className="border-b border-line text-[12px] uppercase tracking-wider text-zinc-500">
            <tr>
              <th className="w-[118px] px-3 py-2 text-left font-medium">{t('connections:audit.columns.time')}</th>
              <th className="w-[130px] px-2 py-2 text-left font-medium">{t('connections:audit.columns.who')}</th>
              {!connectionId && <th className="w-[150px] px-2 py-2 text-left font-medium">{t('connections:audit.columns.connection')}</th>}
              <th className="w-[72px] px-2 py-2 text-left font-medium">{t('connections:audit.columns.task')}</th>
              <th className="px-2 py-2 text-left font-medium">{t('connections:audit.columns.action')}</th>
              <th className="w-[112px] px-3 py-2 text-left font-medium">{t('connections:audit.columns.result')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {items.map((e) => {
              const a = e.actorType === 'agent' ? agentById(agents, e.actorId) : undefined
              const task = e.taskId ? tasks.find((x) => x.id === e.taskId) : undefined
              const open = expanded === e.id
              return (
                <tr key={e.id} className="cursor-pointer align-top hover:bg-white/[0.02]" onClick={() => setExpanded(open ? null : e.id)}>
                  <td className="px-3 py-1.5 font-mono text-[11px] text-zinc-500">
                    {new Date(e.at).toLocaleString(locale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </td>
                  <td className="px-2 py-1.5">
                    <span className="flex items-center gap-1.5">
                      {a && <PixelAvatar agent={a} size={16} />}
                      <span className="truncate">{e.actorName}</span>
                    </span>
                  </td>
                  {!connectionId && <td className="truncate px-2 py-1.5">{e.connectionName || '—'}</td>}
                  <td className="px-2 py-1.5 font-mono text-[11px] text-zinc-400">{task?.key ?? '—'}</td>
                  <td className="px-2 py-1.5">
                    <div className="text-zinc-300">{actionLabel(e.action)}</div>
                    {e.detail && <div className={cn('font-mono text-[12px] text-zinc-500', open ? 'whitespace-pre-wrap break-words' : 'truncate')}>{e.detail}</div>}
                    {e.message && <div className={cn('text-[12px]', e.result === 'ok' ? 'text-zinc-500' : 'text-amber-200/80', !open && 'truncate')}>{e.message}</div>}
                  </td>
                  <td className="px-3 py-1.5">
                    <span className={cn('rounded px-1.5 py-px text-[12px]', RESULT_CLS[e.result])}>{t(RESULT_LABEL[e.result])}</span>
                    {e.durationMs !== null && <div className="mt-0.5 text-[11px] text-zinc-500">{e.durationMs} ms</div>}
                  </td>
                </tr>
              )
            })}
            {items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-zinc-500">
                  {t('connections:audit.empty')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {more && (
        <button className="btn-ghost mt-2 w-full" onClick={() => void older()}>
          {t('connections:audit.older')}
        </button>
      )}
    </div>
  )
}
