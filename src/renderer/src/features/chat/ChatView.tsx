import { useEffect, useMemo, useRef, useState } from 'react'
import { Brain, Hash, Send, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useResize } from '@/components/common/Resize'
import type { I18nKey } from '@shared/i18n'
import type { FileKind, FileRecord, FileShare, Message, RecalledMemory } from '@shared/types'
import { descendantIds } from '@shared/org'
import { PixelAvatar } from '@/components/common/PixelAvatar'
import { call } from '@/lib/api'
import { clock, cn, STATUS_META } from '@/lib/format'
import { Markdown } from '@/lib/markdown'
import { isTypingNote, useProjectScope } from '@/lib/org'
import { useLiveReplies } from '@/lib/replyStreams'
import type { LiveReply } from '@shared/replyStream'
import { apiError } from '@/lib/api'
import { agentById, channelKey, useAppStore } from '@/store/useAppStore'
import { useAttachments, useFileDrop, useFileRecords } from '@/features/files/hooks'
import { AttachButton, AttachmentTray, DropOverlay, FileChip } from '@/features/files/parts'
import { RecalledTrace, SuggestionRow } from '@/features/memory/parts'

type MessageFile = { id: string; name: string; kind?: FileKind; size?: number }
const messageFiles = (m: Message): MessageFile[] => (Array.isArray(m.meta?.files) ? (m.meta!.files as MessageFile[]) : [])

const SUGGESTIONS: I18nKey[] = ['chat:suggestions.s1', 'chat:suggestions.s2', 'chat:suggestions.s3']


