import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderOpen, Loader2, Paperclip, Search, ShieldAlert, Upload } from 'lucide-react'
import type { FileOrigin, FileRecord, FileSearchHit } from '@shared/types'
import { KIND_LABEL, MAX_FILE_BYTES, ORIGIN_LABEL, STATUS_LABEL, fileRef } from '@shared/files'
import { locale } from '@/i18n'
import { Empty, Segmented } from '@/components/common/ui'
import { apiError, call } from '@/lib/api'
import { cn, formatBytes, timeAgo } from '@/lib/format'
import { useProjectScope } from '@/lib/org'
import { agentById, useAppStore } from '@/store/useAppStore'
import { useFileDrop } from './hooks'
import { DropOverlay, FileIcon } from './parts'

type Filter = 'all' | FileOrigin

/** Project section "Dosyalar": everything uploaded, saved by agents or changed in the project folder. */
export function FilesView() {
  const { t } = useTranslation(['common', 'files'])
  const { pid, project } = useProjectScope()
  const version = useAppStore((s) => s.filesVersion)
  const agents = useAppStore((s) => s.agents)
  const openFile = useAppStore((s) => s.openFile)
  const toast = useAppStore((s) => s.toast)
  const [files, setFiles] = useState<FileRecord[] | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<FileSearchHit[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!pid) return
    let alive = true
    call('files:list', { projectId: pid, limit: 1000 })
      .then((l) => alive && setFiles(l))
      .catch((e) => alive && toast('error', apiError(e)))
    return () => {
      alive = false
    }
  }, [pid, version, toast])

  // Content search (debounced): parts of files that contain the words.
  useEffect(() => {
    const q = query.trim()
    if (!pid || q.length < 2) {
      setHits([])
      return
    }
    const timer = setTimeout(() => {
      call('files:search', pid, q)
        .then(setHits)
        .catch(() => setHits([]))
    }, 250)
    return () => clearTimeout(timer)
  }, [pid, query, version])

  const upload = async (paths: string[] | File[]): Promise<void> => {
    if (!pid) return
    setBusy(true)
    try {
      if (typeof paths[0] === 'string') await call('files:add', pid, paths as string[])
      else {
        const list = paths as File[]
        const withPath = list.map((f) => window.agentbits.pathForFile(f)).filter(Boolean)
        const tooBig = list.filter((f) => f.size > MAX_FILE_BYTES)
        if (tooBig.length) toast('error', t('files:tooBig', { names: tooBig.map((f) => f.name).join(', '), limit: formatBytes(MAX_FILE_BYTES) }))
        if (withPath.length) await call('files:add', pid, withPath)
        for (const f of list.filter((x) => !window.agentbits.pathForFile(x) && x.size <= MAX_FILE_BYTES)) {
          await call('files:addData', pid, f.name || t('files:pastedFileName'), new Uint8Array(await f.arrayBuffer()))
        }
      }
      toast('success', t('files:view.added'))
    } catch (e) {
      toast('error', apiError(e))
    } finally {
      setBusy(false)
    }
  }
  const drop = useFileDrop((fs) => void upload(fs), !!pid)

  const shown = useMemo(() => {
    const lc = locale()
    const q = query.trim().toLocaleLowerCase(lc)
    const hitIds = new Set(hits.map((h) => h.fileId))
    return (files ?? []).filter((f) => (filter === 'all' || f.origin === filter) && (!q || f.name.toLocaleLowerCase(lc).includes(q) || hitIds.has(f.id)))
  }, [files, filter, query, hits])

  const counts = useMemo(() => {
    const c = { all: 0, user: 0, agent: 0, workspace: 0 }
    for (const f of files ?? []) {
      c.all++
      c[f.origin]++
    }
    return c
  }, [files])

  if (!pid) return null
  return (
    <div className="relative flex h-full flex-col" {...drop.props}>
      <DropOverlay show={drop.over} label={t('files:view.dropLabel', { project: project?.name ?? t('files:view.projectFallback') })} />
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-5 py-2.5">
        <div className="mr-2">
          <div className="text-[15px] font-semibold text-zinc-100">{t('files:title')}</div>
          <div className="text-[12px] text-zinc-400">{t('files:view.subtitle')}</div>
        </div>
        <Segmented<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: `${t('files:view.filter.all')} ${counts.all}` },
            { value: 'user', label: `${t('files:view.filter.user')} ${counts.user}` },
            { value: 'agent', label: `${t('files:view.filter.agent')} ${counts.agent}` },
            { value: 'workspace', label: `${t('files:view.filter.workspace')} ${counts.workspace}` }
          ]}
        />
        <div className="relative ml-auto w-[260px]">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input className="input h-8 w-full pl-8 text-[13px]" placeholder={t('files:view.searchPlaceholder')} value={query} onChange={(e) => setQuery(e.target.value)} data-testid="files-search" />
        </div>
        <button
          className="btn-primary h-8"
          disabled={busy}
          onClick={() =>
            void call('files:pick')
              .then((p) => (p.length ? upload(p) : undefined))
              .catch((e) => toast('error', apiError(e)))
          }
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} {t('files:view.upload')}
        </button>
      </header>

      <div className="selectable min-h-0 flex-1 overflow-y-auto px-5 py-3">
        {files === null ? (
          <div className="flex items-center gap-2 text-[13px] text-zinc-400">
            <Loader2 size={14} className="animate-spin" /> {t('status.loading')}
          </div>
        ) : !files.length ? (
          <Empty
            icon={<Paperclip size={22} />}
            title={t('files:view.emptyTitle')}
            hint={t('files:view.emptyHint')}
          />
        ) : (
          <>
            {hits.length > 0 && (
              <div className="mb-3 rounded border border-line" data-testid="files-hits">
                <div className="border-b border-line px-3 py-1.5 text-[12px] text-zinc-400">{t('files:view.hits', { count: hits.length })}</div>
                {hits.slice(0, 12).map((h, i) => (
                  <button key={i} className="block w-full px-3 py-1.5 text-left text-[13px] hover:bg-white/[0.03]" onClick={() => openFile(h.fileId, h.chunkIdx)}>
                    <span className="text-zinc-200">{h.fileName}</span>
                    <span className="ml-2 text-[11px] text-zinc-500">
                      {t('files:view.hitPart', { n: h.chunkIdx + 1, label: h.label })}
                    </span>
                    <span className="mt-0.5 block truncate text-[12px] text-zinc-400">{h.snippet}</span>
                  </button>
                ))}
              </div>
            )}
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[12px] uppercase tracking-wide text-zinc-500">
                  <th className="pb-1.5 font-medium">{t('files:view.columns.file')}</th>
                  <th className="pb-1.5 font-medium">{t('files:view.columns.kind')}</th>
                  <th className="pb-1.5 text-right font-medium">{t('files:view.columns.size')}</th>
                  <th className="pb-1.5 pl-4 font-medium">{t('files:view.columns.origin')}</th>
                  <th className="pb-1.5 font-medium">{t('files:view.columns.access')}</th>
                  <th className="pb-1.5 font-medium">{t('files:view.columns.status')}</th>
                  <th className="pb-1.5 text-right font-medium">{t('files:view.columns.added')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {shown.map((f) => {
                  const by = f.createdById ? agentById(agents, f.createdById)?.name : f.createdByType === 'user' ? t('files:you') : null
                  return (
                    <tr key={f.id} className="cursor-pointer hover:bg-white/[0.02]" onClick={() => openFile(f.id)} data-testid="files-row">
                      <td className="max-w-[340px] py-1.5 pr-3">
                        <div className="flex items-center gap-2">
                          {f.status === 'processing' ? <Loader2 size={14} className="shrink-0 animate-spin text-zinc-400" /> : <FileIcon kind={f.kind} size={14} className="shrink-0" />}
                          <span className="truncate text-zinc-100">{f.name}</span>
                          {f.suspicious.length > 0 && <ShieldAlert size={12} className="shrink-0 text-amber-300" />}
                          {f.origin === 'workspace' && <FolderOpen size={12} className="shrink-0 text-zinc-500" />}
                        </div>
                        {f.relPath && f.relPath !== f.name && <div className="truncate pl-[22px] font-mono text-[11px] text-zinc-500">{f.relPath}</div>}
                      </td>
                      <td className="text-zinc-400">{KIND_LABEL[f.kind]}</td>
                      <td className="text-right text-zinc-400">{formatBytes(f.size)}</td>
                      <td className="pl-4 text-zinc-400">
                        {ORIGIN_LABEL[f.origin]}
                        {by ? ` · ${by}` : ''}
                      </td>
                      <td className="text-zinc-400">{f.projectShared ? t('files:view.accessAll') : t('files:view.accessSelected')}</td>
                      <td className={cn(f.status === 'failed' ? 'text-rose-300' : f.status === 'ready' ? 'text-zinc-400' : 'text-amber-300')} title={f.statusMessage ?? ''}>
                        {STATUS_LABEL[f.status]}
                      </td>
                      <td className="text-right text-zinc-500" title={`ref ${fileRef(f.id)}`}>
                        {timeAgo(f.createdAt)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {!shown.length && <div className="py-6 text-center text-[13px] text-zinc-500">{t('files:view.noMatch')}</div>}
          </>
        )}
      </div>
    </div>
  )
}
