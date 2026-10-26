import { access, appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { RuntimeSettings, SiteIsolationDraft, VhostDraft, VirtualHost } from '../shared/types'
import type { JsonStore } from './store'
import type { ConfigManager } from './config-manager'
import type { LogBuffer } from './logs'
import { runtimePaths } from './paths'
import { dropSiteDatabaseUser, normalizeSiteIsolation, provisionSiteDatabase, siteProfilePaths, writeSitePhpIni } from './site-profile'

const execFileAsync = promisify(execFile)
const BEGIN = '# BEGIN WEEBX MANAGED VHOSTS'
const END = '# END WEEBX MANAGED VHOSTS'

function validHostname(value: string): boolean {
  return value.length <= 253 && /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(value)
}

function cleanName(value: string): string {
  const clean = value.toLowerCase().trim().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
  if (!clean) throw new Error('Project name must contain letters or numbers.')
  if (clean.length > 64) throw new Error('Project name must be 64 characters or fewer.')
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(clean)) throw new Error('Choose a different project name; that name is reserved by Windows.')
  return clean
}

function assertStoredVhost(vhost: VirtualHost, settings: RuntimeSettings): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(vhost.id)) throw new Error('A saved virtual host has an invalid identifier.')
  cleanName(vhost.name)
  if (cleanName(vhost.name) !== vhost.name) throw new Error('A saved virtual host has an invalid project name.')
  if (!validHostname(vhost.serverName) || vhost.aliases.some((item) => !validHostname(item))) throw new Error('A saved virtual host contains an invalid hostname.')
  const documentRoot = resolve(vhost.documentRoot)
  const documentRelative = relative(resolve(settings.htdocsRoot), documentRoot)
  if (documentRelative.startsWith('..') || isAbsolute(documentRelative)) throw new Error('A saved virtual host points outside htdocs.')
}

export class VhostManager {
  constructor(
    private readonly store: JsonStore,
    private readonly configs: ConfigManager,
    private readonly logs: LogBuffer
  ) {}

  async list(): Promise<VirtualHost[]> { return this.store.getVhosts() }

  async create(draft: VhostDraft): Promise<VirtualHost> {
    const settings = await this.store.getSettings()
    const name = cleanName(draft.name)
    const serverName = draft.serverName.trim().toLowerCase()
    const aliases = [...new Set(draft.aliases.map((item) => item.trim().toLowerCase()).filter(Boolean))]
    if (!validHostname(serverName) || aliases.some((item) => !validHostname(item))) throw new Error('Enter valid hostnames without a protocol or path.')
    if (!draft.http && !draft.https) throw new Error('Enable HTTP, HTTPS, or both.')
    const existing = await this.store.getVhosts()
    if (existing.some((item) => item.name === name)) throw new Error('That project name is already used by another site.')
    const requestedHosts = new Set([serverName, ...aliases])
    if (existing.some((item) => [item.serverName, ...item.aliases].some((host) => requestedHosts.has(host)))) throw new Error('That server name or alias is already assigned to another site.')
    const documentRoot = resolve(draft.documentRoot || join(settings.htdocsRoot, name))
    const documentRelative = relative(resolve(settings.htdocsRoot), documentRoot)
    if (documentRelative.startsWith('..') || isAbsolute(documentRelative)) {
      throw new Error('Virtual-host document roots must stay inside the configured htdocs folder.')
    }
    await mkdir(documentRoot, { recursive: true })
    const indexFile = join(documentRoot, 'index.php')
    try { await access(indexFile) } catch {
      await writeFile(indexFile, `<?php declare(strict_types=1); ?><h1>${serverName}</h1><p>Served by WeebX · PHP <?= PHP_VERSION ?></p>`, 'utf8')
    }
    const id = crypto.randomUUID()
    const normalized = draft.isolation ? await normalizeSiteIsolation(settings, draft.isolation) : undefined
    if (normalized?.profile.database && existing.some((item) => item.isolation?.database && (item.isolation.database.username === normalized.profile.database!.username || item.isolation.database.databaseName === normalized.profile.database!.databaseName))) {
      throw new Error('Each isolated site must use a unique database name and database username.')
    }
    const vhost: VirtualHost = {
      id, name, serverName, aliases, documentRoot,
      http: draft.http, https: draft.https, enabled: true, createdAt: new Date().toISOString()
    }
    if (normalized) vhost.isolation = normalized.profile
    if (vhost.https) await this.ensureCertificate(vhost)
    if (vhost.isolation) {
      await writeSitePhpIni(settings, vhost)
      if (vhost.isolation.database && normalized?.databasePassword) {
        await provisionSiteDatabase(settings, vhost.isolation, normalized.databasePassword, false)
        try { await this.store.setSiteDatabasePassword(id, normalized.databasePassword) }
        catch (error) {
          await dropSiteDatabaseUser(settings, vhost.isolation).catch(() => undefined)
          throw error
        }
      }
    }
    await this.store.setVhosts([...existing, vhost])
    await this.render()
    if (draft.updateHosts) await this.addHosts([serverName, ...aliases])
    this.logs.add('system', 'info', `Created virtual host ${serverName}.`)
    return vhost
  }

