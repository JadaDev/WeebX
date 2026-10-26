import { describe, expect, it } from 'vitest'
import { assertMariaDbPassword, clientArgs, isIgnorableMariaDbUserError, mariaDbPasswordError, passwordCandidates, phpSingleQuoted, rootPasswordSql, sqlString } from './mariadb-password'

describe('MariaDB password helpers', () => {
  it('escapes SQL and PHP string literals', () => {
    expect(sqlString("a'b\\c")).toBe("a\\'b\\\\c")
    expect(phpSingleQuoted("O'Reilly")).toBe("O\\'Reilly")
  })

  it('allows empty and weak development passwords but rejects unsafe input', () => {
    expect(() => assertMariaDbPassword('Strong!Password123')).not.toThrow()
    expect(() => assertMariaDbPassword('ok')).not.toThrow()
    expect(() => assertMariaDbPassword('')).not.toThrow()
    expect(() => assertMariaDbPassword(`bad\0`)).toThrow(/printable/i)
    expect(() => assertMariaDbPassword('x'.repeat(129))).toThrow(/too long/)
  })

  it('explains a stopped MariaDB without dumping the client command', () => {
    expect(mariaDbPasswordError('Command failed: mariadb.exe -u root', false)).toBe('Start MariaDB first, then change the password.')
    expect(mariaDbPasswordError("Can't connect to MySQL server on '127.0.0.1'", true)).toBe('Start MariaDB first, then change the password.')
    expect(mariaDbPasswordError("ERROR 1045 (28000): Access denied for user 'root'@'127.0.0.1' (using password: NO)", true)).toMatch(/force-reset/i)
    expect(mariaDbPasswordError("Command failed: mariadb.exe -u root -e ALTER USER 'root'@'%'", true)).toBe('Could not change the MariaDB password.')
    expect(isIgnorableMariaDbUserError("ERROR 1396 (HY000): Operation ALTER USER failed for 'root'@'%'")).toBe(true)
    expect(isIgnorableMariaDbUserError("ERROR 1146 (42S02): Table 'mysql.global_priv' doesn't exist")).toBe(true)
  })

  it('keeps passwords out of MariaDB process arguments', () => {
    const args = clientArgs({ mariadbPort: 3306, mariadbPassword: '' } as never, ['-e', 'SELECT 1'])
    expect(args).toContain('--ssl=0')
    expect(args).toContain('--protocol=tcp')
    expect(args.some((item) => item.includes('password'))).toBe(false)
  })

  it('tries stored, typed, new, and empty passwords without duplicates', () => {
    expect(passwordCandidates('old', 'old', 'next', '')).toEqual(['old', 'next', ''])
  })

  it('writes ALTER USER statements for local root accounts', () => {
    const sql = rootPasswordSql("a'b")
    expect(sql.indexOf('FLUSH PRIVILEGES')).toBeLessThan(sql.indexOf('ALTER USER'))
    expect(sql).toContain("ALTER USER 'root'@'127.0.0.1' IDENTIFIED BY 'a\\'b'")
    expect(sql).not.toContain("ALTER USER 'root'@'%'")
    expect(sql).toContain("DROP USER IF EXISTS ''@'%'")
    expect(sql).toContain('FLUSH PRIVILEGES')
  })
})
