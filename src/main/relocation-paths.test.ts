import { describe, expect, it } from 'vitest'
import { isInside, pathsChanged, rebasePath, replacePath, samePath } from './relocation-paths'

describe('relocation path helpers', () => {
  it('detects copied portable trees and rebases nested document roots', () => {
    const oldRoot = 'G:\\WeebX\\old\\data\\runtime'
    const newRoot = 'D:\\Portable\\WeebX\\data\\runtime'
    const oldHtdocs = `${oldRoot}\\htdocs`
    const newHtdocs = `${newRoot}\\htdocs`
    expect(samePath(oldRoot, oldRoot)).toBe(true)
    expect(isInside(oldHtdocs, `${oldHtdocs}\\moved-site`)).toBe(true)
    expect(rebasePath(`${oldHtdocs}\\moved-site`, oldHtdocs, newHtdocs)).toBe(`${newHtdocs}\\moved-site`)
    expect(rebasePath('C:\\unrelated\\site', oldHtdocs, newHtdocs)).toBe('C:\\unrelated\\site')
  })

  it('rewrites Apache and MariaDB absolute paths in generated configs', () => {
    const oldRoot = 'G:\\WeebX\\build\\v11-relocation-old\\data\\runtime'
    const newRoot = 'G:\\WeebX\\build\\v11-relocation-new\\data\\runtime'
    const apache = `ServerRoot "${oldRoot.replace(/\\/g, '/')}/apache"\nDocumentRoot "${oldRoot.replace(/\\/g, '/')}/htdocs"`
    const updated = replacePath(apache, oldRoot, newRoot)
    expect(updated).toContain(newRoot.replace(/\\/g, '/'))
    expect(updated).not.toContain(oldRoot.replace(/\\/g, '/'))
  })

  it('does not treat an MSI upgrade with the same AppData runtime as a folder move', () => {
    const runtime = 'C:\\Users\\JadaDev\\AppData\\Roaming\\weebx\\runtime'
    expect(pathsChanged(runtime, runtime, `${runtime}\\htdocs`, `${runtime}\\htdocs`)).toBe(false)
  })
})
