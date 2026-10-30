import { describe, expect, it } from 'vitest'
import { AUTOMATIC_INSTALLER_IDS } from './app-installers'
import { catalogConnectionLinks, catalogDownloadUrls, PREINSTALLED_APP_CATALOG, publicPreinstalledAppCatalog } from './preinstalled-app-catalog'
import { APP_DOWNLOAD_HOSTS, findInstalledApp, isRecoverableVhostPlaceholder, isRetryableDownloadFailure, normalizeAppKey, phpVersionCompatible, unexpectedDefaultEntries, usesAutomaticLocalhostResolution } from './preinstalled-apps'
import { vhostPlaceholderHtml } from './vhost-manager'
import type { PreinstalledAppRecord } from '../shared/types'

describe('pre-installed app catalog', () => {
  it('contains a broad, unique catalog with valid metadata', () => {
    expect(PREINSTALLED_APP_CATALOG.length).toBeGreaterThanOrEqual(12)
    expect(new Set(PREINSTALLED_APP_CATALOG.map((item) => item.id)).size).toBe(PREINSTALLED_APP_CATALOG.length)
    for (const app of PREINSTALLED_APP_CATALOG) {
      const urls = catalogDownloadUrls(app)
      expect(urls.length).toBeGreaterThan(0)
      for (const url of urls) {
        const parsed = new URL(url)
        expect(parsed.protocol).toBe('https:')
        expect(url).not.toMatch(/(?:latest|\/archive\/refs\/heads\/)/i)
        expect(APP_DOWNLOAD_HOSTS.has(parsed.hostname)).toBe(true)
      }
      expect(app.expectedSha256).toMatch(/^[a-f0-9]{64}$/)
      expect(app.php.requiredExtensions.length).toBeGreaterThan(0)
      expect(app.version).not.toBe('')
    }
  })

  it('does not expose trusted download internals to the renderer', () => {
    const publicCatalog = publicPreinstalledAppCatalog()
    expect(publicCatalog).toHaveLength(PREINSTALLED_APP_CATALOG.length)
    expect(publicCatalog.every((item) => !('downloadUrl' in item) && !('downloadFallbacks' in item) && !('payloadHints' in item) && !('expectedSha256' in item) && !('completionFiles' in item) && !('completionDirectories' in item) && !('cleanupPaths' in item) && !('webRoot' in item) && !('nestedArchive' in item) && !('siteLabel' in item) && !('adminPath' in item) && !('adminLabel' in item))).toBe(true)
    expect(publicCatalog.every((item) => item.setupSummary.length > 20)).toBe(true)
  })

  it('marks apps with official unattended installers as automatic and the rest as browser-guided', () => {
    const automatic = PREINSTALLED_APP_CATALOG.filter((item) => item.setup === 'automatic').map((item) => item.id)
    const browser = PREINSTALLED_APP_CATALOG.filter((item) => item.setup === 'browser').map((item) => item.id)
    expect(automatic.sort()).toEqual([...AUTOMATIC_INSTALLER_IDS].sort())
    expect(browser.sort()).toEqual(['matomo', 'mybb', 'piwigo', 'processwire'].sort())
    expect(PREINSTALLED_APP_CATALOG.find((item) => item.id === 'prestashop')?.nestedArchive).toBe('prestashop.zip')
  })

  it('includes automatic GitList and PrivateBin without administrator accounts', () => {
    const gitlist = PREINSTALLED_APP_CATALOG.find((item) => item.id === 'gitlist')
    const privatebin = PREINSTALLED_APP_CATALOG.find((item) => item.id === 'privatebin')
    expect(gitlist?.setup).toBe('automatic')
    expect(gitlist?.account).toBe(false)
    expect(gitlist?.database).toBe(false)
    expect(gitlist?.webRoot).toBe('public')
    expect(gitlist?.downloadUrl).toBe('https://github.com/klaussilveira/gitlist/releases/download/2.0.0/gitlist-2.0.0.zip')
    expect(privatebin?.setup).toBe('automatic')
    expect(privatebin?.account).toBe(false)
    expect(privatebin?.database).toBe(false)
    expect(privatebin?.payloadHints).toEqual(['PrivateBin-2.1.0'])
    const publicCatalog = publicPreinstalledAppCatalog()
    expect(publicCatalog.find((item) => item.id === 'gitlist')?.account).toBe(false)
    expect(publicCatalog.find((item) => item.id === 'privatebin')?.account).toBe(false)
  })

  it('pins phpBB to a checksum-matched community mirror when the official CDN is blocked', () => {
    const phpbb = PREINSTALLED_APP_CATALOG.find((item) => item.id === 'phpbb')
    expect(phpbb?.downloadUrl).toBe('https://download.phpbb.com/pub/release/3.3/3.3.19/phpBB-3.3.19.zip')
    expect(phpbb?.downloadFallbacks).toEqual(['https://ftp.phpbb-fr.com/public/downloads/3.3/3.3.19/phpBB-3.3.19.zip'])
    expect(phpbb?.expectedSha256).toBe('1530e5cabf7ecc9ecfaed3fa13da79f9e8a514623beafababc8800b5ce966de9')
    expect(catalogDownloadUrls(phpbb!)).toHaveLength(2)
  })

  it('builds forum and admin links for phpBB and dashboard links for the other apps', () => {
    const phpbb = catalogConnectionLinks(PREINSTALLED_APP_CATALOG.find((item) => item.id === 'phpbb'), 'http://phpbb.localhost/')
    expect(phpbb).toEqual([
      { label: 'Forum', url: 'http://phpbb.localhost/' },
      { label: 'Admin control panel', url: 'http://phpbb.localhost/adm/' }
    ])
    const wordpress = catalogConnectionLinks(PREINSTALLED_APP_CATALOG.find((item) => item.id === 'wordpress'), 'http://wordpress.localhost/')
    expect(wordpress.map((item) => item.label)).toEqual(['Website', 'Admin dashboard'])
    expect(wordpress[1]?.url).toBe('http://wordpress.localhost/wp-admin/')
    const prestashop = catalogConnectionLinks(PREINSTALLED_APP_CATALOG.find((item) => item.id === 'prestashop'), 'http://shop.localhost/', { adminPath: 'admin123abc/' })
    expect(prestashop[1]?.url).toBe('http://shop.localhost/admin123abc/')
  })

  it('retries blocked or mismatched catalog downloads, but not malformed archives', () => {
    expect(isRetryableDownloadFailure(new Error('Download failed: HTTP 403.'))).toBe(true)
    expect(isRetryableDownloadFailure(new Error('Download failed: HTTP 404.'))).toBe(true)
    expect(isRetryableDownloadFailure(new Error('Security check failed: phpBB archive checksum did not match the pinned release.'))).toBe(true)
    expect(isRetryableDownloadFailure(new Error('The download exceeded its safe size limit.'))).toBe(false)
    expect(isRetryableDownloadFailure(new Error('The downloaded archive is empty.'))).toBe(false)
  })

  it('preserves WeebX infrastructure when checking the default website', () => {
    expect(unexpectedDefaultEntries(['index.php', 'assets', 'phpinfo.php', 'phpmyadmin'])).toEqual([])
    expect(unexpectedDefaultEntries(['PHPMYADMIN', 'notes.txt', 'customer-site'])).toEqual(['notes.txt', 'customer-site'])
  })

  it('only recovers the exact placeholder left by the older virtual-host failure', () => {
    const placeholder = vhostPlaceholderHtml('wordpress.test')
    expect(isRecoverableVhostPlaceholder(['index.php'], placeholder, 'wordpress.test')).toBe(true)
    expect(isRecoverableVhostPlaceholder(['index.php', 'notes.txt'], placeholder, 'wordpress.test')).toBe(false)
    expect(isRecoverableVhostPlaceholder(['index.php'], `${placeholder}\n<!-- changed -->`, 'wordpress.test')).toBe(false)
    expect(isRecoverableVhostPlaceholder(['index.php'], placeholder, 'other.test')).toBe(false)
  })

  it('recognizes reserved localhost names that never need a hosts-file edit', () => {
    expect(usesAutomaticLocalhostResolution('localhost')).toBe(true)
    expect(usesAutomaticLocalhostResolution('WordPress.LocalHost')).toBe(true)
    expect(usesAutomaticLocalhostResolution('shop.wordpress.localhost.')).toBe(true)
    expect(usesAutomaticLocalhostResolution('wordpress.test')).toBe(false)
    expect(usesAutomaticLocalhostResolution('localhost.example.com')).toBe(false)
  })

  it('checks PHP major/minor compatibility across patch releases', () => {
    expect(phpVersionCompatible('8.4.27', '8.1', '8.4')).toBe(true)
    expect(phpVersionCompatible('8.5.0', '8.1', '8.4')).toBe(false)
    expect(phpVersionCompatible('8.0.30', '8.1')).toBe(false)
    expect(phpVersionCompatible('8.3.36', '8.3')).toBe(true)
  })

  it('normalizes database keys without accepting path-like input', () => {
    expect(normalizeAppKey('My Side-Site!', 'app')).toBe('my_side_site')
    expect(normalizeAppKey('../../', 'wordpress')).toBe('wordpress')
    expect(normalizeAppKey('A'.repeat(100), 'app')).toHaveLength(24)
  })
})

