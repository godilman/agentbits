import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Archive,
  Brain,
  DatabaseBackup,
  Eraser,
  FolderOpen,
  HardDrive,
  History,
  Paperclip,
  RotateCcw,
  ScrollText,
  Trash2,
  TriangleAlert
} from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'
import type { I18nKey } from '@shared/i18n'
import type { BackupInfo, DataPart, DataUsage, ProjectUsage, ResetMode } from '@shared/types'
import { Toggle } from '@/components/common/ui'
import { locale, t } from '@/i18n'
import { apiError, call } from '@/lib/api'
import { cn, compact, timeAgo } from '@/lib/format'
import { shortPath } from '@/lib/org'
import { useAppStore } from '@/store/useAppStore'
import { Heading, Row } from './parts'

/** Settings → Data management: usage, scoped clean-up, log retention, backups, factory reset. */

const PARTS: { id: DataPart; labelKey: I18nKey; hintKey: I18nKey; count: (p: ProjectUsage) => number }[] = [
  { id: 'memories', labelKey: 'settings:data.parts.memories', hintKey: 'settings:data.parts.memoriesHint', count: (p) => p.memories },
  { id: 'messages', labelKey: 'settings:data.parts.messages', hintKey: 'settings:data.parts.messagesHint', count: (p) => p.messages },
  { id: 'logs', labelKey: 'settings:data.parts.logs', hintKey: 'settings:data.parts.logsHint', count: (p) => p.logs + p.runs },
  { id: 'reports', labelKey: 'settings:data.parts.reports', hintKey: 'settings:data.parts.reportsHint', count: (p) => p.reports },
  { id: 'decisions', labelKey: 'settings:data.parts.decisions', hintKey: 'settings:data.parts.decisionsHint', count: (p) => p.decisions },
  { id: 'tasks', labelKey: 'settings:data.parts.tasks', hintKey: 'settings:data.parts.tasksHint', count: (p) => p.tasks },
  { id: 'files', labelKey: 'settings:data.parts.files', hintKey: 'settings:data.parts.filesHint', count: (p) => p.files }
]

const RETENTION = [
  { value: 7, get label() { return t('settings:data.retention.days', { count: 7 }) } },
  { value: 30, get label() { return t('settings:data.retention.days', { count: 30 }) } },
  { value: 90, get label() { return t('settings:data.retention.days', { count: 90 }) } },
  { value: 365, get label() { return t('settings:data.retention.year') } },
  { value: 0, get label() { return t('settings:data.retention.forever') } }
]

function bytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

const projectTotal = (p: ProjectUsage): number => p.tasks + p.runs + p.messages + p.logs + p.memories + p.decisions + p.reports

