$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$logoPath = Join-Path $repo 'build\assets\weebx-logo.png'
$outDir = Join-Path $repo 'build\installer'
$licensePath = Join-Path $outDir 'license.rtf'

if (-not (Test-Path -LiteralPath $logoPath)) { throw "WeebX logo is missing: $logoPath" }
$logoItem = Get-Item -LiteralPath $logoPath
if ($logoItem.Length -lt 10KB) { throw 'WeebX logo is too small to brand the installer.' }

Add-Type -AssemblyName System.Drawing
$PixelFormat = [System.Drawing.Imaging.PixelFormat]::Format24bppRgb

function New-Color([string]$hex) {
  $value = $hex.TrimStart('#')
  return [System.Drawing.Color]::FromArgb(
    [Convert]::ToInt32($value.Substring(0, 2), 16),
    [Convert]::ToInt32($value.Substring(2, 2), 16),
    [Convert]::ToInt32($value.Substring(4, 2), 16)
  )
}

function New-Bitmap24([int]$width, [int]$height) {
  if ($width -lt 16 -or $height -lt 16) { throw "Invalid bitmap size ${width}x${height}." }
  return New-Object System.Drawing.Bitmap $width, $height, $PixelFormat
}

function New-UiFont([string[]]$families, [single]$size, [System.Drawing.FontStyle]$style) {
  foreach ($family in $families) {
    try { return New-Object System.Drawing.Font $family, $size, $style, ([System.Drawing.GraphicsUnit]::Point) }
    catch { }
  }
  throw "Could not load a UI font. Tried: $($families -join ', ')."
}

function Save-Bmp24([System.Drawing.Bitmap]$bitmap, [string]$path) {
  $directory = Split-Path -Parent $path
  if (-not (Test-Path -LiteralPath $directory)) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
  }
  $temporary = "$path.tmp.bmp"
  try {
    $bitmap.Save($temporary, [System.Drawing.Imaging.ImageFormat]::Bmp)
    Move-Item -LiteralPath $temporary -Destination $path -Force
  } finally {
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue }
  }
  $saved = Get-Item -LiteralPath $path
  if ($saved.Length -lt 1000) { throw "Wrote an empty installer bitmap: $path" }
}

function Add-VerticalGlow([System.Drawing.Graphics]$graphics, [int]$width, [int]$height, [System.Drawing.Color]$from, [System.Drawing.Color]$to) {
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush (
    (New-Object System.Drawing.Point 0, 0),
    (New-Object System.Drawing.Point $width, $height),
    $from,
    $to
  )
  try { $graphics.FillRectangle($brush, 0, 0, $width, $height) }
  finally { $brush.Dispose() }
}

function Assert-Bmp([string]$path, [int]$width, [int]$height) {
  $bytes = [IO.File]::ReadAllBytes($path)
  if ($bytes.Length -lt 54 -or $bytes[0] -ne 0x42 -or $bytes[1] -ne 0x4D) { throw "$path is not a BMP." }
  $actualWidth = [BitConverter]::ToInt32($bytes, 18)
  $actualHeight = [Math]::Abs([BitConverter]::ToInt32($bytes, 22))
  $bpp = [BitConverter]::ToUInt16($bytes, 28)
  if ($actualWidth -ne $width -or $actualHeight -ne $height) { throw "$path must be ${width}x${height}, got ${actualWidth}x${actualHeight}." }
  if ($bpp -ne 24) { throw "$path must be 24-bit, got ${bpp}-bit." }
}

$bg = New-Color '#090d18'
$panel = New-Color '#0d1220'
$accent = New-Color '#7769f7'
$accentSoft = New-Color '#171433'
$text = New-Color '#f3f5fb'
$muted = New-Color '#929db3'
$paper = New-Color '#f4f6fb'
$bannerPaper = New-Color '#eef1f8'
$ink = New-Color '#1b2437'
$inkMuted = New-Color '#5b6578'
$logo = $null
$dialog = $null
$banner = $null
$sidebar = $null
$header = $null
$graphics = @()
$fonts = @()
$brushes = @()

