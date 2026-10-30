import type { PreinstalledAppCatalogItem } from '../shared/types'

export interface InternalPreinstalledApp extends Omit<PreinstalledAppCatalogItem, 'setupSummary'> {
  downloadUrl: string
  /** Extra HTTPS URLs tried after the primary archive host returns 403/404 or a checksum mismatch. Each URL must match expectedSha256. */
  downloadFallbacks?: string[]
  /** SHA-256 of the exact release archive. Dynamic upstream URLs must not be marked pinned. */
  expectedSha256?: string
  payloadHints: string[]
  /** Public web-root child inside the extracted application folder. */
  webRoot?: string
  setupPath?: string
  /** Files created by a successful upstream browser installer. */
  completionFiles?: string[]
  /** Directories that must contain at least one matching generated file. */
  completionDirectories?: Array<{ path: string; suffix: string }>
  /** Upstream installer entry points that are safe to remove after completion. */
  cleanupPaths?: string[]
  /** Inner distribution zip that must be expanded after the outer archive is copied. */
  nestedArchive?: string
  /** Public link label shown in Installed app details, for example Forum or Store. */
  siteLabel?: string
  /** Admin or login path relative to the public site URL. */
  adminPath?: string
  adminLabel?: string
}

const php = (
  minimum: string,
  recommended: string,
  requiredExtensions: string[],
  recommendedExtensions: string[] = [],
  maximum?: string
): PreinstalledAppCatalogItem['php'] => ({ minimum, recommended, requiredExtensions, recommendedExtensions, ...(maximum ? { maximum } : {}) })

