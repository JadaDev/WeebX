import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { RuntimeSettings, SiteIsolationDraft, VirtualHost } from '../shared/types'
import { normalizeSiteIsolation, siteDatabaseSql, siteProfilePaths, validateCustomIni, writeSitePhpIni } from './site-profile'

const settings = (root: string): RuntimeSettings => ({
  runtimeRoot: root, htdocsRoot: join(root, 'htdocs'), apachePort: 80, apacheSslPort: 443, mariadbPort: 3306,
  mariadbPassword: 'Root!Password123', activePhpVersion: '8.5.12', phpProfile: 'development', setupComplete: true,
  startOnLaunch: false, minimizeToTray: true, checkPortsBeforeStart: true, startWithWindows: false,
  autoRestartApache: false, autoRestartMariaDb: false, autoRestartDelayMs: 10000
})

const profileDraft = (password = 'Site!Password123'): SiteIsolationDraft => ({
  phpVersion: '8.5.12', phpProfile: 'production', phpExtensions: ['curl', 'mysqli'], memoryLimit: '256M',
  maxExecutionTime: 30, maxInputTime: 60, maxInputVars: 3000, uploadMaxFilesize: '32M', postMaxSize: '40M',
  maxFileUploads: 12, openBasedir: true, disableDangerousFunctions: true, allowUserIni: false,
  permissionPreset: 'private', customIni: 'realpath_cache_size=4096K',
  database: { databaseName: 'portal_db', username: 'portal_app', access: 'read-write', password }
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'weebx-site-profile-'))
  const php = join(root, 'php', '8.5.12')
  await mkdir(join(php, 'ext'), { recursive: true })
  await mkdir(join(root, 'htdocs', 'portal'), { recursive: true })
  await writeFile(join(php, 'php-cgi.exe'), '')
  await writeFile(join(php, 'php.ini-production'), '[PHP]\nextension=curl\n')
  await writeFile(join(php, 'php.ini-development'), '[PHP]\n')
  await writeFile(join(php, 'ext', 'php_curl.dll'), '')
  await writeFile(join(php, 'ext', 'php_mysqli.dll'), '')
  return { root, settings: settings(root) }
}

describe('isolated site profiles', () => {
  it('validates installed extensions and creates a protected profile', async () => {
    const test = await fixture()
    const result = await normalizeSiteIsolation(test.settings, profileDraft())
    expect(result.profile.phpVersion).toBe('8.5.12')
    expect(result.profile.database?.username).toBe('portal_app')
    expect(result.databasePassword).toBe('Site!Password123')
  })

  it('writes site-specific PHP paths, limits, extensions, and safety controls', async () => {
    const test = await fixture()
    const normalized = await normalizeSiteIsolation(test.settings, profileDraft())
    const site: VirtualHost = {
      id: 'site-id', name: 'portal', serverName: 'portal.test', aliases: [], documentRoot: join(test.root, 'htdocs', 'portal'),
      http: true, https: true, enabled: true, createdAt: new Date().toISOString(), isolation: normalized.profile
    }
    const paths = await writeSitePhpIni(test.settings, site, false)
    const ini = await readFile(paths.phpIni, 'utf8')
    expect(ini).toContain(`session.save_path="${siteProfilePaths(test.settings, site).sessions.replace(/\\/g, '/')}"`)
    expect(ini).toContain('extension=curl')
    expect(ini).toContain('extension=mysqli')
    expect(ini).toContain('open_basedir=')
    expect(ini).toContain('disable_functions=exec,passthru,shell_exec,system,proc_open,popen')
    expect(ini).toContain('user_ini.filename=')
    expect(ini).toContain('display_errors=Off')
    expect(ini.match(/^extension=curl$/gm)).toHaveLength(1)
  })

  it('scopes database grants to one database and never grants global privileges', async () => {
    const test = await fixture()
    const { profile, databasePassword } = await normalizeSiteIsolation(test.settings, profileDraft())
    const sql = siteDatabaseSql(profile, databasePassword!)
    expect(sql).toContain('GRANT ALL PRIVILEGES ON `portal_db`.*')
    expect(sql).not.toContain(' ON *.* ')
    expect(sql).not.toContain('WITH GRANT OPTION')
  })

  it('blocks custom directives that could escape the managed boundary', () => {
    expect(() => validateCustomIni('open_basedir=C:/')).toThrow(/managed/i)
    expect(() => validateCustomIni('extension=evil.dll')).toThrow(/managed/i)
    expect(validateCustomIni('opcache.memory_consumption=192')).toBe('opcache.memory_consumption=192')
  })

  it('rejects unsafe persisted names, paths, and database identities', async () => {
    const test = await fixture()
    expect(() => siteProfilePaths(test.settings, { name: '../outside' })).toThrow(/invalid/i)
    const normalized = await normalizeSiteIsolation(test.settings, profileDraft())
    const outside: VirtualHost = {
      id: crypto.randomUUID(), name: 'portal', serverName: 'portal.test', aliases: [], documentRoot: join(test.root, 'outside'),
      http: true, https: false, enabled: true, createdAt: new Date().toISOString(), isolation: normalized.profile
    }
    await expect(writeSitePhpIni(test.settings, outside, false)).rejects.toThrow(/inside htdocs/i)
    expect(() => siteDatabaseSql({ ...normalized.profile, database: { ...normalized.profile.database!, username: "bad'user" } }, 'Site!Password123')).toThrow(/username/i)
  })
})
