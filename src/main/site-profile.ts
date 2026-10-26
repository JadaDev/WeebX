import { access, mkdir, readFile, readdir } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { RuntimeSettings, SiteDatabaseCredential, SiteIsolationDraft, SiteIsolationProfile, SiteProfileOptions, VirtualHost } from '../shared/types'
import { backupAndWrite } from './safe-file'
import { applyPathPermissionPreset } from './permissions'
import { runMariaDbClient, sqlString } from './mariadb-password'
import { assertStrongPassword, generateStrongPassword } from './security'

const SIZE = /^\d+[KMG]?$/i
const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/i
const EXTENSION = /^[a-z0-9_]+$/i
const DEFAULT_EXTENSIONS = ['curl', 'fileinfo', 'gd', 'intl', 'mbstring', 'mysqli', 'openssl', 'pdo_mysql', 'sodium', 'zip']
const DISABLED_FUNCTIONS = ['exec', 'passthru', 'shell_exec', 'system', 'proc_open', 'popen']
const PROTECTED_INI = new Set([
  'extension', 'zend_extension', 'extension_dir', 'open_basedir', 'disable_functions', 'user_ini.filename',
  'session.save_path', 'sys_temp_dir', 'upload_tmp_dir', 'error_log', 'log_errors', 'display_errors',
  'display_startup_errors', 'upload_max_filesize', 'post_max_size', 'max_file_uploads', 'memory_limit',
  'max_execution_time', 'max_input_time', 'max_input_vars', 'expose_php', 'allow_url_include'
])

const slash = (value: string): string => value.replace(/\\/g, '/')

export interface SiteProfilePaths {
  root: string
  php: string
  phpIni: string
  sessions: string
  temp: string
  uploads: string
  logs: string
}

export function siteProfilePaths(settings: RuntimeSettings, site: Pick<VirtualHost, 'name'>): SiteProfilePaths {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/i.test(site.name)) throw new Error('The site profile name is invalid.')
  const root = join(settings.runtimeRoot, 'site-profiles', site.name)
  return {
    root,
    php: join(root, 'php'),
    phpIni: join(root, 'php', 'php.ini'),
    sessions: join(root, 'sessions'),
    temp: join(root, 'tmp'),
    uploads: join(root, 'uploads'),
    logs: join(root, 'logs')
  }
}

function assertDatabaseIdentity(profile: SiteIsolationProfile): NonNullable<SiteIsolationProfile['database']> {
  if (!profile.database) throw new Error('This site does not have a database profile.')
  const db = profile.database
  if (!IDENTIFIER.test(db.databaseName)) throw new Error('The isolated database name is invalid.')
  if (!IDENTIFIER.test(db.username) || db.username.length > 32) throw new Error('The isolated database username is invalid.')
  if (!['read-write', 'read-only'].includes(db.access)) throw new Error('The isolated database access policy is invalid.')
  return db
}

function wholeNumber(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) throw new Error(`${label} must be between ${minimum} and ${maximum}.`)
  return Number(value)
}

function sizeValue(value: unknown, label: string): string {
  const result = String(value ?? '').trim().toUpperCase()
  if (!SIZE.test(result)) throw new Error(`${label} must look like 64M or 512K.`)
  return result
}

function sizeBytes(value: string): number {
  const amount = Number.parseInt(value, 10)
  const unit = value.at(-1)?.toUpperCase()
  return amount * (unit === 'G' ? 1024 ** 3 : unit === 'M' ? 1024 ** 2 : unit === 'K' ? 1024 : 1)
}

export function validateCustomIni(value: unknown): string {
  const content = String(value ?? '').replace(/\r?\n/g, '\n').trim()
  if (content.length > 32_000) throw new Error('Additional php.ini directives are too large.')
  for (const raw of content.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith(';')) continue
    const match = line.match(/^([a-z0-9_.-]+)\s*=/i)
    if (!match) throw new Error(`Invalid additional php.ini line: ${line.slice(0, 80)}`)
    if (PROTECTED_INI.has(match[1].toLowerCase())) throw new Error(`${match[1]} is managed by the isolated-site security profile.`)
  }
  return content
}

export async function siteProfileOptions(settings: RuntimeSettings, version: string): Promise<SiteProfileOptions> {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Choose an installed PHP version.')
  const phpRoot = join(settings.runtimeRoot, 'php', version)
  await access(join(phpRoot, 'php-cgi.exe')).catch(() => { throw new Error(`PHP ${version} is not installed.`) })
  const extensions = (await readdir(join(phpRoot, 'ext')).catch(() => []))
    .map((file) => file.match(/^php_([a-z0-9_]+)\.dll$/i)?.[1]?.toLowerCase())
    .filter((value): value is string => Boolean(value) && value !== 'dl_test' && value !== 'zend_test')
    .sort()
  return { phpVersion: version, extensions, recommendedExtensions: DEFAULT_EXTENSIONS.filter((item) => extensions.includes(item)) }
}

