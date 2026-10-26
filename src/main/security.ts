import { randomInt } from 'node:crypto'
import type { PasswordStrength, PublicRuntimeSettings, RuntimeSettings } from '../shared/types'

const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const LOWER = 'abcdefghijkmnopqrstuvwxyz'
const NUMBERS = '23456789'
const SYMBOLS = '!@#$%^&*_-+=?'
const ALL = `${UPPER}${LOWER}${NUMBERS}${SYMBOLS}`

function take(characters: string): string {
  return characters[randomInt(0, characters.length)]
}

export function generateStrongPassword(length = 24): string {
  const size = Math.max(16, Math.min(128, Math.trunc(length)))
  const characters = [take(UPPER), take(LOWER), take(NUMBERS), take(SYMBOLS)]
  while (characters.length < size) characters.push(take(ALL))
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const target = randomInt(0, index + 1)
    ;[characters[index], characters[target]] = [characters[target], characters[index]]
  }
  return characters.join('')
}

export function assertStrongPassword(value: string): string {
  if (/[\u0000-\u001f\u007f]/.test(value)) throw new Error('Password cannot contain control characters.')
  if (value.length < 12) throw new Error('Use at least 12 characters for the MariaDB password.')
  if (value.length > 128) throw new Error('Password is too long.')
  if (!/[a-z]/.test(value) || !/[A-Z]/.test(value) || !/\d/.test(value) || !/[^A-Za-z0-9]/.test(value)) {
    throw new Error('Use uppercase, lowercase, a number, and a symbol in the MariaDB password.')
  }
  return value
}

export function assertPasswordInput(value: string): string {
  if (/[^\u0020-\u007e]/.test(value)) throw new Error('Use printable ASCII characters only for the MariaDB password.')
  if (value.length > 128) throw new Error('Password is too long.')
  return value
}

export function passwordStrength(value: string): PasswordStrength {
  if (!value) return 'empty'
  return value.length >= 12 && /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value) && /[^A-Za-z0-9]/.test(value)
    ? 'strong'
    : 'weak'
}

export function publicRuntimeSettings(settings: RuntimeSettings): PublicRuntimeSettings {
  const { mariadbPassword, ...safe } = settings
  return {
    ...safe,
    mariadbPasswordSet: Boolean(mariadbPassword) && settings.setupComplete,
    mariadbPasswordStrength: passwordStrength(mariadbPassword)
  }
}
