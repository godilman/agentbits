// Just enough of `electron` for the main process code under plain Node (tests/e2e). Secrets use the test-only
// plain fallback (AGENTBITS_ALLOW_PLAIN_SECRETS=1, set by scripts/e2e.mjs).
const noop = () => undefined
// tests/e2e/notify.e2e.ts and update.e2e.ts drive these through globalThis.__e2e.
const e2e = (globalThis.__e2e ??= { windows: [], shown: [], supported: true, failShow: false, opened: [] })
const app = {
  getPath: () => process.env.AGENTBITS_DATA_DIR,
  getLocale: () => 'tr',
  getVersion: () => e2e.version ?? '0.0.0-test',
  getName: () => 'Agentbits',
  getAppPath: () => process.cwd(),
  isPackaged: false
}
class Notification {
  constructor(options) {
    this.options = options
    this.handlers = {}
  }
  static isSupported() {
    return e2e.supported
  }
  on(event, fn) {
    this.handlers[event] = fn
  }
  show() {
    if (e2e.failShow) throw new Error('the system refused the notification')
    e2e.shown.push(this)
  }
}
module.exports = new Proxy(
  {
    app,
    BrowserWindow: { getAllWindows: () => e2e.windows },
    Notification,
    safeStorage: { isEncryptionAvailable: () => false },
    shell: { openExternal: async (url) => void (e2e.opened ??= []).push(url) },
    dialog: {},
    net: { fetch: (...args) => (e2e.netFetch ? e2e.netFetch(...args) : Promise.reject(new Error('no network in tests'))) }
  },
  { get: (t, k) => (k in t ? t[k] : new Proxy(noop, { get: () => noop })) }
)
