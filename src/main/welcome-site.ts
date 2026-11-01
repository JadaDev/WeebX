import { access, readdir, readFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { RuntimeSettings } from '../shared/types'
import { copyFileBestEffort, ensureDirectory, isBusyFileError, writeTextFile } from './safe-file'

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true } catch { return false }
}

export function isWeebxHomePage(content: string): boolean {
  return content.includes('WEEBX_HOME_PAGE')
    || /<h1>\s*WeebX is running\s*<\/h1>/i.test(content)
    || content.includes('WeebX is ready.')
}

export function isWeebxStylesheet(content: string): boolean {
  return content.includes('WEEBX_HOME_PAGE')
    || content.includes('--weebx-accent')
    || content.includes('radial-gradient(circle at 75% 0,#24154e')
}

export function isWeebxPhpInfo(content: string): boolean {
  return content.includes('WEEBX_PHPINFO_PAGE')
}

function extraRoots(): string[] {
  const roots = [process.cwd()]
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  if (resourcesPath) roots.unshift(resourcesPath)
  return [...new Set(roots)]
}

async function firstExisting(paths: string[]): Promise<string | null> {
  for (const path of paths) {
    if (await exists(path)) return path
  }
  return null
}

export async function welcomeTemplateDir(): Promise<string | null> {
  const files = extraRoots().flatMap((root) => [
    join(root, 'runtime', 'htdocs', 'main-site', 'index.php'),
    join(root, 'resources', 'site', 'index.php'),
    join(root, 'resources', 'runtime', 'htdocs', 'main-site', 'index.php'),
    join(root, 'runtime', 'htdocs', 'index.php'),
    join(root, 'resources', 'runtime', 'htdocs', 'index.php')
  ])
  const match = await firstExisting(files)
  return match ? dirname(match) : null
}

async function logoSource(templateDir: string | null): Promise<string | null> {
  return firstExisting([
    ...extraRoots().flatMap((root) => [
      join(root, 'assets', 'weebx-logo.png'),
      join(root, 'build', 'assets', 'weebx-logo.png'),
      join(root, 'src', 'renderer', 'src', 'assets', 'weebx-logo.png')
    ]),
    templateDir ? join(templateDir, 'assets', 'weebx-logo.png') : ''
  ].filter(Boolean))
}

async function writeManagedFile(file: string, content: string, managed: (current: string) => boolean): Promise<void> {
  if (await exists(file)) {
    const current = await readFile(file, 'utf8')
    if (!managed(current) || current === content) return
  }
  await ensureDirectory(dirname(file))
  try {
    await writeTextFile(file, content)
  } catch (error) {
    if (isBusyFileError(error) && await exists(file)) return
    throw error
  }
}

async function copyManagedText(source: string | null, destination: string, managed: (current: string) => boolean, fallback: string): Promise<void> {
  const content = source && await exists(source) ? await readFile(source, 'utf8') : fallback
  await writeManagedFile(destination, content, managed)
}

export async function mainSiteHasForeignApplication(htdocs: string): Promise<boolean> {
  const index = join(htdocs, 'index.php')
  if (await exists(index)) {
    const content = await readFile(index, 'utf8').catch(() => '')
    if (content && !isWeebxHomePage(content)) return true
  }
  return exists(join(htdocs, 'public', 'index.php'))
}

