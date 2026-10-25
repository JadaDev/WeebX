import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compareSemver, parsePhpMyAdminVersion, preserveDuringUpdate, stackComponentStatus } from './stack-components'

describe('stack components', () => {
  it('labels missing, current, and older installs', () => {
    expect(stackComponentStatus(false, null, '12.3.3')).toBe('missing')
    expect(stackComponentStatus(true, '12.3.3', '12.3.3')).toBe('installed')
    expect(stackComponentStatus(true, '11.4.2', '12.3.3')).toBe('outdated')
    expect(stackComponentStatus(true, null, '12.3.3')).toBe('installed')
    expect(compareSemver('2.4.62', '2.4.69')).toBeLessThan(0)
  })

  it('keeps MariaDB data and phpMyAdmin config during updates', () => {
    const root = 'C:\\runtime\\extract'
    expect(preserveDuringUpdate(root, join(root, 'data', 'ibdata1'), ['data', 'my.ini'])).toBe(false)
    expect(preserveDuringUpdate(root, join(root, 'bin', 'mariadbd.exe'), ['data', 'my.ini'])).toBe(true)
    expect(preserveDuringUpdate(root, join(root, 'config.inc.php'), ['config.inc.php'])).toBe(false)
    expect(preserveDuringUpdate(root, join(root, 'index.php'), ['config.inc.php'])).toBe(true)
  })

  it('reads the phpMyAdmin version constants', () => {
    expect(parsePhpMyAdminVersion("public const MAJOR = 5;\npublic const MINOR = 2;\npublic const PATCH = 3;")).toBe('5.2.3')
  })
})
