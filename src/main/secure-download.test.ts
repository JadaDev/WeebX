import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }))
vi.mock('node:https', () => ({ request: requestMock }))

import { assertTrustedDownloadUrl, downloadTrustedHttps } from './secure-download'

const temporary: string[] = []
const responses: Readable[] = []

function response(statusCode: number, body = Buffer.alloc(0), headers: Record<string, string> = {}): Readable {
  const stream = Readable.from(body.length ? [body] : [])
  Object.assign(stream, { statusCode, headers, complete: true, setTimeout: vi.fn() })
  return stream
}

beforeEach(() => {
  responses.length = 0
  requestMock.mockReset()
  requestMock.mockImplementation(() => {
    const outgoing = new EventEmitter() as EventEmitter & { setTimeout: ReturnType<typeof vi.fn>; end: () => void; destroy: (error: Error) => void }
    outgoing.setTimeout = vi.fn()
    outgoing.destroy = (error) => outgoing.emit('error', error)
    outgoing.end = () => queueMicrotask(() => outgoing.emit('response', responses.shift()))
    return outgoing
  })
})

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((folder) => rm(folder, { recursive: true, force: true })))
})

describe('trusted HTTPS downloader', () => {
  it('rejects credentials, custom ports, HTTP, and hosts outside the allowlist', () => {
    const allowed = new Set(['downloads.example.test'])
    expect(() => assertTrustedDownloadUrl(new URL('https://downloads.example.test/file.zip'), allowed)).not.toThrow()
    expect(() => assertTrustedDownloadUrl(new URL('http://downloads.example.test/file.zip'), allowed)).toThrow(/untrusted/i)
    expect(() => assertTrustedDownloadUrl(new URL('https://user@downloads.example.test/file.zip'), allowed)).toThrow(/untrusted/i)
    expect(() => assertTrustedDownloadUrl(new URL('https://downloads.example.test:444/file.zip'), allowed)).toThrow(/untrusted/i)
    expect(() => assertTrustedDownloadUrl(new URL('https://evil.example/file.zip'), allowed)).toThrow(/untrusted/i)
  })

  it('streams a trusted response to disk and hashes the exact bytes', async () => {
    const body = Buffer.from('verified archive bytes')
    responses.push(response(200, body, { 'content-length': String(body.length) }))
    const folder = await mkdtemp(join(tmpdir(), 'weebx-download-'))
    temporary.push(folder)
    const destination = join(folder, 'archive.zip')
    const result = await downloadTrustedHttps({
      url: 'https://downloads.example.test/archive.zip', destination,
      allowedHosts: new Set(['downloads.example.test']), maximumBytes: 1024
    })
    expect(await readFile(destination)).toEqual(body)
    expect(result.sha256).toBe(createHash('sha256').update(body).digest('hex'))
    expect(result.receivedBytes).toBe(body.length)
  })

  it('revalidates redirect destinations before making another request', async () => {
    responses.push(response(302, Buffer.alloc(0), { location: 'https://evil.example/archive.zip' }))
    const folder = await mkdtemp(join(tmpdir(), 'weebx-download-'))
    temporary.push(folder)
    await expect(downloadTrustedHttps({
      url: 'https://downloads.example.test/archive.zip', destination: join(folder, 'archive.zip'),
      allowedHosts: new Set(['downloads.example.test']), maximumBytes: 1024
    })).rejects.toThrow(/untrusted host/i)
    expect(requestMock).toHaveBeenCalledTimes(1)
  })

  it('removes a partial file when the response size is inconsistent', async () => {
    responses.push(response(200, Buffer.from('short'), { 'content-length': '50' }))
    const folder = await mkdtemp(join(tmpdir(), 'weebx-download-'))
    temporary.push(folder)
    const destination = join(folder, 'archive.zip')
    await expect(downloadTrustedHttps({
      url: 'https://downloads.example.test/archive.zip', destination,
      allowedHosts: new Set(['downloads.example.test']), maximumBytes: 1024
    })).rejects.toThrow(/size did not match/i)
    await expect(access(destination)).rejects.toThrow()
  })
})