  async remove(id: string): Promise<void> {
    const all = await this.store.getVhosts()
    const target = all.find((item) => item.id === id)
    if (!target) return
    if (target.isolation?.database) await dropSiteDatabaseUser(await this.store.getSettings(), target.isolation)
    await this.store.setVhosts(all.filter((item) => item.id !== id))
    await this.store.deleteSiteDatabasePassword(id)
    await this.render()
    this.logs.add('system', 'info', `Removed virtual host ${target.serverName}; its document root was preserved.`)
  }

  async updateProfile(id: string, draft?: SiteIsolationDraft): Promise<VirtualHost> {
    const settings = await this.store.getSettings()
    const all = await this.store.getVhosts()
    const target = all.find((item) => item.id === id)
    if (!target) throw new Error('Virtual host not found.')
    const previous = target.isolation
    if (!draft) {
      if (previous?.database) await dropSiteDatabaseUser(settings, previous)
      delete target.isolation
      await this.store.deleteSiteDatabasePassword(id)
    } else {
      const existingPassword = await this.store.getSiteDatabasePassword(id)
      const sameDatabaseIdentity = Boolean(existingPassword && previous?.database && draft.database && previous.database.databaseName === draft.database.databaseName && previous.database.username === draft.database.username)
      const normalized = await normalizeSiteIsolation(settings, {
        ...draft,
        database: draft.database ? { ...draft.database, password: draft.database.password || (sameDatabaseIdentity ? existingPassword : undefined) } : undefined
      })
      if (normalized.profile.database && all.some((item) => item.id !== id && item.isolation?.database && (item.isolation.database.username === normalized.profile.database!.username || item.isolation.database.databaseName === normalized.profile.database!.databaseName))) {
        throw new Error('Each isolated site must use a unique database name and database username.')
      }
      await writeSitePhpIni(settings, { ...target, isolation: normalized.profile })
      if (normalized.profile.database && normalized.databasePassword) {
        await provisionSiteDatabase(settings, normalized.profile, normalized.databasePassword, Boolean(previous?.database && previous.database.username === normalized.profile.database.username))
        const identityChanged = Boolean(previous?.database && previous.database.username !== normalized.profile.database.username)
        if (identityChanged && previous) {
          try { await dropSiteDatabaseUser(settings, previous) }
          catch (error) {
            await dropSiteDatabaseUser(settings, normalized.profile).catch(() => undefined)
            throw error
          }
        }
        try { await this.store.setSiteDatabasePassword(id, normalized.databasePassword) }
        catch (error) {
          if (sameDatabaseIdentity && existingPassword) await provisionSiteDatabase(settings, normalized.profile, existingPassword).catch(() => undefined)
          else await dropSiteDatabaseUser(settings, normalized.profile).catch(() => undefined)
          throw error
        }
      } else {
        if (previous?.database) await dropSiteDatabaseUser(settings, previous)
        await this.store.deleteSiteDatabasePassword(id)
      }
      target.isolation = normalized.profile
    }
    await this.store.setVhosts(all)
    await this.render()
    this.logs.add('system', 'info', `${target.serverName} isolated profile ${target.isolation ? 'updated' : 'disabled'}.`)
    return target
  }

  async setEnabled(id: string, enabled: boolean): Promise<VirtualHost> {
    const all = await this.store.getVhosts()
    const target = all.find((item) => item.id === id)
    if (!target) throw new Error('Virtual host not found.')
    target.enabled = enabled
    await this.store.setVhosts(all)
    await this.render()
    return target
  }

  async render(): Promise<void> {
    const all = await this.store.getVhosts()
    const settings = await this.store.getSettings()
    const current = await this.configs.read('vhosts')
    const start = current.indexOf(BEGIN)
    const finish = current.indexOf(END)
    const userContent = start >= 0 && finish > start
      ? `${current.slice(0, start).trimEnd()}\n${current.slice(finish + END.length).trimStart()}`.trim()
      : current.trim()
    for (const item of all.filter((site) => site.isolation)) await writeSitePhpIni(settings, item, false)
    const blocks = all.filter((item) => item.enabled).map((item) => this.block(item, settings)).join('\n\n')
    const next = `${userContent}${userContent ? '\n\n' : ''}${BEGIN}\n${blocks}\n${END}\n`
    await this.configs.save('vhosts', next)
  }

