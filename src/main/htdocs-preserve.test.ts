import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { htdocsKeepDestination, preserveHtdocs, shouldCopyHtdocsEntry } from './htdocs-preserve'

describe('htdocs preserve', () => {
  it('keeps user sites and skips phpMyAdmin', () => {
    expect(shouldCopyHtdocsEntry('mysite')).toBe(true)
    expect(shouldCopyHtdocsEntry('phpmyadmin')).toBe(false)
    expect(shouldCopyHtdocsEntry('phpMyAdmin')).toBe(false)
    expect(htdocsKeepDestination('D:\\Docs')).toBe('D:\\Docs\\WeebX Sites')
  })

  it('copies htdocs into Documents/WeebX Sites without phpMyAdmin', async () => {
    const root = await mkdtemp(join(tmpdir(), 'weebx-htdocs-'))
    const htdocs = join(root, 'htdocs')
    const dest = join(root, 'Documents', 'WeebX Sites')
    await mkdir(join(htdocs, 'mysite'), { recursive: true })
    await mkdir(join(htdocs, 'phpmyadmin'), { recursive: true })
    await writeFile(join(htdocs, 'mysite', 'index.php'), '<?php echo "ok";')
    await writeFile(join(htdocs, 'phpmyadmin', 'index.php'), 'pma')
    const saved = await preserveHtdocs(htdocs, dest)
    expect(saved).toBe(dest)
    expect(await readFile(join(dest, 'mysite', 'index.php'), 'utf8')).toBe('<?php echo "ok";')
    await expect(readFile(join(dest, 'phpmyadmin', 'index.php'), 'utf8')).rejects.toThrow()
  })
})
