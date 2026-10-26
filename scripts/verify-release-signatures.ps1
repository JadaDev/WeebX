param(
  [string]$UnpackedDirectory,
  [string]$MsiPath
)

$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $UnpackedDirectory) { $UnpackedDirectory = Join-Path $repo 'dist\win-unpacked' }
if (-not $MsiPath) {
  $msi = Get-ChildItem -LiteralPath (Join-Path $repo 'dist') -Filter 'WeebX-*-x64.msi' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $msi) { throw 'No WeebX MSI was found for signature verification.' }
  $MsiPath = $msi.FullName
}

$targets = @(
  (Join-Path $UnpackedDirectory 'WeebX.exe'),
  $MsiPath
)
$thumbprint = $null
foreach ($target in $targets) {
  if (-not (Test-Path -LiteralPath $target)) { throw "Signed release file is missing: $target" }
  $signature = Get-AuthenticodeSignature -LiteralPath $target
  if ($signature.Status -ne 'Valid' -or -not $signature.SignerCertificate) {
    throw "Production release is not validly Authenticode-signed: $target ($($signature.Status))"
  }
  if (-not $thumbprint) { $thumbprint = $signature.SignerCertificate.Thumbprint }
  elseif ($signature.SignerCertificate.Thumbprint -ne $thumbprint) { throw "Release signer mismatch: $target" }
  Write-Host "Valid signature: $target" -ForegroundColor Green
}
