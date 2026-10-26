import { execFile } from 'node:child_process'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { Installer } from './installer'

const execFileAsync = promisify(execFile)
const temporaryFolders: string[] = []

function archiveExtractor(): (archive: string, destination: string) => Promise<void> {
  const installer = new Installer({} as never, {} as never, {} as never)
  return (installer as unknown as { extractArchive: (archive: string, destination: string) => Promise<void> }).extractArchive.bind(installer)
}

afterEach(async () => {
  await Promise.all(temporaryFolders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })))
})

describe.skipIf(process.platform !== 'win32')('component archive extraction', () => {
  it('extracts an ordinary ZIP inside the staging directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'weebx-safe-zip-'))
    temporaryFolders.push(root)
    const source = join(root, 'source')
    const archive = join(root, 'safe.zip')
    const destination = join(root, 'destination')
    await mkdir(source)
    await writeFile(join(source, 'php.exe'), 'safe test payload')
    await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '& { param($source,$archive) Compress-Archive -LiteralPath $source -DestinationPath $archive }', join(source, 'php.exe'), archive], { windowsHide: true })

    await archiveExtractor()(archive, destination)

    await expect(access(join(destination, 'php.exe'))).resolves.toBeUndefined()
  })

  it('rejects a ZIP entry that escapes the staging directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'weebx-hostile-zip-'))
    temporaryFolders.push(root)
    const archive = join(root, 'hostile.zip')
    const destination = join(root, 'destination')
    const script = [
      '& { param($archive) Add-Type -AssemblyName System.IO.Compression;',
      '$stream=[IO.File]::Open($archive,[IO.FileMode]::Create);',
      '$zip=[IO.Compression.ZipArchive]::new($stream,[IO.Compression.ZipArchiveMode]::Create);',
      '$entry=$zip.CreateEntry("../escape.txt");',
      '$writer=[IO.StreamWriter]::new($entry.Open());',
      '$writer.Write("blocked"); $writer.Dispose(); $zip.Dispose(); $stream.Dispose() }'
    ].join(' ')
    await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script, archive], { windowsHide: true })

    await expect(archiveExtractor()(archive, destination)).rejects.toThrow(/unsafe path/i)
    await expect(access(join(root, 'escape.txt'))).rejects.toThrow()
  })
})
