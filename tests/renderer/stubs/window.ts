// The renderer modules expect a browser window (imported first by every renderer test).
;(globalThis as any).window = { addEventListener: () => undefined }
