import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { spawn } from 'node:child_process'
import { access, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DashboardSnapshot, InstallRequest, PermissionPreset, PermissionTarget, PhpProfile, PortalOptions, PortalProgress, PreinstalledAppInstallRequest, PreinstalledAppUninstallOptions, RuntimeSettings, ServiceId, SiteIsolationDraft, SiteLogKind, VhostAccessDraft, VhostDraft } from '../shared/types'
import type { JsonStore } from './store'
import type { ProcessManager } from './process-manager'
import type { ConfigManager } from './config-manager'
import type { VhostManager } from './vhost-manager'
import type { Installer } from './installer'
import type { LogBuffer } from './logs'
import type { RelocationManager } from './relocation-manager'
import { findInstalledApp, type PreinstalledAppManager } from './preinstalled-apps'
import { inspectPorts } from './ports'
import { runtimePaths } from './paths'
import { recoverMariaDbPassword, syncStoredMariaDbPassword, mariaDbPasswordError, waitUntilPasswordWorks } from './mariadb-password'
import { buildMsiUninstallScript, clearResetStateBeforeUninstall, findWeebXUninstallEntry, inspectStack, isDefaultUserDataForRemoval, stopStackProcesses, uninstallHelperArgs } from './stack-shutdown'
import { preserveHtdocs } from './htdocs-preserve'
import { packPortal, unpackPortal } from './portal-pack'
import { applyApacheModules, applyPhpExtensions, applyPhpLimits, assertRuntimeTuneSave, loadRuntimeTune } from './runtime-tune'
import { inspectStackComponents } from './stack-components'
import { assertPasswordInput, publicRuntimeSettings } from './security'
import { applyPermissionPreset } from './permissions'
import { siteDatabaseCredential, siteProfileOptions, siteProfilePaths } from './site-profile'
import { findPreinstalledApp } from './preinstalled-app-catalog'
import { isElevated } from './administrator'
import { removeAllWeebxHostBlocks } from './windows-hosts'
import { nearestExistingDirectory, resolveManagedDirectory } from './managed-path'

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
  preinstalledApps: PreinstalledAppManager
  exitForUninstall: () => void
  restartElevated: () => Promise<void>
}

function assertService(value: unknown): asserts value is ServiceId {
  if (value !== 'apache' && value !== 'mariadb') throw new Error('Unknown service.')
}

function assertConfig(value: unknown): asserts value is 'php' | 'apache' | 'vhosts' | 'mariadb' {
  if (!['php', 'apache', 'vhosts', 'mariadb'].includes(String(value))) throw new Error('Unknown configuration file.')
}

