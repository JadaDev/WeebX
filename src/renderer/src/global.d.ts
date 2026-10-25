/// <reference types="vite/client" />

import type { WeebXApi } from '../../shared/types'

declare global {
  interface Window {
    weebx: WeebXApi
  }
}

export {}