export function DataSection() {
  const { t } = useTranslation()
  const toast = useAppStore((s) => s.toast)
  const settings = useAppStore((s) => s.settings)
  const memoryVersion = useAppStore((s) => s.memoryVersion)
  const focusId = useAppStore((s) => s.dataFocusProjectId)
  const [usage, setUsage] = useState<DataUsage | null>(null)
  const [backups, setBackups] = useState<BackupInfo[]>([])
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [u, b] = await Promise.all([call('data:usage'), call('data:listBackups')])
    setUsage(u)
    setBackups(b)
  }, [])

  useEffect(() => {
    void load()
  }, [load, memoryVersion])

  /** Runs an action with a busy key, a toast and a refresh of the figures. */
  const act = async <T,>(key: string, fn: () => Promise<T>, ok: (r: T) => string): Promise<T | undefined> => {
    setBusy(key)
    try {
      const r = await fn()
      toast('success', ok(r))
      return r
    } catch (e) {
      toast('error', apiError(e))
      return undefined
    } finally {
      setBusy(null)
      void load()
    }
  }

  if (!usage) return <Heading title={t('settings:data.title')} desc={t('status.loading')} />

  const projects = [...usage.projects].sort((a, b) => projectTotal(b) - projectTotal(a))

  return (
    <>
      <Heading
        title={t('settings:data.title')}
        desc={t('settings:data.desc')}
        action={
          <button className="btn-outline h-7 shrink-0" onClick={() => void call('data:openFolder')}>
            <FolderOpen size={13} /> {t('settings:data.openFolder')}
          </button>
        }
      />

      {/* usage overview */}
      <div className="mb-2 grid grid-cols-5 gap-3">
        <Stat
          icon={HardDrive}
          label={t('settings:data.stats.database')}
          value={bytes(usage.dbBytes + usage.walBytes)}
          sub={t('settings:data.stats.databaseSub', { agents: usage.agents, units: usage.units, projects: usage.projects.length })}
        />
        <Stat
          icon={ScrollText}
          label={t('settings:data.stats.logs')}
          value={compact(usage.logs)}
          sub={usage.oldestLogAt ? t('settings:data.stats.oldest', { time: timeAgo(usage.oldestLogAt) }) : t('settings:data.stats.noLogs')}
        />
        <Stat
          icon={Brain}
          label={t('settings:data.stats.orgMemory')}
          value={compact(usage.orgMemories)}
          sub={t('settings:data.stats.decisionRecords', { count: usage.orgDecisionMemories })}
        />
        <Stat icon={DatabaseBackup} label={t('settings:data.stats.backups')} value={bytes(usage.backupsBytes)} sub={t('settings:data.stats.backupCount', { count: backups.length })} />
        <Stat icon={Paperclip} label={t('settings:data.stats.files')} value={bytes(usage.filesBytes)} sub={t('settings:data.stats.filesSub', { count: usage.filesCount })} />
      </div>
      <div className="selectable mb-7 truncate font-mono text-[11px] text-zinc-500" title={usage.dataDir}>
        {usage.dataDir}
      </div>

      {/* per project */}
      <SectionTitle title={t('settings:data.projects.title')} desc={t('settings:data.projects.desc')} />
      <div className="card mb-7 divide-y divide-line">
        {projects.map((p) => (
          <ProjectRow
            key={p.projectId}
            p={p}
            initiallyOpen={p.projectId === focusId}
            busy={busy === p.projectId}
            onClear={(parts, keep) =>
              act(
                p.projectId,
                () => call('data:clearProject', p.projectId, parts, { keepDecisionMemories: keep }),
                (r) => t('settings:data.projects.cleared', { name: p.name, count: r.deleted })
              )
            }
          />
        ))}
      </div>

      {/* organization-wide */}
      <SectionTitle title={t('settings:data.org.title')} desc={t('settings:data.org.desc')} />
      <div className="card mb-7 divide-y divide-line">
        <OrgMemoryRow
          total={usage.orgMemories}
          decisions={usage.orgDecisionMemories}
          busy={busy === 'org'}
          onClear={(keepDecisions) =>
            act('org', () => call('data:clearOrgMemory', { keepDecisions }), (r) => t('settings:data.org.cleared', { count: r.deleted }))
          }
        />
        <Row
          title={t('settings:data.retention.title')}
          desc={
            settings.logRetentionDays > 0
              ? t('settings:data.retention.auto', { days: settings.logRetentionDays })
              : t('settings:data.retention.never')
          }
        >
          <div className="flex items-center gap-2">
            <select
              className="input h-7 w-28 text-[12px]"
              value={settings.logRetentionDays}
              onChange={(e) => void call('settings:update', { logRetentionDays: Number(e.target.value) })}
            >
              {RETENTION.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
            <button
              className="btn-outline h-7"
              disabled={settings.logRetentionDays === 0 || busy === 'logs'}
              onClick={() =>
                void act('logs', () => call('data:pruneLogs', settings.logRetentionDays), (r) =>
                  r.deleted ? t('settings:data.retention.pruned', { count: r.deleted }) : t('settings:data.retention.nothing')
                )
              }
            >
              <Eraser size={13} /> {t('settings:data.retention.apply')}
            </button>
          </div>
        </Row>
      </div>

      {/* backups */}
      <SectionTitle
        title={t('settings:data.backups.title')}
        desc={t('settings:data.backups.desc')}
        action={
          <button
            className="btn-primary h-7"
            disabled={busy === 'backup'}
            onClick={() => void act('backup', () => call('data:backup'), (b) => t('settings:data.backups.created', { size: bytes(b.bytes) }))}
          >
            <Archive size={13} /> {t('settings:data.backups.create')}
          </button>
        }
      />
      <div className="card mb-7 divide-y divide-line">
        {backups.map((b) => (
          <BackupRow
            key={b.name}
            b={b}
            onDelete={() => void act('del:' + b.name, () => call('data:deleteBackup', b.name), () => t('settings:data.backups.deleted'))}
            onRestore={() =>
              void act('restore', () => call('data:restoreBackup', b.name), () => t('settings:data.backups.restoring'))
            }
          />
        ))}
        {backups.length === 0 && <div className="px-5 py-4 text-[12px] text-zinc-400">{t('settings:data.backups.empty')}</div>}
      </div>

      {/* factory reset */}
      <FactoryReset
        busy={busy === 'reset'}
        onReset={(mode) =>
          act('reset', () => call('data:factoryReset', mode), (r) =>
            mode === 'all' ? t('settings:data.reset.doneAll', { name: r.backup.name }) : t('settings:data.reset.doneWork', { name: r.backup.name })
          )
        }
      />
    </>
  )
}

