import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { access, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import type { DashboardSnapshot, InstallRequest, PhpProfile, PortalOptions, PortalProgress, RuntimeSettings, ServiceId, VhostDraft } from '../shared/types'
import type { JsonStore } from './store'
import type { ProcessManager } from './process-manager'
import type { ConfigManager } from './config-manager'
import type { VhostManager } from './vhost-manager'
import type { Installer } from './installer'
import type { LogBuffer } from './logs'
import type { RelocationManager } from './relocation-manager'
import { inspectPorts } from './ports'
import { runtimePaths } from './paths'
import { recoverMariaDbPassword, syncStoredMariaDbPassword, mariaDbPasswordError, waitUntilPasswordWorks } from './mariadb-password'
import { buildMsiUninstallScript, clearResetStateBeforeUninstall, findWeebXUninstallEntry, inspectStack, stopStackProcesses, uninstallHelperArgs } from './stack-shutdown'
import { preserveHtdocs } from './htdocs-preserve'
import { packPortal, unpackPortal } from './portal-pack'
import { applyApacheModules, applyPhpExtensions, applyPhpLimits, assertRuntimeTuneSave, loadRuntimeTune } from './runtime-tune'
import { inspectStackComponents } from './stack-components'

const execFileAsync = promisify(execFile)

async function waitForFile(path: string, attempts = 20): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { await access(path); return true } catch { /* helper has not started yet */ }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return false
}

interface Dependencies {
  window: BrowserWindow
  store: JsonStore
  processes: ProcessManager
  configs: ConfigManager
  vhosts: VhostManager
  installer: Installer
  logs: LogBuffer
  relocation: RelocationManager
  exitForUninstall: () => void
}

async function isElevated(): Promise<boolean> {
  if (process.platform !== 'win32') return process.getuid?.() === 0
  try { await execFileAsync('net.exe', ['session'], { windowsHide: true }); return true } catch { return false }
}

function assertService(value: unknown): asserts value is ServiceId {
  if (value !== 'apache' && value !== 'mariadb') throw new Error('Unknown service.')
}

function assertConfig(value: unknown): asserts value is 'php' | 'apache' | 'vhosts' | 'mariadb' {
  if (!['php', 'apache', 'vhosts', 'mariadb'].includes(String(value))) throw new Error('Unknown configuration file.')
}

