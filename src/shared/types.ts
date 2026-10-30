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
  /** Optional private application root when the public web root is a child folder. */
  applicationRoot?: string
  http: boolean
  https: boolean
  /** Redirect the HTTP listener to this host's HTTPS listener. */
  forceHttps?: boolean
  /** While an upstream browser installer is unfinished, only the local machine may connect. */
  setupRestricted?: boolean
  /** Hostnames that WeebX itself added to the Windows hosts file. */
  managedHosts?: string[]
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

export type PreinstalledAppCategory = 'cms' | 'community' | 'commerce' | 'analytics' | 'learning' | 'collaboration' | 'gallery' | 'developer'
export type PreinstalledAppSetup = 'automatic' | 'browser'
export type PreinstalledAppLocation = 'default' | 'side'
export type PreinstalledAppStatus = 'installing' | 'installed' | 'needs-setup' | 'failed' | 'removed'

export interface PreinstalledAppCatalogItem {
  id: string
  name: string
  description: string
  category: PreinstalledAppCategory
  version: string
  license: string
  website: string
  setup: PreinstalledAppSetup
  setupSummary: string
  /** When false, automatic apps skip administrator account fields (pastebins, git viewers). */
  account?: boolean
  database: boolean
  php: {
    minimum: string
    maximum?: string
    recommended: string
    requiredExtensions: string[]
    recommendedExtensions: string[]
  }
}

export interface PreinstalledAppRecord {
  id: string
  catalogId: string
  name: string
  version: string
  status: PreinstalledAppStatus
  location: PreinstalledAppLocation
  siteId: string
  projectName: string
  domain: string
  url: string
  documentRoot: string
  phpVersion: string
  phpExtensions: string[]
  phpProfile?: PhpProfile
  forceHttps?: boolean
  setupRestricted?: boolean
  setup?: PreinstalledAppSetup
  databaseName?: string
  databaseUsername?: string
  siteTitle?: string
  adminUsername?: string
  adminEmail?: string
  adminPath?: string
  setupUrl?: string
  backupPath?: string
  createdAt: string
  updatedAt: string
}

export interface PreinstalledAppConnectionLink {
  label: string
  url: string
}

export interface PreinstalledAppConnection {
  installId: string
  catalogId: string
  name: string
  version: string
  setup: PreinstalledAppSetup
  status: PreinstalledAppStatus
  domain: string
  url: string
  setupUrl?: string
  links: PreinstalledAppConnectionLink[]
  documentRoot: string
  phpVersion: string
  phpProfile?: PhpProfile
  siteTitle?: string
  adminUsername?: string
  adminEmail?: string
  adminPassword?: string
  database?: SiteDatabaseCredential
}

export interface PreinstalledAppInstallRequest {
  catalogId: string
  location: PreinstalledAppLocation
  projectName: string
  domain: string
  http: boolean
  https: boolean
  forceHttps?: boolean
  updateHosts: boolean
  phpVersion: string
  phpExtensions: string[]
  phpProfile?: PhpProfile
  disableDangerousFunctions?: boolean
  allowUserIni?: boolean
  databaseName?: string
  databaseUsername?: string
  siteTitle?: string
  adminUsername?: string
  adminPassword?: string
  adminEmail?: string
}

export interface PreinstalledAppPreflightCheck {
  id: 'request' | 'destination' | 'domain' | 'hosts' | 'services'
  status: 'ready' | 'warning' | 'blocked'
  title: string
  detail: string
}

export interface PreinstalledAppPreflight {
  ready: boolean
  requiresElevation: boolean
  suggestedProjectName?: string
  checks: PreinstalledAppPreflightCheck[]
}

export interface PreinstalledAppUninstallOptions {
  removeFiles: boolean
  removeDatabase: boolean
  removeSite: boolean
}

export interface PreinstalledAppProgress {
  installId: string
  catalogId: string
  phase: 'validating' | 'downloading' | 'extracting' | 'provisioning' | 'configuring' | 'restarting' | 'complete' | 'error'
  percent: number
  message: string
  detail?: string
}

export interface PreinstalledAppActivity {
  id: string
  installId: string
  catalogId: string
  timestamp: string
  level: 'info' | 'warn' | 'error'
  phase: PreinstalledAppProgress['phase'] | 'uninstall'
  message: string
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

export interface VhostAccessDraft {
  http: boolean
  https: boolean
  forceHttps?: boolean
  updateHosts?: boolean
}

export interface VhostDraft {
  name: string
  serverName: string
  aliases: string[]
  documentRoot?: string
  applicationRoot?: string
  http: boolean
  https: boolean
  forceHttps?: boolean
  setupRestricted?: boolean
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
  preinstalledAppCatalog(): Promise<PreinstalledAppCatalogItem[]>
  installedApps(): Promise<PreinstalledAppRecord[]>
  preflightPreinstalledApp(request: PreinstalledAppInstallRequest): Promise<PreinstalledAppPreflight>
  installPreinstalledApp(request: PreinstalledAppInstallRequest): Promise<PreinstalledAppRecord>
  completePreinstalledAppSetup(id: string): Promise<PreinstalledAppRecord>
  uninstallPreinstalledApp(id: string, options: PreinstalledAppUninstallOptions): Promise<PreinstalledAppRecord>
  preinstalledAppActivity(installId?: string): Promise<PreinstalledAppActivity[]>
  onPreinstalledAppProgress(callback: (progress: PreinstalledAppProgress) => void): () => void
  readConfig(kind: 'php' | 'apache' | 'vhosts' | 'mariadb'): Promise<string>
  saveConfig(kind: 'php' | 'apache' | 'vhosts' | 'mariadb', content: string): Promise<void>
  validateConfig(kind: 'php' | 'apache' | 'mariadb'): Promise<{ ok: boolean; output: string }>
  listVhosts(): Promise<VirtualHost[]>
  createVhost(draft: VhostDraft): Promise<VirtualHost>
  updateVhostProfile(id: string, isolation?: SiteIsolationDraft): Promise<VirtualHost>
  updateVhostAccess(id: string, access: VhostAccessDraft): Promise<VirtualHost>
  deleteVhost(id: string): Promise<void>
  setVhostEnabled(id: string, enabled: boolean): Promise<VirtualHost>
  updateInstalledAppAccess(id: string, access: VhostAccessDraft): Promise<PreinstalledAppRecord>
  siteProfileOptions(version: string): Promise<SiteProfileOptions>
  revealSiteDatabasePassword(id: string): Promise<SiteDatabaseCredential | null>
  revealInstalledAppConnection(id: string): Promise<PreinstalledAppConnection | null>
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
  chooseDirectory(startPath?: string): Promise<string | null>
  completeSecuritySetup(password: string): Promise<PublicRuntimeSettings>
  changeMariaDbPassword(password: string): Promise<PublicRuntimeSettings>
  revealMariaDbPassword(): Promise<MariaDbPasswordReveal | null>
  setPermissions(target: PermissionTarget, preset: PermissionPreset): Promise<PermissionResult>
  restartAsAdministrator(): Promise<void>
  isUninstall: boolean
  onOpenUninstall(callback: () => void): () => void
  uninstallStatus(): Promise<{ apache: boolean; mariadb: boolean; weebx: boolean }>
  uninstallStop(): Promise<{ apache: boolean; mariadb: boolean; weebx: boolean; stopped: number }>
  uninstall(options?: { keepHtdocs?: boolean }): Promise<{ savedTo?: string | null }>
  packPortal(options: PortalOptions): Promise<PortalResult>
  unpackPortal(): Promise<PortalResult>
  onPortalProgress(callback: (progress: PortalProgress) => void): () => void
}
