import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { promisify } from 'node:util'
import { access } from 'node:fs/promises'
import type { AutoRestartDelayMs, ServiceId, ServiceStatus } from '../shared/types'
import type { JsonStore } from './store'
import type { LogBuffer } from './logs'
import { inspectPort } from './ports'
import { runtimePaths } from './paths'
import type { ConfigManager } from './config-manager'

const execFileAsync = promisify(execFile)

type StatusListener = (status: ServiceStatus) => void

const delayLabel = (delay: AutoRestartDelayMs): string => delay >= 60000
  ? `${delay / 60000} minute${delay === 60000 ? '' : 's'}`
  : `${delay / 1000} seconds`

export function describeProcessExit(label: string, code: number | null, intentional: boolean, diagnostic = ''): { level: 'info' | 'error'; state: 'stopped' | 'error'; log: string; message?: string } {
  if (intentional) return { level: 'info', state: 'stopped', log: `${label} stopped.` }
  const reason = code === null ? 'without an exit code' : `with exit code ${code}`
  const detail = diagnostic.trim() ? ` Details: ${diagnostic.trim()}` : ''
  const message = `${label} stopped unexpectedly ${reason}.${detail}`
  return { level: 'error', state: 'error', log: message, message }
}

export function classifyServiceOutput(output: string, stopping = false): 'info' | 'warn' | 'error' {
  if (stopping) return 'info'
  let result: 'info' | 'warn' | 'error' = 'info'
  for (const line of output.split(/\r?\n/).filter(Boolean)) {
    const explicitError = /\[(?:error|fatal)\]|:(?:emerg|alert|crit|error)\]/i.test(line)
    const explicitWarning = /\[(?:warning|warn)\]|:warn\]/i.test(line)
    const explicitInformation = /\[(?:note|system|info|notice)\]|:(?:notice|info)\]/i.test(line)
    const level = explicitError ? 'error'
      : explicitWarning ? 'warn'
        : explicitInformation ? 'info'
          : /error|fatal|failed|exception/i.test(line) ? 'error' : 'warn'
    if (level === 'error') return 'error'
    if (level === 'warn') result = 'warn'
  }
  return result
}

export class ProcessManager {
  private children = new Map<ServiceId, ChildProcessWithoutNullStreams>()
  private statuses = new Map<ServiceId, ServiceStatus>()
  private listeners = new Set<StatusListener>()
  private intentionalStops = new Set<ServiceId>()
  private restartTimers = new Map<ServiceId, ReturnType<typeof setTimeout>>()
  private diagnostics = new Map<ServiceId, string[]>()

  constructor(
    private readonly store: JsonStore,
    private readonly logs: LogBuffer,
    private readonly configs: ConfigManager
  ) {}

  async initialize(): Promise<void> {
    const settings = await this.store.getSettings()
    const paths = runtimePaths(settings)
    this.statuses.set('apache', this.baseStatus('apache', settings.apachePort))
    this.statuses.set('mariadb', { ...this.baseStatus('mariadb', settings.mariadbPort), version: await this.readMariaDbVersion(paths.mariadbExe) })
  }

  list(): ServiceStatus[] {
    return ['apache', 'mariadb'].map((id) => ({ ...this.statuses.get(id as ServiceId)! }))
  }

  status(id: ServiceId): ServiceStatus {
    return { ...this.statuses.get(id)! }
  }

