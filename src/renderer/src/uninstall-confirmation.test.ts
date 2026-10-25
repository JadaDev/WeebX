import { describe, expect, it } from 'vitest'
import { isUninstallConfirmation } from './uninstall-confirmation'

describe('uninstall confirmation', () => {
  it('accepts the requested word regardless of case or harmless spacing', () => {
    expect(isUninstallConfirmation('UNINSTALL')).toBe(true)
    expect(isUninstallConfirmation(' uninstall ')).toBe(true)
    expect(isUninstallConfirmation('UN INSTALL')).toBe(true)
  })

  it('rejects incomplete or unrelated input', () => {
    expect(isUninstallConfirmation('')).toBe(false)
    expect(isUninstallConfirmation('UNINSTAL')).toBe(false)
    expect(isUninstallConfirmation('INSTALL')).toBe(false)
  })
})
