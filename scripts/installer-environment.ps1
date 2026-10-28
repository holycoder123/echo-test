param(
    [Parameter(Mandatory=$true)][string]$InstallDirectory,
    [Parameter(Mandatory=$true)][string]$Manifest,
    [Parameter(Mandatory=$true)][string]$Output
)
# This check uses Windows PowerShell/.NET, never the environment being repaired.
$ErrorActionPreference = 'Stop'
$reuse = [Collections.Generic.List[string]]::new()
$reuse.Add('[Reuse]')
$reused = 0
$repaired = 0
try {
    $root = [IO.Path]::GetFullPath($InstallDirectory).TrimEnd('\') + '\'
    $data = [IO.File]::ReadAllText($Manifest, [Text.Encoding]::UTF8) | ConvertFrom-Json
    if ($data.schema_version -ne 1 -or !$data.components) { throw 'Invalid environment manifest' }
    foreach ($component in $data.components) {
        if ($component.id -notmatch '^[a-f0-9]{24}$') { throw 'Invalid environment component ID' }
        $valid = $false
        try {
            $directory = [IO.Path]::GetFullPath((Join-Path $root $component.path)).TrimEnd('\') + '\'
            if (!$directory.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid component path' }
            $valid = $component.files.Count -gt 0 -and [IO.Directory]::Exists($directory)
            foreach ($entry in $component.files) {
                if (!$valid) { break }
                $file = [IO.Path]::GetFullPath((Join-Path $directory $entry.path))
                if (!$file.StartsWith($directory, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid dependency path' }
                $info = [IO.FileInfo]::new($file)
                if (!$info.Exists -or $info.Length -ne $entry.size) { $valid = $false; break }
                # Timestamps and version markers alone cannot detect damaged DLLs/models.
                $stream = [IO.File]::OpenRead($file)
                $sha = [Security.Cryptography.SHA256]::Create()
                try { $hash = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
                finally { $sha.Dispose(); $stream.Dispose() }
                if ($hash -ne $entry.sha256) { $valid = $false; break }
            }
        } catch { $valid = $false }
        if ($valid) { $reuse.Add($component.id + '=1'); $reused++ }
        else { $repaired++ }
    }
} catch {
    # If detection is unavailable, install the bundled environment normally.
    $reuse.Clear(); $reuse.Add('[Reuse]'); $reused = 0
}
$reuse.Add('[Summary]')
$reuse.Add('Reused=' + $reused)
$reuse.Add('InstalledOrRepaired=' + $repaired)
[IO.File]::WriteAllLines($Output, $reuse, [Text.Encoding]::ASCII)
Write-Output "Environment check: reuse $reused components; install or repair $repaired components."
