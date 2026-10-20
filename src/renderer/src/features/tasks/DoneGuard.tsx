import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { Task } from '@shared/types'
import { Modal } from '@/components/common/ui'
import { useAppStore } from '@/store/useAppStore'

/**
 * Before a running task is moved to Done by hand: its run is stopped, nothing is undone, it counts as done without the
 * lead's review and (worktree mode) nothing is merged. Other moves to Done go through as they are.
 */
export function useDoneGuard(): [(task: Task, go: () => void) => void, ReactElement] {
  const { t } = useTranslation(['common', 'tasks'])
  const projects = useAppStore((s) => s.projects)
  const [ask, setAsk] = useState<{ task: Task; go: () => void } | null>(null)
  const guard = (task: Task, go: () => void): void => (task.status === 'in_progress' ? setAsk({ task, go }) : go())
  const close = (): void => setAsk(null)
  const worktree = !!ask && projects.find((p) => p.id === ask.task.projectId)?.isolation === 'worktree'
  const modal = (
    <Modal
      open={!!ask}
      onClose={close}
      title={t('tasks:doneGuard.title')}
      width={460}
      footer={
        <>
          <button className="btn-ghost h-8" onClick={close}>
            {t('actions.cancel')}
          </button>
          <button
            className="btn-danger h-8"
            data-testid="done-anyway"
            onClick={() => {
              ask?.go()
              close()
            }}
          >
            {t('tasks:doneGuard.confirm')}
          </button>
        </>
      }
    >
      <p className="text-[13px] leading-relaxed text-zinc-300">
        {ask && t(worktree ? 'tasks:doneGuard.bodyWorktree' : 'tasks:doneGuard.bodyFolder', { key: ask.task.key })}
      </p>
    </Modal>
  )
  return [guard, modal]
}
