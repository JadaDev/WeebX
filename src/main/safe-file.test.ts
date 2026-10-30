import { chmod, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { backupAndWrite, copyFileBestEffort, ensureDirectory, ensureWritableFile } from './safe-file'

describe('backupAndWrite', () => {
  it('replaces a config even when the previous backup is read-only', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'weebx-safe-file-'))
    const file = join(folder, 'httpd.conf')
    const bak = `${file}.weebx.bak`
    await writeFile(file, 'old-config', 'utf8')
    await writeFile(bak, 'stale-backup', 'utf8')
    await chmod(bak, 0o444)
    await backupAndWrite(file, 'new-config')
    expect(await readFile(file, 'utf8')).toBe('new-config')
  })
})

describe('copyFileBestEffort', () => {
  it('leaves an existing destination alone when sizes match', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'weebx-copy-'))
    const source = join(folder, 'source.png')
    const destination = join(folder, 'dest.png')
    await writeFile(source, 'logo-bytes')
    await writeFile(destination, 'logo-bytes')
    await copyFileBestEffort(source, destination)
    expect(await readFile(destination, 'utf8')).toBe('logo-bytes')
  })
})

describe('ensureDirectory', () => {
  it('replaces a colliding file so nested temp folders can be created', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'weebx-ensure-dir-'))
    const tmp = join(folder, 'tmp')
    await writeFile(tmp, 'not-a-directory', 'utf8')
    await ensureDirectory(tmp)
    await ensureDirectory(join(tmp, 'sessions'))
    expect((await stat(tmp)).isDirectory()).toBe(true)
    expect((await stat(join(tmp, 'sessions'))).isDirectory()).toBe(true)
  })
})

describe('ensureWritableFile', () => {
  it('repairs a packaged read-only log without truncating it', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'weebx-writable-log-'))
    const file = join(folder, 'apache', 'logs', 'access.log')
    await ensureWritableFile(file)
    await writeFile(file, 'existing request\n', 'utf8')
    await chmod(file, 0o444)

    await ensureWritableFile(file)
    await writeFile(file, 'next request\n', { flag: 'a' })

    expect(await readFile(file, 'utf8')).toBe('existing request\nnext request\n')
  })
})
