import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { RuntimeSettings, VirtualHost } from '../shared/types'
import { MAIN_SITE_VHOST_ID } from '../shared/site-layout'
import { composeVhostFile, partitionVhostFile, VhostManager } from './vhost-manager'

describe('managed virtual-host file order', () => {
  it('keeps leftover user VirtualHost blocks after the managed main website', () => {
    const leftover = `<VirtualHost *:80>
    ServerName phpbb.localhost
    Redirect permanent / https://phpbb.localhost/
</VirtualHost>`
    const current = `# notes\n\n${leftover}\n\n# BEGIN WEEBX MANAGED VHOSTS\nold\n# END WEEBX MANAGED VHOSTS\n`
    const { preamble, leftoverHosts } = partitionVhostFile(current)
    expect(preamble).toContain('# notes')
    expect(leftoverHosts).toContain('ServerName phpbb.localhost')
    const next = composeVhostFile(preamble, '# main-site\n<VirtualHost *:80>\n    ServerName localhost\n</VirtualHost>', leftoverHosts)
    expect(next.indexOf('ServerName localhost')).toBeLessThan(next.indexOf('ServerName phpbb.localhost'))
    expect(next.indexOf('# BEGIN WEEBX MANAGED VHOSTS')).toBeLessThan(next.indexOf('ServerName localhost'))
    expect(next.indexOf('# END WEEBX MANAGED VHOSTS')).toBeLessThan(next.indexOf('ServerName phpbb.localhost'))
  })

  it('treats commented sample VirtualHost blocks as preamble, not leftover hosts', () => {
    const current = `# <VirtualHost *:80>\n#     ServerName wordpress.example.com\n# </VirtualHost>\n`
    const { preamble, leftoverHosts } = partitionVhostFile(current)
    expect(preamble).toContain('wordpress.example.com')
    expect(leftoverHosts).toBe('')
  })

  it('uses a temporary HTTPS redirect so browsers do not cache an old catalog hostname forever', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'weebx-vhost-layout-'))
    const settings = {
      runtimeRoot: folder, htdocsRoot: join(folder, 'htdocs'), apachePort: 80, apacheSslPort: 443, mariadbPort: 3306,
      mariadbPassword: '', activePhpVersion: '8.5.12', phpProfile: 'production', setupComplete: true,
      startOnLaunch: false, minimizeToTray: true, checkPortsBeforeStart: true, startWithWindows: false,
      autoRestartApache: false, autoRestartMariaDb: false, autoRestartDelayMs: 10000
    } as RuntimeSettings
    const site: VirtualHost = {
      id: '11111111-1111-4111-8111-111111111111', name: 'phpbb', serverName: 'phpbb.localhost', aliases: ['localhost'],
      documentRoot: join(folder, 'htdocs', 'phpbb'), http: true, https: true, forceHttps: true, enabled: true,
      createdAt: '2026-01-01T00:00:00.000Z'
    }
    let stored = [site]
    let vhostConfig = '# leftover\n'
    const manager = new VhostManager(
      { getVhosts: async () => stored, getSettings: async () => settings, setVhosts: async (next: VirtualHost[]) => { stored = next } } as never,
      { read: async () => vhostConfig, save: async (_kind: string, content: string) => { vhostConfig = content } } as never,
      { add: () => undefined } as never
    )
    try {
      await manager.render()
      expect(vhostConfig).toContain('Redirect 302 / https://phpbb.localhost/')
      expect(vhostConfig).not.toContain('Redirect permanent')
      expect(vhostConfig).not.toMatch(/ServerAlias localhost/)
      expect(vhostConfig.indexOf('ServerName localhost')).toBeLessThan(vhostConfig.indexOf('ServerName phpbb.localhost'))
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  })

  it('applies catalog isolation to localhost without capturing phpMyAdmin', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'weebx-vhost-main-app-'))
    const settings = {
      runtimeRoot: folder, htdocsRoot: join(folder, 'htdocs'), apachePort: 80, apacheSslPort: 443, mariadbPort: 3306,
      mariadbPassword: '', activePhpVersion: '8.5.12', phpProfile: 'production', setupComplete: true,
      startOnLaunch: false, minimizeToTray: true, checkPortsBeforeStart: true, startWithWindows: false,
      autoRestartApache: false, autoRestartMariaDb: false, autoRestartDelayMs: 10000
    } as RuntimeSettings
    const overlay: VirtualHost = {
      id: MAIN_SITE_VHOST_ID, name: 'main-site', serverName: 'localhost', aliases: ['127.0.0.1'],
      documentRoot: join(folder, 'htdocs', 'main-site', 'public'), applicationRoot: join(folder, 'htdocs', 'main-site'),
      http: true, https: false, enabled: true, createdAt: '2026-01-01T00:00:00.000Z',
      isolation: {
        phpVersion: '8.5.12', phpProfile: 'production', phpExtensions: [], memoryLimit: '256M', maxExecutionTime: 30,
        maxInputTime: 60, maxInputVars: 3000, uploadMaxFilesize: '32M', postMaxSize: '40M', maxFileUploads: 10,
        openBasedir: true, disableDangerousFunctions: false, allowUserIni: false, permissionPreset: 'private', customIni: ''
      }
    }
    let stored = [overlay]
    let vhostConfig = ''
    const manager = new VhostManager(
      { getVhosts: async () => stored, getSettings: async () => settings, setVhosts: async (next: VirtualHost[]) => { stored = next } } as never,
      { read: async () => vhostConfig, save: async (_kind: string, content: string) => { vhostConfig = content } } as never,
      { add: () => undefined } as never
    )
    try {
      await manager.render()
      expect(vhostConfig).toContain('main-site/public')
      expect(vhostConfig).toContain('SetEnv PHPRC')
      expect(vhostConfig).toContain('<Location /phpmyadmin>')
      expect(vhostConfig).toContain('Action application/x-httpd-php "/weebx-php/php-cgi.exe"')
      expect(vhostConfig.indexOf('ServerName localhost')).toBeLessThan(vhostConfig.indexOf('Location /phpmyadmin'))
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  })
})