/* ───────────────────────────── pieces ───────────────────────────── */

function Stat({ icon: Icon, label, value, sub }: { icon: React.ComponentType<{ size?: number; className?: string }>; label: string; value: string; sub: string }) {
  return (
    <div className="card p-3.5">
      <div className="flex items-center gap-1.5 text-[11px] text-zinc-400">
        <Icon size={12} /> {label}
      </div>
      <div className="mt-1 text-[18px] font-semibold tabular-nums text-zinc-100">{value}</div>
      <div className="truncate text-[11px] text-zinc-500">{sub}</div>
    </div>
  )
}

function SectionTitle({ title, desc, action }: { title: string; desc: string; action?: React.ReactNode }) {
  return (
    <div className="mb-2.5 flex items-end justify-between gap-4">
      <div>
        <div className="text-[13.5px] font-semibold text-zinc-100">{title}</div>
        <div className="text-[12px] text-zinc-400">{desc}</div>
      </div>
      {action && <div className="shrink-0 whitespace-nowrap">{action}</div>}
    </div>
  )
}

function ProjectRow({
  p,
  initiallyOpen,
  busy,
  onClear
}: {
  p: ProjectUsage
  initiallyOpen: boolean
  busy: boolean
  onClear: (parts: DataPart[], keepDecisionMemories: boolean) => Promise<unknown>
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(initiallyOpen)
  const [parts, setParts] = useState<Set<DataPart>>(new Set(['memories', 'messages', 'logs']))
  const [keepDecisions, setKeepDecisions] = useState(true)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (initiallyOpen) ref.current?.scrollIntoView({ block: 'center' })
  }, [initiallyOpen])

  const toggle = (id: DataPart): void =>
    setParts((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const selectedCount = PARTS.filter((x) => parts.has(x.id)).reduce((s, x) => s + x.count(p), 0)

  return (
    <div ref={ref} className={cn(open && 'bg-white/[0.015]')}>
      <div className="flex items-center gap-3 px-5 py-3">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: p.color }} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[13px] text-zinc-200">
            <span className="truncate">{p.name}</span>
            {p.status === 'archived' && <span className="rounded bg-white/5 px-1.5 text-[10px] text-zinc-400">{t('settings:data.projects.archived')}</span>}
          </div>
          <div className="text-[11.5px] tabular-nums text-zinc-500">
            {t('settings:data.projects.summary', {
              tasks: p.tasks,
              messages: p.messages,
              logs: p.logs,
              memories: p.memories,
              decisions: p.decisions,
              reports: p.reports,
              files: p.files,
              size: bytes(p.fileBytes)
            })}
          </div>
        </div>
        <button className="btn-outline h-7" onClick={() => setOpen((v) => !v)}>
          <Eraser size={13} /> {open ? t('actions.close') : t('settings:data.projects.clean')}
        </button>
      </div>
      {open && (
        <div className="px-5 pb-4">
          <div className="grid grid-cols-3 gap-2">
            {PARTS.map((x) => {
              const n = x.count(p)
              return (
                <label
                  key={x.id}
                  className={cn(
                    'flex cursor-pointer items-start gap-2 rounded-md border px-2.5 py-2',
                    parts.has(x.id) ? 'border-indigo-500/40 bg-indigo-500/[0.06]' : 'border-line hover:bg-white/[0.02]'
                  )}
                >
                  <input type="checkbox" className="mt-0.5 accent-indigo-500" checked={parts.has(x.id)} onChange={() => toggle(x.id)} />
                  <div className="min-w-0">
                    <div className="text-[12.5px] text-zinc-200">
                      {t(x.labelKey)} <span className="tabular-nums text-zinc-500">({n})</span>
                    </div>
                    <div className="text-[11px] text-zinc-500">{t(x.hintKey)}</div>
                  </div>
                </label>
              )
            })}
          </div>
          <div className="mt-3 flex items-center gap-3">
            {parts.has('memories') && (
              <label className="flex items-center gap-2 text-[12px] text-zinc-300">
                <Toggle size="sm" checked={keepDecisions} onChange={setKeepDecisions} /> {t('settings:data.projects.keepDecisionMemory')}
              </label>
            )}
            <button
              className="btn-danger ml-auto h-7"
              disabled={parts.size === 0 || busy}
              onClick={() => void onClear([...parts], keepDecisions).then(() => setOpen(false))}
            >
              <Trash2 size={13} /> {selectedCount ? t('settings:data.projects.deleteCount', { count: selectedCount }) : t('settings:data.projects.deleteSelected')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function OrgMemoryRow({ total, decisions, busy, onClear }: { total: number; decisions: number; busy: boolean; onClear: (keepDecisions: boolean) => Promise<unknown> }) {
  const { t } = useTranslation()
  const [keep, setKeep] = useState(true)
  const [confirm, setConfirm] = useState(false)
  const n = keep ? total - decisions : total
  return (
    <Row title={t('settings:data.org.memoryTitle')} desc={t('settings:data.org.memoryDesc', { total, decisions })}>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-[12px] text-zinc-300">
          <Toggle size="sm" checked={keep} onChange={setKeep} /> {t('settings:data.org.keepDecisions')}
        </label>
        {confirm ? (
          <>
            <button className="btn-ghost h-7" onClick={() => setConfirm(false)}>
              {t('actions.cancel')}
            </button>
            <button
              className="btn-danger h-7"
              disabled={busy}
              onClick={() => void onClear(keep).then(() => setConfirm(false))}
            >
              {t('settings:data.org.confirmDelete', { count: n })}
            </button>
          </>
        ) : (
          <button className="btn-outline h-7" disabled={n === 0} onClick={() => setConfirm(true)}>
            <Eraser size={13} /> {t('settings:data.org.clean')}
          </button>
        )}
      </div>
    </Row>
  )
}

function BackupRow({ b, onDelete, onRestore }: { b: BackupInfo; onDelete: () => void; onRestore: () => void }) {
  const { t } = useTranslation()
  const [confirm, setConfirm] = useState(false)
  return (
    <div className="group flex items-center gap-3 px-5 py-2.5">
      <History size={14} className="shrink-0 text-zinc-500" />
      <div className="min-w-0 flex-1">
        <div className="selectable truncate font-mono text-[12px] text-zinc-200" title={b.path}>
          {b.name}
        </div>
        <div className="text-[11px] text-zinc-500">
          {bytes(b.bytes)} · {timeAgo(b.createdAt)}
        </div>
      </div>
      {confirm ? (
        <div className="flex items-center gap-2">
          <span className="text-[11.5px] text-amber-300">{t('settings:data.backups.restoreWarning')}</span>
          <button className="btn-ghost h-7" onClick={() => setConfirm(false)}>
            {t('actions.cancel')}
          </button>
          <button className="btn-primary h-7" onClick={onRestore}>
            {t('settings:data.backups.restore')}
          </button>
        </div>
      ) : (
        <>
          <button className="btn-outline h-7 opacity-0 group-hover:opacity-100" onClick={() => setConfirm(true)}>
            <RotateCcw size={13} /> {t('settings:data.backups.restore')}
          </button>
          <button className="icon-btn opacity-0 hover:text-rose-400 group-hover:opacity-100" title={t('settings:data.backups.deleteTitle')} onClick={onDelete}>
            <Trash2 size={13} />
          </button>
        </>
      )}
    </div>
  )
}

const RESET_MODES: { id: ResetMode; titleKey: I18nKey; descKey: I18nKey; keepsKey: I18nKey }[] = [
  { id: 'work', titleKey: 'settings:data.reset.work.title', descKey: 'settings:data.reset.work.desc', keepsKey: 'settings:data.reset.work.keeps' },
  { id: 'all', titleKey: 'settings:data.reset.all.title', descKey: 'settings:data.reset.all.desc', keepsKey: 'settings:data.reset.all.keeps' }
]

function FactoryReset({ busy, onReset }: { busy: boolean; onReset: (mode: ResetMode) => Promise<unknown> }) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<ResetMode>('work')
  const [typed, setTyped] = useState('')
  const resetWord = t('settings:data.reset.word')
  const ready = typed.trim().toLocaleUpperCase(locale()) === resetWord
  return (
    <div className="rounded-lg border border-rose-500/30 bg-rose-500/[0.04] p-5">
      <div className="flex items-center gap-2 text-[13.5px] font-semibold text-rose-200">
        <TriangleAlert size={15} /> {t('settings:data.reset.title')}
      </div>
      <div className="mt-1 text-[12px] text-rose-200/70">
        {t('settings:data.reset.desc')}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        {RESET_MODES.map((m) => (
          <button
            key={m.id}
            onClick={() => setMode(m.id)}
            className={cn(
              'rounded-md border p-3 text-left transition-colors',
              mode === m.id ? 'border-rose-400/60 bg-rose-500/[0.08]' : 'border-line hover:bg-white/[0.02]'
            )}
          >
            <div className="flex items-center gap-2 text-[13px] text-zinc-100">
              <span className={cn('h-3 w-3 rounded-full border', mode === m.id ? 'border-rose-400 bg-rose-400' : 'border-zinc-500')} />
              {t(m.titleKey)}
            </div>
            <div className="mt-1.5 text-[11.5px] leading-snug text-zinc-300">{t(m.descKey)}</div>
            <div className="mt-1 text-[11px] leading-snug text-zinc-500">{t(m.keepsKey)}</div>
          </button>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-3">
        <div className="text-[12px] text-zinc-300">
          <Trans
            i18nKey="settings:data.reset.confirm"
            values={{ word: resetWord }}
            components={{ word: <span className="font-mono font-semibold text-rose-200" /> }}
          />
        </div>
        <input
          id="reset-confirm"
          className="input h-8 w-40 font-mono"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={resetWord}
          spellCheck={false}
        />
        <button
          className="btn ml-auto h-8 bg-rose-600 text-white hover:bg-rose-500 disabled:opacity-40"
          disabled={!ready || busy}
          onClick={() => void onReset(mode).then(() => setTyped(''))}
        >
          <RotateCcw size={13} /> {mode === 'all' ? t('settings:data.reset.buttonAll') : t('settings:data.reset.buttonWork')}
        </button>
      </div>
    </div>
  )
}
