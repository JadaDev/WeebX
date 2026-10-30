$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$originalNodeOptions = $env:NODE_OPTIONS

Push-Location $repo
try {
  # Electron Builder downloads signed upstream tooling. On Windows, include the
  # operating-system trust store so managed and locally installed roots work
  # without weakening TLS validation.
  if (($env:NODE_OPTIONS -split '\s+') -notcontains '--use-system-ca') {
    $env:NODE_OPTIONS = (@($env:NODE_OPTIONS, '--use-system-ca') | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }) -join ' '
  }

  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repo 'scripts\prepare-installer-ui.ps1')
  if ($LASTEXITCODE -ne 0) { throw "Installer UI preparation failed with exit code $LASTEXITCODE." }
  & node.exe --input-type=commonjs -e "require('./scripts/msi-wxs.cjs').requiredInstallerAssets(require('path').join('build','installer'))"
  if ($LASTEXITCODE -ne 0) { throw "Installer UI assets failed verification." }

  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw "Application build failed with exit code $LASTEXITCODE." }

  & (Join-Path $repo 'node_modules\.bin\electron-builder.cmd') --win msi --x64
  if ($LASTEXITCODE -ne 0) { throw "Installer build failed with exit code $LASTEXITCODE." }

  & node.exe (Join-Path $PSScriptRoot 'verify-packaged-app.mjs') (Join-Path $repo 'dist\win-unpacked\resources\app.asar')
  if ($LASTEXITCODE -ne 0) { throw "Packaged application verification failed with exit code $LASTEXITCODE." }

  $package = Get-Content -LiteralPath (Join-Path $repo 'package.json') -Raw | ConvertFrom-Json
  $installer = Join-Path $repo "dist\WeebX-$($package.version)-x64.msi"
  if (-not (Test-Path -LiteralPath $installer)) { throw "The versioned MSI was not produced: $installer" }
  $installerHash = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash
  [System.IO.File]::WriteAllText("$installer.sha256", "$installerHash *$(Split-Path -Leaf $installer)`r`n", [System.Text.UTF8Encoding]::new($false))

  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'assemble-release.ps1')
  if ($LASTEXITCODE -ne 0) { throw "Release assembly failed with exit code $LASTEXITCODE." }
} finally {
  $env:NODE_OPTIONS = $originalNodeOptions
  Pop-Location
}
