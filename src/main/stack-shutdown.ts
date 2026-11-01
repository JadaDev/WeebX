import { execFile, type SpawnOptions } from 'node:child_process'
import { promisify } from 'node:util'
import { rm } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

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

export const NIL_PRODUCT_GUID = '{00000000-0000-0000-0000-000000000000}'
/** Stable electron-builder MSI UpgradeCode for appId `com.jadadev.weebx`. */
export const WEEBX_MSI_UPGRADE_CODE = '{61426C6F-20E7-5607-9CB4-9839BDA579D6}'

export interface WeebXUninstallEntry {
  guid: string
  key: string
  displayName?: string | null
  uninstallString?: string | null
  quietUninstallString?: string | null
  storedProduct?: string | null
  windowsInstaller?: boolean
}

export interface WeebXUninstallPlan {
  productCodes: string[]
  leftoverKeys: string[]
  installFolder?: string
}

export function productGuidFrom(value: string | null | undefined): string | undefined {
  const match = String(value ?? '').match(/\{[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\}/i)
  const guid = match?.[0].toUpperCase()
  if (!guid || guid === NIL_PRODUCT_GUID) return undefined
  return guid
}

export function isUsableProductGuid(value: string | null | undefined): value is string {
  return Boolean(productGuidFrom(value))
}

export function isWeebXUninstallDisplayName(display: string | null | undefined): boolean {
  if (!display) return false
  const name = display.trim()
  return /^weebx$/i.test(name) || name.toLowerCase().startsWith('weebx ')
}

export function isWeebXManagedUninstallCommand(value: string | null | undefined): boolean {
  return /weebx\.exe["']?\s+--uninstall/i.test(String(value ?? ''))
}

export function parseInstalledProductLines(stdout: string): string[] {
  return [...new Set(String(stdout).split(/\r?\n/).map((line) => productGuidFrom(line)).filter((guid): guid is string => Boolean(guid)))]
}

export function preferWeebXUninstallEntry(candidates: WeebXUninstallEntry[], installed = new Set<string>()): WeebXUninstallEntry | null {
  const usable = candidates.filter((entry) => isUsableProductGuid(entry.guid) && (!installed.size || installed.has(entry.guid.toUpperCase())))
  if (!usable.length) return null
  const score = (entry: WeebXUninstallEntry): number => {
    let value = 0
    if (/^HKEY_LOCAL_MACHINE\\/i.test(entry.key) || /^HKLM\\/i.test(entry.key)) value += 8
    if (/\\Uninstall\\\{[0-9A-F-]{36}\}/i.test(entry.key)) value += 16
    if (productGuidFrom(entry.key) === entry.guid.toUpperCase()) value += 4
    if (entry.windowsInstaller) value += 12
    if (isWeebXUninstallDisplayName(entry.displayName)) value += 10
    if (installed.has(entry.guid.toUpperCase())) value += 32
    return value
  }
  return [...usable].sort((left, right) => score(right) - score(left))[0]
}

export function packagedInstallFolder(exePath: string, packaged = true): string | undefined {
  if (!packaged || !exePath) return undefined
  const folder = dirname(exePath)
  if (basename(folder).toLowerCase() !== 'weebx') return undefined
  return folder
}

async function listUninstallKeysContainingWeebX(): Promise<string[]> {
  const hives = [
    'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
  ]
  const keys: string[] = []
  for (const hive of hives) {
    try {
      const { stdout } = await execFileAsync('reg.exe', ['query', hive, '/s', '/f', 'WeebX', '/d'], { windowsHide: true, timeout: 12000 })
      keys.push(...stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => /^HKEY_.+\\Uninstall\\/i.test(line)))
    } catch { /* hive missing */ }
  }
  return [...new Set(keys)]
}

async function readUninstallCandidate(key: string): Promise<WeebXUninstallEntry | null> {
  const displayName = await queryRegValue(key, 'DisplayName')
  const uninstallString = await queryRegValue(key, 'UninstallString')
  const quietUninstallString = await queryRegValue(key, 'QuietUninstallString')
  const storedProduct = await queryRegValue(key, 'WeebXMsiProduct')
  const windowsInstaller = /^(?:0x)?1$/i.test(String(await queryRegValue(key, 'WindowsInstaller') ?? ''))
  const guid = productGuidFrom(storedProduct) || productGuidFrom(key) || productGuidFrom(uninstallString) || productGuidFrom(quietUninstallString)
  const looksLikeWeebX = isWeebXUninstallDisplayName(displayName) || isWeebXManagedUninstallCommand(uninstallString) || isWeebXManagedUninstallCommand(quietUninstallString) || Boolean(storedProduct && productGuidFrom(storedProduct))
  if (!looksLikeWeebX) return null
  return { guid: guid ?? '', key, displayName, uninstallString, quietUninstallString, storedProduct, windowsInstaller }
}

export async function listInstalledWeebXMsiProducts(): Promise<{ codes: string[]; queryOk: boolean }> {
  const script = [
    '$ErrorActionPreference = "Stop"',
    '$installer = New-Object -ComObject WindowsInstaller.Installer',
    `$upgrade = '${WEEBX_MSI_UPGRADE_CODE}'`,
    '$codes = New-Object System.Collections.Generic.List[string]',
    'try { foreach ($code in @($installer.RelatedProducts($upgrade))) { if ($code) { [void]$codes.Add(([string]$code).ToUpper()) } } } catch {}',
    'try { foreach ($code in @($installer.Products())) { $name = ""; try { $name = [string]$installer.ProductInfo($code, "ProductName") } catch {}; if ($name -match "^WeebX(\\s|$)") { [void]$codes.Add(([string]$code).ToUpper()) } } } catch {}',
    '$codes | Select-Object -Unique'
  ].join('; ')
  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide: true, timeout: 20000 })
    return { codes: parseInstalledProductLines(stdout), queryOk: true }
  } catch {
    return { codes: [], queryOk: false }
  }
}

