import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import type { RuntimeSettings } from '../shared/types'

const execFileAsync = promisify(execFile)

export function sqlString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

export function phpSingleQuoted(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

export function assertMariaDbPassword(value: string): string {
  if (value.includes('\0')) throw new Error('Password cannot contain null characters.')
  if (value.length > 128) throw new Error('Password is too long.')
  return value
}

export function mariaDbPasswordError(raw: string, running: boolean): string {
  if (!running) return 'Start MySQL first, then change the password.'
  const text = raw.replace(/\s+/g, ' ')
  if (/Command failed:|mariadb\.exe/i.test(text) && !/access denied|can't connect|refused|timed out/i.test(text)) {
    return 'Could not change the MySQL password.'
  }
  if (/can'?t connect|refused|timed out|gone away|unknown mysql server|not allowed to connect/i.test(text)) {
    return 'Start MySQL first, then change the password.'
  }
  if (/access denied/i.test(text)) {
    return 'Could not force-reset the MySQL root password. Start MySQL and try again.'
  }
  return 'Could not change the MySQL password.'
}

export function isIgnorableMariaDbUserError(raw: string): boolean {
  return /1396|1133|operation ALTER USER failed|operation CREATE USER failed|unknown user|unknown table|unknown column|doesn't exist|invalid json|json_set/i.test(raw)
}

const ROOT_HOSTS = ['127.0.0.1', 'localhost', '%', '::1'] as const

export function passwordCandidates(...values: Array<string | undefined>): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    if (value === undefined || seen.has(value)) continue
    seen.add(value)
    result.push(value)
  }
  return result
}

export function clientArgs(settings: RuntimeSettings, extra: string[], host = '127.0.0.1', password = settings.mariadbPassword): string[] {
  return [
    '-u', 'root',
    '-h', host,
    '-P', String(settings.mariadbPort),
    '--protocol=tcp',
    '--connect-timeout=5',
    '--ssl=0',
    `--password=${password}`,
    ...extra
  ]
}

export function rootPasswordStatements(password: string): string[] {
  const escaped = sqlString(password)
  const hashSql = password ? `PASSWORD('${escaped}')` : `''`
  return [
    'FLUSH PRIVILEGES',
    ...ROOT_HOSTS.map((host) => `CREATE USER IF NOT EXISTS 'root'@'${host}' IDENTIFIED BY '${escaped}'`),
    ...ROOT_HOSTS.map((host) => `ALTER USER 'root'@'${host}' IDENTIFIED BY '${escaped}'`),
    ...ROOT_HOSTS.map((host) => `GRANT ALL PRIVILEGES ON *.* TO 'root'@'${host}' WITH GRANT OPTION`),
    `UPDATE mysql.global_priv SET priv=json_set(priv, '$.plugin', 'mysql_native_password', '$.authentication_string', ${hashSql}) WHERE User='root'`,
    'FLUSH PRIVILEGES'
  ]
}

export function rootPasswordSql(password: string): string {
  return `${rootPasswordStatements(password).join('; ')};`
}

export async function pingMariaDb(
  settings: RuntimeSettings,
  password: string,
  clientPath = join(settings.runtimeRoot, 'mariadb', 'bin', 'mariadb.exe')
): Promise<boolean> {
  for (const host of ['127.0.0.1', 'localhost']) {
    try {
      await execFileAsync(clientPath, clientArgs(settings, ['-e', 'SELECT 1;'], host, password), { windowsHide: true, timeout: 5000 })
      return true
    } catch { /* try the next host */ }
  }
  return false
}

export async function waitUntilPasswordWorks(
  settings: RuntimeSettings,
  password: string,
  clientPath = join(settings.runtimeRoot, 'mariadb', 'bin', 'mariadb.exe'),
  attempts = 30
): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await pingMariaDb(settings, password, clientPath)) return true
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
  return false
}

export async function syncStoredMariaDbPassword(
  settings: RuntimeSettings,
  save: (password: string) => Promise<RuntimeSettings>
): Promise<RuntimeSettings> {
  if (await pingMariaDb(settings, settings.mariadbPassword)) return settings
  if (await pingMariaDb(settings, '')) return settings.mariadbPassword ? save('') : settings
  return settings
}

