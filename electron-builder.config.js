// electron-builder configuration (Windows NSIS installer + macOS DMG).
// Only the installers are produced: no auto-update files (latest*.yml, .blockmap) and no macOS ZIP — the app has no
// updater, and releases are downloaded by hand from GitHub.
// .js so signing can be switched on from environment variables (local machine or CI secrets):
//
//   Windows  WIN_CERT_SUBJECT            certificate subject in the Windows cert store (signtool)
//            or CSC_LINK + CSC_KEY_PASSWORD  .pfx file (read by electron-builder itself)
//   macOS    CSC_LINK + CSC_KEY_PASSWORD   "Developer ID Application" certificate (.p12)
//            APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER   notarization (App Store Connect API key)
//            or APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID
//
// Without these the builds still work but are unsigned (Windows SmartScreen / macOS Gatekeeper warnings);
// see docs/DEVELOPMENT.md → "Dağıtım paketleri".

// CI passes unset secrets as empty strings; electron-builder would read an empty CSC_LINK as a file path
// ("<repo> not a file"). Treat empty as unset.
for (const k of ['CSC_LINK', 'CSC_KEY_PASSWORD', 'CSC_NAME', 'WIN_CERT_SUBJECT', 'APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID', 'APPLE_KEYCHAIN_PROFILE']) {
  if (process.env[k] !== undefined && process.env[k].trim() === '') delete process.env[k]
}

const certSubject = process.env.WIN_CERT_SUBJECT || null
const macCert = !!(process.env.CSC_LINK || process.env.CSC_NAME)
const macNotarize = !!(process.env.APPLE_API_KEY || process.env.APPLE_ID || process.env.APPLE_KEYCHAIN_PROFILE)

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'app.agentbits.desktop',
  productName: 'Agentbits',
  copyright: 'Copyright © 2026 Gökhan Dilman',
  directories: {
    output: 'release',
    buildResources: 'build-resources'
  },
  files: [
    'out/**/*',
    'package.json',
    // OCR cores: tesseract.js 7.0.0 (pinned) passes a boolean to getCore() and so always loads the non "-lstm" builds
    // (they run LSTM too); the "-lstm" builds are never used. Re-check with a packaged build when upgrading tesseract.js.
    // The larger "4.0.0" language models are never loaded either (best_int is used).
    '!**/node_modules/tesseract.js-core/tesseract-core{,-simd,-relaxedsimd}-lstm.{js,wasm,wasm.js}',
    '!**/node_modules/@tesseract.js-data/*/4.0.0/**'
  ],
  // License texts next to the app (resources/): ours and the bundled open-source packages'.
  extraResources: [
    { from: 'LICENSE', to: 'LICENSE.txt' },
    { from: 'THIRD_PARTY_NOTICES.md', to: 'THIRD_PARTY_NOTICES.md' }
  ],
  // OCR (tesseract.js) starts its own worker thread from a script path, so it and its runtime dependencies live outside
  // the asar; the language data is copied to the data folder at first use (files/service.ts → ocrLangPath).
  asarUnpack: [
    '**/node_modules/better-sqlite3/**',
    '**/node_modules/@lydell/node-pty*/**',
    'out/main/mcp-connections.js',
    'out/main/files-worker.js',
    'out/main/chunks/**',
    '**/node_modules/{tesseract.js,tesseract.js-core,bmp-js,idb-keyval,is-url,node-fetch,regenerator-runtime,tr46,wasm-feature-detect,webidl-conversions,whatwg-url,zlibjs}/**'
  ],
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'build-resources/icon.ico',
    artifactName: 'Agentbits-Setup-${version}.${ext}',
    verifyUpdateCodeSignature: !!certSubject,
    ...(certSubject && {
      signtoolOptions: {
        certificateSubjectName: certSubject,
        signingHashAlgorithms: ['sha256'],
        rfc3161TimeStampServer: 'http://timestamp.digicert.com'
      }
    })
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    allowElevation: true,
    installerIcon: 'build-resources/icon.ico',
    uninstallerIcon: 'build-resources/icon.ico',
    installerHeaderIcon: 'build-resources/icon.ico',
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'Agentbits',
    runAfterFinish: true,
    deleteAppDataOnUninstall: false,
    license: 'LICENSE',
    differentialPackage: false // no .blockmap
  },
  mac: {
    // Separate Apple Silicon and Intel builds (native modules are per architecture).
    target: [{ target: 'dmg', arch: ['arm64', 'x64'] }],
    icon: 'build-resources/icon.icns',
    category: 'public.app-category.developer-tools',
    artifactName: 'Agentbits-${version}-${arch}.${ext}',
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: 'build-resources/entitlements.mac.plist',
    entitlementsInherit: 'build-resources/entitlements.mac.plist',
    // With a Developer ID certificate: real signature (+ notarization when Apple credentials are set).
    // Without one: ad-hoc signature, which Apple Silicon needs to launch the app at all.
    ...(macCert ? {} : { identity: '-' }),
    notarize: macCert && macNotarize
  },
  dmg: {
    title: 'Agentbits ${version}',
    writeUpdateInfo: false // no .blockmap
  },
  // Explicitly null: when unset, electron-builder derives a GitHub config from package.json "repository" and still
  // writes latest.yml / app-update.yml.
  publish: null,
  npmRebuild: false
}