try {
  $logo = [System.Drawing.Image]::FromFile($logoPath)
  if ($logo.Width -lt 64 -or $logo.Height -lt 64) { throw 'WeebX logo is too small to display in the installer.' }

  New-Item -ItemType Directory -Path $outDir -Force | Out-Null

  $dialog = New-Bitmap24 493 312
  $g = [System.Drawing.Graphics]::FromImage($dialog)
  $graphics += $g
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
  $paperBrush = New-Object System.Drawing.SolidBrush $paper
  $sideBrush = New-Object System.Drawing.SolidBrush $panel
  $accentBrush = New-Object System.Drawing.SolidBrush $accent
  $textBrush = New-Object System.Drawing.SolidBrush $text
  $mutedBrush = New-Object System.Drawing.SolidBrush $muted
  $inkBrush = New-Object System.Drawing.SolidBrush $ink
  $inkMutedBrush = New-Object System.Drawing.SolidBrush $inkMuted
  $brushes += $paperBrush
  $brushes += $sideBrush
  $brushes += $accentBrush
  $brushes += $textBrush
  $brushes += $mutedBrush
  $brushes += $inkBrush
  $brushes += $inkMutedBrush
  $g.FillRectangle($paperBrush, 0, 0, 493, 312)
  Add-VerticalGlow $g 164 312 $accentSoft $bg
  $g.FillRectangle($sideBrush, 0, 0, 164, 312)
  $g.FillRectangle($accentBrush, 164, 0, 3, 312)
  $g.DrawImage($logo, 46, 58, 72, 72)
  $titleFont = New-UiFont @('Segoe UI Semibold', 'Segoe UI', 'Arial') 16 ([System.Drawing.FontStyle]::Bold)
  $smallFont = New-UiFont @('Segoe UI', 'Arial') 8 ([System.Drawing.FontStyle]::Regular)
  $fonts += $titleFont
  $fonts += $smallFont
  $titleFormat = New-Object System.Drawing.StringFormat
  $titleFormat.Alignment = [System.Drawing.StringAlignment]::Center
  $g.DrawString('WeebX', $titleFont, $textBrush, (New-Object System.Drawing.RectangleF 8, 140, 148, 32), $titleFormat)
  $g.DrawString("Hosting Stack`nManager", $smallFont, $mutedBrush, (New-Object System.Drawing.RectangleF 10, 176, 144, 40), $titleFormat)
  $g.DrawString('Local Windows setup', $smallFont, $mutedBrush, (New-Object System.Drawing.RectangleF 8, 268, 148, 24), $titleFormat)
  Save-Bmp24 $dialog (Join-Path $outDir 'dialog.bmp')

  $banner = New-Bitmap24 493 58
  $gb = [System.Drawing.Graphics]::FromImage($banner)
  $graphics += $gb
  $gb.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $gb.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $gb.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $gb.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
  $gb.Clear($bannerPaper)
  $gb.FillRectangle($accentBrush, 0, 55, 493, 3)
  $gb.DrawImage($logo, 445, 11, 36, 36)
  Save-Bmp24 $banner (Join-Path $outDir 'banner.bmp')

  $bannerTitle = New-UiFont @('Segoe UI Semibold', 'Segoe UI', 'Arial') 13 ([System.Drawing.FontStyle]::Bold)
  $bannerSmall = New-UiFont @('Segoe UI', 'Arial') 8 ([System.Drawing.FontStyle]::Regular)
  $fonts += $bannerTitle
  $fonts += $bannerSmall
  $leftFormat = New-Object System.Drawing.StringFormat

  $sidebar = New-Bitmap24 164 314
  $gs = [System.Drawing.Graphics]::FromImage($sidebar)
  $graphics += $gs
  $gs.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $gs.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $gs.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $gs.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
  Add-VerticalGlow $gs 164 314 $accentSoft $bg
  $gs.DrawImage($logo, 46, 72, 72, 72)
  $gs.DrawString('WeebX', $titleFont, $textBrush, (New-Object System.Drawing.RectangleF 8, 156, 148, 32), $titleFormat)
  $gs.DrawString("Hosting Stack`nManager", $smallFont, $mutedBrush, (New-Object System.Drawing.RectangleF 10, 192, 144, 40), $titleFormat)
  $gs.DrawString('Next · License · Folder', $smallFont, $mutedBrush, (New-Object System.Drawing.RectangleF 8, 270, 148, 24), $titleFormat)
  Save-Bmp24 $sidebar (Join-Path $outDir 'sidebar.bmp')

  $header = New-Bitmap24 150 57
  $gh = [System.Drawing.Graphics]::FromImage($header)
  $graphics += $gh
  $gh.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $gh.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $gh.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $gh.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
  $gh.Clear($bannerPaper)
  $gh.DrawImage($logo, 10, 10, 36, 36)
  $gh.DrawString('WeebX', $bannerTitle, $inkBrush, 52, 8, $leftFormat)
  $gh.DrawString('Setup', $bannerSmall, $inkMutedBrush, 52, 32, $leftFormat)
  Save-Bmp24 $header (Join-Path $outDir 'header.bmp')
} finally {
  foreach ($item in $graphics) { if ($item) { $item.Dispose() } }
  foreach ($item in $fonts) { if ($item) { $item.Dispose() } }
  foreach ($item in $brushes) { if ($item) { $item.Dispose() } }
  if ($dialog) { $dialog.Dispose() }
  if ($banner) { $banner.Dispose() }
  if ($sidebar) { $sidebar.Dispose() }
  if ($header) { $header.Dispose() }
  if ($logo) { $logo.Dispose() }
}

