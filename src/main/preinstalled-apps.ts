import { cp, lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import type {
  PreinstalledAppActivity, PreinstalledAppConnection, PreinstalledAppInstallRequest, PreinstalledAppPreflight, PreinstalledAppProgress, PreinstalledAppRecord,
  PreinstalledAppUninstallOptions, SiteIsolationDraft, VhostAccessDraft, VirtualHost
} from '../shared/types'
import type { JsonStore } from './store'
import { vhostPlaceholderHtml, type VhostManager } from './vhost-manager'
import type { LogBuffer } from './logs'
import { catalogConnectionLinks, catalogDownloadUrls, catalogRuntimePolicy, findPreinstalledApp, publicPreinstalledAppCatalog, type InternalPreinstalledApp } from './preinstalled-app-catalog'
import { appFolderSlug, datedAppFolder, defaultAppDomain, isIntentionalMainSiteInstall, isMainSiteHostname, MAIN_SITE_FOLDER, MAIN_SITE_VHOST_ID, nextDatedAppFolder, occupiesMainSite, RESERVED_HTDOCS_NAMES } from '../shared/site-layout'
import { mainSitePath } from './paths'
import { ensureWelcomeSite, removeManagedWelcomeFiles } from './welcome-site'
import { generateStrongPassword } from './security'
import { runMariaDbClient } from './mariadb-password'
import { siteDatabaseCredential, siteProfileOptions, siteProfilePaths } from './site-profile'
import { downloadTrustedHttps } from './secure-download'
import { configureCatalogApp, repairGitListFiles, siteUrl } from './app-installers'

type ProgressListener = (progress: PreinstalledAppProgress) => void
export const APP_DOWNLOAD_HOSTS = new Set([
  'downloads.wordpress.org', 'downloads.joomla.org', 'update.joomla.org', 'ftp.drupal.org', 'github.com', 'codeload.github.com',
  'objects.githubusercontent.com', 'release-assets.githubusercontent.com', 'getgrav.org', 'download.phpbb.com', 'ftp.phpbb-fr.com',
  'releases.wikimedia.org', 'download.nextcloud.com', 'builds.matomo.org', 'download.moodle.org', 'packaging.moodle.org', 'piwigo.org',
  'assets.prestashop3.com'
])
const APP_DOWNLOAD_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 WeebX-Apps'
const SAFE_DEFAULT_ENTRIES = new Set(['index.php', 'phpinfo.php', 'assets', 'phpmyadmin', 'main-site'])
const SAFE_MAIN_SITE_ENTRIES = new Set(['index.php', 'phpinfo.php', 'assets'])
const PRESERVED_DEFAULT_ENTRIES = new Set(['phpmyadmin', 'main-site'])
const DATABASE_IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/i

function within(root: string, candidate: string): boolean {
  const child = relative(resolve(root), resolve(candidate))
  return child === '' || (!child.startsWith('..') && !isAbsolute(child))
}

function versionTuple(value: string): number[] {
  return value.split('.').slice(0, 2).map((part) => Number.parseInt(part, 10) || 0)
}

export function phpVersionCompatible(version: string, minimum: string, maximum?: string): boolean {
  const compare = (left: number[], right: number[]) => left[0] - right[0] || left[1] - right[1]
  const candidate = versionTuple(version)
  return compare(candidate, versionTuple(minimum)) >= 0 && (!maximum || compare(candidate, versionTuple(maximum)) <= 0)
}

export function normalizeAppKey(value: string, fallback: string): string {
  const key = value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24)
  return key || fallback
}

export function unexpectedDefaultEntries(entries: string[]): string[] {
  return entries.filter((name) => !SAFE_DEFAULT_ENTRIES.has(name.toLowerCase()))
}

export function unexpectedMainSiteEntries(entries: string[]): string[] {
  return entries.filter((name) => !SAFE_MAIN_SITE_ENTRIES.has(name.toLowerCase()))
}

export function isRecoverableVhostPlaceholder(entries: string[], content: string, domain: string): boolean {
  return entries.length === 1 && entries[0].toLowerCase() === 'index.php' && content === vhostPlaceholderHtml(domain)
}

export function usesAutomaticLocalhostResolution(domain: string): boolean {
  const normalized = domain.trim().toLowerCase().replace(/\.$/, '')
  return normalized === 'localhost' || normalized.endsWith('.localhost')
}

export function isRetryableDownloadFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /Download failed: HTTP (403|404|408|429|5\d\d)\b/i.test(message)
    || /checksum did not match/i.test(message)
    || /untrusted host/i.test(message)
    || /timed out|ECONNRESET|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|socket hang up|EPIPE/i.test(message)
}

function describeAppDownloadFailure(app: InternalPreinstalledApp, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error)
  if (/HTTP 403/.test(message)) {
    return new Error(`Could not download ${app.name}: the distribution host blocked this request (HTTP 403).`)
  }
  return error instanceof Error ? error : new Error(message)
}

function downloadHostLabel(url: string): string {
  try { return new URL(url).hostname } catch { return 'the primary host' }
}

export function findInstalledApp(records: PreinstalledAppRecord[], id: unknown, includeRemoved = false): PreinstalledAppRecord | undefined {
  const key = typeof id === 'string' ? id.trim() : ''
  if (!key) return undefined
  const pool = includeRemoved ? records : records.filter((item) => item.status !== 'removed')
  const exact = pool.find((item) => item.id === key || item.siteId === key)
  if (exact) return exact
  const loose = pool.filter((item) => item.domain === key || item.documentRoot === key || item.catalogId === key)
  return loose.length === 1 ? loose[0] : undefined
}

function cleanProjectName(value: string): string {
  const clean = value.toLowerCase().trim().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
  if (!clean || clean.length > 64) throw new Error('Project name must contain letters or numbers and be 64 characters or fewer.')
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(clean)) throw new Error('Choose a different project name; that name is reserved by Windows.')
  return clean
}

function validHostname(value: string): boolean {
  return value.length <= 253 && /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(value)
}

export class PreinstalledAppManager {
  private listeners = new Set<ProgressListener>()
  private active = false

  constructor(
    private readonly store: JsonStore,
    private readonly vhosts: VhostManager,
    private readonly logs: LogBuffer
  ) {}

  catalog() { return publicPreinstalledAppCatalog() }

