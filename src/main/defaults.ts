import { app } from 'electron'
import { join } from 'node:path'
import type { RuntimeSettings } from '../shared/types'

export function defaultSettings(): RuntimeSettings {
  const root = process.platform === 'win32'
    ? join(process.env.SystemDrive || 'C:', 'WeebX')
    : join(app.getPath('userData'), 'runtime')
  return {
    runtimeRoot: root,
    htdocsRoot: join(root, 'htdocs'),
    apachePort: 80,
    apacheSslPort: 443,
    mariadbPort: 3306,
    mariadbPassword: '',
    activePhpVersion: '8.5.12',
    phpProfile: 'development',
    setupComplete: false,
    startOnLaunch: false,
    minimizeToTray: true,
    checkPortsBeforeStart: true,
    startWithWindows: false,
    autoRestartApache: false,
    autoRestartMariaDb: false,
    autoRestartDelayMs: 10000
  }
}
