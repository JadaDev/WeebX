import { safeStorage } from 'electron'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { RuntimeSettings, VirtualHost } from '../shared/types'
import { defaultSettings } from './defaults'

interface StoreData {
  settings: RuntimeSettings
  virtualHosts: VirtualHost[]
}

interface StoredData {
  settings?: Partial<RuntimeSettings>
  virtualHosts?: VirtualHost[]
  mariadbPasswordProtected?: string
}

function isMissingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}

async function protectPassword(password: string): Promise<string> {
  if (!password) return ''
  if (!(await safeStorage.isAsyncEncryptionAvailable())) {
    throw new Error('Windows credential encryption is unavailable. WeebX will not save a database password in plaintext.')
  }
  return (await safeStorage.encryptStringAsync(password)).toString('base64')
}

async function unprotectPassword(value: string): Promise<{ password: string; shouldReEncrypt: boolean }> {
  if (!value) return { password: '', shouldReEncrypt: false }
  if (!(await safeStorage.isAsyncEncryptionAvailable())) throw new Error('Windows credential encryption is unavailable.')
  try {
    const decrypted = await safeStorage.decryptStringAsync(Buffer.from(value, 'base64'))
    return { password: decrypted.result, shouldReEncrypt: decrypted.shouldReEncrypt }
  }
  catch { throw new Error('The saved MariaDB credential cannot be decrypted by this Windows account. Reset it from WeebX security setup.') }
}

export class JsonStore {
  private data: StoreData | null = null

  constructor(private readonly file: string) {}

  async load(): Promise<StoreData> {
    if (this.data) return this.data
    try {
      const raw = await readFile(this.file, 'utf8')
      const saved = JSON.parse(raw) as StoredData
      const defaults = defaultSettings()
      const legacyPassword = typeof saved.settings?.mariadbPassword === 'string' ? saved.settings.mariadbPassword : undefined
      const decrypted = saved.mariadbPasswordProtected !== undefined
        ? await unprotectPassword(saved.mariadbPasswordProtected)
        : { password: legacyPassword ?? defaults.mariadbPassword, shouldReEncrypt: false }
      this.data = {
        settings: { ...defaults, ...saved.settings, mariadbPassword: decrypted.password },
        virtualHosts: Array.isArray(saved.virtualHosts) ? saved.virtualHosts : []
      }
      if (legacyPassword !== undefined || saved.mariadbPasswordProtected === undefined || decrypted.shouldReEncrypt) await this.save()
    } catch (error) {
      if (!isMissingFile(error)) throw error
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
    const { mariadbPassword, ...settings } = this.data.settings
    const stored = {
      settings,
      virtualHosts: this.data.virtualHosts,
      mariadbPasswordProtected: await protectPassword(mariadbPassword)
    }
    await writeFile(temporary, JSON.stringify(stored, null, 2), { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, this.file)
    await chmod(this.file, 0o600).catch(() => undefined)
  }
}
