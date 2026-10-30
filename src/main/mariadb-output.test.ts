import { describe, expect, it } from 'vitest'
import { isHarmlessMariaDbLine, mariadbFailureOutput, mariadbProgressDetail } from './mariadb-output'

const macWarning = '2026-10-29 5:46:09 0 [Warning] failed to retrieve the MAC address'

describe('MariaDB setup output', () => {
  it('treats the Windows MAC-address warning as harmless', () => {
    expect(isHarmlessMariaDbLine(macWarning)).toBe(true)
    expect(isHarmlessMariaDbLine('InnoDB: Unable to open file')).toBe(false)
  })

  it('never shows the MAC-address warning as installer progress', () => {
    expect(mariadbProgressDetail(macWarning)).toBeNull()
    expect(mariadbProgressDetail(`${macWarning}\nCreating system tables`)).toBe('Creating system tables')
    expect(mariadbProgressDetail(`${macWarning}\n2026-10-29 5:46:09 0 [Note] InnoDB: loading`)).toBeNull()
  })

  it('keeps real setup failures after stripping the MAC-address warning', () => {
    expect(mariadbFailureOutput(`${macWarning}\n[ERROR] Can't create directory`, 1)).toBe("[ERROR] Can't create directory")
    expect(mariadbFailureOutput(macWarning, 1)).toBe('exit 1')
  })
})
