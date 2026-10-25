import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PhpLimits, RuntimeModule, RuntimeTune, RuntimeTuneSave, RuntimeSettings } from '../shared/types'
import { runtimePaths } from './paths'

export type { PhpLimits, RuntimeModule, RuntimeTune, RuntimeTuneSave }

const HIDDEN_PHP = new Set(['dl_test', 'zend_test'])
const HIDDEN_APACHE = new Set([
  'bucketeer', 'dumpio', 'echo', 'example_hooks', 'example_ipc', 'dialup',
  'optional_fn_export', 'optional_fn_import', 'optional_hook_export', 'optional_hook_import',
  'case_filter', 'case_filter_in', 'asis', 'cern_meta', 'imagemap'
])
const REQUIRED_APACHE = new Set(['alias', 'authz_core', 'cgi', 'dir', 'mime', 'log_config'])
const ZEND_EXTENSIONS = new Set(['opcache'])
export const PHP_LIMIT_KEYS = ['memory_limit', 'post_max_size', 'upload_max_filesize', 'max_file_uploads', 'max_execution_time', 'max_input_time', 'max_input_vars'] as const
const DEFAULT_LIMITS: PhpLimits = {
  memory_limit: '512M',
  post_max_size: '128M',
  upload_max_filesize: '128M',
  max_file_uploads: '20',
  max_execution_time: '120',
  max_input_time: '60',
  max_input_vars: '1000'
}

export function phpExtensionId(file: string): string {
  return file.replace(/^php_/i, '').replace(/\.dll$/i, '').toLowerCase()
}

export function apacheModuleId(file: string): string {
  return file.replace(/^mod_/i, '').replace(/\.so$/i, '').toLowerCase()
}

