import { app, BrowserWindow, dialog, Menu, nativeImage, session, shell, Tray } from 'electron'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { electronApp, is } from '@electron-toolkit/utils'
import type { PreparationProgress, ServiceId } from '../shared/types'
import { JsonStore } from './store'
import { LogBuffer } from './logs'
import { ConfigManager } from './config-manager'
import { ProcessManager } from './process-manager'
import { VhostManager } from './vhost-manager'
import { Installer } from './installer'
import { registerIpc } from './ipc'
import { RuntimeSeeder } from './runtime-seeder'
import { RelocationManager } from './relocation-manager'
import { pointUninstallToApp } from './stack-shutdown'
import { applyPermissionPreset } from './permissions'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let processes: ProcessManager | null = null
let installer: Installer | null = null
let quitting = false
let uninstallMode = false

const dataDirectoryArgument = process.argv.find((argument) => argument.startsWith('--weebx-data-dir='))
if (dataDirectoryArgument) {
  const requestedDirectory = dataDirectoryArgument.slice('--weebx-data-dir='.length).trim().replace(/^"|"$/g, '')
  if (requestedDirectory) app.setPath('userData', resolve(requestedDirectory))
}

function firstExisting(...paths: string[]): string {
  return paths.find((path) => existsSync(path)) || paths[0]
}

function brandPath(): string {
  return firstExisting(
    join(process.resourcesPath, 'assets', 'weebx-logo.png'),
    join(app.getAppPath(), 'build', 'assets', 'weebx-logo.png'),
    join(app.getAppPath(), 'src', 'renderer', 'src', 'assets', 'weebx-logo.png'),
    join(process.cwd(), 'build', 'assets', 'weebx-logo.png')
  )
}

function preparationPage(): string {
  return firstExisting(
    join(process.resourcesPath, 'preparation.html'),
    join(app.getAppPath(), 'resources', 'preparation.html'),
    join(process.cwd(), 'resources', 'preparation.html')
  )
}

function cancelledError(): Error {
  return Object.assign(new Error('WeebX preparation was cancelled.'), { name: 'AbortError' })
}

function isCancelled(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const value = error as { name?: string; code?: string; message?: string }
  return value.name === 'AbortError' || value.code === 'ERR_ABORTED' || /cancelled|aborted|object has been destroy/i.test(String(value.message || ''))
}

function logoDataUrl(): string {
  const image = nativeImage.createFromPath(brandPath())
  if (image.isEmpty()) return ''
  return image.resize({ width: 256, height: 256, quality: 'best' }).toDataURL()
}

