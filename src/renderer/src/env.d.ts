/// <reference types="vite/client" />
import type { DetailedHTMLProps, HTMLAttributes } from 'react'
import type { PreloadBridge } from '../../shared/ipc'

declare global {
  interface Window {
    agentbits: PreloadBridge
  }
}

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      webview: DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string
        partition?: string
        allowpopups?: string
      }
    }
  }
}
export {}
