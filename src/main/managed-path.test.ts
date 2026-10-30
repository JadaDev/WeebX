import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { isManagedPath, nearestExistingDirectory, pathIsInside, resolveManagedDirectory } from './managed-path'

const runtime = 'C:\\WeebX'
const htdocs = 'C:\\WeebX\\htdocs'
const folders: string[] = []

afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })))
})

describe('managed folder paths', () => {
  it('treats the runtime and document root as openable folders', () => {
    expect(pathIsInside(runtime, runtime)).toBe(true)
    expect(pathIsInside(runtime, 'C:\\WeebX\\')).toBe(true)
    expect(pathIsInside(runtime, htdocs)).toBe(true)
    expect(pathIsInside(htdocs, htdocs)).toBe(true)
    expect(isManagedPath(runtime, [runtime, htdocs])).toBe(true)
    expect(isManagedPath(htdocs, [runtime, htdocs])).toBe(true)
  })

  it('accepts Windows path case differences for the same folder', () => {
    expect(pathIsInside(runtime, 'c:\\weebx')).toBe(process.platform === 'win32')
    expect(pathIsInside(runtime, 'c:\\weebx\\htdocs')).toBe(process.platform === 'win32')
  })

  it('rejects folders outside the WeebX runtime', () => {
    expect(pathIsInside(runtime, 'C:\\WeebX-other')).toBe(false)
    expect(pathIsInside(runtime, 'C:\\Windows')).toBe(false)
    expect(pathIsInside(htdocs, runtime)).toBe(false)
    expect(isManagedPath('C:\\Users\\JadaDev', [runtime, htdocs])).toBe(false)
  })

  it('walks up to the nearest existing directory for the folder picker', async () => {
    const root = await mkdtemp(join(tmpdir(), 'weebx-folder-'))
    folders.push(root)
    const missing = join(root, 'runtime', 'missing-child')
    expect(await nearestExistingDirectory(missing)).toBe(root)
    expect(await nearestExistingDirectory(root)).toBe(root)
  })

  it('only opens an existing managed directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'weebx-open-'))
    folders.push(root)
    const file = join(root, 'note.txt')
    await writeFile(file, 'not a folder')
    await expect(resolveManagedDirectory(root, [root])).resolves.toBe(root)
    await expect(resolveManagedDirectory(file, [root])).rejects.toThrow('That path is not a folder.')
    await expect(resolveManagedDirectory(join(root, 'gone'), [root])).rejects.toThrow('That folder does not exist.')
    await expect(resolveManagedDirectory('C:\\Windows', [root])).rejects.toThrow('Path is outside the WeebX runtime.')
  })
})
