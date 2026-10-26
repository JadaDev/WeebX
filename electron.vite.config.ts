import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

const ESM_DIRNAME_SHIM = `
import { dirname as __weebx_dirname } from 'node:path';
import { fileURLToPath as __weebx_fileURLToPath } from 'node:url';
const __filename = import.meta.filename || __weebx_fileURLToPath(import.meta.url);
const __dirname = import.meta.dirname || __weebx_dirname(__filename);
`

function injectEsmDirnameShim(): Plugin {
  const apply = (code: string): string | null => {
    if (!/\b__dirname\b/.test(code) || /\b(?:const|let|var)\s+__dirname\b/.test(code) || code.includes(ESM_DIRNAME_SHIM)) return null
    return `${ESM_DIRNAME_SHIM}${code}`
  }
  return {
    name: 'weebx-esm-dirname-shim',
    generateBundle(_options, bundle) {
      for (const item of Object.values(bundle)) {
        if (item.type !== 'chunk') continue
        const next = apply(item.code)
        if (next) item.code = next
      }
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), injectEsmDirnameShim()],
    build: { lib: { entry: resolve('src/main/index.ts') } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: { entry: resolve('src/preload/index.ts') },
      rollupOptions: { output: { format: 'cjs', entryFileNames: 'index.js' } }
    }
  },
  renderer: {
    root: resolve('src/renderer'),
    plugins: [react()],
    resolve: { alias: { '@renderer': resolve('src/renderer'), '@shared': resolve('src/shared') } },
    build: { emptyOutDir: true }
  }
})
