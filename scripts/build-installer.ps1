param([string]$Compiler = '')
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $projectRoot
$cache = Join-Path $projectRoot '.runtime\installer-build'
New-Item -ItemType Directory -Force -Path $cache | Out-Null
if (!(Test-Path -LiteralPath (Join-Path $projectRoot 'runtime\python\python.exe')) -or !(Test-Path -LiteralPath (Join-Path $projectRoot 'runtime\node\node.exe')) -or !(Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules\electron\dist\electron.exe'))) {
    & (Join-Path $PSScriptRoot 'build-portable.ps1') -SkipArchive
    if ($LASTEXITCODE -ne 0) { throw 'Portable build failed' }
}
if (!$Compiler) {
    $Compiler = Join-Path $cache 'nsis-3.13\makensis.exe'
    if (!(Test-Path -LiteralPath $Compiler)) {
        $archive = Join-Path $cache 'nsis-3.13.zip'
        if (!(Test-Path -LiteralPath $archive)) {
            & curl.exe --fail --location --max-time 600 --retry 2 --silent --show-error --output ($archive+'.partial') 'https://downloads.sourceforge.net/project/nsis/NSIS%203/3.13/nsis-3.13.zip'
            if ($LASTEXITCODE -ne 0) { throw 'NSIS download failed' }
            Move-Item -LiteralPath ($archive+'.partial') -Destination $archive -Force
        }
        if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne 'ba63dffc4410ee89193e1cb5a41989991bd77c61068da17e3156d136b7b0b3d8') { throw 'NSIS archive checksum mismatch' }
        Expand-Archive -LiteralPath $archive -DestinationPath $cache -Force
    }
}
if (!(Test-Path -LiteralPath $Compiler)) { throw 'NSIS compiler is missing' }
& (Join-Path $PSScriptRoot 'build-installer-ui.ps1') -Compiler $Compiler
if ($LASTEXITCODE -ne 0) { throw 'Installer UI build failed' }
$python = Join-Path $projectRoot 'runtime\python\python.exe'
& $python -X utf8 (Join-Path $PSScriptRoot 'package-portable.py')
if ($LASTEXITCODE -ne 0) { throw 'Refreshing portable payload failed' }
& $python -X utf8 (Join-Path $PSScriptRoot 'prepare-installer.py')
if ($LASTEXITCODE -ne 0) { throw 'Installer payload preparation failed' }
$version = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
$output = Join-Path $projectRoot "dist\latest\echo-test-$version-setup-x64.exe"
# NSIS cannot read some paths beyond MAX_PATH. Keep the source and payload
# addresses short even when the checkout lives inside a deeply nested folder.
$drive = @('Z:','Y:','X:','W:','V:','U:') | Where-Object { !(Test-Path -LiteralPath ($_+'\')) } | Select-Object -First 1
if (!$drive) { throw 'No temporary build drive is available' }
& subst $drive $projectRoot
if ($LASTEXITCODE -ne 0) { throw 'Could not create a temporary short build path' }
try {
    $shortRoot = $drive+'\.'
    $payload = Join-Path $shortRoot '.runtime\installer-build\payload\echo-test'
    & $Compiler '/V3' '/INPUTCHARSET' 'UTF8' "/DPRODUCT_VERSION=$version" "/DPROJECT_ROOT=$shortRoot" "/DPAYLOAD_ROOT=$payload" "/DOUTPUT_EXE=$output" (Join-Path $shortRoot 'scripts\installer.nsi')
    if ($LASTEXITCODE -ne 0) { throw "NSIS compilation failed: $LASTEXITCODE" }
} finally {
    & subst $drive /D
}
$hash = (Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash.ToLowerInvariant()
($hash+'  '+[IO.Path]::GetFileName($output)) | Set-Content -LiteralPath ($output+'.sha256') -Encoding ASCII
Write-Host "Installer ready: $output"
