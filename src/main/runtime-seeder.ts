import { app } from 'electron'
import { access, copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { spawn } from 'node:child_process'
import type { PreparationProgress } from '../shared/types'
import type { JsonStore } from './store'
import type { LogBuffer } from './logs'
import { runtimePaths } from './paths'
import { copySpeed, estimateRemainingSeconds } from './preparation-progress'
import { prepareRuntimeDirectories } from './runtime-copy'

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true } catch { return false }
}

function abortError(): Error {
  return Object.assign(new Error('WeebX preparation was cancelled.'), { name: 'AbortError' })
}

function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError()
}

function isAbort(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'name' in error && (error as { name?: string }).name === 'AbortError')
}

interface BundleManifest { version: string; phpVersions: string[] }
interface RuntimeFile { source: string; destination: string; size: number; group: string; relativePath: string }
interface SeedOptions { signal?: AbortSignal; onProgress?: (progress: PreparationProgress) => void }

const MARIADB_SETUP_SECONDS = 150

export class RuntimeSeeder {
  constructor(private readonly store: JsonStore, private readonly logs: LogBuffer) {}

  async seed(options: SeedOptions = {}): Promise<boolean> {
    const { signal, onProgress = () => undefined } = options
    const startedAt = Date.now()
    const packagedSource = join(process.resourcesPath, 'runtime')
    const developmentSource = join(app.getAppPath(), 'resources', 'runtime')
    const source = await exists(join(packagedSource, 'bundle-manifest.json')) ? packagedSource : developmentSource
    const manifestFile = join(source, 'bundle-manifest.json')
    if (!(await exists(manifestFile))) return false
    const manifestText = (await readFile(manifestFile, 'utf8')).replace(/^\uFEFF/, '')
    const manifest = JSON.parse(manifestText) as BundleManifest
    const settings = await this.store.getSettings()
    const target = runtimePaths(settings)
    const marker = join(target.root, '.weebx-bundle-version')
    let current = ''
    try { current = (await readFile(marker, 'utf8')).trim() } catch { /* first run */ }

    const baseProgress = (partial: Partial<PreparationProgress>): PreparationProgress => ({
      phase: 'scanning', percent: 0, message: 'Inspecting the offline runtime', detail: 'Locating bundled components...',
      completedFiles: 0, totalFiles: 0, completedBytes: 0, totalBytes: 0,
      elapsedSeconds: Math.max(0, Math.floor((Date.now() - startedAt) / 1000)), etaSeconds: null, speedBytesPerSecond: 0,
      ...partial
    })
    onProgress(baseProgress({ percent: 1 }))
    checkAborted(signal)
    if (current === manifest.version) {
      if (!(await exists(join(target.mariadbData, 'mysql')))) {
        onProgress(baseProgress({ phase: 'database', percent: 90, message: 'Initializing MariaDB', detail: 'This portal has no database yet.' }))
        if (await this.initializeMariaDb(target.mariadb, target.mariadbData, signal, (detail) => {
          onProgress(baseProgress({ phase: 'database', percent: 92, message: 'Initializing MariaDB', detail }))
        })) await this.store.updateSettings({ mariadbPassword: '' })
      }
      onProgress(baseProgress({ percent: 88, message: 'Runtime files are already installed', detail: `Bundle ${manifest.version} is ready.` }))
      return false
    }

    this.logs.add('system', 'info', `Preparing bundled WeebX runtime ${manifest.version}...`)
    await mkdir(target.root, { recursive: true })
    const groups = [
      { name: 'Apache', source: join(source, 'apache'), destination: target.apache },
      { name: 'MariaDB', source: join(source, 'mariadb'), destination: target.mariadb },
      { name: 'Website and phpMyAdmin', source: join(source, 'htdocs'), destination: target.htdocs },
      ...manifest.phpVersions.map((version) => ({ name: `PHP ${version}`, source: join(source, 'php', version), destination: join(target.php, version) }))
    ]
    const files: RuntimeFile[] = []
    for (const group of groups) {
      checkAborted(signal)
      onProgress(baseProgress({
        percent: Math.min(6, 1 + files.length / 2500),
        message: 'Scanning the offline runtime',
        detail: `Indexing ${group.name}... ${files.length.toLocaleString()} files found`
      }))
      await this.collectFiles(group.source, group.destination, group.name, files, signal)
    }
    checkAborted(signal)
    onProgress(baseProgress({
      percent: 6,
      message: 'Preparing runtime folders',
      detail: 'Creating the Apache, MariaDB, PHP, and website directory tree...',
      totalFiles: files.length
    }))
    await prepareRuntimeDirectories(files.map((file) => file.destination))

    const totalBytes = files.reduce((sum, file) => sum + file.size, 0)
    let completedBytes = 0
    let completedFiles = 0
    let cursor = 0
    let lastUpdate = 0
    const copyStartedAt = Date.now()
    const reportCopy = (file: RuntimeFile, force = false) => {
      const now = Date.now()
      if (!force && now - lastUpdate < 120) return
      lastUpdate = now
      const elapsedSeconds = Math.max(0, Math.floor((now - startedAt) / 1000))
      const etaSeconds = estimateRemainingSeconds({
        startedAt: copyStartedAt, now, completedBytes, totalBytes, completedFiles, totalFiles: files.length,
        extraSeconds: MARIADB_SETUP_SECONDS
      })
      onProgress(baseProgress({
        phase: 'copying', percent: Math.min(88, Math.round(6 + ((totalBytes ? completedBytes / totalBytes : 0) * 0.35 + (completedFiles / Math.max(1, files.length)) * 0.65) * 82)),
        message: `Copying ${file.group}`,
        detail: file.relativePath,
        completedFiles, totalFiles: files.length, completedBytes, totalBytes,
        elapsedSeconds, etaSeconds, speedBytesPerSecond: copySpeed(copyStartedAt, now, completedBytes)
      }))
    }
    const worker = async () => {
      try {
        while (true) {
          const index = cursor++
          if (index >= files.length) return
          checkAborted(signal)
          const file = files[index]
          if (!(await exists(file.destination))) {
            await copyFile(file.source, file.destination)
          }
          completedBytes += file.size
          completedFiles += 1
          reportCopy(file, completedFiles === files.length)
        }
      } catch (error) {
        if (signal?.aborted || isAbort(error)) return
        throw error
      }
    }
    await Promise.all(Array.from({ length: Math.min(8, Math.max(1, files.length)) }, () => worker()))
    checkAborted(signal)

    await mkdir(join(target.apache, 'logs'), { recursive: true })
    if (await this.initializeMariaDb(target.mariadb, target.mariadbData, signal, (detail, elapsedInPhase) => {
      onProgress(baseProgress({
        phase: 'database', percent: 91, message: 'Initializing MariaDB',
        detail,
        completedFiles, totalFiles: files.length, completedBytes, totalBytes,
        etaSeconds: Math.max(15, MARIADB_SETUP_SECONDS - elapsedInPhase),
        speedBytesPerSecond: copySpeed(copyStartedAt, Date.now(), completedBytes)
      }))
    })) await this.store.updateSettings({ mariadbPassword: '' })
    checkAborted(signal)
    await writeFile(marker, manifest.version, 'utf8')
    this.logs.add('system', 'info', 'The offline Apache, MariaDB, phpMyAdmin, and PHP runtimes are ready.')
    onProgress(baseProgress({
      phase: 'database', percent: 95, message: 'Runtime installed', detail: 'MariaDB and all bundled server files are ready.',
      completedFiles, totalFiles: files.length, completedBytes, totalBytes, etaSeconds: 2
    }))
    return true
  }