  subscribe(listener: ProgressListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async list(): Promise<PreinstalledAppRecord[]> {
    return (await this.store.getInstalledApps()).filter((item) => item.status !== 'removed')
  }

  /** Move leftover default-site apps out of the htdocs root and off the localhost vhost. */
  async migrateLayout(): Promise<void> {
    const settings = await this.store.getSettings()
    const all = await this.store.getInstalledApps()
    const hosts = await this.vhosts.list()
    let changed = false
    for (const record of all.filter((item) => item.status !== 'removed')) {
      if (isIntentionalMainSiteInstall(record, settings.htdocsRoot)) continue
      const atRoot = resolve(record.documentRoot) === resolve(settings.htdocsRoot)
      const usesLocalhost = isMainSiteHostname(record.domain)
      if (!atRoot && !usesLocalhost && record.location !== 'default') continue
      let documentRoot = record.documentRoot
      if (atRoot) {
        const folderName = await this.allocateAppFolder(settings.htdocsRoot, record.catalogId, record.catalogId)
        const dest = resolve(settings.htdocsRoot, folderName)
        await mkdir(dest, { recursive: true })
        const skip = new Set<string>([...RESERVED_HTDOCS_NAMES, folderName.toLowerCase()])
        for (const host of hosts) {
          for (const root of [host.documentRoot, host.applicationRoot]) {
            if (!root) continue
            const top = relative(resolve(settings.htdocsRoot), resolve(root)).split(/[\\/]/)[0]
            if (top && top !== '.' && !top.startsWith('..')) skip.add(top.toLowerCase())
          }
        }
        for (const name of await readdir(settings.htdocsRoot).catch(() => [])) {
          if (skip.has(name.toLowerCase())) continue
          await rename(join(settings.htdocsRoot, name), join(dest, name)).catch(async () => {
            await cp(join(settings.htdocsRoot, name), join(dest, name), { recursive: true })
            await rm(join(settings.htdocsRoot, name), { recursive: true, force: true })
          })
        }
        const app = findPreinstalledApp(record.catalogId)
        documentRoot = dest
        record.documentRoot = dest
        if (record.siteId) {
          await this.vhosts.relocate(record.siteId, {
            documentRoot: app?.webRoot ? resolve(dest, app.webRoot) : dest,
            applicationRoot: dest
          }).catch(() => undefined)
        }
      }
      if (usesLocalhost) {
        const domain = await this.availableDomain(record.catalogId, all, await this.vhosts.list())
        record.domain = domain
        if (record.siteId) await this.vhosts.relocate(record.siteId, { serverName: domain }).catch(() => undefined)
      }
      record.location = 'side'
      record.url = `${siteUrl({ domain: record.domain, https: /^https:/i.test(record.url) } as PreinstalledAppInstallRequest, settings)}/`
      if (record.setupUrl) {
        try {
          const current = new URL(record.setupUrl)
          record.setupUrl = new URL(`${current.pathname}${current.search}`.replace(/^\//, ''), record.url).toString()
        } catch { /* keep */ }
      }
      record.updatedAt = new Date().toISOString()
      changed = true
      await this.audit(record.id, record.catalogId, 'configuring', 'info', `Moved ${record.name} to a dedicated virtual host at ${record.domain} (${documentRoot}).`)
    }
    if (changed) await this.store.setInstalledApps(all)
    await this.repairCatalogRuntimes()
  }

  private async repairCatalogRuntimes(): Promise<void> {
    const records = await this.list()
    const hosts = await this.vhosts.list()
    for (const host of hosts) {
      if (host.id === MAIN_SITE_VHOST_ID || !isMainSiteHostname(host.serverName)) continue
      const domain = await this.availableDomain(host.name, records, await this.vhosts.list())
      await this.vhosts.relocate(host.id, { serverName: domain }).catch(() => undefined)
    }
    for (const record of records) {
      if (record.catalogId !== 'gitlist') continue
      const app = findPreinstalledApp(record.catalogId)
      if (!app) continue
      const siteDocumentRoot = app.webRoot ? resolve(record.documentRoot, app.webRoot) : record.documentRoot
      await repairGitListFiles(record.documentRoot, siteDocumentRoot).catch(() => undefined)
      const site = hosts.find((item) => item.id === record.siteId)
      const policy = catalogRuntimePolicy(record.catalogId)
      if (!site?.isolation) continue
      const customIni = site.isolation.customIni.includes('E_DEPRECATED')
        ? site.isolation.customIni
        : [site.isolation.customIni.trim(), policy.customIni].filter(Boolean).join('\n')
      if (!site.isolation.disableDangerousFunctions && !site.isolation.openBasedir && customIni === site.isolation.customIni) continue
      const database = site.isolation.database
      await this.vhosts.updateProfile(site.id, {
        phpVersion: site.isolation.phpVersion,
        phpProfile: site.isolation.phpProfile,
        phpExtensions: site.isolation.phpExtensions,
        memoryLimit: site.isolation.memoryLimit,
        maxExecutionTime: site.isolation.maxExecutionTime,
        maxInputTime: site.isolation.maxInputTime,
        maxInputVars: site.isolation.maxInputVars,
        uploadMaxFilesize: site.isolation.uploadMaxFilesize,
        postMaxSize: site.isolation.postMaxSize,
        maxFileUploads: site.isolation.maxFileUploads,
        openBasedir: policy.openBasedir,
        disableDangerousFunctions: policy.disableDangerousFunctions,
        allowUserIni: site.isolation.allowUserIni,
        permissionPreset: site.isolation.permissionPreset,
        customIni,
        database: database ? { databaseName: database.databaseName, username: database.username, access: database.access } : undefined
      }).catch(() => undefined)
    }
  }

  async connection(id: string): Promise<PreinstalledAppConnection> {
    const record = findInstalledApp(await this.list(), id)
    if (!record) throw new Error('Installed app not found.')
    const app = findPreinstalledApp(record.catalogId)
    const settings = await this.store.getSettings()
    const site = (await this.vhosts.list()).find((item) => item.id === record.siteId)
    const password = site?.isolation?.database ? await this.store.getSiteDatabasePassword(site.id) : undefined
    const adminPassword = await this.store.getAppAdminPassword(record.id)
    return {
      installId: record.id,
      catalogId: record.catalogId,
      name: record.name,
      version: record.version,
      setup: record.setup ?? app?.setup ?? (record.setupUrl ? 'browser' : 'automatic'),
      status: record.status,
      domain: record.domain,
      url: record.url,
      ...(record.setupUrl ? { setupUrl: record.setupUrl } : {}),
      links: catalogConnectionLinks(app, record.url, { adminPath: record.adminPath, setupUrl: record.setupUrl }),
      documentRoot: record.documentRoot,
      phpVersion: record.phpVersion,
      phpProfile: record.phpProfile,
      siteTitle: record.siteTitle,
      adminUsername: record.adminUsername,
      adminEmail: record.adminEmail,
      ...(adminPassword ? { adminPassword } : {}),
      ...(site && password ? { database: siteDatabaseCredential(settings, site, password) } : {})
    }
  }

  async activity(installId?: string): Promise<PreinstalledAppActivity[]> {
    const entries = await this.store.getPreinstalledAppActivity()
    return (installId ? entries.filter((item) => item.installId === installId) : entries).slice(-500)
  }

  async preflight(raw: PreinstalledAppInstallRequest, elevated: boolean): Promise<PreinstalledAppPreflight> {
    const checks: PreinstalledAppPreflight['checks'] = []
    const app = findPreinstalledApp(String(raw?.catalogId ?? ''))
    if (!app) return { ready: false, requiresElevation: false, checks: [{ id: 'request', status: 'blocked', title: 'Application selection', detail: 'Choose an app from the WeebX catalog.' }] }

    let request: PreinstalledAppInstallRequest
    try {
      request = await this.validateRequest(raw, app)
      checks.push({ id: 'request', status: 'ready', title: 'Application settings', detail: `${app.name}, PHP ${request.phpVersion}, and the requested database settings are valid.` })
    } catch (error) {
      return { ready: false, requiresElevation: false, checks: [{ id: 'request', status: 'blocked', title: 'Application settings need attention', detail: error instanceof Error ? error.message : String(error) }] }
    }

    const settings = await this.store.getSettings()
    const onMainSite = request.location === 'default'
    const folderName = onMainSite ? MAIN_SITE_FOLDER : await this.allocateAppFolder(settings.htdocsRoot, request.projectName, app.id)
    const activeRecords = await this.list()
    const occupying = activeRecords.find((item) => occupiesMainSite(item, settings.htdocsRoot))
    if (onMainSite && occupying) {
      checks.push({
        id: 'destination', status: 'blocked', title: 'Main website is already in use',
        detail: `${occupying.name} already occupies htdocs\\main-site. Uninstall it first, or install this app on a dedicated virtual host.`
      })
    } else if (onMainSite) {
      const extra = unexpectedMainSiteEntries(await this.directoryEntries(mainSitePath(settings.htdocsRoot)))
      checks.push({
        id: 'destination',
        status: request.clearMainSite && extra.length ? 'warning' : 'ready',
        title: request.clearMainSite && extra.length ? 'Existing main-site files will be deleted' : 'Main website is ready',
        detail: request.clearMainSite
          ? (extra.length
            ? `Delete is on: WeebX will empty htdocs\\main-site (${extra.slice(0, 4).join(', ')}${extra.length > 4 ? '…' : ''}), then copy ${app.name}.`
            : `Files go in htdocs\\main-site. The dashboard Website button will open ${app.name}.`)
          : (extra.length
            ? `Delete is off: matching files in htdocs\\main-site will be replaced. Extra files stay in place.`
            : `Files go in htdocs\\main-site. Matching files are replaced; extra files stay. The dashboard Website button will open ${app.name}.`)
      })
    } else {
      checks.push({
        id: 'destination', status: 'ready', title: 'Destination is ready',
        detail: `Files go in htdocs\\${folderName}. localhost keeps serving htdocs\\main-site.`
      })
    }

    const vhostConflict = (await this.vhosts.list()).some((item) => item.id !== MAIN_SITE_VHOST_ID && (item.serverName === request.domain || item.aliases.includes(request.domain)))
    let suggestedDomain: string | undefined
    if (onMainSite) {
      checks.push({ id: 'domain', status: 'ready', title: 'Main website hostname', detail: 'localhost and 127.0.0.1 will serve this application from htdocs\\main-site.' })
    } else if (activeRecords.some((item) => item.domain === request.domain) || vhostConflict || isMainSiteHostname(request.domain)) {
      suggestedDomain = await this.availableDomain(request.projectName || app.id, activeRecords, await this.vhosts.list())
      checks.push({
        id: 'domain', status: 'blocked', title: isMainSiteHostname(request.domain) ? 'localhost is the main website' : 'Domain is already assigned',
        detail: isMainSiteHostname(request.domain)
          ? `Use the Main website option to occupy localhost, or a virtual-host name such as ${suggestedDomain}.`
          : `${request.domain} is used by another WeebX website. Suggested hostname: ${suggestedDomain}.`
      })
    } else checks.push({ id: 'domain', status: 'ready', title: 'Virtual host is ready', detail: `${request.domain} will be a dedicated Apache virtual host. Point public DNS at this machine to serve this subdomain.` })

    let requiresElevation = false
    if (request.updateHosts && !usesAutomaticLocalhostResolution(request.domain)) {
      const missingHosts = await this.vhosts.hostsNeedingUpdate([request.domain])
      requiresElevation = missingHosts.length > 0 && !elevated
      checks.push(requiresElevation
        ? { id: 'hosts', status: 'blocked', title: 'Administrator mode required', detail: `Windows must map ${request.domain} to this computer. Restart WeebX as administrator, then the wizard can finish everything automatically.` }
        : { id: 'hosts', status: 'ready', title: 'Windows hosts mapping is ready', detail: missingHosts.length ? 'WeebX has permission to add the local domain.' : 'This local domain is already mapped.' })
    } else if (usesAutomaticLocalhostResolution(request.domain)) {
      checks.push({ id: 'hosts', status: 'ready', title: 'No Administrator access needed', detail: `${request.domain} uses localhost resolution automatically; the Windows hosts file will not be changed.` })
    } else {
      checks.push({ id: 'hosts', status: 'warning', title: 'Manual domain mapping selected', detail: `Map ${request.domain} in DNS or the Windows hosts file so browsers reach this virtual host.` })
    }
    checks.push({ id: 'services', status: 'ready', title: 'Services are automatic', detail: `WeebX will start Apache${app.database ? ' and MariaDB' : ''}, then apply the isolated site profile.` })
    return { ready: !checks.some((check) => check.status === 'blocked'), requiresElevation, suggestedFolder: folderName, ...(suggestedDomain ? { suggestedDomain } : {}), checks }
  }

  async markSetupComplete(id: string): Promise<PreinstalledAppRecord> {
    const all = await this.store.getInstalledApps()
    const record = findInstalledApp(all, id)
    if (!record) throw new Error('Installed app not found.')
    if (record.status !== 'needs-setup') return record
    const app = findPreinstalledApp(record.catalogId)
    if (!app) throw new Error('The installed app is no longer present in the catalog.')
    await this.verifyBrowserSetup(app, record)
    await this.removeInstallerArtifacts(app, record)
    await this.vhosts.setSetupRestricted(record.siteId, false)
    record.status = 'installed'
    record.setupRestricted = false
    record.updatedAt = new Date().toISOString()
    delete record.setupUrl
    try { await this.store.setInstalledApps(all) }
    catch (error) {
      await this.vhosts.setSetupRestricted(record.siteId, true).catch(() => undefined)
      throw error
    }
    await this.audit(record.id, record.catalogId, 'complete', 'info', `${record.name} setup was verified; installer-only files were cleaned and public access was enabled.`)
    return record
  }

  async install(raw: PreinstalledAppInstallRequest): Promise<PreinstalledAppRecord> {
    if (this.active) throw new Error('Another app operation is already running. Wait for it to finish.')
    this.active = true
    const installId = crypto.randomUUID()
    const app = findPreinstalledApp(String(raw?.catalogId ?? ''))
    let site: VirtualHost | undefined
    let documentRoot = ''
    let backupPath: string | undefined
    let staged = ''
    let copied = false
    try {
      if (!app) throw new Error('Choose an app from the WeebX catalog.')
      this.emit(installId, app.id, 'validating', 2, `Checking ${app.name} requirements.`)
      const request = await this.validateRequest(raw, app)
      const settings = await this.store.getSettings()
      const onMainSite = request.location === 'default'
      const folderName = onMainSite ? MAIN_SITE_FOLDER : await this.allocateAppFolder(settings.htdocsRoot, request.projectName, app.id)
      documentRoot = onMainSite ? resolve(mainSitePath(settings.htdocsRoot)) : resolve(settings.htdocsRoot, folderName)
      if (!within(settings.htdocsRoot, documentRoot) || resolve(documentRoot) === resolve(settings.htdocsRoot)) {
        throw new Error('The application folder must stay inside htdocs and cannot replace the htdocs root.')
      }
      const activeRecords = await this.list()
      if (onMainSite) {
        if (activeRecords.some((item) => occupiesMainSite(item, settings.htdocsRoot))) {
          throw new Error('The main website already has a catalog application. Uninstall it first, or install this app on a dedicated virtual host.')
        }
      } else if (activeRecords.some((item) => item.domain === request.domain) || isMainSiteHostname(request.domain)) {
        throw new Error('That hostname is already used by another website. Choose a different virtual-host name.')
      }
      if (!onMainSite) {
        let entries = await this.directoryEntries(documentRoot)
        if (await this.isRecoverablePlaceholder(documentRoot, entries, request.domain)) entries = []
        if (entries.length) throw new Error(`The folder “${folderName}” is not empty. Try installing again so WeebX can pick the next dated folder.`)
      }

      const tempRoot = join(settings.runtimeRoot, 'tmp', 'apps', installId)
      const archive = join(tempRoot, 'package.zip')
      staged = join(tempRoot, 'extracted')
      await mkdir(staged, { recursive: true })
      const digest = await this.download(app, archive, installId)
      this.emit(installId, app.id, 'extracting', 48, `${app.expectedSha256 ? 'Checksum verified' : 'HTTPS download hashed'} (${digest.slice(0, 12)}…). Extracting safely.`)
      await this.extractArchive(archive, staged)
      const payload = await this.findPayload(staged, app.payloadHints)
      await this.assertPayload(payload)
      if (onMainSite) {
        backupPath = join(tempRoot, 'main-site-backup')
        await mkdir(backupPath, { recursive: true })
        for (const name of await readdir(documentRoot).catch(() => [])) {
          await cp(join(documentRoot, name), join(backupPath, name), { recursive: true })
        }
      }
      const databasePassword = app.database ? generateStrongPassword(28) : undefined
      const siteDocumentRoot = app.webRoot ? resolve(documentRoot, app.webRoot) : documentRoot
      if (!within(documentRoot, siteDocumentRoot)) throw new Error('The catalog contains an unsafe public web-root path.')
      const runtime = catalogRuntimePolicy(app.id)
      const isolation: SiteIsolationDraft = {
        phpVersion: request.phpVersion, phpProfile: request.phpProfile ?? 'production', phpExtensions: request.phpExtensions,
        memoryLimit: app.id === 'nextcloud' || app.id === 'moodle' ? '512M' : '256M',
        maxExecutionTime: app.id === 'nextcloud' || app.id === 'moodle' ? 300 : 120,
        maxInputTime: 120, maxInputVars: app.id === 'prestashop' ? 10000 : 5000,
        uploadMaxFilesize: app.id === 'nextcloud' ? '512M' : '128M', postMaxSize: app.id === 'nextcloud' ? '512M' : '128M', maxFileUploads: 40,
        openBasedir: runtime.openBasedir, disableDangerousFunctions: app.id === 'gitlist' ? false : request.disableDangerousFunctions !== false, allowUserIni: request.allowUserIni === true, permissionPreset: 'private', customIni: runtime.customIni,
        database: app.database ? { databaseName: request.databaseName!, username: request.databaseUsername!, access: 'read-write', password: databasePassword } : undefined
      }
      this.emit(installId, app.id, 'provisioning', 62, onMainSite
        ? 'Attaching this app to the main website, PHP profile, HTTPS certificate, and database identity.'
        : 'Creating the virtual host, PHP profile, HTTPS certificate, and database identity.')
      site = onMainSite
        ? await this.vhosts.bindMainSite({
          documentRoot: siteDocumentRoot, applicationRoot: documentRoot, http: request.http, https: request.https,
          forceHttps: request.forceHttps, setupRestricted: app.setup === 'browser', isolation
        })
        : await this.vhosts.create({
          name: folderName,
          serverName: request.domain, aliases: [], documentRoot: siteDocumentRoot, applicationRoot: documentRoot, http: request.http, https: request.https,
          forceHttps: request.forceHttps, setupRestricted: app.setup === 'browser',
          updateHosts: request.updateHosts && !usesAutomaticLocalhostResolution(request.domain), isolation
        })

      if (onMainSite) {
        if (request.clearMainSite) await this.clearDirectory(documentRoot, settings.htdocsRoot)
        else await removeManagedWelcomeFiles(documentRoot)
      } else await this.clearDirectory(documentRoot, settings.htdocsRoot)
      await cp(payload, documentRoot, { recursive: true })
      copied = true
      if (app.nestedArchive) await this.extractNestedArchive(app, documentRoot, join(tempRoot, 'nested'))
      if (app.webRoot) {
        const publicIndex = await stat(join(siteDocumentRoot, 'index.php')).catch(() => null)
        if (!publicIndex?.isFile()) throw new Error(`The ${app.name} archive no longer contains the expected ${app.webRoot} public web root.`)
      }

      this.emit(installId, app.id, 'configuring', 82, app.setup === 'automatic' ? (app.account === false ? 'Writing application configuration.' : 'Writing configuration and creating the administrator account.') : 'Preparing the browser setup wizard with managed database credentials.')
      const url = `${siteUrl(request, settings)}/`
      const phpExe = join(settings.runtimeRoot, 'php', request.phpVersion, 'php.exe')
      const profile = siteProfilePaths(settings, site)
      const setupStatus = await configureCatalogApp({
        app, request, site, documentRoot, siteDocumentRoot, databasePassword, settings, phpExe, phpIni: profile.phpIni, profile, siteUrl: siteUrl(request, settings)
      })
      if (setupStatus === 'installed') await this.removeInstallerArtifacts(app, { documentRoot })
      const adminPath = await this.detectAdminPath(app, documentRoot)
      const setupUrl = setupStatus === 'needs-setup' ? new URL(app.setupPath || '', url).toString() : undefined
      const now = new Date().toISOString()
      const record: PreinstalledAppRecord = {
        id: installId, catalogId: app.id, name: app.name, version: app.version,
        status: setupStatus, location: request.location, setup: app.setup,
        siteId: site.id, projectName: request.projectName, domain: request.domain, url, documentRoot,
        phpVersion: request.phpVersion, phpExtensions: request.phpExtensions, phpProfile: request.phpProfile ?? 'production',
        forceHttps: request.forceHttps === true, setupRestricted: setupStatus === 'needs-setup',
        ...(app.database ? { databaseName: request.databaseName, databaseUsername: request.databaseUsername } : {}),
        ...(request.siteTitle ? { siteTitle: String(request.siteTitle).trim() } : {}),
        ...(app.account !== false && request.adminUsername ? { adminUsername: String(request.adminUsername).trim() } : {}),
        ...(app.account !== false && request.adminEmail && app.setup === 'automatic' ? { adminEmail: String(request.adminEmail).trim() } : {}),
        ...(adminPath ? { adminPath } : {}),
        ...(setupUrl ? { setupUrl } : {}), ...(backupPath ? { backupPath } : {}), createdAt: now, updatedAt: now
      }
      await this.writeOwnershipMarker(settings.runtimeRoot, record)
      if (app.setup === 'automatic' && app.account !== false && request.adminPassword) await this.store.setAppAdminPassword(installId, request.adminPassword)
      await this.store.setInstalledApps([...(await this.store.getInstalledApps()), record])
      this.emit(installId, app.id, 'complete', 100, setupStatus === 'installed' ? `${app.name} is ready.` : `${app.name} files are ready. Complete the short browser setup.`)
      return record
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.listeners.forEach((listener) => listener({ installId, catalogId: app?.id ?? String(raw?.catalogId ?? 'unknown'), phase: 'error', percent: 0, message }))
      await this.audit(installId, app?.id ?? String(raw?.catalogId ?? 'unknown'), 'error', 'error', message)
      if (site) await this.vhosts.remove(site.id).catch(() => undefined)
      if (site?.isolation?.database) {
        const settings = await this.store.getSettings()
        await runMariaDbClient(settings, ['-e', `DROP DATABASE IF EXISTS \`${site.isolation.database.databaseName}\`;`], '127.0.0.1', settings.mariadbPassword, undefined, 30000).catch(() => undefined)
      }
      if (documentRoot && (copied || site || backupPath)) {
        const settings = await this.store.getSettings()
        const preserveMainSite = resolve(documentRoot) === resolve(mainSitePath(settings.htdocsRoot))
        if (copied || backupPath) await this.clearDirectory(documentRoot, settings.htdocsRoot).catch(() => undefined)
        if (backupPath) {
          await this.restoreBackup(backupPath, documentRoot).catch(() => undefined)
          await rm(backupPath, { recursive: true, force: true }).catch(() => undefined)
        } else if (preserveMainSite) {
          await ensureWelcomeSite(documentRoot, settings).catch(() => undefined)
        } else await rm(documentRoot, { recursive: true, force: true }).catch(() => undefined)
        await rm(join(settings.runtimeRoot, 'app-records', `${installId}.json`), { force: true }).catch(() => undefined)
      }
      await this.store.deleteAppAdminPassword(installId).catch(() => undefined)
      throw error
    } finally {
      if (staged) await rm(join(staged, '..'), { recursive: true, force: true }).catch(() => undefined)
      this.active = false
    }
  }

  async uninstall(id: string, options: PreinstalledAppUninstallOptions): Promise<PreinstalledAppRecord> {
    if (this.active) throw new Error('Another app operation is already running. Wait for it to finish.')
    this.active = true
    try {
      const all = await this.store.getInstalledApps()
      const alreadyRemoved = findInstalledApp(all, id, true)
      const record = findInstalledApp(all, id)
      if (!record) {
        if (alreadyRemoved) return alreadyRemoved
        throw new Error('Installed app not found.')
      }
      if (![options?.removeFiles, options?.removeDatabase, options?.removeSite].every((value) => typeof value === 'boolean')) throw new Error('Invalid uninstall choices.')
      if (!options.removeFiles && !options.removeDatabase && !options.removeSite) throw new Error('Choose at least one item to remove.')
      if (!options.removeSite) throw new Error('The managed virtual host and database login must be removed when uninstalling. You can still preserve the application files and database data.')
      const settings = await this.store.getSettings()
      if (!within(settings.htdocsRoot, record.documentRoot)) throw new Error('Refusing to remove an app outside htdocs.')
      const rootDetails = await lstat(record.documentRoot).catch(() => null)
      if (rootDetails?.isSymbolicLink()) throw new Error('Refusing to uninstall through a symbolic link or directory junction.')
      await this.verifyOwnershipMarker(settings.runtimeRoot, record)
      await this.audit(record.id, record.catalogId, 'uninstall', 'info', `Uninstalling ${record.name}.`)
      await this.vhosts.remove(record.siteId)
      if (options?.removeDatabase && record.databaseName) {
        if (!DATABASE_IDENTIFIER.test(record.databaseName)) throw new Error('The saved database name is invalid.')
        await runMariaDbClient(settings, ['-e', `DROP DATABASE IF EXISTS \`${record.databaseName}\`;`], '127.0.0.1', settings.mariadbPassword, undefined, 30000)
        await this.audit(record.id, record.catalogId, 'uninstall', 'info', `Removed database ${record.databaseName}.`)
      }
      if (options?.removeFiles !== false) {
        const atHtdocsRoot = resolve(record.documentRoot) === resolve(settings.htdocsRoot)
        const onMainSite = occupiesMainSite(record, settings.htdocsRoot)
        if (onMainSite) {
          const mainSite = mainSitePath(settings.htdocsRoot)
          await this.clearDirectory(mainSite, settings.htdocsRoot)
          await ensureWelcomeSite(mainSite, settings)
        } else if (atHtdocsRoot) await this.clearDirectory(record.documentRoot, settings.htdocsRoot, PRESERVED_DEFAULT_ENTRIES)
        else {
          await this.clearDirectory(record.documentRoot, settings.htdocsRoot)
          await rm(record.documentRoot, { recursive: true, force: true })
        }
      }
      await rm(join(settings.runtimeRoot, 'app-records', `${record.id}.json`), { force: true })
      if (record.backupPath) await rm(record.backupPath, { recursive: true, force: true })
      await this.store.deleteAppAdminPassword(record.id).catch(() => undefined)
      record.status = 'removed'
      record.updatedAt = new Date().toISOString()
      await this.store.setInstalledApps(all)
      await this.audit(record.id, record.catalogId, 'uninstall', 'info', `${record.name} was uninstalled.`)
      return record
    } finally { this.active = false }
  }

  async updateSiteAccess(id: string, access: VhostAccessDraft): Promise<PreinstalledAppRecord> {
    const all = await this.store.getInstalledApps()
    const record = findInstalledApp(all, id)
    if (!record) throw new Error('Installed app not found.')
    const patch = record.siteId === MAIN_SITE_VHOST_ID || record.location === 'default'
      ? { ...access, serverName: undefined, updateHosts: false }
      : access
    const site = await this.vhosts.updateAccess(record.siteId, patch)
    const settings = await this.store.getSettings()
    record.domain = site.serverName
    const url = `${siteUrl({ domain: record.domain, https: site.https } as PreinstalledAppInstallRequest, settings)}/`
    if (record.setupUrl) {
      try {
        const current = new URL(record.setupUrl)
        record.setupUrl = new URL(`${current.pathname}${current.search}`.replace(/^\//, ''), url).toString()
      } catch { /* keep the previous setup URL if it cannot be rewritten */ }
    }
    record.url = url
    record.forceHttps = site.forceHttps === true
    record.updatedAt = new Date().toISOString()
    await this.store.setInstalledApps(all)
    await this.audit(record.id, record.catalogId, 'configuring', 'info', `Updated virtual-host access for ${record.domain}.`)
    return record
  }

  private async validateRequest(raw: PreinstalledAppInstallRequest, app: InternalPreinstalledApp): Promise<PreinstalledAppInstallRequest> {
    if (!raw || typeof raw !== 'object') throw new Error('Choose an application and a virtual-host name.')
    const projectName = cleanProjectName(String(raw.projectName ?? app.id))
    const location = raw.location === 'default' ? 'default' : 'side'
    let domain = String(raw.domain ?? '').trim().toLowerCase()
    if (location === 'default') domain = 'localhost'
    else if (!domain || isMainSiteHostname(domain)) domain = defaultAppDomain(projectName, app.id)
    if (location !== 'default' && isMainSiteHostname(domain)) throw new Error('localhost is reserved for the main website in htdocs\\main-site. Use a virtual-host name such as wordpress.localhost or wordpress.example.com, or choose Main website.')
    if (!validHostname(domain)) throw new Error('Enter a valid domain without a protocol or path.')
    if (!raw.http && !raw.https) throw new Error('Enable HTTP, HTTPS, or both.')
    if (raw.forceHttps && (!raw.http || !raw.https)) throw new Error('HTTPS redirection requires both HTTP and HTTPS to be enabled.')
    const phpProfile = raw.phpProfile === 'development' ? 'development' : 'production'
    if (!phpVersionCompatible(String(raw.phpVersion ?? ''), app.php.minimum, app.php.maximum)) throw new Error(`${app.name} requires PHP ${app.php.minimum}${app.php.maximum ? ` through ${app.php.maximum}` : ' or newer'}.`)
    const available = await siteProfileOptions(await this.store.getSettings(), String(raw.phpVersion))
    const requested = [...new Set((Array.isArray(raw.phpExtensions) ? raw.phpExtensions : []).map(String))]
    const missing = app.php.requiredExtensions.filter((extension) => !available.extensions.includes(extension))
    if (missing.length) throw new Error(`PHP ${raw.phpVersion} is missing required module files: ${missing.join(', ')}.`)
    const phpExtensions = [...new Set([...requested.filter((extension) => available.extensions.includes(extension)), ...app.php.requiredExtensions])].sort()
    let databaseName: string | undefined
    let databaseUsername: string | undefined
    if (app.database) {
      const key = normalizeAppKey(projectName, app.id)
      databaseName = String(raw.databaseName || `${key}_db`).toLowerCase()
      databaseUsername = String(raw.databaseUsername || `${key}_app`).toLowerCase()
      if (!DATABASE_IDENTIFIER.test(databaseName)) throw new Error('Database name may contain letters, numbers, and underscores and must start with a letter.')
      if (!DATABASE_IDENTIFIER.test(databaseUsername) || databaseUsername.length > 32) throw new Error('Database username must start with a letter and be 32 characters or fewer.')
    }
    if (app.setup === 'automatic') {
      if (!String(raw.siteTitle ?? '').trim()) throw new Error('Enter a site title.')
      if (app.account !== false) {
        if (!/^[a-z0-9][a-z0-9_.-]{2,31}$/i.test(String(raw.adminUsername ?? ''))) throw new Error('Administrator username must be 3–32 safe characters.')
        if (String(raw.adminPassword ?? '').length < 12) throw new Error('Administrator password must be at least 12 characters.')
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(raw.adminEmail ?? ''))) throw new Error('Enter a valid administrator email address.')
        if (app.id === 'moodle' && /^(admin)$/i.test(String(raw.adminPassword))) throw new Error('Moodle rejects the password “admin”. Choose a different administrator password.')
        if (app.id === 'moodle' && String(raw.adminPassword) === String(raw.adminUsername)) throw new Error('Moodle requires the administrator password to be different from the username.')
      }
    }
    return {
      ...raw, location, projectName, domain, clearMainSite: location === 'default' && raw.clearMainSite === true,
      updateHosts: location !== 'default' && raw.updateHosts === true && !usesAutomaticLocalhostResolution(domain), phpExtensions, databaseName, databaseUsername, phpProfile,
      forceHttps: raw.forceHttps === true, disableDangerousFunctions: raw.disableDangerousFunctions !== false,
      allowUserIni: raw.allowUserIni === true
    }
  }

  private async download(app: InternalPreinstalledApp, destination: string, installId: string): Promise<string> {
    const urls = catalogDownloadUrls(app)
    let lastError: unknown
    for (let index = 0; index < urls.length; index += 1) {
      const url = urls[index]!
      try {
        const result = await downloadTrustedHttps({
          url,
          destination,
          allowedHosts: APP_DOWNLOAD_HOSTS,
          maximumBytes: 1024 ** 3,
          headers: { 'User-Agent': APP_DOWNLOAD_USER_AGENT },
          onProgress: ({ receivedBytes, totalBytes }) => {
            const percent = totalBytes ? 8 + Math.round((receivedBytes / totalBytes) * 35) : 12
            this.emit(installId, app.id, 'downloading', Math.min(43, percent), `Downloading ${app.name} ${app.version}.`, `${Math.round(receivedBytes / 1048576)}${totalBytes ? ` / ${Math.round(totalBytes / 1048576)}` : ''} MB`)
          }
        })
        const digest = result.sha256
        if (app.expectedSha256 && digest.toLowerCase() !== app.expectedSha256.toLowerCase()) {
          await rm(destination, { force: true }).catch(() => undefined)
          throw new Error(`Security check failed: ${app.name} archive checksum did not match the pinned release.`)
        }
        if (index > 0) {
          this.logs.add('system', 'info', `[Apps] ${app.name} was downloaded from a checksum-pinned mirror after ${downloadHostLabel(urls[0]!)} refused the request.`)
        }
        return digest
      } catch (error) {
        lastError = error
        await rm(destination, { force: true }).catch(() => undefined)
        if (index >= urls.length - 1 || !isRetryableDownloadFailure(error)) throw describeAppDownloadFailure(app, error)
        this.logs.add('system', 'info', `[Apps] ${app.name} download from ${downloadHostLabel(url)} failed; trying a checksum-pinned mirror.`)
      }
    }
    throw describeAppDownloadFailure(app, lastError)
  }

  private async extractArchive(archive: string, destination: string): Promise<void> {
    if (process.platform !== 'win32') throw new Error('Pre-installed app extraction currently requires Windows.')
    const script = [
      '& { param($archive,$destination)', 'Add-Type -AssemblyName System.IO.Compression.FileSystem;',
      '$root=[IO.Path]::GetFullPath($destination+[IO.Path]::DirectorySeparatorChar);', '$zip=[IO.Compression.ZipFile]::OpenRead($archive);',
      'try { $total=0; $count=0; foreach($entry in $zip.Entries){ $count++; if($count -gt 100000){throw "Archive contains too many files"}; if($entry.Length -gt 1073741824){throw "Archive entry exceeds 1 GB"}; if($entry.CompressedLength -gt 0 -and $entry.Length/$entry.CompressedLength -gt 1000){throw "Suspicious archive compression ratio"}; $total += $entry.Length; if($total -gt 2147483648){throw "Expanded archive exceeds 2 GB"};',
      '$target=[IO.Path]::GetFullPath([IO.Path]::Combine($destination,$entry.FullName)); if(-not $target.StartsWith($root,[StringComparison]::OrdinalIgnoreCase)){throw "Unsafe archive path"};',
      'if([string]::IsNullOrEmpty($entry.Name)){[IO.Directory]::CreateDirectory($target)|Out-Null}else{[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target))|Out-Null;',
      '$input=$entry.Open(); try{$output=[IO.File]::Open($target,[IO.FileMode]::Create,[IO.FileAccess]::Write,[IO.FileShare]::None); try{$input.CopyTo($output)}finally{$output.Dispose()}}finally{$input.Dispose()}}}',
      '} finally {$zip.Dispose()} }'
    ].join(' ')
    await new Promise<void>((resolvePromise, reject) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script, archive, destination], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
      let error = ''
      child.stderr.on('data', (value) => { error += value })
      child.once('error', reject)
      child.once('close', (code) => code === 0 ? resolvePromise() : reject(new Error(error.trim() || 'Could not extract the app archive.')))
    })
  }

  private async findPayload(root: string, hints: string[]): Promise<string> {
    if (!hints.length) return root
    const queue: Array<{ path: string; depth: number }> = [{ path: root, depth: 0 }]
    while (queue.length) {
      const current = queue.shift()!
      const entries = await readdir(current.path, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const path = join(current.path, entry.name)
        if (hints.some((hint) => hint.toLowerCase() === entry.name.toLowerCase())) return path
        if (current.depth < 2) queue.push({ path, depth: current.depth + 1 })
      }
    }
    const entries = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory())
    if (entries.length === 1) return join(root, entries[0].name)
    throw new Error(`The official archive layout changed; expected ${hints.join(' or ')}.`)
  }

