import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { rm } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'

const execFileAsync = promisify(execFile)

export interface StackProcess {
  pid: number
  parentPid?: number
  name: string
  path: string
  commandLine?: string
}

const TARGET_NAMES = new Set(['httpd.exe', 'mariadbd.exe', 'mysqld.exe', 'php-cgi.exe', 'php.exe', 'weebx.exe', 'weebx core.exe'])

function normalize(path: string): string {
  return path.replace(/\//g, '\\').toLowerCase()
}

export function isInsideDirectory(parent: string, child: string): boolean {
  const relation = relative(resolve(parent), resolve(child))
  return relation !== '' && !relation.startsWith('..') && !isAbsolute(relation)
}

export function isManagedRuntimeForRemoval(userData: string, runtimeRoot: string, systemDrive = process.env.SystemDrive || 'C:'): boolean {
  const defaultRoot = resolve(`${systemDrive}\\`, 'WeebX')
  return isInsideDirectory(userData, runtimeRoot) || normalize(resolve(runtimeRoot)) === normalize(defaultRoot)
}

export function isDefaultUserDataForRemoval(appData: string, userData: string): boolean {
  return normalize(resolve(userData)) === normalize(resolve(appData, 'WeebX'))
}

export async function clearResetStateBeforeUninstall(userData: string, runtimeRoot: string): Promise<void> {
  // Remove only a runtime in WeebX user data or the exact C:\WeebX default.
  // A custom external/shared directory is deliberately preserved.
  if (isManagedRuntimeForRemoval(userData, runtimeRoot)) {
    await rm(runtimeRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 })
  }
  await rm(join(userData, 'weebx.json'), { force: true, maxRetries: 5, retryDelay: 250 })
}

export function shouldStopProcess(processInfo: StackProcess, runtimeRoot?: string, currentPid = process.pid): boolean {
  if (processInfo.pid === currentPid) return false
  const name = processInfo.name.toLowerCase()
  if (!TARGET_NAMES.has(name)) return false
  const path = normalize(processInfo.path)
  if (name === 'weebx.exe' || name === 'weebx core.exe') {
    // Electron renderers, GPU, and utility processes use the same executable.
    // Killing them from an IPC request destroys the uninstall page before the
    // request can complete and leaves a blank native window behind.
    if (processInfo.parentPid === currentPid || /(?:^|\s)--type=/i.test(processInfo.commandLine || '')) return false
    return path.includes('weebx') || !path
  }
  if (runtimeRoot && path.startsWith(normalize(runtimeRoot))) return true
  return path.includes('\\weebx\\') || path.includes('\\weebx ')
}

async function listWindowsProcesses(): Promise<StackProcess[]> {
  const script = [
    'Get-CimInstance Win32_Process |',
    'Select-Object ProcessId, ParentProcessId, Name, ExecutablePath, CommandLine |',
    'ConvertTo-Json -Compress'
  ].join(' ')
  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide: true, timeout: 15000 })
    const parsed = JSON.parse(stdout || '[]') as Array<{ ProcessId: number; ParentProcessId?: number; Name: string; ExecutablePath?: string; CommandLine?: string }> | { ProcessId: number; ParentProcessId?: number; Name: string; ExecutablePath?: string; CommandLine?: string }
    const rows = Array.isArray(parsed) ? parsed : [parsed]
    return rows.map((row) => ({
      pid: Number(row.ProcessId),
      parentPid: Number(row.ParentProcessId) || undefined,
      name: String(row.Name || ''),
      path: String(row.ExecutablePath || ''),
      commandLine: String(row.CommandLine || '')
    }))
  } catch {
    return []
  }
}

export async function inspectStack(runtimeRoot?: string): Promise<{ apache: boolean; mariadb: boolean; weebx: boolean; processes: StackProcess[] }> {
  const processes = (await listWindowsProcesses()).filter((item) => shouldStopProcess(item, runtimeRoot))
  return {
    apache: processes.some((item) => item.name.toLowerCase() === 'httpd.exe'),
    mariadb: processes.some((item) => ['mariadbd.exe', 'mysqld.exe'].includes(item.name.toLowerCase())),
    weebx: processes.some((item) => ['weebx.exe', 'weebx core.exe'].includes(item.name.toLowerCase())),
    processes
  }
}

