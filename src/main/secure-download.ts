import { createHash } from 'node:crypto'
import { open, rm } from 'node:fs/promises'
import { request } from 'node:https'
import type { IncomingMessage } from 'node:http'
import { rootCertificates } from 'node:tls'
import * as tls from 'node:tls'

export interface TrustedDownloadProgress {
  receivedBytes: number
  totalBytes: number
}

interface TrustedRequestOptions {
  url: string
  allowedHosts: ReadonlySet<string>
  maximumBytes: number
  headers?: Record<string, string>
  maximumRedirects?: number
  idleTimeoutMs?: number
  onProgress?: (progress: TrustedDownloadProgress) => void
}

interface TrustedDownloadOptions extends TrustedRequestOptions {
  destination: string
}

export interface TrustedDownloadResult {
  sha256: string
  receivedBytes: number
  totalBytes: number
  finalUrl: string
}

const REDIRECTS = new Set([301, 302, 303, 307, 308])
const getSystemCertificates = (tls as typeof tls & { getCACertificates?: (type: 'system') => string[] }).getCACertificates
const TRUSTED_CERTIFICATES = getSystemCertificates
  ? [...new Set([...rootCertificates, ...getSystemCertificates('system')])]
  : undefined

export function assertTrustedDownloadUrl(value: URL, allowedHosts: ReadonlySet<string>): void {
  if (value.protocol !== 'https:' || value.username || value.password || value.port && value.port !== '443' || !allowedHosts.has(value.hostname.toLowerCase())) {
    throw new Error(`Download redirected to an untrusted host: ${value.hostname || 'unknown'}`)
  }
}

function contentLength(response: IncomingMessage, maximumBytes: number): number {
  const raw = response.headers['content-length']
  if (Array.isArray(raw)) throw new Error('The download returned conflicting Content-Length headers.')
  if (raw === undefined) return 0
  if (!/^\d+$/.test(raw)) throw new Error('The download returned an invalid Content-Length header.')
  const size = Number(raw)
  if (!Number.isSafeInteger(size) || size > maximumBytes) throw new Error('The download is unexpectedly large.')
  return size
}

function get(url: URL, headers: Record<string, string>, idleTimeoutMs: number): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const outgoing = request(url, {
      method: 'GET', agent: false, ...(TRUSTED_CERTIFICATES ? { ca: TRUSTED_CERTIFICATES } : {}),
      headers: { Accept: 'application/octet-stream,*/*;q=0.8', 'Accept-Encoding': 'identity', Connection: 'close', ...headers }
    })
    outgoing.once('response', resolve)
    outgoing.once('error', reject)
    outgoing.setTimeout(idleTimeoutMs, () => outgoing.destroy(new Error('The download timed out while waiting for data.')))
    outgoing.end()
  })
}

async function writeFully(file: Awaited<ReturnType<typeof open>>, value: Uint8Array): Promise<void> {
  let offset = 0
  while (offset < value.byteLength) {
    const { bytesWritten } = await file.write(value, offset, value.byteLength - offset)
    if (bytesWritten <= 0) throw new Error('Could not write the downloaded archive to disk.')
    offset += bytesWritten
  }
}

async function openTrustedResponse(options: TrustedRequestOptions): Promise<{ response: IncomingMessage; current: URL; totalBytes: number }> {
  const maximumRedirects = options.maximumRedirects ?? 6
  const idleTimeoutMs = options.idleTimeoutMs ?? 30_000
  let current = new URL(options.url)
  let response: IncomingMessage | undefined

  for (let redirects = 0; redirects <= maximumRedirects; redirects += 1) {
    assertTrustedDownloadUrl(current, options.allowedHosts)
    response = await get(current, options.headers ?? {}, idleTimeoutMs)
    const status = response.statusCode ?? 0
    if (!REDIRECTS.has(status)) break
    const location = response.headers.location
    response.resume()
    if (!location) throw new Error('The download returned an invalid redirect.')
    if (redirects === maximumRedirects) throw new Error('The download returned too many redirects.')
    current = new URL(location, current)
  }

  if (!response || response.statusCode !== 200) {
    response?.resume()
    throw new Error(`Download failed: HTTP ${response?.statusCode ?? 'unknown'}.`)
  }
  const totalBytes = contentLength(response, options.maximumBytes)
  response.setTimeout(idleTimeoutMs, () => response?.destroy(new Error('The download timed out while receiving data.')))
  return { response, current, totalBytes }
}

export async function readTrustedHttps(options: TrustedRequestOptions): Promise<Buffer> {
  const { response, totalBytes } = await openTrustedResponse(options)
  const parts: Buffer[] = []
  let receivedBytes = 0
  try {
    for await (const part of response) {
      const value = Buffer.isBuffer(part) ? part : Buffer.from(part)
      receivedBytes += value.byteLength
      if (receivedBytes > options.maximumBytes) throw new Error('The download exceeded its safe size limit.')
      parts.push(value)
      options.onProgress?.({ receivedBytes, totalBytes })
    }
    if (!response.complete) throw new Error('The download ended before the complete response was received.')
  } catch (error) {
    response.destroy()
    throw error
  }
  if (totalBytes && receivedBytes !== totalBytes) throw new Error('The download size did not match the server response.')
  return Buffer.concat(parts, receivedBytes)
}

export async function downloadTrustedHttps(options: TrustedDownloadOptions): Promise<TrustedDownloadResult> {
  const { response, current, totalBytes } = await openTrustedResponse(options)
  const file = await open(options.destination, 'w')
  const hash = createHash('sha256')
  let receivedBytes = 0
  try {
    for await (const part of response) {
      const value = Buffer.isBuffer(part) ? part : Buffer.from(part)
      receivedBytes += value.byteLength
      if (receivedBytes > options.maximumBytes) throw new Error('The download exceeded its safe size limit.')
      await writeFully(file, value)
      hash.update(value)
      options.onProgress?.({ receivedBytes, totalBytes })
    }
    if (!response.complete) throw new Error('The download ended before the complete response was received.')
  } catch (error) {
    response.destroy()
    await file.close().catch(() => undefined)
    await rm(options.destination, { force: true }).catch(() => undefined)
    throw error
  }
  await file.close()
  if (!receivedBytes) {
    await rm(options.destination, { force: true }).catch(() => undefined)
    throw new Error('The downloaded archive is empty.')
  }
  if (totalBytes && receivedBytes !== totalBytes) {
    await rm(options.destination, { force: true }).catch(() => undefined)
    throw new Error('The download size did not match the server response.')
  }
  return { sha256: hash.digest('hex'), receivedBytes, totalBytes, finalUrl: current.toString() }
}
