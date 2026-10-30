import { stat } from 'node:fs/promises'
import { dirname, isAbsolute, parse, relative, resolve } from 'node:path'

const MAX_PATH = 1000

export function assertPathInput(value: unknown): string {
  if (typeof value !== 'string' || value.length < 2 || value.length > MAX_PATH || value.includes('\0')) {
    throw new Error('Choose a valid folder path.')
  }
  return value
}

export function normalizeManagedPath(value: string): string {
  const trimmed = value.trim()
  const stripped = trimmed.replace(/[\\/]+$/, '')
  return resolve(stripped.length >= 2 ? stripped : trimmed)
}

function fold(path: string): string {
  return process.platform === 'win32' ? path.toLowerCase() : path
}

export function pathIsInside(root: string, candidate: string): boolean {
  if (!root?.trim() || !candidate?.trim()) return false
  const child = relative(fold(normalizeManagedPath(root)), fold(normalizeManagedPath(candidate)))
  return child === '' || (!child.startsWith('..') && !isAbsolute(child))
}

export function isManagedPath(candidate: string, roots: string[]): boolean {
  return roots.some((root) => pathIsInside(root, candidate))
}

export async function nearestExistingDirectory(path: string): Promise<string | undefined> {
  let current = normalizeManagedPath(assertPathInput(path))
  const { root } = parse(current)
  for (let i = 0; i < 32; i += 1) {
    try {
      if ((await stat(current)).isDirectory()) return current
    } catch { /* missing or not a directory */ }
    if (!root || fold(current) === fold(root) || current === dirname(current)) return undefined
    current = dirname(current)
  }
  return undefined
}

export async function resolveManagedDirectory(path: unknown, roots: string[]): Promise<string> {
  const resolved = normalizeManagedPath(assertPathInput(path))
  if (!isManagedPath(resolved, roots)) throw new Error('Path is outside the WeebX runtime.')
  try {
    const info = await stat(resolved)
    if (!info.isDirectory()) throw new Error('That path is not a folder.')
  } catch (error) {
    if (error instanceof Error && error.message === 'That path is not a folder.') throw error
    throw new Error('That folder does not exist.')
  }
  return resolved
}
