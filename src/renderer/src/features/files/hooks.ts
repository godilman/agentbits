import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FileRecord } from '@shared/types'
import { MAX_FILE_BYTES, MAX_FILES_PER_SEND } from '@shared/files'
import { t } from '@/i18n'
import { apiError, call } from '@/lib/api'
import { formatBytes } from '@/lib/format'
import { useAppStore } from '@/store/useAppStore'

/** Fresh records for a set of file ids (refetched on files:changed). */
export function useFileRecords(ids: string[]): Map<string, FileRecord> {
  const version = useAppStore((s) => s.filesVersion)
  const key = ids.join(',')
  const [map, setMap] = useState<Map<string, FileRecord>>(new Map())
  useEffect(() => {
    if (!key) {
      setMap(new Map())
      return
    }
    let alive = true
    call('files:byIds', key.split(','))
      .then((list) => alive && setMap(new Map(list.map((f) => [f.id, f]))))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [key, version])
  return map
}

export interface PendingFile {
  key: string
  name: string
  size: number
  fileId: string | null
  error: string | null
}

let seq = 0

/**
 * Attachments being prepared in a composer: uploaded right away (so extraction
 * runs while the user types), sent by id, deleted again if removed before sending.
 */
export function useAttachments(projectId: string | null) {
  const [items, setItems] = useState<PendingFile[]>([])
  const itemsRef = useRef(items)
  itemsRef.current = items
  const records = useFileRecords(items.map((i) => i.fileId).filter((x): x is string => !!x))

  const room = (): number => MAX_FILES_PER_SEND - itemsRef.current.length

  // Leaving the composer (or the project) drops unsent uploads: nothing refers to them.
  useEffect(() => {
    return () => {
      for (const i of itemsRef.current) if (i.fileId) void call('files:delete', i.fileId).catch(() => undefined)
      itemsRef.current = []
      setItems([])
    }
  }, [projectId])

  const addFiles = useCallback(
    async (files: File[]) => {
      if (!projectId || !files.length) return
      const take = files.slice(0, Math.max(0, room()))
      const skipped = files.length - take.length
      const placeholders: PendingFile[] = take.map((f) => ({
        key: `p${++seq}`,
        name: f.name || t('files:pastedFileName'),
        size: f.size,
        fileId: null,
        error: f.size > MAX_FILE_BYTES ? t('files:attach.tooBig', { size: formatBytes(f.size), limit: formatBytes(MAX_FILE_BYTES) }) : null
      }))
      if (skipped > 0) {
        placeholders.push({ key: `p${++seq}`, name: t('files:attach.moreFiles', { count: skipped }), size: 0, fileId: null, error: t('files:attach.maxPerSend', { max: MAX_FILES_PER_SEND }) })
      }
      setItems((cur) => [...cur, ...placeholders])
      const settle = (key: string, patch: Partial<PendingFile>): void => setItems((cur) => cur.map((i) => (i.key === key ? { ...i, ...patch } : i)))
      // Files with a path on disk go in one batch; data without a path (pasted screenshot) one by one.
      const withPath: { key: string; path: string }[] = []
      for (let i = 0; i < take.length; i++) {
        const ph = placeholders[i]
        if (ph.error) continue
        const path = window.agentbits.pathForFile(take[i])
        if (path) withPath.push({ key: ph.key, path })
        else {
          try {
            const data = new Uint8Array(await take[i].arrayBuffer())
            const rec = await call('files:addData', projectId, ph.name, data)
            settle(ph.key, { fileId: rec.id, name: rec.name })
          } catch (e) {
            settle(ph.key, { error: apiError(e) })
          }
        }
      }
      if (withPath.length) await addPathsInto(projectId, withPath, settle)
    },
    [projectId]
  )

  const pick = useCallback(async () => {
    if (!projectId) return
    try {
      const paths = (await call('files:pick')).slice(0, Math.max(0, room()))
      if (!paths.length) return
      const placeholders = paths.map((p) => ({ key: `p${++seq}`, name: p.split(/[\\/]/).pop() ?? p, size: 0, fileId: null, error: null }))
      setItems((cur) => [...cur, ...placeholders])
      const settle = (key: string, patch: Partial<PendingFile>): void => setItems((cur) => cur.map((i) => (i.key === key ? { ...i, ...patch } : i)))
      await addPathsInto(
        projectId,
        placeholders.map((ph, i) => ({ key: ph.key, path: paths[i] })),
        settle
      )
    } catch (e) {
      useAppStore.getState().toast('error', apiError(e))
    }
  }, [projectId])

  const remove = useCallback((key: string) => {
    const it = itemsRef.current.find((i) => i.key === key)
    setItems((cur) => cur.filter((i) => i.key !== key))
    // Uploaded but never sent: nothing refers to it.
    if (it?.fileId) void call('files:delete', it.fileId).catch(() => undefined)
  }, [])

  /** After a successful send: forget the list without deleting anything. */
  const clear = useCallback(() => {
    itemsRef.current = []
    setItems([])
  }, [])

  /** Cancel: delete every unsent upload. */
  const discard = useCallback(() => {
    for (const i of itemsRef.current) if (i.fileId) void call('files:delete', i.fileId).catch(() => undefined)
    itemsRef.current = []
    setItems([])
  }, [])

  const readyIds = useMemo(() => items.filter((i) => i.fileId && !i.error).map((i) => i.fileId!), [items])
  const uploading = items.some((i) => !i.fileId && !i.error)
  return { items, records, readyIds, uploading, addFiles, pick, remove, clear, discard }
}

async function addPathsInto(projectId: string, list: { key: string; path: string }[], settle: (key: string, patch: Partial<PendingFile>) => void): Promise<void> {
  // One call per file so a bad one does not fail the batch.
  await Promise.all(
    list.map(async ({ key, path }) => {
      try {
        const [rec] = await call('files:add', projectId, [path])
        if (rec) settle(key, { fileId: rec.id, name: rec.name, size: rec.size })
        else settle(key, { error: t('files:attach.addFailed') })
      } catch (e) {
        settle(key, { error: apiError(e) })
      }
    })
  )
}

/** Drag & drop + paste handlers for any element. */
export function useFileDrop(onFiles: (files: File[]) => void, enabled = true) {
  const [over, setOver] = useState(false)
  const depth = useRef(0)
  const hasFiles = (e: React.DragEvent): boolean => Array.from(e.dataTransfer?.types ?? []).includes('Files')
  return {
    over,
    props: {
      onDragEnter: (e: React.DragEvent) => {
        if (!enabled || !hasFiles(e)) return
        e.preventDefault()
        depth.current++
        setOver(true)
      },
      onDragOver: (e: React.DragEvent) => {
        if (!enabled || !hasFiles(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      },
      onDragLeave: (e: React.DragEvent) => {
        if (!enabled || !hasFiles(e)) return
        depth.current = Math.max(0, depth.current - 1)
        if (!depth.current) setOver(false)
      },
      onDrop: (e: React.DragEvent) => {
        if (!enabled || !hasFiles(e)) return
        e.preventDefault()
        depth.current = 0
        setOver(false)
        const files = Array.from(e.dataTransfer.files ?? [])
        if (files.length) onFiles(files)
      }
    },
    onPaste: (e: React.ClipboardEvent) => {
      if (!enabled) return
      const files = Array.from(e.clipboardData?.files ?? [])
      if (files.length) {
        e.preventDefault()
        onFiles(files)
      }
    }
  }
}
