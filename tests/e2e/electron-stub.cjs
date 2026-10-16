// Just enough of `electron` for the main process code under plain Node (tests/e2e). Secrets use the test-only
// plain fallback (AGENTBITS_ALLOW_PLAIN_SECRETS=1, set by scripts/e2e.mjs).
const noop = () => undefined
const app = {
  getPath: () => process.env.AGENTBITS_DATA_DIR,
  getLocale: () => 'tr',
  getVersion: () => '0.0.0-test',
  getName: () => 'Agentbits',
  getAppPath: () => process.cwd(),
  isPackaged: false
}
module.exports = new Proxy(
  { app, BrowserWindow: { getAllWindows: () => [] }, safeStorage: { isEncryptionAvailable: () => false }, shell: {}, dialog: {} },
  { get: (t, k) => (k in t ? t[k] : new Proxy(noop, { get: () => noop })) }
)
