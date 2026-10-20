import { useEffect, useMemo, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, Download, ExternalLink, FolderOpen, Loader2, ShieldAlert, Trash2, TriangleAlert } from 'lucide-react'
import type { FileDetail, FileLinkRole, FilePreview } from '@shared/types'
import { KIND_LABEL, ORIGIN_LABEL, SAFE_OPEN_EXT, STATUS_LABEL, estimateTokens, fileRef } from '@shared/files'
import { projectMemberIds } from '@shared/org'
import { locale, t as tr } from '@/i18n'
import { Modal, Segmented, Toggle } from '@/components/common/ui'
import { PixelAvatar } from '@/components/common/PixelAvatar'
import { apiError, call } from '@/lib/api'
import { cn, formatBytes, timeAgo } from '@/lib/format'
import { resolveProjectLead } from '@/lib/org'
import { agentById, useAppStore } from '@/store/useAppStore'
import { FileIcon } from './parts'

const PAGE = 20
// Getters: always the current language.
const ROLE_LABEL: Record<FileLinkRole, string> = {
  get attached() { return tr('files:preview.role.attached') },
  get given() { return tr('files:preview.role.given') },
  get read() { return tr('files:preview.role.read') },
  get generated() { return tr('files:preview.role.generated') }
}

type Section = 'content' | 'access' | 'usage'