export async function normalizeSiteIsolation(settings: RuntimeSettings, draft: SiteIsolationDraft): Promise<{ profile: SiteIsolationProfile; databasePassword?: string }> {
  if (!draft || typeof draft !== 'object') throw new Error('Invalid isolated-site profile.')
  const options = await siteProfileOptions(settings, String(draft.phpVersion ?? ''))
  const requestedExtensions = Array.isArray(draft.phpExtensions) ? [...new Set(draft.phpExtensions.map((item) => String(item).toLowerCase()))] : []
  if (requestedExtensions.some((item) => !EXTENSION.test(item) || !options.extensions.includes(item))) throw new Error('The isolated profile contains an unavailable PHP extension.')
  if (!['development', 'production'].includes(String(draft.phpProfile))) throw new Error('Choose Development or Live / Production for the site.')
  if (!['private', 'writable', 'windows-default'].includes(String(draft.permissionPreset))) throw new Error('Choose a valid site permission preset.')
  const uploadMaxFilesize = sizeValue(draft.uploadMaxFilesize, 'Upload size')
  const postMaxSize = sizeValue(draft.postMaxSize, 'POST size')
  if (sizeBytes(postMaxSize) < sizeBytes(uploadMaxFilesize)) throw new Error('POST size must be at least as large as the maximum upload size.')
  const profile: SiteIsolationProfile = {
    phpVersion: options.phpVersion,
    phpProfile: draft.phpProfile,
    phpExtensions: requestedExtensions,
    memoryLimit: sizeValue(draft.memoryLimit, 'Memory limit'),
    maxExecutionTime: wholeNumber(draft.maxExecutionTime, 'Maximum execution time', 1, 3600),
    maxInputTime: wholeNumber(draft.maxInputTime, 'Maximum input time', 1, 3600),
    maxInputVars: wholeNumber(draft.maxInputVars, 'Maximum input variables', 100, 100000),
    uploadMaxFilesize,
    postMaxSize,
    maxFileUploads: wholeNumber(draft.maxFileUploads, 'Maximum uploaded files', 1, 200),
    openBasedir: draft.openBasedir === true,
    disableDangerousFunctions: draft.disableDangerousFunctions === true,
    allowUserIni: draft.allowUserIni === true,
    permissionPreset: draft.permissionPreset,
    customIni: validateCustomIni(draft.customIni)
  }
  let databasePassword: string | undefined
  if (draft.database) {
    const databaseName = String(draft.database.databaseName ?? '').trim()
    const username = String(draft.database.username ?? '').trim()
    if (!IDENTIFIER.test(databaseName)) throw new Error('Database name must start with a letter and contain only letters, numbers, and underscores.')
    if (!IDENTIFIER.test(username) || username.length > 32) throw new Error('Database username must start with a letter and use at most 32 letters, numbers, or underscores.')
    if (!['read-write', 'read-only'].includes(String(draft.database.access))) throw new Error('Choose read-write or read-only database access.')
    databasePassword = draft.database.password ? assertStrongPassword(String(draft.database.password)) : generateStrongPassword()
    profile.database = { databaseName, username, access: draft.database.access, passwordSet: true }
  }
  return { profile, databasePassword }
}