export async function collectWeebXUninstallCandidates(): Promise<WeebXUninstallEntry[]> {
  const candidates: WeebXUninstallEntry[] = []
  for (const key of await listUninstallKeysContainingWeebX()) {
    const candidate = await readUninstallCandidate(key)
    if (candidate) candidates.push(candidate)
  }
  return candidates
}

export function leftoverWeebXUninstallKeys(candidates: WeebXUninstallEntry[], installed: Set<string>): string[] {
  return candidates.filter((entry) => {
    const guid = productGuidFrom(entry.guid) || productGuidFrom(entry.key) || productGuidFrom(entry.storedProduct)
    if (guid && installed.has(guid)) return false
    if (isWeebXUninstallDisplayName(entry.displayName) && entry.windowsInstaller && guid && !installed.has(guid) && installed.size > 0) return true
    return isWeebXManagedUninstallCommand(entry.uninstallString) || isWeebXManagedUninstallCommand(entry.quietUninstallString) || Boolean(entry.storedProduct)
  }).map((entry) => entry.key)
}

export async function findWeebXUninstallPlan(options?: { exePath?: string; packaged?: boolean }): Promise<WeebXUninstallPlan> {
  const { codes, queryOk } = await listInstalledWeebXMsiProducts()
  const installed = new Set(codes)
  const candidates = await collectWeebXUninstallCandidates()
  const fromNamedArp = candidates
    .filter((entry) => isWeebXUninstallDisplayName(entry.displayName))
    .map((entry) => productGuidFrom(entry.key) || productGuidFrom(entry.guid))
    .filter((guid): guid is string => Boolean(guid))
  const productCodes = queryOk ? codes : [...new Set([...codes, ...fromNamedArp])]
  const folder = packagedInstallFolder(options?.exePath || '', options?.packaged !== false)
  return {
    productCodes,
    leftoverKeys: leftoverWeebXUninstallKeys(candidates, installed),
    ...(folder ? { installFolder: folder } : {})
  }
}