export function registerIpc(deps: Dependencies): () => void {
  const { window, store, processes, configs, vhosts, installer, logs, relocation, exitForUninstall } = deps
  const channels: string[] = []
  const handle = (channel: string, listener: (...args: any[]) => unknown) => {
    channels.push(channel)
    ipcMain.handle(channel, listener)
  }

  handle('weebx:snapshot', async (): Promise<DashboardSnapshot> => {
    const services = processes.list()
    let settings = await store.getSettings()
    if (services.some((service) => service.id === 'mariadb' && service.state === 'running')) {
      const previous = settings.mariadbPassword
      settings = await syncStoredMariaDbPassword(settings, (password) => store.updateSettings({ mariadbPassword: password }))
      if (previous !== settings.mariadbPassword) await configs.writePhpMyAdminConfig()
    }
    const ports = await inspectPorts([settings.apachePort, settings.apacheSslPort, settings.mariadbPort])
    for (const service of services) {
      if (service.state !== 'running') continue
      const owned = [service.port]
      if (service.id === 'apache') owned.push(settings.apacheSslPort)
      for (const port of ports) {
        if (!owned.includes(port.port)) continue
        port.available = false
        port.pid = service.pid
        port.processName = service.name
      }
    }
    return {
      services,
      ports,
      settings,
      phpVersions: await installer.phpVersions(),
      virtualHosts: await vhosts.list(),
      stackComponents: await inspectStackComponents(settings),
      elevated: await isElevated()
    }
  })
  handle('weebx:runtime-tune', async () => loadRuntimeTune(await store.getSettings()))
  handle('weebx:runtime-tune-save', async (_event, payload: unknown) => {
    const patch = assertRuntimeTuneSave(payload)
    const phpOriginal = await configs.read('php')
    const apacheOriginal = await configs.read('apache')
    if (!phpOriginal) throw new Error('php.ini was not found for the active PHP version.')
    if (!apacheOriginal) throw new Error('httpd.conf was not found. Install Apache first.')
    const phpNext = applyPhpLimits(applyPhpExtensions(phpOriginal, patch.phpExtensions), patch.phpLimits)
    const apacheNext = applyApacheModules(apacheOriginal, patch.apacheModules)
    await configs.save('php', phpNext)
    await configs.save('apache', apacheNext)
    const check = await processes.validate('apache')
    if (!check.ok) {
      await configs.save('php', phpOriginal)
      await configs.save('apache', apacheOriginal)
      throw new Error(check.output || 'Apache rejected the new module configuration.')
    }
    const apache = processes.status('apache')
    if (apache.state === 'running' || apache.state === 'starting') {
      await processes.restart('apache')
      logs.add('system', 'info', 'PHP limits and Apache modules were saved. Apache restarted.')
      return { restarted: true, message: 'Saved. Apache restarted with the new modules and PHP limits.' }
    }
    logs.add('system', 'info', 'PHP limits and Apache modules were saved.')
    return { restarted: false, message: 'Saved. Start Apache to apply the new modules.' }
  })
  handle('weebx:service', async (_event, action: string, id: unknown) => {
    assertService(id)
    if (action === 'start') return processes.start(id)
    if (action === 'stop') return processes.stop(id)
    if (action === 'restart') return processes.restart(id)
    throw new Error('Unknown service action.')
  })
  handle('weebx:service-all', async (_event, action: string) => {
    if (action === 'stop') return processes.stopAll()
    if (action === 'start') return Promise.all((['apache', 'mariadb'] as ServiceId[]).map((id) => processes.start(id)))
    throw new Error('Unknown service action.')
  })
  handle('weebx:ports', async () => {
    const settings = await store.getSettings()
    return inspectPorts([settings.apachePort, settings.apacheSslPort, settings.mariadbPort])
  })
  handle('weebx:logs', () => logs.list())
  handle('weebx:config-read', async (_event, kind: unknown) => { assertConfig(kind); return configs.read(kind) })
  handle('weebx:config-save', async (_event, kind: unknown, content: unknown) => {
    assertConfig(kind)
    if (typeof content !== 'string' || content.length > 2_000_000) throw new Error('Invalid configuration content.')
    await configs.save(kind, content)
  })
  handle('weebx:config-validate', async (_event, kind: unknown) => {
    if (!['php', 'apache', 'mariadb'].includes(String(kind))) throw new Error('Unknown configuration file.')
    return processes.validate(kind as 'php' | 'apache' | 'mariadb')
  })
  handle('weebx:vhosts', () => vhosts.list())
  handle('weebx:vhost-create', (_event, draft: VhostDraft) => vhosts.create(draft))
  handle('weebx:vhost-delete', (_event, id: string) => vhosts.remove(id))
  handle('weebx:vhost-enable', (_event, id: string, enabled: boolean) => vhosts.setEnabled(id, enabled))
  handle('weebx:php-select', async (_event, version: string) => {
    await installer.selectPhp(version)
    const apache = processes.status('apache')
    if (apache.state === 'running' || apache.state === 'starting') await processes.restart('apache')
  })
  handle('weebx:php-profile', async (_event, profile: PhpProfile) => {
    await installer.setPhpProfile(profile)
    const apache = processes.status('apache')
    if (apache.state === 'running' || apache.state === 'starting') await processes.restart('apache')
  })
  handle('weebx:install', async (_event, request: InstallRequest) => {
    const apache = processes.status('apache')
    const mysql = processes.status('mariadb')
    const apacheWas = apache.state === 'running' || apache.state === 'starting'
    const mysqlWas = mysql.state === 'running' || mysql.state === 'starting'
    if ((request.component === 'apache' || request.component === 'phpmyadmin') && apacheWas) await processes.stop('apache')
    if (request.component === 'mariadb' && mysqlWas) await processes.stop('mariadb')
    const result = await installer.install(request)
    if (result.mariaDbNeedsUpgrade) {
      await processes.start('mariadb')
      await new Promise((resolve) => setTimeout(resolve, 1500))
      await installer.runMariaDbUpgrade()
      if (!mysqlWas) await processes.stop('mariadb')
    } else if (request.component === 'mariadb' && mysqlWas) {
      await processes.start('mariadb')
    }
    if ((request.component === 'apache' || request.component === 'phpmyadmin') && apacheWas) await processes.start('apache')
    return result
  })
  handle('weebx:settings-update', async (_event, patch: Partial<RuntimeSettings>) => {
    const allowed: (keyof RuntimeSettings)[] = ['runtimeRoot', 'htdocsRoot', 'apachePort', 'apacheSslPort', 'mariadbPort', 'startOnLaunch', 'minimizeToTray', 'checkPortsBeforeStart', 'startWithWindows', 'autoRestartApache', 'autoRestartMariaDb', 'autoRestartDelayMs']
    const safe = Object.fromEntries(Object.entries(patch).filter(([key]) => allowed.includes(key as keyof RuntimeSettings))) as Partial<RuntimeSettings>
    for (const key of ['apachePort', 'apacheSslPort', 'mariadbPort'] as const) {
      const value = safe[key]
      if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > 65535)) throw new Error(`${key} must be a valid port.`)
    }
    if (safe.autoRestartDelayMs !== undefined && ![5000, 10000, 30000, 60000, 300000].includes(safe.autoRestartDelayMs)) {
      throw new Error('Auto-restart delay must be 5 seconds, 10 seconds, 30 seconds, 1 minute, or 5 minutes.')
    }
    for (const key of ['startOnLaunch', 'minimizeToTray', 'checkPortsBeforeStart', 'startWithWindows', 'autoRestartApache', 'autoRestartMariaDb'] as const) {
      if (safe[key] !== undefined && typeof safe[key] !== 'boolean') throw new Error(`${key} must be on or off.`)
    }
    const next = await store.updateSettings(safe)
    if (safe.startWithWindows !== undefined) {
      app.setLoginItemSettings({
        openAtLogin: next.startWithWindows,
        path: process.execPath,
        args: app.isPackaged ? [] : ['.']
      })
    }
    await configs.ensureLayout()
    const paths = runtimePaths(next)
    try { await readdir(paths.apache); await configs.save('apache', configs.apacheTemplate(next)) } catch { /* not installed */ }
    if (safe.mariadbPort !== undefined) await configs.writeMariaDbPort(next.mariadbPort)
    await configs.writePhpMyAdminConfig()
    await vhosts.render()
    return next
  })
  handle('weebx:mysql-port', async (_event, port: unknown) => {
    const value = Math.trunc(Number(port))
    if (!Number.isFinite(value) || value < 1 || value > 65535) throw new Error('MySQL port must be between 1 and 65535.')
    const running = ['running', 'starting'].includes(processes.status('mariadb').state)
    const next = await store.updateSettings({ mariadbPort: value })
    await configs.writeMariaDbPort(next.mariadbPort)
    await configs.writePhpMyAdminConfig()
    if (running) await processes.restart('mariadb')
    logs.add('system', 'info', running
      ? `MySQL port changed to ${next.mariadbPort} and MySQL was restarted.`
      : `MySQL port changed to ${next.mariadbPort}.`)
    return next
  })
  handle('weebx:repair-location', async (_event, selectedPath: unknown) => {
    await processes.stopAll()
    if (selectedPath === undefined || selectedPath === null || selectedPath === '') return relocation.autoRepair()
    if (typeof selectedPath !== 'string' || selectedPath.length < 2 || selectedPath.length > 1000) throw new Error('Choose the relocated WeebX or runtime folder first.')
    return relocation.repair(selectedPath)
  })
  handle('weebx:open-path', async (_event, path: string) => {
    const settings = await store.getSettings()
    const allowed = [settings.runtimeRoot, settings.htdocsRoot].some((root) => {
      const child = relative(root, path)
      return child === '' || (!child.startsWith('..') && !isAbsolute(child))
    })
    if (!allowed) throw new Error('Path is outside the WeebX runtime.')
    const error = await shell.openPath(path)
    if (error) throw new Error(error)
  })
  handle('weebx:open-external', async (_event, url: string) => {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Unsupported URL.')
    await shell.openExternal(parsed.toString())
  })
  handle('weebx:choose-directory', async () => {
    const result = await dialog.showOpenDialog(window, { properties: ['openDirectory', 'createDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })
  handle('weebx:mariadb-password', async (_event, password: unknown) => {
    if (typeof password !== 'string') throw new Error('Enter a password.')
    const settings = await store.getSettings()
    const wasRunning = ['running', 'starting'].includes(processes.status('mariadb').state)
    if (!wasRunning) throw new Error('Start MySQL first, then change the password.')
    logs.add('system', 'info', 'Force-resetting the local MySQL root password.')
    await processes.stop('mariadb')
    try {
      await recoverMariaDbPassword(settings, password)
    } catch (error) {
      await processes.start('mariadb').catch(() => undefined)
      throw new Error(mariaDbPasswordError(error instanceof Error ? error.message : String(error), true))
    }
    await processes.start('mariadb')
    if (!(await waitUntilPasswordWorks({ ...settings, mariadbPassword: password }, password))) {
      throw new Error('MySQL started but did not accept the new password. Start MySQL and try again.')
    }
    const next = await store.updateSettings({ mariadbPassword: password })
    await configs.writePhpMyAdminConfig()
    await configs.ensureLayout()
    logs.add('system', 'info', password ? 'MySQL root password was reset.' : 'MySQL root password was cleared.')
    return next
  })
  handle('weebx:uninstall-status', async () => {
    const settings = await store.getSettings()
    return inspectStack(settings.runtimeRoot)
  })
  handle('weebx:uninstall-stop', async () => {
    try { await processes.stopAll() } catch { /* fall through to process kill */ }
    const settings = await store.getSettings()
    return stopStackProcesses(settings.runtimeRoot)
  })
  handle('weebx:uninstall', async (_event, options: unknown) => {
    const keepHtdocs = typeof options === 'object' && options !== null && (options as { keepHtdocs?: unknown }).keepHtdocs !== false
    try { await processes.stopAll() } catch { /* continue */ }
    const settings = await store.getSettings()
    await stopStackProcesses(settings.runtimeRoot)
    let savedTo: string | undefined
    if (keepHtdocs) {
      savedTo = await preserveHtdocs(settings.htdocsRoot)
      try { await shell.openPath(savedTo) } catch { /* folder still exists */ }
    }
    const entry = await findWeebXUninstallEntry()
    if (!entry || !/^\{[0-9A-F-]+\}$/i.test(entry.guid)) throw new Error('Could not find the WeebX MSI. Use Windows Settings > Apps to remove it after stopping Apache and MySQL here.')
    const userData = app.getPath('userData')
    await clearResetStateBeforeUninstall(userData, settings.runtimeRoot)
    const scriptPath = join(tmpdir(), 'weebx-uninstall.vbs')
    const startedMarker = join(tmpdir(), 'weebx-uninstall.started')
    await rm(startedMarker, { force: true })
    await writeFile(scriptPath, buildMsiUninstallScript({
      guid: entry.guid,
      removeAppData: true,
      userData,
      startedMarker,
      uninstallerPid: process.pid
    }), 'utf8')
    const helper = spawn('wscript.exe', uninstallHelperArgs(scriptPath), { detached: true, stdio: 'ignore', windowsHide: true })
    await new Promise<void>((resolve, reject) => {
      helper.once('spawn', resolve)
      helper.once('error', reject)
    })
    const started = await Promise.race([
      waitForFile(startedMarker, 50),
      new Promise<boolean>((resolve) => helper.once('exit', () => resolve(false)))
    ])
    if (!started) throw new Error('Windows could not start the WeebX uninstall helper. Please try again.')
    helper.unref()
    setTimeout(() => exitForUninstall(), 400)
    return { savedTo: savedTo ?? null }
  })
  handle('weebx:portal-pack', async (_event, options: unknown) => {
    const includeDb = !(typeof options === 'object' && options !== null && (options as PortalOptions).includeDb === false)
    const includeHtdocs = !(typeof options === 'object' && options !== null && (options as PortalOptions).includeHtdocs === false)
    const dest = await dialog.showOpenDialog(window, { title: 'Choose where to save the WeebX Portal', properties: ['openDirectory', 'createDirectory'] })
    if (dest.canceled || !dest.filePaths[0]) throw new Error('Choose a folder for the portal.')
    if (includeDb) try { await processes.stop('mariadb') } catch { /* copy the files anyway */ }
    const send = (progress: PortalProgress) => { if (!window.isDestroyed()) window.webContents.send('weebx:portal-progress', progress) }
    const result = await packPortal(dest.filePaths[0], await store.getSettings(), await store.getVhosts(), { includeDb, includeHtdocs }, send)
    await shell.openPath(result.folder)
    logs.add('system', 'info', `Portal packed at ${result.folder}`)
    return result
  })
  handle('weebx:portal-unpack', async () => {
    const source = await dialog.showOpenDialog(window, { title: 'Choose a WeebX Portal folder', properties: ['openDirectory'] })
    if (source.canceled || !source.filePaths[0]) throw new Error('Choose a portal folder.')
    const dest = await dialog.showOpenDialog(window, { title: 'Choose where to unpack the portal', properties: ['openDirectory', 'createDirectory'] })
    if (dest.canceled || !dest.filePaths[0]) throw new Error('Choose a destination folder.')
    const send = (progress: PortalProgress) => { if (!window.isDestroyed()) window.webContents.send('weebx:portal-progress', progress) }
    const result = await unpackPortal(source.filePaths[0], dest.filePaths[0], send)
    await shell.openPath(result.folder)
    logs.add('system', 'info', `Portal unpacked at ${result.folder}`)
    return result
  })

  const unsubscribe = [
    logs.subscribe((entry) => !window.isDestroyed() && window.webContents.send('weebx:log', entry)),
    processes.subscribe((status) => !window.isDestroyed() && window.webContents.send('weebx:status', status)),
    installer.subscribe((progress) => !window.isDestroyed() && window.webContents.send('weebx:install-progress', progress))
  ]
  return () => {
    channels.forEach((channel) => ipcMain.removeHandler(channel))
    unsubscribe.forEach((remove) => remove())
  }
}
