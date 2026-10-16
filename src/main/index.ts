import { app, BrowserWindow, session, shell } from 'electron'
import { join } from 'path'
import { openDb, closeDb } from './db'
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
import { rejectAllApprovals } from './connections/service'
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
  win.once('ready-to-show', () => win.show())
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

app.whenReady().then(() => {
  if (!gotLock) return
  if (isWin) app.setAppUserModelId('app.agentbits.desktop')
  hardenSessions()
  openDb()
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
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  if (!gotLock) return
  stopMaintenance()
  rejectAllApprovals()
  stopBridge()
  void closeAllApps()
  orchestrator.shutdown()
  cancelAllPrompts()
  terminals.killAll()
  closeDb()
})
