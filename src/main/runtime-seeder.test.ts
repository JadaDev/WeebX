import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runtimeCriticalFiles } from './runtime-seeder'

describe('bundled runtime integrity', () => {
  it('checks every executable needed to start Apache, MariaDB, and bundled PHP versions', () => {
    expect(runtimeCriticalFiles('C:\\WeebX', ['8.4.27', '8.5.12'])).toEqual([
      join('C:\\WeebX', 'apache', 'bin', 'httpd.exe'),
      join('C:\\WeebX', 'mariadb', 'bin', 'mariadbd.exe'),
      join('C:\\WeebX', 'php', '8.4.27', 'php.exe'),
      join('C:\\WeebX', 'php', '8.4.27', 'php-cgi.exe'),
      join('C:\\WeebX', 'php', '8.5.12', 'php.exe'),
      join('C:\\WeebX', 'php', '8.5.12', 'php-cgi.exe')
    ])
  })
})
