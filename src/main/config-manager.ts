import { randomBytes } from 'node:crypto'
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { PhpProfile, RuntimeSettings } from '../shared/types'
import { runtimePaths } from './paths'
import { backupAndWrite, ensureDirectory, ensureWritableFile } from './safe-file'
import { ensureWelcomeSite } from './welcome-site'

export function upsertIni(content: string, key: string, value: string): string {
  const line = `${key}=${value}`
  const pattern = new RegExp(`^\\s*${key}\\s*=.*$`, 'gmi')
  const next = content.replace(pattern, line)
  return next === content ? `${content.trimEnd()}\r\n${line}\r\n` : next
}

export function apacheSecurityBlock(documentRoot: string): string {
  const root = documentRoot.replace(/\\/g, '/')
  return `# BEGIN WEEBX SECURITY DEFAULTS
ServerTokens Prod
ServerSignature Off
TraceEnable Off
Timeout 60
KeepAlive On
KeepAliveTimeout 5
RequestReadTimeout header=20-40,MinRate=500 body=20,MinRate=500
<Directory />
    AllowOverride None
    Require all denied
</Directory>
DocumentRoot "${root}"
<Directory "${root}">
    Options -Indexes +FollowSymLinks
    AllowOverride All
    Require all granted
</Directory>
<FilesMatch "^\\.(?!well-known)">
    Require all denied
</FilesMatch>
<FilesMatch "(?i)(?:^|\\.)(?:env|ini|log|sql|bak|dist|config|secret|key)$|^(?:composer\\.(?:json|lock)|package-lock\\.json|web\\.config)$">
    Require all denied
</FilesMatch>
<LocationMatch "^/(?:phpmyadmin(?:/|$)|phpinfo\\.php$)">
    Require local
</LocationMatch>
# END WEEBX SECURITY DEFAULTS
`
}

type ConfigKind = 'php' | 'apache' | 'vhosts' | 'mariadb'

async function exists(file: string): Promise<boolean> {
  try { await access(file); return true } catch { return false }
}

async function writeIfMissing(file: string, content: string): Promise<void> {
  if (await exists(file)) return
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, content, 'utf8')
}

export class ConfigManager {
  constructor(private readonly getSettings: () => Promise<RuntimeSettings>) {}

  async ensureLayout(): Promise<void> {
    const settings = await this.getSettings()
    const paths = runtimePaths(settings)
    await Promise.all([
      ensureDirectory(paths.htdocs),
      ensureDirectory(paths.certificates),
      ensureDirectory(paths.temp),
      ensureDirectory(paths.mariadbData),
      ensureDirectory(join(paths.root, 'logs')),
      ensureDirectory(join(paths.apache, 'logs')),
      ensureDirectory(join(paths.apache, 'conf', 'extra'))
    ])
    await ensureDirectory(paths.tmp)
    await ensureDirectory(paths.sessions)
    await ensureDirectory(paths.phpMyAdminTemp)
    await this.ensureApacheRuntime()
    await ensureWritableFile(join(paths.root, 'logs', 'php-error.log'))
    await writeIfMissing(paths.vhostsConf, this.vhostExample(settings))
    await writeIfMissing(paths.mariadbConf, this.mariaDbTemplate(settings))
    await this.ensureApacheSecurity()
    await ensureWelcomeSite(paths.htdocs, settings)
    await this.ensurePhpRuntime()
    await this.writePhpMyAdminConfig()
  }

  /** Repair mutable Apache state without touching any website or log data. */
  async ensureApacheRuntime(): Promise<void> {
    const paths = runtimePaths(await this.getSettings())
    await ensureDirectory(join(paths.apache, 'logs'))
    await Promise.all([
      ensureWritableFile(join(paths.apache, 'logs', 'access.log')),
      ensureWritableFile(join(paths.apache, 'logs', 'error.log'))
    ])
  }

