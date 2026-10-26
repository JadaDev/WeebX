import { execFile } from 'node:child_process'
import { access, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { PermissionPreset, PermissionResult, PermissionTarget, RuntimeSettings } from '../shared/types'
import { runtimePaths } from './paths'

const execFileAsync = promisify(execFile)

async function currentUserSid(): Promise<string> {
  if (process.platform !== 'win32') throw new Error('NTFS permission presets are available on Windows only.')
  const { stdout } = await execFileAsync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { windowsHide: true })
  const match = stdout.match(/S-1-(?:\d+-)+\d+/)
  if (!match) throw new Error('WeebX could not identify the current Windows account.')
  return `*${match[0]}`
}

function targetPath(settings: RuntimeSettings, target: PermissionTarget): string {
  const paths = runtimePaths(settings)
  return target === 'runtime' ? paths.root : target === 'htdocs' ? paths.htdocs : paths.mariadbData
}

async function icacls(path: string, args: string[]): Promise<void> {
  try {
    await execFileAsync('icacls.exe', [path, ...args], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Windows could not apply the permission preset. Run WeebX as administrator and try again. ${detail}`)
  }
}

async function resetDescendants(path: string): Promise<void> {
  if ((await readdir(path)).length === 0) return
  await icacls(join(path, '*'), ['/reset', '/T', '/C', '/Q'])
}

/**
 * Apply the private ACL to the root once, then make every child inherit it.
 * Applying an (OI)(CI)-only rule to every file with /T creates inherit-only
 * ACEs on files and can leave them unreadable, so these must be two commands.
 */
export async function applyPrivateTreePermissions(path: string): Promise<void> {
  const sid = await currentUserSid()
  await icacls(path, ['/inheritancelevel:r', '/grant:r', `${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F', '/Q'])
  await resetDescendants(path)
}

export async function applyPathPermissionPreset(path: string, preset: PermissionPreset): Promise<void> {
  await access(path).catch(() => { throw new Error('The selected folder does not exist yet.') })
  if (preset === 'private') {
    await applyPrivateTreePermissions(path)
  } else if (preset === 'writable') {
    const sid = await currentUserSid()
    await icacls(path, ['/inheritancelevel:e', '/grant:r', `${sid}:(OI)(CI)M`, '/Q'])
    await resetDescendants(path)
  } else {
    await icacls(path, ['/inheritancelevel:e', '/reset', '/Q'])
    await resetDescendants(path)
  }
}

export async function applyPermissionPreset(settings: RuntimeSettings, target: PermissionTarget, preset: PermissionPreset): Promise<PermissionResult> {
  const path = targetPath(settings, target)
  await access(path).catch(() => { throw new Error(`The ${target} folder does not exist yet.`) })

  await applyPathPermissionPreset(path, preset)

  const label = preset === 'private' ? 'Private owner-only' : preset === 'writable' ? 'Owner writable' : 'Windows inherited defaults'
  return { target, path, preset, message: `${label} permissions applied to ${path}.` }
}
