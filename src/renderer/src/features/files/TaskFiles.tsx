import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import type { FileRecord, Task } from '@shared/types'
import { MAX_FILE_BYTES } from '@shared/files'
import { apiError, call } from '@/lib/api'
import { formatBytes } from '@/lib/format'
import { useAppStore } from '@/store/useAppStore'
import { AttachButton, FileChip } from './parts'

/** Files linked to a task (attached by the user / lead, or produced while working on it). */
export function TaskFiles({ task, droppedFiles }: { task: Task; droppedFiles: File[] | null }) {
  const { t } = useTranslation(['common', 'files'])
  const version = useAppStore((s) => s.filesVersion)
  const toast = useAppStore((s) => s.toast)
  const [files, setFiles] = useState<FileRecord[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    call('files:list', { projectId: task.projectId, taskId: task.id })
      .then((l) => alive && setFiles(l))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [task.id, task.projectId, version])

  const attach = async (input: string[] | File[]): Promise<void> => {
    if (!input.length) return
    setBusy(true)
    try {
      let recs: FileRecord[] = []
      if (typeof input[0] === 'string') recs = await call('files:add', task.projectId, input as string[])
      else {
        for (const f of input as File[]) {
          if (f.size > MAX_FILE_BYTES) {
            toast('error', t('files:tooBig', { names: f.name, limit: formatBytes(MAX_FILE_BYTES) }))
            continue
          }
          const path = window.agentbits.pathForFile(f)
          recs.push(...(path ? await call('files:add', task.projectId, [path]) : [await call('files:addData', task.projectId, f.name || t('files:pastedFileName'), new Uint8Array(await f.arrayBuffer()))]))
        }
      }
      if (recs.length) await call('files:attachToTask', task.id, recs.map((r) => r.id))
    } catch (e) {
      toast('error', apiError(e))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (droppedFiles?.length) void attach(droppedFiles)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [droppedFiles])

  return (
    <div className="text-[13px]" data-testid="task-files">
      <div className="mb-1 flex items-center gap-2 text-zinc-400">
        {t('files:title')}
        <AttachButton
          className="h-6 w-6"
          onClick={() =>
            void call('files:pick')
              .then((p) => attach(p))
              .catch((e) => toast('error', apiError(e)))
          }
        />
        {busy && <Loader2 size={12} className="animate-spin" />}
        <span className="text-[11px] text-zinc-500">{t('files:task.hint')}</span>
      </div>
      {files.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {files.map((f) => (
            <FileChip
              key={f.id}
              file={f}
              className={f.origin !== 'user' ? 'border-emerald-500/30' : undefined}
              onRemove={f.origin === 'user' ? () => void call('files:detachFromTask', task.id, f.id).catch((e) => toast('error', apiError(e))) : undefined}
            />
          ))}
        </div>
      ) : (
        <div className="text-[12px] text-zinc-500">{t('files:task.none')}</div>
      )}
    </div>
  )
}
