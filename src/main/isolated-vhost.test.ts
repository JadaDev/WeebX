import { execFile, spawn } from 'node:child_process'
import { request } from 'node:http'
import { createServer } from 'node:net'
import { access, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { RuntimeSettings, VirtualHost } from '../shared/types'
import { ConfigManager } from './config-manager'
import { siteProfilePaths } from './site-profile'
import { VhostManager } from './vhost-manager'

describe('isolated virtual-host Apache configuration', () => {
  it('is accepted by the bundled Apache build', async () => {
    const runtimeRoot = resolve('resources/runtime')
    const executable = join(runtimeRoot, 'apache', 'bin', 'httpd.exe')
    try { await access(executable) } catch { return }
    const folder = await mkdtemp(join(tmpdir(), 'weebx-isolated-vhost-'))
    const documentRoot = join(folder, 'htdocs', 'isolated')
    await mkdir(documentRoot, { recursive: true })
    await writeFile(join(documentRoot, 'index.php'), '<?php echo "ok|", php_ini_loaded_file(), "|", ini_get("session.save_path");')
    const name = `syntax-${process.pid}-${Date.now()}`
    const freePort = () => new Promise<number>((resolvePort, reject) => {
      const server = createServer()
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        const port = typeof address === 'object' && address ? address.port : 0
        server.close(() => resolvePort(port))
      })
    })
    const apachePort = await freePort()
    const apacheSslPort = await freePort()
    const settings: RuntimeSettings = {
      runtimeRoot, htdocsRoot: join(folder, 'htdocs'), apachePort, apacheSslPort, mariadbPort: 13307,
      mariadbPassword: '', activePhpVersion: '8.5.12', phpProfile: 'development', setupComplete: true,
      startOnLaunch: false, minimizeToTray: true, checkPortsBeforeStart: true, startWithWindows: false,
      autoRestartApache: false, autoRestartMariaDb: false, autoRestartDelayMs: 10000
    }
    const site: VirtualHost = {
      id: crypto.randomUUID(), name, serverName: 'isolated.test', aliases: [], documentRoot, http: true, https: false, enabled: true,
      createdAt: new Date().toISOString(),
      isolation: {
        phpVersion: '8.5.12', phpProfile: 'production', phpExtensions: [], memoryLimit: '256M', maxExecutionTime: 30,
        maxInputTime: 60, maxInputVars: 3000, uploadMaxFilesize: '32M', postMaxSize: '40M', maxFileUploads: 10,
        openBasedir: true, disableDangerousFunctions: true, allowUserIni: false, permissionPreset: 'private', customIni: ''
      }
    }
    const configManager = new ConfigManager(async () => settings)
    let vhostConfig = configManager.vhostExample(settings)
    const manager = new VhostManager(
      { getVhosts: async () => [site], getSettings: async () => settings } as never,
      { read: async () => vhostConfig, save: async (_kind: string, content: string) => { vhostConfig = content } } as never,
      { add: () => undefined } as never
    )
    const profileRoot = siteProfilePaths(settings, site).root
    try {
      await manager.render()
      expect(vhostConfig).toContain('AddHandler application/x-httpd-php .php')
      expect(vhostConfig).toContain('SetEnv PHPRC')
      expect(vhostConfig).toContain('apache-access.log')
      const vhostFile = join(folder, 'httpd-vhosts.conf')
      await writeFile(vhostFile, vhostConfig, 'utf8')
      const mainFile = join(folder, 'httpd.conf')
      const main = configManager.apacheTemplate(settings)
        .replace('Include conf/extra/httpd-vhosts.conf', `Include "${vhostFile.replace(/\\/g, '/')}"`)
        .replace('ErrorLog "logs/error.log"', `PidFile "${join(folder, 'httpd.pid').replace(/\\/g, '/')}"\nErrorLog "${join(folder, 'apache-main-error.log').replace(/\\/g, '/')}"`)
      await writeFile(mainFile, main, 'utf8')
      const result = await new Promise<{ code: number; output: string }>((done) => execFile(executable, ['-t', '-f', mainFile], { windowsHide: true }, (error, stdout, stderr) => done({ code: error ? 1 : 0, output: `${stdout}${stderr}` })))
      expect(result.code, result.output).toBe(0)
      expect(result.output).toMatch(/Syntax OK/i)
      const child = spawn(executable, ['-f', mainFile], { cwd: join(runtimeRoot, 'apache'), windowsHide: true, stdio: 'ignore' })
      try {
        let response: { status: number; body: string } | null = null
        for (let attempt = 0; attempt < 30 && !response; attempt += 1) {
          response = await new Promise<{ status: number; body: string } | null>((resolveResponse) => {
            const call = request({ hostname: '127.0.0.1', port: apachePort, path: '/', headers: { Host: 'isolated.test' }, timeout: 800 }, (incoming) => {
              let body = ''
              incoming.on('data', (chunk) => { body += chunk })
              incoming.on('end', () => resolveResponse({ status: incoming.statusCode ?? 0, body }))
            })
            call.once('timeout', () => { call.destroy(); resolveResponse(null) })
            call.once('error', () => resolveResponse(null))
            call.end()
          })
          if (!response) await new Promise((resolveWait) => setTimeout(resolveWait, 100))
        }
        expect(response?.status).toBe(200)
        expect(response?.body).toContain('ok')
        expect(response?.body.replace(/\\/g, '/')).toContain(siteProfilePaths(settings, site).php.replace(/\\/g, '/'))
      } finally {
        await new Promise<void>((done) => execFile(executable, ['-k', 'shutdown', '-f', mainFile], { windowsHide: true }, () => done()))
        if (child.exitCode === null) child.kill()
      }
    } finally {
      await rm(profileRoot, { recursive: true, force: true })
      await rm(folder, { recursive: true, force: true })
    }
  })
})