// Distribution archives only: source-code snapshots that need Composer/npm are intentionally excluded.
export const PREINSTALLED_APP_CATALOG: readonly InternalPreinstalledApp[] = [
  {
    id: 'wordpress', name: 'WordPress', category: 'cms', version: '7.1.3', license: 'GPL-2.0-or-later',
    description: 'The world’s most popular publishing and website platform.', website: 'https://wordpress.org/', setup: 'automatic', database: true,
    php: php('8.1', '8.4', ['curl', 'fileinfo', 'mysqli', 'openssl'], ['exif', 'gd', 'intl', 'mbstring', 'sodium', 'zip']),
    downloadUrl: 'https://downloads.wordpress.org/release/wordpress-7.1.3.zip', expectedSha256: 'eb58a90ed55147f90f7bd55d0d3334960a69b7e8a4cc142c8ddfea8965218227', payloadHints: ['wordpress'],
    adminPath: 'wp-admin/', adminLabel: 'Admin dashboard'
  },
  {
    id: 'joomla', name: 'Joomla!', category: 'cms', version: '6.2.0', license: 'GPL-2.0-or-later',
    description: 'A flexible CMS for portals, multilingual sites, and web applications.', website: 'https://www.joomla.org/', setup: 'automatic', database: true,
    php: php('8.3', '8.4', ['fileinfo', 'mysqli', 'openssl'], ['curl', 'gd', 'intl', 'mbstring', 'zip']),
    downloadUrl: 'https://downloads.joomla.org/cms/joomla6/6-2-0/Joomla_6-2-0-Stable-Full_Package.zip?format=zip', expectedSha256: 'eaafc68b5990d7b9dd9156656d4c3c3547743d1d7a85682a92e2f9121b58f018', payloadHints: [], setupPath: 'installation/index.php', completionFiles: ['configuration.php'], cleanupPaths: ['installation'],
    adminPath: 'administrator/', adminLabel: 'Admin'
  },
  {
    id: 'drupal', name: 'Drupal', category: 'cms', version: '11.4.7', license: 'GPL-2.0-or-later',
    description: 'A structured, extensible CMS for ambitious digital experiences.', website: 'https://www.drupal.org/', setup: 'automatic', database: true,
    php: php('8.3', '8.4', ['curl', 'fileinfo', 'gd', 'mbstring', 'openssl', 'pdo_mysql'], ['intl', 'opcache', 'sodium', 'zip']),
    downloadUrl: 'https://ftp.drupal.org/files/projects/drupal-11.4.7.zip', expectedSha256: '168584a7b44e4cecff9a720a5d0629c83a44d80b9617e00af45cda921ef25d2a', payloadHints: ['drupal-11.4.7'], setupPath: 'core/install.php', completionFiles: ['sites/default/settings.php'],
    adminPath: 'user/login', adminLabel: 'Admin login'
  },
  {
    id: 'grav', name: 'Grav', category: 'cms', version: '2.2.14', license: 'MIT',
    description: 'A fast flat-file CMS with no database to maintain.', website: 'https://getgrav.org/', setup: 'automatic', database: false,
    php: php('8.2', '8.4', ['curl', 'gd', 'mbstring', 'openssl', 'zip'], ['opcache']),
    downloadUrl: 'https://github.com/getgrav/grav/releases/download/2.2.14/grav-admin-v2.2.14.zip', expectedSha256: '0852badebca0ec075c1d177cc2336714f1d27aa69a05b21db12b44db7696345c', payloadHints: ['grav-admin'], completionDirectories: [{ path: 'user/accounts', suffix: '.yaml' }],
    adminPath: 'admin', adminLabel: 'Admin'
  },
  {
    id: 'processwire', name: 'ProcessWire', category: 'cms', version: '3.0.259', license: 'MPL-2.0',
    description: 'A friendly CMS and content-management framework with a powerful API.', website: 'https://processwire.com/', setup: 'browser', database: true,
    php: php('8.1', '8.4', ['fileinfo', 'gd', 'mysqli'], ['curl', 'mbstring', 'openssl', 'zip']),
    downloadUrl: 'https://github.com/processwire/processwire/archive/refs/tags/3.0.259.zip', expectedSha256: 'e75cc653561c5f77cd39c65fde2446c6ecabcf0f86026c05e565e6ec0a28bc6a', payloadHints: ['processwire-3.0.259'], setupPath: 'install.php', completionFiles: ['site/config.php'], cleanupPaths: ['install.php', 'site/install'],
    adminPath: 'processwire/', adminLabel: 'Admin'
  },
  {
    id: 'mybb', name: 'MyBB', category: 'community', version: '1.8.41', license: 'LGPL-3.0-or-later',
    description: 'A mature, extensible discussion-board platform.', website: 'https://mybb.com/', setup: 'browser', database: true,
    php: php('8.1', '8.3', ['mysqli'], ['curl', 'gd', 'mbstring', 'openssl', 'zip'], '8.4'),
    downloadUrl: 'https://github.com/mybb/mybb/releases/download/mybb_1841/mybb_1841.zip', expectedSha256: '48cc76e9e1146ea052756575991f43f51a634f125eea06d05ce9041b03eedeaa', payloadHints: ['Upload'], setupPath: 'install/index.php', completionFiles: ['inc/config.php'], cleanupPaths: ['install'],
    siteLabel: 'Forum', adminPath: 'admin/', adminLabel: 'Admin'
  },
  {
    id: 'phpbb', name: 'phpBB', category: 'community', version: '3.3.19', license: 'GPL-2.0-only',
    description: 'A feature-rich forum with a large extension and style ecosystem.', website: 'https://www.phpbb.com/', setup: 'automatic', database: true,
    php: php('8.1', '8.3', ['mysqli'], ['curl', 'fileinfo', 'gd', 'intl', 'mbstring', 'openssl', 'zip'], '8.4'),
    downloadUrl: 'https://download.phpbb.com/pub/release/3.3/3.3.19/phpBB-3.3.19.zip',
    downloadFallbacks: ['https://ftp.phpbb-fr.com/public/downloads/3.3/3.3.19/phpBB-3.3.19.zip'],
    expectedSha256: '1530e5cabf7ecc9ecfaed3fa13da79f9e8a514623beafababc8800b5ce966de9', payloadHints: ['phpBB3'], setupPath: 'install/app.php', completionFiles: ['config.php'], cleanupPaths: ['install'],
    siteLabel: 'Forum', adminPath: 'adm/', adminLabel: 'Admin control panel'
  },
  {
    id: 'mediawiki', name: 'MediaWiki', category: 'collaboration', version: '1.46.2', license: 'GPL-2.0-or-later',
    description: 'The battle-tested wiki engine that powers Wikipedia.', website: 'https://www.mediawiki.org/', setup: 'automatic', database: true,
    php: php('8.3', '8.4', ['fileinfo', 'intl', 'mbstring', 'mysqli'], ['curl', 'gd', 'openssl', 'sodium', 'zip'], '8.5'),
    downloadUrl: 'https://releases.wikimedia.org/mediawiki/1.46/mediawiki-1.46.2.zip', expectedSha256: '4f4a5af4382d2732bfffe83ff891be83d1c76b4f9ea22bb4a1b7191e4fa80d3c', payloadHints: ['mediawiki-1.46.2'], setupPath: 'mw-config/index.php', completionFiles: ['LocalSettings.php'], cleanupPaths: ['mw-config'],
    siteLabel: 'Wiki', adminPath: 'index.php?title=Special:UserLogin', adminLabel: 'Admin login'
  },
  {
    id: 'nextcloud', name: 'Nextcloud', category: 'collaboration', version: '35.0.2', license: 'AGPL-3.0-or-later',
    description: 'Private file sync, calendars, contacts, and team collaboration.', website: 'https://nextcloud.com/', setup: 'automatic', database: true,
    php: php('8.2', '8.4', ['curl', 'fileinfo', 'gd', 'intl', 'mbstring', 'openssl', 'pdo_mysql', 'zip'], ['bz2', 'exif', 'gmp', 'sodium'], '8.4'),
    downloadUrl: 'https://download.nextcloud.com/server/releases/nextcloud-35.0.2.zip', expectedSha256: '2f1dcec6a7cdab70346e80a823ccaaa2001a6085013d9f2ae0a2606fa38c2835', payloadHints: ['nextcloud'], completionFiles: ['config/config.php'],
    siteLabel: 'Files', adminPath: 'login', adminLabel: 'Login'
  },
  {
    id: 'matomo', name: 'Matomo', category: 'analytics', version: '5.14.2', license: 'GPL-3.0-or-later',
    description: 'Privacy-first, self-hosted web analytics with full data ownership.', website: 'https://matomo.org/', setup: 'browser', database: true,
    php: php('8.1', '8.4', ['curl', 'gd', 'mbstring', 'mysqli', 'openssl', 'pdo_mysql'], ['fileinfo', 'intl', 'sodium', 'zip'], '8.4'),
    downloadUrl: 'https://builds.matomo.org/matomo-5.14.2.zip', expectedSha256: 'd6ce9e2083f688741ecdccd9f13ca54761fc47592bd8926f1e2d3bcf45daeffb', payloadHints: ['matomo'], completionFiles: ['config/config.ini.php'],
    siteLabel: 'Analytics'
  },
  {
    id: 'moodle', name: 'Moodle', category: 'learning', version: '5.3.0', license: 'GPL-3.0-or-later',
    description: 'A complete learning-management system for courses and classrooms.', website: 'https://moodle.org/', setup: 'automatic', database: true,
    php: php('8.3', '8.4', ['curl', 'fileinfo', 'gd', 'intl', 'mbstring', 'mysqli', 'openssl', 'sodium', 'zip'], ['opcache'], '8.4'),
    downloadUrl: 'https://packaging.moodle.org/stable503/moodle-5.3.zip', expectedSha256: 'fdb6c705ddf2d9bcc613d2ca8aa2c30dcfda6880ca09df5a054b8ea77c06833a', payloadHints: ['moodle'], webRoot: 'public', setupPath: 'install.php', completionFiles: ['config.php'],
    adminPath: 'login/index.php', adminLabel: 'Admin login'
  },
  {
    id: 'opencart', name: 'OpenCart', category: 'commerce', version: '4.1.0.4', license: 'GPL-3.0-or-later',
    description: 'A lightweight online-store platform with a broad extension market.', website: 'https://www.opencart.com/', setup: 'automatic', database: true,
    php: php('8.1', '8.3', ['curl', 'fileinfo', 'gd', 'mbstring', 'mysqli', 'openssl', 'zip'], ['intl', 'sodium'], '8.4'),
    downloadUrl: 'https://github.com/opencart/opencart/releases/download/4.1.0.4/opencart-4.1.0.4.zip', expectedSha256: 'cdef537f5a0a7e1b4ddbe16f589dd2e80b10150a09bfbe93ce76ef2d5c3218c0', payloadHints: ['upload'], setupPath: 'install/index.php', completionFiles: ['config.php', 'admin/config.php'], cleanupPaths: ['install'],
    siteLabel: 'Store', adminPath: 'admin/', adminLabel: 'Admin'
  },
  {
    id: 'prestashop', name: 'PrestaShop', category: 'commerce', version: '9.2.0', license: 'OSL-3.0',
    description: 'A full-featured open-source ecommerce platform.', website: 'https://www.prestashop-project.org/', setup: 'automatic', database: true,
    php: php('8.1', '8.4', ['curl', 'fileinfo', 'gd', 'intl', 'mbstring', 'mysqli', 'openssl', 'pdo_mysql', 'zip'], ['opcache']),
    downloadUrl: 'https://assets.prestashop3.com/dst/edition/corporate/9.2.0-6.0/prestashop_edition_classic_version_9.2.0-6.0.zip', expectedSha256: '81e1719181c4ebe29d54c7e914bc571f1883dd4cfd216f5b28bd30af5757105f', payloadHints: [], nestedArchive: 'prestashop.zip', setupPath: 'index.php', completionFiles: ['app/config/parameters.php'], cleanupPaths: ['install'],
    siteLabel: 'Store', adminPath: 'admin-dev/', adminLabel: 'Admin'
  },
  {
    id: 'freshrss', name: 'FreshRSS', category: 'collaboration', version: '1.30.4', license: 'AGPL-3.0-or-later',
    description: 'A fast, privacy-friendly feed reader for your own server.', website: 'https://freshrss.org/', setup: 'automatic', database: true,
    php: php('8.1', '8.4', ['curl', 'fileinfo', 'mbstring', 'pdo_mysql'], ['gd', 'intl', 'zip']),
    downloadUrl: 'https://github.com/FreshRSS/FreshRSS/archive/refs/tags/1.30.4.zip', expectedSha256: '1d83a97e828c14d9aed1abb774a6e831f494985cb35fe7569dda62ba9b0de6b3', payloadHints: ['FreshRSS-1.30.4'], webRoot: 'p', setupPath: 'i/index.php', completionFiles: ['data/config.php'],
    siteLabel: 'Reader'
  },
  {
    id: 'piwigo', name: 'Piwigo', category: 'gallery', version: '16.4.0', license: 'GPL-2.0-or-later',
    description: 'A polished photo-gallery manager for personal and professional libraries.', website: 'https://piwigo.org/', setup: 'browser', database: true,
    php: php('8.1', '8.3', ['gd', 'mbstring', 'mysqli'], ['curl', 'exif', 'fileinfo', 'openssl', 'zip'], '8.4'),
    downloadUrl: 'https://piwigo.org/download/dlcounter.php?code=16.4.0', expectedSha256: '72c58a337a1a0639b6ad8dc8f5900a2781fc19091b60ae157eb2ee58c5431c17', payloadHints: ['piwigo'], setupPath: 'install.php', completionFiles: ['local/config/database.inc.php'],
    siteLabel: 'Gallery', adminPath: 'admin.php', adminLabel: 'Admin'
  },
  {
    id: 'gitlist', name: 'GitList', category: 'developer', version: '2.0.0', license: 'BSD-3-Clause',
    description: 'An elegant Git repository browser for local projects — the easy PHP stand-in for a GitHub-style code host.', website: 'https://github.com/klaussilveira/gitlist', setup: 'automatic', account: false, database: false,
    php: php('8.1', '8.4', ['mbstring', 'openssl', 'fileinfo'], ['intl', 'zip']),
    downloadUrl: 'https://github.com/klaussilveira/gitlist/releases/download/2.0.0/gitlist-2.0.0.zip', expectedSha256: '06df38598c7e6f8ceb62e09efc0849960dc8f8e4a8a6f4719624c82e5a21fdf7', payloadHints: [], webRoot: 'public', completionFiles: ['config/config.yml'],
    siteLabel: 'Repositories'
  },
  {
    id: 'privatebin', name: 'PrivateBin', category: 'developer', version: '2.1.0', license: 'Zlib',
    description: 'A minimalist encrypted pastebin. No database and no accounts — share notes locally like Pastebin, privately.', website: 'https://privatebin.info/', setup: 'automatic', account: false, database: false,
    php: php('8.1', '8.4', ['mbstring', 'openssl'], ['gd']),
    downloadUrl: 'https://github.com/PrivateBin/PrivateBin/archive/refs/tags/2.1.0.zip', expectedSha256: '36c4478c35246d68fb6ca1bbdf3d47c0fd08967f72315b89316678914efcdc89', payloadHints: ['PrivateBin-2.1.0'], completionFiles: ['cfg/conf.php'],
    siteLabel: 'Pastes'
  }
]

