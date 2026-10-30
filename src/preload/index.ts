import { contextBridge, ipcRenderer } from 'electron'
import type { InstallProgress, InstallRequest, LogEntry, PermissionPreset, PermissionTarget, PhpProfile, PortalOptions, PortalProgress, PreparationProgress, PreinstalledAppInstallRequest, PreinstalledAppProgress, PreinstalledAppUninstallOptions, RuntimeSettings, RuntimeTuneSave, ServiceId, ServiceStatus, VhostAccessDraft, VhostDraft, VirtualHost, WeebXApi } from '../shared/types'

const uninstallListeners = new Set<() => void>()
let uninstallRequested = process.argv.some((argument) => argument.includes('weebx-uninstall'))
ipcRenderer.on('weebx:open-uninstall', () => {
  uninstallRequested = true
  uninstallListeners.forEach((listener) => listener())
})

const api: WeebXApi = {
  snapshot: () => ipcRenderer.invoke('weebx:snapshot'),
  getRuntimeTune: () => ipcRenderer.invoke('weebx:runtime-tune'),
  saveRuntimeTune: (patch: RuntimeTuneSave) => ipcRenderer.invoke('weebx:runtime-tune-save', patch),
  service: (action, id) => ipcRenderer.invoke('weebx:service', action, id),
  serviceAll: (action) => ipcRenderer.invoke('weebx:service-all', action),
  ports: () => ipcRenderer.invoke('weebx:ports'),
  logs: () => ipcRenderer.invoke('weebx:logs'),
  onLog: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, entry: LogEntry) => callback(entry)
    ipcRenderer.on('weebx:log', listener)
    return () => ipcRenderer.removeListener('weebx:log', listener)
  },
  onStatus: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, status: ServiceStatus) => callback(status)
    ipcRenderer.on('weebx:status', listener)
    return () => ipcRenderer.removeListener('weebx:status', listener)
  },
  onInstallProgress: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: InstallProgress) => callback(progress)
    ipcRenderer.on('weebx:install-progress', listener)
    return () => ipcRenderer.removeListener('weebx:install-progress', listener)
  },
  onPreparationProgress: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: PreparationProgress) => callback(progress)
    ipcRenderer.on('weebx:preparation', listener)
    return () => ipcRenderer.removeListener('weebx:preparation', listener)
  },
  preinstalledAppCatalog: () => ipcRenderer.invoke('weebx:preinstalled-app-catalog'),
  installedApps: () => ipcRenderer.invoke('weebx:preinstalled-apps'),
  preflightPreinstalledApp: (request: PreinstalledAppInstallRequest) => ipcRenderer.invoke('weebx:preinstalled-app-preflight', request),
  installPreinstalledApp: (request: PreinstalledAppInstallRequest) => ipcRenderer.invoke('weebx:preinstalled-app-install', request),
  completePreinstalledAppSetup: (id: string) => ipcRenderer.invoke('weebx:preinstalled-app-complete', id),
  uninstallPreinstalledApp: (id: string, options: PreinstalledAppUninstallOptions) => ipcRenderer.invoke('weebx:preinstalled-app-uninstall', id, options),
  preinstalledAppActivity: (installId?: string) => ipcRenderer.invoke('weebx:preinstalled-app-activity', installId),
  onPreinstalledAppProgress: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: PreinstalledAppProgress) => callback(progress)
    ipcRenderer.on('weebx:preinstalled-app-progress', listener)
    return () => ipcRenderer.removeListener('weebx:preinstalled-app-progress', listener)
  },
  readConfig: (kind) => ipcRenderer.invoke('weebx:config-read', kind),
  saveConfig: (kind, content) => ipcRenderer.invoke('weebx:config-save', kind, content),
  validateConfig: (kind) => ipcRenderer.invoke('weebx:config-validate', kind),
  listVhosts: () => ipcRenderer.invoke('weebx:vhosts'),
  createVhost: (draft: VhostDraft) => ipcRenderer.invoke('weebx:vhost-create', draft),
  updateVhostProfile: (id, isolation) => ipcRenderer.invoke('weebx:vhost-profile-update', id, isolation),
  updateVhostAccess: (id, access: VhostAccessDraft) => ipcRenderer.invoke('weebx:vhost-access-update', id, access),
  updateInstalledAppAccess: (id, access: VhostAccessDraft) => ipcRenderer.invoke('weebx:preinstalled-app-access', id, access),
  deleteVhost: (id: string) => ipcRenderer.invoke('weebx:vhost-delete', id),
  setVhostEnabled: (id: string, enabled: boolean): Promise<VirtualHost> => ipcRenderer.invoke('weebx:vhost-enable', id, enabled),
  siteProfileOptions: (version) => ipcRenderer.invoke('weebx:site-profile-options', version),
  revealSiteDatabasePassword: (id) => ipcRenderer.invoke('weebx:site-database-reveal', id),
  revealInstalledAppConnection: (id) => ipcRenderer.invoke('weebx:preinstalled-app-connection', id),
  readSiteLog: (id, kind) => ipcRenderer.invoke('weebx:site-log-read', id, kind),
  selectPhp: (version: string) => ipcRenderer.invoke('weebx:php-select', version),
  setPhpProfile: (profile: PhpProfile) => ipcRenderer.invoke('weebx:php-profile', profile),
  discoverPhpReleases: () => ipcRenderer.invoke('weebx:php-releases'),
  importPhpArchive: () => ipcRenderer.invoke('weebx:php-import'),
  install: (request: InstallRequest) => ipcRenderer.invoke('weebx:install', request),
  updateSettings: (patch: Partial<RuntimeSettings>) => ipcRenderer.invoke('weebx:settings-update', patch),
  updateMariaDbPort: (port: number) => ipcRenderer.invoke('weebx:mariadb-port', port),
  repairLocation: (path?: string) => ipcRenderer.invoke('weebx:repair-location', path),
  openPath: (path: string) => ipcRenderer.invoke('weebx:open-path', path),
  openExternal: (url: string) => ipcRenderer.invoke('weebx:open-external', url),
  chooseDirectory: (startPath?: string) => ipcRenderer.invoke('weebx:choose-directory', startPath),
  completeSecuritySetup: (password) => ipcRenderer.invoke('weebx:security-setup', password),
  changeMariaDbPassword: (password) => ipcRenderer.invoke('weebx:mariadb-password', password),
  revealMariaDbPassword: () => ipcRenderer.invoke('weebx:mariadb-password-reveal'),
  setPermissions: (target: PermissionTarget, preset: PermissionPreset) => ipcRenderer.invoke('weebx:permissions-set', target, preset),
  restartAsAdministrator: () => ipcRenderer.invoke('weebx:restart-elevated'),
  isUninstall: uninstallRequested,
  onOpenUninstall: (callback) => {
    uninstallListeners.add(callback)
    if (uninstallRequested) queueMicrotask(callback)
    return () => { uninstallListeners.delete(callback) }
  },
  uninstallStatus: () => ipcRenderer.invoke('weebx:uninstall-status'),
  uninstallStop: () => ipcRenderer.invoke('weebx:uninstall-stop'),
  uninstall: (options) => ipcRenderer.invoke('weebx:uninstall', options),
  packPortal: (options: PortalOptions) => ipcRenderer.invoke('weebx:portal-pack', options),
  unpackPortal: () => ipcRenderer.invoke('weebx:portal-unpack'),
  onPortalProgress: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: PortalProgress) => callback(progress)
    ipcRenderer.on('weebx:portal-progress', listener)
    return () => ipcRenderer.removeListener('weebx:portal-progress', listener)
  }
}

contextBridge.exposeInMainWorld('weebx', api)

declare global {
  interface Window { weebx: WeebXApi }
}
