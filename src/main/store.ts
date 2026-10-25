import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { RuntimeSettings, VirtualHost } from '../shared/types'
import { defaultSettings } from './defaults'

interface StoreData {
  settings: RuntimeSettings
  virtualHosts: VirtualHost[]
}

export class JsonStore {
  private data: StoreData | null = null

  constructor(private readonly file: string) {}

  async load(): Promise<StoreData> {
    if (this.data) return this.data
    try {
      const raw = await readFile(this.file, 'utf8')
      const saved = JSON.parse(raw) as Partial<StoreData>
      this.data = {
        settings: { ...defaultSettings(), ...saved.settings },
        virtualHosts: Array.isArray(saved.virtualHosts) ? saved.virtualHosts : []
      }
    } catch {
      this.data = { settings: defaultSettings(), virtualHosts: [] }
      await this.save()
    }
    return this.data
  }

  async getSettings(): Promise<RuntimeSettings> {
    return { ...(await this.load()).settings }
  }

  async updateSettings(patch: Partial<RuntimeSettings>): Promise<RuntimeSettings> {
    const data = await this.load()
    data.settings = { ...data.settings, ...patch }
    await this.save()
    return { ...data.settings }
  }

  async getVhosts(): Promise<VirtualHost[]> {
    return [...(await this.load()).virtualHosts]
  }

  async setVhosts(virtualHosts: VirtualHost[]): Promise<void> {
    ;(await this.load()).virtualHosts = virtualHosts
    await this.save()
  }

  private async save(): Promise<void> {
    if (!this.data) return
    await mkdir(dirname(this.file), { recursive: true })
    const temporary = join(dirname(this.file), `${Date.now()}.tmp`)
    await writeFile(temporary, JSON.stringify(this.data, null, 2), 'utf8')
    await rename(temporary, this.file)
  }
}
