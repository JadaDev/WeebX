import { access, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { randomBytes } from 'node:crypto'
import type { PreinstalledAppInstallRequest, RuntimeSettings, VirtualHost } from '../shared/types'
import type { InternalPreinstalledApp } from './preinstalled-app-catalog'
import type { SiteProfilePaths } from './site-profile'
import { generateStrongPassword } from './security'

export interface AppInstallContext {
  app: InternalPreinstalledApp
  request: PreinstalledAppInstallRequest
  site: VirtualHost
  documentRoot: string
  siteDocumentRoot: string
  databasePassword?: string
  settings: RuntimeSettings
  phpExe: string
  phpIni: string
  profile: SiteProfilePaths
  siteUrl: string
}

export function phpQuote(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/[\r\n]/g, '')
}

export function yamlQuote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "''").replace(/[\r\n]/g, '')}'`
}

export function siteUrl(request: PreinstalledAppInstallRequest, settings: RuntimeSettings): string {
  const protocol = request.https ? 'https' : 'http'
  const port = request.https ? settings.apacheSslPort : settings.apachePort
  const standard = request.https ? 443 : 80
  return `${protocol}://${request.domain}${port === standard ? '' : `:${port}`}`
}

export function databaseEndpoint(settings: RuntimeSettings): { host: string; port: number } {
  return { host: '127.0.0.1', port: settings.mariadbPort }
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true } catch { return false }
}

export async function runPhpCli(
  phpExe: string,
  phpIni: string,
  args: string[],
  options: { cwd: string; timeout: number; env?: NodeJS.ProcessEnv }
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(phpExe, ['-c', phpIni, ...args], {
      cwd: options.cwd,
      windowsHide: true,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let output = ''
    const timer = setTimeout(() => { child.kill(); reject(new Error('The application installer timed out.')) }, options.timeout)
    child.stdout.on('data', (value) => { output += value })
    child.stderr.on('data', (value) => { output += value })
    child.once('error', (cause) => { clearTimeout(timer); reject(cause) })
    child.once('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(output)
      else reject(new Error(output.trim() || `Installer exited with code ${code}.`))
    })
  })
}

async function writeTempScript(folder: string, name: string, source: string): Promise<string> {
  const path = join(folder, name)
  await mkdir(folder, { recursive: true })
  await writeFile(path, source, { encoding: 'utf8', mode: 0o600 })
  return path
}

async function requireFile(path: string, label: string): Promise<void> {
  if (!(await exists(path))) throw new Error(`The ${label} is missing, so WeebX cannot finish setup automatically.`)
}

const execFileAsync = promisify(execFile)

export const AUTOMATIC_INSTALLER_IDS = [
  'wordpress', 'joomla', 'drupal', 'grav', 'mediawiki', 'nextcloud', 'moodle', 'opencart', 'prestashop', 'freshrss', 'phpbb', 'gitlist', 'privatebin'
] as const

export async function configureCatalogApp(ctx: AppInstallContext): Promise<'installed' | 'needs-setup'> {
  if (ctx.app.setup !== 'automatic') return 'needs-setup'
  switch (ctx.app.id) {
    case 'wordpress': await configureWordPress(ctx); break
    case 'joomla': await configureJoomla(ctx); break
    case 'drupal': await configureDrupal(ctx); break
    case 'grav': await configureGrav(ctx); break
    case 'mediawiki': await configureMediaWiki(ctx); break
    case 'nextcloud': await configureNextcloud(ctx); break
    case 'moodle': await configureMoodle(ctx); break
    case 'opencart': await configureOpenCart(ctx); break
    case 'prestashop': await configurePrestaShop(ctx); break
    case 'freshrss': await configureFreshRss(ctx); break
    case 'phpbb': await configurePhpBb(ctx); break
    case 'gitlist': await configureGitList(ctx); break
    case 'privatebin': await configurePrivateBin(ctx); break
    default: throw new Error(`WeebX has no automatic installer for ${ctx.app.name}.`)
  }
  return 'installed'
}

