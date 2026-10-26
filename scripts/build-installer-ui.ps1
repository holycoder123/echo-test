param([string]$Compiler = '', [string]$CCompiler = '')
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$cache = Join-Path $projectRoot '.runtime\installer-build'
$ui = Join-Path $cache 'ui'
New-Item -ItemType Directory -Force -Path $ui | Out-Null
if (!$Compiler) { $Compiler = Join-Path $cache 'nsis-3.13\makensis.exe' }
$modern = Join-Path (Split-Path -Parent $Compiler) 'Contrib\UIs\modern.exe'
if (!(Test-Path -LiteralPath $modern)) { throw 'NSIS modern UI source is missing' }
$cc = $CCompiler
if (!$cc) { $cc = Join-Path $cache 'tinycc\tcc\tcc.exe' }
if (!(Test-Path -LiteralPath $cc)) {
    $archive = Join-Path $cache 'tcc-0.9.27-win32-bin.zip'
    if (!(Test-Path -LiteralPath $archive)) {
        foreach ($url in @('https://download.savannah.gnu.org/releases/tinycc/tcc-0.9.27-win32-bin.zip','https://debian.netcologne.de/savannah/tinycc/tcc-0.9.27-win32-bin.zip')) {
            & curl.exe --fail --location --connect-timeout 10 --max-time 120 --silent --show-error --output ($archive+'.partial') $url
            if ($LASTEXITCODE -eq 0) { break }
        }
        if ($LASTEXITCODE -ne 0) { throw 'TinyCC compiler download failed' }
        Move-Item -LiteralPath ($archive+'.partial') -Destination $archive
    }
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne '02e2bfe8c272a549b15e4bfa4507bd7e05304692af1761db6c1e8e88af675651') { throw 'TinyCC compiler checksum mismatch' }
    Expand-Archive -LiteralPath $archive -DestinationPath (Join-Path $cache 'tinycc') -Force
}
& $cc -shared -Wall -Werror (Join-Path $PSScriptRoot 'installer-ui\native.c') (Join-Path $PSScriptRoot 'installer-ui\comctl32.def') -o (Join-Path $ui 'echo-setup-ui.dll') -lgdi32 -luser32 -lkernel32
if ($LASTEXITCODE -ne 0) { throw 'Native installer UI compilation failed' }
& (Join-Path $projectRoot 'runtime\python\python.exe') -X utf8 (Join-Path $PSScriptRoot 'installer-ui\resources.py') $modern (Join-Path $ui 'echo-setup-ui.exe')
if ($LASTEXITCODE -ne 0) { throw 'Installer dialog generation failed' }
Write-Output ('Installer UI ready: '+$ui)
