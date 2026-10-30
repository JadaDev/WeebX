import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { RuntimeSettings } from '../shared/types'
import { Installer } from './installer'

const temporary: string[] = []

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('installed PHP discovery', () => {
  it('does not advertise a PHP directory when an executable was removed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'weebx-php-discovery-'))
    temporary.push(root)
    const complete = join(root, 'php', '8.4.27')
    const missingCgi = join(root, 'php', '8.5.12')
    await Promise.all([mkdir(complete, { recursive: true }), mkdir(missingCgi, { recursive: true })])
    await Promise.all([
      writeFile(join(complete, 'php.exe'), ''),
      writeFile(join(complete, 'php-cgi.exe'), ''),
      writeFile(join(missingCgi, 'php.exe'), '')
    ])
    const settings = { runtimeRoot: root, htdocsRoot: join(root, 'htdocs'), activePhpVersion: '8.5.12' } as RuntimeSettings
    const installer = new Installer({ getSettings: async () => settings } as never, {} as never, {} as never)

    await expect(installer.phpVersions()).resolves.toEqual([
      expect.objectContaining({ version: '8.4.27', installed: true, active: false, path: complete }),
      expect.objectContaining({ version: '8.5.12', installed: false, active: false, path: undefined })
    ])
  })
})
