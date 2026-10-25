import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

export function stopRuntimeProcesses(runtimeRoot: string): Promise<void> {
  if (process.platform !== 'win32' || !runtimeRoot) return Promise.resolve()
  const root = resolve(runtimeRoot)
  return new Promise((done) => {
    const child = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      'Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($env:WEEBX_RUNTIME_ROOT, [StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }'
    ], { windowsHide: true, env: { ...process.env, WEEBX_RUNTIME_ROOT: root } })
    const timer = setTimeout(() => { child.kill(); done() }, 8000)
    child.once('close', () => { clearTimeout(timer); done() })
    child.once('error', () => { clearTimeout(timer); done() })
  })
}
