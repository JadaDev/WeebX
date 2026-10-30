import { readFile, writeFile } from 'node:fs/promises'

const MANAGED_BLOCK = /(?:\r?\n)?# BEGIN WEEBX HOST [0-9a-f-]+\r?\n[\s\S]*?# END WEEBX HOST [0-9a-f-]+(?:\r?\n)?/gi

export function windowsHostsPath(): string {
  return `${process.env.SystemRoot || 'C:\\Windows'}\\System32\\drivers\\etc\\hosts`
}

export function stripWeebxHostBlocks(content: string): string {
  return content.replace(MANAGED_BLOCK, '\r\n')
}

export async function removeAllWeebxHostBlocks(): Promise<boolean> {
  if (process.platform !== 'win32') return false
  const file = windowsHostsPath()
  const current = await readFile(file, 'utf8')
  const next = stripWeebxHostBlocks(current)
  if (next === current) return false
  await writeFile(file, next, 'utf8')
  return true
}
