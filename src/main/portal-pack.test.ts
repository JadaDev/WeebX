import { describe, expect, it } from 'vitest'
import { isPortalManifest, portalLaunchScript, shouldPackAppFile, shouldPackRuntimeFile } from './portal-pack'
import { buildMsiUninstallScript } from './stack-shutdown'

describe('portal packing filters', () => {
  it('packs the app without its live data folder', () => {
    expect(shouldPackAppFile('WeebX.exe')).toBe(true)
    expect(shouldPackAppFile('resources\\app.asar')).toBe(true)
    expect(shouldPackAppFile('resources\\runtime\\apache\\bin\\httpd.exe')).toBe(false)
    expect(shouldPackAppFile('data\\runtime\\apache\\bin\\httpd.exe')).toBe(false)
    expect(shouldPackAppFile('electron.log')).toBe(false)
  })

  it('can skip MariaDB data while keeping binaries', () => {
    const none = { includeDb: false, includeHtdocs: false }
    expect(shouldPackRuntimeFile('mariadb\\bin\\mariadbd.exe', none)).toBe(true)
    expect(shouldPackRuntimeFile('mariadb\\data\\ibdata1', none)).toBe(false)
    expect(shouldPackRuntimeFile('htdocs\\mysite\\index.php', none)).toBe(false)
    expect(shouldPackRuntimeFile('htdocs\\phpmyadmin\\index.php', none)).toBe(true)
    expect(shouldPackRuntimeFile('htdocs\\mysite\\index.php', { includeDb: false, includeHtdocs: true })).toBe(true)
    expect(shouldPackRuntimeFile('mariadb\\data\\ibdata1', { includeDb: true, includeHtdocs: false })).toBe(true)
  })

  it('writes a portable launch script and recognizes portal manifests', () => {
    expect(portalLaunchScript()).toContain('--weebx-data-dir=%~dp0data')
    expect(portalLaunchScript()).toContain('--repair-location')
    expect(isPortalManifest({ kind: 'weebx-portal', version: '1.1.21', packedAt: 'now', includeDb: true, includeHtdocs: true })).toBe(true)
    expect(isPortalManifest({ kind: 'nope' })).toBe(false)
  })
})

describe('MSI uninstall script', () => {
  it('waits for WeebX.exe then runs msiexec without a hanging command pipeline', () => {
    const script = buildMsiUninstallScript({
      guid: '{AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}',
      removeAppData: true,
      userData: 'C:\\Users\\JadaDev\\AppData\\Roaming\\weebx'
    })
    expect(script).toContain('ProcessNameExists("WeebX.exe")')
    expect(script).not.toContain('tasklist')
    expect(script).toContain('exitCode = shell.Run(command, 1, True)')
    expect(script).toContain('msiexec.exe /x {AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE} /passive /norestart')
    expect(script).toContain('fso.DeleteFolder "C:\\Users\\JadaDev\\AppData\\Roaming\\weebx", True')
  })
})
