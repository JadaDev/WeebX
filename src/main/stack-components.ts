import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { access, readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import type { RuntimeSettings, StackComponent } from '../shared/types'
import { APACHE_VERSION, MARIADB_VERSION, PHPMYADMIN_VERSION } from '../shared/version'
import { runtimePaths } from './paths'

const execFileAsync = promisify(execFile)

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true } catch { return false }
}

export const STACK_PRESERVE: Record<'apache' | 'mariadb' | 'phpmyadmin', string[]> = {
  apache: ['conf', 'logs'],
  mariadb: ['data', 'my.ini'],
  phpmyadmin: ['config.inc.php', 'tmp', 'upload', 'save']
}

export function compareSemver(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' })
}

export function stackComponentStatus(present: boolean, installedVersion: string | null, offeredVersion: string): StackComponent['status'] {
  if (!present) return 'missing'
  if (!installedVersion) return 'installed'
  return compareSemver(installedVersion, offeredVersion) < 0 ? 'outdated' : 'installed'
}

export function preserveDuringUpdate(sourceRoot: string, filePath: string, names: string[]): boolean {
  const rel = relative(sourceRoot, filePath)
  if (!rel || rel === '.') return true
  return !names.includes(rel.split(/[/\\]/)[0])
}

export function parsePhpMyAdminVersion(source: string): string | null {
  const major = source.match(/public const MAJOR = (\d+)/)?.[1]
  const minor = source.match(/public const MINOR = (\d+)/)?.[1]
  const patch = source.match(/public const PATCH = (\d+)/)?.[1]
  if (major && minor && patch) return `${major}.${minor}.${patch}`
  return source.match(/VERSION = '(\d+\.\d+\.\d+)/)?.[1] ?? null
}

export async function isPhpMyAdminInstall(root: string): Promise<boolean> {
  return exists(join(root, 'libraries', 'classes', 'Version.php'))
}

export async function mariaDbHasData(dataDir: string): Promise<boolean> {
  try {
    const entries = await readdir(dataDir)
    return entries.some((name) => name === 'mysql' || name === 'ibdata1' || name === 'aria_log_control')
  } catch {
    return false
  }
}

async function toolVersion(executable: string, args: string[]): Promise<string | null> {
  try {
    if (!(await exists(executable))) return null
    const { stdout, stderr } = await execFileAsync(executable, args, { windowsHide: true, timeout: 4000 })
    return `${stdout}\n${stderr}`.match(/(\d+\.\d+\.\d+)/)?.[1] ?? null
  } catch {
    return null
  }
}

export async function inspectStackComponents(settings: RuntimeSettings): Promise<StackComponent[]> {
  const paths = runtimePaths(settings)
  const apachePresent = await exists(paths.apacheExe)
  const apacheVersion = apachePresent ? await toolVersion(paths.apacheExe, ['-v']) : null
  const mariadbPresent = await exists(paths.mariadbExe)
  const mariadbVersion = mariadbPresent ? await toolVersion(paths.mariadbExe, ['--version']) : null
  const phpMyAdminPresent = await isPhpMyAdminInstall(paths.phpMyAdmin)
  let phpMyAdminVersion: string | null = null
  if (phpMyAdminPresent) {
    try { phpMyAdminVersion = parsePhpMyAdminVersion(await readFile(join(paths.phpMyAdmin, 'libraries', 'classes', 'Version.php'), 'utf8')) }
    catch { phpMyAdminVersion = null }
  }
  return [
    { id: 'apache', installedVersion: apacheVersion, offeredVersion: APACHE_VERSION, status: stackComponentStatus(apachePresent, apacheVersion, APACHE_VERSION) },
    { id: 'mariadb', installedVersion: mariadbVersion, offeredVersion: MARIADB_VERSION, status: stackComponentStatus(mariadbPresent, mariadbVersion, MARIADB_VERSION) },
    { id: 'phpmyadmin', installedVersion: phpMyAdminVersion, offeredVersion: PHPMYADMIN_VERSION, status: stackComponentStatus(phpMyAdminPresent, phpMyAdminVersion, PHPMYADMIN_VERSION) }
  ]
}
