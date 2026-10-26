import { execFile } from 'node:child_process'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { Installer } from './installer'

const execFileAsync = promisify(execFile)
const temporaryFolders: string[] = []
const windowsTimeoutMs = 30_000

function archiveExtractor(): (archive: string, destination: string) => Promise<void> {
  const installer = new Installer({} as never, {} as never, {} as never)
  return (installer as unknown as { extractArchive: (archive: string, destination: string) => Promise<void> }).extractArchive.bind(installer)
}

async function writeZip(archive: string, entries: { name: string; content: string }[]): Promise<void> {
  const blocks = entries.flatMap((entry, index) => [
    `$entry${index}=$zip.CreateEntry(${JSON.stringify(entry.name)});`,
    `$writer${index}=[IO.StreamWriter]::new($entry${index}.Open());`,
    `$writer${index}.Write(${JSON.stringify(entry.content)}); $writer${index}.Dispose();`
  ])
  const script = [
    '& { param($archive) Add-Type -AssemblyName System.IO.Compression;',
    '$stream=[IO.File]::Open($archive,[IO.FileMode]::Create);',
    '$zip=[IO.Compression.ZipArchive]::new($stream,[IO.Compression.ZipArchiveMode]::Create);',
    ...blocks,
    '$zip.Dispose(); $stream.Dispose() }'
  ].join(' ')
  await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script, archive], { windowsHide: true, timeout: windowsTimeoutMs })
}

afterEach(async () => {
  await Promise.all(temporaryFolders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })))
})

describe.skipIf(process.platform !== 'win32')('component archive extraction', () => {
  it('extracts an ordinary ZIP inside the staging directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'weebx-safe-zip-'))
    temporaryFolders.push(root)
    const archive = join(root, 'safe.zip')
    const destination = join(root, 'destination')
    await writeZip(archive, [{ name: 'php.exe', content: 'safe test payload' }])

    await archiveExtractor()(archive, destination)

    await expect(access(join(destination, 'php.exe'))).resolves.toBeUndefined()
  }, windowsTimeoutMs)

  it('rejects a ZIP entry that escapes the staging directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'weebx-hostile-zip-'))
    temporaryFolders.push(root)
    const archive = join(root, 'hostile.zip')
    const destination = join(root, 'destination')
    await writeZip(archive, [{ name: '../escape.txt', content: 'blocked' }])

    await expect(archiveExtractor()(archive, destination)).rejects.toThrow(/unsafe path/i)
    await expect(access(join(root, 'escape.txt'))).rejects.toThrow()
  }, windowsTimeoutMs)
})
