import { app } from 'electron'
import { access, copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { spawn } from 'node:child_process'
import type { PreparationProgress } from '../shared/types'
import type { JsonStore } from './store'
import type { LogBuffer } from './logs'
import { runtimePaths } from './paths'
import { copySpeed, estimateRemainingSeconds } from './preparation-progress'
import { prepareRuntimeDirectories, retryFileOperation, type FileRetryEvent } from './runtime-copy'
import { applyPrivateTreePermissions } from './permissions'

function missingFile(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'ENOENT')
}

async function exists(path: string, signal?: AbortSignal): Promise<boolean> {
  try {
    await retryFileOperation(() => access(path), { signal })
    return true
  } catch (error) {
    if (missingFile(error)) return false
    throw error
  }
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
    const baseProgress = (partial: Partial<PreparationProgress>): PreparationProgress => ({
      phase: 'scanning', percent: 0, message: 'Inspecting the offline runtime', detail: 'Locating bundled components...',
      completedFiles: 0, totalFiles: 0, completedBytes: 0, totalBytes: 0,
      elapsedSeconds: Math.max(0, Math.floor((Date.now() - startedAt) / 1000)), etaSeconds: null, speedBytesPerSecond: 0,
      ...partial
    })
    const retryStatus = (action: string, progress: Partial<PreparationProgress> = {}) => ({ attempt }: FileRetryEvent) => {
      if (attempt === 1 || attempt % 5 === 0) this.logs.add('system', 'warn', `${action} is temporarily locked; retrying (attempt ${attempt}).`)
      onProgress(baseProgress({
        ...progress,
        message: 'Waiting for Windows to release a file',
        detail: `${action}. Security software may still be scanning it. Retrying automatically (attempt ${attempt}); close this window to cancel.`
      }))
    }
    onProgress(baseProgress({ percent: 1, message: 'Inspecting the offline runtime', detail: 'Checking bundle and runtime access...' }))
    checkAborted(signal)
    const packagedSource = join(process.resourcesPath, 'runtime')
    const developmentSource = join(app.getAppPath(), 'resources', 'runtime')
    const source = await exists(join(packagedSource, 'bundle-manifest.json'), signal) ? packagedSource : developmentSource
    const manifestFile = join(source, 'bundle-manifest.json')
    if (!(await exists(manifestFile, signal))) return false
    const manifestText = (await retryFileOperation(() => readFile(manifestFile, 'utf8'), { signal })).replace(/^\uFEFF/, '')
    const manifest = JSON.parse(manifestText) as BundleManifest
    const settings = await this.store.getSettings()
    const target = runtimePaths(settings)
    const marker = join(target.root, '.weebx-bundle-version')
    let current = ''
    let permissionsRepaired = false
    try { current = (await retryFileOperation(() => readFile(marker, 'utf8'), {
      signal,
      onRetry: async (event) => {
        retryStatus('Reading the runtime installation marker', { percent: 1 })(event)
        const code = event.error && typeof event.error === 'object' && 'code' in event.error ? String((event.error as { code?: unknown }).code) : ''
        if (code !== 'EACCES' || permissionsRepaired) return
        permissionsRepaired = true
        onProgress(baseProgress({ percent: 1, message: 'Repairing runtime access', detail: 'Restoring safe owner permissions after an interrupted or older security setup...' }))
        await applyPrivateTreePermissions(target.root)
        this.logs.add('system', 'info', `Repaired private runtime permissions at ${target.root}.`)
      }
    })).trim() } catch (error) {
      if (!missingFile(error)) throw error
    }
    checkAborted(signal)
    if (current === manifest.version) {
      if (!(await exists(join(target.mariadbData, 'mysql'), signal))) {
        onProgress(baseProgress({ phase: 'database', percent: 90, message: 'Initializing MariaDB', detail: 'This portal has no database yet.' }))
        if (await this.initializeMariaDb(target.mariadb, target.mariadbData, signal, (detail) => {
          onProgress(baseProgress({ phase: 'database', percent: 92, message: 'Initializing MariaDB', detail }))
        })) {
          if (settings.mariadbPassword || settings.setupComplete) await this.store.updateSettings({ mariadbPassword: '', setupComplete: false })
          this.logs.add('system', 'warn', 'MariaDB system tables were initialized without a command-line password. Complete security setup before going live.')
        }
      }
      onProgress(baseProgress({ percent: 88, message: 'Runtime files are already installed', detail: `Bundle ${manifest.version} is ready.` }))
      return false
    }

    this.logs.add('system', 'info', `Preparing bundled WeebX runtime ${manifest.version}...`)
    await retryFileOperation(() => mkdir(target.root, { recursive: true }).then(() => undefined), {
      signal,
      onRetry: retryStatus('Creating the WeebX runtime folder')
    })
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
    await prepareRuntimeDirectories(files.map((file) => file.destination), {
      signal,
      onRetry: retryStatus('Creating the runtime folder tree', { percent: 6, totalFiles: files.length })
    })

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
          if (!(await exists(file.destination, signal))) {
            await retryFileOperation(() => copyFile(file.source, file.destination), {
              signal,
              onRetry: retryStatus(`Writing ${file.group}: ${file.relativePath}`, {
                phase: 'copying', percent: Math.min(88, Math.round(6 + (completedFiles / Math.max(1, files.length)) * 82)),
                completedFiles, totalFiles: files.length, completedBytes, totalBytes
              })
            })
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

    await retryFileOperation(() => mkdir(join(target.apache, 'logs'), { recursive: true }).then(() => undefined), {
      signal,
      onRetry: retryStatus('Preparing Apache logs', { percent: 89, completedFiles, totalFiles: files.length, completedBytes, totalBytes })
    })
    if (await this.initializeMariaDb(target.mariadb, target.mariadbData, signal, (detail, elapsedInPhase) => {
      onProgress(baseProgress({
        phase: 'database', percent: 91, message: 'Initializing MariaDB',
        detail,
        completedFiles, totalFiles: files.length, completedBytes, totalBytes,
        etaSeconds: Math.max(15, MARIADB_SETUP_SECONDS - elapsedInPhase),
        speedBytesPerSecond: copySpeed(copyStartedAt, Date.now(), completedBytes)
      }))
    })) {
      if (settings.mariadbPassword || settings.setupComplete) await this.store.updateSettings({ mariadbPassword: '', setupComplete: false })
      this.logs.add('system', 'warn', 'MariaDB system tables were initialized without a command-line password. Complete security setup before going live.')
    }
    checkAborted(signal)
    await retryFileOperation(() => writeFile(marker, manifest.version, 'utf8'), {
      signal,
      onRetry: retryStatus('Finishing runtime installation', { percent: 94, completedFiles, totalFiles: files.length, completedBytes, totalBytes })
    })
    this.logs.add('system', 'info', 'The offline Apache, MariaDB, phpMyAdmin, and PHP runtimes are ready.')
    onProgress(baseProgress({
      phase: 'database', percent: 95, message: 'Runtime installed', detail: 'MariaDB and all bundled server files are ready.',
      completedFiles, totalFiles: files.length, completedBytes, totalBytes, etaSeconds: 2
    }))
    return true
  }

  private async collectFiles(sourceRoot: string, destinationRoot: string, group: string, result: RuntimeFile[], signal?: AbortSignal): Promise<void> {
    if (!(await exists(sourceRoot, signal))) return
    const visit = async (source: string, destination: string): Promise<void> => {
      checkAborted(signal)
      const entries = await retryFileOperation(() => readdir(source, { withFileTypes: true }), { signal })
      for (const entry of entries) {
        checkAborted(signal)
        const from = join(source, entry.name)
        const to = join(destination, entry.name)
        if (entry.isDirectory()) await visit(from, to)
        else if (entry.isFile()) result.push({ source: from, destination: to, size: (await retryFileOperation(() => stat(from), { signal })).size, group, relativePath: relative(sourceRoot, from) })
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
    if (await exists(join(data, 'mysql'), signal)) return false
    const setup = join(root, 'bin', 'mariadb-install-db.exe')
    if (!(await exists(setup, signal))) return false
    checkAborted(signal)
    await retryFileOperation(() => mkdir(data, { recursive: true }).then(() => undefined), { signal })
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
