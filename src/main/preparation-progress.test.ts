import { describe, expect, it } from 'vitest'
import { copySpeed, estimateRemainingSeconds, formatDuration } from './preparation-progress'

describe('preparation progress estimates', () => {
  it('waits for a measurable sample before inventing an ETA', () => {
    expect(estimateRemainingSeconds({
      startedAt: 0, now: 1000, completedBytes: 10, totalBytes: 1000, completedFiles: 1, totalFiles: 100
    })).toBeNull()
  })

  it('uses both file and byte progress so tiny PHP files do not claim a one-minute finish', () => {
    const remaining = estimateRemainingSeconds({
      startedAt: 0,
      now: 30_000,
      completedBytes: 80_000_000,
      totalBytes: 400_000_000,
      completedFiles: 400,
      totalFiles: 8000
    })
    expect(remaining).toBeGreaterThan(60)
    expect(copySpeed(0, 10_000, 50_000_000)).toBe(5_000_000)
    expect(formatDuration(75)).toBe('1m 15s')
  })
})