export async function findWeebXUninstallEntry(): Promise<WeebXUninstallEntry | null> {
  const { codes, queryOk } = await listInstalledWeebXMsiProducts()
  const installed = new Set(codes)
  const named = (await collectWeebXUninstallCandidates()).filter((entry) => isWeebXUninstallDisplayName(entry.displayName) && isUsableProductGuid(entry.guid))
  return preferWeebXUninstallEntry(named, queryOk ? installed : new Set())
}

export async function findWeebXProductCode(): Promise<string | null> {
  const plan = await findWeebXUninstallPlan()
  return plan.productCodes[0] ?? (await findWeebXUninstallEntry())?.guid ?? null
}

export async function removeOrphanWeebXUninstallKeys(): Promise<string[]> {
  const { codes, queryOk } = await listInstalledWeebXMsiProducts()
  if (!queryOk) return []
  const removed: string[] = []
  for (const key of leftoverWeebXUninstallKeys(await collectWeebXUninstallCandidates(), new Set(codes))) {
    try {
      await execFileAsync('reg.exe', ['delete', key, '/f'], { windowsHide: true, timeout: 8000 })
      removed.push(key)
    } catch { /* needs elevation or already gone */ }
  }
  return removed
}

/** Launch wscript through `cmd start` so Electron's Windows job cannot kill msiexec. */
export function uninstallHelperLaunch(scriptPath: string): { file: string; args: string[]; options: SpawnOptions } {
  return {
    file: process.env.ComSpec || 'cmd.exe',
    args: ['/d', '/s', '/c', `start "WeebX Uninstall Helper" /min wscript.exe //NoLogo "${scriptPath}"`],
    options: {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      windowsVerbatimArguments: true
    }
  }
}

export function uninstallHelperArgs(scriptPath: string): string[] {
  return uninstallHelperLaunch(scriptPath).args
}

