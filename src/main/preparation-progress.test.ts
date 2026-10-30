import { describe, expect, it } from 'vitest'
import { copySpeed, databaseRemainingSeconds, estimateRemainingSeconds, formatDuration, smoothRemainingSeconds } from './preparation-progress'

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

  it('does not add a fake multi-minute database wait onto a finished copy', () => {
    expect(estimateRemainingSeconds({
      startedAt: 0,
      now: 9_000,
      completedBytes: 782_000_000,
      totalBytes: 782_000_000,
      completedFiles: 6285,
      totalFiles: 6285
    })).toBe(0)
  })

  it('keeps a copy ETA close to the measured throughput instead of padding 150 seconds', () => {
    const remaining = estimateRemainingSeconds({
      startedAt: 0,
      now: 8_000,
      completedBytes: 400_000_000,
      totalBytes: 800_000_000,
      completedFiles: 3000,
      totalFiles: 6000
    })
    expect(remaining).toBeGreaterThanOrEqual(6)
    expect(remaining).toBeLessThanOrEqual(12)
  })

  it('smooths remaining time so the clock does not jump backward or spike', () => {
    expect(smoothRemainingSeconds(null, 40)).toBe(40)
    expect(smoothRemainingSeconds(40, 12)).toBeGreaterThan(12)
    expect(smoothRemainingSeconds(40, 12)).toBeLessThan(40)
    expect(smoothRemainingSeconds(20, 80)).toBeLessThan(80)
  })

  it('counts down MariaDB setup from a typical duration instead of a fixed 2–3 minutes', () => {
    expect(databaseRemainingSeconds(0)).toBe(50)
    expect(databaseRemainingSeconds(9)).toBeLessThan(50)
    expect(databaseRemainingSeconds(9)).toBeGreaterThan(30)
    expect(databaseRemainingSeconds(9)).toBeLessThan(90)
    expect(databaseRemainingSeconds(180)).toBe(10)
  })
})
