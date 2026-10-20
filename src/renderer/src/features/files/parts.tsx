import type { ComponentType } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, File as FileGeneric, FileCode2, FileImage, FileJson, FileSpreadsheet, FileText, Loader2, Paperclip, Presentation, ShieldAlert, Upload, X } from 'lucide-react'
import type { FileKind, FileRecord } from '@shared/types'
import { KIND_LABEL, STATUS_LABEL } from '@shared/files'
import { t } from '@/i18n'
import { cn, formatBytes } from '@/lib/format'
import { useAppStore } from '@/store/useAppStore'
import type { PendingFile } from './hooks'

const KIND_ICON: Record<FileKind, ComponentType<{ size?: number; className?: string }>> = {
  pdf: FileText,
  docx: FileText,
  xlsx: FileSpreadsheet,
  pptx: Presentation,
  csv: FileSpreadsheet,
  text: FileCode2,
  markdown: FileText,
  json: FileJson,
  image: FileImage,
  other: FileGeneric
}
const KIND_COLOR: Record<FileKind, string> = {
  pdf: 'text-rose-300',
  docx: 'text-sky-300',
  xlsx: 'text-emerald-300',
  pptx: 'text-orange-300',
  csv: 'text-emerald-300',
  text: 'text-zinc-300',
  markdown: 'text-violet-300',
  json: 'text-amber-300',
  image: 'text-pink-300',
  other: 'text-zinc-400'
}

export function FileIcon({ kind, size = 14, className }: { kind: FileKind; size?: number; className?: string }) {
  const Icon = KIND_ICON[kind] ?? FileGeneric
  return <Icon size={size} className={cn(KIND_COLOR[kind], className)} />
}

/** Status line under a file name: processing / problems / instruction-like content. */
export function fileStatusNote(f: FileRecord): { text: string; tone: 'muted' | 'warn' | 'error' } | null {
  if (f.status === 'processing') return { text: STATUS_LABEL.processing, tone: 'muted' }
  if (f.status === 'failed') return { text: f.statusMessage ?? STATUS_LABEL.failed, tone: 'error' }
  if (f.status === 'unsupported' || f.status === 'partial') return { text: f.statusMessage ?? STATUS_LABEL[f.status], tone: 'warn' }
  if (f.suspicious.length) return { text: t('files:parts.suspiciousLines', { count: f.suspicious.length }), tone: 'warn' }
  return null
}

function meta(f: FileRecord): string {
  const bits = [KIND_LABEL[f.kind], formatBytes(f.size)]
  if (f.pages) bits.push(f.kind === 'pptx' ? t('files:meta.slides', { count: f.pages }) : t('files:meta.pages', { count: f.pages }))
  if (f.sheets?.length) bits.push(t('files:meta.sheets', { count: f.sheets.length }))
  if (f.width && f.height) bits.push(`${f.width}×${f.height}`)
  return bits.join(' · ')
}

