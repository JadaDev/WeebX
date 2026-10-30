import { describe, expect, it } from 'vitest'
import { phpbbInstallYaml, phpQuote, siteUrl, yamlQuote } from './app-installers'
import type { AppInstallContext } from './app-installers'
import type { InternalPreinstalledApp } from './preinstalled-app-catalog'
import type { PreinstalledAppInstallRequest, RuntimeSettings, VirtualHost } from '../shared/types'

describe('catalog installer helpers', () => {
  it('quotes PHP and YAML values without leaving raw quotes or newlines', () => {
    expect(phpQuote("O'Reilly\nadmin")).toBe("O\\'Reillyadmin")
    expect(yamlQuote("it's fine")).toBe("'it''s fine'")
  })

  it('builds local site URLs from the selected protocol and Apache port', () => {
    const request = { domain: 'moodle.localhost', https: false } as PreinstalledAppInstallRequest
    const settings = { apachePort: 80, apacheSslPort: 443 } as RuntimeSettings
    expect(siteUrl(request, settings)).toBe('http://moodle.localhost')
    expect(siteUrl({ ...request, https: true }, { ...settings, apacheSslPort: 8443 })).toBe('https://moodle.localhost:8443')
  })

  it('writes a phpBB unattended config that keeps the local DNS and MariaDB identity', () => {
    const yaml = phpbbInstallYaml(sampleContext())
    expect(yaml).toContain("dbms: mysqli")
    expect(yaml).toContain("dbhost: '127.0.0.1'")
    expect(yaml).toContain('dbport: 3307')
    expect(yaml).toContain("dbname: 'phpbb_db'")
    expect(yaml).toContain("dbuser: 'phpbb_app'")
    expect(yaml).toContain("server_name: 'phpbb.localhost'")
    expect(yaml).toContain("server_protocol: 'http://'")
    expect(yaml).not.toContain('\nname: admin\n')
  })
})

function sampleContext(): AppInstallContext {
  const request: PreinstalledAppInstallRequest = {
    catalogId: 'phpbb', location: 'side', projectName: 'phpbb', domain: 'phpbb.localhost',
    http: true, https: false, updateHosts: false, phpVersion: '8.3.36', phpExtensions: ['mysqli'],
    databaseName: 'phpbb_db', databaseUsername: 'phpbb_app', siteTitle: "WeebX Board",
    adminUsername: 'boardadmin', adminPassword: 'CorrectHorse12!', adminEmail: 'admin@example.test'
  }
  return {
    app: { id: 'phpbb', name: 'phpBB', setup: 'automatic' } as InternalPreinstalledApp,
    request,
    site: { id: 'site-1', name: 'phpbb', serverName: 'phpbb.localhost' } as VirtualHost,
    documentRoot: 'C:\\WeebX\\htdocs\\phpbb',
    siteDocumentRoot: 'C:\\WeebX\\htdocs\\phpbb',
    databasePassword: 'DbPass_12chars!',
    settings: { apachePort: 80, apacheSslPort: 443, mariadbPort: 3307 } as RuntimeSettings,
    phpExe: 'C:\\WeebX\\php\\8.3.36\\php.exe',
    phpIni: 'C:\\WeebX\\site-profiles\\phpbb\\php\\php.ini',
    profile: { root: 'C:\\WeebX\\site-profiles\\phpbb', php: '', phpIni: '', sessions: '', temp: '', uploads: '', logs: '' },
    siteUrl: 'http://phpbb.localhost'
  }
}