export function phpbbInstallYaml(ctx: AppInstallContext): string {
  const { request, settings, databasePassword, siteUrl: url } = ctx
  const { host, port } = databaseEndpoint(settings)
  const parsed = new URL(url.endsWith('/') ? url : `${url}/`)
  return [
    'installer:',
    '    admin:',
    `        name: ${yamlQuote(String(request.adminUsername))}`,
    `        password: ${yamlQuote(String(request.adminPassword))}`,
    `        email: ${yamlQuote(String(request.adminEmail))}`,
    '    board:',
    '        lang: en',
    `        name: ${yamlQuote(String(request.siteTitle))}`,
    '        description: Local phpBB board installed by WeebX',
    '    database:',
    '        dbms: mysqli',
    `        dbhost: ${yamlQuote(host)}`,
    `        dbport: ${port}`,
    `        dbuser: ${yamlQuote(String(request.databaseUsername))}`,
    `        dbpasswd: ${yamlQuote(String(databasePassword))}`,
    `        dbname: ${yamlQuote(String(request.databaseName))}`,
    '        table_prefix: phpbb_',
    '    email:',
    '        enabled: false',
    '        smtp_delivery: ~',
    '        smtp_host: ~',
    '        smtp_port: ~',
    '        smtp_auth: ~',
    '        smtp_user: ~',
    '        smtp_pass: ~',
    '    server:',
    `        cookie_secure: ${request.https ? 'true' : 'false'}`,
    `        server_protocol: ${yamlQuote(`${parsed.protocol}//`)}`,
    '        force_server_vars: true',
    `        server_name: ${yamlQuote(request.domain)}`,
    `        server_port: ${parsed.port || (request.https ? 443 : 80)}`,
    '        script_path: /',
    '    extensions: []',
    ''
  ].join('\n')
}

async function configureWordPress(ctx: AppInstallContext): Promise<void> {
  const { request, settings, siteDocumentRoot, databasePassword, phpExe, phpIni, profile, siteUrl: url, app } = ctx
  const { host, port } = databaseEndpoint(settings)
  const httpPort = request.https ? settings.apacheSslPort : settings.apachePort
  const salts = Array.from({ length: 8 }, () => generateStrongPassword(64))
  const definitions = ['AUTH_KEY', 'SECURE_AUTH_KEY', 'LOGGED_IN_KEY', 'NONCE_KEY', 'AUTH_SALT', 'SECURE_AUTH_SALT', 'LOGGED_IN_SALT', 'NONCE_SALT']
    .map((key, index) => `define('${key}', '${phpQuote(salts[index])}');`).join('\n')
  const config = `<?php
define('DB_NAME', '${phpQuote(request.databaseName!)}');
define('DB_USER', '${phpQuote(request.databaseUsername!)}');
define('DB_PASSWORD', '${phpQuote(databasePassword!)}');
define('DB_HOST', '${host}:${port}');
define('DB_CHARSET', 'utf8mb4');
define('DB_COLLATE', '');
define('WP_HOME', '${phpQuote(url)}');
define('WP_SITEURL', '${phpQuote(url)}');
${definitions}
$table_prefix='wp_';
define('WP_DEBUG', false);
define('DISALLOW_FILE_EDIT', true);
define('WP_AUTO_UPDATE_CORE', true);
${request.https ? "define('FORCE_SSL_ADMIN', true);\n" : ''}if(!defined('ABSPATH')) define('ABSPATH', __DIR__.'/');
require_once ABSPATH.'wp-settings.php';
`
  await writeFile(join(siteDocumentRoot, 'wp-config.php'), config, { encoding: 'utf8', mode: 0o600 })
  const runner = await writeTempScript(profile.temp, `.weebx-install-${ctx.site.id}.php`, `<?php
$_SERVER['HTTP_HOST']='${phpQuote(request.domain)}';
$_SERVER['REQUEST_URI']='/';
$_SERVER['SERVER_PORT']='${httpPort}';
$_SERVER['HTTPS']='${request.https ? 'on' : 'off'}';
define('WP_INSTALLING', true);
chdir('${phpQuote(siteDocumentRoot.replace(/\\/g, '/'))}');
require 'wp-load.php';
require_once ABSPATH.'wp-admin/includes/upgrade.php';
$r = wp_install('${phpQuote(String(request.siteTitle))}', '${phpQuote(String(request.adminUsername))}', '${phpQuote(String(request.adminEmail))}', true, '', '${phpQuote(String(request.adminPassword))}', 'en_US');
if (is_wp_error($r)) { fwrite(STDERR, $r->get_error_message()); exit(2); }
`)
  try { await runPhpCli(phpExe, phpIni, [runner], { cwd: siteDocumentRoot, timeout: 120000 }) }
  catch (error) { throw new Error(`${app.name} files and database were created, but administrator setup failed: ${error instanceof Error ? error.message : String(error)}`) }
  finally { await rm(runner, { force: true }) }
}

