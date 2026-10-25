import { contextBridge, ipcRenderer } from 'electron'
import type { InstallProgress, InstallRequest, LogEntry, PhpProfile, PortalOptions, PortalProgress, PreparationProgress, RuntimeSettings, RuntimeTuneSave, ServiceId, ServiceStatus, VhostDraft, VirtualHost, WeebXApi } from '../shared/types'

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
  readConfig: (kind) => ipcRenderer.invoke('weebx:config-read', kind),
  saveConfig: (kind, content) => ipcRenderer.invoke('weebx:config-save', kind, content),
  validateConfig: (kind) => ipcRenderer.invoke('weebx:config-validate', kind),
  listVhosts: () => ipcRenderer.invoke('weebx:vhosts'),
  createVhost: (draft: VhostDraft) => ipcRenderer.invoke('weebx:vhost-create', draft),
  deleteVhost: (id: string) => ipcRenderer.invoke('weebx:vhost-delete', id),
  setVhostEnabled: (id: string, enabled: boolean): Promise<VirtualHost> => ipcRenderer.invoke('weebx:vhost-enable', id, enabled),
  selectPhp: (version: string) => ipcRenderer.invoke('weebx:php-select', version),
  setPhpProfile: (profile: PhpProfile) => ipcRenderer.invoke('weebx:php-profile', profile),
  install: (request: InstallRequest) => ipcRenderer.invoke('weebx:install', request),
  updateSettings: (patch: Partial<RuntimeSettings>) => ipcRenderer.invoke('weebx:settings-update', patch),
  updateMysqlPort: (port: number) => ipcRenderer.invoke('weebx:mysql-port', port),
  repairLocation: (path?: string) => ipcRenderer.invoke('weebx:repair-location', path),
  openPath: (path: string) => ipcRenderer.invoke('weebx:open-path', path),
  openExternal: (url: string) => ipcRenderer.invoke('weebx:open-external', url),
  chooseDirectory: () => ipcRenderer.invoke('weebx:choose-directory'),
  changeMariaDbPassword: (password) => ipcRenderer.invoke('weebx:mariadb-password', password),
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
