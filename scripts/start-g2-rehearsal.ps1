[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Capture', 'Confirm', 'ValidateOnly', 'Run')]
    [string]$Mode,

    [Parameter(Mandatory = $true)]
    [string]$RehearsalRoot,

    [Parameter(Mandatory = $true)]
    [string]$DisplayMapPath,

    [string]$PrimaryDisplayId,
    [string]$SecondaryDisplayId,

    [ValidatePattern('^[A-Za-z0-9._-]{1,64}$')]
    [string]$RunId
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$rehearsalParent = 'D:\VirtualData\JanVim-Exhibition-Rehearsals'
$janVimProductRoot = 'D:\github\JanVim'
$protectedRoots = @(
    'D:\VirtualData\TempCache\janvim-root-export-quarantine-20260826-110433-6473a2d7ebbc4524b66c61c07e540504'
    'D:\VirtualData\TempCache\janvim-task5-cached-d42e9769283e47dc8b98cf94baee739d'
    'D:\VirtualData\TempCache\janvim-task5-physical-cached-e9735e8d02e34ff4a4ac8836f8e22dcb'
)

function Resolve-G2FullPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string]$Label
    )

    if (-not [IO.Path]::IsPathFullyQualified($Path)) {
        throw "$Label-must-be-absolute"
    }
    $resolved = [IO.Path]::GetFullPath($Path)
    if ($resolved.Length -gt 3) {
        $resolved = $resolved.TrimEnd([char[]]@('\', '/'))
    }
    return $resolved
}

function Test-G2PathEqual {
    param(
        [Parameter(Mandatory = $true)][string]$Left,
        [Parameter(Mandatory = $true)][string]$Right
    )

    return [string]::Equals(
        [IO.Path]::GetFullPath($Left).TrimEnd([char[]]@('\', '/')),
        [IO.Path]::GetFullPath($Right).TrimEnd([char[]]@('\', '/')),
        [StringComparison]::OrdinalIgnoreCase
    )
}

function Test-G2AtOrBelow {
    param(
        [Parameter(Mandatory = $true)][string]$Candidate,
        [Parameter(Mandatory = $true)][string]$Root
    )

    $resolvedCandidate = [IO.Path]::GetFullPath($Candidate).TrimEnd([char[]]@('\', '/'))
    $resolvedRoot = [IO.Path]::GetFullPath($Root).TrimEnd([char[]]@('\', '/'))
    if ([string]::Equals($resolvedCandidate, $resolvedRoot, [StringComparison]::OrdinalIgnoreCase)) {
        return $true
    }
    return $resolvedCandidate.StartsWith(
        "$resolvedRoot\",
        [StringComparison]::OrdinalIgnoreCase
    )
}

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\', '/')
$agentsPath = Join-Path $repositoryRoot 'AGENTS.md'
if (-not (Test-Path -LiteralPath $agentsPath -PathType Leaf)) {
    throw 'exhibition-agents-marker-missing'
}
$agentsMarker = Get-Content -Raw -LiteralPath $agentsPath
if ($agentsMarker -cnotmatch 'JanVim Exhibition 2026 agent instructions') {
    throw 'exhibition-agents-marker-invalid'
}

$resolvedRehearsalRoot = Resolve-G2FullPath -Path $RehearsalRoot -Label 'rehearsal-root'
$resolvedDisplayMapPath = Resolve-G2FullPath -Path $DisplayMapPath -Label 'display-map-path'

foreach ($protectedRoot in $protectedRoots) {
    if (
        (Test-G2AtOrBelow -Candidate $resolvedRehearsalRoot -Root $protectedRoot) -or
        (Test-G2AtOrBelow -Candidate $resolvedDisplayMapPath -Root $protectedRoot)
    ) {
        throw 'protected-path-rejected'
    }
}

if (
    (Test-G2AtOrBelow -Candidate $resolvedRehearsalRoot -Root $repositoryRoot) -or
    (Test-G2AtOrBelow -Candidate $resolvedDisplayMapPath -Root $repositoryRoot) -or
    (Test-G2AtOrBelow -Candidate $resolvedRehearsalRoot -Root $janVimProductRoot) -or
    (Test-G2AtOrBelow -Candidate $resolvedDisplayMapPath -Root $janVimProductRoot)
) {
    throw 'source-repository-path-rejected'
}

$resolvedParent = [IO.Path]::GetFullPath($rehearsalParent).TrimEnd('\', '/')
$actualRehearsalParent = [IO.Path]::GetDirectoryName($resolvedRehearsalRoot)
if (-not (Test-G2PathEqual -Left $actualRehearsalParent -Right $resolvedParent)) {
    throw 'rehearsal-root-must-be-direct-child'
}
if (-not [string]::Equals(
    [IO.Path]::GetFileName($resolvedDisplayMapPath),
    'display-map.json',
    [StringComparison]::OrdinalIgnoreCase
)) {
    throw 'display-map-basename-invalid'
}
if (-not (Test-G2PathEqual -Left ([IO.Path]::GetDirectoryName($resolvedDisplayMapPath)) -Right $resolvedRehearsalRoot)) {
    throw 'display-map-must-be-direct-child'
}

if ($Mode -eq 'Capture') {
    if (Test-Path -LiteralPath $resolvedRehearsalRoot) {
        throw 'capture-rehearsal-root-already-exists'
    }
    if (Test-Path -LiteralPath $resolvedDisplayMapPath) {
        throw 'capture-display-map-already-exists'
    }
    [void](New-Item -ItemType Directory -Path $resolvedRehearsalRoot)
}
else {
    if (-not (Test-Path -LiteralPath $resolvedRehearsalRoot -PathType Container)) {
        throw 'rehearsal-root-missing'
    }
    if (-not (Test-Path -LiteralPath $resolvedDisplayMapPath -PathType Leaf)) {
        throw 'display-map-missing'
    }
}

if ($Mode -eq 'Confirm') {
    if (
        [string]::IsNullOrWhiteSpace($PrimaryDisplayId) -or
        [string]::IsNullOrWhiteSpace($SecondaryDisplayId)
    ) {
        throw 'confirm-display-ids-required'
    }
    if ($PrimaryDisplayId -ceq $SecondaryDisplayId) {
        throw 'confirm-display-ids-must-be-distinct'
    }
}
elseif (
    -not [string]::IsNullOrEmpty($PrimaryDisplayId) -or
    -not [string]::IsNullOrEmpty($SecondaryDisplayId)
) {
    throw 'display-ids-unexpected-for-mode'
}

$rehearsalName = [IO.Path]::GetFileName($resolvedRehearsalRoot)
if ($Mode -in @('ValidateOnly', 'Run')) {
    if ([string]::IsNullOrWhiteSpace($RunId)) {
        throw 'run-id-required'
    }
    if ($RunId -cne $rehearsalName) {
        throw 'run-id-must-match-rehearsal-root'
    }
}
elseif (-not [string]::IsNullOrEmpty($RunId)) {
    throw 'run-id-unexpected-for-mode'
}

$electronCommand = Join-Path $repositoryRoot 'node_modules\.bin\electron.cmd'
$controllerPackage = Join-Path $repositoryRoot 'apps\controller'
$compiledEntry = Join-Path $controllerPackage 'dist\src\electron-main.js'
$verifyRuntime = Join-Path $repositoryRoot 'scripts\verify-runtime.ps1'
foreach ($requiredFile in @($electronCommand, $compiledEntry, $verifyRuntime)) {
    if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
        throw "required-launch-file-missing:$requiredFile"
    }
}

if ($Mode -in @('ValidateOnly', 'Run')) {
    & pwsh -NoProfile -NonInteractive -File $verifyRuntime
    $verificationExitCode = $LASTEXITCODE
    if ($verificationExitCode -ne 0) {
        throw "runtime-verification-failed:$verificationExitCode"
    }
}

$electronArguments = @(
    $controllerPackage
    "--g2-mode=$($Mode.ToLowerInvariant())"
    "--rehearsal-root=$resolvedRehearsalRoot"
    "--display-map=$resolvedDisplayMapPath"
)
if ($Mode -eq 'Confirm') {
    $electronArguments += "--primary-display-id=$PrimaryDisplayId"
    $electronArguments += "--secondary-display-id=$SecondaryDisplayId"
}
if ($Mode -in @('ValidateOnly', 'Run')) {
    $electronArguments += "--run-id=$RunId"
}

& $electronCommand @electronArguments
$electronExitCode = $LASTEXITCODE
[pscustomobject]@{
    schema = 1
    mode = $Mode
    exitCode = $electronExitCode
    displayMapPath = $resolvedDisplayMapPath
    runId = if ($RunId) { $RunId } else { $null }
} | ConvertTo-Json -Compress
exit $electronExitCode
