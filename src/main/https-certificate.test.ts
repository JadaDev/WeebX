import { execFile } from 'node:child_process'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { opensslProcessEnv } from './paths'
import { opensslSelfSignedArgs } from './vhost-manager'

const execFileAsync = promisify(execFile)

describe('HTTPS certificate generation', () => {
  const temporary: string[] = []

  afterEach(async () => {
    await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })))
  })

  it('passes the bundled OpenSSL config and a DNS SAN', () => {
    const args = opensslSelfSignedArgs({
      opensslConf: 'C:\\WeebX\\apache\\conf\\openssl.cnf',
      keyOut: 'C:\\WeebX\\certificates\\wordpress\\server.key',
      certOut: 'C:\\WeebX\\certificates\\wordpress\\server.crt',
      serverName: 'wordpress.localhost',
      aliases: ['www.wordpress.localhost']
    })
    expect(args).toContain('-config')
    expect(args[args.indexOf('-config') + 1]).toBe('C:\\WeebX\\apache\\conf\\openssl.cnf')
    expect(args[args.indexOf('-subj') + 1]).toBe('/CN=wordpress.localhost')
    expect(args[args.indexOf('-addext') + 1]).toBe('subjectAltName=DNS:wordpress.localhost,DNS:www.wordpress.localhost')
  })

  it('creates a certificate with the bundled Apache OpenSSL without Apache24', async () => {
    const runtimeRoot = resolve('resources/runtime')
    const openssl = join(runtimeRoot, 'apache', 'bin', 'openssl.exe')
    const opensslConf = join(runtimeRoot, 'apache', 'conf', 'openssl.cnf')
    try {
      await access(openssl)
      await access(opensslConf)
    } catch {
      return
    }

    const folder = await mkdtemp(join(tmpdir(), 'weebx-https-cert-'))
    temporary.push(folder)
    const keyOut = join(folder, 'server.key')
    const certOut = join(folder, 'server.crt')
    const args = opensslSelfSignedArgs({
      opensslConf, keyOut, certOut, serverName: 'wordpress.localhost', aliases: []
    })

    await execFileAsync(openssl, args, {
      windowsHide: true,
      env: opensslProcessEnv(opensslConf, { ...process.env, OPENSSL_CONF: 'C:\\Apache24\\conf\\openssl.cnf' })
    })

    const certificate = await readFile(certOut, 'utf8')
    const key = await readFile(keyOut, 'utf8')
    expect(certificate).toContain('BEGIN CERTIFICATE')
    expect(key).toMatch(/BEGIN (?:RSA )?PRIVATE KEY/)
  })
})
