import { access, cp, mkdir, readdir, rm, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { spawn } from 'node:child_process'
import type { InstallProgress, InstallRequest, InstallResult, PhpProfile, PhpRelease, PhpVersion } from '../shared/types'
import type { JsonStore } from './store'
import type { ConfigManager } from './config-manager'
import type { LogBuffer } from './logs'
import { runtimePaths } from './paths'
import { isPhpMyAdminInstall, mariaDbHasData, preserveDuringUpdate, STACK_PRESERVE } from './stack-components'
import { runMariaDbClient } from './mariadb-password'
import { WEEBX_VERSION } from '../shared/version'
import { downloadTrustedHttps, readTrustedHttps } from './secure-download'

type ProgressListener = (progress: InstallProgress) => void
const ALLOWED_DOWNLOAD_HOSTS = new Set(['downloads.php.net', 'windows.php.net', 'www.apachelounge.com', 'mirror.mariadb.org', 'archive.mariadb.org', 'files.phpmyadmin.net', 'www.phpmyadmin.net'])

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true } catch { return false }
}

export class Installer {
  private listeners = new Set<ProgressListener>()
  private activeStartedAt = 0
  private downloadStartedAt = 0
  private phpReleaseCache: { expires: number; releases: PhpRelease[] } | null = null

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
    let versions: string[] = []
    try {
      versions = (await readdir(paths.php, { withFileTypes: true })).filter((item) => item.isDirectory()).map((item) => item.name)
    } catch { /* empty */ }
    return Promise.all(versions.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map(async (version) => {
      const folder = join(paths.php, version)
      const installed = await exists(join(folder, 'php.exe')) && await exists(join(folder, 'php-cgi.exe'))
      return {
        version,
        installed,
        active: installed && settings.activePhpVersion === version,
        channel: version.startsWith('8.2') || version.startsWith('8.3') ? 'security' as const : 'stable' as const,
        path: installed ? folder : undefined
      }
    }))
  }

  async discoverPhpReleases(): Promise<PhpRelease[]> {
    if (this.phpReleaseCache && this.phpReleaseCache.expires > Date.now()) return this.phpReleaseCache.releases
    const text = (await readTrustedHttps({
      url: 'https://windows.php.net/downloads/releases/releases.json', allowedHosts: ALLOWED_DOWNLOAD_HOSTS,
      maximumBytes: 2_000_000, headers: { 'User-Agent': `Mozilla/5.0 WeebX/${WEEBX_VERSION}` }
    })).toString('utf8')
    let metadata: Record<string, unknown>
    try { metadata = JSON.parse(text) as Record<string, unknown> } catch { throw new Error('PHP returned an invalid release list.') }

    const found: PhpRelease[] = []
    for (const [branch, rawRelease] of Object.entries(metadata)) {
      if (!/^\d+\.\d+$/.test(branch) || !rawRelease || typeof rawRelease !== 'object') continue
      const [major, minor] = branch.split('.').map(Number)
      if (major < 8 || (major === 8 && minor < 2)) continue
      const release = rawRelease as Record<string, unknown>
      const version = typeof release.version === 'string' ? release.version : ''
      const variantEntry = Object.entries(release).find(([key, value]) => /^nts-vs\d+-x64$/i.test(key) && value && typeof value === 'object')
      if (!/^\d+\.\d+\.\d+$/.test(version) || !variantEntry) continue
      const [compiler, rawVariant] = variantEntry
      const zip = (rawVariant as Record<string, unknown>).zip
      if (!zip || typeof zip !== 'object') continue
      const path = (zip as Record<string, unknown>).path
      const sha256 = (zip as Record<string, unknown>).sha256
      const size = (zip as Record<string, unknown>).size
      if (typeof path !== 'string' || !/^php-[\w.-]+\.zip$/i.test(path) || typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(sha256)) continue
      found.push({
        version,
        branch,
        url: `https://windows.php.net/downloads/releases/${path}`,
        sha256,
        size: typeof size === 'string' ? size : 'Unknown size',
        compiler: compiler.replace(/^nts-/i, '').toUpperCase(),
        channel: 'stable'
      })
    }
    found.sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))
    if (!found.length) throw new Error('No compatible Windows x64 NTS PHP releases were found.')
    this.phpReleaseCache = { expires: Date.now() + 15 * 60_000, releases: found }
    return found
  }

  async importPhpArchive(archive: string): Promise<PhpVersion> {
    if (process.platform !== 'win32') throw new Error('Manual PHP import currently requires Windows.')
    if (!/\.zip$/i.test(archive)) throw new Error('Choose a PHP ZIP archive.')
    const archiveInfo = await stat(archive)
    if (!archiveInfo.isFile() || archiveInfo.size <= 0 || archiveInfo.size > 2 * 1024 * 1024 * 1024) throw new Error('The selected PHP archive is empty or too large.')
    const settings = await this.store.getSettings()
    const paths = runtimePaths(settings)
    await mkdir(paths.temp, { recursive: true })
    const staging = join(paths.temp, `php-import-${crypto.randomUUID()}`)
    const request: InstallRequest = { component: 'php', version: 'manual', url: 'https://windows.php.net/', sha256: '0'.repeat(64) }
    this.activeStartedAt = Date.now()
    let target = ''
    try {
      this.emit(request, 'extracting', 10, 'Inspecting the selected PHP archive...')
      await mkdir(staging, { recursive: true })
      await this.extractArchive(archive, staging)
      const source = await this.findPayloadRoot('php', staging)
      for (const required of ['php.exe', 'php-cgi.exe', 'ext']) {
        if (!(await exists(join(source, required)))) throw new Error(`This archive is missing ${required}. Choose the official Windows x64 NTS ZIP, not a source or development pack.`)
      }
      const details = await this.runOutput(join(source, 'php.exe'), ['-n', '-r', "echo PHP_VERSION,'|',PHP_INT_SIZE*8,'|',(PHP_ZTS?'TS':'NTS');"])
      const match = details.trim().match(/^(\d+\.\d+\.\d+)\|64\|NTS$/)
      if (!match) throw new Error('WeebX requires a Windows x64 Non-Thread-Safe PHP build with php-cgi.exe.')
      const version = match[1]
      const [major, minor] = version.split('.').map(Number)
      if (major < 8 || (major === 8 && minor < 2)) throw new Error('PHP 8.2 or newer is required. Older branches are unsafe for live hosting.')
      target = join(paths.php, version)
      if (await exists(target)) throw new Error(`The PHP ${version} folder already exists. Rename or remove it before importing.`)
      this.emit({ ...request, version }, 'extracting', 70, `Validated PHP ${version} x64 NTS. Copying files...`)
      await mkdir(paths.php, { recursive: true })
      await cp(source, target, { recursive: true, errorOnExist: true })
      await this.configs.applyPhpProfile(version, settings.phpProfile)
      this.emit({ ...request, version }, 'complete', 100, `PHP ${version} imported and configured.`)
      this.logs.add('system', 'info', `Imported and validated PHP ${version} x64 NTS from ${basename(archive)}.`)
      return { version, installed: true, active: settings.activePhpVersion === version, channel: 'stable', path: target }
    } catch (error) {
      if (target) await rm(target, { recursive: true, force: true }).catch(() => undefined)
      const message = error instanceof Error ? error.message : String(error)
      this.emit(request, 'error', 0, message)
      throw error
    } finally {
      await rm(staging, { recursive: true, force: true })
    }
  }

  async install(request: InstallRequest): Promise<InstallResult> {
    if (!request || !['apache', 'mariadb', 'php', 'phpmyadmin'].includes(request.component) ||
        typeof request.url !== 'string' || typeof request.version !== 'string' || typeof request.sha256 !== 'string') {
      throw new Error('Invalid component installation request.')
    }
    const url = new URL(request.url)
    if (url.protocol !== 'https:' || !ALLOWED_DOWNLOAD_HOSTS.has(url.hostname)) throw new Error('This download source is not trusted by WeebX.')
    if (!/^\d+(?:\.\d+){1,2}$/.test(request.version)) throw new Error('Invalid component version.')
    if (!/^[a-f0-9]{64}$/i.test(request.sha256)) throw new Error('A valid SHA-256 checksum is required for every component install.')
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
      if (digest.toLowerCase() !== request.sha256.toLowerCase()) throw new Error('SHA-256 checksum does not match the published value.')
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
      await this.withHeartbeat(request, 'configuring', 92, request.component === 'mariadb' && !dataExisted ? 'Initializing MariaDB system tables...' : 'Keeping WeebX configuration and user data...', async () => {
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
    await this.configs.ensureLayout()
    this.logs.add('system', 'info', `Applied the PHP ${profile} profile to ${settings.activePhpVersion}.`)
  }

  private async download(request: InstallRequest, destination: string): Promise<string> {
    this.downloadStartedAt = Date.now()
    this.emit(request, 'downloading', 0, `Downloading ${basename(new URL(request.url).pathname)}…`)
    const headers: Record<string, string> = { 'User-Agent': `Mozilla/5.0 WeebX/${WEEBX_VERSION}` }
    if (new URL(request.url).hostname === 'www.apachelounge.com') headers.Referer = 'https://www.apachelounge.com/download/'
    const maximumBytes = 2 * 1024 * 1024 * 1024
    const result = await downloadTrustedHttps({
      url: request.url, destination, allowedHosts: ALLOWED_DOWNLOAD_HOSTS, maximumBytes, headers,
      onProgress: ({ receivedBytes, totalBytes }) => {
        const elapsed = Math.max(1, (Date.now() - this.downloadStartedAt) / 1000)
        const etaSeconds = totalBytes > 0 && receivedBytes > 0 ? Math.max(0, Math.ceil((elapsed / (receivedBytes / totalBytes)) - elapsed)) : null
        this.emit(request, 'downloading', totalBytes ? Math.min(99, Math.round(receivedBytes / totalBytes * 100)) : 0, totalBytes ? `${Math.round(receivedBytes / 1048576)} / ${Math.round(totalBytes / 1048576)} MB` : `${Math.round(receivedBytes / 1048576)} MB`, {
          completedBytes: receivedBytes, totalBytes, etaSeconds, detail: 'Downloading from the official source'
        })
      }
    })
    return result.sha256
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
    try {
      await runMariaDbClient(settings, [], '127.0.0.1', settings.mariadbPassword, upgrade, 60000)
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
      if (!options.dataExisted && await exists(installDb)) {
        // Initialize without placing a secret on the process command line. The
        // first-run security flow applies the user's choice after the server is
        // started through a protected temporary client option file.
        await this.run(installDb, [`--datadir=${paths.mariadbData}`, '--password='])
        await this.store.updateSettings({ mariadbPassword: '', setupComplete: false })
        await this.configs.writePhpMyAdminConfig()
      }
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

  private runOutput(command: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { windowsHide: true })
      let output = ''
      const timer = setTimeout(() => { child.kill(); reject(new Error('PHP validation timed out.')) }, 15000)
      child.stdout.on('data', (data) => { output += data })
      child.stderr.on('data', (data) => { output += data })
      child.once('error', (error) => { clearTimeout(timer); reject(error) })
      child.once('close', (code) => {
        clearTimeout(timer)
        code === 0 ? resolve(output) : reject(new Error(output.trim() || `PHP validation exited with code ${code}.`))
      })
    })
  }

  private extractArchive(archive: string, destination: string): Promise<void> {
    if (process.platform !== 'win32') throw new Error('WeebX package extraction currently requires Windows.')
    const script = [
      '& { param($archive, $destination)',
      'Add-Type -AssemblyName System.IO.Compression.FileSystem;',
      '[IO.Directory]::CreateDirectory($destination) | Out-Null;',
      '$root=[IO.Path]::GetFullPath($destination + [IO.Path]::DirectorySeparatorChar);',
      '$zip=[IO.Compression.ZipFile]::OpenRead($archive);',
      'try {',
      'if($zip.Entries.Count -gt 200000){throw "Archive contains too many files."};',
      '[Int64]$total=0;',
      'foreach($entry in $zip.Entries){',
      '$total += $entry.Length;',
      'if($total -gt 8GB){throw "Archive expands beyond the 8 GB safety limit."};',
      '$relative=$entry.FullName.Replace("/","\\");',
      'if([string]::IsNullOrWhiteSpace($relative)){continue};',
      '$target=[IO.Path]::GetFullPath([IO.Path]::Combine($destination,$relative));',
      'if(-not $target.StartsWith($root,[StringComparison]::OrdinalIgnoreCase)){throw "Archive contains an unsafe path."};',
      'if($relative.EndsWith("\\")){[IO.Directory]::CreateDirectory($target) | Out-Null; continue};',
      '$folder=[IO.Path]::GetDirectoryName($target);',
      'if($folder){[IO.Directory]::CreateDirectory($folder) | Out-Null};',
      '$sourceStream=$entry.Open();',
      'try { $output=[IO.File]::Create($target); try { $sourceStream.CopyTo($output) } finally { $output.Dispose() } }',
      'finally { $sourceStream.Dispose() }',
      '}',
      '} finally { $zip.Dispose() }',
      '}'
    ].join(' ')
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