export function ChatView() {
  const { t } = useTranslation()
  const [channelsWidth, channelsHandle] = useResize('chatChannels', 220, { min: 160, max: 480 })
  const channel = useAppStore((s) => s.chatChannel)
  const setChannel = useAppStore((s) => s.setChatChannel)
  const channels = useAppStore((s) => s.channels)
  const loadChannel = useAppStore((s) => s.loadChannel)
  const agents = useAppStore((s) => s.agents)
  const allTasks = useAppStore((s) => s.tasks)
  const feed = useAppStore((s) => s.feed)
  const { pid, project, lead, members } = useProjectScope()
  const [draft, setDraft] = useState('')
  const [shareTo, setShareTo] = useState<string>('lead')
  const [sending, setSending] = useState(false)
  const units = useAppStore((s) => s.units)
  const toast = useAppStore((s) => s.toast)
  const att = useAttachments(pid)
  const drop = useFileDrop((files) => void att.addFiles(files), !!pid)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void loadChannel(channel)
  }, [channel, loadChannel, pid])

  const tasks = useMemo(() => allTasks.filter((t) => t.projectId === pid), [allTasks, pid])
  const dms = useMemo(() => members.filter((a) => a.id !== lead?.id), [members, lead])
  const messages = channels[channelKey(pid, channel)] ?? []
  const fileIds = useMemo(() => [...new Set(messages.flatMap((m) => messageFiles(m).map((f) => f.id)))], [messages])
  const fileRecords = useFileRecords(fileIds)
  // Teams of this project (assigned units and their sub-units) for "send files to a team".
  const projectUnits = useMemo(() => {
    if (!project) return []
    const ids = new Set(project.unitIds.flatMap((id) => [id, ...descendantIds(units, id)]))
    return units.filter((u) => ids.has(u.id) && u.parentId)
  }, [project, units])
  const target = channel === 'general' ? lead ?? undefined : channel.startsWith('agent:') ? agentById(agents, channel.slice(6)) : undefined
  const task = channel.startsWith('task:') ? tasks.find((t) => t.id === channel.slice(5)) : undefined
  const live = useLiveReplies(pid ?? '', channel, messages)
  // A reply being written shows itself; the dots are only for the wait before its first words.
  const typing = isTypingNote(target?.statusNote) && !live.some((r) => r.agentId === target?.id && r.text)
  const liveLength = live.reduce((n, r) => n + r.text.length, 0)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages.length, typing, liveLength])

  const taskThreads = useMemo(() => {
    const ids = new Set(feed.filter((m) => m.projectId === pid && m.channel.startsWith('task:')).map((m) => m.channel.slice(5)))
    return tasks.filter((t) => ids.has(t.id) || t.status === 'in_progress' || t.status === 'in_review').slice(0, 14)
  }, [feed, tasks, pid])

  const send = async (text = draft): Promise<void> => {
    const fileIds = att.readyIds
    if ((!text.trim() && !fileIds.length) || !pid || sending) return
    if (att.uploading) return toast('error', t('chat:uploading'))
    let share: FileShare | undefined
    if (fileIds.length && channel === 'general') {
      share = shareTo === 'project' ? { type: 'project' } : shareTo.startsWith('unit:') ? { type: 'unit', unitId: shareTo.slice(5) } : { type: 'lead' }
    }
    setSending(true)
    try {
      await call('messages:send', channel, text.trim(), pid, fileIds.length ? { fileIds, share } : undefined)
      setDraft('')
      att.clear()
    } catch (e) {
      toast('error', apiError(e))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex h-full">
      <nav style={{ width: channelsWidth }} className="flex shrink-0 flex-col gap-4 overflow-y-auto border-r border-line bg-[#0c0c0e] p-2 pt-3">
        <div>
          <div className="panel-title mb-1 px-2">{t('chat:channels')}</div>
          <ChannelButton active={channel === 'general'} onClick={() => setChannel('general')} icon={<Hash size={14} />} label="general" hint={lead ? t('chat:leadHint', { name: lead.name }) : undefined} />
        </div>
        <div>
          <div className="panel-title mb-1 px-2">{t('chat:directMessages')}</div>
          {dms.length === 0 && <div className="px-2 py-1 text-[11.5px] text-zinc-500">{t('chat:noTeam')}</div>}
          {dms.map((a) => (
            <ChannelButton
              key={a.id}
              active={channel === `agent:${a.id}`}
              onClick={() => setChannel(`agent:${a.id}`)}
              icon={<PixelAvatar agent={a} size={18} showStatus />}
              label={a.name}
              hint={a.role}
            />
          ))}
        </div>
        {taskThreads.length > 0 && (
          <div>
            <div className="panel-title mb-1 px-2">{t('chat:taskThreads')}</div>
            {taskThreads.map((t) => (
              <ChannelButton
                key={t.id}
                active={channel === `task:${t.id}`}
                onClick={() => setChannel(`task:${t.id}`)}
                icon={<span className="w-[18px] text-center font-mono text-[9.5px] text-zinc-400">{t.key.replace('TA-', '#')}</span>}
                label={t.title}
              />
            ))}
          </div>
        )}
      </nav>
      {channelsHandle}

      <section className="relative flex min-w-0 flex-1 flex-col" {...drop.props}>
        <DropOverlay
          show={drop.over}
          label={channel === 'general' ? t('chat:drop.general') : target ? t('chat:drop.agent', { name: target.name }) : t('chat:drop.task')}
        />
        <header className="flex h-12 shrink-0 items-center gap-2.5 border-b border-line px-5">
          {target ? <PixelAvatar agent={target} size={26} showStatus /> : <Hash size={16} className="text-zinc-400" />}
          <div className="min-w-0">
            <div className="truncate text-[13.5px] font-semibold text-zinc-100">
              {channel === 'general' ? '# general' : target ? target.name : task ? `${task.key} · ${task.title}` : channel}
            </div>
            <div className="truncate text-[11px] text-zinc-400">
              {channel === 'general'
                ? t('chat:generalSubtitle', { project: project?.name ?? t('chat:project') })
                : target
                  ? `${target.role} · ${STATUS_META[target.status].label}`
                  : t('chat:taskSubtitle')}
            </div>
          </div>
        </header>

        <div ref={scrollRef} className="selectable min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="mx-auto max-w-3xl space-y-4">
            {messages.length === 0 && channel === 'general' && !lead ? (
              <div className="mx-auto mt-6 max-w-md rounded-lg border border-line bg-surface-2 p-4 text-center" data-testid="chat-no-lead">
                <div className="text-[13px] font-medium text-zinc-100">{t('chat:noLeadTitle')}</div>
                <p className="mt-1 text-[12px] leading-relaxed text-zinc-400">
                  {t('chat:noLeadText')}
                </p>
                <div className="mt-3 flex justify-center gap-2">
                  <button className="btn-outline h-7" onClick={() => useAppStore.getState().showOrg('templates')}>
                    {t('chat:templates')}
                  </button>
                  <button className="btn-primary h-7" onClick={() => useAppStore.getState().openGuide()}>
                    {t('chat:openGuide')}
                  </button>
                </div>
              </div>
            ) : (
              messages.length === 0 && <div className="py-10 text-center text-[12.5px] text-zinc-400">{t('chat:empty')}</div>
            )}
            {messages.map((m, i) => (
              <MessageRow key={m.id} m={m} prev={messages[i - 1]} files={fileRecords} />
            ))}
            {live.map((r) => (
              <LiveRow key={r.replyId} r={r} />
            ))}
            {typing && target && (
              <div className="flex items-center gap-2.5 pl-[42px] text-[12px] text-zinc-400">
                {t('chat:typing', { name: target.name })}
                <span className="flex gap-0.5">
                  {[0, 1, 2].map((i) => (
                    <span key={i} className="h-1 w-1 animate-bounce rounded-full bg-zinc-500" style={{ animationDelay: `${i * 120}ms` }} />
                  ))}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-line px-5 py-3">
          <div className="mx-auto max-w-3xl">
            {channel === 'general' && !!lead && messages.filter((m) => m.senderType === 'user').length === 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {SUGGESTIONS.map((k) => t(k)).map((s) => (
                  <button key={s} onClick={() => void send(s)} className="flex max-w-[48%] items-center gap-1.5 truncate rounded-md border border-line bg-surface px-2 py-1 text-left text-[11.5px] text-zinc-400 hover:border-zinc-600 hover:text-zinc-200">
                    <Sparkles size={11} className="shrink-0 text-indigo-300" />
                    <span className="truncate">{s}</span>
                  </button>
                ))}
              </div>
            )}
            <AttachmentTray items={att.items} records={att.records} onRemove={att.remove} />
            {att.items.length > 0 && channel === 'general' && (
              <div className="mb-1.5 flex items-center gap-2 text-[11.5px] text-zinc-400">
                {t('chat:shareLabel')}
                <select className="input h-7 w-auto py-0 text-[11.5px]" value={shareTo} onChange={(e) => setShareTo(e.target.value)} data-testid="share-select">
                  <option value="lead">{lead ? t('chat:shareLeadNamed', { name: lead.name }) : t('chat:shareLead')}</option>
                  <option value="project">{t('chat:shareProject')}</option>
                  {projectUnits.map((u) => (
                    <option key={u.id} value={`unit:${u.id}`}>
                      {t('chat:shareUnit', { name: u.name })}
                    </option>
                  ))}
                </select>
                <span className="text-zinc-500">{t('chat:shareHint')}</span>
              </div>
            )}
            <div className="flex items-end gap-2 rounded-lg border border-line bg-surface-2 p-2 focus-within:border-accent/50 focus-within:ring-2 focus-within:ring-accent/10">
              <AttachButton onClick={() => void att.pick()} disabled={!pid} className="h-7 w-7" />
              <textarea
                rows={Math.min(6, Math.max(1, draft.split('\n').length))}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onPaste={drop.onPaste}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void send()
                  }
                }}
                placeholder={target ? t('chat:placeholderAgent', { name: target.name }) : t('chat:placeholderNote')}
                className="max-h-40 min-h-[22px] flex-1 resize-none bg-transparent px-1 text-[13px] leading-relaxed text-zinc-200 outline-none placeholder:text-zinc-400"
              />
              <button className="btn-primary h-7 w-7 p-0" disabled={(!draft.trim() && !att.readyIds.length) || sending || att.uploading} onClick={() => void send()}>
                <Send size={13} />
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

