[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [int] $Port,

    [Parameter(Mandatory)]
    [int] $ExpectedPid
)

$ErrorActionPreference = 'Stop'
$mode = $env:JANVIM_SOUND_OWNER_FIXTURE_MODE
$statePath = $env:JANVIM_SOUND_OWNER_FIXTURE_STATE
$logPath = $env:JANVIM_SOUND_OWNER_FIXTURE_LOG

if ([string]::IsNullOrWhiteSpace($mode) -or
    [string]::IsNullOrWhiteSpace($statePath) -or
    [string]::IsNullOrWhiteSpace($logPath)) {
    exit 4
}

$first = $false
try {
    $marker = [System.IO.File]::Open(
        $statePath,
        [System.IO.FileMode]::CreateNew,
        [System.IO.FileAccess]::Write,
        [System.IO.FileShare]::Read
    )
    $marker.Dispose()
    $first = $true
} catch [System.IO.IOException] {
    $first = $false
}

[System.IO.File]::AppendAllText(
    $logPath,
    (([ordered]@{
        event = 'helper-started'
        mode = $mode
        first = $first
        atMilliseconds = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    } | ConvertTo-Json -Compress) + [Environment]::NewLine)
)

if ($mode -eq 'startup-delay-owned' -and $first) {
    Start-Sleep -Milliseconds 2000
    exit 0
} elseif ($mode -eq 'startup-hang' -and $first) {
    Start-Sleep -Seconds 30
    exit 0
} elseif ($mode -eq 'cleanup-delay-owned' -and -not $first) {
    Start-Sleep -Milliseconds 2000
    exit 0
} elseif ($mode -eq 'wrong-identity') {
    exit 3
}

exit 0