function iniValue(content: string, key: string, fallback: string): string {
  const matches = [...content.matchAll(new RegExp(`^\\s*${key}\\s*=\\s*(.+)$`, 'gmi'))]
  const live = matches.filter((match) => !/^\s*;/.test(match[0])).at(-1)
  return live?.[1]?.trim().replace(/^["']|["']$/g, '') || fallback
}

export function parsePhpLimits(content: string): PhpLimits {
  return {
    memory_limit: iniValue(content, 'memory_limit', DEFAULT_LIMITS.memory_limit),
    post_max_size: iniValue(content, 'post_max_size', DEFAULT_LIMITS.post_max_size),
    upload_max_filesize: iniValue(content, 'upload_max_filesize', DEFAULT_LIMITS.upload_max_filesize),
    max_file_uploads: iniValue(content, 'max_file_uploads', DEFAULT_LIMITS.max_file_uploads),
    max_execution_time: iniValue(content, 'max_execution_time', DEFAULT_LIMITS.max_execution_time),
    max_input_time: iniValue(content, 'max_input_time', DEFAULT_LIMITS.max_input_time),
    max_input_vars: iniValue(content, 'max_input_vars', DEFAULT_LIMITS.max_input_vars)
  }
}

export function parsePhpExtensions(content: string, files: string[]): RuntimeModule[] {
  const available = [...new Set(files.map(phpExtensionId).filter((id) => id && !HIDDEN_PHP.has(id)))]
  return available.sort().map((id) => {
    const zend = ZEND_EXTENSIONS.has(id)
    const key = zend ? 'zend_extension' : 'extension'
    const pattern = new RegExp(`^\\s*(;\\s*)?${key}\\s*=\\s*(?:php_)?${id}(?:\\.dll)?\\s*$`, 'gmi')
    const hits = [...content.matchAll(pattern)]
    const enabled = hits.some((hit) => !hit[1])
    return { id, label: id, file: `php_${id}.dll`, enabled, required: false, kind: zend ? 'zend' : 'php' }
  })
}

export function parseApacheModules(content: string, files: string[]): RuntimeModule[] {
  const available = [...new Set(files.map(apacheModuleId).filter((id) => id && !HIDDEN_APACHE.has(id)))]
  return available.sort().map((id) => {
    const pattern = new RegExp(`^\\s*(#\\s*)?LoadModule\\s+${id}_module\\s+modules/mod_${id}\\.so\\s*$`, 'gmi')
    const hits = [...content.matchAll(pattern)]
    const required = REQUIRED_APACHE.has(id)
    const enabled = required || hits.some((hit) => !hit[1])
    return {
      id,
      label: id.replace(/_/g, ' '),
      file: `mod_${id}.so`,
      enabled,
      required,
      kind: 'apache'
    }
  })
}

export function applyPhpExtensions(content: string, enabled: Record<string, boolean>): string {
  let next = content
  for (const [id, on] of Object.entries(enabled)) {
    if (!/^[a-z0-9_]+$/i.test(id) || HIDDEN_PHP.has(id.toLowerCase())) continue
    const zend = ZEND_EXTENSIONS.has(id.toLowerCase())
    const key = zend ? 'zend_extension' : 'extension'
    const pattern = new RegExp(`^(\\s*;\\s*)?(${key}\\s*=\\s*(?:php_)?${id}(?:\\.dll)?)\\s*$`, 'gmi')
    const replaced = next.replace(pattern, on ? '$2' : ';$2')
    if (replaced !== next) {
      next = replaced
      continue
    }
    if (!on) continue
    const line = `${key}=${id}`
    if (next.includes('; END WEEBX MANAGED SETTINGS')) next = next.replace('; END WEEBX MANAGED SETTINGS', `${line}\r\n; END WEEBX MANAGED SETTINGS`)
    else next = `${next.trimEnd()}\r\n${line}\r\n`
  }
  return next
}

export function applyPhpLimits(content: string, limits: PhpLimits): string {
  let next = content
  for (const key of PHP_LIMIT_KEYS) {
    const value = String(limits[key] ?? '').trim()
    if (!value) continue
    if (['memory_limit', 'post_max_size', 'upload_max_filesize'].includes(key) && !/^-1$|^\d+[KMG]?$/i.test(value)) {
      throw new Error(`${key} must look like 128M or 512K.`)
    }
    if (['max_file_uploads', 'max_execution_time', 'max_input_time', 'max_input_vars'].includes(key) && !/^\d+$/.test(value)) {
      throw new Error(`${key} must be a whole number.`)
    }
    const pattern = new RegExp(`^\\s*${key}\\s*=.*$`, 'gmi')
    const replaced = next.replace(pattern, `${key}=${value}`)
    next = replaced !== next ? replaced : `${next.trimEnd()}\r\n${key}=${value}\r\n`
  }
  return next
}

export function applyApacheModules(content: string, enabled: Record<string, boolean>): string {
  let next = content
  for (const [id, on] of Object.entries(enabled)) {
    if (!/^[a-z0-9_]+$/i.test(id) || HIDDEN_APACHE.has(id.toLowerCase())) continue
    if (!on && REQUIRED_APACHE.has(id.toLowerCase())) continue
    const line = `LoadModule ${id}_module modules/mod_${id}.so`
    const pattern = new RegExp(`^(\\s*#\\s*)?LoadModule\\s+${id}_module\\s+modules/mod_${id}\\.so\\s*$`, 'gmi')
    const replaced = next.replace(pattern, on ? line : `#${line}`)
    if (replaced !== next) {
      next = replaced
      continue
    }
    if (!on) continue
    const matches = [...next.matchAll(/^LoadModule .+$/gm)]
    const last = matches.at(-1)?.[0]
    next = last ? next.replace(last, `${last}\r\n${line}`) : `${line}\r\n${next}`
  }
  return next
}

export async function loadRuntimeTune(settings: RuntimeSettings): Promise<RuntimeTune> {
  const paths = runtimePaths(settings)
  const phpIni = await readFile(paths.phpIni, 'utf8').catch(() => '')
  const apacheConf = await readFile(paths.apacheConf, 'utf8').catch(() => '')
  const phpFiles = await readdir(join(paths.activePhp, 'ext')).catch(() => [] as string[])
  const apacheFiles = await readdir(join(paths.apache, 'modules')).catch(() => [] as string[])
  return {
    phpExtensions: parsePhpExtensions(phpIni, phpFiles.filter((file) => /\.dll$/i.test(file))),
    apacheModules: parseApacheModules(apacheConf, apacheFiles.filter((file) => /\.so$/i.test(file))),
    phpLimits: parsePhpLimits(phpIni)
  }
}

export function assertRuntimeTuneSave(value: unknown): RuntimeTuneSave {
  if (!value || typeof value !== 'object') throw new Error('Invalid module configuration.')
  const item = value as Record<string, unknown>
  if (!item.phpExtensions || typeof item.phpExtensions !== 'object' || !item.apacheModules || typeof item.apacheModules !== 'object' || !item.phpLimits || typeof item.phpLimits !== 'object') {
    throw new Error('Invalid module configuration.')
  }
  const booleans = (input: object): Record<string, boolean> => Object.fromEntries(
    Object.entries(input as Record<string, unknown>).filter(([key, enabled]) => /^[a-z0-9_]+$/i.test(key) && typeof enabled === 'boolean')
  ) as Record<string, boolean>
  const limits = item.phpLimits as Record<string, unknown>
  for (const key of PHP_LIMIT_KEYS) {
    if (typeof limits[key] !== 'string') throw new Error(`${key} is required.`)
  }
  return {
    phpExtensions: booleans(item.phpExtensions),
    apacheModules: booleans(item.apacheModules),
    phpLimits: {
      memory_limit: String(limits.memory_limit),
      post_max_size: String(limits.post_max_size),
      upload_max_filesize: String(limits.upload_max_filesize),
      max_file_uploads: String(limits.max_file_uploads),
      max_execution_time: String(limits.max_execution_time),
      max_input_time: String(limits.max_input_time),
      max_input_vars: String(limits.max_input_vars)
    }
  }
}