Assert-Bmp (Join-Path $outDir 'dialog.bmp') 493 312
Assert-Bmp (Join-Path $outDir 'banner.bmp') 493 58
Assert-Bmp (Join-Path $outDir 'sidebar.bmp') 164 314
Assert-Bmp (Join-Path $outDir 'header.bmp') 150 57

$rtf = @'
{\rtf1\ansi\ansicpg1252\deff0{\fonttbl{\f0\fswiss\fcharset0 Segoe UI;}}
\viewkind4\uc1\pard\sa120\f0\fs22
{\b WeebX License, Terms, and Privacy}\par
Please read this page before installing. Choose {\b I accept} to continue, or {\b I do not accept} to cancel setup.\par
{\b 1. MIT License}\par
Copyright (c) 2026 JadaDev\par
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\par
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\par
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.\par
{\b 2. Terms of Use}\par
By installing or using WeebX you agree to these terms. If you do not agree, choose I do not accept and do not install the software. You are responsible for your projects, databases, passwords, backups, firewall rules, port exposure, hosts-file changes, and lawful use. Do not use WeebX to host or distribute unlawful, harmful, infringing, or unauthorized material, or to interfere with systems you do not own or have permission to test.\par
{\b 3. Privacy}\par
WeebX keeps project files, configuration, credentials, and database content on this Windows device. It does not intentionally upload that content to JadaDev. Component downloads and documentation links may contact third-party providers, whose own terms then apply.\par
{\b 4. Third-party software}\par
Apache HTTP Server, PHP, MariaDB, phpMyAdmin, Windows, and other named products belong to their respective owners and remain under their own licenses. WeebX is independent from Apache Friends and the XAMPP project.\par
}
'@
$utf8 = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($licensePath, $rtf.Trim() + "`r`n", $utf8)
$licenseText = Get-Content -LiteralPath $licensePath -Raw
if ($licenseText -notmatch '^[\s]*\{\\rtf1') { throw 'Generated license is not RTF.' }
if ($licenseText -notmatch 'MIT License') { throw 'Generated license is missing the MIT License.' }
if ($licenseText -notmatch 'Terms of Use') { throw 'Generated license is missing the Terms of Use.' }
if ($licenseText -notmatch 'Privacy') { throw 'Generated license is missing the Privacy section.' }

Write-Host "WeebX installer UI assets ready in $outDir" -ForegroundColor Green
