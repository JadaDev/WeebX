const fs = require('node:fs')
const path = require('node:path')

const SCOPE_UI_PATTERN = /<UI>\s*<Publish Dialog="WelcomeDlg" Control="Next" Event="SpawnWaitDialog"[\s\S]*?InstallScopeDlg[\s\S]*?<\/UI>/
const BMP_SIZES = {
  banner: { width: 493, height: 58 },
  dialog: { width: 493, height: 312 },
  sidebar: { width: 164, height: 314 },
  header: { width: 150, height: 57 }
}

function assertContains(xml, snippet, label) {
  if (!xml.includes(snippet)) throw new Error(`MSI project is missing ${label}.`)
}

function xmlAttr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function readBmpHeader(file) {
  const buffer = fs.readFileSync(file)
  if (buffer.length < 54 || buffer[0] !== 0x42 || buffer[1] !== 0x4D) {
    throw new Error(`${path.basename(file)} is not a Windows BMP.`)
  }
  return {
    width: buffer.readInt32LE(18),
    height: Math.abs(buffer.readInt32LE(22)),
    bitsPerPixel: buffer.readUInt16LE(28),
    size: buffer.length
  }
}

function assertBmp(file, expected) {
  if (!fs.existsSync(file)) throw new Error(`Installer bitmap is missing: ${file}`)
  const header = readBmpHeader(file)
  if (header.width !== expected.width || header.height !== expected.height) {
    throw new Error(`${path.basename(file)} must be ${expected.width}x${expected.height}, got ${header.width}x${header.height}.`)
  }
  if (header.bitsPerPixel !== 24) {
    throw new Error(`${path.basename(file)} must be a 24-bit BMP (WiX cannot use ${header.bitsPerPixel}-bit images).`)
  }
  if (header.size < 1000) throw new Error(`${path.basename(file)} is too small to be a valid installer bitmap.`)
}

function assertRtf(file) {
  if (!fs.existsSync(file)) throw new Error(`Installer license is missing: ${file}`)
  const text = fs.readFileSync(file, 'utf8')
  if (!text.startsWith('{\\rtf1')) throw new Error('Installer license must be an RTF document.')
  if (!/WeebX/i.test(text)) throw new Error('Installer license does not mention WeebX.')
  if (!/MIT License/i.test(text)) throw new Error('Installer license is missing the MIT License.')
  if (!/I accept|Terms of Use|Privacy/i.test(text)) throw new Error('Installer license is missing the additional WeebX terms.')
  if (text.length < 400) throw new Error('Installer license is too short.')
}

function installerAssetPaths(folder) {
  return {
    banner: path.join(folder, 'banner.bmp'),
    dialog: path.join(folder, 'dialog.bmp'),
    sidebar: path.join(folder, 'sidebar.bmp'),
    header: path.join(folder, 'header.bmp'),
    license: path.join(folder, 'license.rtf')
  }
}

function requiredInstallerAssets(folder) {
  const assets = installerAssetPaths(folder)
  assertBmp(assets.banner, BMP_SIZES.banner)
  assertBmp(assets.dialog, BMP_SIZES.dialog)
  assertBmp(assets.sidebar, BMP_SIZES.sidebar)
  assertBmp(assets.header, BMP_SIZES.header)
  assertRtf(assets.license)
  return assets
}

function weebxUiBlock(assets) {
  return [
    `<WixVariable Id="WixUIBannerBmp" Value="${xmlAttr(assets.banner)}"/>`,
    `<WixVariable Id="WixUIDialogBmp" Value="${xmlAttr(assets.dialog)}"/>`,
    `<WixVariable Id="WixUILicenseRtf" Value="${xmlAttr(assets.license)}"/>`
  ].join('\n    ')
}

function patchMsiWxs(xml, assets) {
  if (typeof xml !== 'string' || !xml.trim()) throw new Error('MSI project XML is empty.')
  assertContains(xml, 'APPLICATIONFOLDER', 'APPLICATIONFOLDER')
  assertContains(xml, 'WixUI_InstallDir', 'WixUI_InstallDir')
  assertContains(xml, '<Product ', 'Product')
  assertContains(xml, 'WIXUI_INSTALLDIR', 'WIXUI_INSTALLDIR')
  if (!assets?.banner || !assets?.dialog || !assets?.license) throw new Error('Installer bitmap and license paths are required.')
  if (!SCOPE_UI_PATTERN.test(xml)) {
    throw new Error('MSI project does not contain electron-builder’s assisted-install UI block. The WiX template may have changed.')
  }

  let next = xml.replace(SCOPE_UI_PATTERN, weebxUiBlock(assets))
  if (next.includes('InstallScopeDlg')) {
    throw new Error('Failed to replace the install-scope dialog sequence.')
  }
  if (next.includes('MSIINSTALLPERUSER')) {
    next = next.replace(/<Property Id="MSIINSTALLPERUSER"[^/]*\/>\s*/g, '')
  }
  if (!/<Property Id="ALLUSERS"[^>]*Value="1"/.test(next)) {
    next = next.replace(/<Property Id="ALLUSERS"[^/]*\/>/, '<Property Id="ALLUSERS" Secure="yes" Value="1"/>')
  }
  if (!next.includes('VersionNT64')) {
    next = next.replace(
      /<Condition Message="Windows 7 and above is required"><!\[CDATA\[Installed OR VersionNT >= 601\]\]><\/Condition>/,
      '<Condition Message="WeebX requires 64-bit Windows 10 or later."><![CDATA[Installed OR (VersionNT64 AND VersionNT >= 603)]]></Condition>'
    )
  }
  if (next.includes('InstallScopeDlg')) throw new Error('Install-scope dialog is still present after patching.')
  assertContains(next, 'WixUIBannerBmp', 'banner bitmap variable')
  assertContains(next, 'WixUIDialogBmp', 'dialog bitmap variable')
  assertContains(next, 'WixUILicenseRtf', 'license RTF variable')
  assertContains(next, 'WixUI_InstallDir', 'WixUI_InstallDir')
  assertContains(next, 'WIXUI_INSTALLDIR', 'WIXUI_INSTALLDIR')
  assertContains(next, 'APPLICATIONFOLDER', 'APPLICATIONFOLDER')
  if (next.includes('LicenseAgreementDlg') || next.includes('WixUIValidatePath')) {
    throw new Error('Custom dialog publishes would duplicate WixUI_InstallDir and break the linker.')
  }
  return next
}

module.exports = {
  BMP_SIZES,
  SCOPE_UI_PATTERN,
  assertBmp,
  assertRtf,
  installerAssetPaths,
  patchMsiWxs,
  readBmpHeader,
  requiredInstallerAssets,
  xmlAttr
}
