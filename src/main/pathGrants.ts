import { BrowserWindow, dialog } from 'electron'
import { resolve } from 'path'
import { t } from './i18n'

/**
 * Local paths the renderer may hand to main (security review #13). A path is trusted when it came from one of main's own
 * file dialogs, or from the preload turning a real dropped / picked `File` into a path — page script can't forge
 * either. Anything else (e.g. a typed key file path, or a compromised renderer asking for ~/.ssh/id_rsa) needs the user's
 * yes in a native dialog, which the renderer can't answer.
 */
const TTL = 30 * 60_000
const grants = new Map<string, number>()
const key = (p: string): string => {
  const r = resolve(p)
  return process.platform === 'win32' ? r.toLowerCase() : r
}

export function grantPaths(paths: string[]): void {
  const until = Date.now() + TTL
  for (const p of paths) if (typeof p === 'string' && p && p.length < 4096) grants.set(key(p), until)
}

function isGranted(p: string): boolean {
  const now = Date.now()
  for (const [k, until] of grants) if (until < now) grants.delete(k)
  return grants.has(key(p))
}

/** Throws unless every path is granted or the user confirms the rest in a native dialog. */
export async function assertPathsAllowed(paths: string[], purpose: 'files' | 'skill' | 'sshKey'): Promise<void> {
  const unknown = paths.filter((p) => !isGranted(p))
  if (!unknown.length) return
  const win = BrowserWindow.getFocusedWindow()
  const opts = {
    type: 'warning' as const,
    buttons: [t('main:paths.allow'), t('main:paths.deny')],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    title: t('main:paths.title'),
    message: t(`main:paths.message.${purpose}`),
    detail: unknown.slice(0, 10).join('\n') + (unknown.length > 10 ? `\n… +${unknown.length - 10}` : '')
  }
  const r = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts)
  if (r.response !== 0) throw new Error(t('main:paths.denied'))
  grantPaths(unknown)
}
