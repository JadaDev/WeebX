import { describe, expect, it } from 'vitest'
import { applyApacheModules, applyPhpExtensions, applyPhpLimits, parseApacheModules, parsePhpExtensions } from './runtime-tune'

describe('runtime tune', () => {
  it('toggles PHP extensions without touching unrelated lines', () => {
    const ini = 'extension=curl\r\n;extension=gd\r\n; END WEEBX MANAGED SETTINGS\r\n'
    const next = applyPhpExtensions(ini, { curl: false, gd: true, zip: true })
    expect(next).toContain(';extension=curl')
    expect(next).toMatch(/^extension=gd$/m)
    expect(next).toContain('extension=zip')
  })

  it('parses available PHP modules from DLL names', () => {
    const modules = parsePhpExtensions(';extension=curl\nextension=mysqli', ['php_curl.dll', 'php_mysqli.dll', 'php_dl_test.dll'])
    expect(modules.find((item) => item.id === 'curl')?.enabled).toBe(false)
    expect(modules.find((item) => item.id === 'mysqli')?.enabled).toBe(true)
    expect(modules.some((item) => item.id === 'dl_test')).toBe(false)
  })

  it('updates upload limits and Apache modules', () => {
    const limits = applyPhpLimits('post_max_size=8M\n', { memory_limit: '1G', post_max_size: '512M', upload_max_filesize: '512M', max_file_uploads: '40', max_execution_time: '180', max_input_time: '180', max_input_vars: '5000' })
    expect(limits).toContain('post_max_size=512M')
    expect(limits).toContain('upload_max_filesize=512M')
    const apache = 'LoadModule alias_module modules/mod_alias.so\n#LoadModule deflate_module modules/mod_deflate.so\n'
    const modules = parseApacheModules(apache, ['mod_alias.so', 'mod_deflate.so', 'mod_rewrite.so'])
    expect(modules.find((item) => item.id === 'alias')?.required).toBe(true)
    expect(modules.find((item) => item.id === 'deflate')?.enabled).toBe(false)
    const next = applyApacheModules(apache, { deflate: true, rewrite: true, alias: false })
    expect(next).toContain('LoadModule deflate_module modules/mod_deflate.so')
    expect(next).toContain('LoadModule rewrite_module modules/mod_rewrite.so')
    expect(next).toMatch(/^LoadModule alias_module /m)
  })

  it('rejects invalid upload limits', () => {
    expect(() => applyPhpLimits('', {
      memory_limit: 'lots',
      post_max_size: '512M',
      upload_max_filesize: '512M',
      max_file_uploads: '40',
      max_execution_time: '180',
      max_input_time: '180',
      max_input_vars: '5000'
    })).toThrow(/memory_limit/)
  })
})
