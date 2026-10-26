$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$signingSource = @($env:CSC_LINK, $env:WIN_CSC_LINK) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -First 1
if (-not $signingSource) {
  throw 'A trusted Windows code-signing certificate is required for production. Set CSC_LINK (or WIN_CSC_LINK) and CSC_KEY_PASSWORD, then run npm run dist again. Use npm run dist:unsigned only for isolated local testing; never publish it.'
}

Push-Location $repo
try {
  & npm.cmd run dist:unsigned
  if ($LASTEXITCODE -ne 0) { throw "Release build failed with exit code $LASTEXITCODE." }
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'verify-release-signatures.ps1')
  if ($LASTEXITCODE -ne 0) { throw "Signature verification failed with exit code $LASTEXITCODE." }
} finally {
  Pop-Location
}
