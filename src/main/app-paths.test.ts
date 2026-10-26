import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { bundledFile, directoryFromModuleUrl, outFile, preloadScript, rendererIndex } from './app-paths'

describe('packaged application paths', () => {
  it('resolves preload and renderer from the Electron app path instead of __dirname', () => {
    const packaged = 'C:\\Users\\JadaDev\\AppData\\Local\\Programs\\WeebX\\resources\\app.asar'
    const unpacked = 'G:\\WeebX\\dist\\win-unpacked\\resources\\app.asar'
    const development = 'G:\\WeebX'

    expect(preloadScript(packaged)).toBe(join(packaged, 'out', 'preload', 'index.js'))
    expect(rendererIndex(packaged)).toBe(join(packaged, 'out', 'renderer', 'index.html'))
    expect(preloadScript(unpacked)).toBe(join(unpacked, 'out', 'preload', 'index.js'))
    expect(rendererIndex(development)).toBe(join(development, 'out', 'renderer', 'index.html'))
    expect(outFile(packaged, 'preload', 'index.js')).toBe(preloadScript(packaged))
  })

  it('derives bundled neighbors from import.meta.url for ESM asar and unpacked builds', () => {
    const packagedMain = pathToFileURL('C:/Users/JadaDev/AppData/Local/Programs/WeebX/resources/app.asar/out/main/index.js').href
    const unpackedMain = pathToFileURL('G:/WeebX/dist/win-unpacked/resources/app.asar/out/main/index.js').href

    expect(directoryFromModuleUrl(packagedMain).replace(/\//g, '\\')).toContain(join('app.asar', 'out', 'main'))
    expect(bundledFile(packagedMain, '../preload/index.js').replace(/\//g, '\\')).toContain(join('out', 'preload', 'index.js'))
    expect(bundledFile(unpackedMain, '../renderer/index.html').replace(/\//g, '\\')).toContain(join('out', 'renderer', 'index.html'))
  })
})
