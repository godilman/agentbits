import { t } from '../i18n'

export interface WorkAtQuit {
  /** Task runs working right now. */
  runs: number
  /** Chat replies and reviews in flight. */
  replies: number
  /** Approval requests waiting for the user (task runs and connections). */
  approvals: number
}

/**
 * The close dialog's text, or null when nothing would be cut off (the app then closes without asking). What it says is
 * what before-quit really does: runs stop and are held on the next start, replies / reviews stop, approvals are
 * turned down, nothing already done is undone.
 */
export function quitWarning(w: WorkAtQuit): { title: string; message: string; detail: string; keep: string; quit: string } | null {
  if (!w.runs && !w.replies && !w.approvals) return null
  const lines = [
    w.runs ? t('main:quit.runs', { count: w.runs }) : '',
    w.replies ? t('main:quit.replies', { count: w.replies }) : '',
    w.approvals ? t('main:quit.approvals', { count: w.approvals }) : ''
  ].filter(Boolean)
  return {
    title: t('main:quit.title'),
    message: t('main:quit.message'),
    detail: `${lines.join('\n')}\n\n${t('main:quit.nothingUndone')}`,
    keep: t('main:quit.keep'),
    quit: t('main:quit.quit')
  }
}
