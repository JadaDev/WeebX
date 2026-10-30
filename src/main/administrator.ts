import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { dirname } from 'node:path'

const execFileAsync = promisify(execFile)
let elevated: Promise<boolean> | undefined

function encodePowerShell(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64')
}

function psLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

export function isElevated(): Promise<boolean> {
  if (process.platform !== 'win32') return Promise.resolve(process.getuid?.() === 0)
  elevated ??= execFileAsync('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
    '[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)'
  ], { windowsHide: true, timeout: 10000 })
    .then(({ stdout }) => stdout.trim().toLowerCase() === 'true')
    .catch(() => false)
  return elevated
}

/**
 * Starts an elevated helper now (so UAC can be accepted or cancelled while the
 * current window is still open). The helper waits for this process to exit,
 * then launches the same executable and preserves portable data-directory use.
 */
export async function prepareElevatedRelaunch(additionalArgs: string[] = []): Promise<void> {
  if (process.platform !== 'win32') throw new Error('Administrator restart is only available on Windows.')
  if (await isElevated()) return

  const preservedArgs = [...additionalArgs, ...process.argv
    .slice(1)
    .filter((argument) => argument.startsWith('--weebx-data-dir='))]
  const argumentList = preservedArgs.length ? ` -ArgumentList @(${preservedArgs.map(psLiteral).join(',')})` : ''
  const elevatedScript = [
    `Wait-Process -Id ${process.pid} -ErrorAction SilentlyContinue`,
    `Start-Process -FilePath ${psLiteral(process.execPath)} -WorkingDirectory ${psLiteral(dirname(process.execPath))}${argumentList}`
  ].join('; ')
  const launcher = `Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden -ArgumentList @('-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand','${encodePowerShell(elevatedScript)}') -PassThru | Out-Null`

  try {
    await execFileAsync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodePowerShell(launcher)], {
      windowsHide: true,
      timeout: 120000
    })
  } catch (error) {
    const detail = error instanceof Error && error.message ? ` ${error.message}` : ''
    throw new Error(`Administrator restart was cancelled or blocked by Windows.${detail}`)
  }
}
