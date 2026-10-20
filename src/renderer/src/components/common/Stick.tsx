import { useLayoutEffect, useRef, useState } from 'react'
import { ArrowDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * Follows new content only while the user is at the bottom; reading further up stays put and `hasNew` offers the way
 * back. `signal` changes when content arrives; a new `reset` (another channel / task) starts at the bottom.
 */
export function useStickToBottom(signal: unknown, reset: unknown) {
  const ref = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const [hasNew, setHasNew] = useState(false)
  useLayoutEffect(() => {
    stick.current = true
    setHasNew(false)
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [reset])
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    if (stick.current) el.scrollTop = el.scrollHeight
    else setHasNew(true)
  }, [signal])
  const onScroll = (): void => {
    const el = ref.current
    if (!el) return
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
    if (stick.current) setHasNew(false)
  }
  const jump = (): void => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
    stick.current = true
    setHasNew(false)
  }
  return { ref, onScroll, hasNew, jump }
}

/** "New messages ↓" at the bottom of a scrolling list (place it as the list's last child). */
export function JumpToNew({ show, onClick }: { show: boolean; onClick: () => void }) {
  const { t } = useTranslation()
  if (!show) return null
  return (
    <div className="pointer-events-none sticky bottom-1 flex justify-center">
      <button className="pointer-events-auto flex items-center gap-1 rounded-full bg-indigo-500 px-2.5 py-1 text-[12px] text-white shadow-pop" onClick={onClick} data-testid="jump-to-new">
        <ArrowDown size={11} /> {t('layout:newMessages')}
      </button>
    </div>
  )
}
