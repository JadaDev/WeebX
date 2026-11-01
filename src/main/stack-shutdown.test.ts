import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildMsiUninstallScript, clearResetStateBeforeUninstall, isDefaultUserDataForRemoval, isInsideDirectory,
  isManagedRuntimeForRemoval, isUsableProductGuid, isWeebXManagedUninstallCommand, isWeebXUninstallDisplayName,
  leftoverWeebXUninstallKeys, NIL_PRODUCT_GUID, packagedInstallFolder, parseInstalledProductLines,
  preferWeebXUninstallEntry, productGuidFrom, shouldStopProcess, uninstallHelperArgs, uninstallHelperLaunch,
  WEEBX_MSI_UPGRADE_CODE
} from './stack-shutdown'

describe('stack shutdown matching', () => {
  it('stops WeebX Apache and MariaDB processes but not the current app', () => {
    const runtime = 'C:\\Users\\JadaDev\\AppData\\Roaming\\weebx\\runtime'
    expect(shouldStopProcess({ pid: 10, name: 'httpd.exe', path: `${runtime}\\apache\\bin\\httpd.exe` }, runtime, 99)).toBe(true)
    expect(shouldStopProcess({ pid: 11, name: 'mariadbd.exe', path: `${runtime}\\mariadb\\bin\\mariadbd.exe` }, runtime, 99)).toBe(true)
    expect(shouldStopProcess({ pid: 99, name: 'WeebX.exe', path: 'C:\\Program Files\\WeebX\\WeebX.exe' }, runtime, 99)).toBe(false)
    expect(shouldStopProcess({ pid: 12, name: 'WeebX.exe', path: 'C:\\Program Files\\WeebX\\WeebX.exe' }, runtime, 99)).toBe(true)
    expect(shouldStopProcess({ pid: 16, name: 'WeebX Core.exe', path: 'C:\\Program Files\\WeebX\\WeebX Core.exe' }, runtime, 99)).toBe(true)
    expect(shouldStopProcess({ pid: 14, parentPid: 99, name: 'WeebX.exe', path: 'C:\\Program Files\\WeebX\\WeebX.exe', commandLine: 'WeebX.exe --type=renderer' }, runtime, 99)).toBe(false)
    expect(shouldStopProcess({ pid: 15, parentPid: 12, name: 'WeebX.exe', path: 'C:\\Program Files\\WeebX\\WeebX.exe', commandLine: 'WeebX.exe --type=utility' }, runtime, 99)).toBe(false)
    expect(shouldStopProcess({ pid: 13, name: 'httpd.exe', path: 'C:\\Apache24\\bin\\httpd.exe' }, runtime, 99)).toBe(false)
  })
})

describe('uninstall reset cleanup', () => {
  it('recognizes only user-data and the exact default runtime as managed', () => {
    expect(isManagedRuntimeForRemoval('C:\\Users\\Me\\AppData\\Roaming\\weebx', 'C:\\WeebX', 'C:')).toBe(true)
    expect(isManagedRuntimeForRemoval('C:\\Users\\Me\\AppData\\Roaming\\weebx', 'C:\\Sites', 'C:')).toBe(false)
  })

  it('removes only the normal Electron user-data folder, never Portal data', () => {
    expect(isDefaultUserDataForRemoval('C:\\Users\\Ada\\AppData\\Roaming', 'C:\\Users\\Ada\\AppData\\Roaming\\WeebX')).toBe(true)
    expect(isDefaultUserDataForRemoval('C:\\Users\\Ada\\AppData\\Roaming', 'D:\\Portable\\WeebX\\data')).toBe(false)
  })
  it('removes the owned runtime and saved settings', async () => {
    const userData = await mkdtemp(join(tmpdir(), 'weebx-uninstall-'))
    const runtime = join(userData, 'runtime')
    await mkdir(runtime)
    await writeFile(join(runtime, 'database.bin'), 'old password data')
    await writeFile(join(userData, 'weebx.json'), '{"mariadbPassword":"old"}')

    await clearResetStateBeforeUninstall(userData, runtime)

    await expect(access(runtime)).rejects.toThrow()
    await expect(access(join(userData, 'weebx.json'))).rejects.toThrow()
  })

  it('never removes a runtime outside user data', async () => {
    const root = await mkdtemp(join(tmpdir(), 'weebx-uninstall-'))
    const userData = join(root, 'profile')
    const external = join(root, 'external-runtime')
    await mkdir(userData)
    await mkdir(external)
    await writeFile(join(userData, 'weebx.json'), '{}')
    await writeFile(join(external, 'keep.txt'), 'keep')

    expect(isInsideDirectory(userData, external)).toBe(false)
    await clearResetStateBeforeUninstall(userData, external)

    expect(await readFile(join(external, 'keep.txt'), 'utf8')).toBe('keep')
    await expect(access(join(userData, 'weebx.json'))).rejects.toThrow()
  })
})

