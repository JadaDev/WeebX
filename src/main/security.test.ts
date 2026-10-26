import { describe, expect, it } from 'vitest'
import { assertStrongPassword, generateStrongPassword, passwordStrength, publicRuntimeSettings } from './security'
import type { RuntimeSettings } from '../shared/types'

describe('security defaults', () => {
  it('generates passwords that satisfy the enforced policy', () => {
    for (let index = 0; index < 20; index += 1) {
      const password = generateStrongPassword()
      expect(password).toHaveLength(24)
      expect(() => assertStrongPassword(password)).not.toThrow()
    }
  })

  it('rejects incomplete passwords', () => {
    expect(() => assertStrongPassword('alllowercase123!')).toThrow(/uppercase/i)
    expect(() => assertStrongPassword('Short1!')).toThrow(/12/)
  })

  it('never exposes the credential in renderer settings', () => {
    const settings = {
      mariadbPassword: 'Strong!Password123',
      setupComplete: true
    } as RuntimeSettings
    const safe = publicRuntimeSettings(settings)
    expect(safe.mariadbPasswordSet).toBe(true)
    expect(safe.mariadbPasswordStrength).toBe('strong')
    expect(safe).not.toHaveProperty('mariadbPassword')
  })

  it('classifies empty and weak passwords without exposing them', () => {
    expect(passwordStrength('')).toBe('empty')
    expect(passwordStrength('development')).toBe('weak')
    expect(passwordStrength('Strong!Password123')).toBe('strong')
  })
})
