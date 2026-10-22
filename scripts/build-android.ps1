$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json

if (-not $env:JAVA_HOME) {
  $env:JAVA_HOME = Join-Path $env:LOCALAPPDATA 'weisuoyuwei-build-tools\jdk-21'
}
if (-not $env:ANDROID_HOME) {
  $env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
}
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:Path = (Join-Path $env:JAVA_HOME 'bin') + ';' + $env:Path

if (-not (Test-Path -LiteralPath (Join-Path $env:JAVA_HOME 'bin\java.exe'))) {
  throw "JDK 21 missing: $env:JAVA_HOME"
}
if (-not (Test-Path -LiteralPath (Join-Path $env:ANDROID_HOME 'platforms\android-36'))) {
  throw "Android SDK 36 missing: $env:ANDROID_HOME"
}

Push-Location $projectRoot
try {
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  & npx.cmd cap sync android
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  Push-Location (Join-Path $projectRoot 'android')
  try {
    & .\gradlew.bat assembleDebug
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  } finally {
    Pop-Location
  }
  $source = Join-Path $projectRoot 'android\app\build\outputs\apk\debug\app-debug.apk'
  if (-not (Test-Path -LiteralPath $source)) { throw "APK missing: $source" }
  $release = Join-Path $projectRoot 'release'
  New-Item -ItemType Directory -Force -Path $release | Out-Null
  $destination = Join-Path $release "ScreenshotTemplateEditor-$($manifest.version)-android.apk"
  Copy-Item -LiteralPath $source -Destination $destination -Force
  Write-Host "Android APK ready: $destination"
} finally {
  Pop-Location
}