function ChannelButton({ active, onClick, icon, label, hint }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; hint?: string }) {
  return (
    <button
      onClick={onClick}
      className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors', active ? 'bg-white/[0.07] text-zinc-100' : 'text-zinc-400 hover:bg-white/[0.03] hover:text-zinc-200')}
    >
      <span className="flex w-[18px] shrink-0 justify-center text-zinc-400">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px]">{label}</span>
        {hint && <span className="block truncate text-[10.5px] text-zinc-400">{hint}</span>}
      </span>
    </button>
  )
}

function MessageRow({ m, prev, files }: { m: Message; prev?: Message; files: Map<string, FileRecord> }) {
  const { t } = useTranslation()
  const attached = messageFiles(m)
  const agents = useAppStore((s) => s.agents)
  const a = m.senderType === 'agent' ? agentById(agents, m.senderId) : undefined
  if (m.senderType === 'system') {
    return (
      <div className="flex items-center gap-3 text-[11.5px] text-zinc-400">
        <span className="h-px flex-1 bg-line" />
        <span className="max-w-[80%] text-center">{m.content}</span>
        <span className="h-px flex-1 bg-line" />
      </div>
    )
  }
  const chips = attached.length > 0 && (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {attached.map((f) => (
        <FileChip key={f.id} file={files.get(f.id)} fallback={f} />
      ))}
    </div>
  )
  const grouped = prev && prev.senderType === m.senderType && prev.senderId === m.senderId && Date.parse(m.createdAt) - Date.parse(prev.createdAt) < 120_000
  const isUser = m.senderType === 'user'
  return (
    <div className={cn('group flex gap-3 animate-fade-in', grouped && '-mt-2')}>
      <div className="w-[30px] shrink-0">
        {!grouped &&
          (isUser ? (
            <div className="flex h-[30px] w-[30px] items-center justify-center rounded-md bg-gradient-to-br from-zinc-600 to-zinc-800 text-[10px] font-bold text-zinc-100">{t('chat:youBadge')}</div>
          ) : (
            <PixelAvatar agent={a} size={30} />
          ))}
      </div>
      <div className="min-w-0 flex-1">
        {!grouped && (
          <div className="mb-0.5 flex items-baseline gap-2">
            <span className="text-[13px] font-semibold" style={{ color: isUser ? '#f4f4f5' : a?.color }}>
              {isUser ? t('chat:you') : a?.name ?? t('chat:agent')}
            </span>
            {a && <span className="text-[11px] text-zinc-400">{a.role}</span>}
            <span className="text-[10.5px] text-zinc-400">{clock(m.createdAt)}</span>
          </div>
        )}
        <div className={cn(isUser && 'rounded-lg rounded-tl-sm bg-white/[0.04] px-3 py-1.5 inline-block max-w-full')}>
          <Markdown text={m.content} />
        </div>
        {chips}
        {!isUser && <MessageMemory m={m} />}
      </div>
    </div>
  )
}