export async function stopStackProcesses(runtimeRoot?: string): Promise<{ apache: boolean; mariadb: boolean; weebx: boolean; stopped: number }> {
  const before = await inspectStack(runtimeRoot)
  for (const item of before.processes) {
    try { await execFileAsync('taskkill.exe', ['/PID', String(item.pid), '/T', '/F'], { windowsHide: true }) } catch { /* already gone */ }
  }
  await new Promise((resolve) => setTimeout(resolve, 400))
  const after = await inspectStack(runtimeRoot)
  return {
    apache: after.apache,
    mariadb: after.mariadb,
    weebx: after.weebx,
    stopped: Math.max(0, before.processes.length - after.processes.length)
  }
}

export interface WeebXUninstallEntry {
  guid: string
  key: string
}

export async function findWeebXUninstallEntry(): Promise<WeebXUninstallEntry | null> {
  const hives = [
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
  ]
  for (const hive of hives) {
    try {
      const { stdout } = await execFileAsync('reg.exe', ['query', hive, '/s', '/f', 'WeebX', '/d'], { windowsHide: true, timeout: 12000 })
      const key = stdout.split(/\r?\n/).map((line) => line.trim()).find((line) => /\\Uninstall\\/i.test(line))
      if (!key) continue
      const display = await queryRegValue(key, 'DisplayName')
      if (display && !/^weebx$/i.test(display) && !display.toLowerCase().startsWith('weebx ')) continue
      const uninstall = await queryRegValue(key, 'UninstallString')
      const stored = await queryRegValue(key, 'WeebXMsiProduct')
      const guid = stored?.match(/\{[0-9A-F-]+\}/i)?.[0]
        || key.match(/\{[0-9A-F-]+\}/i)?.[0]
        || uninstall?.match(/\{[0-9A-F-]+\}/i)?.[0]
      if (guid) return { guid, key }
    } catch { /* hive missing */ }
  }
  return null
}

export async function findWeebXProductCode(): Promise<string | null> {
  return (await findWeebXUninstallEntry())?.guid ?? null
}

export function uninstallHelperArgs(scriptPath: string): string[] {
  return ['//NoLogo', scriptPath]
}