  private async collectFiles(sourceRoot: string, destinationRoot: string, group: string, result: RuntimeFile[], signal?: AbortSignal): Promise<void> {
    if (!(await exists(sourceRoot))) return
    const visit = async (source: string, destination: string): Promise<void> => {
      checkAborted(signal)
      for (const entry of await readdir(source, { withFileTypes: true })) {
        checkAborted(signal)
        const from = join(source, entry.name)
        const to = join(destination, entry.name)
        if (entry.isDirectory()) await visit(from, to)
        else if (entry.isFile()) result.push({ source: from, destination: to, size: (await stat(from)).size, group, relativePath: relative(sourceRoot, from) })
      }
    }
    await visit(sourceRoot, destinationRoot)
  }

  private async initializeMariaDb(
    root: string,
    data: string,
    signal: AbortSignal | undefined,
    onHeartbeat: (detail: string, elapsedSeconds: number) => void
  ): Promise<boolean> {
    if (await exists(join(data, 'mysql'))) return false
    const setup = join(root, 'bin', 'mariadb-install-db.exe')
    if (!(await exists(setup))) return false
    checkAborted(signal)
    await mkdir(data, { recursive: true })
    const startedAt = Date.now()
    onHeartbeat('Creating system tables. This often takes 1-4 minutes...', 0)
    await new Promise<void>((resolve, reject) => {
      const child = spawn(setup, [`--datadir=${data}`, '--password='], { cwd: root, windowsHide: true })
      let output = ''
      let settled = false
      const heartbeat = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startedAt) / 1000)
        const lastLine = output.trim().split(/\r?\n/).filter(Boolean).at(-1)
        onHeartbeat(lastLine || `Still creating MariaDB system tables (${elapsed}s elapsed)...`, elapsed)
      }, 700)
      const finish = (error?: Error) => {
        if (settled) return
        settled = true
        clearInterval(heartbeat)
        signal?.removeEventListener('abort', cancel)
        error ? reject(error) : resolve()
      }
      const cancel = () => { child.kill(); finish(abortError()) }
      signal?.addEventListener('abort', cancel, { once: true })
      child.stdout.on('data', (chunk) => { output += chunk })
      child.stderr.on('data', (chunk) => { output += chunk })
      child.once('error', (error) => finish(error))
      child.once('close', (code) => code === 0 ? finish() : finish(new Error(`MariaDB initialization failed: ${output.trim() || `exit ${code}`}`)))
    })
    return true
  }
}
