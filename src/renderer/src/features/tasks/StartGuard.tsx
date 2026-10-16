import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal } from '@/components/common/ui'
import { call } from '@/lib/api'

/**
 * Before a manual start (Start now, a drag or the status menu to "In progress"): if the task waits for others that aren't
 * done, ask. `go(force)` runs right away when nothing is waited for, or with force = true after "Start anyway".
 */
export function useStartGuard(): [(taskId: string, taskKey: string, go: (force: boolean) => void) => void, ReactElement] {
  const { t } = useTranslation(['common', 'tasks'])
  const [ask, setAsk] = useState<{ key: string; waits: string[]; go: (force: boolean) => void } | null>(null)
  const guard = (taskId: string, taskKey: string, go: (force: boolean) => void): void => {
    void call('tasks:waitingFor', taskId).then((waits) => (waits.length ? setAsk({ key: taskKey, waits, go }) : go(false)))
  }
  const close = (): void => setAsk(null)
  const modal = (
    <Modal
      open={!!ask}
      onClose={close}
      title={t('tasks:startGuard.title')}
      width={440}
      footer={
        <>
          <button className="btn-ghost h-8" onClick={close}>
            {t('actions.cancel')}
          </button>
          <button
            className="btn-primary h-8"
            data-testid="start-anyway"
            onClick={() => {
              ask?.go(true)
              close()
            }}
          >
            {t('tasks:startGuard.confirm')}
          </button>
        </>
      }
    >
      <p className="text-[12.5px] leading-relaxed text-zinc-300">{ask && t('tasks:startGuard.body', { key: ask.key, keys: ask.waits.join(', ') })}</p>
    </Modal>
  )
  return [guard, modal]
}