export function buildMsiUninstallScript(input: { guid: string; exeName?: string; removeAppData?: boolean; userData?: string; startedMarker?: string; uninstallerPid?: number }): string {
  const exe = input.exeName || 'WeebX.exe'
  const vb = (value: string): string => value.replace(/"/g, '""')
  const lines = [
    'Option Explicit',
    'On Error Resume Next',
    'Dim shell, fso, wmi, helperLogPath, msiLogPath, helperLog, markerFile',
    'Dim attempt, exitCode, command',
    'Set shell = CreateObject("WScript.Shell")',
    'Set fso = CreateObject("Scripting.FileSystemObject")',
    'Set wmi = GetObject("winmgmts:\\\\.\\root\\cimv2")',
    'helperLogPath = shell.ExpandEnvironmentStrings("%TEMP%\\weebx-uninstall-helper.log")',
    'msiLogPath = shell.ExpandEnvironmentStrings("%TEMP%\\weebx-uninstall-msi.log")',
    'Set helperLog = fso.CreateTextFile(helperLogPath, True)',
    'helperLog.WriteLine Now & " - WeebX uninstall helper started."',
    ...(input.startedMarker ? [
      `Set markerFile = fso.CreateTextFile("${vb(input.startedMarker)}", True)`,
      'markerFile.WriteLine "started"',
      'markerFile.Close'
    ] : []),
    ...(input.uninstallerPid ? [
      'For attempt = 1 To 20',
      `  If Not ProcessExists(${input.uninstallerPid}) Then Exit For`,
      '  WScript.Sleep 1000',
      'Next',
      `Call TerminateByPid(${input.uninstallerPid})`
    ] : [
      'For attempt = 1 To 20',
      `  If Not ProcessNameExists("${vb(exe)}") Then Exit For`,
      '  WScript.Sleep 1000',
      'Next'
    ]),
    // The active uninstaller has exited. WMI terminates remaining helpers and
    // services without opening cmd.exe or relying on a command pipeline.
    `Call TerminateByName("${vb(exe)}")`,
    'Call TerminateByName("WeebX Core.exe")', // older dual-exe builds used this name
    'Call TerminateByName("httpd.exe")',
    'Call TerminateByName("mariadbd.exe")',
    'Call TerminateByName("mysqld.exe")',
    'WScript.Sleep 2000',
    `command = "msiexec.exe /x ${input.guid} /passive /norestart /L*v " & Chr(34) & msiLogPath & Chr(34)`,
    'Err.Clear',
    'exitCode = shell.Run(command, 1, True)',
    'If Err.Number <> 0 Then exitCode = -1',
    'helperLog.WriteLine "MSI exit code: " & CStr(exitCode)',
    'If exitCode <> 0 And exitCode <> 1605 And exitCode <> 3010 Then',
    '  helperLog.Close',
    '  MsgBox "Windows Installer could not remove WeebX." & vbCrLf & "Details: " & helperLogPath, vbOKOnly + vbCritical, "WeebX uninstall failed"',
    '  WScript.Quit 1',
    'End If'
  ]
  if (input.removeAppData && input.userData) {
    lines.push(
      'For attempt = 1 To 8',
      `  If Not fso.FolderExists("${vb(input.userData)}") Then Exit For`,
      `  fso.DeleteFolder "${vb(input.userData)}", True`,
      '  WScript.Sleep 1000',
      'Next'
    )
  }
  lines.push(
    'helperLog.WriteLine "Uninstall completed."',
    'helperLog.Close',
    'WScript.Quit 0',
    '',
    'Function ProcessExists(pid)',
    '  Dim items',
    '  Set items = wmi.ExecQuery("SELECT ProcessId FROM Win32_Process WHERE ProcessId = " & CStr(pid))',
    '  ProcessExists = (items.Count > 0)',
    'End Function',
    '',
    'Function ProcessNameExists(processName)',
    '  Dim items',
    '  Set items = wmi.ExecQuery("SELECT ProcessId FROM Win32_Process WHERE Name = " & Chr(39) & processName & Chr(39))',
    '  ProcessNameExists = (items.Count > 0)',
    'End Function',
    '',
    'Sub TerminateByPid(pid)',
    '  Dim item',
    '  For Each item In wmi.ExecQuery("SELECT * FROM Win32_Process WHERE ProcessId = " & CStr(pid))',
    '    item.Terminate',
    '  Next',
    'End Sub',
    '',
    'Sub TerminateByName(processName)',
    '  Dim item',
    '  For Each item In wmi.ExecQuery("SELECT * FROM Win32_Process WHERE Name = " & Chr(39) & processName & Chr(39))',
    '    item.Terminate',
    '  Next',
    'End Sub'
  )
  return `${lines.join('\r\n')}\r\n`
}

export async function pointUninstallToApp(exePath: string): Promise<void> {
  const entry = await findWeebXUninstallEntry()
  if (!entry) return
  const command = `"${exePath}" --uninstall`
  await execFileAsync('reg.exe', ['add', entry.key, '/v', 'WeebXMsiProduct', '/t', 'REG_SZ', '/d', entry.guid, '/f'], { windowsHide: true })
  await execFileAsync('reg.exe', ['add', entry.key, '/v', 'UninstallString', '/t', 'REG_SZ', '/d', command, '/f'], { windowsHide: true })
  await execFileAsync('reg.exe', ['add', entry.key, '/v', 'QuietUninstallString', '/t', 'REG_SZ', '/d', command, '/f'], { windowsHide: true })
}

async function queryRegValue(key: string, name: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('reg.exe', ['query', key, '/v', name], { windowsHide: true, timeout: 8000 })
    const match = stdout.match(new RegExp(`${name}\\s+REG_\\w+\\s+(.+)$`, 'im'))
    return match?.[1]?.trim() || null
  } catch {
    return null
  }
}
