export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

import { locale, t } from '@/i18n'

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return ''
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000)
  if (s < 45) return t('time.now')
  if (s < 3600) return t('time.minutesShort', { count: Math.round(s / 60) })
  if (s < 86400) return t('time.hoursShort', { count: Math.round(s / 3600) })
  return t('time.daysShort', { count: Math.round(s / 86400) })
}

/** "5 min ago" / "5 dk önce"; "just now" for the first 45 seconds. */
export function ago(iso: string | null | undefined): string {
  if (!iso) return ''
  if (Date.now() - Date.parse(iso) < 45_000) return t('time.justNow')
  return t('time.ago', { time: timeAgo(iso) })
}

export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })
}

export function duration(fromIso: string, toIso?: string | null): string {
  const s = Math.max(0, ((toIso ? Date.parse(toIso) : Date.now()) - Date.parse(fromIso)) / 1000)
  if (s < 60) return t('time.secondsUnit', { count: Math.round(s) })
  if (s < 3600) return t('time.minutesSeconds', { m: Math.floor(s / 60), s: Math.round(s % 60) })
  return t('time.hoursMinutes', { h: Math.floor(s / 3600), m: Math.round((s % 3600) / 60) })
}

export function compact(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
  return String(n)
}

// Labels are getters so they always read the current language (`PRIORITY_META[p].label`).
export const PRIORITY_META = [
  { get label() { return t('priority.low') }, color: 'text-zinc-400', dot: 'bg-zinc-400' },
  { get label() { return t('priority.normal') }, color: 'text-sky-400', dot: 'bg-sky-400' },
  { get label() { return t('priority.high') }, color: 'text-amber-400', dot: 'bg-amber-400' },
  { get label() { return t('priority.urgent') }, color: 'text-rose-400', dot: 'bg-rose-400' }
] as const

export const STATUS_META = {
  idle: { get label() { return t('agentStatus.idle') }, dot: 'bg-zinc-500', text: 'text-zinc-400' },
  working: { get label() { return t('agentStatus.working') }, dot: 'bg-emerald-400', text: 'text-emerald-400' },
  break: { get label() { return t('agentStatus.break') }, dot: 'bg-amber-400', text: 'text-amber-400' },
  error: { get label() { return t('agentStatus.error') }, dot: 'bg-rose-500', text: 'text-rose-400' },
  offline: { get label() { return t('agentStatus.offline') }, dot: 'bg-zinc-600', text: 'text-zinc-400' }
} as const

export const TASK_COLUMNS = [
  { id: 'todo', get label() { return t('taskColumns.todo') }, accent: 'bg-zinc-500' },
  { id: 'in_progress', get label() { return t('taskColumns.in_progress') }, accent: 'bg-emerald-400' },
  { id: 'in_review', get label() { return t('taskColumns.in_review') }, accent: 'bg-violet-400' },
  { id: 'done', get label() { return t('taskColumns.done') }, accent: 'bg-indigo-400' }
] as const

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1048576) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`
  return `${(n / 1073741824).toFixed(2)} GB`
}
