import { access, appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { VhostDraft, VirtualHost } from '../shared/types'
import type { JsonStore } from './store'
import type { ConfigManager } from './config-manager'
import type { LogBuffer } from './logs'
import { runtimePaths } from './paths'

const execFileAsync = promisify(execFile)
const BEGIN = '# BEGIN WEEBX MANAGED VHOSTS'
const END = '# END WEEBX MANAGED VHOSTS'

function validHostname(value: string): boolean {
  return value.length <= 253 && /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(value)
}

function cleanName(value: string): string {
  const clean = value.toLowerCase().trim().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
  if (!clean) throw new Error('Project name must contain letters or numbers.')
  return clean
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
    if (existing.some((item) => item.serverName === serverName)) throw new Error(`${serverName} already exists.`)
    const documentRoot = resolve(draft.documentRoot || join(settings.htdocsRoot, name))
    await mkdir(documentRoot, { recursive: true })
    const indexFile = join(documentRoot, 'index.php')
    try { await access(indexFile) } catch {
      await writeFile(indexFile, `<?php declare(strict_types=1); ?><h1>${serverName}</h1><p>Served by WeebX · PHP <?= PHP_VERSION ?></p>`, 'utf8')
    }
    const vhost: VirtualHost = {
      id: crypto.randomUUID(), name, serverName, aliases, documentRoot,
      http: draft.http, https: draft.https, enabled: true, createdAt: new Date().toISOString()
    }
    if (vhost.https) await this.ensureCertificate(vhost)
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
    await this.store.setVhosts(all.filter((item) => item.id !== id))
    await this.render()
    this.logs.add('system', 'info', `Removed virtual host ${target.serverName}; its document root was preserved.`)
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
    const blocks = all.filter((item) => item.enabled).map((item) => this.block(item, settings.runtimeRoot, settings.apachePort, settings.apacheSslPort)).join('\n\n')
    const next = `${userContent}${userContent ? '\n\n' : ''}${BEGIN}\n${blocks}\n${END}\n`
    await this.configs.save('vhosts', next)
  }

  private block(vhost: VirtualHost, runtimeRoot: string, httpPort: number, httpsPort: number): string {
    const lines: string[] = [`# ${vhost.name}`]
    const common = [
      `    ServerName ${vhost.serverName}`,
      ...(vhost.aliases.length ? [`    ServerAlias ${vhost.aliases.join(' ')}`] : []),
      `    DocumentRoot "${vhost.documentRoot.replace(/\\/g, '/')}"`,
      `    <Directory "${vhost.documentRoot.replace(/\\/g, '/')}">`,
      '        Options Indexes FollowSymLinks',
      '        AllowOverride All',
      '        Require all granted',
      '    </Directory>'
    ]
    if (vhost.http) lines.push(`<VirtualHost *:${httpPort}>`, ...common, '</VirtualHost>')
    if (vhost.https) {
      const cert = this.certPaths(vhost, runtimeRoot)
      lines.push(`<VirtualHost *:${httpsPort}>`, ...common, '    SSLEngine on', `    SSLCertificateFile "${cert.crt.replace(/\\/g, '/')}"`, `    SSLCertificateKeyFile "${cert.key.replace(/\\/g, '/')}"`, '</VirtualHost>')
    }
    return lines.join('\n')
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
