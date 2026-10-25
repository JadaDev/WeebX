import { access, chmod, copyFile, mkdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true } catch { return false }
}

export async function clearReadonly(path: string): Promise<void> {
  try {
    const info = await stat(path)
    await chmod(path, info.mode | 0o666)
  } catch { /* missing or already writable */ }
}

export async function backupFile(path: string): Promise<void> {
  if (!(await exists(path))) return
  const bak = `${path}.weebx.bak`
  await clearReadonly(bak)
  try { await unlink(bak) } catch { /* first backup */ }
  try {
    await copyFile(path, bak)
  } catch {
    // A locked or permission-denied backup must never block writing the live config.
  }
}

export async function writeTextFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporary, content, 'utf8')
  try {
    await rename(temporary, path)
    return
  } catch { /* replace in place on Windows when the target exists */ }
  await clearReadonly(path)
  try { await unlink(path) } catch { /* dest may already be gone */ }
  try {
    await rename(temporary, path)
  } catch {
    try {
      await copyFile(temporary, path)
    } catch {
      await writeFile(path, content, 'utf8')
    }
    await unlink(temporary).catch(() => undefined)
  }
}

export async function backupAndWrite(path: string, content: string): Promise<void> {
  await backupFile(path)
  await writeTextFile(path, content)
}

export function isBusyFileError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code
  return code === 'EPERM' || code === 'EACCES' || code === 'EBUSY'
}

export async function copyFileBestEffort(source: string, destination: string): Promise<void> {
  if (await exists(destination)) {
    try {
      const [from, to] = await Promise.all([stat(source), stat(destination)])
      if (from.size === to.size) return
    } catch {
      return
    }
  }
  await mkdir(dirname(destination), { recursive: true })
  await clearReadonly(destination)
  try {
    await copyFile(source, destination)
  } catch (error) {
    if (isBusyFileError(error)) return
    throw error
  }
}

export async function ensureDirectory(path: string): Promise<void> {
  try {
    const info = await stat(path)
    if (info.isDirectory()) return
    await clearReadonly(path)
    await rename(path, `${path}.weebx-file.bak`).catch(async () => { await unlink(path) })
  } catch {
    // path does not exist yet
  }
  try {
    await mkdir(path, { recursive: true })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EEXIST' || code === 'ENOTDIR' || code === 'EPERM') {
      try {
        const info = await stat(path)
        if (info.isDirectory()) return
        await clearReadonly(path)
        await unlink(path).catch(() => rename(path, `${path}.weebx-file.bak`))
        await mkdir(path, { recursive: true })
        return
      } catch { /* fall through */ }
    }
    throw error
  }
}
