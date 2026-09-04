[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$RehearsalRoot,

    [Parameter(Mandatory = $true)]
    [string]$DisplayMapPath
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

function Resolve-DisplayConfigPath {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Label
    )

    if (-not [IO.Path]::IsPathFullyQualified($Path)) {
        throw "$Label-must-be-absolute"
    }
    $normalized = $Path.Replace('/', '\')
    if (
        $normalized -notmatch '^[A-Za-z]:\\' -or
        $normalized.StartsWith('\\?\') -or
        $normalized.StartsWith('\\.\') -or
        $Path.Substring(2).Contains(':')
    ) {
        throw "$Label-must-be-local-drive-path"
    }
    $resolved = [IO.Path]::GetFullPath($Path)
    if ($resolved.Length -gt 3) {
        $resolved = $resolved.TrimEnd([char[]]@('\', '/'))
    }
    return $resolved
}

function Test-DisplayConfigPathEqual {
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

function Test-DisplayConfigAtOrBelow {
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

function Assert-PlainPath {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][ValidateSet('Container', 'Leaf')][string]$Kind,
        [Parameter(Mandatory = $true)][string]$Reason
    )

    $item = Get-Item -LiteralPath $Path -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "$Reason-reparse-point"
    }
    if ($Kind -eq 'Container' -and -not $item.PSIsContainer) {
        throw "$Reason-not-container"
    }
    if ($Kind -eq 'Leaf' -and $item.PSIsContainer) {
        throw "$Reason-not-file"
    }
}

function Assert-NoDisplayConfigReparseTraversal {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Reason
    )

    $currentPath = Resolve-DisplayConfigPath -Path $Path -Label 'reparse-traversal-path'
    while (-not (Test-Path -LiteralPath $currentPath)) {
        $parentPath = [IO.Path]::GetDirectoryName($currentPath)
        if ([string]::IsNullOrWhiteSpace($parentPath) -or (Test-DisplayConfigPathEqual -Left $parentPath -Right $currentPath)) {
            throw $Reason
        }
        $currentPath = $parentPath
    }
    while ($null -ne $currentPath) {
        $item = Get-Item -LiteralPath $currentPath -Force
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw $Reason
        }
        $parentPath = [IO.Path]::GetDirectoryName($currentPath)
        if ([string]::IsNullOrWhiteSpace($parentPath) -or (Test-DisplayConfigPathEqual -Left $parentPath -Right $currentPath)) {
            break
        }
        $currentPath = $parentPath
    }
}

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\', '/')
$agentsPath = Join-Path $repositoryRoot 'AGENTS.md'
if (-not (Test-Path -LiteralPath $agentsPath -PathType Leaf)) {
    throw 'exhibition-agents-marker-missing'
}
if ((Get-Content -Raw -LiteralPath $agentsPath) -cnotmatch 'JanVim Exhibition 2026 agent instructions') {
    throw 'exhibition-agents-marker-invalid'
}

$resolvedRehearsalRoot = Resolve-DisplayConfigPath -Path $RehearsalRoot -Label 'rehearsal-root'
$resolvedDisplayMapPath = Resolve-DisplayConfigPath -Path $DisplayMapPath -Label 'display-map-path'
$resolvedParent = [IO.Path]::GetFullPath($rehearsalParent).TrimEnd('\', '/')

foreach ($protectedRoot in $protectedRoots) {
    if (
        (Test-DisplayConfigAtOrBelow -Candidate $resolvedRehearsalRoot -Root $protectedRoot) -or
        (Test-DisplayConfigAtOrBelow -Candidate $resolvedDisplayMapPath -Root $protectedRoot)
    ) {
        throw 'protected-path-rejected'
    }
}
if (
    (Test-DisplayConfigAtOrBelow -Candidate $resolvedRehearsalRoot -Root $repositoryRoot) -or
    (Test-DisplayConfigAtOrBelow -Candidate $resolvedDisplayMapPath -Root $repositoryRoot) -or
    (Test-DisplayConfigAtOrBelow -Candidate $resolvedRehearsalRoot -Root $janVimProductRoot) -or
    (Test-DisplayConfigAtOrBelow -Candidate $resolvedDisplayMapPath -Root $janVimProductRoot) -or
    $resolvedRehearsalRoot -match '\\AppData\\Local\\nvim(?:\\|$)' -or
    $resolvedDisplayMapPath -match '\\AppData\\Local\\nvim(?:\\|$)'
) {
    throw 'source-or-user-path-rejected'
}

if (-not (Test-DisplayConfigPathEqual -Left ([IO.Path]::GetDirectoryName($resolvedRehearsalRoot)) -Right $resolvedParent)) {
    throw 'rehearsal-root-must-be-direct-child'
}
if (-not [string]::Equals([IO.Path]::GetFileName($resolvedDisplayMapPath), 'display-map.json', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'display-map-basename-invalid'
}
if (-not (Test-DisplayConfigPathEqual -Left ([IO.Path]::GetDirectoryName($resolvedDisplayMapPath)) -Right $resolvedRehearsalRoot)) {
    throw 'display-map-must-be-direct-child'
}

$electronCommand = Join-Path $repositoryRoot 'node_modules\.bin\electron.cmd'
$controllerPackage = Join-Path $repositoryRoot 'apps\controller'
$requiredFiles = @(
    $electronCommand
    (Join-Path $controllerPackage 'dist\main\electron-main.js')
    (Join-Path $controllerPackage 'dist\display-config-preload\display-config-preload.cjs')
    (Join-Path $repositoryRoot 'apps\display-configurator\dist\index.html')
    (Join-Path $repositoryRoot 'apps\display-configurator\dist\identify.html')
    (Join-Path $repositoryRoot 'show\display-layout.json')
)
foreach ($requiredFile in $requiredFiles) {
    if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
        throw "required-display-config-file-missing:$requiredFile"
    }
}

Assert-NoDisplayConfigReparseTraversal -Path $resolvedParent -Reason 'rehearsal-parent-reparse-rejected'
Assert-PlainPath -Path $resolvedParent -Kind Container -Reason 'rehearsal-parent-invalid'
if (-not (Test-Path -LiteralPath $resolvedRehearsalRoot)) {
    [void](New-Item -ItemType Directory -Path $resolvedRehearsalRoot)
}
Assert-NoDisplayConfigReparseTraversal -Path $resolvedRehearsalRoot -Reason 'rehearsal-root-reparse-rejected'
Assert-PlainPath -Path $resolvedRehearsalRoot -Kind Container -Reason 'rehearsal-root-invalid'
Assert-NoDisplayConfigReparseTraversal -Path $resolvedDisplayMapPath -Reason 'display-map-reparse-rejected'
if (Test-Path -LiteralPath $resolvedDisplayMapPath) {
    Assert-PlainPath -Path $resolvedDisplayMapPath -Kind Leaf -Reason 'display-map-invalid'
}

$canonicalParent = (Get-Item -LiteralPath $resolvedParent -Force).FullName.TrimEnd([char[]]@('\', '/'))
$canonicalRoot = (Get-Item -LiteralPath $resolvedRehearsalRoot -Force).FullName.TrimEnd([char[]]@('\', '/'))
if (
    -not (Test-DisplayConfigPathEqual -Left $canonicalParent -Right $resolvedParent) -or
    -not (Test-DisplayConfigPathEqual -Left ([IO.Path]::GetDirectoryName($canonicalRoot)) -Right $canonicalParent)
) {
    throw 'canonical-rehearsal-boundary-invalid'
}
$canonicalMap = if (Test-Path -LiteralPath $resolvedDisplayMapPath) {
    (Get-Item -LiteralPath $resolvedDisplayMapPath -Force).FullName
}
else {
    Join-Path $canonicalRoot 'display-map.json'
}
if (-not (Test-DisplayConfigPathEqual -Left ([IO.Path]::GetDirectoryName($canonicalMap)) -Right $canonicalRoot)) {
    throw 'canonical-display-map-boundary-invalid'
}
foreach ($candidate in @($canonicalRoot, $canonicalMap)) {
    foreach ($protectedRoot in $protectedRoots) {
        if (Test-DisplayConfigAtOrBelow -Candidate $candidate -Root $protectedRoot) {
            throw 'canonical-protected-path-rejected'
        }
    }
    if (
        (Test-DisplayConfigAtOrBelow -Candidate $candidate -Root $repositoryRoot) -or
        (Test-DisplayConfigAtOrBelow -Candidate $candidate -Root $janVimProductRoot) -or
        $candidate -match '\\AppData\\Local\\nvim(?:\\|$)'
    ) {
        throw 'canonical-source-or-user-path-rejected'
    }
}

$electronArguments = @(
    $controllerPackage
    '--display-config-mode=configure'
    "--rehearsal-root=$resolvedRehearsalRoot"
    "--display-map=$resolvedDisplayMapPath"
)
& $electronCommand @electronArguments
$electronExitCode = $LASTEXITCODE
[pscustomobject]@{
    schema = 1
    mode = 'ConfigureDisplays'
    exitCode = $electronExitCode
    displayMapPath = $resolvedDisplayMapPath
} | ConvertTo-Json -Compress
exit $electronExitCode