async function configureJoomla(ctx: AppInstallContext): Promise<void> {
  const installer = join(ctx.documentRoot, 'installation', 'joomla.php')
  await requireFile(installer, 'Joomla CLI installer')
  const { host, port } = databaseEndpoint(ctx.settings)
  await runPhpCli(ctx.phpExe, ctx.phpIni, [
    installer, 'install',
    `--site-name=${ctx.request.siteTitle}`,
    `--admin-user=${ctx.request.adminUsername}`,
    `--admin-username=${ctx.request.adminUsername}`,
    `--admin-password=${ctx.request.adminPassword}`,
    `--admin-email=${ctx.request.adminEmail}`,
    '--db-type=mysqli',
    `--db-host=${host}:${port}`,
    `--db-user=${ctx.request.databaseUsername}`,
    `--db-pass=${ctx.databasePassword}`,
    `--db-name=${ctx.request.databaseName}`,
    '--db-prefix=japp_',
    '--db-encryption=0'
  ], { cwd: ctx.documentRoot, timeout: 180000 })
}

async function configureDrupal(ctx: AppInstallContext): Promise<void> {
  const settingsSource = join(ctx.documentRoot, 'sites', 'default', 'default.settings.php')
  const settingsTarget = join(ctx.documentRoot, 'sites', 'default', 'settings.php')
  await requireFile(join(ctx.documentRoot, 'core', 'includes', 'install.core.inc'), 'Drupal installer')
  await requireFile(settingsSource, 'Drupal default settings file')
  if (!(await exists(settingsTarget))) await copyFile(settingsSource, settingsTarget)
  const { host, port } = databaseEndpoint(ctx.settings)
  const httpPort = ctx.request.https ? ctx.settings.apacheSslPort : ctx.settings.apachePort
  await mkdir(join(ctx.documentRoot, 'sites', 'default', 'files'), { recursive: true })
  const runner = await writeTempScript(ctx.profile.temp, `.weebx-drupal-${ctx.site.id}.php`, `<?php
$root = '${phpQuote(ctx.documentRoot.replace(/\\/g, '/'))}';
chdir($root);
$_SERVER['HTTP_HOST'] = '${phpQuote(ctx.request.domain)}';
$_SERVER['REQUEST_URI'] = '/';
$_SERVER['SERVER_PORT'] = '${httpPort}';
$_SERVER['HTTPS'] = '${ctx.request.https ? 'on' : 'off'}';
$_SERVER['REMOTE_ADDR'] = '127.0.0.1';
$autoloader = require $root . '/autoload.php';
require_once $root . '/core/includes/install.core.inc';
$driver = 'Drupal\\\\mysql\\\\Driver\\\\Database\\\\mysql';
$password = '${phpQuote(String(ctx.request.adminPassword))}';
$parameters = [
  'interactive' => FALSE,
  'site_path' => 'sites/default',
  'parameters' => ['profile' => 'standard', 'langcode' => 'en'],
  'forms' => [
    'install_settings_form' => [
      'driver' => $driver,
      $driver => [
        'database' => '${phpQuote(String(ctx.request.databaseName))}',
        'username' => '${phpQuote(String(ctx.request.databaseUsername))}',
        'password' => '${phpQuote(String(ctx.databasePassword))}',
        'host' => '${host}',
        'port' => ${port},
        'prefix' => '',
      ],
    ],
    'install_configure_form' => [
      'site_name' => '${phpQuote(String(ctx.request.siteTitle))}',
      'site_mail' => '${phpQuote(String(ctx.request.adminEmail))}',
      'account' => [
        'name' => '${phpQuote(String(ctx.request.adminUsername))}',
        'mail' => '${phpQuote(String(ctx.request.adminEmail))}',
        'pass' => ['pass1' => $password, 'pass2' => $password],
      ],
      'enable_update_status_module' => TRUE,
      'enable_update_status_emails' => NULL,
    ],
  ],
];
install_drupal($autoloader, $parameters);
`)
  try { await runPhpCli(ctx.phpExe, ctx.phpIni, [runner], { cwd: ctx.documentRoot, timeout: 300000 }) }
  finally { await rm(runner, { force: true }) }
}

