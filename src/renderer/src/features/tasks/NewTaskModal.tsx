import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal } from '@/components/common/ui'
import { PixelAvatar } from '@/components/common/PixelAvatar'
import { call } from '@/lib/api'
import { cn, PRIORITY_META } from '@/lib/format'
import { useProjectScope } from '@/lib/org'
import { useAppStore } from '@/store/useAppStore'
import { apiError } from '@/lib/api'
import { useAttachments, useFileDrop } from '@/features/files/hooks'
import { AttachButton, AttachmentTray, DropOverlay } from '@/features/files/parts'

export function NewTaskModal() {
  const { t } = useTranslation(['common', 'tasks'])
  const open = useAppStore((s) => s.newTaskOpen)
  const setOpen = useAppStore((s) => s.setNewTaskOpen)
  const presetAssigneeId = useAppStore((s) => s.newTaskAssigneeId)
  const { pid, project, members, lead } = useProjectScope()
  const allAgents = useAppStore((s) => s.agents)
  // Assignee options: project members (the lead splits & reviews work); keep a preset assignee visible.
  const agents = useMemo(
    () => allAgents.filter((a) => (members.some((m) => m.id === a.id) && a.id !== lead?.id) || a.id === presetAssigneeId),
    [allAgents, members, lead, presetAssigneeId]
  )
  const toast = useAppStore((s) => s.toast)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [acceptance, setAcceptance] = useState('')
  const [priority, setPriority] = useState<0 | 1 | 2 | 3>(1)
  const [assigneeId, setAssigneeId] = useState<string | null>(null)
  const att = useAttachments(pid)
  const drop = useFileDrop((files) => void att.addFiles(files), open)
  const close = (): void => {
    att.discard()
    setOpen(false)
  }

  useEffect(() => {
    if (open) {
      setTitle('')
      setDescription('')
      setAcceptance('')
      setPriority(1)
      setAssigneeId(presetAssigneeId)
    }
  }, [open, presetAssigneeId])

  const submit = async (): Promise<void> => {
    if (!title.trim()) return
    if (!pid) return
    if (att.uploading) return toast('error', t('tasks:new.uploading'))
    try {
      const task = await call('tasks:create', { title, description, acceptance, priority, assigneeId, projectId: pid, fileIds: att.readyIds })
      att.clear()
      toast(
        'success',
        att.readyIds.length ? t('tasks:new.createdWithFiles', { key: task.key, count: att.readyIds.length }) : t('tasks:new.created', { key: task.key })
      )
      setOpen(false)
    } catch (e) {
      toast('error', apiError(e))
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title={
        <span className="flex items-center gap-2">
          {t('tasks:new.title')}
          {project && (
            <span className="flex items-center gap-1.5 rounded bg-white/5 px-1.5 py-px text-[12px] font-normal text-zinc-400">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: project.color }} />
              <span className="sr-only"> — </span>
              {project.name}
            </span>
          )}
        </span>
      }
      footer={
        <>
          <button className="btn-ghost" onClick={close}>
            {t('actions.cancel')}
          </button>
          <button className="btn-primary" disabled={!title.trim()} onClick={() => void submit()}>
            {t('actions.create')} <span className="kbd ml-1 border-white/20 bg-white/10 text-white/70">Ctrl ↵</span>
          </button>
        </>
      }
    >
      <div className="relative space-y-4" onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && void submit()} {...drop.props}>
        <DropOverlay show={drop.over} label={t('tasks:new.dropLabel')} />
        <div>
          <label className="label">{t('tasks:fields.title')}</label>
          <input autoFocus className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('tasks:new.titlePlaceholder')} />
        </div>
        <div>
          <label className="label">{t('tasks:fields.description')}</label>
          <textarea className="textarea" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} onPaste={drop.onPaste} placeholder={t('tasks:new.descriptionPlaceholder')} />
          <label className="label mt-3">{t('tasks:fields.acceptance')}</label>
          <textarea className="textarea" rows={2} value={acceptance} onChange={(e) => setAcceptance(e.target.value)} placeholder={t('tasks:new.acceptancePlaceholder')} />
          <div className="mt-1 text-[11px] text-zinc-500">{t('tasks:new.acceptanceHint')}</div>
        </div>
        <div>
          <label className="label flex items-center gap-2">
            {t('tasks:fields.files')} <AttachButton className="h-6 w-6" onClick={() => void att.pick()} />
            <span className="font-normal text-zinc-500">{t('tasks:new.filesHint')}</span>
          </label>
          <AttachmentTray items={att.items} records={att.records} onRemove={att.remove} />
        </div>
        <div>
          <label className="label">{t('tasks:fields.priority')}</label>
          <div className="flex gap-1.5">
            {PRIORITY_META.map((p, i) => (
              <button
                key={p.label}
                onClick={() => setPriority(i as 0 | 1 | 2 | 3)}
                className={cn('btn border', priority === i ? 'border-zinc-500 bg-white/10 text-zinc-100' : 'border-line text-zinc-400 hover:text-zinc-200')}
              >
                <span className={cn('h-1.5 w-1.5 rounded-full', p.dot)} /> {p.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="label">{t('tasks:fields.assignee')}</label>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setAssigneeId(null)}
              className={cn('btn border', !assigneeId ? 'border-zinc-500 bg-white/10 text-zinc-100' : 'border-line text-zinc-400')}
            >
              {t('tasks:fields.auto')}
            </button>
            {agents.map((a) => (
              <button
                key={a.id}
                onClick={() => setAssigneeId(a.id)}
                className={cn('btn border pl-1', assigneeId === a.id ? 'border-zinc-500 bg-white/10 text-zinc-100' : 'border-line text-zinc-400')}
              >
                <PixelAvatar agent={a} size={18} /> {a.name}
              </button>
            ))}
            {agents.length === 0 && <span className="self-center text-[12px] text-zinc-500">{t('tasks:new.noAgents')}</span>}
          </div>
        </div>
      </div>
    </Modal>
  )
}