export async function changeMariaDbPassword(
  settings: RuntimeSettings,
  nextPassword: string,
  currentPassword?: string,
  clientPath = join(settings.runtimeRoot, 'mariadb', 'bin', 'mariadb.exe'),
  running = true
): Promise<void> {
  if (!running) throw new Error(mariaDbPasswordError('', false))
  const password = assertMariaDbPassword(nextPassword)
  try { await access(clientPath) } catch { throw new Error('MariaDB client is not installed.') }
  const sql = rootPasswordSql(password)
  let lastError = ''
  for (const host of ['127.0.0.1', 'localhost']) {
    for (const current of passwordCandidates(currentPassword, settings.mariadbPassword, password, '')) {
      try {
        await execFileAsync(clientPath, clientArgs(settings, ['-e', 'SELECT 1;'], host, current), { windowsHide: true, timeout: 12000 })
        if (current === password) return
        await execFileAsync(clientPath, clientArgs(settings, ['-f', '-e', sql], host, current), { windowsHide: true, timeout: 12000 })
        return
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
        if (!/access denied/i.test(lastError)) await new Promise((resolve) => setTimeout(resolve, 250))
      }
    }
  }
  throw new Error(mariaDbPasswordError(lastError, true))
}

export async function recoverMariaDbPassword(
  settings: RuntimeSettings,
  nextPassword: string,
  clientPath = join(settings.runtimeRoot, 'mariadb', 'bin', 'mariadb.exe'),
  daemonPath = join(settings.runtimeRoot, 'mariadb', 'bin', 'mariadbd.exe'),
  confPath = join(settings.runtimeRoot, 'mariadb', 'my.ini')
): Promise<void> {
  const password = assertMariaDbPassword(nextPassword)
  try { await access(clientPath); await access(daemonPath) } catch { throw new Error('MariaDB is not installed.') }
  await waitUntilMariaDbGone()
  const child = spawn(daemonPath, [
    `--defaults-file=${confPath}`,
    '--skip-grant-tables',
    '--bind-address=127.0.0.1',
    `--port=${settings.mariadbPort}`,
    '--console'
  ], { windowsHide: true, stdio: 'ignore' })
  try {
    await waitForRecoveryDaemon(clientPath, settings)
    // FLUSH PRIVILEGES turns grant checking back on. Keep it and every account
    // update in the same authenticated recovery session; a second client
    // connection would immediately be rejected by the old password.
    await execFileAsync(clientPath, clientArgs(settings, ['-e', rootPasswordSql(password)], '127.0.0.1', ''), {
      windowsHide: true,
      timeout: 30000
    })
  } catch (error) {
    throw new Error(mariaDbPasswordError(error instanceof Error ? error.message : String(error), true))
  } finally {
    await stopChild(child)
    await waitUntilMariaDbGone()
  }
}

async function waitForRecoveryDaemon(clientPath: string, settings: RuntimeSettings): Promise<void> {
  let lastError = 'MySQL recovery did not start.'
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await execFileAsync(clientPath, clientArgs(settings, ['-e', 'SELECT 1;'], '127.0.0.1', ''), { windowsHide: true, timeout: 4000 })
      return
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      await new Promise((resolve) => setTimeout(resolve, 400))
    }
  }
  throw new Error(mariaDbPasswordError(lastError, true))
}

async function killMariaDb(): Promise<void> {
  for (const name of ['mariadbd.exe', 'mysqld.exe']) {
    try { await execFileAsync('taskkill.exe', ['/IM', name, '/F'], { windowsHide: true }) } catch { /* already gone */ }
  }
}

async function waitUntilMariaDbGone(): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await killMariaDb()
    try {
      const { stdout } = await execFileAsync('tasklist.exe', ['/FI', 'IMAGENAME eq mariadbd.exe', '/NH'], { windowsHide: true, timeout: 4000 })
      if (!/mariadbd\.exe/i.test(stdout)) return
    } catch {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

async function stopChild(child: ChildProcess): Promise<void> {
  await new Promise<void>((resolve) => {
    let settled = false
    const done = () => { if (!settled) { settled = true; resolve() } }
    child.once('exit', done)
    if (process.platform === 'win32' && child.pid) {
      spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }).once('exit', () => setTimeout(done, 200))
    } else child.kill('SIGKILL')
    setTimeout(done, 4000)
  })
}