async function configureGrav(ctx: AppInstallContext): Promise<void> {
  const plugin = join(ctx.documentRoot, 'bin', 'plugin')
  await requireFile(plugin, 'Grav plugin CLI')
  await runPhpCli(ctx.phpExe, ctx.phpIni, [
    plugin, 'login', 'new-user', '--no-interaction',
    `-u`, String(ctx.request.adminUsername),
    `-p`, String(ctx.request.adminPassword),
    `-e`, String(ctx.request.adminEmail),
    `-P`, 'b',
    `-N`, String(ctx.request.siteTitle || ctx.request.adminUsername)
  ], { cwd: ctx.documentRoot, timeout: 90000 })
}

async function configureMediaWiki(ctx: AppInstallContext): Promise<void> {
  const runner = join(ctx.documentRoot, 'maintenance', 'run.php')
  const legacy = join(ctx.documentRoot, 'maintenance', 'install.php')
  const { host } = databaseEndpoint(ctx.settings)
  const args = await exists(runner)
    ? [runner, 'install']
    : (await exists(legacy) ? [legacy] : null)
  if (!args) throw new Error('The MediaWiki CLI installer is missing.')
  const passFile = await writeTempScript(ctx.profile.temp, `.weebx-mw-pass-${ctx.site.id}.txt`, String(ctx.request.adminPassword))
  const dbPassFile = await writeTempScript(ctx.profile.temp, `.weebx-mw-db-${ctx.site.id}.txt`, String(ctx.databasePassword))
  try {
    await runPhpCli(ctx.phpExe, ctx.phpIni, [
      ...args,
      `--server=${ctx.siteUrl}`,
      '--scriptpath=',
      `--dbserver=${host}`,
      `--dbname=${ctx.request.databaseName}`,
      `--dbuser=${ctx.request.databaseUsername}`,
      `--dbpassfile=${dbPassFile}`,
      `--passfile=${passFile}`,
      '--dbtype=mysql',
      '--lang=en',
      String(ctx.request.siteTitle),
      String(ctx.request.adminUsername)
    ], { cwd: ctx.documentRoot, timeout: 180000 })
  } finally {
    await rm(passFile, { force: true })
    await rm(dbPassFile, { force: true })
  }
}

async function configureNextcloud(ctx: AppInstallContext): Promise<void> {
  const occ = join(ctx.documentRoot, 'occ')
  await requireFile(occ, 'Nextcloud occ installer')
  const dataDir = join(ctx.profile.root, 'nextcloud-data')
  await mkdir(dataDir, { recursive: true })
  const { host, port } = databaseEndpoint(ctx.settings)
  await runPhpCli(ctx.phpExe, ctx.phpIni, [
    occ, 'maintenance:install', '--no-interaction',
    '--database=mysql',
    `--database-name=${ctx.request.databaseName}`,
    `--database-host=${host}`,
    `--database-port=${port}`,
    `--database-user=${ctx.request.databaseUsername}`,
    `--database-pass=${ctx.databasePassword}`,
    `--admin-user=${ctx.request.adminUsername}`,
    `--admin-pass=${ctx.request.adminPassword}`,
    `--admin-email=${ctx.request.adminEmail}`,
    `--data-dir=${dataDir}`
  ], { cwd: ctx.documentRoot, timeout: 180000 })
}