  subscribe(listener: StatusListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async start(id: ServiceId, allowBeforeSetup = false): Promise<ServiceStatus> {
    this.cancelRestart(id)
    this.intentionalStops.delete(id)
    const current = this.statuses.get(id)!
    if (current.state === 'running' || current.state === 'starting') return { ...current }
    const settings = await this.store.getSettings()
    if (!settings.setupComplete && !allowBeforeSetup) {
      return this.update(id, { state: 'error', message: 'Complete first-run security setup before starting public services.' })
    }
    const paths = runtimePaths(settings)
    const executable = id === 'apache' ? paths.apacheExe : paths.mariadbExe
    const port = id === 'apache' ? settings.apachePort : settings.mariadbPort

    try { await access(executable) } catch {
      return this.update(id, { state: 'error', message: `${id === 'apache' ? 'Apache' : 'MariaDB'} is not installed.` })
    }
    if (settings.checkPortsBeforeStart) {
      const portState = await inspectPort(port)
      if (!portState.available) {
        const owner = portState.processName ? ` by ${portState.processName} (PID ${portState.pid})` : ''
        return this.update(id, { state: 'error', message: `Port ${port} is already in use${owner}.` })
      }
    }

    if (id === 'apache') {
      const validation = await this.validate('apache')
      if (!validation.ok) return this.update(id, { state: 'error', message: validation.output })
    }
    this.update(id, { state: 'starting', message: undefined })
    const args = id === 'apache'
      ? ['-f', paths.apacheConf]
      : [`--defaults-file=${paths.mariadbConf}`, '--console']
    const cwd = id === 'apache' ? paths.apache : paths.mariadb
    const child = spawn(executable, args, { cwd, windowsHide: true, stdio: 'pipe' })
    this.children.set(id, child)
    this.diagnostics.set(id, [])
    child.stdout.on('data', (data) => this.logs.add(id, 'info', data.toString()))
    child.stderr.on('data', (data) => {
      const output = data.toString().trim()
      if (!output) return
      const recent = this.diagnostics.get(id) ?? []
      recent.push(output)
      if (recent.length > 8) recent.splice(0, recent.length - 8)
      this.diagnostics.set(id, recent)
      const stopping = this.intentionalStops.has(id) || this.statuses.get(id)?.state === 'stopping'
      this.logs.add(id, classifyServiceOutput(output, stopping), output)
    })
    child.once('error', (error) => {
      this.logs.add(id, 'error', `${this.label(id)} could not start: ${error.message}`)
      this.update(id, { state: 'error', pid: null, startedAt: null, message: error.message })
    })
    child.once('exit', (code) => {
      if (this.children.get(id) === child) this.children.delete(id)
      const intentional = this.intentionalStops.delete(id) || this.statuses.get(id)?.state === 'stopping'
      const diagnostic = this.summarizeDiagnostic(id)
      void this.handleExit(id, code, intentional, diagnostic)
    })
    await new Promise((resolve) => setTimeout(resolve, 350))
    if (child.exitCode === null) {
      this.logs.add(id, 'info', `${this.label(id)} started on port ${port} (PID ${child.pid}).`)
      return this.update(id, { state: 'running', pid: child.pid ?? null, port, startedAt: new Date().toISOString() })
    }
    return this.status(id)
  }

  async stop(id: ServiceId): Promise<ServiceStatus> {
    this.cancelRestart(id)
    const child = this.children.get(id)
    if (child) {
      this.intentionalStops.add(id)
      this.update(id, { state: 'stopping' })
      if (process.platform === 'win32' && child.pid) {
        spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
      } else child.kill('SIGTERM')
      await Promise.race([
        new Promise<void>((resolve) => child.once('exit', () => resolve())),
        new Promise<void>((resolve) => setTimeout(resolve, 4000))
      ])
      if (child.exitCode === null) child.kill('SIGKILL')
      this.children.delete(id)
    }
    if (process.platform === 'win32') {
      const names = id === 'apache' ? ['httpd.exe'] : ['mariadbd.exe', 'mysqld.exe']
      for (const name of names) {
        try { await execFileAsync('taskkill.exe', ['/IM', name, '/F'], { windowsHide: true }) } catch { /* already gone */ }
      }
    }
    return this.update(id, { state: 'stopped', pid: null, startedAt: null, message: undefined })
  }

  async restart(id: ServiceId): Promise<ServiceStatus> {
    await this.stop(id)
    return this.start(id)
  }

  async stopAll(): Promise<ServiceStatus[]> {
    await Promise.all((['apache', 'mariadb'] as ServiceId[]).map((id) => this.stop(id)))
    return this.list()
  }

  async validate(kind: 'php' | 'apache' | 'mariadb'): Promise<{ ok: boolean; output: string }> {
    const settings = await this.store.getSettings()
    const paths = runtimePaths(settings)
    const command = kind === 'apache' ? paths.apacheExe : kind === 'php' ? paths.phpExe : paths.mariadbExe
    const args = kind === 'apache' ? ['-t', '-f', paths.apacheConf] : kind === 'php' ? ['-n', '-c', paths.phpIni, '-v'] : [`--defaults-file=${paths.mariadbConf}`, '--help', '--verbose']
    try { await access(command) } catch { return { ok: false, output: `${kind} executable is not installed.` } }
    return new Promise((resolve) => {
      const child = spawn(command, args, { windowsHide: true })
      let output = ''
      child.stdout.on('data', (data) => { output += data })
      child.stderr.on('data', (data) => { output += data })
      child.once('error', (error) => resolve({ ok: false, output: error.message }))
      child.once('close', (code) => resolve({ ok: code === 0, output: output.trim() || (code === 0 ? 'Configuration is valid.' : `Exited with code ${code}.`) }))
    })
  }

  private update(id: ServiceId, patch: Partial<ServiceStatus>): ServiceStatus {
    const next = { ...this.statuses.get(id)!, ...patch }
    this.statuses.set(id, next)
    this.listeners.forEach((listener) => listener({ ...next }))
    return { ...next }
  }

  private baseStatus(id: ServiceId, port: number): ServiceStatus {
    return { id, name: this.label(id), state: 'stopped', pid: null, port, version: null, startedAt: null }
  }

  private label(id: ServiceId): string { return id === 'apache' ? 'Apache' : 'MariaDB' }

  private async handleExit(id: ServiceId, code: number | null, intentional: boolean, diagnostic: string): Promise<void> {
    const result = describeProcessExit(this.label(id), code, intentional, diagnostic)
    this.logs.add(id, result.level, result.log)
    if (intentional) {
      this.update(id, { state: 'stopped', pid: null, startedAt: null, message: undefined })
      return
    }

    this.update(id, { state: 'error', pid: null, startedAt: null, message: result.message })
    const settings = await this.store.getSettings()
    if (this.statuses.get(id)?.state === 'stopped') return
    const enabled = id === 'apache' ? settings.autoRestartApache : settings.autoRestartMariaDb
    const delay = settings.autoRestartDelayMs
    const restartMessage = enabled ? ` Automatic restart in ${delayLabel(delay)}.` : ''
    this.update(id, { state: 'error', pid: null, startedAt: null, message: `${result.message}${restartMessage}` })
    if (!enabled) return

    this.logs.add(id, 'info', `${this.label(id)} auto-restart scheduled in ${delayLabel(delay)}.`)
    const timer = setTimeout(() => {
      this.restartTimers.delete(id)
      this.logs.add(id, 'info', `Attempting automatic restart of ${this.label(id)}.`)
      void this.start(id)
    }, delay)
    this.restartTimers.set(id, timer)
  }

  private summarizeDiagnostic(id: ServiceId): string {
    const output = (this.diagnostics.get(id) ?? [])
      .slice(-4)
      .join(' | ')
      .replace(/\s+/g, ' ')
      .trim()
    this.diagnostics.delete(id)
    return output.length > 700 ? `${output.slice(0, 697)}...` : output
  }

  private cancelRestart(id: ServiceId): void {
    const timer = this.restartTimers.get(id)
    if (timer) clearTimeout(timer)
    this.restartTimers.delete(id)
  }

  private async readMariaDbVersion(executable: string): Promise<string | null> {
    try {
      const { stdout, stderr } = await execFileAsync(executable, ['--version'], { windowsHide: true, timeout: 4000 })
      return `${stdout}\n${stderr}`.match(/(\d+\.\d+\.\d+)/)?.[1] ?? null
    } catch {
      return null
    }
  }
}