describe('installed app lookup', () => {
  const wordpress = sampleApp({
    id: 'c15bfd22-a0cc-4327-bd4d-96aba6b38634',
    siteId: '74f8502b-b2ca-49b9-b783-0e81e6661d3c',
    domain: 'wordpress.localhost',
    documentRoot: 'C:\\WeebX\\htdocs\\wordpress'
  })
  const removed = sampleApp({ ...wordpress, status: 'removed' })

  it('finds the listed app by install id, site id, or unique domain', () => {
    expect(findInstalledApp([wordpress], wordpress.id)?.id).toBe(wordpress.id)
    expect(findInstalledApp([wordpress], wordpress.siteId)?.id).toBe(wordpress.id)
    expect(findInstalledApp([wordpress], 'wordpress.localhost')?.id).toBe(wordpress.id)
    expect(findInstalledApp([wordpress], 'wordpress')?.id).toBe(wordpress.id)
  })

  it('does not treat an already-uninstalled app as still installed', () => {
    expect(findInstalledApp([removed], wordpress.id)).toBeUndefined()
    expect(findInstalledApp([removed], wordpress.id, true)?.id).toBe(wordpress.id)
  })

  it('does not guess when two apps share a catalog id', () => {
    const second = sampleApp({ ...wordpress, id: 'other-install', siteId: 'other-site', domain: 'blog.localhost', documentRoot: 'C:\\WeebX\\htdocs\\blog' })
    expect(findInstalledApp([wordpress, second], 'wordpress')).toBeUndefined()
    expect(findInstalledApp([wordpress, second], wordpress.id)?.domain).toBe('wordpress.localhost')
  })
})

function sampleApp(partial: Partial<PreinstalledAppRecord> & Pick<PreinstalledAppRecord, 'id' | 'siteId' | 'domain' | 'documentRoot'>): PreinstalledAppRecord {
  return {
    catalogId: 'wordpress',
    name: 'WordPress',
    version: '7.1.3',
    status: 'installed',
    location: 'side',
    projectName: 'wordpress',
    url: 'https://wordpress.localhost/',
    phpVersion: '8.4.27',
    phpExtensions: ['mysqli'],
    createdAt: '2026-10-28T00:00:00.000Z',
    updatedAt: '2026-10-28T00:00:00.000Z',
    ...partial
  }
}