async function configureMoodle(ctx: AppInstallContext): Promise<void> {
  const installer = join(ctx.documentRoot, 'admin', 'cli', 'install.php')
  await requireFile(installer, 'Moodle CLI installer')
  const dataRoot = join(ctx.profile.root, 'moodledata')
  await mkdir(dataRoot, { recursive: true })
  const { host, port } = databaseEndpoint(ctx.settings)
  const shortName = String(ctx.request.siteTitle || 'Moodle').slice(0, 32)
  await runPhpCli(ctx.phpExe, ctx.phpIni, [
    installer,
    '--non-interactive',
    '--agree-license',
    `--wwwroot=${ctx.siteUrl}`,
    `--dataroot=${dataRoot}`,
    '--dbtype=mariadb',
    `--dbhost=${host}`,
    `--dbport=${port}`,
    `--dbname=${ctx.request.databaseName}`,
    `--dbuser=${ctx.request.databaseUsername}`,
    `--dbpass=${ctx.databasePassword}`,
    `--fullname=${ctx.request.siteTitle}`,
    `--shortname=${shortName}`,
    `--adminuser=${ctx.request.adminUsername}`,
    `--adminpass=${ctx.request.adminPassword}`,
    `--adminemail=${ctx.request.adminEmail}`,
    '--lang=en'
  ], { cwd: ctx.documentRoot, timeout: 600000 })
}

async function configureOpenCart(ctx: AppInstallContext): Promise<void> {
  const installer = join(ctx.documentRoot, 'install', 'cli_install.php')
  await requireFile(installer, 'OpenCart CLI installer')
  for (const relativePath of ['config-dist.php', 'admin/config-dist.php']) {
    const source = join(ctx.documentRoot, relativePath)
    const target = join(ctx.documentRoot, relativePath.replace('-dist', ''))
    if (await exists(source) && !(await exists(target))) await copyFile(source, target)
  }
  const { host, port } = databaseEndpoint(ctx.settings)
  const httpServer = ctx.siteUrl.endsWith('/') ? ctx.siteUrl : `${ctx.siteUrl}/`
  await runPhpCli(ctx.phpExe, ctx.phpIni, [
    installer, 'install',
    `--username=${ctx.request.adminUsername}`,
    `--email=${ctx.request.adminEmail}`,
    `--password=${ctx.request.adminPassword}`,
    `--http_server=${httpServer}`,
    '--db_driver=mysqli',
    `--db_hostname=${host}`,
    `--db_username=${ctx.request.databaseUsername}`,
    `--db_password=${ctx.databasePassword}`,
    `--db_database=${ctx.request.databaseName}`,
    `--db_port=${port}`,
    '--db_prefix=oc_'
  ], { cwd: ctx.documentRoot, timeout: 180000 })
}

async function configurePrestaShop(ctx: AppInstallContext): Promise<void> {
  const installer = join(ctx.documentRoot, 'install', 'index_cli.php')
  await requireFile(installer, 'PrestaShop CLI installer')
  const { host, port } = databaseEndpoint(ctx.settings)
  await runPhpCli(ctx.phpExe, ctx.phpIni, [
    installer,
    `--domain=${ctx.request.domain}`,
    `--db_server=${host}:${port}`,
    `--db_name=${ctx.request.databaseName}`,
    `--db_user=${ctx.request.databaseUsername}`,
    `--db_password=${ctx.databasePassword}`,
    '--db_clear=1',
    '--prefix=ps_',
    `--name=${ctx.request.siteTitle}`,
    `--email=${ctx.request.adminEmail}`,
    `--password=${ctx.request.adminPassword}`,
    '--firstname=Store',
    `--lastname=${ctx.request.adminUsername}`,
    '--country=us',
    '--language=en',
    '--fixtures=0',
    `--ssl=${ctx.request.https ? '1' : '0'}`,
    '--license=0'
  ], { cwd: join(ctx.documentRoot, 'install'), timeout: 600000 })
}

