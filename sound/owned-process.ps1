[CmdletBinding()]
param([Parameter(Mandatory)][string] $LaunchBase64)
$ErrorActionPreference = 'Stop'

# The job list is applied atomically by CreateProcess, before any child code.
# No breakaway flags, inheritable job handles, port lookup, or PID-based killing.
# https://devblogs.microsoft.com/oldnewthing/20230209-00/?p=107812
Add-Type -Path (Join-Path $PSScriptRoot 'owned-process.cs')
try {
    $launch = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($LaunchBase64)) | ConvertFrom-Json
    $result = [SoundOwnedProcess]::Run($launch.executable, [string[]]$launch.args,
        $launch.cwd, [int]$launch.timeoutMs)
    exit $result
} catch {
    [Console]::Error.WriteLine($_.Exception.ToString())
    exit 1
}
