import { createHash } from 'node:crypto'
import { access, cp, mkdir, open, readdir, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { spawn } from 'node:child_process'
import type { InstallProgress, InstallRequest, InstallResult, PhpProfile, PhpVersion } from '../shared/types'
import type { JsonStore } from './store'
import type { ConfigManager } from './config-manager'
import type { LogBuffer } from './logs'
import { runtimePaths } from './paths'
import { isPhpMyAdminInstall, mariaDbHasData, preserveDuringUpdate, STACK_PRESERVE } from './stack-components'

type ProgressListener = (progress: InstallProgress) => void
const ALLOWED_DOWNLOAD_HOSTS = new Set(['downloads.php.net', 'windows.php.net', 'www.apachelounge.com', 'mirror.mariadb.org', 'archive.mariadb.org', 'files.phpmyadmin.net', 'www.phpmyadmin.net'])

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true } catch { return false }
}

export class Installer {
  private listeners = new Set<ProgressListener>()
  private activeStartedAt = 0
  private downloadStartedAt = 0

  constructor(
    private readonly store: JsonStore,
    private readonly configs: ConfigManager,
    private readonly logs: LogBuffer
  ) {}

  subscribe(listener: ProgressListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async phpVersions(): Promise<PhpVersion[]> {
    const settings = await this.store.getSettings()
    const paths = runtimePaths(settings)
    const supported = ['8.2.35', '8.3.36', '8.4.27', '8.5.12']
    let installed: string[] = []
    try {
      installed = (await readdir(paths.php, { withFileTypes: true })).filter((item) => item.isDirectory()).map((item) => item.name)
    } catch { /* empty */ }
    return [...new Set([...supported, ...installed])].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map((version) => ({
      version,
      installed: installed.includes(version),
      active: settings.activePhpVersion === version,
      channel: version.startsWith('8.2') || version.startsWith('8.3') ? 'security' : 'stable',
      path: installed.includes(version) ? join(paths.php, version) : undefined
    }))
  }

  async install(request: InstallRequest): Promise<InstallResult> {
    const url = new URL(request.url)
    if (url.protocol !== 'https:' || !ALLOWED_DOWNLOAD_HOSTS.has(url.hostname)) throw new Error('This download source is not trusted by WeebX.')
    if (!/^\d+(?:\.\d+){1,2}$/.test(request.version)) throw new Error('Invalid component version.')
    const settings = await this.store.getSettings()
    const paths = runtimePaths(settings)
    await mkdir(paths.temp, { recursive: true })
    const archive = join(paths.temp, `${request.component}-${request.version}-${Date.now()}.zip`)
    const staging = join(paths.temp, `extract-${crypto.randomUUID()}`)
    const target = this.targetFor(request, settings)
    const updating = await this.isUpdate(request, target)
    const dataExisted = request.component === 'mariadb' ? await mariaDbHasData(paths.mariadbData) : false

    this.activeStartedAt = Date.now()
    try {
      const digest = await this.download(request, archive)
      this.emit(request, 'verifying', 100, request.sha256 ? 'Verifying SHA-256 checksum…' : `Downloaded (SHA-256 ${digest.slice(0, 12)}…).`)
      if (request.sha256 && digest.toLowerCase() !== request.sha256.toLowerCase()) throw new Error('SHA-256 checksum does not match the published value.')
      await mkdir(staging, { recursive: true })
      await this.withHeartbeat(request, 'extracting', 15, 'Extracting package. Large archives can take several minutes...', async () => {
        await this.extractArchive(archive, staging)
      })
      const source = await this.findPayloadRoot(request.component, staging)
      this.emit(request, 'extracting', 70, updating ? 'Updating files without replacing your data...' : 'Copying files into the WeebX runtime...')
      await mkdir(join(target, '..'), { recursive: true })
      const preserved = updating && request.component !== 'php' ? STACK_PRESERVE[request.component] : []
      await this.withHeartbeat(request, 'extracting', 80, updating ? 'Merging the new version over the existing install...' : 'Copying extracted files...', async () => {
        await cp(source, target, {
          recursive: true,
          errorOnExist: request.component === 'php',
          filter: (file) => preserveDuringUpdate(source, file, preserved)
        })
      })
      await this.withHeartbeat(request, 'configuring', 92, request.component === 'mariadb' && !dataExisted ? 'Initializing MariaDB system tables. This often takes 1-4 minutes...' : 'Keeping WeebX configuration and user data...', async () => {
        await this.configure(request, { updating, dataExisted })
      })
      this.emit(request, 'complete', 100, updating ? `${request.component} ${request.version} updated.` : `${request.component} ${request.version} installed.`)
      this.logs.add('system', 'info', `${updating ? 'Updated' : 'Installed'} ${request.component} ${request.version}.`)
      return { updated: updating, mariaDbNeedsUpgrade: request.component === 'mariadb' && updating && dataExisted }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.emit(request, 'error', 0, message)
      throw error
    } finally {
      await Promise.all([rm(archive, { force: true }), rm(staging, { recursive: true, force: true })])
    }
  }

  async selectPhp(version: string): Promise<void> {
    const settings = await this.store.getSettings()
    const executable = join(settings.runtimeRoot, 'php', version, 'php-cgi.exe')
    if (!(await exists(executable))) throw new Error(`PHP ${version} is not installed.`)
    await this.store.updateSettings({ activePhpVersion: version })
    const nextSettings = await this.store.getSettings()
    await this.configs.applyPhpProfile(version, nextSettings.phpProfile)
    await this.configs.save('apache', this.configs.apacheTemplate(nextSettings))
    this.logs.add('system', 'info', `Selected PHP ${version}.`)
  }

  async setPhpProfile(profile: PhpProfile): Promise<void> {
    if (profile !== 'development' && profile !== 'production') throw new Error('Unknown PHP profile.')
    const settings = await this.store.updateSettings({ phpProfile: profile })
    await this.configs.applyPhpProfile(settings.activePhpVersion, profile)
    this.logs.add('system', 'info', `Applied the PHP ${profile} profile to ${settings.activePhpVersion}.`)
  }

  private async download(request: InstallRequest, destination: string): Promise<string> {
    this.downloadStartedAt = Date.now()
    this.emit(request, 'downloading', 0, `Downloading ${basename(new URL(request.url).pathname)}…`)
    const headers: Record<string, string> = { 'User-Agent': 'Mozilla/5.0 WeebX/1.1' }
    if (new URL(request.url).hostname === 'www.apachelounge.com') headers.Referer = 'https://www.apachelounge.com/download/'
    const response = await fetch(request.url, { redirect: 'follow', headers })
    if (!response.ok || !response.body) throw new Error(`Download failed: HTTP ${response.status}.`)
    const finalUrl = new URL(response.url)
    if (finalUrl.protocol !== 'https:' || !ALLOWED_DOWNLOAD_HOSTS.has(finalUrl.hostname)) throw new Error('The download redirected to an untrusted host.')
    const total = Number(response.headers.get('content-length')) || 0
    const reader = response.body.getReader()
    const file = await open(destination, 'w')
    const hash = createHash('sha256')
    let received = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        await file.write(value)
        hash.update(value)
        received += value.byteLength
        const elapsed = Math.max(1, (Date.now() - this.downloadStartedAt) / 1000)
        const etaSeconds = total > 0 && received > 0 ? Math.max(0, Math.ceil((elapsed / (received / total)) - elapsed)) : null
        this.emit(request, 'downloading', total ? Math.min(99, Math.round(received / total * 100)) : 0, total ? `${Math.round(received / 1048576)} / ${Math.round(total / 1048576)} MB` : `${Math.round(received / 1048576)} MB`, {
          completedBytes: received, totalBytes: total, etaSeconds, detail: 'Downloading from the official source'
        })
      }
    } finally { await file.close() }
    return hash.digest('hex')
  }

  private targetFor(request: InstallRequest, settings: Awaited<ReturnType<JsonStore['getSettings']>>): string {
    const paths = runtimePaths(settings)
    if (request.component === 'php') return join(paths.php, request.version)
    if (request.component === 'phpmyadmin') return paths.phpMyAdmin
    return request.component === 'apache' ? paths.apache : paths.mariadb
  }

  private async findPayloadRoot(component: InstallRequest['component'], root: string): Promise<string> {
    const marker = component === 'php' ? 'php.exe' : component === 'apache' ? join('bin', 'httpd.exe') : component === 'mariadb' ? join('bin', 'mariadbd.exe') : 'index.php'
    if (await exists(join(root, marker))) return root
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (entry.isDirectory() && await exists(join(root, entry.name, marker))) return join(root, entry.name)
    }
    throw new Error(`The archive does not look like a supported ${component} package.`)
  }

  private async isUpdate(request: InstallRequest, target: string): Promise<boolean> {
    if (request.component === 'php') {
      if (await exists(join(target, 'php.exe'))) throw new Error(`PHP ${request.version} is already installed.`)
      return false
    }
    if (request.component === 'phpmyadmin') {
      if (await isPhpMyAdminInstall(target)) return true
      if (!(await exists(target))) return false
      const leftover = await readdir(target).catch(() => [])
      if (leftover.length) throw new Error('htdocs/phpmyadmin exists but is not phpMyAdmin. Rename that folder first so WeebX can install phpMyAdmin without touching your site.')
      return false
    }
    const marker = request.component === 'apache' ? join(target, 'bin', 'httpd.exe') : join(target, 'bin', 'mariadbd.exe')
    return exists(marker)
  }

  async runMariaDbUpgrade(): Promise<void> {
    const settings = await this.store.getSettings()
    const paths = runtimePaths(settings)
    const upgrade = join(paths.mariadb, 'bin', 'mariadb-upgrade.exe')
    if (!(await exists(upgrade))) return
    const args = ['--host=127.0.0.1', `--port=${settings.mariadbPort}`, '-uroot']
    if (settings.mariadbPassword) args.push(`-p${settings.mariadbPassword}`)
    try {
      await this.run(upgrade, args)
      this.logs.add('system', 'info', 'MariaDB system tables were upgraded. Databases were kept.')
    } catch (error) {
      this.logs.add('system', 'warn', error instanceof Error ? error.message : String(error))
    }
  }

  private async configure(request: InstallRequest, options: { updating: boolean; dataExisted: boolean }): Promise<void> {
    const settings = await this.store.getSettings()
    const paths = runtimePaths(settings)
    if (request.component === 'php') {
      await this.configs.applyPhpProfile(request.version, settings.phpProfile)
      if (!(await exists(paths.phpCgiExe))) await this.selectPhp(request.version)
    }
    if (request.component === 'apache') {
      if (!(await exists(paths.apacheConf))) await this.configs.save('apache', this.configs.apacheTemplate(settings))
      if (!(await exists(paths.vhostsConf))) await this.configs.save('vhosts', this.configs.vhostExample(settings))
    }
    if (request.component === 'mariadb') {
      if (!(await exists(paths.mariadbConf))) await this.configs.save('mariadb', this.configs.mariaDbTemplate(settings))
      const installDb = join(paths.mariadb, 'bin', 'mariadb-install-db.exe')
      if (!options.dataExisted && await exists(installDb)) await this.run(installDb, [`--datadir=${paths.mariadbData}`, '--password='])
    }
    if (request.component === 'phpmyadmin') {
      await this.configs.writePhpMyAdminConfig()
    }
  }

  private run(command: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { windowsHide: true })
      let error = ''
      child.stderr.on('data', (data) => { error += data })
      child.once('error', reject)
      child.once('close', (code) => code === 0 ? resolve() : reject(new Error(error || `Setup exited with code ${code}.`)))
    })
  }

  private extractArchive(archive: string, destination: string): Promise<void> {
    if (process.platform !== 'win32') throw new Error('WeebX package extraction currently requires Windows.')
    const script = '& { param($archive, $destination) Expand-Archive -LiteralPath $archive -DestinationPath $destination -Force }'
    return this.run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script, archive, destination])
  }

  private async withHeartbeat(request: InstallRequest, phase: InstallProgress['phase'], percent: number, message: string, work: () => Promise<void>): Promise<void> {
    const started = Date.now()
    const tick = () => this.emit(request, phase, percent, message, { detail: `${message} (${Math.floor((Date.now() - started) / 1000)}s elapsed)` })
    tick()
    const heartbeat = setInterval(tick, 700)
    try { await work() } finally { clearInterval(heartbeat) }
  }

  private emit(request: InstallRequest, phase: InstallProgress['phase'], percent: number, message: string, extra: Partial<InstallProgress> = {}): void {
    const progress: InstallProgress = {
      component: request.component, version: request.version, phase, percent, message,
      elapsedSeconds: Math.max(0, Math.floor((Date.now() - this.activeStartedAt) / 1000)),
      ...extra
    }
    this.listeners.forEach((listener) => listener(progress))
  }
}
