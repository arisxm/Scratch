# Builds the Android app: the web UI (../src, through vite.config.mjs) into
# app/src/main/assets/web, then the APK with Gradle.
#
#   powershell -ExecutionPolicy Bypass -File android\build-apk.ps1            # debug APK, for testing
#   powershell -ExecutionPolicy Bypass -File android\build-apk.ps1 -Release   # unsigned release APK
#
# Needs Node.js (npm install already run in the repository root), a JDK 17 and
# the Android SDK. JAVA_HOME and ANDROID_HOME are used when set; otherwise the
# usual per-user locations under %LOCALAPPDATA%\Android are tried.

param([switch]$Release)
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$repo = Split-Path $here -Parent

if (-not $env:JAVA_HOME) {
    $jdk = Get-ChildItem "$env:LOCALAPPDATA\Android" -Directory -Filter 'jdk-17*' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($jdk) { $env:JAVA_HOME = $jdk.FullName } else { throw 'Set JAVA_HOME to a JDK 17.' }
}
if (-not $env:ANDROID_HOME) {
    $sdk = "$env:LOCALAPPDATA\Android\Sdk"
    if (Test-Path $sdk) { $env:ANDROID_HOME = $sdk } else { throw 'Set ANDROID_HOME to the Android SDK.' }
}
if (-not (Test-Path "$here\local.properties")) {
    "sdk.dir=$($env:ANDROID_HOME -replace '\\', '/')" | Out-File -Encoding ascii "$here\local.properties"
}

Write-Host '1/2  Building the web UI...'
Push-Location $repo
try {
    node node_modules/vite/bin/vite.js build --config android/vite.config.mjs
    if ($LASTEXITCODE -ne 0) { throw 'The web build failed.' }
} finally { Pop-Location }

Write-Host '2/2  Building the APK...'
Push-Location $here
try {
    $task = if ($Release) { 'assembleRelease' } else { 'assembleDebug' }
    .\gradlew.bat $task --console=plain
    if ($LASTEXITCODE -ne 0) { throw 'The Gradle build failed.' }
} finally { Pop-Location }

$kind = if ($Release) { 'release\app-release-unsigned.apk' } else { 'debug\app-debug.apk' }
Write-Host "Done: $here\app\build\outputs\apk\$kind"
