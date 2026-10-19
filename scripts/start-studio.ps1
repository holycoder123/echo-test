param([switch]$Admin, [switch]$Mcp, [switch]$NoMcp, [switch]$NoAdmin)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $projectRoot
try {
    if ($Mcp -and $NoMcp) { throw 'Mcp and NoMcp cannot be used together.' }
    if ($Admin -and $NoAdmin) { throw 'Admin and NoAdmin cannot be used together.' }
    $requestAdmin = -not $NoAdmin
    if (![Environment]::Is64BitOperatingSystem) { throw 'This bundle requires Windows x64.' }
    $electronExe = Join-Path $projectRoot 'node_modules\electron\dist\electron.exe'
    if (!(Test-Path -LiteralPath $electronExe)) { throw 'Electron is missing. Run build_portable.cmd first.' }
    $systemDirectory = [Environment]::GetFolderPath('System')
    $missingRuntime = @('msvcp140.dll','vcruntime140.dll','vcruntime140_1.dll') | Where-Object { !(Test-Path -LiteralPath (Join-Path $systemDirectory $_)) }
    if ($missingRuntime) {
        $installer = Join-Path $projectRoot 'runtime\redist\vc_redist.x64.exe'
        if (!(Test-Path -LiteralPath $installer)) { throw 'Visual C++ runtime is missing. Run build_portable.cmd to include the offline installer.' }
        Write-Host 'Installing the bundled Microsoft Visual C++ runtime...'
        $installProcess = Start-Process -FilePath $installer -ArgumentList '/install','/passive','/norestart' -Verb RunAs -WindowStyle Hidden -Wait -PassThru
        if ($installProcess.ExitCode -notin @(0, 3010, 1638)) { throw "Visual C++ installation failed: $($installProcess.ExitCode)" }
    }
    if ($requestAdmin -or $Mcp) {
        $pythonExe = $env:NYCS_PYTHON
        if (!$pythonExe) {
            $pythonExe = Join-Path $projectRoot 'runtime\python\python.exe'
            if (!(Test-Path -LiteralPath $pythonExe)) {
                $pythonCandidates = @('Python311','Python314','Python313','Python312') | ForEach-Object { Join-Path $env:LOCALAPPDATA "Programs\Python\$_\python.exe" }
                $pythonExe = $pythonCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
                if (!$pythonExe) { $pythonExe = 'python' }
            }
        }
        $launchArguments = @((Join-Path $projectRoot 'app.py'))
        if ($requestAdmin) { $launchArguments += '--admin' } else { $launchArguments += '--no-admin' }
        if ($Mcp) { $launchArguments += '--mcp' }
        if ($NoMcp) { $launchArguments += '--no-mcp' }
        & $pythonExe -X utf8 @launchArguments
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    } else {
        $launchArguments = @($projectRoot, '--no-admin')
        if ($NoMcp) { $launchArguments += '--disable-mcp' }
        & $electronExe @launchArguments
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