export async function writeSitePhpIni(settings: RuntimeSettings, site: VirtualHost, applyPermissions = true): Promise<SiteProfilePaths> {
  if (!site.isolation) throw new Error('This site does not have an isolated profile.')
  const documentRoot = resolve(site.documentRoot)
  const documentRelative = relative(resolve(settings.htdocsRoot), documentRoot)
  if (documentRelative.startsWith('..') || isAbsolute(documentRelative)) throw new Error('The isolated site document root must stay inside htdocs.')
  const profile = site.isolation
  const paths = siteProfilePaths(settings, site)
  await Promise.all(Object.values(paths).filter((path) => path !== paths.phpIni).map((path) => mkdir(path, { recursive: true })))
  const versionRoot = join(settings.runtimeRoot, 'php', profile.phpVersion)
  const source = join(versionRoot, `php.ini-${profile.phpProfile}`)
  let base = await readFile(source, 'utf8').catch(() => '[PHP]\n')
  base = base
    .replace(/; BEGIN WEEBX SITE PROFILE[\s\S]*?; END WEEBX SITE PROFILE\s*/g, '')
    .replace(/^(\s*)(zend_extension|extension)\s*=/gmi, '$1;$2=')
  const extensionLines = profile.phpExtensions.map((name) => name === 'opcache' ? 'zend_extension=opcache' : `extension=${name}`).join('\n')
  const allowedRoots = [site.documentRoot, paths.root].map(slash).join(';')
  const production = profile.phpProfile === 'production'
  const managed = `; BEGIN WEEBX SITE PROFILE
extension_dir="${slash(join(versionRoot, 'ext'))}"
${extensionLines}
date.timezone=UTC
memory_limit=${profile.memoryLimit}
max_execution_time=${profile.maxExecutionTime}
max_input_time=${profile.maxInputTime}
max_input_vars=${profile.maxInputVars}
upload_max_filesize=${profile.uploadMaxFilesize}
post_max_size=${profile.postMaxSize}
max_file_uploads=${profile.maxFileUploads}
upload_tmp_dir="${slash(paths.uploads)}"
sys_temp_dir="${slash(paths.temp)}"
session.save_handler=files
session.save_path="${slash(paths.sessions)}"
session.use_strict_mode=1
session.use_cookies=1
session.use_only_cookies=1
session.cookie_httponly=1
session.cookie_samesite=Lax
session.cookie_secure=${production && site.https ? '1' : '0'}
display_errors=${production ? 'Off' : 'On'}
display_startup_errors=${production ? 'Off' : 'On'}
log_errors=On
error_log="${slash(join(paths.logs, 'php-error.log'))}"
error_reporting=E_ALL
expose_php=${production ? 'Off' : 'On'}
allow_url_include=Off
open_basedir=${profile.openBasedir ? `"${allowedRoots}"` : ''}
disable_functions=${profile.disableDangerousFunctions ? DISABLED_FUNCTIONS.join(',') : ''}
user_ini.filename=${profile.allowUserIni ? '.user.ini' : ''}
${profile.customIni}
; END WEEBX SITE PROFILE
`
  await backupAndWrite(paths.phpIni, `${base.trimEnd()}\r\n\r\n${managed.replace(/\n/g, '\r\n')}`)
  if (applyPermissions) {
    await applyPathPermissionPreset(paths.root, profile.permissionPreset)
    await applyPathPermissionPreset(site.documentRoot, profile.permissionPreset)
  }
  return paths
}

export function siteDatabaseSql(profile: SiteIsolationProfile, password: string): string {
  const db = assertDatabaseIdentity(profile)
  const secret = sqlString(assertStrongPassword(password))
  const grants = db.access === 'read-only' ? 'SELECT, SHOW VIEW' : 'ALL PRIVILEGES'
  const statements = [`CREATE DATABASE IF NOT EXISTS \`${db.databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`]
  for (const host of ['127.0.0.1', 'localhost']) {
    statements.push(
      `CREATE USER IF NOT EXISTS '${db.username}'@'${host}' IDENTIFIED BY '${secret}'`,
      `ALTER USER '${db.username}'@'${host}' IDENTIFIED BY '${secret}'`,
      `REVOKE ALL PRIVILEGES, GRANT OPTION FROM '${db.username}'@'${host}'`,
      `GRANT ${grants} ON \`${db.databaseName}\`.* TO '${db.username}'@'${host}'`
    )
  }
  statements.push('FLUSH PRIVILEGES')
  return `${statements.join('; ')};`
}

export async function provisionSiteDatabase(settings: RuntimeSettings, profile: SiteIsolationProfile, password: string, allowExistingManagedAccount = false): Promise<void> {
  const db = assertDatabaseIdentity(profile)
  if (!allowExistingManagedAccount) {
    const user = sqlString(db.username)
    const existing = await runMariaDbClient(settings, ['--batch', '--skip-column-names', '-e', `SELECT COUNT(*) FROM mysql.global_priv WHERE User='${user}' AND Host IN ('127.0.0.1','localhost');`], '127.0.0.1', settings.mariadbPassword, undefined, 30000)
    const countLine = existing.split(/\r?\n/).find((line) => /^\d+$/.test(line.trim()))
    if (countLine === undefined) throw new Error('MariaDB did not return a valid account-safety check. No database user was changed.')
    if (Number.parseInt(countLine, 10) > 0) throw new Error(`MariaDB user ${db.username} already exists. Choose another username so WeebX does not overwrite an unrelated account.`)
  }
  await runMariaDbClient(settings, ['-e', siteDatabaseSql(profile, password)], '127.0.0.1', settings.mariadbPassword, undefined, 30000)
}

export async function dropSiteDatabaseUser(settings: RuntimeSettings, profile: SiteIsolationProfile): Promise<void> {
  if (!profile.database) return
  const user = sqlString(assertDatabaseIdentity(profile).username)
  await runMariaDbClient(settings, ['-e', `DROP USER IF EXISTS '${user}'@'127.0.0.1'; DROP USER IF EXISTS '${user}'@'localhost'; FLUSH PRIVILEGES;`], '127.0.0.1', settings.mariadbPassword)
}

export function siteDatabaseCredential(settings: RuntimeSettings, site: VirtualHost, password: string): SiteDatabaseCredential {
  if (!site.isolation?.database) throw new Error('This site does not have a managed database user.')
  return { siteId: site.id, host: '127.0.0.1', port: settings.mariadbPort, ...site.isolation.database, password }
}