export function registerIpc(deps: Dependencies): () => void {
  const { window, store, processes, configs, vhosts, installer, logs, relocation, preinstalledApps, exitForUninstall, restartElevated } = deps
  const channels: string[] = []
  let passwordRevealPromptActive = false
  const handle = (channel: string, listener: (...args: any[]) => unknown) => {
    channels.push(channel)
    ipcMain.handle(channel, (event, ...args) => {
      if (event.sender !== window.webContents) throw new Error('Blocked an IPC request from an untrusted window.')
      return listener(event, ...args)
    })
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
      settings: publicRuntimeSettings(settings),
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
  handle('weebx:preinstalled-app-catalog', () => preinstalledApps.catalog())
  handle('weebx:preinstalled-apps', () => preinstalledApps.list())
  handle('weebx:preinstalled-app-activity', (_event, installId: unknown) => {
    if (installId !== undefined && typeof installId !== 'string') throw new Error('Invalid app activity request.')
    return preinstalledApps.activity(installId as string | undefined)
  })
  handle('weebx:preinstalled-app-preflight', async (_event, request: PreinstalledAppInstallRequest) => {
    if (!request || typeof request !== 'object') throw new Error('Invalid app installation request.')
    return preinstalledApps.preflight(request, await isElevated())
  })
  handle('weebx:preinstalled-app-install', async (_event, request: PreinstalledAppInstallRequest) => {
    if (!request || typeof request !== 'object') throw new Error('Invalid app installation request.')
    const preflight = await preinstalledApps.preflight(request, await isElevated())
    const blocker = preflight.checks.find((check) => check.status === 'blocked')
    if (blocker) throw new Error(`${blocker.title}: ${blocker.detail}`)
    if (!['running', 'starting'].includes(processes.status('apache').state)) await processes.start('apache')
    if (findPreinstalledApp(request.catalogId)?.database && !['running', 'starting'].includes(processes.status('mariadb').state)) await processes.start('mariadb')
    const result = await preinstalledApps.install(request)
    if (['running', 'starting'].includes(processes.status('apache').state)) await processes.restart('apache')
    else await processes.start('apache')
    return result
  })
  handle('weebx:preinstalled-app-complete', async (_event, id: unknown) => {
    if (typeof id !== 'string' || !id) throw new Error('Installed app not found.')
    const record = await preinstalledApps.markSetupComplete(id)
    if (['running', 'starting'].includes(processes.status('apache').state)) await processes.restart('apache')
    return record
  })
  handle('weebx:preinstalled-app-uninstall', async (_event, id: unknown, options: PreinstalledAppUninstallOptions) => {
    if (typeof id !== 'string' || !id) throw new Error('Installed app not found.')
    if (!options || typeof options !== 'object') throw new Error('Choose what to remove.')
    const record = findInstalledApp(await preinstalledApps.list(), id)
    if (record?.databaseName && (options.removeDatabase || options.removeSite) && !['running', 'starting'].includes(processes.status('mariadb').state)) await processes.start('mariadb')
    const removed = await preinstalledApps.uninstall(id, options)
    try {
      if (['running', 'starting'].includes(processes.status('apache').state)) await processes.restart('apache')
    } catch (error) {
      logs.add('system', 'warn', `Apache restart after uninstalling ${removed.name}: ${error instanceof Error ? error.message : String(error)}`)
    }
    return removed
  })
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
  handle('weebx:vhost-create', async (_event, draft: VhostDraft) => {
    if (draft?.isolation?.database && !['running', 'starting'].includes(processes.status('mariadb').state)) throw new Error('Start MariaDB before provisioning an isolated database user.')
    const site = await vhosts.create(draft)
    if (['running', 'starting'].includes(processes.status('apache').state)) await processes.restart('apache')
    return site
  })
  handle('weebx:vhost-profile-update', async (_event, id: string, isolation?: SiteIsolationDraft) => {
    const current = (await vhosts.list()).find((item) => item.id === id)
    const databaseChange = Boolean(isolation?.database || current?.isolation?.database && !isolation?.database)
    if (databaseChange && !['running', 'starting'].includes(processes.status('mariadb').state)) throw new Error('Start MariaDB before provisioning, changing, or removing an isolated database user.')
    const site = await vhosts.updateProfile(id, isolation)
    if (['running', 'starting'].includes(processes.status('apache').state)) await processes.restart('apache')
    return site
  })
  handle('weebx:vhost-access-update', async (_event, id: unknown, access: VhostAccessDraft) => {
    if (typeof id !== 'string' || !id) throw new Error('Virtual host not found.')
    if (!access || typeof access !== 'object' || typeof access.http !== 'boolean' || typeof access.https !== 'boolean') throw new Error('Choose HTTP and HTTPS.')
    const site = await vhosts.updateAccess(id, access)
    if (['running', 'starting'].includes(processes.status('apache').state)) await processes.restart('apache')
    return site
  })
  handle('weebx:preinstalled-app-access', async (_event, id: unknown, access: VhostAccessDraft) => {
    if (typeof id !== 'string' || !id) throw new Error('Installed app not found.')
    if (!access || typeof access !== 'object' || typeof access.http !== 'boolean' || typeof access.https !== 'boolean') throw new Error('Choose HTTP and HTTPS.')
    const record = await preinstalledApps.updateSiteAccess(id, access)
    if (['running', 'starting'].includes(processes.status('apache').state)) await processes.restart('apache')
    return record
  })
  handle('weebx:vhost-delete', async (_event, id: string) => {
    const site = (await vhosts.list()).find((item) => item.id === id)
    if (site?.isolation?.database && !['running', 'starting'].includes(processes.status('mariadb').state)) throw new Error('Start MariaDB so WeebX can safely remove the managed database user. The database itself will be preserved.')
    await vhosts.remove(id)
    if (['running', 'starting'].includes(processes.status('apache').state)) await processes.restart('apache')
  })
  handle('weebx:vhost-enable', async (_event, id: string, enabled: boolean) => {
    const site = await vhosts.setEnabled(id, enabled)
    if (['running', 'starting'].includes(processes.status('apache').state)) await processes.restart('apache')
    return site
  })
  handle('weebx:site-profile-options', async (_event, version: unknown) => {
    if (typeof version !== 'string') throw new Error('Choose an installed PHP version.')
    return siteProfileOptions(await store.getSettings(), version)
  })
  handle('weebx:preinstalled-app-connection', async (_event, id: unknown) => {
    if (typeof id !== 'string' || !id) throw new Error('Installed app not found.')
    const record = findInstalledApp(await preinstalledApps.list(), id)
    if (!record) throw new Error('Installed app not found.')
    const result = await dialog.showMessageBox(window, {
      type: 'warning', title: 'Reveal application connection details',
      message: `Show connection details for ${record.name} on ${record.domain}?`,
      detail: 'This includes the site and admin URLs, administrator username and password when WeebX created the account, PHP runtime, and managed database credentials. Details stay on this screen and are hidden automatically after 30 seconds.',
      buttons: ['Cancel', 'Reveal details'], defaultId: 0, cancelId: 0, noLink: true
    })
    if (result.response !== 1) return null
    return preinstalledApps.connection(record.id)
  })
  handle('weebx:site-database-reveal', async (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('Virtual host not found.')
    const site = (await vhosts.list()).find((item) => item.id === id)
    if (!site?.isolation?.database) throw new Error('This site does not have a managed database user.')
    const result = await dialog.showMessageBox(window, {
      type: 'warning', title: 'Reveal site database password',
      message: `Show the database password for ${site.serverName}?`,
      detail: 'Only continue in private. The credential will be decrypted for this screen and hidden automatically after 30 seconds.',
      buttons: ['Cancel', 'Reveal password'], defaultId: 0, cancelId: 0, noLink: true
    })
    if (result.response !== 1) return null
    const password = await store.getSiteDatabasePassword(site.id)
    if (!password) throw new Error('The saved database credential is missing. Save the site profile to generate a replacement.')
    return siteDatabaseCredential(await store.getSettings(), site, password)
  })
  handle('weebx:site-log-read', async (_event, id: unknown, kind: unknown) => {
    if (typeof id !== 'string' || !['php', 'apache-error', 'apache-access'].includes(String(kind))) throw new Error('Invalid isolated-site log request.')
    const site = (await vhosts.list()).find((item) => item.id === id)
    if (!site?.isolation) throw new Error('This site does not have an isolated profile.')
    const paths = siteProfilePaths(await store.getSettings(), site)
    const file = join(paths.logs, kind === 'php' ? 'php-error.log' : kind === 'apache-error' ? 'apache-error.log' : 'apache-access.log')
    const raw = await readFile(file, 'utf8').catch(() => '')
    const limit = 750_000
    return { kind: kind as SiteLogKind, path: file, content: raw.length > limit ? raw.slice(-limit) : raw, truncated: raw.length > limit }
  })
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
  handle('weebx:php-releases', () => installer.discoverPhpReleases())
  handle('weebx:php-import', async () => {
    const selection = await dialog.showOpenDialog(window, {
      title: 'Choose a Windows PHP x64 NTS ZIP',
      filters: [{ name: 'ZIP archives', extensions: ['zip'] }],
      properties: ['openFile']
    })
    if (selection.canceled || !selection.filePaths[0]) return null
    return installer.importPhpArchive(selection.filePaths[0])
  })
  handle('weebx:install', async (_event, request: InstallRequest) => {
    const apache = processes.status('apache')
    const mariadb = processes.status('mariadb')
    const apacheWas = apache.state === 'running' || apache.state === 'starting'
    const mariadbWas = mariadb.state === 'running' || mariadb.state === 'starting'
    if ((request.component === 'apache' || request.component === 'phpmyadmin') && apacheWas) await processes.stop('apache')
    if (request.component === 'mariadb' && mariadbWas) await processes.stop('mariadb')
    const result = await installer.install(request)
    if (result.mariaDbNeedsUpgrade) {
      await processes.start('mariadb')
      await new Promise((resolve) => setTimeout(resolve, 1500))
      await installer.runMariaDbUpgrade()
      if (!mariadbWas) await processes.stop('mariadb')
    } else if (request.component === 'mariadb' && mariadbWas) {
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
    return publicRuntimeSettings(next)
  })
  handle('weebx:mariadb-port', async (_event, port: unknown) => {
    const value = Math.trunc(Number(port))
    if (!Number.isFinite(value) || value < 1 || value > 65535) throw new Error('MariaDB port must be between 1 and 65535.')
    const running = ['running', 'starting'].includes(processes.status('mariadb').state)
    const next = await store.updateSettings({ mariadbPort: value })
    await configs.writeMariaDbPort(next.mariadbPort)
    await configs.writePhpMyAdminConfig()
    if (running) await processes.restart('mariadb')
    logs.add('system', 'info', running
      ? `MariaDB port changed to ${next.mariadbPort} and MariaDB was restarted.`
      : `MariaDB port changed to ${next.mariadbPort}.`)
    return publicRuntimeSettings(next)
  })
  handle('weebx:repair-location', async (_event, selectedPath: unknown) => {
    await processes.stopAll()
    if (selectedPath === undefined || selectedPath === null || selectedPath === '') return relocation.autoRepair()
    if (typeof selectedPath !== 'string' || selectedPath.length < 2 || selectedPath.length > 1000) throw new Error('Choose the relocated WeebX or runtime folder first.')
    return relocation.repair(selectedPath)
  })
  handle('weebx:open-path', async (_event, path: string) => {
    const settings = await store.getSettings()
    const folder = await resolveManagedDirectory(path, [settings.runtimeRoot, settings.htdocsRoot])
    const error = await shell.openPath(folder)
    if (error) throw new Error(error)
  })
  handle('weebx:open-external', async (_event, url: string) => {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Unsupported URL.')
    await shell.openExternal(parsed.toString())
  })
  handle('weebx:choose-directory', async (_event, startPath: unknown) => {
    const options: Electron.OpenDialogOptions = {
      title: 'Choose a folder',
      properties: ['openDirectory', 'createDirectory']
    }
    if (typeof startPath === 'string' && startPath.trim()) {
      try {
        const existing = await nearestExistingDirectory(startPath)
        if (existing) options.defaultPath = existing
      } catch { /* invalid start path; open the picker without a default */ }
    }
    const result = await dialog.showOpenDialog(window, options)
    return result.canceled ? null : result.filePaths[0]
  })
  const resetMariaDbPassword = async (password: string, initialSetup: boolean) => {
    assertPasswordInput(password)
    const settings = await store.getSettings()
    const wasRunning = ['running', 'starting'].includes(processes.status('mariadb').state)
    if (!initialSetup && !wasRunning) throw new Error('Start MariaDB first, then change the password.')
    logs.add('system', password ? 'info' : 'warn', initialSetup ? 'Applying the first-run MariaDB password choice.' : 'Resetting the local MariaDB root password.')
    if (wasRunning) await processes.stop('mariadb')
    try {
      await recoverMariaDbPassword(settings, password)
    } catch (error) {
      if (wasRunning) await processes.start('mariadb', true).catch(() => undefined)
      throw new Error(mariaDbPasswordError(error instanceof Error ? error.message : String(error), true))
    }
    const next = await store.updateSettings({ mariadbPassword: password, setupComplete: true })
    await configs.writePhpMyAdminConfig()
    await configs.ensureLayout()
    await processes.start('mariadb', true)
    if (!(await waitUntilPasswordWorks(next, password))) {
      await store.updateSettings({ setupComplete: false })
      throw new Error('MariaDB started but did not accept the new password. Run security setup again.')
    }
    if (!wasRunning) await processes.stop('mariadb')
    logs.add('system', password ? 'info' : 'warn', password
      ? (initialSetup ? 'First-run MariaDB setup is complete.' : 'MariaDB root password was reset.')
      : 'MariaDB is using an empty root password. Keep it loopback-only and set a strong password before going live.')
    return publicRuntimeSettings(next)
  }
  handle('weebx:security-setup', async (_event, password: unknown) => {
    if (typeof password !== 'string') throw new Error('Choose a password or leave it empty.')
    return resetMariaDbPassword(password, true)
  })
  handle('weebx:mariadb-password', async (_event, password: unknown) => {
    if (typeof password !== 'string') throw new Error('Enter a password.')
    return resetMariaDbPassword(password, false)
  })
  handle('weebx:mariadb-password-reveal', async () => {
    if (passwordRevealPromptActive) return null
    passwordRevealPromptActive = true
    try {
      const result = await dialog.showMessageBox(window, {
        type: 'warning',
        title: 'Reveal MariaDB password',
        message: 'Show the saved MariaDB root password?',
        detail: 'Only continue in private. The password will be decrypted for this screen and hidden automatically after 30 seconds.',
        buttons: ['Cancel', 'Reveal password'],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      })
      if (result.response !== 1) return null
      return {
        password: (await store.getSettings()).mariadbPassword,
        protection: 'windows-encrypted-confirmation' as const
      }
    } finally {
      passwordRevealPromptActive = false
    }
  })
  handle('weebx:permissions-set', async (_event, target: PermissionTarget, preset: PermissionPreset) => {
    if (!['runtime', 'htdocs', 'database'].includes(String(target))) throw new Error('Unknown permission target.')
    if (!['private', 'writable', 'windows-default'].includes(String(preset))) throw new Error('Unknown permission preset.')
    const running = processes.list().filter((service) => service.state === 'running' || service.state === 'starting').map((service) => service.id)
    const affected = target === 'runtime' ? running : target === 'database' ? running.filter((id) => id === 'mariadb') : running.filter((id) => id === 'apache')
    for (const id of affected) await processes.stop(id)
    try {
      const result = await applyPermissionPreset(await store.getSettings(), target, preset)
      logs.add('system', 'info', result.message)
      return result
    } finally {
      for (const id of affected) await processes.start(id)
    }
  })
  handle('weebx:restart-elevated', async () => restartElevated())
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
    if (!entry || !/^\{[0-9A-F-]+\}$/i.test(entry.guid)) throw new Error('Could not find the WeebX MSI. Use Windows Settings > Apps to remove it after stopping Apache and MariaDB here.')
    const userData = app.getPath('userData')
    await clearResetStateBeforeUninstall(userData, settings.runtimeRoot)
    try { await removeAllWeebxHostBlocks() }
    catch { logs.add('system', 'warn', 'Could not remove WeebX host entries from the Windows hosts file. Delete leftover # BEGIN WEEBX HOST blocks as administrator if any remain.') }
    const scriptPath = join(tmpdir(), 'weebx-uninstall.vbs')
    const startedMarker = join(tmpdir(), 'weebx-uninstall.started')
    await rm(startedMarker, { force: true })
    await writeFile(scriptPath, buildMsiUninstallScript({
      guid: entry.guid,
      // Portable Portal data can live beside its EXE. Never recursively remove
      // that custom folder while uninstalling the normal MSI application.
      removeAppData: isDefaultUserDataForRemoval(app.getPath('appData'), userData),
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
    installer.subscribe((progress) => !window.isDestroyed() && window.webContents.send('weebx:install-progress', progress)),
    preinstalledApps.subscribe((progress) => !window.isDestroyed() && window.webContents.send('weebx:preinstalled-app-progress', progress))
  ]
  return () => {
    channels.forEach((channel) => ipcMain.removeHandler(channel))
    unsubscribe.forEach((remove) => remove())
  }
}
