export const MAIN_SITE_FOLDER = 'main-site'
export const PHPMYADMIN_FOLDER = 'phpmyadmin'
export const MAIN_SITE_VHOST_ID = '00000000-0000-4000-8000-000000000001'
export const RESERVED_HTDOCS_NAMES = new Set([MAIN_SITE_FOLDER, PHPMYADMIN_FOLDER])

export function installDateStamp(date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${month}${day}${date.getFullYear()}`
}

export function appFolderSlug(value: string, fallback = 'app'): string {
  const clean = value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '')
  return clean || fallback
}

/** Folder on disk, for example wordpress10312026. The public subdomain stays separate. */
export function datedAppFolder(slug: string, date = new Date(), fallback = 'app'): string {
  return `${appFolderSlug(slug, fallback)}${installDateStamp(date)}`
}

export function nextDatedAppFolder(base: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((name) => name.toLowerCase()))
  if (!used.has(base.toLowerCase()) && !RESERVED_HTDOCS_NAMES.has(base.toLowerCase())) return base
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const candidate = `${base}-${suffix}`
    if (!used.has(candidate.toLowerCase()) && !RESERVED_HTDOCS_NAMES.has(candidate.toLowerCase())) return candidate
  }
  throw new Error('Could not find an available application folder name.')
}

export function isMainSiteHostname(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/\.$/, '')
  return normalized === 'localhost' || normalized === '127.0.0.1'
}

export function isUnderMainSite(documentRoot: string, htdocsRoot: string): boolean {
  const normalize = (value: string) => value.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
  const main = normalize(`${htdocsRoot}\\${MAIN_SITE_FOLDER}`)
  const root = normalize(documentRoot)
  return root === main || root.startsWith(`${main}\\`)
}

export function isIntentionalMainSiteInstall(
  record: { location?: string; domain: string; documentRoot: string; siteId?: string },
  htdocsRoot: string
): boolean {
  if (record.siteId === MAIN_SITE_VHOST_ID) return isUnderMainSite(record.documentRoot, htdocsRoot)
  return record.location === 'default' && isMainSiteHostname(record.domain) && isUnderMainSite(record.documentRoot, htdocsRoot)
}

export function occupiesMainSite(
  record: { status?: string; location?: string; domain: string; documentRoot: string; siteId?: string },
  htdocsRoot: string
): boolean {
  if (record.status === 'removed') return false
  return isIntentionalMainSiteInstall(record, htdocsRoot)
}

export function defaultAppDomain(slug: string, fallback = 'app'): string {
  return `${appFolderSlug(slug, fallback)}.localhost`
}

/** Dashboard Website button. 127.0.0.1 avoids a cached 301 from an old localhost app. */
export function mainSiteUrl(apachePort: number): string {
  return apachePort === 80 ? 'http://127.0.0.1/' : `http://127.0.0.1:${apachePort}/`
}