async function createWindow(): Promise<void> {
  const preparationController = new AbortController()
  let preparing = true
  let closeRequested = false
  let progressPump: Promise<void> = Promise.resolve()
  let preparationState: PreparationProgress = {
    phase: 'scanning', percent: 0, message: 'Starting WeebX', detail: 'Opening the local environment...',
    completedFiles: 0, totalFiles: 0, completedBytes: 0, totalBytes: 0, elapsedSeconds: 0, etaSeconds: null, speedBytesPerSecond: 0
  }
  const preparationStarted = Date.now()
  const windowAlive = (): boolean => Boolean(mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed())
  const sendPreparation = (patch: Partial<PreparationProgress>) => {
    preparationState = { ...preparationState, ...patch, elapsedSeconds: Math.floor((Date.now() - preparationStarted) / 1000) }
    const snapshot = preparationState
    progressPump = progressPump.then(async () => {
      if (!windowAlive()) return
      try { await mainWindow!.webContents.executeJavaScript(`window.__weebxProgress && window.__weebxProgress(${JSON.stringify(snapshot)})`) }
      catch { /* the preparation page may still be loading */ }
      if (windowAlive()) mainWindow!.webContents.send('weebx:preparation', snapshot)
    }, () => undefined)
  }

  mainWindow = new BrowserWindow({
    width: 1360, height: 860, minWidth: 1040, minHeight: 680, show: false,
    backgroundColor: '#0d1220', icon: brandPath(), titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0d1220', symbolColor: '#b7c0d6', height: 42 },
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true, nodeIntegration: false }
  })
  mainWindow.on('close', (event) => {
    if (preparing && !closeRequested) {
      event.preventDefault()
      closeRequested = true
      sendPreparation({ phase: 'cancelling', message: 'Stopping safely...', detail: 'Finishing the current file before closing.', etaSeconds: null })
      preparationController.abort()
      return
    }
    if (uninstallMode) { quitting = true; return }
    if (!quitting) { event.preventDefault(); mainWindow?.hide() }
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = !app.isPackaged && process.env.ELECTRON_RENDERER_URL && url.startsWith(process.env.ELECTRON_RENDERER_URL)
    if (!allowed && !url.startsWith('file:')) event.preventDefault()
  })
  mainWindow.webContents.on('did-finish-load', () => {
    if (!preparing || !windowAlive()) return
    const boot = JSON.stringify({ logoDataUrl: logoDataUrl() })
    void mainWindow!.webContents.executeJavaScript(`window.__weebxBoot && window.__weebxBoot(${boot})`).catch(() => undefined)
    sendPreparation({})
  })
  mainWindow.webContents.on('did-fail-load', (_event, code, description, url) => {
    if (code !== -3) console.error(`[renderer] Failed to load ${url}: ${code} ${description}`)
  })
  mainWindow.webContents.on('console-message', (details) => {
    if (details.level === 'warning' || details.level === 'error') console.error(`[renderer] ${details.message} (${details.sourceId}:${details.lineNumber})`)
  })

  const developmentCloseDelay = !app.isPackaged ? Number(process.env.WEEBX_TEST_CLOSE_AFTER_MS || 0) : 0
  if (Number.isFinite(developmentCloseDelay) && developmentCloseDelay > 0) {
    setTimeout(() => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close() }, developmentCloseDelay)
  }

  try {
    await mainWindow.loadFile(preparationPage())
    if (preparationController.signal.aborted) throw cancelledError()
    mainWindow.show()
    const store = new JsonStore(join(app.getPath('userData'), 'weebx.json'))
    const logs = new LogBuffer()
    const configs = new ConfigManager(() => store.getSettings())
    processes = new ProcessManager(store, logs, configs)
    const vhosts = new VhostManager(store, configs, logs)
    installer = new Installer(store, configs, logs)
    const relocation = new RelocationManager(store, configs, vhosts, logs)
    const seeder = new RuntimeSeeder(store, logs)

    sendPreparation({ phase: 'scanning', percent: 1, message: 'Checking the WeebX location', detail: 'Looking for a moved runtime folder...' })
    try {
      await relocation.autoRepair()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logs.add('system', 'warn', `Location repair could not finish: ${message}`)
      sendPreparation({ detail: 'Existing runtime is in use. Configuration repair will retry from Settings if needed.' })
    }
    if (preparationController.signal.aborted) throw cancelledError()
    const seeded = await seeder.seed({ signal: preparationController.signal, onProgress: (progress) => sendPreparation(progress) })
    if (preparationController.signal.aborted) throw cancelledError()

    sendPreparation({ phase: 'configuring', percent: 96, message: 'Writing configuration files', detail: 'Updating Apache, MariaDB, PHP, and virtual-host paths...', etaSeconds: null })
    await configs.ensureLayout()
    if (seeded) {
      const settings = await store.getSettings()
      await configs.save('apache', configs.apacheTemplate(settings))
      await configs.save('mariadb', configs.mariaDbTemplate(settings))
      await configs.save('vhosts', configs.vhostExample(settings))
      await configs.applyPhpProfile(settings.activePhpVersion, settings.phpProfile)
      if (process.platform === 'win32') {
        try {
          const secured = await applyPermissionPreset(settings, 'runtime', 'private')
          logs.add('system', 'info', secured.message)
        } catch (error) {
          logs.add('system', 'warn', `Automatic NTFS hardening needs attention: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }
    await relocation.writeCurrentStamp()
    if (preparationController.signal.aborted) throw cancelledError()

    sendPreparation({ phase: 'checking', percent: 99, message: 'Checking services and ports', detail: 'Reading Apache and MariaDB status...', etaSeconds: 1 })
    await processes.initialize()
    registerIpc({ window: mainWindow, store, processes, configs, vhosts, installer, logs, relocation, exitForUninstall })
    sendPreparation({ phase: 'complete', percent: 100, message: 'WeebX is ready', detail: 'Opening the control panel...', etaSeconds: 0 })
    if (preparationController.signal.aborted) throw cancelledError()

    if (is.dev && process.env.ELECTRON_RENDERER_URL) await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
    else await mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
    preparing = false
    const settings = await store.getSettings()
    app.setLoginItemSettings({
      openAtLogin: settings.startWithWindows,
      path: process.execPath,
      args: app.isPackaged ? [] : ['.']
    })
    if (settings.startOnLaunch) await Promise.all(['apache', 'mariadb'].map((id) => processes!.start(id as ServiceId)))
    await createTray()
    processes.subscribe(() => { void refreshTray() })
    if (app.isPackaged) void pointUninstallToApp(process.execPath).catch(() => undefined)
  } catch (error) {
    if (closeRequested || quitting || isCancelled(error)) {
      quitting = true
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy()
      app.quit()
      return
    }
    throw error
  }
}

async function createTray(): Promise<void> {
  if (tray) return refreshTray()
  const icon = nativeImage.createFromPath(brandPath()).resize({ width: 16, height: 16 })
  tray = new Tray(icon)
  tray.setToolTip('WeebX')
  tray.on('double-click', () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show() })
  await refreshTray()
}

async function refreshTray(): Promise<void> {
  if (!tray || !processes) return
  const apache = processes.status('apache')
  const mariadb = processes.status('mariadb')
  const phpVersions = installer ? (await installer.phpVersions()).filter((item) => item.installed) : []
  const apacheRunning = apache.state === 'running' || apache.state === 'starting'
  const mariadbRunning = mariadb.state === 'running' || mariadb.state === 'starting'
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open WeebX', click: () => { if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus() } } },
    { type: 'separator' },
    { label: apacheRunning ? 'Stop Apache' : 'Start Apache', click: () => void processes?.[apacheRunning ? 'stop' : 'start']('apache') },
    { label: mariadbRunning ? 'Stop MariaDB' : 'Start MariaDB', click: () => void processes?.[mariadbRunning ? 'stop' : 'start']('mariadb') },
    { type: 'separator' },
    { label: 'Start all', enabled: !(apacheRunning && mariadbRunning), click: () => void Promise.all((['apache', 'mariadb'] as ServiceId[]).map((id) => processes?.start(id))) },
    { label: 'Stop all', enabled: apacheRunning || mariadbRunning, click: () => void processes?.stopAll() },
    { type: 'separator' },
    {
      label: 'PHP version',
      submenu: phpVersions.length ? phpVersions.map((item) => ({
        label: item.version,
        type: 'radio' as const,
        checked: item.active,
        click: () => void selectPhpFromTray(item.version)
      })) : [{ label: 'No PHP versions installed', enabled: false }]
    },
    { type: 'separator' },
    { label: 'Uninstall WeebX', click: () => { void showUninstallUi() } },
    { label: 'Quit', click: () => { quitting = true; app.quit() } }
  ]))
}

async function selectPhpFromTray(version: string): Promise<void> {
  if (!installer || !processes) return
  await installer.selectPhp(version)
  const apache = processes.status('apache')
  if (apache.state === 'running' || apache.state === 'starting') await processes.restart('apache')
  await refreshTray()
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.jadadev.weebx')
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
  if (wantsUninstall()) await createUninstallWindow()
  else await createWindow()
  app.on('activate', () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show() })
}).catch((error) => {
  if (quitting || isCancelled(error)) {
    app.quit()
    return
  }
  const message = error instanceof Error ? error.stack || error.message : String(error)
  console.error(message)
  dialog.showErrorBox('WeebX could not start', `${message}\n\nYour existing runtime and websites were not deleted.`)
  quitting = true
  app.quit()
})

let stoppedForQuit = false
app.on('before-quit', (event) => {
  quitting = true
  if (uninstallMode || stoppedForQuit || !processes) return
  event.preventDefault()
  void processes.stopAll()
    .catch(() => undefined)
    .finally(() => { stoppedForQuit = true; processes = null; app.quit() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })

function wantsUninstall(): boolean {
  return process.argv.some((argument) => argument === '--uninstall' || argument === '/uninstall')
}

async function loadUninstallPage(window: BrowserWindow): Promise<void> {
  if (is.dev && process.env.ELECTRON_RENDERER_URL) await window.loadURL(`${process.env.ELECTRON_RENDERER_URL}?mode=uninstall#uninstall`)
  else await window.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'uninstall', query: { mode: 'uninstall' } })
}

function enterUninstallMode(): void {
  uninstallMode = true
  tray?.destroy()
  tray = null
}

function exitForUninstall(): void {
  uninstallMode = true
  quitting = true
  stoppedForQuit = true
  processes = null
  // Tear down the native window before the MSI removes renderer files. This
  // avoids leaving an orphaned dark BrowserWindow on screen.
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide()
    mainWindow.destroy()
  }
  mainWindow = null
  app.exit(0)
}

function markUninstallPage(window: BrowserWindow): void {
  void window.webContents.executeJavaScript(`document.documentElement.classList.add('uninstall');document.title='Uninstall WeebX'`)
}

async function showUninstallUi(): Promise<void> {
  enterUninstallMode()
  if (!mainWindow || mainWindow.isDestroyed()) {
    await createUninstallWindow()
    return
  }
  mainWindow.setMinimumSize(560, 700)
  mainWindow.setSize(720, 860)
  mainWindow.center()
  mainWindow.show()
  mainWindow.focus()
  markUninstallPage(mainWindow)
  mainWindow.webContents.send('weebx:open-uninstall')
}

async function createUninstallWindow(): Promise<void> {
  enterUninstallMode()
  mainWindow = new BrowserWindow({
    width: 720, height: 860, minWidth: 560, minHeight: 700, show: false,
    backgroundColor: '#0d1220', icon: brandPath(), titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0d1220', symbolColor: '#b7c0d6', height: 42 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: ['--weebx-uninstall']
    }
  })
  mainWindow.on('close', () => { quitting = true })
  mainWindow.webContents.on('did-finish-load', () => { if (mainWindow && !mainWindow.isDestroyed()) markUninstallPage(mainWindow) })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = !app.isPackaged && process.env.ELECTRON_RENDERER_URL && url.startsWith(process.env.ELECTRON_RENDERER_URL)
    if (!allowed && !url.startsWith('file:')) event.preventDefault()
  })
  const store = new JsonStore(join(app.getPath('userData'), 'weebx.json'))
  const logs = new LogBuffer()
  const configs = new ConfigManager(() => store.getSettings())
  processes = new ProcessManager(store, logs, configs)
  const vhosts = new VhostManager(store, configs, logs)
  installer = new Installer(store, configs, logs)
  const relocation = new RelocationManager(store, configs, vhosts, logs)
  registerIpc({ window: mainWindow, store, processes, configs, vhosts, installer, logs, relocation, exitForUninstall })
  await loadUninstallPage(mainWindow)
  mainWindow.show()
  void processes.initialize().catch(() => undefined)
}
