import { app } from 'electron'
import { createRequire } from 'node:module'
import { promises as nodeFs } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { WEEBX_VERSION } from '../shared/version'
import type { PortalOptions, PortalProgress, RuntimeSettings, VirtualHost } from '../shared/types'

const require = createRequire(import.meta.url)

function diskFs(): typeof nodeFs {
  try { return require('original-fs').promises as typeof nodeFs }
  catch { return nodeFs }
}

export interface PortalManifest {
  kind: 'weebx-portal'
  version: string
  packedAt: string
  includeDb: boolean
  includeHtdocs: boolean
}

export function portalLaunchScript(): string {
  return [
    '@echo off',
    'setlocal EnableExtensions',
    'cd /d "%~dp0"',
    'if not exist "%~dp0WeebX.exe" (',
    '  echo WeebX.exe is missing from this portal folder.',
    '  pause',
    '  exit /b 1',
    ')',
    'start "" "%~dp0WeebX.exe" "--weebx-data-dir=%~dp0data" --repair-location',
    'exit /b 0',
    ''
  ].join('\r\n')
}

export function normalizePortalPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase()
}

export function shouldPackAppFile(relativePath: string): boolean {
  const path = normalizePortalPath(relativePath)
  if (!path || path === '.') return false
  if (path === 'data' || path.startsWith('data/')) return false
  if (path === 'resources/runtime' || path.startsWith('resources/runtime/')) return false
  if (path.endsWith('.log')) return false
  return true
}

export function isAsarArchive(name: string): boolean {
  return name.toLowerCase().endsWith('.asar')
}

export function shouldPackRuntimeFile(relativePath: string, options: PortalOptions): boolean {
  const path = normalizePortalPath(relativePath)
  if (path.startsWith('mariadb/data/') || path === 'mariadb/data' || path.startsWith('mariadb/data')) return options.includeDb
  if (path.startsWith('htdocs/') || path === 'htdocs') {
    if (options.includeHtdocs) return true
    return path === 'htdocs' || path.startsWith('htdocs/phpmyadmin/') || path === 'htdocs/phpmyadmin'
  }
  return true
}

export function isPortalManifest(value: unknown): value is PortalManifest {
  return Boolean(value && typeof value === 'object' && (value as PortalManifest).kind === 'weebx-portal')
}

async function exists(path: string): Promise<boolean> {
  try { await diskFs().access(path); return true } catch { return false }
}

interface PackedFile { source: string; destination: string; size: number }

async function walkFiles(root: string): Promise<{ abs: string; rel: string; size: number }[]> {
  const fs = diskFs()
  const out: { abs: string; rel: string; size: number }[] = []
  const visit = async (dir: string): Promise<void> => {
    let entries
    try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const abs = join(dir, entry.name)
      if (isAsarArchive(entry.name)) {
        try {
          const info = await fs.stat(abs)
          out.push({ abs, rel: relative(root, abs), size: info.size })
        } catch { /* skip unreadable asar */ }
        continue
      }
      if (entry.isDirectory()) {
        await visit(abs)
        continue
      }
      try {
        const info = await fs.stat(abs)
        if (info.isDirectory()) await visit(abs)
        else out.push({ abs, rel: relative(root, abs), size: info.size })
      } catch { /* skip unreadable */ }
    }
  }
  await visit(root)
  return out
}

async function copyPackedFile(source: string, destination: string): Promise<void> {
  const fs = diskFs()
  await fs.mkdir(dirname(destination), { recursive: true })
  await fs.copyFile(source, destination)
}

function appSourceDir(): string {
  if (app.isPackaged) return dirname(process.execPath)
  return join(app.getAppPath(), 'dist', 'win-unpacked')
}

export async function resolvePortalSource(selected: string): Promise<string> {
  const direct = resolve(selected)
  if (await exists(join(direct, 'weebx-portal.json'))) return direct
  const nested = join(direct, 'WeebX-Portal')
  if (await exists(join(nested, 'weebx-portal.json'))) return nested
  throw new Error('Choose a WeebX Portal folder (it contains weebx-portal.json).')
}

