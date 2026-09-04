[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateRange(1, 65535)]
    [int] $Port,

    [Parameter(Mandatory)]
    [ValidateRange(1, [int]::MaxValue)]
    [int] $ExpectedPid
)

$ErrorActionPreference = 'Stop'

try {
    function Test-OwnedProcessTree {
        param([int] $CandidateProcessId)

        for ($depth = 0; $depth -lt 32; $depth += 1) {
            if ($CandidateProcessId -eq $ExpectedPid) {
                return $true
            }
            if ($CandidateProcessId -le 0) {
                return $false
            }
            $candidate = Get-CimInstance Win32_Process -Filter "ProcessId = $CandidateProcessId"
            if ($null -eq $candidate) {
                return $false
            }
            $CandidateProcessId = [int] $candidate.ParentProcessId
        }
        return $false
    }

    $localAddresses = @('127.0.0.1', '0.0.0.0', '::1', '::')
    $endpoints = @(
        Get-NetUDPEndpoint -LocalPort $Port -ErrorAction Stop |
            Where-Object { $_.LocalAddress -in $localAddresses }
    )

    if ($endpoints.Count -eq 0) {
        exit 2
    }
    if (@($endpoints | Where-Object { -not (Test-OwnedProcessTree $_.OwningProcess) }).Count -gt 0) {
        exit 3
    }
    exit 0
}
catch {
    exit 4
}
