import { join } from 'node:path'
import type { RuntimeSettings } from '../shared/types'

export function runtimePaths(settings: RuntimeSettings) {
  const root = settings.runtimeRoot
  return {
    root,
    apache: join(root, 'apache'),
    apacheExe: join(root, 'apache', 'bin', 'httpd.exe'),
    apacheConf: join(root, 'apache', 'conf', 'httpd.conf'),
    vhostsConf: join(root, 'apache', 'conf', 'extra', 'httpd-vhosts.conf'),
    mariadb: join(root, 'mariadb'),
    mariadbExe: join(root, 'mariadb', 'bin', 'mariadbd.exe'),
    mariadbConf: join(root, 'mariadb', 'my.ini'),
    mariadbData: join(root, 'mariadb', 'data'),
    php: join(root, 'php'),
    activePhp: join(root, 'php', settings.activePhpVersion),
    phpExe: join(root, 'php', settings.activePhpVersion, 'php.exe'),
    phpCgiExe: join(root, 'php', settings.activePhpVersion, 'php-cgi.exe'),
    phpIni: join(root, 'php', settings.activePhpVersion, 'php.ini'),
    htdocs: settings.htdocsRoot,
    phpMyAdmin: join(settings.htdocsRoot, 'phpmyadmin'),
    certificates: join(root, 'certificates'),
    temp: join(root, '.downloads'),
    tmp: join(root, 'tmp'),
    sessions: join(root, 'tmp', 'sessions'),
    phpMyAdminTemp: join(root, 'tmp', 'phpmyadmin')
  }
}