export function buildMsiUninstallScript(input: {
  guid?: string
  productCodes?: string[]
  leftoverKeys?: string[]
  installFolder?: string
  exeName?: string
  removeAppData?: boolean
  userData?: string
  startedMarker?: string
  uninstallerPid?: number
}): string {
  const exe = input.exeName || 'WeebX.exe'
  const vb = (value: string): string => value.replace(/"/g, '""')
  const productCodes = [...new Set([...(input.productCodes ?? []), input.guid].map((value) => productGuidFrom(value ?? '')).filter((guid): guid is string => Boolean(guid)))]
  const leftoverKeys = [...new Set((input.leftoverKeys ?? []).map((key) => key.trim()).filter(Boolean))]
  const installFolder = input.installFolder?.trim()
  const productArray = productCodes.length ? productCodes.map((guid) => `"${guid}"`).join(',') : '""'
  const leftoverArray = leftoverKeys.length ? leftoverKeys.map((key) => `"${vb(key)}"`).join(',') : '""'
  const needAdmin = productCodes.length > 0 || leftoverKeys.some((key) => /HKEY_LOCAL_MACHINE\\/i.test(key)) || /\\program files/i.test(installFolder ?? '')
  const lines = [
    'Option Explicit',
    'On Error Resume Next',
    'Dim shell, fso, wmi, helperLogPath, msiLogPath, helperLog, markerFile',
    'Dim attempt, exitCode, command, guid, key, productCodes, leftoverKeys, msiexec, msiNeeded, msiOk',
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
      'For attempt = 1 To 45',
      `  If Not ProcessExists(${input.uninstallerPid}) Then Exit For`,
      '  WScript.Sleep 1000',
      'Next',
      `Call TerminateByPid(${input.uninstallerPid})`
    ] : [
      'For attempt = 1 To 45',
      `  If Not ProcessNameExists("${vb(exe)}") Then Exit For`,
      '  WScript.Sleep 1000',
      'Next'
    ]),
    `Call TerminateByName("${vb(exe)}")`,
    'Call TerminateByName("WeebX Core.exe")',
    'Call TerminateByName("httpd.exe")',
    'Call TerminateByName("mariadbd.exe")',
    'Call TerminateByName("mysqld.exe")',
    `For attempt = 1 To 30`,
    `  If Not ProcessNameExists("${vb(exe)}") Then Exit For`,
    `  Call TerminateByName("${vb(exe)}")`,
    '  WScript.Sleep 1000',
    'Next',
    'WScript.Sleep 1500',
    ...(needAdmin ? [
      'If WScript.Arguments.Count = 0 Then',
      '  helperLog.WriteLine "Requesting administrator approval to finish uninstall."',
      '  helperLog.Close',
      '  CreateObject("Shell.Application").ShellExecute "wscript.exe", Chr(34) & WScript.ScriptFullName & Chr(34) & " elevated", "", "runas", 1',
      '  WScript.Quit 0',
      'End If',
      'Set helperLog = fso.OpenTextFile(helperLogPath, 8, True)',
      'helperLog.WriteLine Now & " - elevated uninstall helper running."'
    ] : []),
    'msiNeeded = False',
    'msiOk = False',
    `productCodes = Array(${productArray})`,
    'msiexec = Chr(34) & shell.ExpandEnvironmentStrings("%SystemRoot%\\System32\\msiexec.exe") & Chr(34)',
    'For Each guid In productCodes',
    '  If guid <> "" Then',
    '    msiNeeded = True',
    '    command = msiexec & " /x " & guid & " /qb /norestart /L*v " & Chr(34) & msiLogPath & Chr(34)',
    '    helperLog.WriteLine "Running " & command',
    '    For attempt = 1 To 3',
    '      Err.Clear',
    '      exitCode = shell.Run(command, 1, True)',
    '      If Err.Number <> 0 Then exitCode = -1',
    '      helperLog.WriteLine "MSI " & guid & " attempt " & CStr(attempt) & " exit code: " & CStr(exitCode)',
    '      If exitCode = 0 Or exitCode = 3010 Then',
    '        msiOk = True',
    '        Exit For',
    '      End If',
    '      If exitCode <> 1618 Then Exit For',
    '      WScript.Sleep 3000',
    '    Next',
    '    If exitCode = 1605 Then helperLog.WriteLine "Product " & guid & " is not registered."',
    '    If msiOk Then Exit For',
    '  End If',
    'Next',
    'If msiNeeded = False Then msiOk = True',
    `leftoverKeys = Array(${leftoverArray})`,
    'For Each key In leftoverKeys',
    '  If key <> "" Then',
    '    helperLog.WriteLine "Removing leftover uninstall key " & key',
    '    shell.Run "reg.exe delete " & Chr(34) & key & Chr(34) & " /f", 0, True',
    '  End If',
    'Next',
    ...(installFolder ? [
      `If fso.FolderExists("${vb(installFolder)}") Then`,
      `  helperLog.WriteLine "Removing leftover application folder ${vb(installFolder)}"`,
      `  fso.DeleteFolder "${vb(installFolder)}", True`,
      'End If',
      `If (msiOk = False) And fso.FolderExists("${vb(installFolder)}") Then`,
      '  helperLog.Close',
      '  MsgBox "Windows Installer could not remove WeebX." & vbCrLf & "Details: " & helperLogPath, vbOKOnly + vbCritical, "WeebX uninstall failed"',
      '  WScript.Quit 1',
      'End If'
    ] : [
      'If (msiNeeded = True) And (msiOk = False) Then',
      '  helperLog.WriteLine "MSI product was not registered; leftover WeebX registration was removed."',
      'End If'
    ])
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
  await removeOrphanWeebXUninstallKeys().catch(() => [])
  const plan = await findWeebXUninstallPlan({ exePath, packaged: true })
  const guid = plan.productCodes[0]
  if (!guid) return
  const entry = (await collectWeebXUninstallCandidates()).find((item) => (productGuidFrom(item.key) || item.guid) === guid && isWeebXUninstallDisplayName(item.displayName))
    ?? (await findWeebXUninstallEntry())
  if (!entry || !isWeebXUninstallDisplayName(entry.displayName) || !isUsableProductGuid(entry.guid)) return
  const command = `"${exePath}" --uninstall`
  await execFileAsync('reg.exe', ['add', entry.key, '/v', 'WeebXMsiProduct', '/t', 'REG_SZ', '/d', guid, '/f'], { windowsHide: true })
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