export function catalogDownloadUrls(app: Pick<InternalPreinstalledApp, 'downloadUrl' | 'downloadFallbacks'>): string[] {
  return [...new Set([app.downloadUrl, ...(app.downloadFallbacks ?? [])].map((url) => url.trim()).filter(Boolean))]
}

export function joinSiteUrl(base: string, path = ''): string {
  const root = base.endsWith('/') ? base : `${base}/`
  if (!path) return root
  return new URL(path.replace(/^\//, ''), root).toString()
}

export function catalogConnectionLinks(
  app: Pick<InternalPreinstalledApp, 'siteLabel' | 'adminPath' | 'adminLabel'> | undefined,
  siteUrl: string,
  extras?: { adminPath?: string; setupUrl?: string }
): Array<{ label: string; url: string }> {
  const site = joinSiteUrl(siteUrl)
  const links: Array<{ label: string; url: string }> = [{ label: app?.siteLabel || 'Website', url: site }]
  const adminPath = extras?.adminPath || app?.adminPath
  if (adminPath) {
    const adminUrl = joinSiteUrl(siteUrl, adminPath)
    if (adminUrl !== site) links.push({ label: app?.adminLabel || 'Admin', url: adminUrl })
  }
  if (extras?.setupUrl && !links.some((item) => item.url === extras.setupUrl)) {
    links.push({ label: 'Setup', url: extras.setupUrl })
  }
  return links
}

export function publicPreinstalledAppCatalog(): PreinstalledAppCatalogItem[] {
  return PREINSTALLED_APP_CATALOG.map(({ downloadUrl: _downloadUrl, downloadFallbacks: _downloadFallbacks, expectedSha256: _expectedSha256, payloadHints: _payloadHints, webRoot: _webRoot, setupPath: _setupPath, completionFiles: _completionFiles, completionDirectories: _completionDirectories, cleanupPaths: _cleanupPaths, nestedArchive: _nestedArchive, siteLabel: _siteLabel, adminPath: _adminPath, adminLabel: _adminLabel, ...item }) => ({
    ...item,
    setupSummary: item.setup === 'automatic'
      ? 'WeebX completes the official installer automatically.'
      : 'WeebX prepares the server, then you finish the app’s own installer in the browser.',
    php: { ...item.php, requiredExtensions: [...item.php.requiredExtensions], recommendedExtensions: [...item.php.recommendedExtensions] }
  }))
}

export function findPreinstalledApp(id: string): InternalPreinstalledApp | undefined {
  return PREINSTALLED_APP_CATALOG.find((item) => item.id === id)
}
