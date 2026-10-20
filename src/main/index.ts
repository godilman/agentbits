import { app, BrowserWindow, dialog, session, shell } from 'electron'
import { dirname, join } from 'path'
import { DbStartError, backupsDir, getDbPath, openDb, closeDb } from './db'
import { startUpdates, stopUpdates } from './update'
import { startNotifications } from './notify'
import { ensureOrgDefaults } from './core/org'
import { dropUnboundOAuth, renameLegacyDefne, upgradePlainSecrets } from './core/legacy'
import { applyLanguageSetting, t } from './i18n'
import { settingsRepo } from './db/repos'
import { registerIpc } from './ipc'
import { orchestrator } from './core/orchestrator'
import { cancelAllPrompts } from './core/promptBuilder'
import { startMaintenance, stopMaintenance } from './core/maintenance'
import { startFiles } from './files/service'
import { stopBridge } from './connections/bridge'
import { closeAllApps } from './apps/client'
import { listApprovals, rejectAllApprovals } from './connections/service'
import { quitWarning } from './core/quitGuard'
import { scheduleIndex } from './core/embeddings'
import { terminals } from './terminal/manager'

const isWin = process.platform === 'win32'

// A stray error in a background task (a dropped DB socket, an MCP server going away…) must not show Electron's
// modal crash dialog, which blocks the whole main process: log it and keep running.
process.on('uncaughtException', (e) => console.error('[agentbits] uncaught exception:', e))
process.on('unhandledRejection', (e) => console.error('[agentbits] unhandled rejection:', e))

// A separate data folder (tests, a second profile) is a separate app instance: its own Chromium profile and lock.
if (process.env.AGENTBITS_DATA_DIR) app.setPath('userData', join(process.env.AGENTBITS_DATA_DIR, 'electron'))
/**
 * One app instance per data folder: a second one would open the same database, treat the first one's running
 * work as stale and start the same tasks again. The second launch only brings the open window forward.
 */
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()
let mainWindow: BrowserWindow | null = null
app.on('second-instance', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
})

