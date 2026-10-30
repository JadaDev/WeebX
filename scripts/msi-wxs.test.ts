import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { SCOPE_UI_PATTERN, patchMsiWxs, xmlAttr } = require('./msi-wxs.cjs') as {
  SCOPE_UI_PATTERN: RegExp
  patchMsiWxs: (xml: string, assets: { banner: string; dialog: string; license: string }) => string
  xmlAttr: (value: string) => string
}

const assistedUi = `<UI>
        <Publish Dialog="WelcomeDlg" Control="Next" Event="SpawnWaitDialog" Value="WaitForCostingDlg" Order="2">1 OR CostingComplete = 1</Publish>
        <Publish Dialog="WelcomeDlg" Control="Next" Event="NewDialog" Value="InstallScopeDlg" Order="2">NOT Installed</Publish>
        <Publish Dialog="InstallScopeDlg" Control="Back" Event="NewDialog" Value="WelcomeDlg" Order="1">1</Publish>
        <Publish Dialog="InstallScopeDlg" Control="Next" Event="NewDialog" Value="InstallDirDlg" Order="7">WixAppFolder = "WixPerMachineFolder"</Publish>
        <Publish Dialog="InstallDirDlg" Control="Back" Event="NewDialog" Value="InstallScopeDlg" Order="2">1</Publish>
        <Publish Dialog="InstallDirDlg" Control="Next" Event="NewDialog" Value="VerifyReadyDlg" Order="2">1</Publish>
        <Publish Dialog="VerifyReadyDlg" Control="Back" Event="NewDialog" Value="InstallScopeDlg" Order="2">NOT Installed</Publish>
      </UI>`

function sampleProject(extra = '') {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Wix xmlns="http://wixtoolset.org/schemas/v4/wxs">
  <Product Id="*" Name="WeebX" UpgradeCode="AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE" Version="2.2.15" Language="1033" Codepage="65001" Manufacturer="JadaDev">
    <Package Compressed="yes" InstallerVersion="500"/>
    <Condition Message="Windows 7 and above is required"><![CDATA[Installed OR VersionNT >= 601]]></Condition>
    <Property Id="WIXUI_INSTALLDIR" Value="APPLICATIONFOLDER"/>
    <Property Id="ALLUSERS" Secure="yes" Value="2"/>
    <Property Id="MSIINSTALLPERUSER" Secure="yes" Value="1"/>
    <UIRef Id="WixUI_InstallDir"/>
    ${assistedUi}
    <Directory Id="TARGETDIR" Name="SourceDir">
      <Directory Id="ProgramFiles64Folder">
        <Directory Id="APPLICATIONFOLDER" Name="WeebX"/>
      </Directory>
    </Directory>
    ${extra}
  </Product>
</Wix>`
}

describe('MSI wizard patch', () => {
  const assets = {
    banner: 'C:\\WeebX\\build\\installer\\banner.bmp',
    dialog: 'C:\\WeebX\\build\\installer\\dialog.bmp',
    license: 'C:\\WeebX\\build\\installer\\license.rtf'
  }

  it('recognizes electron-builder’s assisted UI block', () => {
    expect(SCOPE_UI_PATTERN.test(sampleProject())).toBe(true)
  })

  it('brands WixUI_InstallDir and removes the scope-only shortcut that skipped license and folder pages', () => {
    const patched = patchMsiWxs(sampleProject(), assets)
    expect(patched).toContain('WixUIBannerBmp')
    expect(patched).toContain('WixUIDialogBmp')
    expect(patched).toContain('WixUILicenseRtf')
    expect(patched).toContain('WixUI_InstallDir')
    expect(patched).toContain('VersionNT64')
    expect(patched).toContain('ALLUSERS" Secure="yes" Value="1"')
    expect(patched).not.toContain('InstallScopeDlg')
    expect(patched).not.toContain('MSIINSTALLPERUSER')
    expect(patched).not.toContain('LicenseAgreementDlg')
    expect(patched).toContain(xmlAttr(assets.banner))
  })

  it('refuses to patch an empty or one-click project', () => {
    expect(() => patchMsiWxs('', assets)).toThrow(/empty/)
    expect(() => patchMsiWxs(sampleProject().replace(assistedUi, ''), assets)).toThrow(/assisted-install UI block/)
    expect(() => patchMsiWxs(sampleProject(), { banner: '', dialog: assets.dialog, license: assets.license })).toThrow(/required/)
  })
})
