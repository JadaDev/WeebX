import { describe, expect, it } from 'vitest'
import { describeProcessExit } from './process-manager'

describe('process exit classification', () => {
  it('treats an intentional forced stop as information even with exit code 1', () => {
    expect(describeProcessExit('Apache', 1, true, 'shutdown signal')).toEqual({
      level: 'info',
      state: 'stopped',
      log: 'Apache stopped.'
    })
  })

  it('keeps diagnostic output for a genuine crash', () => {
    const result = describeProcessExit('MySQL', 1, false, 'InnoDB: unable to open data file')
    expect(result.level).toBe('error')
    expect(result.state).toBe('error')
    expect(result.message).toContain('exit code 1')
    expect(result.message).toContain('InnoDB: unable to open data file')
  })

  it('reports unexpected exits without an OS exit code', () => {
    const result = describeProcessExit('Apache', null, false)
    expect(result.message).toBe('Apache stopped unexpectedly without an exit code.')
  })
})