/** Global file viewer: content (paged), who may read it, where it was used; download / open / delete. */
export function FilePreviewModal() {
  const { t } = useTranslation(['common', 'files'])
  const target = useAppStore((s) => s.filePreview)
  const close = useAppStore((s) => s.closeFile)
  const version = useAppStore((s) => s.filesVersion)
  const agents = useAppStore((s) => s.agents)
  const projects = useAppStore((s) => s.projects)
  const units = useAppStore((s) => s.units)
  const toast = useAppStore((s) => s.toast)
  const [detail, setDetail] = useState<FileDetail | null>(null)
  const [pv, setPv] = useState<FilePreview | null>(null)
  const [offset, setOffset] = useState(0)
  const [section, setSection] = useState<Section>('content')
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const id = target?.id ?? null
  useEffect(() => {
    setOffset(target?.part ? Math.floor(target.part / PAGE) * PAGE : 0)
    setSection('content')
    setConfirmDelete(false)
    setError(null)
  }, [id, target?.part])

  useEffect(() => {
    if (!id) {
      setDetail(null)
      setPv(null)
      return
    }
    let alive = true
    Promise.all([call('files:get', id), call('files:preview', id, offset, PAGE)])
      .then(([d, p]) => {
        if (!alive) return
        setDetail(d)
        setPv(p)
      })
      .catch((e) => alive && setError(apiError(e)))
    return () => {
      alive = false
    }
  }, [id, offset, version])

  // Scroll to the requested part once it is rendered.
  useEffect(() => {
    if (target?.part === undefined || !pv) return
    document.getElementById(`file-part-${target.part}`)?.scrollIntoView({ block: 'start' })
  }, [pv, target?.part])

  const f = detail?.file
  const project = f ? projects.find((p) => p.id === f.projectId) : undefined
  const team = useMemo(() => {
    if (!project) return []
    const ids = new Set(projectMemberIds(project, units))
    const lead = resolveProjectLead(project, units, agents)
    if (lead) ids.add(lead.id)
    return agents.filter((a) => ids.has(a.id))
  }, [project, units, agents])

  const run = async (fn: () => Promise<unknown>, ok?: string): Promise<void> => {
    try {
      await fn()
      if (ok) toast('success', ok)
    } catch (e) {
      toast('error', apiError(e))
    }
  }

  if (!target) return null
  const creator = f?.createdById ? agentById(agents, f.createdById) : undefined
  const access = new Set(detail?.accessAgentIds ?? [])
  const taskLinks = (detail?.links ?? []).filter((l) => l.targetType === 'task')

  return (
    <Modal
      open
      onClose={close}
      width={900}
      title={
        <span className="flex min-w-0 items-center gap-2">
          {f && <FileIcon kind={f.kind} size={16} />}
          <span className="truncate" data-testid="file-preview-title">
            {f?.name ?? t('files:preview.fallbackTitle')}
          </span>
          {f && <span className="font-mono text-[11px] font-normal text-zinc-500">{fileRef(f.id)}</span>}
        </span>
      }
      footer={
        f && (
          <>
            {confirmDelete ? (
              <>
                <span className="mr-auto self-center text-[12px] text-rose-200">
                  {f.origin === 'workspace' ? t('files:preview.confirmDeleteWorkspace') : t('files:preview.confirmDelete')}
                </span>
                <button className="btn-ghost" onClick={() => setConfirmDelete(false)}>
                  {t('actions.cancel')}
                </button>
                <button className="btn-danger" onClick={() => void run(() => call('files:delete', f.id), t('files:preview.deleted')).then(close)}>
                  <Trash2 size={13} /> {t('actions.delete')}
                </button>
              </>
            ) : (
              <>
                <button className="btn-ghost mr-auto text-rose-300" onClick={() => setConfirmDelete(true)}>
                  <Trash2 size={13} /> {t('actions.delete')}
                </button>
                {f.origin === 'workspace' && (
                  <button className="btn-outline" disabled={!f.hasOriginal} onClick={() => void run(() => call('files:reveal', f.id))}>
                    <FolderOpen size={13} /> {t('files:preview.reveal')}
                  </button>
                )}
                <button
                  className="btn-outline"
                  disabled={!f.hasOriginal || !SAFE_OPEN_EXT.has(f.ext)}
                  title={SAFE_OPEN_EXT.has(f.ext) ? t('files:preview.openTitle') : t('files:preview.openBlocked')}
                  onClick={() => void run(() => call('files:open', f.id))}
                >
                  <ExternalLink size={13} /> {t('actions.open')}
                </button>
                <button className="btn-primary" disabled={!f.hasOriginal} onClick={() => void run(async () => {
                  const p = await call('files:saveAs', f.id)
                  if (p) toast('success', t('files:preview.savedTo', { path: p }))
                })} data-testid="file-save-as">
                  <Download size={13} /> {t('files:preview.saveAs')}
                </button>
              </>
            )}
          </>
        )
      }
    >
      {error && <div className="mb-3 rounded border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[13px] text-rose-200">{error}</div>}
      {!f ? (
        !error && (
          <div className="flex items-center gap-2 py-10 text-[13px] text-zinc-400">
            <Loader2 size={14} className="animate-spin" /> {t('status.loading')}
          </div>
        )
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-zinc-400">
            <span>{KIND_LABEL[f.kind]}</span>
            <span>{formatBytes(f.size)}</span>
            {f.pages && <span>{f.kind === 'pptx' ? t('files:meta.slides', { count: f.pages }) : t('files:meta.pages', { count: f.pages })}</span>}
            {f.sheets?.length ? <span>{t('files:meta.sheetNames', { names: f.sheets.join(', ') })}</span> : null}
            {f.width && f.height && <span>{f.width}×{f.height}px</span>}
            {f.chunkCount > 0 && (
              <span>{t('files:meta.parts', { count: f.chunkCount, tokens: estimateTokens(f.chars).toLocaleString(locale()) })}</span>
            )}
            {f.encoding && f.encoding !== 'UTF-8' && <span>{f.encoding}</span>}
            <span>
              {ORIGIN_LABEL[f.origin]}
              {creator ? ` · ${creator.name}` : f.createdByType === 'user' ? ` · ${t('files:you')}` : ''} · {timeAgo(f.createdAt)}
            </span>
            {f.relPath && <span className="font-mono">{f.relPath}</span>}
            <span className={cn('text-[12px]', f.status === 'failed' ? 'text-rose-300' : f.status === 'ready' ? 'text-emerald-300' : 'text-amber-300')}>{STATUS_LABEL[f.status]}</span>
          </div>

          {f.statusMessage && (
            <div className={cn('flex gap-2 rounded border px-3 py-2 text-[13px]', f.status === 'failed' ? 'border-rose-500/30 bg-rose-500/10 text-rose-200' : 'border-line bg-surface-2 text-zinc-300')}>
              <TriangleAlert size={14} className="mt-0.5 shrink-0" /> {f.statusMessage}
            </div>
          )}
          {f.suspicious.length > 0 && (
            <div className="rounded border border-amber-500/30 bg-amber-500/[0.07] px-3 py-2 text-[13px] text-amber-100" data-testid="file-suspicious">
              <div className="mb-1 flex items-center gap-1.5 font-medium">
                <ShieldAlert size={14} /> {t('files:preview.suspiciousTitle')}
              </div>
              <div className="text-amber-200/80">{t('files:preview.suspiciousBody')}</div>
              <ul className="mt-1 list-disc pl-5 font-mono text-[12px] text-amber-200/90">
                {f.suspicious.map((l, i) => (
                  <li key={i} className="break-all">
                    {l}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {f.warnings.length > 0 && <div className="text-[12px] text-zinc-500">{f.warnings.join(' · ')}</div>}
          {!f.hasOriginal && f.origin !== 'workspace' && (
            <div className="text-[12px] text-amber-300">{t('files:preview.noOriginal')}</div>
          )}

          <Segmented<Section>
            value={section}
            onChange={setSection}
            options={[
              { value: 'content', label: t('files:preview.tabs.content') },
              { value: 'access', label: t('files:preview.tabs.access', { n: f.projectShared ? t('files:preview.tabs.wholeTeam') : access.size }) },
              { value: 'usage', label: t('files:preview.tabs.usage', { count: detail?.links.length ?? 0 }) }
            ]}
          />

          {section === 'content' && pv && (
            <div className="space-y-2">
              {pv.imageDataUrl && <img src={pv.imageDataUrl} alt={f.name} className="max-h-[55vh] max-w-full rounded border border-line object-contain" />}
              {f.kind === 'image' && !pv.imageDataUrl && <div className="text-[13px] text-zinc-500">{t('files:preview.imageUnavailable')}</div>}
              {pv.chunks.map((c) => (
                <div key={c.idx} id={`file-part-${c.idx}`} className={cn('rounded border border-line', target.part === c.idx && 'border-accent/60')}>
                  <div className="flex items-center justify-between border-b border-line bg-white/[0.02] px-2.5 py-1 text-[11px] text-zinc-400">
                    <span>{t('files:preview.partHeader', { n: c.idx + 1, total: pv.total, label: c.label })}</span>
                    <span>{t('files:preview.chars', { count: c.text.length, n: c.text.length.toLocaleString(locale()) })}</span>
                  </div>
                  <ChunkBody text={c.text} tabular={f.kind === 'csv' || f.kind === 'xlsx'} />
                </div>
              ))}
              {pv.total > PAGE && (
                <div className="flex items-center justify-center gap-2 text-[12px] text-zinc-400">
                  <button className="icon-btn" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
                    <ChevronLeft size={14} />
                  </button>
                  {t('files:preview.partRange', { from: offset + 1, to: Math.min(pv.total, offset + PAGE), total: pv.total })}
                  <button className="icon-btn" disabled={offset + PAGE >= pv.total} onClick={() => setOffset(offset + PAGE)}>
                    <ChevronRight size={14} />
                  </button>
                </div>
              )}
              {!pv.chunks.length && f.kind !== 'image' && f.status !== 'processing' && <div className="py-6 text-center text-[13px] text-zinc-500">{t('files:preview.noText')}</div>}
              {f.status === 'processing' && (
                <div className="flex items-center gap-2 py-6 text-[13px] text-zinc-400">
                  <Loader2 size={14} className="animate-spin" /> {t('files:preview.extracting')}
                </div>
              )}
            </div>
          )}

          {section === 'access' && (
            <div className="space-y-3 text-[13px]" data-testid="file-access">
              <p className="text-zinc-400">
                <Trans t={t} i18nKey="files:preview.access.intro" components={{ b: <b className="text-zinc-200" /> }} />
              </p>
              <label className="flex items-center justify-between rounded border border-line bg-surface-2 px-3 py-2">
                <span>
                  <span className="text-zinc-200">{t('files:preview.access.shareAll')}</span>
                  <span className="block text-[12px] text-zinc-500">{t('files:preview.access.teamCount', { project: project?.name ?? t('files:view.projectFallback'), count: team.length })}</span>
                </span>
                <Toggle checked={f.projectShared} onChange={(v) => void run(() => call('files:setProjectShared', f.id, v))} />
              </label>
              <div className="divide-y divide-line rounded border border-line">
                {team.map((a) => (
                  <label key={a.id} className={cn('flex items-center gap-2.5 px-3 py-1.5', f.projectShared && 'opacity-60')}>
                    <PixelAvatar agent={a} size={20} />
                    <span className="min-w-0 flex-1">
                      <span className="text-zinc-200">{a.name}</span> <span className="text-[12px] text-zinc-500">{a.role}</span>
                    </span>
                    <Toggle size="sm" checked={f.projectShared || access.has(a.id)} disabled={f.projectShared} onChange={(v) => void run(() => call('files:setAccess', f.id, a.id, v))} />
                  </label>
                ))}
                {!team.length && <div className="px-3 py-2 text-zinc-500">{t('files:preview.access.noAgents')}</div>}
              </div>
              {taskLinks.length > 0 && (
                <div className="text-[12px] text-zinc-400">
                  {t('files:preview.access.viaTasks', { tasks: taskLinks.map((l) => l.label).join(' · ') })}
                </div>
              )}
            </div>
          )}

          {section === 'usage' && (
            <div className="divide-y divide-line rounded border border-line text-[13px]">
              {(detail?.links ?? []).map((l, i) => (
                <div key={i} className="flex items-center gap-2 px-3 py-1.5">
                  <span className={cn('min-w-[104px] shrink-0 text-[12px]', l.role === 'generated' ? 'text-emerald-300' : l.role === 'read' ? 'text-sky-300' : 'text-zinc-400')}>{ROLE_LABEL[l.role]}</span>
                  <span className="min-w-0 flex-1 truncate text-zinc-200">{l.label}</span>
                  <span className="shrink-0 text-[11px] text-zinc-500">{timeAgo(l.createdAt)}</span>
                </div>
              ))}
              {!detail?.links.length && <div className="px-3 py-2 text-zinc-500">{t('files:preview.neverUsed')}</div>}
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

/** Extracted text; table-like chunks (CSV / Excel: "a | b | c") render as a table. */
function ChunkBody({ text, tabular }: { text: string; tabular: boolean }) {
  const rows = useMemo(() => (tabular ? text.split('\n').map((l) => l.split(/(?<!\\)\s\|\s/).map((c) => c.replace(/\\\|/g, '|'))) : null), [text, tabular])
  if (rows && rows.length > 1) {
    const [head, ...body] = rows
    return (
      <div className="selectable max-h-[46vh] overflow-auto">
        <table className="w-full border-collapse font-mono text-[12px]">
          <thead className="sticky top-0 bg-[#141417]">
            <tr>
              {head.map((h, i) => (
                <th key={i} className="whitespace-nowrap border-b border-line px-2 py-1 text-left font-semibold text-zinc-200">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((r, i) => (
              <tr key={i} className="odd:bg-white/[0.015]">
                {r.map((c, j) => (
                  <td key={j} className="whitespace-nowrap px-2 py-0.5 text-zinc-300">
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }
  return <pre className="selectable max-h-[46vh] overflow-auto whitespace-pre-wrap break-words px-2.5 py-2 font-mono text-[12px] leading-relaxed text-zinc-300">{text}</pre>
}
