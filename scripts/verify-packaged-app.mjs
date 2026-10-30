import asar from '@electron/asar'

const archive = process.argv[2]
if (!archive) throw new Error('Pass the packaged app.asar path.')

const required = [
  'package.json',
  'out/main/index.js',
  'out/preload/index.js',
  'out/renderer/index.html'
]
const separator = String.fromCharCode(92)
const entries = new Set(asar.listPackage(archive).map((entry) => entry.replace(/^[/\\]/, '').replaceAll(separator, '/')))
for (const file of required) {
  if (!entries.has(file)) throw new Error(`Packaged application is missing ${file}.`)
}

const read = (file) => asar.extractFile(archive, file.replaceAll('/', separator)).toString('utf8')
const metadata = JSON.parse(read('package.json'))
const rendererHtml = read('out/renderer/index.html')
const preload = read('out/preload/index.js')
if (!metadata.version || typeof metadata.version !== 'string') throw new Error('Packaged version metadata is invalid.')
if (!rendererHtml.includes('<div id="root"></div>')) throw new Error('Packaged renderer entry is invalid.')
if (!preload.includes('exposeInMainWorld') || !preload.includes('weebx')) throw new Error('Packaged preload bridge is invalid.')
console.log(`Verified packaged WeebX ${metadata.version}: main, preload, and renderer are present.`)
