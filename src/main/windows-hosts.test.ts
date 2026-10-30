import { describe, expect, it } from 'vitest'
import { stripWeebxHostBlocks } from './windows-hosts'

describe('Windows hosts cleanup', () => {
  it('removes every WeebX-managed host block and leaves unrelated entries', () => {
    const current = [
      '127.0.0.1 localhost',
      '',
      '# BEGIN WEEBX HOST 11111111-1111-4111-8111-111111111111',
      '127.0.0.1 phpbb.example.test',
      '# END WEEBX HOST 11111111-1111-4111-8111-111111111111',
      '# Contoso custom host',
      '10.0.0.8 intranet.contoso.test',
      '# BEGIN WEEBX HOST 22222222-2222-4222-8222-222222222222',
      '127.0.0.1 gitlist.example.test privatebin.example.test',
      '# END WEEBX HOST 22222222-2222-4222-8222-222222222222',
      ''
    ].join('\r\n')
    const next = stripWeebxHostBlocks(current)
    expect(next).toContain('127.0.0.1 localhost')
    expect(next).toContain('intranet.contoso.test')
    expect(next).not.toMatch(/BEGIN WEEBX HOST/)
    expect(next).not.toContain('phpbb.example.test')
    expect(next).not.toContain('gitlist.example.test')
  })

  it('is a no-op when WeebX never wrote a hosts block', () => {
    const current = '127.0.0.1 localhost\r\n'
    expect(stripWeebxHostBlocks(current)).toBe(current)
  })
})
