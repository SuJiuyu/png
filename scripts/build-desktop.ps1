$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$artifact = "ScreenshotTemplateEditor-$($manifest.version)-portable.exe"
$buildOutput = Join-Path $env:TEMP "weisuoyuwei-desktop-build-$($manifest.version)"
$releaseDir = Join-Path $projectRoot 'release'
$builder = Join-Path $projectRoot 'node_modules\.bin\electron-builder.cmd'

if (-not $env:ELECTRON_MIRROR) {
  $env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
}

& $builder --win portable "-c.directories.output=$buildOutput"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$source = Join-Path $buildOutput $artifact
if (-not (Test-Path -LiteralPath $source)) { throw "Packaged file missing: $source" }
New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null
$destination = Join-Path $releaseDir $artifact
Copy-Item -LiteralPath $source -Destination $destination -Force
Write-Host "Desktop build ready: $destination"
