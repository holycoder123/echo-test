param([switch]$KeepLegacyShortcut)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$icon = Join-Path $projectRoot 'electron\assets\studio.ico'
$launcher = Join-Path $projectRoot 'scripts\start-studio.ps1'
if (!(Test-Path -LiteralPath $icon) -or !(Test-Path -LiteralPath $launcher)) { throw 'Project icon or launcher is missing.' }
$desktop = [Environment]::GetFolderPath('Desktop')
$shell = New-Object -ComObject WScript.Shell
$shortcutPath = Join-Path $desktop 'echo test.lnk'
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path ([Environment]::GetFolderPath('System')) 'WindowsPowerShell\v1.0\powershell.exe'
$shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "'+$launcher+'" -Admin'
$shortcut.WorkingDirectory = $projectRoot
$shortcut.IconLocation = $icon+',0'
$shortcut.Description = 'echo test - Windows desktop automation testing'
$shortcut.WindowStyle = 7
$shortcut.Save()
# Replace only the known predecessor, preserving a restorable local backup.
if (!$KeepLegacyShortcut) {
    $legacyName = [string]::Concat([char]0x8BFA,[char]0x4E9A,[char]0x6D4B,[char]0x8BD5,[char]0x5DE5,[char]0x4F5C,[char]0x53F0,'.lnk')
    $legacyPath = Join-Path $desktop $legacyName
    if (Test-Path -LiteralPath $legacyPath) {
        $legacy = $shell.CreateShortcut($legacyPath)
        if ($legacy.Arguments -match '(?i)(NYCS Test Studio|nycs-test-studio|echo test|echo-test)[\\/]scripts[\\/]start-studio\.ps1') {
            $backupDirectory = Join-Path $projectRoot '.runtime\shortcut-backup'
            New-Item -ItemType Directory -Force -Path $backupDirectory | Out-Null
            $backupPath = Join-Path $backupDirectory $legacyName
            if (!(Test-Path -LiteralPath $backupPath)) { Copy-Item -LiteralPath $legacyPath -Destination $backupPath }
            Remove-Item -LiteralPath $legacyPath
        }
    }
}
if (!("EchoTestBrandShell" -as [type])) {
    Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class EchoTestBrandShell { [DllImport("shell32.dll", CharSet=CharSet.Unicode)] public static extern void SHChangeNotify(uint e, uint f, string p, IntPtr q); }'
}
[EchoTestBrandShell]::SHChangeNotify(0x08000000, 0, $null, [IntPtr]::Zero)
[EchoTestBrandShell]::SHChangeNotify(0x00002000, 0x0005, $shortcutPath, [IntPtr]::Zero)
Write-Host "Desktop shortcut ready: $shortcutPath"
Write-Host "Icon: $icon"