export async function packPortal(
  destinationParent: string,
  settings: RuntimeSettings,
  virtualHosts: VirtualHost[],
  options: PortalOptions,
  onProgress: (progress: PortalProgress) => void
): Promise<{ folder: string }> {
  const appDir = appSourceDir()
  if (!(await exists(join(appDir, 'WeebX.exe')))) throw new Error('WeebX.exe was not found to pack. Install WeebX, then pack from the installed app.')
  const stamp = new Date().toISOString().slice(0, 10)
  let folder = join(resolve(destinationParent), 'WeebX-Portal')
  if (await exists(folder)) folder = join(resolve(destinationParent), `WeebX-Portal-${stamp}`)
  const fs = diskFs()
  await fs.mkdir(folder, { recursive: true })
  const dataRoot = join(folder, 'data')
  const runtimeDest = join(dataRoot, 'runtime')
  await fs.mkdir(runtimeDest, { recursive: true })

  const files: PackedFile[] = []
  for (const file of await walkFiles(appDir)) {
    if (!shouldPackAppFile(file.rel)) continue
    files.push({ source: file.abs, destination: join(folder, file.rel), size: file.size })
  }
  for (const file of await walkFiles(settings.runtimeRoot)) {
    if (!shouldPackRuntimeFile(file.rel, options)) continue
    files.push({ source: file.abs, destination: join(runtimeDest, file.rel), size: file.size })
  }

  const totalFiles = files.length
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0)
  let completedFiles = 0
  let completedBytes = 0
  onProgress({ phase: 'scanning', percent: 4, message: 'Opening the portal', detail: `${totalFiles.toLocaleString()} files to pack`, completedFiles, totalFiles })

  for (const file of files) {
    await copyPackedFile(file.source, file.destination)
    completedFiles += 1
    completedBytes += file.size
    if (completedFiles === totalFiles || completedFiles % 25 === 0) {
      onProgress({
        phase: 'copying',
        percent: Math.min(94, 6 + Math.round((completedBytes / Math.max(1, totalBytes)) * 88)),
        message: 'Folding WeebX into the portal',
        detail: file.destination.split(sep).slice(-2).join('\\'),
        completedFiles,
        totalFiles
      })
    }
  }

  if (!options.includeHtdocs) await fs.mkdir(join(runtimeDest, 'htdocs'), { recursive: true })
  if (!options.includeDb) await fs.mkdir(join(runtimeDest, 'mariadb', 'data'), { recursive: true })

  const { mariadbPassword: _credentialNotExported, ...settingsWithoutCredential } = settings
  const portableSettings = {
    ...settingsWithoutCredential,
    runtimeRoot: join(dataRoot, 'runtime'),
    htdocsRoot: join(dataRoot, 'runtime', 'htdocs'),
    setupComplete: false
  }
  await fs.writeFile(join(dataRoot, 'weebx.json'), JSON.stringify({ settings: portableSettings, virtualHosts }, null, 2), 'utf8')
  const manifest: PortalManifest = {
    kind: 'weebx-portal',
    version: WEEBX_VERSION,
    packedAt: new Date().toISOString(),
    includeDb: options.includeDb,
    includeHtdocs: options.includeHtdocs
  }
  await fs.writeFile(join(folder, 'weebx-portal.json'), JSON.stringify(manifest, null, 2), 'utf8')
  await fs.writeFile(join(folder, 'Launch WeebX.bat'), portalLaunchScript(), 'utf8')
  await fs.writeFile(join(folder, 'README-PORTAL.txt'), [
    'WeebX Portal',
    `Packed with WeebX ${WEEBX_VERSION}`,
    `Databases: ${options.includeDb ? 'included' : 'fresh empty MariaDB on first launch'}`,
    `Websites (htdocs): ${options.includeHtdocs ? 'included' : 'phpMyAdmin only'}`,
    '',
    'Copy this whole folder anywhere, then double-click Launch WeebX.bat.',
    'For security, database credentials are never exported. Complete security setup on the destination PC.',
    'WeebX will repair Apache, MariaDB, PHP, and virtual-host paths for the new location.',
    ''
  ].join('\r\n'), 'utf8')
  onProgress({ phase: 'complete', percent: 100, message: 'Portal ready', detail: folder, completedFiles, totalFiles })
  return { folder }
}

export async function unpackPortal(
  source: string,
  destinationParent: string,
  onProgress: (progress: PortalProgress) => void
): Promise<{ folder: string }> {
  const origin = await resolvePortalSource(source)
  const raw = JSON.parse(await diskFs().readFile(join(origin, 'weebx-portal.json'), 'utf8')) as unknown
  if (!isPortalManifest(raw)) throw new Error('That folder is not a WeebX Portal.')
  let folder = join(resolve(destinationParent), 'WeebX-Portal')
  if (await exists(folder)) folder = join(resolve(destinationParent), `WeebX-Portal-${new Date().toISOString().slice(0, 10)}`)
  await diskFs().mkdir(folder, { recursive: true })
  const files = await walkFiles(origin)
  const totalFiles = files.length
  let completedFiles = 0
  onProgress({ phase: 'scanning', percent: 5, message: 'Reading the portal', detail: origin, completedFiles, totalFiles })
  for (const file of files) {
    const destination = join(folder, file.rel)
    await copyPackedFile(file.abs, destination)
    completedFiles += 1
    if (completedFiles === totalFiles || completedFiles % 25 === 0) {
      onProgress({
        phase: 'copying',
        percent: Math.min(96, 8 + Math.round((completedFiles / Math.max(1, totalFiles)) * 88)),
        message: 'Stepping out of the portal',
        detail: file.rel,
        completedFiles,
        totalFiles
      })
    }
  }
  onProgress({ phase: 'complete', percent: 100, message: 'Portal unpacked', detail: folder, completedFiles, totalFiles })
  return { folder }
}
