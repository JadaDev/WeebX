import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export function directoryFromModuleUrl(moduleUrl: string): string {
  return fileURLToPath(new URL('.', moduleUrl))
}

export function outFile(appPath: string, ...segments: string[]): string {
  return join(appPath, 'out', ...segments)
}

export function preloadScript(appPath: string): string {
  return outFile(appPath, 'preload', 'index.js')
}

export function rendererIndex(appPath: string): string {
  return outFile(appPath, 'renderer', 'index.html')
}

export function bundledFile(moduleUrl: string, ...segments: string[]): string {
  return join(directoryFromModuleUrl(moduleUrl), ...segments)
}
