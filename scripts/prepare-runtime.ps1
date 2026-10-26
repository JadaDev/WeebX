param([switch]$Force)

$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$appVersion = (Get-Content -LiteralPath (Join-Path $repo 'package.json') -Raw | ConvertFrom-Json).version
$runtime = Join-Path $repo 'resources\runtime'
$downloads = Join-Path $repo 'build\downloads'
$stagingRoot = Join-Path $repo 'build\runtime-staging'

function Assert-UnderRepo([string]$Path) {
    $full = [IO.Path]::GetFullPath($Path)
    if (-not $full.StartsWith($repo + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Unsafe path outside repository: $full"
    }
    return $full
}

function Reset-Directory([string]$Path) {
    $full = Assert-UnderRepo $Path
    if (Test-Path -LiteralPath $full) { Remove-Item -LiteralPath $full -Recurse -Force }
    New-Item -ItemType Directory -Path $full -Force | Out-Null
}

function Get-VerifiedArchive($Package) {
    $archive = Join-Path $downloads $Package.File
    if (-not (Test-Path -LiteralPath $archive)) {
        Write-Host "Downloading $($Package.Name) $($Package.Version)..." -ForegroundColor Cyan
        $headers = @{ 'User-Agent' = "Mozilla/5.0 WeebX/$appVersion" }
        if ($Package.Name -eq 'apache') { $headers['Referer'] = 'https://www.apachelounge.com/download/' }
        Invoke-WebRequest -UseBasicParsing -Uri $Package.Url -Headers $headers -OutFile $archive
    }
    $actual = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $Package.Sha256) {
        [IO.File]::Delete($archive)
        throw "Checksum mismatch for $($Package.File). Expected $($Package.Sha256), got $actual."
    }
    Write-Host "Verified $($Package.File)" -ForegroundColor Green
    return $archive
}

function Expand-Package($Package, [string]$Destination, [string]$Marker) {
    if ((Test-Path -LiteralPath (Join-Path $Destination $Marker)) -and -not $Force) {
        Write-Host "Using prepared $($Package.Name) $($Package.Version)"
        return
    }
    $archive = Get-VerifiedArchive $Package
    $staging = Join-Path $stagingRoot "$($Package.Name)-$($Package.Version)"
    Reset-Directory $staging
    Expand-Archive -LiteralPath $archive -DestinationPath $staging -Force
    $source = $staging
    if (-not (Test-Path -LiteralPath (Join-Path $source $Marker))) {
        $source = Get-ChildItem -LiteralPath $staging -Directory | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName $Marker) } | Select-Object -First 1 -ExpandProperty FullName
    }
    if (-not $source) { throw "Archive $($Package.File) does not contain $Marker." }
    Reset-Directory $Destination
    Copy-Item -Path (Join-Path $source '*') -Destination $Destination -Recurse -Force
}

$packages = @(
    [pscustomobject]@{ Name='php'; Version='8.2.35'; File='php-8.2.35-nts-Win32-vs16-x64.zip'; Url='https://downloads.php.net/~windows/releases/php-8.2.35-nts-Win32-vs16-x64.zip'; Sha256='798ffa4b9ce22a820d57048e9695df7245bf917ed067917f256942a10918a8cc' },
    [pscustomobject]@{ Name='php'; Version='8.3.36'; File='php-8.3.36-nts-Win32-vs16-x64.zip'; Url='https://downloads.php.net/~windows/releases/php-8.3.36-nts-Win32-vs16-x64.zip'; Sha256='3c9242622c7402b47c38d2ec2ed779cef3a290fd6f2bde6c35f9c482699e7900' },
    [pscustomobject]@{ Name='php'; Version='8.4.27'; File='php-8.4.27-nts-Win32-vs17-x64.zip'; Url='https://downloads.php.net/~windows/releases/php-8.4.27-nts-Win32-vs17-x64.zip'; Sha256='93bd8a815a52156606fb906d0573437908c61f96e2cc52c03a51e36a41bf5236' },
    [pscustomobject]@{ Name='php'; Version='8.5.12'; File='php-8.5.12-nts-Win32-vs17-x64.zip'; Url='https://downloads.php.net/~windows/releases/php-8.5.12-nts-Win32-vs17-x64.zip'; Sha256='2ab242af38d76bdf417cde5ec048b1bcd76a5a40f39a3d15d5f046f38571c477' },
    [pscustomobject]@{ Name='apache'; Version='2.4.69'; File='httpd-2.4.69-261002-Win64-VS18.zip'; Url='https://www.apachelounge.com/download/VS18/binaries/httpd-2.4.69-261002-Win64-VS18.zip'; Sha256='9f1f93cab9a0c6dc5e628aa640784bb30347f93fcd01b46a4c0d6b5ba76bf4e2' },
    [pscustomobject]@{ Name='mariadb'; Version='12.3.3'; File='mariadb-12.3.3-winx64.zip'; Url='https://mirror.mariadb.org/mariadb-12.3.3/winx64-packages/mariadb-12.3.3-winx64.zip'; Sha256='4b5706b47148b47c8f36963c8352d1ddee37a1287b4690428f631a74b09b85a0' },
    [pscustomobject]@{ Name='phpmyadmin'; Version='5.2.3'; File='phpMyAdmin-5.2.3-all-languages.zip'; Url='https://files.phpmyadmin.net/phpMyAdmin/5.2.3/phpMyAdmin-5.2.3-all-languages.zip'; Sha256='2d2e13c735366d318425c78e4ee2cc8fc648d77faba3ddea2cd516e43885733f' }
)

New-Item -ItemType Directory -Path $downloads,$stagingRoot,$runtime -Force | Out-Null
foreach ($package in $packages | Where-Object Name -eq 'php') {
    $destination = Join-Path $runtime "php\$($package.Version)"
    Expand-Package $package $destination 'php.exe'
    Get-ChildItem -LiteralPath (Join-Path $destination 'ext') -Filter 'php_*.dll' | Sort-Object Name | ForEach-Object Name | Set-Content -LiteralPath (Join-Path $destination 'available-extensions.txt') -Encoding utf8
}
Expand-Package ($packages | Where-Object Name -eq 'apache') (Join-Path $runtime 'apache') 'bin\httpd.exe'
Expand-Package ($packages | Where-Object Name -eq 'mariadb') (Join-Path $runtime 'mariadb') 'bin\mariadbd.exe'
Expand-Package ($packages | Where-Object Name -eq 'phpmyadmin') (Join-Path $runtime 'htdocs\phpmyadmin') 'index.php'

$siteSource = Join-Path $repo 'resources\site'
$htdocs = Join-Path $runtime 'htdocs'
Copy-Item -Path (Join-Path $siteSource '*') -Destination $htdocs -Recurse -Force
Copy-Item -LiteralPath (Join-Path $repo 'build\assets\weebx-logo.png') -Destination (Join-Path $htdocs 'assets\weebx-logo.png') -Force

$manifest = [ordered]@{
    version = '2026.10.24.2'
    apache = '2.4.69'
    mariadb = '12.3.3'
    phpMyAdmin = '5.2.3'
    phpVersions = @('8.2.35','8.3.36','8.4.27','8.5.12')
    architecture = 'x64'
}
$manifestJson = $manifest | ConvertTo-Json
[System.IO.File]::WriteAllText((Join-Path $runtime 'bundle-manifest.json'), $manifestJson, [System.Text.UTF8Encoding]::new($false))
Write-Host "Offline runtime prepared at $runtime" -ForegroundColor Green
