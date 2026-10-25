import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareRuntimeDirectories } from './runtime-copy'

const temporary: string[] = []

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('runtime copy directory preparation', () => {
  it('creates a complete empty runtime tree before parallel file copying', async () => {
    const root = await mkdtemp(join(tmpdir(), 'weebx-runtime-copy-'))
    temporary.push(root)
    const destinations = [
      join(root, 'runtime', 'apache', 'bin', 'httpd.exe'),
      join(root, 'runtime', 'apache', 'bin', 'openssl.exe'),
      join(root, 'runtime', 'apache', 'conf', 'extra', 'httpd-vhosts.conf'),
      join(root, 'runtime', 'mariadb', 'bin', 'mariadbd.exe'),
      join(root, 'runtime', 'php', '8.5.12', 'ext', 'php_curl.dll')
    ]

    await prepareRuntimeDirectories(destinations)
    await prepareRuntimeDirectories(destinations)

    for (const directory of [
      join(root, 'runtime', 'apache', 'bin'),
      join(root, 'runtime', 'apache', 'conf', 'extra'),
      join(root, 'runtime', 'mariadb', 'bin'),
      join(root, 'runtime', 'php', '8.5.12', 'ext')
    ]) expect((await stat(directory)).isDirectory()).toBe(true)
  })
})
