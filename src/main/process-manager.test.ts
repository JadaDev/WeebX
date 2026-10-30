import { describe, expect, it } from 'vitest'
import { classifyServiceOutput, describeProcessExit } from './process-manager'

describe('process exit classification', () => {
  it('treats an intentional forced stop as information even with exit code 1', () => {
    expect(describeProcessExit('Apache', 1, true, 'shutdown signal')).toEqual({
      level: 'info',
      state: 'stopped',
      log: 'Apache stopped.'
    })
  })

  it('keeps diagnostic output for a genuine crash', () => {
    const result = describeProcessExit('MariaDB', 1, false, 'InnoDB: unable to open data file')
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

describe('service output classification', () => {
  it('does not treat the Windows MariaDB MAC-address warning as a failure', () => {
    expect(classifyServiceOutput('2026-10-26 3:29:44 0 [Warning] failed to retrieve the MAC address')).toBe('info')
    expect(classifyServiceOutput('2026-10-26 3:29:44 0 [Warning] table cache is full')).toBe('warn')
  })

  it('recognizes MariaDB errors and informational startup notes', () => {
    expect(classifyServiceOutput('2026-10-26 3:29:44 0 [ERROR] InnoDB: Unable to open file')).toBe('error')
    expect(classifyServiceOutput('2026-10-26 3:29:44 0 [Note] Server socket created')).toBe('info')
  })

  it('uses the highest explicit severity in a multi-line process chunk', () => {
    expect(classifyServiceOutput('[Note] Starting MariaDB\n[Warning] Optional feature unavailable')).toBe('warn')
    expect(classifyServiceOutput('[Warning] Retrying\n[ERROR] Startup aborted')).toBe('error')
  })

  it('classifies shutdown output as informational', () => {
    expect(classifyServiceOutput('[ERROR] forced shutdown', true)).toBe('info')
  })
})