  private async assertPayload(payload: string): Promise<void> {
    const details = await stat(payload).catch(() => null)
    if (!details?.isDirectory()) throw new Error('The app archive did not contain an application folder.')
    const entries = await readdir(payload)
    if (!entries.some((name) => /^(index\.php|wp-admin|app|public|install\.php)$/i.test(name))) throw new Error('The archive does not look like a deployable PHP application.')
  }

  private async extractNestedArchive(app: InternalPreinstalledApp, documentRoot: string, staged: string): Promise<void> {
    const archive = join(documentRoot, app.nestedArchive!)
    const details = await stat(archive).catch(() => null)
    if (!details?.isFile()) throw new Error(`The ${app.name} archive no longer contains the expected nested package.`)
    await mkdir(staged, { recursive: true })
    await this.extractArchive(archive, staged)
    const payload = await this.findPayload(staged, [])
    await cp(payload, documentRoot, { recursive: true })
    await rm(archive, { force: true })
  }

  private async directoryEntries(folder: string): Promise<string[]> {
    const details = await lstat(folder).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    if (!details) return []
    if (details.isSymbolicLink()) throw new Error('The selected application folder is a symbolic link or directory junction. Choose a normal folder inside htdocs.')
    if (!details.isDirectory()) throw new Error('The selected application path is not a folder. Choose another project name.')
    return readdir(folder)
  }

