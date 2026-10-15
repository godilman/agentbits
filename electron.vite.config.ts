import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    // Parsers are bundled (not loaded from node_modules) so the extraction worker is self-contained.
    plugins: [externalizeDepsPlugin({ exclude: ['unpdf', 'fflate', 'papaparse', 'cfb', 'word-extractor'] })],
    resolve: { alias: { '@shared': resolve('src/shared') } },
    build: {
      rollupOptions: {
        // The MCP stdio server Claude Code spawns for connection tools (see connections/bridge.ts).
        input: {
          index: resolve('src/main/index.ts'),
          'mcp-connections': resolve('src/main/mcp/server.ts'),
          // Text extraction for attachments, run in a worker thread with memory / time limits (files/service.ts).
          'files-worker': resolve('src/main/files/worker.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [
      react(),
      {
        // The dev server needs ws: / localhost for hot reload; production builds get the strict policy.
        name: 'agentbits-csp',
        transformIndexHtml: {
          order: 'pre',
          handler: (html, ctx) => (ctx.server ? html : html.replace(" ws: http://localhost:*", ''))
        }
      }
    ],
    // Bind to IPv4 explicitly: on some Windows setups "localhost" resolves to ::1 on one
    // side and 127.0.0.1 on the other, and Electron times out loading the dev server.
    server: { host: '127.0.0.1', port: 5173 }
  }
})
