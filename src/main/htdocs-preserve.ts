import { access, cp, mkdir, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export function htdocsKeepDestination(documentsDir = join(homedir(), 'Documents')): string {
  return join(documentsDir, 'WeebX Sites')
}

export function shouldCopyHtdocsEntry(name: string): boolean {
  return name.toLowerCase() !== 'phpmyadmin'
}

export async function preserveHtdocs(htdocsRoot: string, destination = htdocsKeepDestination()): Promise<string> {
  await mkdir(destination, { recursive: true })
  try { await access(htdocsRoot) } catch { return destination }
  let copied = 0
  const entries = await readdir(htdocsRoot, { withFileTypes: true })
  for (const entry of entries) {
    if (!shouldCopyHtdocsEntry(entry.name)) continue
    await cp(join(htdocsRoot, entry.name), join(destination, entry.name), { recursive: true, force: true })
    copied += 1
  }
  if (!copied) await mkdir(destination, { recursive: true })
  return destination
}