  private block(vhost: VirtualHost, settings: RuntimeSettings): string {
    assertStoredVhost(vhost, settings)
    const lines: string[] = [`# ${vhost.name}`]
    const profile = vhost.isolation ? this.profileDirectives(vhost, settings) : []
    const common = [
      `    ServerName ${vhost.serverName}`,
      ...(vhost.aliases.length ? [`    ServerAlias ${vhost.aliases.join(' ')}`] : []),
      `    DocumentRoot "${vhost.documentRoot.replace(/\\/g, '/')}"`,
      `    <Directory "${vhost.documentRoot.replace(/\\/g, '/')}">`,
      '        Options -Indexes +FollowSymLinks',
      '        AllowOverride All',
      '        Require all granted',
      ...(vhost.isolation ? ['        AddHandler application/x-httpd-php .php'] : []),
      '    </Directory>',
      ...profile
    ]
    if (vhost.http) lines.push(`<VirtualHost *:${settings.apachePort}>`, ...common, '</VirtualHost>')
    if (vhost.https) {
      const cert = this.certPaths(vhost, settings.runtimeRoot)
      lines.push(`<VirtualHost *:${settings.apacheSslPort}>`, ...common, '    SSLEngine on', `    SSLCertificateFile "${cert.crt.replace(/\\/g, '/')}"`, `    SSLCertificateKeyFile "${cert.key.replace(/\\/g, '/')}"`, '</VirtualHost>')
    }
    return lines.join('\n')
  }

  private profileDirectives(vhost: VirtualHost, settings: RuntimeSettings): string[] {
    if (!vhost.isolation) return []
    const profilePaths = siteProfilePaths(settings, vhost)
    const phpRoot = join(settings.runtimeRoot, 'php', vhost.isolation.phpVersion).replace(/\\/g, '/')
    const handler = 'application/x-httpd-php'
    const cgiUrl = `/weebx-site-${vhost.id.replace(/-/g, '')}/`
    return [
      `    ErrorLog "${join(profilePaths.logs, 'apache-error.log').replace(/\\/g, '/')}"`,
      `    CustomLog "${join(profilePaths.logs, 'apache-access.log').replace(/\\/g, '/')}" combined`,
      `    ScriptAlias ${cgiUrl} "${phpRoot}/"`,
      `    <Directory "${phpRoot}">`,
      '        Options None',
      '        AllowOverride None',
      '        Require all denied',
      '        <Files "php-cgi.exe">',
      '            Require all granted',
      '        </Files>',
      '    </Directory>',
      `    SetEnv PHPRC "${profilePaths.php.replace(/\\/g, '/')}"`,
      `    Action ${handler} "${cgiUrl}php-cgi.exe"`
    ]
  }

  private async ensureCertificate(vhost: VirtualHost): Promise<void> {
    const settings = await this.store.getSettings()
    const paths = runtimePaths(settings)
    const cert = this.certPaths(vhost, settings.runtimeRoot)
    try { await access(cert.crt); await access(cert.key); return } catch { /* create */ }
    await mkdir(dirname(cert.crt), { recursive: true })
    const openssl = join(paths.apache, 'bin', 'openssl.exe')
    try {
      await execFileAsync(openssl, ['req', '-x509', '-nodes', '-newkey', 'rsa:2048', '-keyout', cert.key, '-out', cert.crt, '-days', '825', '-subj', `/CN=${vhost.serverName}`, '-addext', `subjectAltName=DNS:${[vhost.serverName, ...vhost.aliases].join(',DNS:')}`], { windowsHide: true })
    } catch (error) {
      throw new Error(`Could not create the HTTPS certificate. Install Apache first or disable HTTPS. ${error instanceof Error ? error.message : ''}`)
    }
  }

  private certPaths(vhost: VirtualHost, runtimeRoot: string) {
    const folder = join(runtimeRoot, 'certificates', vhost.name)
    return { crt: join(folder, 'server.crt'), key: join(folder, 'server.key') }
  }

  private async addHosts(hosts: string[]): Promise<void> {
    if (process.platform !== 'win32') return
    const file = `${process.env.SystemRoot || 'C:\\Windows'}\\System32\\drivers\\etc\\hosts`
    const current = await readFile(file, 'utf8')
    const missing = hosts.filter((host) => !new RegExp(`^\\s*(?:127\\.0\\.0\\.1|::1)\\s+.*(?:\\s|^)${host.replace(/\./g, '\\.')}(?:\\s|$)`, 'mi').test(current))
    if (!missing.length) return
    try { await appendFile(file, `\r\n# WeebX\r\n127.0.0.1 ${missing.join(' ')}\r\n`, 'utf8') }
    catch { throw new Error('The virtual host was created, but updating the Windows hosts file requires running WeebX as administrator.') }
  }
}