async function configureFreshRss(ctx: AppInstallContext): Promise<void> {
  const prepare = join(ctx.documentRoot, 'cli', 'prepare.php')
  const installer = join(ctx.documentRoot, 'cli', 'do-install.php')
  const createUser = join(ctx.documentRoot, 'cli', 'create-user.php')
  await requireFile(installer, 'FreshRSS CLI installer')
  const { host, port } = databaseEndpoint(ctx.settings)
  if (await exists(prepare)) await runPhpCli(ctx.phpExe, ctx.phpIni, [prepare], { cwd: ctx.documentRoot, timeout: 60000 })
  await runPhpCli(ctx.phpExe, ctx.phpIni, [
    installer,
    `--default-user=${ctx.request.adminUsername}`,
    '--auth-type=form',
    '--environment=production',
    `--base-url=${ctx.siteUrl}`,
    '--language=en',
    `--title=${ctx.request.siteTitle}`,
    '--db-type=mysql',
    `--db-host=${host}:${port}`,
    `--db-user=${ctx.request.databaseUsername}`,
    `--db-password=${ctx.databasePassword}`,
    `--db-base=${ctx.request.databaseName}`,
    '--db-prefix=freshrss_'
  ], { cwd: ctx.documentRoot, timeout: 120000 })
  const userArgs = [`--user=${ctx.request.adminUsername}`, `--password=${ctx.request.adminPassword}`]
  try {
    await requireFile(createUser, 'FreshRSS user CLI')
    await runPhpCli(ctx.phpExe, ctx.phpIni, [createUser, ...userArgs], { cwd: ctx.documentRoot, timeout: 60000 })
  } catch (error) {
    const updater = join(ctx.documentRoot, 'cli', 'update-user.php')
    if (!(await exists(updater))) throw error
    await runPhpCli(ctx.phpExe, ctx.phpIni, [updater, ...userArgs], { cwd: ctx.documentRoot, timeout: 60000 })
  }
}

async function configurePhpBb(ctx: AppInstallContext): Promise<void> {
  const installer = join(ctx.documentRoot, 'install', 'phpbbcli.php')
  await requireFile(installer, 'phpBB CLI installer')
  const config = join(ctx.documentRoot, 'install', 'install-config.yml')
  await writeFile(config, phpbbInstallYaml(ctx), { encoding: 'utf8', mode: 0o600 })
  try {
    await runPhpCli(ctx.phpExe, ctx.phpIni, [installer, 'install', 'install/install-config.yml'], { cwd: ctx.documentRoot, timeout: 180000 })
  } finally {
    await rm(config, { force: true })
  }
}

async function findGitExe(): Promise<string> {
  const candidates = [
    'C:\\Program Files\\Git\\cmd\\git.exe',
    'C:\\Program Files\\Git\\bin\\git.exe',
    'C:\\Program Files (x86)\\Git\\cmd\\git.exe',
    'C:\\Program Files (x86)\\Git\\bin\\git.exe'
  ]
  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate.replace(/\\/g, '/')
  }
  try {
    const { stdout } = await execFileAsync('where.exe', ['git'], { windowsHide: true, timeout: 8000 })
    const found = stdout.split(/\r?\n/).map((line) => line.trim()).find((line) => /\.exe$/i.test(line))
    if (found) return found.replace(/\\/g, '/')
  } catch { /* Git is optional for GitList; an empty repository list still works. */ }
  return 'git'
}

