$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$release = Join-Path $repo 'release\WeebX'
$website = Join-Path $release 'Website'
$portable = Join-Path $release 'WeebX'
$unpacked = Join-Path $repo 'dist\win-unpacked'
$msi = Get-ChildItem -LiteralPath (Join-Path $repo 'dist') -Filter 'WeebX-*-x64.msi' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $msi) { throw 'The WeebX MSI was not produced.' }
if (-not (Test-Path -LiteralPath (Join-Path $unpacked 'WeebX.exe'))) { throw 'The portable WeebX build was not produced.' }
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
Copy-FileIfChanged -Source (Join-Path $repo 'README.md') -Destination (Join-Path $release 'README.md')
Copy-FileIfChanged -Source (Join-Path $repo 'resources\setup_weebx.bat') -Destination (Join-Path $release 'setup_weebx.bat')
Copy-FileIfChanged -Source (Join-Path $repo 'resources\uninstall_weebx.bat') -Destination (Join-Path $release 'Uninstall WeebX.bat')
Write-Host "Release assembled at $release" -ForegroundColor Green