/** A reply while it is written (not stored yet): replaced by the stored message when it arrives. */
function LiveRow({ r }: { r: LiveReply }) {
  const { t } = useTranslation()
  const agents = useAppStore((s) => s.agents)
  const a = agentById(agents, r.agentId)
  if (!r.text && !r.hiding) return null
  return (
    <div data-testid="live-reply" className="group flex gap-3 animate-fade-in">
      <div className="w-[30px] shrink-0">
        <PixelAvatar agent={a} size={30} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex items-baseline gap-2">
          <span className="text-[13px] font-semibold" style={{ color: a?.color }}>
            {a?.name ?? t('chat:agent')}
          </span>
          {a && <span className="text-[11px] text-zinc-400">{a.role}</span>}
        </div>
        {r.text && <Markdown text={r.text} />}
        {r.hiding ? (
          <div className="mt-1 text-[11.5px] italic text-zinc-400">{t(`chat:live.${r.hiding}`)}</div>
        ) : (
          !r.messageId && <span aria-hidden className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-zinc-400 align-middle" />
        )}
      </div>
    </div>
  )
}

/** Graph memory under an agent's reply: what it learned (ask / saved) and what it remembered. */
function MessageMemory({ m }: { m: Message }) {
  const { t } = useTranslation()
  const pending = useAppStore((s) => s.memorySuggestions)
  const showOrg = useAppStore((s) => s.showOrg)
  const asked = Array.isArray(m.meta?.suggestions) ? (m.meta!.suggestions as { id: string }[]) : []
  const open = pending.filter((p) => asked.some((a) => a.id === p.id))
  const learned = Array.isArray(m.meta?.learned) ? (m.meta!.learned as { id: string; content: string }[]) : []
  const recalled = Array.isArray(m.meta?.recalled) ? (m.meta!.recalled as RecalledMemory[]) : []
  if (!open.length && !learned.length && !recalled.length) return null
  return (
    <div className="max-w-[560px]">
      {open.map((s) => (
        <div key={s.id} className="mt-2">
          <SuggestionRow s={s} compact />
        </div>
      ))}
      {learned.map((l) => (
        <div key={l.id} className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-pink-200/90">
          <Brain size={12} /> {t('org:memory.learnedLine', { text: l.content })}
          <button className="text-zinc-400 underline-offset-2 hover:text-zinc-200 hover:underline" onClick={() => showOrg('memory')}>
            {t('org:memory.seeInMemory')}
          </button>
        </div>
      ))}
      <RecalledTrace items={recalled} title={t('org:memory.trace.chat')} />
    </div>
  )
}
