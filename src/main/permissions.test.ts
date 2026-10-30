import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { applyPrivateTreePermissions } from './permissions'

const temporary: string[] = []

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe.skipIf(process.platform !== 'win32')('Windows private permission preset', () => {
  it('leaves files and nested files readable by the current owner', async () => {
    const root = await mkdtemp(join(tmpdir(), 'weebx-private-acl-'))
    temporary.push(root)
    const nested = join(root, 'apache', 'bin')
    await mkdir(nested, { recursive: true })
    const rootFile = join(root, '.weebx-bundle-version')
    const nestedFile = join(nested, 'httpd.exe')
    await writeFile(rootFile, '2026.10.28.1', 'utf8')
    await writeFile(nestedFile, 'test', 'utf8')

    await applyPrivateTreePermissions(root)

    await expect(readFile(rootFile, 'utf8')).resolves.toBe('2026.10.28.1')
    await expect(readFile(nestedFile, 'utf8')).resolves.toBe('test')
  })
})