  private async isRecoverablePlaceholder(folder: string, entries: string[], domain: string): Promise<boolean> {
    if (entries.length !== 1 || entries[0].toLowerCase() !== 'index.php') return false
    const content = await readFile(join(folder, entries[0]), 'utf8').catch(() => '')
    return isRecoverableVhostPlaceholder(entries, content, domain)
  }

  private async allocateAppFolder(htdocsRoot: string, projectName: string, fallback: string): Promise<string> {
    const entries = await readdir(htdocsRoot).catch(() => [])
    const hosts = await this.vhosts.list()
    return nextDatedAppFolder(datedAppFolder(projectName || fallback, new Date(), fallback), [...entries, ...RESERVED_HTDOCS_NAMES, ...hosts.map((item) => item.name)])
  }

  private async availableDomain(slug: string, apps: PreinstalledAppRecord[], hosts: VirtualHost[]): Promise<string> {
    const used = new Set([
      'localhost',
      '127.0.0.1',
      ...apps.map((item) => item.domain.toLowerCase()),
      ...hosts.flatMap((item) => [item.serverName, ...item.aliases].map((host) => host.toLowerCase()))
    ])
    const base = defaultAppDomain(slug)
    if (!used.has(base)) return base
    const prefix = appFolderSlug(slug)
    for (let suffix = 2; suffix < 10_000; suffix += 1) {
      const candidate = `${prefix}-${suffix}.localhost`
      if (!used.has(candidate)) return candidate
    }
    throw new Error('Could not find an available virtual-host name.')
  }

