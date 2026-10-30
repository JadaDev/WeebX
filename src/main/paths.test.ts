import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { opensslProcessEnv, runtimePaths } from './paths'
import type { RuntimeSettings } from '../shared/types'

const settings: RuntimeSettings = {
  runtimeRoot: 'C:\\WeebX',
  htdocsRoot: 'C:\\WeebX\\htdocs',
  apachePort: 80,
  apacheSslPort: 443,
  mariadbPort: 3306,
  mariadbPassword: '',
  activePhpVersion: '8.4.27',
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

describe('runtime OpenSSL paths', () => {
  it('points OpenSSL at the bundled Apache config instead of Apache24', () => {
    const paths = runtimePaths(settings)
    expect(paths.opensslExe).toBe(join('C:\\WeebX', 'apache', 'bin', 'openssl.exe'))
    expect(paths.opensslConf).toBe(join('C:\\WeebX', 'apache', 'conf', 'openssl.cnf'))
    expect(paths.opensslConf).not.toContain('Apache24')
  })

  it('overrides a compiled-in or inherited OPENSSL_CONF path', () => {
    const opensslConf = join('C:\\WeebX', 'apache', 'conf', 'openssl.cnf')
    const env = opensslProcessEnv(opensslConf, { OPENSSL_CONF: 'C:\\Apache24\\conf\\openssl.cnf', PATH: 'C:\\Windows' })
    expect(env.OPENSSL_CONF).toBe(opensslConf)
    expect(env.PATH).toBe('C:\\Windows')
  })
})