/** Remote content (the Browser section) gets no device permissions; the app window only clipboard / fullscreen. */
function hardenSessions(): void {
  const allowedForApp = new Set(['clipboard-sanitized-write', 'clipboard-read', 'fullscreen'])
  for (const ses of [session.defaultSession, session.fromPartition('persist:agentbits-browser')]) {
    const remote = ses !== session.defaultSession
    ses.setPermissionRequestHandler((_wc, permission, cb) => cb(!remote && allowedForApp.has(permission)))
    ses.setPermissionCheckHandler((_wc, permission) => !remote && allowedForApp.has(permission))
  }
  app.on('web-contents-created', (_e, contents) => {
    // <webview>: no preload, no Node, isolated, sandboxed; only http(s) pages.
    contents.on('will-attach-webview', (event, prefs, params) => {
      delete (prefs as { preload?: string }).preload
      prefs.nodeIntegration = false
      prefs.nodeIntegrationInSubFrames = false
      prefs.contextIsolation = true
      prefs.sandbox = true
      if (!/^https?:\/\//i.test(params.src ?? '') && params.src !== 'about:blank') event.preventDefault()
    })
    if (contents.getType() === 'webview') {
      contents.setWindowOpenHandler(({ url }) => {
        // Pop-ups open in the same view (http/https only), never as new app windows.
        if (/^https?:\/\//i.test(url)) void contents.loadURL(url)
        return { action: 'deny' }
      })
      contents.on('will-navigate', (e, url) => {
        if (!/^https?:\/\//i.test(url)) e.preventDefault()
      })
    }
  })
}

/** The user said "Close anyway" (or there was nothing to cut off): don't ask again on the way out. */
let quitConfirmed = false
/** before-quit seen: on macOS a window close only ends the app when quitting (otherwise work goes on). */
let quitting = false
/** The database didn't open (`showDbStartError`): quitting touches nothing that needs it. */
let dbFailed = false

/**
 * Closing would stop running tasks, cut off replies / reviews and turn down approvals: say so with the counts and let
 * the user keep working (the default). Nothing to cut off → close without asking. No "don't ask again" on purpose.
 */
function confirmQuit(win: BrowserWindow | null): boolean {
  if (quitConfirmed) return true
  const work = orchestrator.workSummary()
  const warning = quitWarning({ ...work, approvals: work.approvals + listApprovals().length })
  if (!warning) return true
  const options = {
    type: 'warning' as const,
    title: warning.title,
    message: warning.message,
    detail: warning.detail,
    buttons: [warning.keep, warning.quit],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  }
  const choice = win && !win.isDestroyed() ? dialog.showMessageBoxSync(win, options) : dialog.showMessageBoxSync(options)
  if (choice !== 1) return false
  quitConfirmed = true
  return true
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 680,
    show: false,
    title: 'Agentbits',
    // Packaged builds take the icon from the executable; dev runs need it explicitly.
    ...(app.isPackaged ? {} : { icon: join(app.getAppPath(), 'build-resources', 'icon.png') }),
    backgroundColor: '#09090b',
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    ...(isWin || process.platform === 'linux'
      ? { titleBarOverlay: { color: '#0c0c0e', symbolColor: '#a1a1aa', height: 40 } }
      : { trafficLightPosition: { x: 14, y: 14 } }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    }
  })

  mainWindow = win
  startNotifications(win, createWindow)
  win.once('ready-to-show', () => win.show())
  win.on('close', (e) => {
    // macOS: closing the window keeps the app (and its work) running; only quitting asks.
    if (process.platform === 'darwin' && !quitting) return
    if (!confirmQuit(win)) e.preventDefault()
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  // The app never navigates away from itself (e.g. a file dropped outside a drop zone would open file://…).
  win.webContents.on('will-navigate', (e, url) => {
    const current = win.webContents.getURL()
    if (url.split('#')[0] === current.split('#')[0]) return
    e.preventDefault()
    if (/^https?:/.test(url) && !url.startsWith(new URL(current).origin)) void shell.openExternal(url)
  })

  if (process.env.ELECTRON_RENDERER_URL) void loadDevServer(win, process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
  return win
}

/**
 * Dev only: the Vite server can be slow to accept the first connection (dependency
 * pre-bundling, slow/network drives, firewall prompts). Retry instead of leaving a
 * black window, and explain what to check if it never comes up.
 */
async function loadDevServer(win: BrowserWindow, rawUrl: string): Promise<void> {
  const url = rawUrl.replace('//localhost:', '//127.0.0.1:')
  let lastError = ''
  for (let attempt = 1; attempt <= 15; attempt++) {
    if (win.isDestroyed()) return
    try {
      await win.loadURL(url)
      return
    } catch (e) {
      lastError = (e as Error).message
      console.warn(`[agentbits] dev server not reachable (${attempt}/15): ${lastError}`)
      await new Promise((r) => setTimeout(r, 2000))
    }
  }
  if (win.isDestroyed()) return
  const html = `<!doctype html><html><body style="background:#09090b;color:#d4d4d8;font:14px Segoe UI,sans-serif;padding:48px;line-height:1.6">
    <h2 style="color:#f4f4f5">${t('orchestrator:devServer.title')}</h2>
    <p>${t('orchestrator:devServer.unreachable', { url })}</p>
    <p style="color:#a1a1aa">${t('orchestrator:devServer.error', { error: lastError.replace(/</g, '&lt;') })}</p>
    <ol style="color:#a1a1aa">
      <li>${t('orchestrator:devServer.step1')}</li>
      <li>${t('orchestrator:devServer.step2', { url })}</li>
      <li>${t('orchestrator:devServer.step3')}</li>
      <li>${t('orchestrator:devServer.step4')}</li>
    </ol></body></html>`
  void win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
}

/**
 * The data couldn't be opened safely (a newer version's data, a failed backup or upgrade): say what happened, where the
 * backup and the data are, and close. Never an empty profile in its place, never a reset.
 */
async function showDbStartError(e: unknown): Promise<void> {
  applyLanguageSetting('auto') // settings live in the database
  const err = e instanceof DbStartError ? e : null
  const kind = err?.kind ?? 'open'
  const detail = [
    t(`main:dbStart.${kind}`, { found: err?.version.found ?? '?', latest: err?.version.latest ?? '?' }),
    err?.backup ? t('main:dbStart.backupAt', { path: err.backup }) : '',
    t('main:dbStart.dataAt', { path: getDbPath() }),
    t(`main:dbStart.recover.${kind}`),
    t('main:dbStart.error', { error: e instanceof Error ? e.message : String(e) })
  ].filter(Boolean)
  const choice = dialog.showMessageBoxSync({
    type: 'error',
    title: t('main:dbStart.title'),
    message: t(`main:dbStart.message.${kind}`),
    detail: detail.join('\n\n'),
    buttons: [t('main:dbStart.openFolder'), t('main:dbStart.quit')],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  })
  if (choice === 0) await shell.openPath(err?.backup ? backupsDir() : dirname(getDbPath()))
}

app.whenReady().then(async () => {
  if (!gotLock) return
  if (isWin) app.setAppUserModelId('app.agentbits.desktop')
  hardenSessions()
  try {
    openDb()
  } catch (e) {
    dbFailed = true
    console.error('[agentbits] database not opened:', e)
    try {
      await showDbStartError(e)
    } finally {
      app.exit(1) // always: a process without a window would keep the single-instance lock
    }
    return
  }
  applyLanguageSetting(settingsRepo.get().language)
  ensureOrgDefaults()
  renameLegacyDefne()
  upgradePlainSecrets()
  dropUnboundOAuth()
  registerIpc()
  orchestrator.init()
  scheduleIndex(10_000) // semantic memory (if on): embed what's missing, a little after start-up
  startMaintenance()
  startFiles()
  createWindow()
  startUpdates()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', (e) => {
  if (!gotLock || dbFailed) return
  quitting = true
  if (!confirmQuit(mainWindow)) {
    e.preventDefault()
    quitting = false
    return
  }
  stopMaintenance()
  stopUpdates()
  rejectAllApprovals()
  stopBridge()
  void closeAllApps()
  orchestrator.shutdown()
  cancelAllPrompts()
  terminals.killAll()
  closeDb()
})
