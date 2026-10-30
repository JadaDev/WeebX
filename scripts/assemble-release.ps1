$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$release = Join-Path $repo 'release\WeebX'
$website = Join-Path $release 'Website'
$portable = Join-Path $release 'WeebX'
$unpacked = Join-Path $repo 'dist\win-unpacked'
$package = Get-Content -LiteralPath (Join-Path $repo 'package.json') -Raw | ConvertFrom-Json
$version = [string]$package.version
$msiPath = Join-Path $repo "dist\WeebX-$version-x64.msi"
if (-not (Test-Path -LiteralPath $msiPath)) { throw "The WeebX $version MSI was not produced: $msiPath" }
$msi = Get-Item -LiteralPath $msiPath
$portableExe = Join-Path $unpacked 'WeebX.exe'
if (-not (Test-Path -LiteralPath $portableExe)) { throw 'The portable WeebX build was not produced.' }
if (Test-Path -LiteralPath (Join-Path $unpacked 'WeebX Core.exe')) { throw 'The portable build still contains WeebX Core.exe. Keep a single WeebX.exe.' }
$exe = Get-Item -LiteralPath $portableExe
if ($exe.Length -lt 10MB) { throw 'WeebX.exe is too small to be the Electron application.' }
$releaseFull = [IO.Path]::GetFullPath($release)
if (-not $releaseFull.StartsWith($repo + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe release path.' }
function Remove-TreeWithRetry {
  param([Parameter(Mandatory)][string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) { return }

  for ($attempt = 1; $attempt -le 5; $attempt++) {
    try {
      Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
      return
    } catch {
      if ($attempt -eq 5) { throw }
      Start-Sleep -Milliseconds ($attempt * 250)
    }
  }
}

function Copy-FileIfChanged {
  param(
    [Parameter(Mandatory)][string]$Source,
    [Parameter(Mandatory)][string]$Destination
  )

  if (Test-Path -LiteralPath $Destination) {
    try {
      if ((Get-FileHash -LiteralPath $Source -Algorithm SHA256).Hash -eq
          (Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash) {
        return
      }
    } catch {
      # Let the normal copy retry below report any persistent file issue.
    }
  }

  New-Item -ItemType Directory -Path (Split-Path -Parent $Destination) -Force | Out-Null
  for ($attempt = 1; $attempt -le 5; $attempt++) {
    try {
      Copy-Item -LiteralPath $Source -Destination $Destination -Force -ErrorAction Stop
      return
    } catch {
      if ($attempt -eq 5) { throw }
      Start-Sleep -Milliseconds ($attempt * 250)
    }
  }
}

New-Item -ItemType Directory -Path $releaseFull -Force | Out-Null
Remove-TreeWithRetry -Path $website
Remove-TreeWithRetry -Path $portable
New-Item -ItemType Directory -Path $website -Force | Out-Null
New-Item -ItemType Directory -Path $portable -Force | Out-Null
Get-ChildItem -LiteralPath $unpacked -Force | Copy-Item -Destination $portable -Recurse -Force
Copy-Item -Path (Join-Path $repo 'website\WeebX') -Destination (Join-Path $website 'WeebX') -Recurse -Force
$filesDir = Join-Path $website 'WeebX\Files'
New-Item -ItemType Directory -Path $filesDir -Force | Out-Null
Copy-FileIfChanged -Source $msi.FullName -Destination (Join-Path $filesDir 'WeebX-Installer-x64.msi')
Copy-FileIfChanged -Source $msi.FullName -Destination (Join-Path $release 'WeebX-Installer-x64.msi')
$websiteFiles = Join-Path $repo 'website\WeebX\Files'
New-Item -ItemType Directory -Path $websiteFiles -Force | Out-Null
Copy-FileIfChanged -Source $msi.FullName -Destination (Join-Path $websiteFiles 'WeebX-Installer-x64.msi')
$zip = Join-Path $release 'WeebX.zip'
if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
Push-Location $releaseFull
try {
  & tar.exe -a -cf 'WeebX.zip' 'WeebX'
  if ($LASTEXITCODE -ne 0) { throw "Creating WeebX.zip failed with exit code $LASTEXITCODE." }
} finally {
  Pop-Location
}
Copy-FileIfChanged -Source $zip -Destination (Join-Path $filesDir 'WeebX.zip')
Copy-FileIfChanged -Source $zip -Destination (Join-Path $websiteFiles 'WeebX.zip')
$checksums = @(
  "$(Get-FileHash -LiteralPath $msi.FullName -Algorithm SHA256 | Select-Object -ExpandProperty Hash) *WeebX-Installer-x64.msi",
  "$(Get-FileHash -LiteralPath $zip -Algorithm SHA256 | Select-Object -ExpandProperty Hash) *WeebX.zip"
)
[System.IO.File]::WriteAllLines((Join-Path $release 'SHA256SUMS.txt'), $checksums, [System.Text.UTF8Encoding]::new($false))
Copy-FileIfChanged -Source (Join-Path $repo 'README.md') -Destination (Join-Path $release 'README.md')
Copy-FileIfChanged -Source (Join-Path $repo 'resources\setup_weebx.bat') -Destination (Join-Path $release 'setup_weebx.bat')
Copy-FileIfChanged -Source (Join-Path $repo 'resources\uninstall_weebx.bat') -Destination (Join-Path $release 'Uninstall WeebX.bat')
Write-Host "Release $version assembled at $release" -ForegroundColor Green
Write-Host "Installer: $(Join-Path $release 'WeebX-Installer-x64.msi')" -ForegroundColor Green
Write-Host "Portable folder: $portable" -ForegroundColor Green
Write-Host "Portable zip: $zip" -ForegroundColor Green
Write-Host "Checksums: $(Join-Path $release 'SHA256SUMS.txt')" -ForegroundColor Green
