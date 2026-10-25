import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { ensureWelcomeSite, isWeebxHomePage } from './welcome-site'

describe('welcome site', () => {
  it('recognizes the old first-run stub as a managed WeebX homepage', () => {
    expect(isWeebxHomePage('<h1>WeebX is running</h1><p>Apache + PHP</p>')).toBe(true)
    expect(isWeebxHomePage('<?php // my laravel app')).toBe(false)
  })

  it('upgrades a managed homepage and leaves a custom site alone', async () => {
    const folder = join(tmpdir(), `weebx-home-${Date.now()}`)
    const custom = join(tmpdir(), `weebx-home-custom-${Date.now()}`)
    await mkdir(folder, { recursive: true })
    await mkdir(custom, { recursive: true })
    await writeFile(join(folder, 'index.php'), '<?php\n$version = PHP_VERSION;\n?><h1>WeebX is running</h1>', 'utf8')
    await writeFile(join(custom, 'index.php'), '<?php echo "my project";', 'utf8')

    const settings = { apachePort: 80, apacheSslPort: 443, mariadbPort: 3306, mariadbPassword: '', activePhpVersion: '8.5.12' }
    await ensureWelcomeSite(folder, settings)
    await ensureWelcomeSite(custom, settings)

    const upgraded = await readFile(join(folder, 'index.php'), 'utf8')
    expect(upgraded).toContain('WEEBX_HOME_PAGE')
    expect(upgraded).toContain('phpmyadmin')
    expect(upgraded).toContain('phpinfo.php')
    expect(await readFile(join(folder, 'phpinfo.php'), 'utf8')).toContain('WEEBX_PHPINFO_PAGE')
    expect(JSON.parse(await readFile(join(folder, 'assets', 'weebx-runtime.json'), 'utf8')).mariadbPort).toBe(3306)
    expect(await readFile(join(custom, 'index.php'), 'utf8')).toBe('<?php echo "my project";')
  })

  it('starts even when the homepage logo is already present', async () => {
    const folder = join(tmpdir(), `weebx-home-logo-${Date.now()}`)
    await mkdir(join(folder, 'assets'), { recursive: true })
    await writeFile(join(folder, 'assets', 'weebx-logo.png'), 'existing-logo')
    await writeFile(join(folder, 'index.php'), '<?php echo "my project";', 'utf8')
    await expect(ensureWelcomeSite(folder, { apachePort: 80, apacheSslPort: 443, mariadbPort: 3306, mariadbPassword: '', activePhpVersion: '8.5.12' })).resolves.toBeUndefined()
  })
})
