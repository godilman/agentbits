import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { CancelScope, Task } from '@shared/types'
import { Modal } from '@/components/common/ui'
import { apiError, call } from '@/lib/api'

/**
 * "Cancel task": first what it covers (from main — the race attempt cancelled with it, a run that is stopped, an
 * approval turned down, tasks that will wait), then the cancel itself. Nothing is undone; the task and its history stay.
 * The dialog closes once main took the cancel; whether the run really stopped shows on the task and in its thread.
 */
export function useCancelTask(): [(task: Task) => void, ReactElement] {
  const { t } = useTranslation(['common', 'tasks'])
  const [task, setTask] = useState<Task | null>(null)
  const [scope, setScope] = useState<CancelScope | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const open = (x: Task): void => {
    setTask(x)
    setScope(null)
    setError(null)
    call('tasks:cancelScope', x.id).then(setScope, (e) => setError(apiError(e)))
  }
  const close = (): void => setTask(null)
  const confirm = (): void => {
    if (!task) return
    setBusy(true)
    setError(null)
    call('tasks:cancel', task.id)
      .then(close, (e) => setError(apiError(e)))
      .finally(() => setBusy(false))
  }
  const line = (text: string): ReactElement => <li className="leading-relaxed">{text}</li>
  const modal = (
    <Modal
      open={!!task}
      onClose={close}
      title={task ? t('tasks:cancel.title', { key: task.key }) : ''}
      width={480}
      footer={
        <>
          <button className="btn-ghost h-8" onClick={close}>
            {t('tasks:cancel.keep')}
          </button>
          <button className="btn-danger h-8" data-testid="cancel-task-confirm" disabled={!scope || busy} onClick={confirm}>
            {t('tasks:cancel.confirm')}
          </button>
        </>
      }
    >
      <ul className="list-disc space-y-1.5 pl-5 text-[13px] text-zinc-300">
        {scope && scope.keys.length > 1 && line(t('tasks:cancel.race', { keys: scope.keys.join(', ') }))}
        {scope?.running && line(t('tasks:cancel.running'))}
        {scope?.awaitingApproval && line(t('tasks:cancel.approval'))}
        {line(t('tasks:cancel.kept'))}
        {scope && scope.dependents.length > 0 && line(t('tasks:cancel.dependents', { keys: scope.dependents.join(', ') }))}
      </ul>
      {error && (
        <p className="mt-3 text-[13px] text-rose-300" role="alert">
          {error}
        </p>
      )}
    </Modal>
  )
  return [open, modal]
}
