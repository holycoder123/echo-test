param([ValidatePattern('^[A-Za-z0-9_-]{1,64}$')][string]$TestName = 'install-test')
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $projectRoot
$version = (Get-Content -LiteralPath package.json -Raw | ConvertFrom-Json).version
$installer = Join-Path $projectRoot "dist\latest\echo-test-$version-setup-x64.exe"
$target = [IO.Path]::GetFullPath((Join-Path $projectRoot ('.runtime\installer-build\'+$TestName)))
$expectedPrefix = $projectRoot.TrimEnd('\') + '\.runtime\installer-build\'
if (!$target.StartsWith($expectedPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe installer test path' }
if (Test-Path -LiteralPath $target) { throw 'Installer test directory already exists; preserve it and choose a fresh test path.' }
$testKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\EchoTest-InstallerTest'
if (Test-Path -LiteralPath $testKey) { throw 'Installer test registry key already exists; refusing to overwrite it.' }
$report = @{passed=$false; target=$target; version=$version}
function Install-Fixture {
    $process = Start-Process -FilePath $installer -ArgumentList "/S /TESTINSTALL /NOSHORTCUTS /D=$target" -WindowStyle Hidden -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "Installer test failed: $($process.ExitCode)" }
}
function Run-Checked($exe, $arguments) {
    & $exe @arguments
    if ($LASTEXITCODE -ne 0) { throw "Verification failed: $LASTEXITCODE" }
}
try {
    Install-Fixture
    if (!(Test-Path -LiteralPath (Join-Path $target 'runtime\python\python.exe'))) { throw 'Python was not installed' }
    if (!(Test-Path -LiteralPath (Join-Path $target 'node_modules\electron\dist\electron.exe'))) { throw 'Electron was not installed' }
    $entry = Get-ItemProperty -LiteralPath $testKey
    if ($entry.InstallLocation -ne $target) { throw 'Uninstall registration does not match the test directory' }
    $report.install=$true
    $casePath = Join-Path $target 'test_cases\installer-preservation.echo.json'
    $content = @{name='Installer upgrade preservation probe';schema_version=1;steps=@();selectors=@()}
    [IO.File]::WriteAllText($casePath,($content | ConvertTo-Json -Depth 100),(New-Object Text.UTF8Encoding $false))
    $case = Get-Item -LiteralPath $casePath
    $originalHash=(Get-FileHash -LiteralPath $case.FullName -Algorithm SHA256).Hash
    $asset=Join-Path $target 'test_cases\assets\installer-preservation.txt'
    [IO.File]::WriteAllText($asset,'Preserve this user asset')
    $controls=Join-Path $target 'control_library\controls.json'
    $controlProbe=@{schema_version=1;entries=@();categories=@();installer_probe='Preserve edited control library'}
    [IO.File]::WriteAllText($controls,($controlProbe | ConvertTo-Json -Depth 10),(New-Object Text.UTF8Encoding $false))
    $controlHash=(Get-FileHash -LiteralPath $controls -Algorithm SHA256).Hash
    $controlAsset=Join-Path $target 'control_library\installer-preservation.txt'
    [IO.File]::WriteAllText($controlAsset,'Preserve this user control asset')
    foreach ($folder in @('reports','recordings')) {
        New-Item -ItemType Directory -Force -Path (Join-Path $target $folder) | Out-Null
        [IO.File]::WriteAllText((Join-Path $target "$folder\installer-preservation.txt"),'Preserve this user evidence')
    }
    Install-Fixture
    if ((Get-FileHash -LiteralPath $case.FullName -Algorithm SHA256).Hash -ne $originalHash) { throw 'Upgrade overwrote the edited case' }
    $report.upgradePreservesCases=$true
    if ((Get-FileHash -LiteralPath $controls -Algorithm SHA256).Hash -ne $controlHash) { throw 'Upgrade overwrote the edited control library' }
    $report.upgradePreservesControls=$true
    $originalPath=$env:PATH
    $originalPython=$env:ECHO_TEST_PYTHON
    try {
        $env:PATH="$env:SystemRoot\System32;$env:SystemRoot"
        Remove-Item Env:ECHO_TEST_PYTHON -ErrorAction SilentlyContinue
        Set-Location -LiteralPath $target
        $node=Join-Path $target 'runtime\node\node.exe'
        Run-Checked $node @('scripts/verify-portable.cjs')
        Run-Checked $node @('scripts/smoke-ui.cjs')
        Run-Checked $node @('scripts/smoke-mcp-startup.cjs')
        $report.defaultMcpDisabledAndExplicitEnable=$true
    } finally {
        Set-Location -LiteralPath $projectRoot
        $env:PATH=$originalPath
        if ($null -ne $originalPython) { $env:ECHO_TEST_PYTHON=$originalPython }
    }
    $report.offlineOcrAndUi=$true
    $uninstaller=Join-Path $target 'Uninstall.exe'
    $process=Start-Process -FilePath $uninstaller -ArgumentList '/S' -WindowStyle Hidden -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "Uninstall test failed: $($process.ExitCode)" }
    if (Test-Path -LiteralPath (Join-Path $target 'runtime\python\python.exe')) { throw 'Uninstaller left program runtime behind' }
    if (Test-Path -LiteralPath $testKey) { throw 'Uninstaller left registration behind' }
    foreach ($file in @($case.FullName,$asset,$controls,$controlAsset,(Join-Path $target 'reports\installer-preservation.txt'),(Join-Path $target 'recordings\installer-preservation.txt'))) {
        if (!(Test-Path -LiteralPath $file)) { throw 'Uninstaller removed user data' }
    }
    $report.uninstallPreservesData=$true
    $report.passed=$true
} catch {
    $report.error=$_.Exception.Message
    throw
} finally {
    $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $projectRoot 'artifacts\installer-test.json') -Encoding UTF8
}
$report | ConvertTo-Json -Depth 6
