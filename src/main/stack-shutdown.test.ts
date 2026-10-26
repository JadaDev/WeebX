import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildMsiUninstallScript, clearResetStateBeforeUninstall, isDefaultUserDataForRemoval, isInsideDirectory, isManagedRuntimeForRemoval, shouldStopProcess, uninstallHelperArgs } from './stack-shutdown'

describe('stack shutdown matching', () => {
  it('stops WeebX Apache and MariaDB processes but not the current app', () => {
    const runtime = 'C:\\Users\\JadaDev\\AppData\\Roaming\\weebx\\runtime'
    expect(shouldStopProcess({ pid: 10, name: 'httpd.exe', path: `${runtime}\\apache\\bin\\httpd.exe` }, runtime, 99)).toBe(true)
    expect(shouldStopProcess({ pid: 11, name: 'mariadbd.exe', path: `${runtime}\\mariadb\\bin\\mariadbd.exe` }, runtime, 99)).toBe(true)
    expect(shouldStopProcess({ pid: 99, name: 'WeebX.exe', path: 'C:\\Program Files\\WeebX\\WeebX.exe' }, runtime, 99)).toBe(false)
    expect(shouldStopProcess({ pid: 12, name: 'WeebX.exe', path: 'C:\\Program Files\\WeebX\\WeebX.exe' }, runtime, 99)).toBe(true)
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
  it('uses Windows Script Host without a console window', () => {
    expect(uninstallHelperArgs('C:\\Users\\Test User\\AppData\\Local\\Temp\\weebx-uninstall.vbs')).toEqual([
      '//NoLogo', 'C:\\Users\\Test User\\AppData\\Local\\Temp\\weebx-uninstall.vbs'
    ])
  })

  it('writes a startup handshake and an MSI log', () => {
    const script = buildMsiUninstallScript({
      guid: '{00000000-0000-0000-0000-000000000000}',
      startedMarker: 'C:\\Temp\\weebx-uninstall.started'
    })
    expect(script).toContain('Set markerFile = fso.CreateTextFile("C:\\Temp\\weebx-uninstall.started", True)')
    expect(script).toContain('msiexec.exe /x {00000000-0000-0000-0000-000000000000} /passive /norestart /L*v')
    expect(script).toContain('shell.ExpandEnvironmentStrings("%TEMP%\\weebx-uninstall-msi.log")')
  })

  it('waits for the active uninstaller and removes it last', () => {
    const script = buildMsiUninstallScript({
      guid: '{00000000-0000-0000-0000-000000000000}',
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