async function seedGitRepository(repos: string, gitPath: string): Promise<void> {
  if (gitPath === 'git') return
  const sample = join(repos, 'welcome')
  if (await exists(join(sample, '.git'))) return
  await mkdir(sample, { recursive: true })
  await writeFile(join(sample, 'README.md'), '# Welcome\n\nThis local Git repository was created by WeebX so GitList has something to browse immediately.\n', 'utf8')
  const git = gitPath.replace(/\//g, '\\')
  const env = { ...process.env, GIT_AUTHOR_NAME: 'WeebX', GIT_AUTHOR_EMAIL: 'weebx@localhost', GIT_COMMITTER_NAME: 'WeebX', GIT_COMMITTER_EMAIL: 'weebx@localhost' }
  try {
    await execFileAsync(git, ['-C', sample, 'init'], { windowsHide: true, timeout: 15000, env })
    await execFileAsync(git, ['-C', sample, 'add', 'README.md'], { windowsHide: true, timeout: 15000, env })
    await execFileAsync(git, ['-C', sample, 'commit', '-m', 'Initial commit'], { windowsHide: true, timeout: 15000, env })
  } catch {
    await rm(sample, { recursive: true, force: true }).catch(() => undefined)
  }
}

async function configurePrivateBin(ctx: AppInstallContext): Promise<void> {
  const sample = join(ctx.documentRoot, 'cfg', 'conf.sample.php')
  const target = join(ctx.documentRoot, 'cfg', 'conf.php')
  await requireFile(sample, 'PrivateBin configuration sample')
  const title = (ctx.request.siteTitle?.trim() || 'PrivateBin').replace(/"/g, '')
  const base = ctx.siteUrl.endsWith('/') ? ctx.siteUrl : `${ctx.siteUrl}/`
  let content = await readFile(sample, 'utf8')
  content = content.replace('; name = "PrivateBin"', `name = "${title}"`)
  content = content.replace('; basepath = "https://privatebin.example.com/"', `basepath = "${base.replace(/"/g, '')}"`)
  await writeFile(target, content, { encoding: 'utf8', mode: 0o600 })
  await mkdir(join(ctx.documentRoot, 'data'), { recursive: true })
}

async function configureGitList(ctx: AppInstallContext): Promise<void> {
  const configPath = join(ctx.documentRoot, 'config', 'config.yml')
  await requireFile(configPath, 'GitList configuration')
  const repos = join(ctx.documentRoot, 'repositories')
  await mkdir(repos, { recursive: true })
  await mkdir(join(ctx.documentRoot, 'var', 'cache'), { recursive: true })
  await mkdir(join(ctx.documentRoot, 'var', 'log'), { recursive: true })
  const gitPath = await findGitExe()
  const title = ctx.request.siteTitle?.trim() || 'GitList'
  const posixRepos = repos.replace(/\\/g, '/')
  let yaml = await readFile(configPath, 'utf8')
  yaml = yaml.replace(/^(\s*)title:\s*.+$/m, `$1title: ${yamlQuote(title)}`)
  yaml = yaml.replace(/^(\s*)default_repository_dir:\s*.+$/m, `$1default_repository_dir: ${yamlQuote(posixRepos)}`)
  yaml = yaml.replace(/^(\s*)git_path:\s*.+$/m, `$1git_path: ${yamlQuote(gitPath)}`)
  yaml = yaml.replace(/^(\s*)ssh_clone_url:\s*.+$/m, `$1ssh_clone_url: ${yamlQuote(`git@${ctx.request.domain}:%s.git`)}`)
  yaml = yaml.replace(/^(\s*)https_clone_url:\s*.+$/m, `$1https_clone_url: ${yamlQuote(`${ctx.siteUrl.replace(/\/$/, '')}/%s.git`)}`)
  await writeFile(configPath, yaml, 'utf8')
  await writeFile(join(ctx.documentRoot, '.env'), [
    'APP_ENV=prod',
    `APP_SECRET=${randomBytes(32).toString('hex')}`,
    `DEFAULT_REPOSITORY_DIR=${posixRepos}`
  ].join('\n') + '\n', { encoding: 'utf8', mode: 0o600 })
  const htaccess = join(ctx.siteDocumentRoot, '.htaccess')
  if (!(await exists(htaccess))) {
    await writeFile(htaccess, 'DirectoryIndex index.php\nRewriteEngine On\nRewriteCond %{REQUEST_FILENAME} !-f\nRewriteCond %{REQUEST_FILENAME} !-d\nRewriteRule ^ index.php [QSA,L]\n', 'utf8')
  }
  await seedGitRepository(repos, gitPath)
}