  private async clearDirectory(folder: string, htdocsRoot: string, preserve?: ReadonlySet<string>): Promise<void> {
    if (!within(htdocsRoot, folder)) throw new Error('Refusing to clear a folder outside htdocs.')
    const details = await lstat(folder).catch(() => null)
    if (details?.isSymbolicLink()) throw new Error('Refusing to clear a symbolic link or directory junction.')
    for (const name of await readdir(folder).catch(() => [])) {
      if (!preserve?.has(name.toLowerCase())) await rm(join(folder, name), { recursive: true, force: true })
    }
  }

  private async verifyBrowserSetup(app: InternalPreinstalledApp, record: PreinstalledAppRecord): Promise<void> {
    if (!app.completionFiles?.length && !app.completionDirectories?.length) throw new Error(`WeebX has no safe completion check for ${app.name}; update the app catalog before exposing this site.`)
    for (const relativePath of app.completionFiles ?? []) {
      const target = resolve(record.documentRoot, relativePath)
      if (!within(record.documentRoot, target)) throw new Error('The catalog contains an unsafe setup-completion path.')
      const details = await lstat(target).catch(() => null)
      if (!details?.isFile() || details.size < 16) throw new Error(`Finish the ${app.name} browser installer first. WeebX could not verify ${relativePath}.`)
    }
    for (const check of app.completionDirectories ?? []) {
      const target = resolve(record.documentRoot, check.path)
      if (!within(record.documentRoot, target)) throw new Error('The catalog contains an unsafe setup-completion path.')
      const directory = await lstat(target).catch(() => null)
      if (!directory?.isDirectory() || directory.isSymbolicLink()) throw new Error(`Finish the ${app.name} browser installer first. WeebX could not verify ${check.path}.`)
      const entries = await readdir(target, { withFileTypes: true }).catch(() => [])
      if (!entries.some((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(check.suffix.toLowerCase()))) {
        throw new Error(`Finish the ${app.name} browser installer first. WeebX could not verify an account in ${check.path}.`)
      }
    }
  }

  private async removeInstallerArtifacts(app: InternalPreinstalledApp, record: Pick<PreinstalledAppRecord, 'documentRoot'>): Promise<void> {
    for (const relativePath of app.cleanupPaths ?? []) {
      const target = resolve(record.documentRoot, relativePath)
      if (!within(record.documentRoot, target) || target === resolve(record.documentRoot)) throw new Error('The catalog contains an unsafe cleanup path.')
      await rm(target, { recursive: true, force: true })
    }
  }

  private async restoreBackup(backup: string, destination: string): Promise<void> {
    await mkdir(destination, { recursive: true })
    for (const name of await readdir(backup).catch(() => [])) await cp(join(backup, name), join(destination, name), { recursive: true })
  }

  private async writeOwnershipMarker(runtimeRoot: string, record: PreinstalledAppRecord): Promise<void> {
    const folder = join(runtimeRoot, 'app-records')
    await mkdir(folder, { recursive: true })
    await writeFile(join(folder, `${record.id}.json`), JSON.stringify({ id: record.id, documentRoot: resolve(record.documentRoot) }), { encoding: 'utf8', mode: 0o600 })
  }

  private async verifyOwnershipMarker(runtimeRoot: string, record: PreinstalledAppRecord): Promise<void> {
    const file = join(runtimeRoot, 'app-records', `${record.id}.json`)
    const raw = await readFile(file, 'utf8').catch(() => '')
    let marker: { id?: string; documentRoot?: string } = {}
    try { marker = JSON.parse(raw) as typeof marker } catch { /* rejected below */ }
    if (marker.id !== record.id || resolve(String(marker.documentRoot ?? '')) !== resolve(record.documentRoot)) throw new Error('The app ownership marker is missing or invalid. Files were not removed.')
  }

  private async detectAdminPath(app: InternalPreinstalledApp, documentRoot: string): Promise<string | undefined> {
    if (app.id === 'prestashop') {
      for (const name of await readdir(documentRoot).catch(() => [])) {
        if (!/^admin/i.test(name) || /^admin-api$/i.test(name)) continue
        const info = await lstat(join(documentRoot, name)).catch(() => null)
        if (info?.isDirectory()) return `${name}/`
      }
    }
    return app.adminPath
  }

  private emit(installId: string, catalogId: string, phase: PreinstalledAppProgress['phase'], percent: number, message: string, detail?: string): void {
    const progress = { installId, catalogId, phase, percent, message, ...(detail ? { detail } : {}) }
    this.listeners.forEach((listener) => listener(progress))
    if (phase !== 'downloading') void this.audit(installId, catalogId, phase, phase === 'error' ? 'error' : 'info', detail ? `${message} ${detail}` : message)
  }

  private async audit(installId: string, catalogId: string, phase: PreinstalledAppActivity['phase'], level: PreinstalledAppActivity['level'], message: string): Promise<void> {
    await this.store.addPreinstalledAppActivity({ id: crypto.randomUUID(), installId, catalogId, timestamp: new Date().toISOString(), level, phase, message })
    this.logs.add('system', level, `[Apps] ${message}`)
  }
}
