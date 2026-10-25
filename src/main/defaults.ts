import { app } from 'electron'
import { join } from 'node:path'
import type { RuntimeSettings } from '../shared/types'

export function defaultSettings(): RuntimeSettings {
  const root = join(app.getPath('userData'), 'runtime')
  return {
    runtimeRoot: root,
    htdocsRoot: join(root, 'htdocs'),
    apachePort: 80,
    apacheSslPort: 443,
    mariadbPort: 3306,
    mariadbPassword: '',
    activePhpVersion: '8.5.12',
    phpProfile: 'development',
    startOnLaunch: false,
    minimizeToTray: true,
    checkPortsBeforeStart: true,
    startWithWindows: false,
    autoRestartApache: false,
    autoRestartMariaDb: false,
    autoRestartDelayMs: 10000
  }
}
