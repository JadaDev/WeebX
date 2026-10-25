import { describe, expect, it } from 'vitest'
import { ConfigManager, upsertIni } from './config-manager'
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
  })
})
