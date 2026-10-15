import { useState } from 'react'
import { Brain, Check, Network, Sparkles, UserRound, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Memory, MemoryKind, MemorySuggestion, RecalledMemory } from '@shared/types'
import { Segmented } from '@/components/common/ui'
import { apiError, call } from '@/lib/api'
import { cn } from '@/lib/format'
import { useAppStore } from '@/store/useAppStore'

export const KINDS: MemoryKind[] = ['preference', 'fact', 'decision', 'context', 'summary']
export const KIND_CLS: Record<MemoryKind, string> = {
  fact: 'text-sky-300 bg-sky-500/10',
  decision: 'text-emerald-300 bg-emerald-500/10',
  context: 'text-zinc-300 bg-white/5',
  preference: 'text-pink-300 bg-pink-500/10',
  summary: 'text-violet-300 bg-violet-500/10'
}

export function KindBadge({ kind }: { kind: MemoryKind }) {
  const { t } = useTranslation()
  return <span className={cn('shrink-0 rounded px-1.5 py-px text-[10px] font-medium', KIND_CLS[kind])}>{t(`org:memory.kinds.${kind}`)}</span>
}

export function TopicChips({ topics }: { topics: string[] }) {
  if (!topics.length) return null
  return (
    <span className="inline-flex flex-wrap gap-1">
      {topics.map((x) => (
        <span key={x} className="rounded bg-amber-500/10 px-1.5 py-px text-[10.5px] text-amber-200/90">
          #{x}
        </span>
      ))}
    </span>
  )
}

/** Inline editor of a memory's text and topics (comma separated). */
export function MemoryEditor({ memory, onDone }: { memory: Pick<Memory, 'id' | 'content' | 'topics'>; onDone: () => void }) {
  const { t } = useTranslation()
  const toast = useAppStore((s) => s.toast)
  const [text, setText] = useState(memory.content)
  const [topics, setTopics] = useState(memory.topics.join(', '))
  const save = async (): Promise<void> => {
    try {
      await call('memory:update', memory.id, text, topics.split(',').map((x) => x.trim()).filter(Boolean))
      onDone()
    } catch (e) {
      toast('error', apiError(e))
    }
  }
  return (
    <div className="w-full space-y-1.5">
      <textarea className="textarea text-[12.5px]" rows={2} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
      <input className="input h-7 text-[12px]" value={topics} onChange={(e) => setTopics(e.target.value)} placeholder={t('org:memory.topicsPlaceholder')} />
      <div className="flex justify-end gap-1.5">
        <button className="btn-ghost h-7" onClick={onDone}>
          {t('actions.cancel')}
        </button>
        <button className="btn-primary h-7" disabled={!text.trim()} onClick={() => void save()}>
          {t('actions.save')}
        </button>
      </div>
    </div>
  )
}

/** "I learned this, shall I keep it?" — one suggestion with its (editable) text and Keep / Don't keep. */
export function SuggestionRow({ s, compact = false }: { s: MemorySuggestion; compact?: boolean }) {
  const { t } = useTranslation()
  const toast = useAppStore((st) => st.toast)
  const [text, setText] = useState(s.content)
  const [busy, setBusy] = useState(false)
  const act = async (keep: boolean): Promise<void> => {
    setBusy(true)
    try {
      if (keep) await call('memory:accept', s.id, text !== s.content ? text : undefined)
      else await call('memory:dismiss', s.id)
    } catch (e) {
      toast('error', apiError(e))
      setBusy(false)
    }
  }
  return (
    <div data-testid="memory-suggestion" className="rounded-md border border-pink-500/25 bg-pink-500/[0.05] px-3 py-2.5">
      <div className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-medium text-pink-200">
        <Sparkles size={12} /> {t('org:memory.suggest.title')}
      </div>
      {compact ? (
        <div className="text-[12.5px] text-zinc-200">“{s.content}”</div>
      ) : (
        <textarea className="textarea text-[12.5px]" rows={2} value={text} onChange={(e) => setText(e.target.value)} />
      )}
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-400">
        <KindBadge kind={s.kind} />
        <TopicChips topics={s.topics} />
      </div>
      {s.replacesText && <div className="mt-1 text-[11.5px] text-amber-200/80">{t('org:memory.suggest.replaces', { text: s.replacesText.slice(0, 140) })}</div>}
      <div className="mt-2 flex gap-1.5">
        <button className="btn-primary h-7" disabled={busy || !text.trim()} onClick={() => void act(true)}>
          <Check size={13} /> {s.replaces ? t('org:memory.suggest.keepReplace') : t('org:memory.suggest.keep')}
        </button>
        <button className="btn-ghost h-7" disabled={busy} onClick={() => void act(false)}>
          <X size={13} /> {t('org:memory.suggest.drop')}
        </button>
      </div>
    </div>
  )
}

const VIA_ICON = { profile: UserRound, match: Brain, graph: Network }

/** "What I remembered": the memories that went into a reply or a task run. */
export function RecalledTrace({ items, title }: { items: RecalledMemory[]; title: string }) {
  const { t } = useTranslation()
  if (!items.length) return null
  return (
    <details className="mt-1.5 text-[11.5px] text-zinc-400" data-testid="memory-trace">
      <summary className="cursor-pointer select-none hover:text-zinc-200">
        <Brain size={11} className="mr-1 inline" />
        {title} ({items.length})
      </summary>
      <ul className="mt-1 space-y-1 border-l border-line pl-3">
        {items.map((m) => {
          const Icon = VIA_ICON[m.via]
          return (
            <li key={m.id} className="flex items-start gap-1.5">
              <Icon size={11} className="mt-0.5 shrink-0 text-zinc-500" />
              <KindBadge kind={m.kind} />
              <span className="min-w-0 text-zinc-300">{m.content}</span>
              <span className="shrink-0 text-zinc-500">{t(`org:memory.via.${m.via}`)}</span>
            </li>
          )
        })}
      </ul>
    </details>
  )
}

/** Learning from chat: ask first (default), save right away, or off. */
export function LearnMode() {
  const { t } = useTranslation()
  const mode = useAppStore((s) => s.settings.memoryLearn)
  const toast = useAppStore((s) => s.toast)
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented<'ask' | 'auto' | 'off'>
        value={mode}
        onChange={(v) => void call('settings:update', { memoryLearn: v }).catch((e) => toast('error', apiError(e)))}
        options={[
          { value: 'ask', label: t('org:memory.learn.ask') },
          { value: 'auto', label: t('org:memory.learn.auto') },
          { value: 'off', label: t('org:memory.learn.off') }
        ]}
      />
      <span className="text-[11.5px] text-zinc-400">{t(`org:memory.learn.${mode}Hint`)}</span>
    </div>
  )
}
