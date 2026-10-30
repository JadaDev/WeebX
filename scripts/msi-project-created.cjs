const fs = require('node:fs')
const path = require('node:path')
const { patchMsiWxs, requiredInstallerAssets } = require('./msi-wxs.cjs')

function copyChecked(source, destination) {
  fs.copyFileSync(source, destination)
  const from = fs.statSync(source)
  const to = fs.statSync(destination)
  if (!to.isFile() || to.size !== from.size || to.size < 1) {
    throw new Error(`Failed to stage installer asset: ${path.basename(destination)}`)
  }
}

module.exports = async function msiProjectCreated(projectFile) {
  if (!projectFile || typeof projectFile !== 'string') throw new Error('msiProjectCreated did not receive a WiX project path.')
  if (!fs.existsSync(projectFile)) throw new Error(`WiX project does not exist: ${projectFile}`)

  const repo = path.join(__dirname, '..')
  const source = requiredInstallerAssets(path.join(repo, 'build', 'installer'))
  const stageDir = path.dirname(projectFile)
  const staged = {
    banner: path.join(stageDir, 'weebx-banner.bmp'),
    dialog: path.join(stageDir, 'weebx-dialog.bmp'),
    license: path.join(stageDir, 'weebx-license.rtf')
  }
  copyChecked(source.banner, staged.banner)
  copyChecked(source.dialog, staged.dialog)
  copyChecked(source.license, staged.license)

  const original = fs.readFileSync(projectFile, 'utf8')
  const patched = patchMsiWxs(original, staged)
  if (patched === original) throw new Error('WiX project was not modified; refusing to build an unbranded wizard.')
  fs.writeFileSync(projectFile, patched, 'utf8')
  const written = fs.readFileSync(projectFile, 'utf8')
  if (!written.includes('WixUILicenseRtf') || !written.includes('WixUIBannerBmp') || !written.includes('WixUI_InstallDir') || written.includes('InstallScopeDlg')) {
    throw new Error('Patched WiX project is missing the WeebX wizard branding.')
  }
}
