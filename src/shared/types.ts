export type ServiceId = 'apache' | 'mariadb'
export type ServiceState = 'running' | 'stopped' | 'starting' | 'stopping' | 'error'
export type PhpProfile = 'development' | 'production'
export type PasswordStrength = 'empty' | 'weak' | 'strong'
export type AutoRestartDelayMs = 5000 | 10000 | 30000 | 60000 | 300000

export interface ServiceStatus {
  id: ServiceId
  name: string
  state: ServiceState
  pid: number | null
  port: number
  version: string | null
  startedAt: string | null
  message?: string
}

export interface PortInfo {
  port: number
  available: boolean
  pid: number | null
  processName: string | null
}

export interface VirtualHost {
  id: string
  name: string
  serverName: string
  aliases: string[]
  documentRoot: string
  http: boolean
  https: boolean
  enabled: boolean
  createdAt: string
  isolation?: SiteIsolationProfile
}

export type SiteDatabaseAccess = 'read-write' | 'read-only'

export interface SiteDatabaseProfile {
  databaseName: string
  username: string
  access: SiteDatabaseAccess
  passwordSet: boolean
}

export interface SiteIsolationProfile {
  phpVersion: string
  phpProfile: PhpProfile
  phpExtensions: string[]
  memoryLimit: string
  maxExecutionTime: number
  maxInputTime: number
  maxInputVars: number
  uploadMaxFilesize: string
  postMaxSize: string
  maxFileUploads: number
  openBasedir: boolean
  disableDangerousFunctions: boolean
  allowUserIni: boolean
  permissionPreset: PermissionPreset
  customIni: string
  database?: SiteDatabaseProfile
}

export interface SiteIsolationDraft extends Omit<SiteIsolationProfile, 'database'> {
  database?: Omit<SiteDatabaseProfile, 'passwordSet'> & { password?: string }
}

export interface SiteProfileOptions {
  phpVersion: string
  extensions: string[]
  recommendedExtensions: string[]
}

export interface SiteDatabaseCredential {
  siteId: string
  host: '127.0.0.1'
  port: number
  databaseName: string
  username: string
  password: string
  access: SiteDatabaseAccess
}

export type SiteLogKind = 'php' | 'apache-error' | 'apache-access'

export interface SiteLogSnapshot {
  kind: SiteLogKind
  path: string
  content: string
  truncated: boolean
}

export interface PhpVersion {
  version: string
  installed: boolean
  active: boolean
  channel: 'security' | 'stable' | 'preview'
  path?: string
}

export interface RuntimeSettings {
  runtimeRoot: string
  htdocsRoot: string
  apachePort: number
  apacheSslPort: number
  mariadbPort: number
  mariadbPassword: string
  activePhpVersion: string
  phpProfile: PhpProfile
  setupComplete: boolean
  startOnLaunch: boolean
  minimizeToTray: boolean
  checkPortsBeforeStart: boolean
  startWithWindows: boolean
  autoRestartApache: boolean
  autoRestartMariaDb: boolean
  autoRestartDelayMs: AutoRestartDelayMs
}

export type PublicRuntimeSettings = Omit<RuntimeSettings, 'mariadbPassword'> & {
  mariadbPasswordSet: boolean
  mariadbPasswordStrength: PasswordStrength
}

export interface MariaDbPasswordReveal {
  password: string
  protection: 'windows-encrypted-confirmation'
}

export interface PhpRelease {
  version: string
  branch: string
  url: string
  sha256: string
  size: string
  compiler: string
  channel: 'security' | 'stable' | 'preview'
}

export type PermissionTarget = 'runtime' | 'htdocs' | 'database'
export type PermissionPreset = 'private' | 'writable' | 'windows-default'

export interface PermissionResult {
  target: PermissionTarget
  path: string
  preset: PermissionPreset
  message: string
}

export type StackComponentId = 'apache' | 'mariadb' | 'phpmyadmin'
export type StackComponentStatus = 'missing' | 'installed' | 'outdated'

export interface StackComponent {
  id: StackComponentId
  installedVersion: string | null
  offeredVersion: string
  status: StackComponentStatus
}

export interface DashboardSnapshot {
  services: ServiceStatus[]
  ports: PortInfo[]
  settings: PublicRuntimeSettings
  phpVersions: PhpVersion[]
  virtualHosts: VirtualHost[]
  stackComponents: StackComponent[]
  elevated: boolean
}

export interface InstallResult {
  updated: boolean
  mariaDbNeedsUpgrade: boolean
}

export interface LogEntry {
  id: string
  timestamp: string
  service: ServiceId | 'system'
  level: 'info' | 'warn' | 'error'
  message: string
}

export interface InstallRequest {
  component: 'php' | 'apache' | 'mariadb' | 'phpmyadmin'
  version: string
  url: string
  sha256: string
}

export interface InstallProgress {
  component: InstallRequest['component']
  version: string
  phase: 'downloading' | 'verifying' | 'extracting' | 'configuring' | 'complete' | 'error'
  percent: number
  message: string
  detail?: string
  elapsedSeconds?: number
  etaSeconds?: number | null
  completedBytes?: number
  totalBytes?: number
}

