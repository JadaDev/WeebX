import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

const TRANSIENT_WINDOWS_FILE_ERRORS = new Set(['EACCES', 'EBUSY', 'EMFILE', 'ENFILE', 'EPERM', 'ETXTBSY', 'UNKNOWN'])

export interface FileRetryEvent {
  attempt: number
  delayMs: number
  error: unknown
}

export interface FileRetryOptions {
  signal?: AbortSignal
  initialDelayMs?: number
  maximumDelayMs?: number
  maximumAttempts?: number
  onRetry?: (event: FileRetryEvent) => void | Promise<void>
}

function cancelled(): Error {
  return Object.assign(new Error('WeebX preparation was cancelled.'), { name: 'AbortError' })
}

function transientWindowsFileError(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false
  return TRANSIENT_WINDOWS_FILE_ERRORS.has(String((error as { code?: unknown }).code).toUpperCase())
}

function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(cancelled())
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, milliseconds)
    function done() {
      signal?.removeEventListener('abort', abort)
      resolve()
    }
    function abort() {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      reject(cancelled())
    }
    signal?.addEventListener('abort', abort, { once: true })
  })
}

/**
 * Windows security products can hold a freshly copied file for a short time.
 * Retry only errors that can represent a temporary lock; configuration and
 * path errors still fail immediately. Unlimited retries remain cancellable.
 */
export async function retryFileOperation<T>(operation: () => Promise<T>, options: FileRetryOptions = {}): Promise<T> {
  const initialDelayMs = Math.max(1, options.initialDelayMs ?? 180)
  const maximumDelayMs = Math.max(initialDelayMs, options.maximumDelayMs ?? 2500)
  const maximumAttempts = options.maximumAttempts ?? Number.POSITIVE_INFINITY
  let attempt = 0
  while (true) {
    if (options.signal?.aborted) throw cancelled()
    try {
      return await operation()
    } catch (error) {
      attempt += 1
      if (!transientWindowsFileError(error) || attempt >= maximumAttempts) throw error
      const delayMs = Math.min(maximumDelayMs, initialDelayMs * (2 ** Math.min(attempt - 1, 5)))
      await options.onRetry?.({ attempt, delayMs, error })
      await wait(delayMs, options.signal)
    }
  }
}

export async function prepareRuntimeDirectories(destinations: readonly string[], options: FileRetryOptions = {}): Promise<void> {
  const directories = [...new Set(destinations.map((destination) => dirname(destination)))]
    .sort((left, right) => left.length - right.length || left.localeCompare(right))

  for (const directory of directories) {
    await retryFileOperation(() => mkdir(directory, { recursive: true }).then(() => undefined), options)
  }
}
