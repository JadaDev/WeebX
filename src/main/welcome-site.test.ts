import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { ensureWelcomeSite, isWeebxHomePage, migrateWelcomeFromHtdocsRoot } from './welcome-site'

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

    const settings = { apachePort: 80, apacheSslPort: 443, mariadbPort: 3306, mariadbPassword: 'Strong!Password123', activePhpVersion: '8.5.12', phpProfile: 'production' as const, setupComplete: true }
    await ensureWelcomeSite(folder, settings)
    await ensureWelcomeSite(custom, settings)

    const upgraded = await readFile(join(folder, 'index.php'), 'utf8')
    expect(upgraded).toContain('WEEBX_HOME_PAGE')
    expect(upgraded).toContain('phpmyadmin')
    expect(upgraded).toContain('phpinfo.php')
    expect(await readFile(join(folder, 'phpinfo.php'), 'utf8')).toContain('WEEBX_PHPINFO_PAGE')
    const runtime = JSON.parse(await readFile(join(folder, 'assets', '.weebx-runtime.json'), 'utf8'))
    expect(runtime.mariadbPort).toBe(3306)
    expect(runtime.passwordSet).toBe(true)
    expect(runtime.phpProfile).toBe('production')
    expect(await readFile(join(custom, 'index.php'), 'utf8')).toBe('<?php echo "my project";')
    await expect(readFile(join(custom, 'phpinfo.php'), 'utf8')).rejects.toThrow()
  })

  it('does not inject the welcome page into a public/ web-root application', async () => {
    const folder = join(tmpdir(), `weebx-home-public-${Date.now()}`)
    await mkdir(join(folder, 'public'), { recursive: true })
    await writeFile(join(folder, 'public', 'index.php'), '<?php echo "gitlist";', 'utf8')
    await ensureWelcomeSite(folder, { apachePort: 80, apacheSslPort: 443, mariadbPort: 3306, mariadbPassword: 'Strong!Password123', activePhpVersion: '8.5.12', phpProfile: 'production', setupComplete: true })
    await expect(readFile(join(folder, 'index.php'), 'utf8')).rejects.toThrow()
  })

  it('starts even when the homepage logo is already present', async () => {
    const folder = join(tmpdir(), `weebx-home-logo-${Date.now()}`)
    await mkdir(join(folder, 'assets'), { recursive: true })
    await writeFile(join(folder, 'assets', 'weebx-logo.png'), 'existing-logo')
    await writeFile(join(folder, 'index.php'), '<?php echo "my project";', 'utf8')
    await expect(ensureWelcomeSite(folder, { apachePort: 80, apacheSslPort: 443, mariadbPort: 3306, mariadbPassword: 'Strong!Password123', activePhpVersion: '8.5.12', phpProfile: 'production', setupComplete: true })).resolves.toBeUndefined()
  })

  it('removes leftover WeebX welcome files from the htdocs root', async () => {
    const folder = join(tmpdir(), `weebx-home-migrate-${Date.now()}`)
    await mkdir(join(folder, 'assets'), { recursive: true })
    await writeFile(join(folder, 'index.php'), '<?php\n// WEEBX_HOME_PAGE\n', 'utf8')
    await writeFile(join(folder, 'phpinfo.php'), '<?php\n// WEEBX_PHPINFO_PAGE\n', 'utf8')
    await writeFile(join(folder, 'assets', 'weebx.css'), '/* WEEBX_HOME_PAGE */\n', 'utf8')
    await writeFile(join(folder, 'keep.php'), '<?php echo "site";', 'utf8')
    await migrateWelcomeFromHtdocsRoot(folder)
    await expect(readFile(join(folder, 'index.php'), 'utf8')).rejects.toThrow()
    await expect(readFile(join(folder, 'phpinfo.php'), 'utf8')).rejects.toThrow()
    expect(await readFile(join(folder, 'keep.php'), 'utf8')).toBe('<?php echo "site";')
  })
})