export interface PreparationProgress {
  phase: 'scanning' | 'copying' | 'database' | 'configuring' | 'checking' | 'complete' | 'cancelling'
  percent: number
  message: string
  detail: string
  completedFiles: number
  totalFiles: number
  completedBytes: number
  totalBytes: number
  elapsedSeconds: number
  etaSeconds: number | null
  speedBytesPerSecond: number
}

export interface RelocationResult {
  repaired: boolean
  runtimeRoot: string
  message: string
}

export interface PortalOptions {
  includeDb: boolean
  includeHtdocs: boolean
}

export interface PortalProgress {
  phase: 'scanning' | 'copying' | 'complete' | 'error'
  percent: number
  message: string
  detail: string
  completedFiles: number
  totalFiles: number
}

export interface PortalResult {
  folder: string
}

export interface VhostDraft {
  name: string
  serverName: string
  aliases: string[]
  documentRoot?: string
  http: boolean
  https: boolean
  updateHosts: boolean
  isolation?: SiteIsolationDraft
}

export interface RuntimeModule {
  id: string
  label: string
  file: string
  enabled: boolean
  required: boolean
  kind: 'php' | 'zend' | 'apache'
}

export interface PhpLimits {
  memory_limit: string
  post_max_size: string
  upload_max_filesize: string
  max_file_uploads: string
  max_execution_time: string
  max_input_time: string
  max_input_vars: string
}

export interface RuntimeTune {
  phpExtensions: RuntimeModule[]
  apacheModules: RuntimeModule[]
  phpLimits: PhpLimits
}

export interface RuntimeTuneSave {
  phpExtensions: Record<string, boolean>
  apacheModules: Record<string, boolean>
  phpLimits: PhpLimits
}

export interface WeebXApi {
  snapshot(): Promise<DashboardSnapshot>
  getRuntimeTune(): Promise<RuntimeTune>
  saveRuntimeTune(patch: RuntimeTuneSave): Promise<{ restarted: boolean; message: string }>
  service(action: 'start' | 'stop' | 'restart', id: ServiceId): Promise<ServiceStatus>
  serviceAll(action: 'start' | 'stop'): Promise<ServiceStatus[]>
  ports(): Promise<PortInfo[]>
  logs(): Promise<LogEntry[]>
  onLog(callback: (entry: LogEntry) => void): () => void
  onStatus(callback: (status: ServiceStatus) => void): () => void
  onInstallProgress(callback: (progress: InstallProgress) => void): () => void
  onPreparationProgress(callback: (progress: PreparationProgress) => void): () => void
  readConfig(kind: 'php' | 'apache' | 'vhosts' | 'mariadb'): Promise<string>
  saveConfig(kind: 'php' | 'apache' | 'vhosts' | 'mariadb', content: string): Promise<void>
  validateConfig(kind: 'php' | 'apache' | 'mariadb'): Promise<{ ok: boolean; output: string }>
  listVhosts(): Promise<VirtualHost[]>
  createVhost(draft: VhostDraft): Promise<VirtualHost>
  updateVhostProfile(id: string, isolation?: SiteIsolationDraft): Promise<VirtualHost>
  deleteVhost(id: string): Promise<void>
  setVhostEnabled(id: string, enabled: boolean): Promise<VirtualHost>
  siteProfileOptions(version: string): Promise<SiteProfileOptions>
  revealSiteDatabasePassword(id: string): Promise<SiteDatabaseCredential | null>
  readSiteLog(id: string, kind: SiteLogKind): Promise<SiteLogSnapshot>
  selectPhp(version: string): Promise<void>
  setPhpProfile(profile: PhpProfile): Promise<void>
  discoverPhpReleases(): Promise<PhpRelease[]>
  importPhpArchive(): Promise<PhpVersion | null>
  install(request: InstallRequest): Promise<InstallResult>
  updateSettings(patch: Partial<RuntimeSettings>): Promise<PublicRuntimeSettings>
  updateMariaDbPort(port: number): Promise<PublicRuntimeSettings>
  repairLocation(path?: string): Promise<RelocationResult>
  openPath(path: string): Promise<void>
  openExternal(url: string): Promise<void>
  chooseDirectory(): Promise<string | null>
  completeSecuritySetup(password: string): Promise<PublicRuntimeSettings>
  changeMariaDbPassword(password: string): Promise<PublicRuntimeSettings>
  revealMariaDbPassword(): Promise<MariaDbPasswordReveal | null>
  setPermissions(target: PermissionTarget, preset: PermissionPreset): Promise<PermissionResult>
  isUninstall: boolean
  onOpenUninstall(callback: () => void): () => void
  uninstallStatus(): Promise<{ apache: boolean; mariadb: boolean; weebx: boolean }>
  uninstallStop(): Promise<{ apache: boolean; mariadb: boolean; weebx: boolean; stopped: number }>
  uninstall(options?: { keepHtdocs?: boolean }): Promise<{ savedTo?: string | null }>
  packPortal(options: PortalOptions): Promise<PortalResult>
  unpackPortal(): Promise<PortalResult>
  onPortalProgress(callback: (progress: PortalProgress) => void): () => void
}