  async ensurePhpRuntime(): Promise<void> {
    const settings = await this.getSettings()
    const paths = runtimePaths(settings)
    await ensureDirectory(paths.tmp)
    await ensureDirectory(paths.sessions)
    await ensureDirectory(paths.phpMyAdminTemp)
    if (!(await exists(paths.phpIni))) {
      await this.applyPhpProfile(settings.activePhpVersion, settings.phpProfile)
      return
    }
    const slash = (value: string) => value.replace(/\\/g, '/')
    let ini = await readFile(paths.phpIni, 'utf8')
    ini = upsertIni(ini, 'session.save_handler', 'files')
    ini = upsertIni(ini, 'session.save_path', `"${slash(paths.sessions)}"`)
    ini = upsertIni(ini, 'sys_temp_dir', `"${slash(paths.tmp)}"`)
    ini = upsertIni(ini, 'upload_tmp_dir', `"${slash(paths.tmp)}"`)
    await backupAndWrite(paths.phpIni, ini.replace(/\r?\n/g, '\r\n'))
  }

  async writePhpMyAdminConfig(): Promise<void> {
    const settings = await this.getSettings()
    const paths = runtimePaths(settings)
    if (!(await exists(join(paths.phpMyAdmin, 'index.php')))) return
    const configFile = join(paths.phpMyAdmin, 'config.inc.php')
    let secret = randomBytes(24).toString('hex')
    try {
      const current = await readFile(configFile, 'utf8')
      const match = current.match(/\$cfg\['blowfish_secret'\]\s*=\s*'([^']+)'/)
      if (match?.[1]) secret = match[1]
    } catch { /* first write */ }
    const tempDir = paths.phpMyAdminTemp.replace(/\\/g, '/')
    await writeFile(configFile, `<?php
$cfg['blowfish_secret'] = '${secret}';
$cfg['TempDir'] = '${tempDir}';
$cfg['DefaultLang'] = 'en';
$cfg['AllowArbitraryServer'] = false;
$cfg['LoginCookieValidity'] = 1800;
$cfg['LoginCookieStore'] = 0;
$cfg['LoginCookieDeleteAll'] = true;
$cfg['Servers'][1]['auth_type'] = 'cookie';
$cfg['Servers'][1]['host'] = '127.0.0.1';
$cfg['Servers'][1]['port'] = '${settings.mariadbPort}';
$cfg['Servers'][1]['compress'] = false;
$cfg['Servers'][1]['AllowNoPassword'] = ${settings.mariadbPassword ? 'false' : 'true'};
`, 'utf8')
    // phpMyAdmin is local-only and opened over loopback HTTP by the desktop
    // panel. Keep its session usable without weakening production cookies for
    // hosted applications.
    await writeFile(join(paths.phpMyAdmin, '.user.ini'), `display_errors=Off\nsession.cookie_secure=0\nsession.cookie_httponly=1\nsession.cookie_samesite=Lax\n`, 'utf8')
  }

  async read(kind: ConfigKind): Promise<string> {
    const file = await this.pathFor(kind)
    try { return await readFile(file, 'utf8') } catch { return '' }
  }

  async save(kind: ConfigKind, content: string): Promise<void> {
    const file = await this.pathFor(kind)
    await backupAndWrite(file, content.replace(/\r?\n/g, '\r\n'))
  }

  async writeMariaDbPort(port: number): Promise<void> {
    const settings = await this.getSettings()
    const paths = runtimePaths(settings)
    const current = await exists(paths.mariadbConf) ? await readFile(paths.mariadbConf, 'utf8') : this.mariaDbTemplate({ ...settings, mariadbPort: port })
    await backupAndWrite(paths.mariadbConf, upsertIni(current, 'port', String(port)).replace(/\r?\n/g, '\r\n'))
  }

  async pathFor(kind: ConfigKind): Promise<string> {
    const paths = runtimePaths(await this.getSettings())
    return { php: paths.phpIni, apache: paths.apacheConf, vhosts: paths.vhostsConf, mariadb: paths.mariadbConf }[kind]
  }

  phpTemplate(extensionDir: string): string {
    return `[PHP]
engine=On
short_open_tag=Off
precision=14
output_buffering=4096
max_execution_time=120
max_input_time=60
memory_limit=512M
error_reporting=E_ALL
display_errors=On
log_errors=On
post_max_size=128M
upload_max_filesize=128M
max_file_uploads=20
session.upload_progress.enabled=0
date.timezone=UTC
extension_dir="${extensionDir.replace(/\\/g, '/')}"
extension=curl
extension=fileinfo
extension=gd
extension=intl
extension=mbstring
extension=mysqli
extension=openssl
extension=pdo_mysql
extension=sodium
extension=zip
`
  }

  async applyPhpProfile(version: string, profile: PhpProfile): Promise<void> {
    const settings = await this.getSettings()
    const versionRoot = `${settings.runtimeRoot}\\php\\${version}`
    const source = `${versionRoot}\\php.ini-${profile}`
    const target = `${versionRoot}\\php.ini`
    let base = ''
    try { base = await readFile(source, 'utf8') } catch { base = this.phpTemplate(`${versionRoot}\\ext`) }
    const hasDynamicOpcache = await exists(`${versionRoot}\\ext\\php_opcache.dll`)
    const availableExtensions = new Set((await readdir(`${versionRoot}\\ext`).catch(() => [])).map((name) => name.toLowerCase()))
    const managed = this.phpManagedBlock(settings, `${versionRoot}\\ext`, profile, hasDynamicOpcache, availableExtensions)
    await backupAndWrite(target, `${base.trimEnd()}\r\n\r\n${managed.replace(/\n/g, '\r\n')}`)
  }

  private phpManagedBlock(settings: RuntimeSettings, extensionDir: string, profile: PhpProfile, hasDynamicOpcache: boolean, availableExtensions: Set<string>): string {
    const paths = runtimePaths(settings)
    const slash = (value: string) => value.replace(/\\/g, '/')
    const extensions = ['bz2', 'curl', 'fileinfo', 'ftp', 'gd', 'gettext', 'gmp', 'intl', 'mbstring', 'exif', 'mysqli', 'openssl', 'pdo_mysql', 'pdo_sqlite', 'soap', 'sockets', 'sodium', 'sqlite3', 'xsl', 'zip']
      .filter((name) => availableExtensions.has(`php_${name}.dll`))
    return `; BEGIN WEEBX MANAGED SETTINGS
extension_dir="${extensionDir.replace(/\\/g, '/')}"
${extensions.map((name) => `extension=${name}`).join('\n')}
${hasDynamicOpcache ? 'zend_extension=opcache' : '; Zend OPcache is built into this PHP release'}
date.timezone=UTC
memory_limit=${profile === 'development' ? '512M' : '256M'}
max_execution_time=${profile === 'development' ? '120' : '30'}
post_max_size=128M
upload_max_filesize=128M
display_errors=${profile === 'development' ? 'On' : 'Off'}
display_startup_errors=${profile === 'development' ? 'On' : 'Off'}
log_errors=On
error_log="${slash(join(paths.root, 'logs', 'php-error.log'))}"
error_reporting=E_ALL
expose_php=${profile === 'development' ? 'On' : 'Off'}
allow_url_include=Off
zend.exception_ignore_args=${profile === 'development' ? 'Off' : 'On'}
zend.exception_string_param_max_len=${profile === 'development' ? '15' : '0'}
zend.assertions=${profile === 'development' ? '1' : '-1'}
session.save_handler=files
session.save_path="${slash(paths.sessions)}"
session.use_strict_mode=1
session.use_cookies=1
session.use_only_cookies=1
session.use_trans_sid=0
session.upload_progress.enabled=0
session.cookie_httponly=1
session.cookie_samesite=Lax
session.cookie_secure=${profile === 'production' ? '1' : '0'}
sys_temp_dir="${slash(paths.tmp)}"
upload_tmp_dir="${slash(paths.tmp)}"
opcache.enable=1
opcache.validate_timestamps=1
opcache.revalidate_freq=${profile === 'development' ? '0' : '60'}
; END WEEBX MANAGED SETTINGS
`
  }

  apacheTemplate(settings: RuntimeSettings): string {
    const p = runtimePaths(settings)
    const slash = (value: string) => value.replace(/\\/g, '/')
    return `ServerRoot "${slash(p.apache)}"
Listen ${settings.apachePort}
Listen ${settings.apacheSslPort}
LoadModule actions_module modules/mod_actions.so
LoadModule alias_module modules/mod_alias.so
LoadModule authz_core_module modules/mod_authz_core.so
LoadModule authz_host_module modules/mod_authz_host.so
LoadModule cgi_module modules/mod_cgi.so
LoadModule dir_module modules/mod_dir.so
LoadModule env_module modules/mod_env.so
LoadModule headers_module modules/mod_headers.so
LoadModule log_config_module modules/mod_log_config.so
LoadModule mime_module modules/mod_mime.so
LoadModule rewrite_module modules/mod_rewrite.so
LoadModule reqtimeout_module modules/mod_reqtimeout.so
LoadModule ssl_module modules/mod_ssl.so
LoadModule socache_shmcb_module modules/mod_socache_shmcb.so
ServerName localhost:${settings.apachePort}
${apacheSecurityBlock(p.htdocs).trimEnd()}
DirectoryIndex index.php index.html
ErrorLog "logs/error.log"
LogLevel warn
CustomLog "logs/access.log" combined
SSLSessionCache "shmcb:logs/ssl_scache(512000)"
SSLProtocol -all +TLSv1.2 +TLSv1.3
SSLCompression Off
SSLSessionTickets Off
TypesConfig conf/mime.types
ScriptAlias /weebx-php/ "${slash(p.activePhp)}/"
<Directory "${slash(p.activePhp)}">
    Options None
    AllowOverride None
    Require all denied
    <Files "php-cgi.exe">
        Require all granted
    </Files>
</Directory>
SetEnv PHPRC "${slash(p.activePhp)}"
Action application/x-httpd-php "/weebx-php/php-cgi.exe"
AddHandler application/x-httpd-php .php
Include conf/extra/httpd-vhosts.conf
`
  }

  mariaDbTemplate(settings: RuntimeSettings): string {
    const p = runtimePaths(settings)
    return `[client]
port=${settings.mariadbPort}
socket=MariaDB

[mysqld]
port=${settings.mariadbPort}
basedir=${p.mariadb.replace(/\\/g, '/')}
datadir=${p.mariadbData.replace(/\\/g, '/')}
character-set-server=utf8mb4
collation-server=utf8mb4_unicode_ci
max_allowed_packet=128M
local-infile=0
skip-name-resolve
skip-symbolic-links
feedback=OFF
bind-address=127.0.0.1
# MariaDB is intentionally reachable only from this machine.
# The root password is set during first-run security setup and protected by Windows.
`
  }

  vhostExample(settings: RuntimeSettings): string {
    const root = settings.htdocsRoot.replace(/\\/g, '/')
    return `# WeebX virtual hosts
# Create sites with one click in WeebX, or copy this complete example.
# For custom domains, also map each name to 127.0.0.1 in the Windows hosts file.
#
# <VirtualHost *:${settings.apachePort}>
#     ServerName test.jadadev.com
#     ServerAlias www.test.jadadev.com
#     DocumentRoot "${root}/test-jadadev-com"
#     <Directory "${root}/test-jadadev-com">
#         Options -Indexes +FollowSymLinks
#         AllowOverride All
#         Require all granted
#     </Directory>
# </VirtualHost>
#
# <VirtualHost *:${settings.apacheSslPort}>
#     ServerName test.jadadev.com
#     ServerAlias www.test.jadadev.com
#     DocumentRoot "${root}/test-jadadev-com"
#     SSLEngine on
#     SSLCertificateFile "certificates/test-jadadev-com/server.crt"
#     SSLCertificateKeyFile "certificates/test-jadadev-com/server.key"
#     <Directory "${root}/test-jadadev-com">
#         Options -Indexes +FollowSymLinks
#         AllowOverride All
#         Require all granted
#     </Directory>
# </VirtualHost>

# BEGIN WEEBX MANAGED VHOSTS
# One-click sites appear here. Content outside these markers is preserved.
# END WEEBX MANAGED VHOSTS
`
  }

  private async ensureApacheSecurity(): Promise<void> {
    const settings = await this.getSettings()
    const paths = runtimePaths(settings)
    if (!(await exists(paths.apacheConf))) return
    let current = await readFile(paths.apacheConf, 'utf8')
    const requiredModules = [
      ['reqtimeout_module', 'modules/mod_reqtimeout.so'],
      ['authz_host_module', 'modules/mod_authz_host.so']
    ] as const
    for (const [name, file] of requiredModules) {
      if (!new RegExp(`^\\s*LoadModule\\s+${name}\\s+`, 'mi').test(current)) current = `LoadModule ${name} ${file}\r\n${current}`
    }
    const begin = '# BEGIN WEEBX SECURITY DEFAULTS'
    const end = '# END WEEBX SECURITY DEFAULTS'
    const pattern = new RegExp(`${begin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${end.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'g')
    current = current.replace(pattern, '').trimEnd()
    const block = apacheSecurityBlock(settings.htdocsRoot)
    await backupAndWrite(paths.apacheConf, `${current}\r\n\r\n${block.replace(/\n/g, '\r\n')}`)
  }

}