export async function ensureWelcomeSite(htdocs: string, settings: Pick<RuntimeSettings, 'apachePort' | 'apacheSslPort' | 'mariadbPort' | 'mariadbPassword' | 'activePhpVersion' | 'phpProfile' | 'setupComplete'>): Promise<void> {
  if (await mainSiteHasForeignApplication(htdocs)) return
  const assets = join(htdocs, 'assets')
  await ensureDirectory(htdocs)
  await ensureDirectory(assets)
  const templateDir = await welcomeTemplateDir()
  const logo = await logoSource(templateDir)
  if (logo) await copyFileBestEffort(logo, join(assets, 'weebx-logo.png'))
  await copyManagedText(
    templateDir ? join(templateDir, 'index.php') : null,
    join(htdocs, 'index.php'),
    isWeebxHomePage,
    fallbackHomePage()
  )
  await copyManagedText(
    templateDir ? join(templateDir, 'phpinfo.php') : null,
    join(htdocs, 'phpinfo.php'),
    (content) => isWeebxPhpInfo(content) || content.trim() === '<?php phpinfo();',
    fallbackPhpInfoPage()
  )
  await copyManagedText(
    templateDir ? join(templateDir, 'assets', 'weebx.css') : null,
    join(assets, 'weebx.css'),
    isWeebxStylesheet,
    fallbackStyles()
  )
  try {
    await rm(join(assets, 'weebx-runtime.json'), { force: true })
    await writeTextFile(join(assets, '.weebx-runtime.json'), `${JSON.stringify({
      apachePort: settings.apachePort,
      apacheSslPort: settings.apacheSslPort,
      mariadbPort: settings.mariadbPort,
      phpVersion: settings.activePhpVersion,
      phpProfile: settings.phpProfile,
      passwordSet: Boolean(settings.mariadbPassword) && settings.setupComplete
    }, null, 2)}\n`)
  } catch (error) {
    if (!isBusyFileError(error)) throw error
  }
}

/** Remove WeebX-managed welcome files from a folder without deleting custom application files. */
export async function removeManagedWelcomeFiles(folder: string): Promise<void> {
  await migrateWelcomeFromHtdocsRoot(folder)
}

/** Move leftover WeebX welcome files out of the htdocs root after main-site became DocumentRoot. */
export async function migrateWelcomeFromHtdocsRoot(htdocs: string): Promise<void> {
  const rootIndex = join(htdocs, 'index.php')
  if (await exists(rootIndex)) {
    const content = await readFile(rootIndex, 'utf8').catch(() => '')
    if (isWeebxHomePage(content)) await rm(rootIndex, { force: true }).catch(() => undefined)
  }
  const rootInfo = join(htdocs, 'phpinfo.php')
  if (await exists(rootInfo)) {
    const content = await readFile(rootInfo, 'utf8').catch(() => '')
    if (isWeebxPhpInfo(content) || content.trim() === '<?php phpinfo();') await rm(rootInfo, { force: true }).catch(() => undefined)
  }
  const rootAssets = join(htdocs, 'assets')
  if (await exists(rootAssets)) {
    const stylesheet = join(rootAssets, 'weebx.css')
    if (await exists(stylesheet)) {
      const content = await readFile(stylesheet, 'utf8').catch(() => '')
      if (isWeebxStylesheet(content)) await rm(stylesheet, { force: true }).catch(() => undefined)
    }
    await rm(join(rootAssets, 'weebx-runtime.json'), { force: true }).catch(() => undefined)
    await rm(join(rootAssets, '.weebx-runtime.json'), { force: true }).catch(() => undefined)
    const leftover = await readdir(rootAssets).catch(() => ['keep'])
    if (!leftover.length) await rm(rootAssets, { recursive: true, force: true }).catch(() => undefined)
  }
}

function fallbackHomePage(): string {
  return `<?php
declare(strict_types=1);
// WEEBX_HOME_PAGE
$version = PHP_VERSION;
?><!doctype html><html><head><meta charset="utf-8"><title>WeebX</title></head>
<body><img src="assets/weebx-logo.png" alt="WeebX"><h1>WeebX is running</h1>
<p>Apache + PHP <?= htmlspecialchars($version) ?></p>
<p>Production defaults are active. Replace this page with your website.</p></body></html>
`
}

function fallbackPhpInfoPage(): string {
  return `<?php
declare(strict_types=1);
// WEEBX_PHPINFO_PAGE
http_response_code(404);
exit('Not found.');
`
}

function fallbackStyles(): string {
  return `/* WEEBX_HOME_PAGE */\n:root{--weebx-accent:#7b6ef6;color-scheme:dark;background:#080c17;color:#eef1ff}\n`
}