/** Compact, clickable file reference (chat messages, task drawer, lists). */
export function FileChip({ file, fallback, onRemove, className }: { file?: FileRecord; fallback?: { id: string; name: string; kind?: FileKind; size?: number }; onRemove?: () => void; className?: string }) {
  const { t } = useTranslation(['common', 'files'])
  const openFile = useAppStore((s) => s.openFile)
  const id = file?.id ?? fallback?.id
  const name = file?.name ?? fallback?.name ?? t('files:parts.fileFallback')
  const kind = file?.kind ?? fallback?.kind ?? 'other'
  const note = file ? fileStatusNote(file) : null
  return (
    <span
      className={cn(
        'group inline-flex max-w-[260px] items-center gap-1.5 rounded-md border border-line bg-surface-2 py-1 pl-1.5 pr-1.5 text-left text-[12px] text-zinc-200 hover:border-zinc-600',
        className
      )}
      title={file ? `${name}\n${meta(file)}${note ? `\n${note.text}` : ''}` : name}
    >
      <button className="flex min-w-0 items-center gap-1.5" onClick={() => id && openFile(id)} disabled={!id} data-testid="file-chip">
        {file?.status === 'processing' ? <Loader2 size={13} className="shrink-0 animate-spin text-zinc-400" /> : <FileIcon kind={kind} size={13} className="shrink-0" />}
        <span className="truncate">{name}</span>
        {file && <span className="shrink-0 text-[11px] text-zinc-500">{formatBytes(file.size)}</span>}
        {note && note.tone !== 'muted' && (
          note.tone === 'error' ? <AlertTriangle size={11} className="shrink-0 text-rose-300" /> : <ShieldAlert size={11} className="shrink-0 text-amber-300" />
        )}
        {file && !file.hasOriginal && file.origin !== 'workspace' && <span className="shrink-0 text-[12px] text-zinc-500">{t('files:parts.noOriginal')}</span>}
      </button>
      {onRemove && (
        <button className="ml-0.5 rounded p-0.5 text-zinc-500 hover:bg-white/10 hover:text-zinc-200" onClick={onRemove} title={t('actions.remove')}>
          <X size={11} />
        </button>
      )}
    </span>
  )
}

/** Pending attachments in a composer. */
export function AttachmentTray({ items, records, onRemove }: { items: PendingFile[]; records: Map<string, FileRecord>; onRemove: (key: string) => void }) {
  if (!items.length) return null
  return (
    <div className="mb-1.5 flex flex-wrap gap-1.5" data-testid="attachment-tray">
      {items.map((i) => {
        const rec = i.fileId ? records.get(i.fileId) : undefined
        if (i.error) {
          return (
            <span key={i.key} className="inline-flex max-w-[320px] items-center gap-1.5 rounded-md border border-rose-500/30 bg-rose-500/[0.07] px-1.5 py-1 text-[12px] text-rose-200" title={i.error}>
              <AlertTriangle size={12} className="shrink-0" />
              <span className="truncate">
                {i.name}: {i.error}
              </span>
              <button className="rounded p-0.5 hover:bg-white/10" onClick={() => onRemove(i.key)} title={t('actions.remove')}>
                <X size={11} />
              </button>
            </span>
          )
        }
        if (!i.fileId) {
          return (
            <span key={i.key} className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface-2 px-1.5 py-1 text-[12px] text-zinc-400">
              <Loader2 size={12} className="animate-spin" /> {i.name}
            </span>
          )
        }
        return <FileChip key={i.key} file={rec} fallback={{ id: i.fileId, name: i.name, size: i.size }} onRemove={() => onRemove(i.key)} />
      })}
    </div>
  )
}

export function AttachButton({ onClick, disabled, className, label }: { onClick: () => void; disabled?: boolean; className?: string; label?: string }) {
  const { t } = useTranslation(['common', 'files'])
  return (
    <button
      type="button"
      className={cn('icon-btn shrink-0', className)}
      onClick={onClick}
      disabled={disabled}
      title={t('files:parts.attachTitle')}
      data-testid="attach-button"
    >
      <Paperclip size={14} />
      {label && <span className="ml-1 text-[12px]">{label}</span>}
    </button>
  )
}

/** Overlay shown while files are dragged over a drop zone. */
export function DropOverlay({ show, label }: { show: boolean; label?: string }) {
  const { t } = useTranslation(['common', 'files'])
  if (!show) return null
  return (
    <div className="pointer-events-none absolute inset-1 z-30 flex items-center justify-center rounded-lg border-2 border-dashed border-accent/60 bg-accent/[0.08] backdrop-blur-[1px]">
      <div className="flex items-center gap-2 rounded-md bg-black/60 px-3 py-2 text-[13px] text-indigo-100">
        <Upload size={15} /> {label ?? t('files:parts.drop')}
      </div>
    </div>
  )
}
