import { describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { access, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { apacheSecurityBlock, ConfigManager, upsertIni } from './config-manager'
import type { RuntimeSettings } from '../shared/types'

const settings: RuntimeSettings = {
  runtimeRoot: 'C:\\WeebX Runtime',
  htdocsRoot: 'C:\\WeebX Runtime\\htdocs',
  apachePort: 8080,
  apacheSslPort: 8443,
  mariadbPort: 3307,
  mariadbPassword: '',
  activePhpVersion: '8.4.25',
  phpProfile: 'development',
  setupComplete: true,
  startOnLaunch: false,
  minimizeToTray: true,
  checkPortsBeforeStart: true,
  startWithWindows: false,
  autoRestartApache: false,
  autoRestartMariaDb: false,
  autoRestartDelayMs: 10000
}

const manager = new ConfigManager(async () => settings)

describe('ConfigManager templates', () => {
  it('binds Apache to the selected PHP CGI runtime', () => {
    const config = manager.apacheTemplate(settings)
    expect(config).toContain('Listen 8080')
    expect(config).toContain('ScriptAlias /weebx-php/ "C:/WeebX Runtime/php/8.4.25/"')
    expect(config).toContain('Action application/x-httpd-php "/weebx-php/php-cgi.exe"')
    expect(config).toContain('Include conf/extra/httpd-vhosts.conf')
    expect(config).not.toContain('mod_php')
  })

  it('writes MariaDB paths and the configured port', () => {
    const config = manager.mariaDbTemplate(settings)
    expect(config).toContain('port=3307')
    expect(config).toContain('character-set-server=utf8mb4')
    expect(config).toContain('datadir=C:/WeebX Runtime/mariadb/data')
    expect(config).toContain('bind-address=127.0.0.1')
    expect(config).toContain('local-infile=0')
    expect(config).toContain('feedback=OFF')
  })

  it('updates every port= line in my.ini', () => {
    const next = upsertIni('[client]\r\nport=3306\r\n\r\n[mysqld]\r\nport=3306\r\n', 'port', '3310')
    expect(next.match(/port=3310/g)).toHaveLength(2)
    expect(next).not.toContain('port=3306')
  })

  it('enables the expected PHP development extensions', () => {
    const config = manager.phpTemplate('C:\\php\\ext')
    expect(config).toContain('extension=mysqli')
    expect(config).toContain('extension=pdo_mysql')
    expect(config).toContain('upload_max_filesize=128M')
    expect(config).toContain('session.upload_progress.enabled=0')
  })

  it('applies public-hosting security defaults', () => {
    const config = manager.apacheTemplate(settings)
    expect(config).toContain('Options -Indexes +FollowSymLinks')
    expect(config).toContain('ServerTokens Prod')
    expect(config).toContain('SSLProtocol -all +TLSv1.2 +TLSv1.3')
    expect(config).toContain('SSLCompression Off')
    expect(config).toContain('Require local')
    expect(config).toContain('<Directory />')
    expect(config).toContain('DocumentRoot "C:/WeebX Runtime/htdocs"')
    expect(config).toContain('<Directory "C:/WeebX Runtime/htdocs">\n    Options -Indexes +FollowSymLinks\n    AllowOverride All\n    Require all granted')
  })

  it('keeps the document root reachable when refreshing security defaults', () => {
    const block = apacheSecurityBlock('C:\\WeebX\\htdocs')
    expect(block).toContain('DocumentRoot "C:/WeebX/htdocs"')
    expect(block).toContain('<Directory "C:/WeebX/htdocs">\n    Options -Indexes +FollowSymLinks\n    AllowOverride All\n    Require all granted')
  })

  it('emits security directives accepted by the bundled Apache build', async () => {
    const executable = resolve('resources/runtime/apache/bin/httpd.exe')
    try { await access(executable) } catch { return }
    const runtimeRoot = resolve('resources/runtime')
    const live = { ...settings, runtimeRoot, htdocsRoot: join(runtimeRoot, 'htdocs'), activePhpVersion: '8.5.12', apachePort: 18080, apacheSslPort: 18443 }
    const config = manager.apacheTemplate(live).replace('Include conf/extra/httpd-vhosts.conf', '# vhosts omitted during syntax test')
    const folder = await mkdtemp(join(tmpdir(), 'weebx-apache-security-'))
    const file = join(folder, 'httpd.conf')
    await writeFile(file, config, 'utf8')
    const result = await new Promise<{ code: number | null; output: string }>((done) => {
      const child = execFile(executable, ['-t', '-f', file], { windowsHide: true }, (error, stdout, stderr) => {
        done({ code: error && typeof error === 'object' && 'code' in error && typeof error.code === 'number' ? error.code : error ? 1 : 0, output: `${stdout}${stderr}` })
      })
      child.on('error', (error) => done({ code: 1, output: error.message }))
    })
    expect(result.code, result.output).toBe(0)
    expect(result.output).toMatch(/Syntax OK/i)
  })
})
