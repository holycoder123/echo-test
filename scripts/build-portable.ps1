param([switch]$SkipArchive)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $projectRoot
$cacheRoot = Join-Path $projectRoot '.runtime\portable-build'
$runtimeRoot = Join-Path $projectRoot 'runtime'
New-Item -ItemType Directory -Force -Path $cacheRoot, $runtimeRoot | Out-Null
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Download-Verified($Url, $Destination, $Sha256) {
    if (!(Test-Path -LiteralPath $Destination)) {
        Write-Host "Downloading $Url"
        & curl.exe --fail --location --max-time 600 --retry 2 --silent --show-error --output ($Destination + '.partial') $Url
        if ($LASTEXITCODE -ne 0) { throw "Download failed: $Url" }
        Move-Item -LiteralPath ($Destination + '.partial') -Destination $Destination -Force
    }
    $actual = (Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $Sha256.ToLowerInvariant()) { throw "Checksum mismatch: $Destination" }
}
function Run-Checked($Exe, $Arguments) {
    if ($Exe -like '*python.exe') { $Arguments = @('-X','utf8') + $Arguments }
    & $Exe @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Command failed: $Exe (exit $LASTEXITCODE)" }
}

$pythonVersion = '3.13.16'
$pythonArchive = Join-Path $cacheRoot "python-$pythonVersion-embed-amd64.zip"
$pythonHash = '97dae5274cc54867065e8d5a3226e48c35017ed332a0fdb0e27d5b5821961297'
Download-Verified "https://www.python.org/ftp/python/$pythonVersion/python-$pythonVersion-embed-amd64.zip" $pythonArchive $pythonHash
$pythonRoot = Join-Path $runtimeRoot 'python'
if (!(Test-Path -LiteralPath (Join-Path $pythonRoot 'python.exe'))) {
    Expand-Archive -LiteralPath $pythonArchive -DestinationPath $pythonRoot
}
# Isolated relative paths make the runtime independent of the user's Python and PATH.
@('python313.zip', '.', 'DLLs', 'Lib', 'Lib\site-packages', '..\..', 'import site') | Set-Content -LiteralPath (Join-Path $pythonRoot 'python313._pth') -Encoding ASCII
$pythonExe = Join-Path $pythonRoot 'python.exe'
$tkMsi = Join-Path $cacheRoot 'tcltk.msi'
if (!(Test-Path -LiteralPath $tkMsi)) {
    & curl.exe --fail --location --max-time 600 --silent --show-error --output $tkMsi "https://www.python.org/ftp/python/$pythonVersion/amd64/tcltk.msi"
    if ($LASTEXITCODE -ne 0) { throw 'Tcl/Tk download failed' }
}
$tkSignature = Get-AuthenticodeSignature -LiteralPath $tkMsi
if ($tkSignature.Status -ne 'Valid' -or $tkSignature.SignerCertificate.Subject -notmatch 'Python Software Foundation') { throw 'Invalid Python Tcl/Tk MSI signature' }
Run-Checked $pythonExe @((Join-Path $PSScriptRoot 'vendor-tk.py'))
$sitePackages = Join-Path $pythonRoot 'Lib\site-packages'
$pipBootstrap = Join-Path $cacheRoot 'get-pip.py'
if (!(Test-Path -LiteralPath $pipBootstrap)) {
    Invoke-WebRequest -UseBasicParsing -Uri 'https://bootstrap.pypa.io/get-pip.py' -OutFile $pipBootstrap
}
if (!(Test-Path -LiteralPath (Join-Path $sitePackages 'pip'))) {
    Run-Checked $pythonExe @($pipBootstrap, '--no-warn-script-location')
}
Write-Host 'Installing Python libraries and bundled OCR models into runtime/python...'
Run-Checked $pythonExe @('-m','pip','install','--no-warn-script-location','--disable-pip-version-check','setuptools','wheel')
$requirements = Join-Path $projectRoot 'requirements-portable.lock'
if (!(Test-Path -LiteralPath $requirements)) { $requirements = Join-Path $projectRoot 'requirements.txt' }
Run-Checked $pythonExe @('-m','pip','install','--no-build-isolation','--no-warn-script-location','--disable-pip-version-check','-r',$requirements)
Run-Checked $pythonExe @('-m','pip','check')

$nodeVersion = '24.13.0'
$nodeName = "node-v$nodeVersion-win-x64.zip"
$checksums = (Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/v$nodeVersion/SHASUMS256.txt").Content
$nodeHash = (($checksums -split "`n" | Where-Object { $_.Trim().EndsWith($nodeName) }) -split '\s+')[0]
if (!$nodeHash -or $nodeHash.Length -ne 64) { throw 'Missing official Node checksum' }
$nodeArchive = Join-Path $cacheRoot $nodeName
Download-Verified "https://nodejs.org/dist/v$nodeVersion/$nodeName" $nodeArchive $nodeHash
if (!(Test-Path -LiteralPath (Join-Path $runtimeRoot 'node\node.exe'))) {
    $nodeExtract = Join-Path $cacheRoot "node-v$nodeVersion-win-x64"
    if (!(Test-Path -LiteralPath $nodeExtract)) { Expand-Archive -LiteralPath $nodeArchive -DestinationPath $cacheRoot }
    Copy-Item -LiteralPath $nodeExtract -Destination (Join-Path $runtimeRoot 'node') -Recurse
}
$nodeExe = Join-Path $runtimeRoot 'node\node.exe'
$redistRoot = Join-Path $runtimeRoot 'redist'
New-Item -ItemType Directory -Force -Path $redistRoot | Out-Null
$redistInstaller = Join-Path $redistRoot 'vc_redist.x64.exe'
if (!(Test-Path -LiteralPath $redistInstaller)) {
    Invoke-WebRequest -UseBasicParsing -Uri 'https://aka.ms/vs/17/release/vc_redist.x64.exe' -OutFile $redistInstaller
}
$signature = Get-AuthenticodeSignature -LiteralPath $redistInstaller
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Microsoft Corporation') {
    throw 'Visual C++ installer does not have a valid Microsoft signature'
}
if (!(Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules\electron\dist\electron.exe'))) {
    $originalPath = $env:PATH
    try {
        $env:PATH = (Join-Path $runtimeRoot 'node') + ';' + $env:PATH
        Run-Checked (Join-Path $runtimeRoot 'node\npm.cmd') @('ci','--no-audit','--no-fund')
    } finally { $env:PATH = $originalPath }
}
$env:PYTHONUTF8 = '1'
Run-Checked $pythonExe @((Join-Path $PSScriptRoot 'portable-manifest.py'), '--python-version', $pythonVersion, '--python-sha256', $pythonHash, '--node-version', $nodeVersion, '--node-sha256', $nodeHash)
Run-Checked $nodeExe @((Join-Path $PSScriptRoot 'verify-portable.cjs'))
if (!$SkipArchive) { Run-Checked $pythonExe @((Join-Path $PSScriptRoot 'package-portable.py')) }
Write-Host 'Portable runtime is ready. Start with start.cmd; no system Node/Python is required.'