describe('uninstall helper launch', () => {
  it('breaks the helper out of Electron with cmd start so msiexec can keep running', () => {
    const scriptPath = 'C:\\Users\\Test User\\AppData\\Local\\Temp\\weebx-uninstall.vbs'
    const launch = uninstallHelperLaunch(scriptPath)
    expect(launch.file.toLowerCase()).toContain('cmd')
    expect(launch.args).toEqual(uninstallHelperArgs(scriptPath))
    expect(launch.args.join(' ')).toContain('start "WeebX Uninstall Helper" /min wscript.exe //NoLogo')
    expect(launch.args.join(' ')).toContain(scriptPath)
    expect(launch.options.detached).toBe(true)
    expect(launch.options.windowsVerbatimArguments).toBe(true)
  })

  it('writes a startup handshake and an MSI log', () => {
    const script = buildMsiUninstallScript({
      guid: '{AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}',
      startedMarker: 'C:\\Temp\\weebx-uninstall.started'
    })
    expect(script).toContain('Set markerFile = fso.CreateTextFile("C:\\Temp\\weebx-uninstall.started", True)')
    expect(script).toContain('/x " & guid & " /qb /norestart /L*v')
    expect(script).toContain('{AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}')
    expect(script).toContain('%SystemRoot%\\System32\\msiexec.exe')
    expect(script).toContain('shell.ExpandEnvironmentStrings("%TEMP%\\weebx-uninstall-msi.log")')
    expect(script).not.toContain('exitCode <> 1605')
  })

  it('never asks Windows Installer to remove a nil or missing product code', () => {
    const script = buildMsiUninstallScript({
      guid: NIL_PRODUCT_GUID,
      leftoverKeys: ['HKEY_LOCAL_MACHINE\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{07046A8A-635B-47F4-926C-BB375A981113}']
    })
    expect(script).not.toMatch(/\/x \{00000000-0000-0000-0000-000000000000\}/)
    expect(script).toContain('Removing leftover uninstall key')
    expect(script).toContain('{07046A8A-635B-47F4-926C-BB375A981113}')
    expect(script).toContain('ShellExecute "wscript.exe"')
    expect(script).toContain('"runas"')
    expect(isUsableProductGuid(NIL_PRODUCT_GUID)).toBe(false)
    expect(productGuidFrom(NIL_PRODUCT_GUID)).toBeUndefined()
    expect(isWeebXUninstallDisplayName('')).toBe(false)
    expect(isWeebXUninstallDisplayName(null)).toBe(false)
    expect(isWeebXUninstallDisplayName('WeebX')).toBe(true)
    expect(isWeebXManagedUninstallCommand('"C:\\Program Files\\WeebX\\WeebX.exe" --uninstall')).toBe(true)
  })

  it('treats empty leftover ARP keys as removable and ignores them when the MSI is still installed', () => {
    const leftover = leftoverWeebXUninstallKeys([
      {
        guid: '{07046A8A-635B-47F4-926C-BB375A981113}',
        key: 'HKEY_LOCAL_MACHINE\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{07046A8A-635B-47F4-926C-BB375A981113}',
        displayName: '',
        quietUninstallString: '"C:\\Program Files\\WeebX\\WeebX.exe" --uninstall',
        storedProduct: '{07046A8A-635B-47F4-926C-BB375A981113}'
      }
    ], new Set())
    expect(leftover).toHaveLength(1)
    expect(leftoverWeebXUninstallKeys([
      {
        guid: '{AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}',
        key: 'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}',
        displayName: 'WeebX',
        windowsInstaller: true,
        storedProduct: '{AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}'
      }
    ], new Set(['{AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}']))).toEqual([])
    expect(parseInstalledProductLines('{AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}\r\n{00000000-0000-0000-0000-000000000000}\n')).toEqual(['{AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}'])
    expect(packagedInstallFolder('C:\\Program Files\\WeebX\\WeebX.exe')).toBe('C:\\Program Files\\WeebX')
    expect(packagedInstallFolder('G:\\WeebX\\node_modules\\electron\\dist\\electron.exe', false)).toBeUndefined()
    expect(WEEBX_MSI_UPGRADE_CODE).toMatch(/^\{[0-9A-F-]{36}\}$/)
  })

  it('prefers the machine-wide MSI product code over leftover user uninstall keys', () => {
    expect(productGuidFrom('MsiExec.exe /X{AaBbCcDd-0000-4000-8000-000000000001}')).toBe('{AABBCCDD-0000-4000-8000-000000000001}')
    const chosen = preferWeebXUninstallEntry([
      { guid: '{11111111-1111-1111-1111-111111111111}', key: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\WeebX' },
      { guid: '{AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}', key: 'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}' }
    ])
    expect(chosen?.guid).toBe('{AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}')
  })

  it('waits for the active uninstaller and removes it last', () => {
    const script = buildMsiUninstallScript({
      guid: '{AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}',
      uninstallerPid: 4242
    })
    expect(script).toContain('If Not ProcessExists(4242) Then Exit For')
    expect(script).toContain('Call TerminateByPid(4242)')
    expect(script).not.toContain('tasklist')
    expect(script).not.toContain('find /I')
    expect(script).not.toContain('powershell')
    expect(script.indexOf('Call TerminateByName("WeebX.exe")')).toBeLessThan(script.indexOf('exitCode = shell.Run'))
  })

  it('executes the generated helper through the real Windows Script Host', async () => {
    const root = await mkdtemp(join(tmpdir(), 'weebx-wsh-test-'))
    const scriptPath = join(root, 'safe helper.vbs')
    const markerPath = join(root, 'helper.started')
    const script = buildMsiUninstallScript({
      guid: '{00000000-0000-0000-0000-000000000000}',
      exeName: 'WeebX-Test-Never-Running.exe',
      uninstallerPid: 2147483647,
      startedMarker: markerPath
    })
    const safeScript = script
      .replace(/^Call TerminateByPid.*$/gm, "' destructive PID stop disabled by test")
      .replace(/^Call TerminateByName.*$/gm, "' destructive name stop disabled by test")
      .replace('exitCode = shell.Run(command, 1, True)', 'exitCode = 0')
    await writeFile(scriptPath, safeScript, 'utf8')
    expect(() => execFileSync('cscript.exe', ['//B', '//NoLogo', scriptPath])).not.toThrow()
    expect(await readFile(markerPath, 'utf8')).toContain('started')
    await rm(root, { recursive: true, force: true })
  })
})
