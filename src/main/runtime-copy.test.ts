import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareRuntimeDirectories, retryFileOperation } from './runtime-copy'

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

  it('keeps retrying transient antivirus locks until the write succeeds', async () => {
    let attempts = 0
    const retries: number[] = []
    const result = await retryFileOperation(async () => {
      attempts += 1
      if (attempts < 4) throw Object.assign(new Error('temporarily locked'), { code: 'EPERM' })
      return 'ready'
    }, { initialDelayMs: 1, maximumDelayMs: 2, onRetry: ({ attempt }) => { retries.push(attempt) } })

    expect(result).toBe('ready')
    expect(attempts).toBe(4)
    expect(retries).toEqual([1, 2, 3])
  })

  it('stops an unlimited retry loop when preparation is cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(retryFileOperation(async () => {
      throw Object.assign(new Error('temporarily locked'), { code: 'EACCES' })
    }, { signal: controller.signal, initialDelayMs: 1 })).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('waits for an asynchronous recovery action before trying again', async () => {
    let recovered = false
    const value = await retryFileOperation(async () => {
      if (!recovered) throw Object.assign(new Error('access denied'), { code: 'EACCES' })
      return 'readable'
    }, {
      initialDelayMs: 1,
      onRetry: async () => { recovered = true }
    })
    expect(value).toBe('readable')
  })

  it('does not hide permanent filesystem errors', async () => {
    let attempts = 0
    await expect(retryFileOperation(async () => {
      attempts += 1
      throw Object.assign(new Error('invalid path'), { code: 'EINVAL' })
    }, { initialDelayMs: 1 })).rejects.toMatchObject({ code: 'EINVAL' })
    expect(attempts).toBe(1)
  })
})
