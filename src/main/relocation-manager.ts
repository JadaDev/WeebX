import { app } from 'electron'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { RelocationResult, VirtualHost } from '../shared/types'
import type { JsonStore } from './store'
import type { ConfigManager } from './config-manager'
import type { VhostManager } from './vhost-manager'
import type { LogBuffer } from './logs'
import { isInside, pathsChanged, rebasePath, replacePath, samePath } from './relocation-paths'
import { stopRuntimeProcesses } from './runtime-lock'

interface LocationStamp {
  runtimeRoot: string
  executableDirectory: string
  dataDirectory: string
  repairedAt: string
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true } catch { return false }
}

export class RelocationManager {
  constructor(
    private readonly store: JsonStore,
    private readonly configs: ConfigManager,
    private readonly vhosts: VhostManager,
    private readonly logs: LogBuffer
  ) {}

  async autoRepair(): Promise<RelocationResult> {
    const settings = await this.store.getSettings()
    const localRuntime = join(app.getPath('userData'), 'runtime')
    if (await this.isRuntime(localRuntime) && !samePath(localRuntime, settings.runtimeRoot)) {
      return this.repair(localRuntime, 'WeebX detected that this copy has its own runtime folder.')
    }

    const configuredIsValid = await this.isRuntime(settings.runtimeRoot)
    if (configuredIsValid) {
      const stamp = await this.readStamp(settings.runtimeRoot)
      const executableMoved = Boolean(stamp && !samePath(stamp.executableDirectory, dirname(process.execPath)))
      const preferNearbyRuntime = executableMoved || process.argv.includes('--repair-location')
      if (preferNearbyRuntime) {
        for (const candidate of this.candidates()) {
          const nearbyRuntime = await this.normalizeCandidate(candidate)
          if (nearbyRuntime && !samePath(nearbyRuntime, settings.runtimeRoot)) {
            return this.repair(nearbyRuntime, 'WeebX detected that its folder was copied or moved.')
          }
        }
      }
      const locationChanged = stamp !== null && (
        !samePath(stamp.runtimeRoot, settings.runtimeRoot) ||
        !samePath(stamp.executableDirectory, dirname(process.execPath)) ||
        !samePath(stamp.dataDirectory, app.getPath('userData'))
      )
      if (locationChanged || process.argv.includes('--repair-location')) {
        return this.repair(settings.runtimeRoot, 'WeebX detected a new application or data location.')
      }
      if (!stamp) await this.writeStamp(settings.runtimeRoot)
      return { repaired: false, runtimeRoot: settings.runtimeRoot, message: 'Runtime paths are current.' }
    }

    for (const candidate of this.candidates()) {
      const runtimeRoot = await this.normalizeCandidate(candidate)
      if (runtimeRoot) return this.repair(runtimeRoot, 'WeebX found the runtime in its new location.')
    }
    return { repaired: false, runtimeRoot: settings.runtimeRoot, message: 'No relocated runtime was detected.' }
  }

  async repair(selectedPath: string, reason = 'Runtime location repaired from Settings.'): Promise<RelocationResult> {
    const runtimeRoot = await this.normalizeCandidate(selectedPath)
    if (!runtimeRoot) throw new Error('Select a WeebX runtime folder containing apache, mariadb, php, and htdocs.')
    const previous = await this.store.getSettings()
    const oldRoot = previous.runtimeRoot
    const oldHtdocs = previous.htdocsRoot
    const newHtdocs = isInside(oldRoot, oldHtdocs) ? rebasePath(oldHtdocs, oldRoot, runtimeRoot) :
      await exists(join(runtimeRoot, 'htdocs')) ? join(runtimeRoot, 'htdocs') : oldHtdocs

    if (!pathsChanged(oldRoot, runtimeRoot, oldHtdocs, newHtdocs)) {
      await this.writeStamp(runtimeRoot)
      return { repaired: false, runtimeRoot, message: 'Runtime paths are current.' }
    }

    await stopRuntimeProcesses(oldRoot)
    if (!samePath(oldRoot, runtimeRoot)) await stopRuntimeProcesses(runtimeRoot)

    await this.store.updateSettings({ runtimeRoot, htdocsRoot: newHtdocs })
    const currentHosts = await this.store.getVhosts()
    const rebasedHosts: VirtualHost[] = currentHosts.map((host) => ({
      ...host,
      documentRoot: isInside(oldHtdocs, host.documentRoot)
        ? rebasePath(host.documentRoot, oldHtdocs, newHtdocs)
        : rebasePath(host.documentRoot, oldRoot, runtimeRoot)
    }))
    await this.store.setVhosts(rebasedHosts)

    await this.configs.ensureLayout()
    const settings = await this.store.getSettings()
    let vhostConfig = await this.configs.read('vhosts')
    vhostConfig = replacePath(replacePath(vhostConfig, oldRoot, runtimeRoot), oldHtdocs, newHtdocs)
    await this.configs.save('vhosts', vhostConfig)
    await this.configs.save('apache', this.configs.apacheTemplate(settings))
    await this.configs.save('mariadb', this.configs.mariaDbTemplate(settings))
    await this.configs.applyPhpProfile(settings.activePhpVersion, settings.phpProfile)
    await this.vhosts.render()
    await this.writeStamp(runtimeRoot)
    this.logs.add('system', 'info', `${reason} Runtime: ${runtimeRoot}`)
    return { repaired: true, runtimeRoot, message: `${reason} Configuration files and virtual hosts were updated.` }
  }

  async writeCurrentStamp(): Promise<void> {
    const settings = await this.store.getSettings()
    if (await this.isRuntime(settings.runtimeRoot)) await this.writeStamp(settings.runtimeRoot)
  }

  private candidates(): string[] {
    const executableDirectory = dirname(process.execPath)
    return [...new Set([
      join(app.getPath('userData'), 'runtime'),
      join(executableDirectory, 'data', 'runtime'),
      join(executableDirectory, 'runtime'),
      join(executableDirectory, 'WeebX', 'runtime'),
      join(process.cwd(), 'data', 'runtime'),
      join(process.cwd(), 'runtime')
    ])]
  }

  private async normalizeCandidate(selectedPath: string): Promise<string | null> {
    const direct = resolve(selectedPath)
    if (await this.isRuntime(direct)) return direct
    const nested = join(direct, 'runtime')
    return await this.isRuntime(nested) ? nested : null
  }

  private async isRuntime(root: string): Promise<boolean> {
    return Promise.all([
      exists(join(root, 'apache', 'bin', 'httpd.exe')),
      exists(join(root, 'mariadb', 'bin', 'mariadbd.exe')),
      exists(join(root, 'php')),
      exists(join(root, 'htdocs'))
    ]).then((checks) => checks.every(Boolean))
  }

  private async readStamp(runtimeRoot: string): Promise<LocationStamp | null> {
    try { return JSON.parse((await readFile(join(runtimeRoot, '.weebx-location.json'), 'utf8')).replace(/^\uFEFF/, '')) as LocationStamp }
    catch { return null }
  }

  private async writeStamp(runtimeRoot: string): Promise<void> {
    const stamp: LocationStamp = {
      runtimeRoot: resolve(runtimeRoot),
      executableDirectory: dirname(process.execPath),
      dataDirectory: app.getPath('userData'),
      repairedAt: new Date().toISOString()
    }
    await mkdir(runtimeRoot, { recursive: true })
    await writeFile(join(runtimeRoot, '.weebx-location.json'), JSON.stringify(stamp, null, 2), 'utf8')
  }
}
