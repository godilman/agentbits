import { useEffect, useMemo, useState } from 'react'
import { Check, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { OrgUnit } from '@shared/types'
import { PixelAvatar } from '@/components/common/PixelAvatar'
import { Modal } from '@/components/common/ui'
import { locale } from '@/i18n'
import { apiError, call } from '@/lib/api'
import { cn } from '@/lib/format'
import { useAppStore } from '@/store/useAppStore'

const norm = (s: string): string => s.toLocaleLowerCase(locale())

/** Multi-select picker that adds existing agents to a unit. */
export function AddMembersModal({ open, unit, onClose }: { open: boolean; unit: OrgUnit; onClose: () => void }) {
  const { t } = useTranslation()
  const agents = useAppStore((s) => s.agents)
  const toast = useAppStore((s) => s.toast)
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<Set<string>>(() => new Set())
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setPicked(new Set())
    setBusy(false)
  }, [open])

  const memberIds = useMemo(() => new Set(unit.members.map((m) => m.agentId)), [unit.members])
  const list = useMemo(() => {
    const q = norm(query.trim())
    const filtered = q ? agents.filter((a) => [a.name, a.role, ...a.skills].some((v) => norm(v).includes(q))) : agents
    // Non-members first, members (disabled) at the end.
    return [...filtered].sort((a, b) => Number(memberIds.has(a.id)) - Number(memberIds.has(b.id)))
  }, [agents, query, memberIds])

  const toggle = (id: string): void =>
    setPicked((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const submit = async (): Promise<void> => {
    if (!picked.size || busy) return
    setBusy(true)
    try {
      for (const id of picked) await call('units:addMember', unit.id, id)
      toast('success', t('org:addMembers.added', { count: picked.size, unit: unit.name }))
      onClose()
    } catch (e) {
      toast('error', apiError(e))
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={520}
      title={t('org:addMembers.title', { unit: unit.name })}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            {t('actions.cancel')}
          </button>
          <button className="btn-primary" disabled={!picked.size || busy} onClick={() => void submit()}>
            {picked.size ? t('org:addMembers.submit', { count: picked.size }) : t('org:addMembers.pick')}
          </button>
        </>
      }
    >
      <div className="relative mb-3">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
        <input autoFocus className="input pl-8" placeholder={t('org:addMembers.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="-mx-1 max-h-[360px] space-y-0.5 overflow-y-auto">
        {list.map((a) => {
          const member = memberIds.has(a.id)
          const on = picked.has(a.id)
          return (
            <button
              key={a.id}
              disabled={member}
              onClick={() => toggle(a.id)}
              className={cn(
                'flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors',
                member ? 'cursor-default opacity-50' : on ? 'bg-indigo-500/[0.08]' : 'hover:bg-white/[0.03]'
              )}
            >
              <span
                className={cn(
                  'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                  on || member ? 'border-indigo-400 bg-indigo-500 text-white' : 'border-zinc-600'
                )}
              >
                {(on || member) && <Check size={10} strokeWidth={3} />}
              </span>
              <PixelAvatar agent={a} size={26} />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] text-zinc-200">{a.name}</div>
                <div className="truncate text-[12px] text-zinc-500">{a.role}</div>
              </div>
              {member && <span className="text-[12px] text-zinc-500">{t('org:addMembers.alreadyMember')}</span>}
            </button>
          )
        })}
        {list.length === 0 && <div className="py-6 text-center text-[13px] text-zinc-500">{t('org:addMembers.noMatch')}</div>}
      </div>
    </Modal>
  )
}
