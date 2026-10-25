import { execFile } from 'node:child_process'
import { createServer } from 'node:net'
import { promisify } from 'node:util'
import type { PortInfo } from '../shared/types'

const execFileAsync = promisify(execFile)

async function canBind(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    server.unref()
    server.once('error', () => resolve(false))
    server.listen({ host: '127.0.0.1', port }, () => server.close(() => resolve(true)))
  })
}

async function windowsOwner(port: number): Promise<{ pid: number | null; processName: string | null }> {
  if (process.platform !== 'win32') return { pid: null, processName: null }
  try {
    const ps = `(Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess)`
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true })
    const pid = Number.parseInt(stdout.trim(), 10)
    if (!Number.isFinite(pid)) return { pid: null, processName: null }
    const task = await execFileAsync('tasklist.exe', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { windowsHide: true })
    const processName = task.stdout.match(/^"([^"]+)"/)?.[1] ?? null
    return { pid, processName }
  } catch {
    return { pid: null, processName: null }
  }
}

export async function inspectPort(port: number): Promise<PortInfo> {
  const available = await canBind(port)
  const owner = available ? { pid: null, processName: null } : await windowsOwner(port)
  return { port, available, ...owner }
}

export async function inspectPorts(ports: number[]): Promise<PortInfo[]> {
  return Promise.all([...new Set(ports)].map(inspectPort))
}
