import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

const wait = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds))

export async function prepareRuntimeDirectories(destinations: readonly string[]): Promise<void> {
  const directories = [...new Set(destinations.map((destination) => dirname(destination)))]
    .sort((left, right) => left.length - right.length || left.localeCompare(right))

  for (const directory of directories) {
    let lastError: unknown
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await mkdir(directory, { recursive: true })
        lastError = undefined
        break
      } catch (error) {
        lastError = error
        if (attempt < 3) await wait(attempt * 60)
      }
    }
    if (lastError) {
      const detail = lastError instanceof Error ? lastError.message : String(lastError)
      throw new Error(`Could not create runtime folder "${directory}" after 3 attempts: ${detail}`)
    }
  }
}
