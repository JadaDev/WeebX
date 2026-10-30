import { safeStorage } from 'electron'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { PreinstalledAppActivity, PreinstalledAppRecord, RuntimeSettings, VirtualHost } from '../shared/types'
import { defaultSettings } from './defaults'

interface StoreData {
  settings: RuntimeSettings
  virtualHosts: VirtualHost[]
  siteDatabasePasswords: Record<string, string>
  appAdminPasswords: Record<string, string>
  installedApps: PreinstalledAppRecord[]
  preinstalledAppActivity: PreinstalledAppActivity[]
}

interface StoredData {
  settings?: Partial<RuntimeSettings>
  virtualHosts?: VirtualHost[]
  mariadbPasswordProtected?: string
  siteDatabasePasswordsProtected?: string
  appAdminPasswordsProtected?: string
  installedApps?: PreinstalledAppRecord[]
  preinstalledAppActivity?: PreinstalledAppActivity[]
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
  private saveQueue: Promise<void> = Promise.resolve()

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
      const siteSecrets = saved.siteDatabasePasswordsProtected
        ? await unprotectPassword(saved.siteDatabasePasswordsProtected)
        : { password: '{}', shouldReEncrypt: false }
      const adminSecrets = saved.appAdminPasswordsProtected
        ? await unprotectPassword(saved.appAdminPasswordsProtected)
        : { password: '{}', shouldReEncrypt: false }
      let siteDatabasePasswords: Record<string, string> = {}
      let appAdminPasswords: Record<string, string> = {}
      try {
        const parsed = JSON.parse(siteSecrets.password) as unknown
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          siteDatabasePasswords = Object.fromEntries(Object.entries(parsed as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
        }
      } catch { throw new Error('The saved isolated-site database credentials are damaged. Reset the affected site credentials.') }
      try {
        const parsed = JSON.parse(adminSecrets.password) as unknown
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          appAdminPasswords = Object.fromEntries(Object.entries(parsed as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
        }
      } catch { throw new Error('The saved application administrator credentials are damaged. Reset the affected app from Installed apps.') }
      this.data = {
        settings: { ...defaults, ...saved.settings, mariadbPassword: decrypted.password },
        virtualHosts: Array.isArray(saved.virtualHosts) ? saved.virtualHosts : [],
        siteDatabasePasswords,
        appAdminPasswords,
        installedApps: Array.isArray(saved.installedApps) ? saved.installedApps : [],
        preinstalledAppActivity: Array.isArray(saved.preinstalledAppActivity) ? saved.preinstalledAppActivity.slice(-2000) : []
      }
      if (legacyPassword !== undefined || saved.mariadbPasswordProtected === undefined || decrypted.shouldReEncrypt || siteSecrets.shouldReEncrypt || adminSecrets.shouldReEncrypt) await this.save()
    } catch (error) {
      if (!isMissingFile(error)) throw error
      this.data = { settings: defaultSettings(), virtualHosts: [], siteDatabasePasswords: {}, appAdminPasswords: {}, installedApps: [], preinstalledAppActivity: [] }
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

  async getSiteDatabasePassword(siteId: string): Promise<string> {
    return (await this.load()).siteDatabasePasswords[siteId] ?? ''
  }

  async setSiteDatabasePassword(siteId: string, password: string): Promise<void> {
    const data = await this.load()
    data.siteDatabasePasswords[siteId] = password
    await this.save()
  }

  async deleteSiteDatabasePassword(siteId: string): Promise<void> {
    const data = await this.load()
    delete data.siteDatabasePasswords[siteId]
    await this.save()
  }

  async getAppAdminPassword(installId: string): Promise<string> {
    return (await this.load()).appAdminPasswords[installId] ?? ''
  }

  async setAppAdminPassword(installId: string, password: string): Promise<void> {
    const data = await this.load()
    data.appAdminPasswords[installId] = password
    await this.save()
  }

  async deleteAppAdminPassword(installId: string): Promise<void> {
    const data = await this.load()
    delete data.appAdminPasswords[installId]
    await this.save()
  }

  async getInstalledApps(): Promise<PreinstalledAppRecord[]> {
    return (await this.load()).installedApps.map((item) => ({
      ...item,
      phpExtensions: Array.isArray(item.phpExtensions) ? [...item.phpExtensions] : []
    }))
  }

  async setInstalledApps(installedApps: PreinstalledAppRecord[]): Promise<void> {
    ;(await this.load()).installedApps = installedApps
    await this.save()
  }

  async getPreinstalledAppActivity(): Promise<PreinstalledAppActivity[]> {
    return [...(await this.load()).preinstalledAppActivity]
  }

  async addPreinstalledAppActivity(entry: PreinstalledAppActivity): Promise<void> {
    const data = await this.load()
    data.preinstalledAppActivity = [...data.preinstalledAppActivity.slice(-1999), entry]
    await this.save()
  }

  private async save(): Promise<void> {
    const pending = this.saveQueue.catch(() => undefined).then(() => this.writeSnapshot())
    this.saveQueue = pending
    await pending
  }

  private async writeSnapshot(): Promise<void> {
    if (!this.data) return
    await mkdir(dirname(this.file), { recursive: true })
    const temporary = join(dirname(this.file), `${Date.now()}-${crypto.randomUUID()}.tmp`)
    const { mariadbPassword, ...settings } = this.data.settings
    const stored = {
      settings,
      virtualHosts: this.data.virtualHosts,
      installedApps: this.data.installedApps,
      preinstalledAppActivity: this.data.preinstalledAppActivity,
      mariadbPasswordProtected: await protectPassword(mariadbPassword),
      siteDatabasePasswordsProtected: Object.keys(this.data.siteDatabasePasswords).length
        ? await protectPassword(JSON.stringify(this.data.siteDatabasePasswords))
        : '',
      appAdminPasswordsProtected: Object.keys(this.data.appAdminPasswords).length
        ? await protectPassword(JSON.stringify(this.data.appAdminPasswords))
        : ''
    }
    try {
      await writeFile(temporary, JSON.stringify(stored, null, 2), { encoding: 'utf8', mode: 0o600 })
      await rename(temporary, this.file)
      await chmod(this.file, 0o600).catch(() => undefined)
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined)
    }
  }
}
