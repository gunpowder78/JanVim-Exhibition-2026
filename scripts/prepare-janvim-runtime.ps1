[CmdletBinding(DefaultParameterSetName = 'Archive')]
param(
    [Parameter(Mandatory = $true, ParameterSetName = 'Archive')]
    [string]$SourceArchive,

    [Parameter(Mandatory = $true, ParameterSetName = 'Directory')]
    [string]$SourceDirectory,

    [Parameter(Mandatory = $true, ParameterSetName = 'Directory')]
    [string]$ProvenanceArchive,

    [Parameter(Mandatory = $true)]
    [string]$ProvenancePath,

    [string]$ArchiveSha256Path,

    [Parameter(Mandatory = $true)]
    [ValidateSet('dynamic', 'orthogonal')]
    [string]$LayoutEngine
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ExpectedTag = 'v0.10.1-gmk.4.punctuation.2'
$ExpectedCommit = 'abbd5a5b942b202e7fe4324bcd3ddab47c672cb9'
$ExpectedSourceRepository = 'D:/github/JanVim'
$ExpectedProvenanceRepository = 'https://github.com/gunpowder78/JanVim.git'
$ExpectedArchive = 'JanVim-win-x64.zip'
$ExpectedChecksum = 'JanVim-win-x64.zip.sha256'
$ExpectedProvenanceRecord = 'JanVim-win-x64.provenance.json'
$ExpectedBuildLog = 'JanVim-win-x64.build.log'
$HashPattern = '^[0-9a-f]{64}$'
$MinimumCoreBytes = [long]1048576
$MaximumArchiveBytes = [long]1073741824
$MaximumExpandedBytes = [long]4294967296
$MaximumEntryCount = 50000
$MaximumEvidenceBytes = [long]16777216

function Get-Sha256Hex {
    param([Parameter(Mandatory = $true)][string]$Path)

    return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
}

function Get-StreamSha256Hex {
    param([Parameter(Mandatory = $true)][System.IO.Stream]$Stream)

    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = $sha256.ComputeHash($Stream)
        return [System.BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
    }
    finally {
        $sha256.Dispose()
    }
}

function Assert-RequiredFile {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Reason
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw $Reason
    }
}

function Get-RequiredProperty {
    param(
        [Parameter(Mandatory = $true)][object]$InputObject,
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$ReasonPrefix
    )

    $property = $InputObject.PSObject.Properties[$Name]
    if ($null -eq $property) {
        throw "$ReasonPrefix-field-missing:$Name"
    }
    return $property.Value
}

function Assert-PropertySet {
    param(
        [Parameter(Mandatory = $true)][object]$InputObject,
        [Parameter(Mandatory = $true)][string[]]$ExpectedNames,
        [Parameter(Mandatory = $true)][string]$Reason
    )

    $actual = @($InputObject.PSObject.Properties.Name | Sort-Object)
    $expected = @($ExpectedNames | Sort-Object)
    if (($actual -join "`n") -cne ($expected -join "`n")) {
        throw $Reason
    }
}

function Assert-ExactProperty {
    param(
        [Parameter(Mandatory = $true)][object]$InputObject,
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][object]$Expected,
        [Parameter(Mandatory = $true)][string]$Reason,
        [Parameter(Mandatory = $true)][string]$ReasonPrefix
    )

    $actual = Get-RequiredProperty -InputObject $InputObject -Name $Name -ReasonPrefix $ReasonPrefix
    if ($actual -is [string] -and $Expected -is [string]) {
        if ($actual -cne $Expected) {
            throw $Reason
        }
    }
    elseif ($actual -ne $Expected) {
        throw $Reason
    }
}

function Assert-HashValue {
    param(
        [Parameter(Mandatory = $true)][object]$Value,
        [Parameter(Mandatory = $true)][string]$Name
    )

    if ($Value -isnot [string] -or $Value -cnotmatch $HashPattern) {
        throw "hash-format-invalid:$Name"
    }
    return [string]$Value
}

function Assert-PositiveInteger {
    param(
        [Parameter(Mandatory = $true)][object]$Value,
        [Parameter(Mandatory = $true)][string]$Name
    )

    if ($Value -isnot [byte] -and
        $Value -isnot [int16] -and
        $Value -isnot [int32] -and
        $Value -isnot [int64]) {
        throw "integer-invalid:$Name"
    }
    $converted = [long]$Value
    if ($converted -lt 1) {
        throw "integer-invalid:$Name"
    }
    return $converted
}

function Read-JsonObject {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Reason
    )

    try {
        $value = Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json -Depth 16
    }
    catch {
        throw $Reason
    }
    if ($null -eq $value -or $value -is [System.Array]) {
        throw $Reason
    }
    return $value
}

function Assert-BuildEvidenceContent {
    param([Parameter(Mandatory = $true)][string]$Path)

    $evidenceText = Get-Content -Raw -LiteralPath $Path
    if ($evidenceText -notmatch [regex]::Escape("JANVIM_SOURCE_TAG=$ExpectedTag") -or
        $evidenceText -notmatch [regex]::Escape("JANVIM_SOURCE_COMMIT=$ExpectedCommit")) {
        throw 'build-evidence-source-identity-missing'
    }
    foreach ($requiredBuildStep in @(
        'cargo-fmt',
        'cargo-test',
        'cargo-clippy',
        'guard-deps',
        'package-windows'
    )) {
        if ($evidenceText -notmatch [regex]::Escape("JANVIM_BUILD_STEP_OK=$requiredBuildStep")) {
            throw "build-evidence-step-missing:$requiredBuildStep"
        }
    }
}

function Test-PathInside {
    param(
        [Parameter(Mandatory = $true)][string]$Candidate,
        [Parameter(Mandatory = $true)][string]$Parent
    )

    $candidatePath = [System.IO.Path]::GetFullPath($Candidate)
    $parentPath = [System.IO.Path]::GetFullPath($Parent)
    $boundary = $parentPath.TrimEnd(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar
    ) + [System.IO.Path]::DirectorySeparatorChar
    return $candidatePath.StartsWith($boundary, [System.StringComparison]::OrdinalIgnoreCase)
}

function Assert-InputPathAllowed {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$RuntimeParent
    )

    try {
        $fullPath = [System.IO.Path]::GetFullPath($Path)
    }
    catch {
        throw 'source-path-invalid'
    }
    $blockedTempRoot = [System.IO.Path]::GetFullPath('D:\VirtualData\TempCache')
    if ($fullPath -ceq $blockedTempRoot) {
        throw 'protected-temp-source-rejected'
    }
    if (Test-PathInside -Candidate $fullPath -Parent $blockedTempRoot) {
        $relativeToTemp = [System.IO.Path]::GetRelativePath($blockedTempRoot, $fullPath)
        $tempTopLevel = $relativeToTemp.Split(
            [System.IO.Path]::DirectorySeparatorChar,
            [System.StringSplitOptions]::RemoveEmptyEntries
        )[0]
        if ($tempTopLevel.StartsWith('janvim-', [System.StringComparison]::OrdinalIgnoreCase)) {
            throw 'protected-temp-source-rejected'
        }
    }
    if ($fullPath -ceq $RuntimeParent -or (Test-PathInside -Candidate $fullPath -Parent $RuntimeParent)) {
        throw 'runtime-source-rejected'
    }
}

function Resolve-InputLeaf {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Reason,
        [Parameter(Mandatory = $true)][string]$RuntimeParent
    )

    Assert-InputPathAllowed -Path $Path -RuntimeParent $RuntimeParent
    try {
        $resolved = (Resolve-Path -LiteralPath $Path -ErrorAction Stop).Path
    }
    catch {
        throw $Reason
    }
    if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
        throw $Reason
    }
    Assert-InputPathAllowed -Path $resolved -RuntimeParent $RuntimeParent
    return $resolved
}

function Resolve-InputContainer {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Reason,
        [Parameter(Mandatory = $true)][string]$RuntimeParent
    )

    Assert-InputPathAllowed -Path $Path -RuntimeParent $RuntimeParent
    try {
        $resolved = (Resolve-Path -LiteralPath $Path -ErrorAction Stop).Path
    }
    catch {
        throw $Reason
    }
    if (-not (Test-Path -LiteralPath $resolved -PathType Container)) {
        throw $Reason
    }
    Assert-InputPathAllowed -Path $resolved -RuntimeParent $RuntimeParent
    return $resolved
}

function Get-TomlStringValue {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Section,
        [Parameter(Mandatory = $true)][string]$Key,
        [switch]$Required
    )

    $activeSection = ''
    $values = [System.Collections.Generic.List[string]]::new()
    $keyPattern = '^\s*' + [regex]::Escape($Key) + '\s*=\s*"([^"]*)"\s*(?:#.*)?$'
    foreach ($line in [System.IO.File]::ReadAllLines($Path)) {
        if ($line -match '^\s*\[([A-Za-z0-9_-]+)\]\s*(?:#.*)?$') {
            $activeSection = $Matches[1]
            continue
        }
        if ($activeSection -ceq $Section -and $line -match $keyPattern) {
            $values.Add($Matches[1])
        }
    }
    if ($values.Count -gt 1) {
        throw "show-config-duplicate:$Section.$Key"
    }
    if ($values.Count -eq 0) {
        if ($Required) {
            throw "show-config-field-missing:$Section.$Key"
        }
        return $null
    }
    return $values[0]
}

function Assert-ShowConfigForPreparation {
    param(
        [Parameter(Mandatory = $true)][string]$ConfigPath,
        [Parameter(Mandatory = $true)][string]$RuntimeTarget,
        [Parameter(Mandatory = $true)][string]$ExpectedLayout
    )

    Assert-RequiredFile -Path $ConfigPath -Reason 'show-config-missing'
    $text = [System.IO.File]::ReadAllText($ConfigPath)
    if ($text -match '(?m)^\s*(schema|mode|network|layout_engine|artifact_lock|runtime_root|private_user_root|source_writes)\s*=') {
        throw 'show-layout-unconfirmed'
    }
    $engine = Get-TomlStringValue -Path $ConfigPath -Section 'layout' -Key 'engine' -Required
    if ($engine -notin @('dynamic', 'orthogonal')) {
        throw 'show-layout-unconfirmed'
    }
    if ($engine -cne $ExpectedLayout) {
        throw 'show-layout-argument-mismatch'
    }
    $startupProfile = Get-TomlStringValue -Path $ConfigPath -Section 'neovim' -Key 'startup_profile' -Required
    if ($startupProfile -cne 'plugin-lab') {
        throw 'show-neovim-profile-mismatch'
    }
    $dynamicProfile = Get-TomlStringValue -Path $ConfigPath -Section 'layout' -Key 'dynamic_profile'
    if ($engine -ceq 'dynamic') {
        if ([string]::IsNullOrWhiteSpace($dynamicProfile)) {
            throw 'show-dynamic-profile-missing'
        }
        $resolvedProfile = [System.IO.Path]::GetFullPath(
            (Join-Path (Split-Path -Parent $ConfigPath) $dynamicProfile)
        )
        $expectedProfile = [System.IO.Path]::GetFullPath(
            (Join-Path $RuntimeTarget 'assets\layout-profiles\computer-mixed.toml')
        )
        if ($resolvedProfile -cne $expectedProfile) {
            throw 'show-dynamic-profile-path-mismatch'
        }
    }
    elseif ($null -ne $dynamicProfile) {
        throw 'show-orthogonal-profile-conflict'
    }
}

function Get-ArchiveInspection {
    param([Parameter(Mandatory = $true)][string]$ArchivePath)

    $archiveItem = Get-Item -LiteralPath $ArchivePath
    if ($archiveItem.Length -lt 1 -or $archiveItem.Length -gt $MaximumArchiveBytes) {
        throw 'archive-size-out-of-bounds'
    }

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    try {
        $archive = [System.IO.Compression.ZipFile]::OpenRead($ArchivePath)
    }
    catch {
        throw 'archive-invalid-zip'
    }
    try {
        if ($archive.Entries.Count -lt 1 -or $archive.Entries.Count -gt $MaximumEntryCount) {
            throw 'archive-entry-count-out-of-bounds'
        }
        $seen = [System.Collections.Generic.HashSet[string]]::new(
            [System.StringComparer]::OrdinalIgnoreCase
        )
        $requiredEntries = @{
            'janvim-core.exe' = 'janvim-core-missing'
            'runtime/lua/janvim.lua' = 'runtime-lua-missing'
            'assets/config.toml' = 'artifact-config-missing'
            'janvim-watchdog.exe' = 'runtime-watchdog-missing'
            'nvim-win64/bin/nvim.exe' = 'runtime-bundled-nvim-missing'
            'assets/nvim/init.lua' = 'runtime-nvim-init-missing'
            'assets/layout-profiles/computer-mixed.toml' = 'runtime-dynamic-profile-missing'
            'assets/fonts/private/FiraCodeNerdFontMono-Regular.ttf' = 'runtime-font-missing'
        }
        $found = @{}
        [long]$expandedBytes = 0
        foreach ($entry in $archive.Entries) {
            $normalized = $entry.FullName.Replace('\', '/')
            if ([string]::IsNullOrWhiteSpace($normalized)) {
                throw 'archive-entry-path-invalid'
            }
            if ($normalized.StartsWith('/') -or $normalized -match '^[A-Za-z]:' -or $normalized.IndexOf([char]0) -ge 0) {
                throw 'archive-entry-path-invalid'
            }
            $segments = @($normalized.Split('/') | Where-Object { $_ -ne '' })
            if ($segments.Count -eq 0 -or $segments -contains '.' -or $segments -contains '..') {
                throw 'archive-entry-path-invalid'
            }
            if (-not $seen.Add($normalized)) {
                throw 'archive-entry-duplicate'
            }
            $expandedBytes += [long]$entry.Length
            if ($expandedBytes -gt $MaximumExpandedBytes) {
                throw 'archive-expanded-size-out-of-bounds'
            }
            $unixMode = (([uint32]$entry.ExternalAttributes -shr 16) -band 0xF000)
            if ($unixMode -eq 0xA000) {
                throw 'archive-symlink-rejected'
            }
            if ($normalized -in @($ExpectedArchive, $ExpectedChecksum, $ExpectedProvenanceRecord, $ExpectedBuildLog)) {
                throw 'archive-reserved-entry-rejected'
            }
            if ($requiredEntries.ContainsKey($normalized)) {
                $found[$normalized] = $entry
            }
        }
        foreach ($requiredPath in $requiredEntries.Keys) {
            if (-not $found.ContainsKey($requiredPath)) {
                throw $requiredEntries[$requiredPath]
            }
        }
        if ([long]$found['janvim-core.exe'].Length -lt $MinimumCoreBytes) {
            throw 'core-too-small'
        }

        $hashes = @{}
        foreach ($requiredPath in @(
            'janvim-core.exe',
            'runtime/lua/janvim.lua',
            'assets/config.toml'
        )) {
            $stream = $found[$requiredPath].Open()
            try {
                $hashes[$requiredPath] = Get-StreamSha256Hex -Stream $stream
            }
            finally {
                $stream.Dispose()
            }
        }
        return [pscustomobject]@{
            EntryCount = $archive.Entries.Count
            ExpandedBytes = $expandedBytes
            CoreBytes = [long]$found['janvim-core.exe'].Length
            CoreSha256 = $hashes['janvim-core.exe']
            RuntimeLuaSha256 = $hashes['runtime/lua/janvim.lua']
            ArtifactConfigSha256 = $hashes['assets/config.toml']
        }
    }
    finally {
        $archive.Dispose()
    }
}

function Assert-Provenance {
    param(
        [Parameter(Mandatory = $true)][object]$Record,
        [Parameter(Mandatory = $true)][long]$ArchiveBytes,
        [Parameter(Mandatory = $true)][string]$ArchiveSha256,
        [Parameter(Mandatory = $true)][string]$ChecksumSha256,
        [Parameter(Mandatory = $true)][object]$Inspection
    )

    $propertyNames = @(
        'schema',
        'kind',
        'sourceRepository',
        'tag',
        'commit',
        'archive',
        'archiveBytes',
        'archiveSha256',
        'checksumSha256',
        'coreSha256',
        'runtimeLuaSha256',
        'artifactConfigSha256',
        'evidenceReference'
    )
    Assert-PropertySet -InputObject $Record -ExpectedNames $propertyNames -Reason 'provenance-fields-invalid'
    Assert-ExactProperty -InputObject $Record -Name 'schema' -Expected 1 -Reason 'provenance-schema-mismatch' -ReasonPrefix 'provenance'
    Assert-ExactProperty -InputObject $Record -Name 'sourceRepository' -Expected $ExpectedProvenanceRepository -Reason 'provenance-repository-mismatch' -ReasonPrefix 'provenance'
    Assert-ExactProperty -InputObject $Record -Name 'tag' -Expected $ExpectedTag -Reason 'provenance-tag-mismatch' -ReasonPrefix 'provenance'
    Assert-ExactProperty -InputObject $Record -Name 'commit' -Expected $ExpectedCommit -Reason 'provenance-commit-mismatch' -ReasonPrefix 'provenance'
    Assert-ExactProperty -InputObject $Record -Name 'archive' -Expected $ExpectedArchive -Reason 'provenance-archive-mismatch' -ReasonPrefix 'provenance'

    $kind = Get-RequiredProperty -InputObject $Record -Name 'kind' -ReasonPrefix 'provenance'
    if ($kind -isnot [string] -or $kind -notin @('verified-portable-directory', 'isolated-tag-rebuild')) {
        throw 'provenance-kind-invalid'
    }
    $reference = Get-RequiredProperty -InputObject $Record -Name 'evidenceReference' -ReasonPrefix 'provenance'
    if ($reference -isnot [string] -or $reference.Length -lt 8 -or $reference.Length -gt 512) {
        throw 'provenance-reference-invalid'
    }
    $recordArchiveHash = Assert-HashValue -Value (Get-RequiredProperty -InputObject $Record -Name 'archiveSha256' -ReasonPrefix 'provenance') -Name 'provenance.archiveSha256'
    $recordChecksumHash = Assert-HashValue -Value (Get-RequiredProperty -InputObject $Record -Name 'checksumSha256' -ReasonPrefix 'provenance') -Name 'provenance.checksumSha256'
    $recordCoreHash = Assert-HashValue -Value (Get-RequiredProperty -InputObject $Record -Name 'coreSha256' -ReasonPrefix 'provenance') -Name 'provenance.coreSha256'
    $recordRuntimeLuaHash = Assert-HashValue -Value (Get-RequiredProperty -InputObject $Record -Name 'runtimeLuaSha256' -ReasonPrefix 'provenance') -Name 'provenance.runtimeLuaSha256'
    $recordArtifactConfigHash = Assert-HashValue -Value (Get-RequiredProperty -InputObject $Record -Name 'artifactConfigSha256' -ReasonPrefix 'provenance') -Name 'provenance.artifactConfigSha256'
    $recordArchiveBytes = Assert-PositiveInteger -Value (Get-RequiredProperty -InputObject $Record -Name 'archiveBytes' -ReasonPrefix 'provenance') -Name 'provenance.archiveBytes'

    if ($recordArchiveBytes -ne $ArchiveBytes) {
        throw 'archive-size-mismatch'
    }
    if ($recordArchiveHash -cne $ArchiveSha256) {
        throw 'provenance-archive-hash-mismatch'
    }
    if ($recordChecksumHash -cne $ChecksumSha256) {
        throw 'provenance-checksum-hash-mismatch'
    }
    if ($recordCoreHash -cne $Inspection.CoreSha256) {
        throw 'provenance-core-hash-mismatch'
    }
    if ($recordRuntimeLuaHash -cne $Inspection.RuntimeLuaSha256) {
        throw 'provenance-runtime-lua-hash-mismatch'
    }
    if ($recordArtifactConfigHash -cne $Inspection.ArtifactConfigSha256) {
        throw 'provenance-artifact-config-hash-mismatch'
    }
    return $Record
}

function Assert-DirectoryPayload {
    param(
        [Parameter(Mandatory = $true)][string]$Directory,
        [Parameter(Mandatory = $true)][object]$Inspection
    )

    if (Test-Path -LiteralPath (Join-Path $Directory '.git')) {
        throw 'source-directory-git-worktree-rejected'
    }
    foreach ($reservedName in @($ExpectedArchive, $ExpectedChecksum, $ExpectedProvenanceRecord, $ExpectedBuildLog)) {
        if (Test-Path -LiteralPath (Join-Path $Directory $reservedName)) {
            throw 'source-directory-reserved-entry-rejected'
        }
    }
    $items = @(Get-ChildItem -LiteralPath $Directory -Recurse -Force)
    if ($items.Count -gt $MaximumEntryCount) {
        throw 'source-directory-entry-count-out-of-bounds'
    }
    [long]$totalBytes = 0
    foreach ($item in $items) {
        if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw 'source-directory-reparse-point-rejected'
        }
        if (-not $item.PSIsContainer) {
            $totalBytes += [long]$item.Length
            if ($totalBytes -gt $MaximumExpandedBytes) {
                throw 'source-directory-size-out-of-bounds'
            }
        }
    }

    $corePath = Join-Path $Directory 'janvim-core.exe'
    $runtimeLuaPath = Join-Path $Directory 'runtime\lua\janvim.lua'
    $artifactConfigPath = Join-Path $Directory 'assets\config.toml'
    Assert-RequiredFile -Path $corePath -Reason 'janvim-core-missing'
    Assert-RequiredFile -Path $runtimeLuaPath -Reason 'runtime-lua-missing'
    Assert-RequiredFile -Path $artifactConfigPath -Reason 'artifact-config-missing'
    Assert-RequiredFile -Path (Join-Path $Directory 'janvim-watchdog.exe') -Reason 'runtime-watchdog-missing'
    Assert-RequiredFile -Path (Join-Path $Directory 'nvim-win64\bin\nvim.exe') -Reason 'runtime-bundled-nvim-missing'
    Assert-RequiredFile -Path (Join-Path $Directory 'assets\nvim\init.lua') -Reason 'runtime-nvim-init-missing'
    Assert-RequiredFile -Path (Join-Path $Directory 'assets\layout-profiles\computer-mixed.toml') -Reason 'runtime-dynamic-profile-missing'
    Assert-RequiredFile -Path (Join-Path $Directory 'assets\fonts\private\FiraCodeNerdFontMono-Regular.ttf') -Reason 'runtime-font-missing'
    if ((Get-Item -LiteralPath $corePath).Length -lt $MinimumCoreBytes) {
        throw 'core-too-small'
    }
    if ((Get-Sha256Hex -Path $corePath) -cne $Inspection.CoreSha256) {
        throw 'directory-core-does-not-match-archive'
    }
    if ((Get-Sha256Hex -Path $runtimeLuaPath) -cne $Inspection.RuntimeLuaSha256) {
        throw 'directory-runtime-lua-does-not-match-archive'
    }
    if ((Get-Sha256Hex -Path $artifactConfigPath) -cne $Inspection.ArtifactConfigSha256) {
        throw 'directory-artifact-config-does-not-match-archive'
    }
}

function Assert-StagedPayload {
    param(
        [Parameter(Mandatory = $true)][string]$Directory,
        [Parameter(Mandatory = $true)][object]$Inspection
    )

    $corePath = Join-Path $Directory 'janvim-core.exe'
    $runtimeLuaPath = Join-Path $Directory 'runtime\lua\janvim.lua'
    $artifactConfigPath = Join-Path $Directory 'assets\config.toml'
    Assert-RequiredFile -Path $corePath -Reason 'janvim-core-missing'
    Assert-RequiredFile -Path $runtimeLuaPath -Reason 'runtime-lua-missing'
    Assert-RequiredFile -Path $artifactConfigPath -Reason 'artifact-config-missing'
    if ((Get-Item -LiteralPath $corePath).Length -lt $MinimumCoreBytes) {
        throw 'core-too-small'
    }
    if ((Get-Sha256Hex -Path $corePath) -cne $Inspection.CoreSha256) {
        throw 'staged-core-hash-mismatch'
    }
    if ((Get-Sha256Hex -Path $runtimeLuaPath) -cne $Inspection.RuntimeLuaSha256) {
        throw 'staged-runtime-lua-hash-mismatch'
    }
    if ((Get-Sha256Hex -Path $artifactConfigPath) -cne $Inspection.ArtifactConfigSha256) {
        throw 'staged-artifact-config-hash-mismatch'
    }
    foreach ($item in Get-ChildItem -LiteralPath $Directory -Recurse -Force) {
        if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw 'staged-reparse-point-rejected'
        }
    }
}

function Remove-OwnedStagingPath {
    param(
        [string]$Candidate,
        [Parameter(Mandatory = $true)][string]$Parent,
        [Parameter(Mandatory = $true)][string]$Prefix
    )

    if ([string]::IsNullOrWhiteSpace($Candidate) -or -not (Test-Path -LiteralPath $Candidate)) {
        return
    }
    $fullPath = [System.IO.Path]::GetFullPath($Candidate)
    if (-not (Test-PathInside -Candidate $fullPath -Parent $Parent) -or
        -not [System.IO.Path]::GetFileName($fullPath).StartsWith($Prefix, [System.StringComparison]::Ordinal)) {
        throw 'staging-cleanup-boundary-rejected'
    }
    Remove-Item -LiteralPath $fullPath -Recurse -Force
}

$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$markerPath = Join-Path $repositoryRoot 'AGENTS.md'
Assert-RequiredFile -Path $markerPath -Reason 'exhibition-repository-marker-missing'
if ((Get-Content -Raw -LiteralPath $markerPath) -notmatch 'JanVim Exhibition 2026') {
    throw 'exhibition-repository-marker-invalid'
}

$runtimeParent = [System.IO.Path]::GetFullPath((Join-Path $repositoryRoot 'runtime'))
$runtimeTarget = Join-Path $runtimeParent 'janvim'
$userRootTarget = Join-Path $runtimeParent 'user-root'
$lockPath = Join-Path $repositoryRoot 'janvim-artifact.lock.json'
$showConfigPath = Join-Path $repositoryRoot 'show\janvim-show.toml'

if (Test-Path -LiteralPath $runtimeTarget) {
    throw 'runtime-target-already-exists'
}
if (Test-Path -LiteralPath $userRootTarget) {
    throw 'user-root-target-already-exists'
}
if (Test-Path -LiteralPath $lockPath) {
    throw 'artifact-lock-already-exists'
}
Assert-ShowConfigForPreparation -ConfigPath $showConfigPath -RuntimeTarget $runtimeTarget -ExpectedLayout $LayoutEngine

if ($PSCmdlet.ParameterSetName -ceq 'Archive') {
    $archiveInput = Resolve-InputLeaf -Path $SourceArchive -Reason 'source-archive-missing' -RuntimeParent $runtimeParent
    $directoryInput = $null
}
else {
    $archiveInput = Resolve-InputLeaf -Path $ProvenanceArchive -Reason 'provenance-archive-missing' -RuntimeParent $runtimeParent
    $directoryInput = Resolve-InputContainer -Path $SourceDirectory -Reason 'source-directory-missing' -RuntimeParent $runtimeParent
}
if ([System.IO.Path]::GetFileName($archiveInput) -cne $ExpectedArchive) {
    throw 'archive-name-mismatch'
}
if ([string]::IsNullOrWhiteSpace($ArchiveSha256Path)) {
    $checksumCandidate = "$archiveInput.sha256"
}
else {
    $checksumCandidate = $ArchiveSha256Path
}
$checksumInput = Resolve-InputLeaf -Path $checksumCandidate -Reason 'archive-checksum-missing' -RuntimeParent $runtimeParent
if ([System.IO.Path]::GetFileName($checksumInput) -cne $ExpectedChecksum) {
    throw 'archive-checksum-name-mismatch'
}
$provenanceInput = Resolve-InputLeaf -Path $ProvenancePath -Reason 'provenance-record-missing' -RuntimeParent $runtimeParent
if ([System.IO.Path]::GetFileName($provenanceInput) -cne $ExpectedProvenanceRecord) {
    throw 'provenance-record-name-mismatch'
}

$archiveItem = Get-Item -LiteralPath $archiveInput
$archiveHash = Get-Sha256Hex -Path $archiveInput
$checksumHash = Get-Sha256Hex -Path $checksumInput
$provenanceHash = Get-Sha256Hex -Path $provenanceInput
$checksumLine = (Get-Content -Raw -LiteralPath $checksumInput).Trim()
if ($checksumLine -cnotmatch '^([0-9a-f]{64})  JanVim-win-x64\.zip$') {
    throw 'archive-checksum-format-invalid'
}
if ($Matches[1] -cne $archiveHash) {
    throw 'archive-checksum-mismatch'
}

$inspection = Get-ArchiveInspection -ArchivePath $archiveInput
$provenance = Read-JsonObject -Path $provenanceInput -Reason 'provenance-invalid-json'
$provenance = Assert-Provenance -Record $provenance -ArchiveBytes $archiveItem.Length -ArchiveSha256 $archiveHash -ChecksumSha256 $checksumHash -Inspection $inspection
$evidenceCandidate = Join-Path (Split-Path -Parent $provenanceInput) $ExpectedBuildLog
$evidenceInput = Resolve-InputLeaf -Path $evidenceCandidate -Reason 'build-evidence-missing' -RuntimeParent $runtimeParent
$evidenceItem = Get-Item -LiteralPath $evidenceInput
if ($evidenceItem.Length -lt 1 -or $evidenceItem.Length -gt $MaximumEvidenceBytes) {
    throw 'build-evidence-size-out-of-bounds'
}
$evidenceHash = Get-Sha256Hex -Path $evidenceInput
if ([string]$provenance.evidenceReference -cne "build-log-sha256:$evidenceHash") {
    throw 'build-evidence-hash-mismatch'
}
Assert-BuildEvidenceContent -Path $evidenceInput
if ($null -ne $directoryInput) {
    Assert-DirectoryPayload -Directory $directoryInput -Inspection $inspection
}

New-Item -ItemType Directory -Force -Path $runtimeParent | Out-Null
$operationId = [guid]::NewGuid().ToString('N')
$stagingRuntime = Join-Path $runtimeParent ".janvim-staging-$operationId"
$stagingUserRoot = Join-Path $runtimeParent ".user-root-staging-$operationId"
$temporaryLockPath = Join-Path $repositoryRoot ".janvim-artifact.lock.$operationId.tmp"

try {
    New-Item -ItemType Directory -Path $stagingRuntime | Out-Null
    if ($null -eq $directoryInput) {
        $stagedArchive = Join-Path $stagingRuntime $ExpectedArchive
        Copy-Item -LiteralPath $archiveInput -Destination $stagedArchive
        if ((Get-Sha256Hex -Path $stagedArchive) -cne $archiveHash) {
            throw 'staged-archive-copy-hash-mismatch'
        }
        Expand-Archive -LiteralPath $stagedArchive -DestinationPath $stagingRuntime
    }
    else {
        Get-ChildItem -LiteralPath $directoryInput -Force | Copy-Item -Destination $stagingRuntime -Recurse
        $stagedArchive = Join-Path $stagingRuntime $ExpectedArchive
        Copy-Item -LiteralPath $archiveInput -Destination $stagedArchive
    }
    $stagedChecksum = Join-Path $stagingRuntime $ExpectedChecksum
    $stagedProvenance = Join-Path $stagingRuntime $ExpectedProvenanceRecord
    Copy-Item -LiteralPath $checksumInput -Destination $stagedChecksum
    Copy-Item -LiteralPath $provenanceInput -Destination $stagedProvenance
    $stagedEvidence = Join-Path $stagingRuntime $ExpectedBuildLog
    Copy-Item -LiteralPath $evidenceInput -Destination $stagedEvidence
    if ((Get-Sha256Hex -Path $stagedArchive) -cne $archiveHash -or
        (Get-Sha256Hex -Path $stagedChecksum) -cne $checksumHash -or
        (Get-Sha256Hex -Path $stagedProvenance) -cne $provenanceHash -or
        (Get-Sha256Hex -Path $stagedEvidence) -cne $evidenceHash) {
        throw 'staged-evidence-copy-hash-mismatch'
    }
    Assert-StagedPayload -Directory $stagingRuntime -Inspection $inspection

    $agentSourceRoot = Join-Path $repositoryRoot 'nvim\lua\janvim_exhibition'
    if (-not (Test-Path -LiteralPath $agentSourceRoot -PathType Container)) {
        throw 'agent-source-missing'
    }
    $agentSourceFiles = @(Get-ChildItem -LiteralPath $agentSourceRoot -File)
    if ($agentSourceFiles.Count -lt 1 -or $agentSourceFiles.Count -gt 32) {
        throw 'agent-source-count-invalid'
    }
    $agentTargetRoot = Join-Path $stagingUserRoot 'plugin-lab\local\janvim-exhibition\lua\janvim_exhibition'
    New-Item -ItemType Directory -Force -Path $agentTargetRoot | Out-Null
    foreach ($agentFile in $agentSourceFiles) {
        Copy-Item -LiteralPath $agentFile.FullName -Destination (Join-Path $agentTargetRoot $agentFile.Name)
    }
    $pluginLabConfigPath = Join-Path $stagingUserRoot 'plugin-lab\config\init.lua'
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $pluginLabConfigPath) | Out-Null
    $pluginLabConfig = @'
return {
  {
    dir = vim.env.JANVIM_USER_ROOT .. "/plugin-lab/local/janvim-exhibition",
    name = "janvim-exhibition",
    lazy = false,
    config = function()
      require("janvim_exhibition").setup()
    end,
  },
}
'@
    [System.IO.File]::WriteAllText(
        $pluginLabConfigPath,
        $pluginLabConfig,
        [System.Text.UTF8Encoding]::new($false)
    )
    foreach ($agentFile in $agentSourceFiles) {
        $copiedAgent = Join-Path $agentTargetRoot $agentFile.Name
        if ((Get-Sha256Hex -Path $agentFile.FullName) -cne (Get-Sha256Hex -Path $copiedAgent)) {
            throw "agent-copy-hash-mismatch:$($agentFile.Name)"
        }
    }

    if ((Get-Sha256Hex -Path $archiveInput) -cne $archiveHash -or
        (Get-Sha256Hex -Path $checksumInput) -cne $checksumHash -or
        (Get-Sha256Hex -Path $provenanceInput) -cne $provenanceHash -or
        (Get-Sha256Hex -Path $evidenceInput) -cne $evidenceHash) {
        throw 'source-evidence-changed-during-prepare'
    }
    if ($null -ne $directoryInput) {
        Assert-DirectoryPayload -Directory $directoryInput -Inspection $inspection
    }

    $corePath = Join-Path $stagingRuntime 'janvim-core.exe'
    $runtimeLuaPath = Join-Path $stagingRuntime 'runtime\lua\janvim.lua'
    $artifactConfigPath = Join-Path $stagingRuntime 'assets\config.toml'
    $lock = [ordered]@{
        schema = 1
        sourceRepository = $ExpectedSourceRepository
        tag = $ExpectedTag
        commit = $ExpectedCommit
        archive = $ExpectedArchive
        archiveBytes = [long](Get-Item -LiteralPath $stagedArchive).Length
        archiveSha256 = Get-Sha256Hex -Path $stagedArchive
        checksum = $ExpectedChecksum
        checksumSha256 = Get-Sha256Hex -Path $stagedChecksum
        core = 'janvim-core.exe'
        coreBytes = [long](Get-Item -LiteralPath $corePath).Length
        coreSha256 = Get-Sha256Hex -Path $corePath
        runtimeLua = 'runtime/lua/janvim.lua'
        runtimeLuaSha256 = Get-Sha256Hex -Path $runtimeLuaPath
        artifactConfig = 'assets/config.toml'
        artifactConfigSha256 = Get-Sha256Hex -Path $artifactConfigPath
        config = 'show/janvim-show.toml'
        configSha256 = Get-Sha256Hex -Path $showConfigPath
        layoutEngine = $LayoutEngine
        role = 'primary-projector'
        provenanceKind = [string]$provenance.kind
        provenanceReference = [string]$provenance.evidenceReference
        provenanceRecord = $ExpectedProvenanceRecord
        provenanceSha256 = Get-Sha256Hex -Path $stagedProvenance
        evidenceRecord = $ExpectedBuildLog
        evidenceSha256 = Get-Sha256Hex -Path $stagedEvidence
        pluginLabConfig = 'runtime/user-root/plugin-lab/config/init.lua'
        pluginLabConfigSha256 = Get-Sha256Hex -Path $pluginLabConfigPath
    }
    foreach ($name in @(
        'archiveSha256',
        'checksumSha256',
        'coreSha256',
        'runtimeLuaSha256',
        'artifactConfigSha256',
        'configSha256',
        'provenanceSha256',
        'evidenceSha256',
        'pluginLabConfigSha256'
    )) {
        [void](Assert-HashValue -Value $lock[$name] -Name $name)
    }
    $lockJson = ($lock | ConvertTo-Json -Depth 8).Replace("`r`n", "`n").Replace("`r", "`n")
    [System.IO.File]::WriteAllText(
        $temporaryLockPath,
        $lockJson + "`n",
        [System.Text.UTF8Encoding]::new($false)
    )
    $roundTripLock = Read-JsonObject -Path $temporaryLockPath -Reason 'generated-lock-invalid-json'
    Assert-ExactProperty -InputObject $roundTripLock -Name 'tag' -Expected $ExpectedTag -Reason 'generated-lock-tag-mismatch' -ReasonPrefix 'generated-lock'
    Assert-ExactProperty -InputObject $roundTripLock -Name 'commit' -Expected $ExpectedCommit -Reason 'generated-lock-commit-mismatch' -ReasonPrefix 'generated-lock'
    if ((Get-RequiredProperty -InputObject $roundTripLock -Name 'archiveSha256' -ReasonPrefix 'generated-lock') -cne $archiveHash -or
        (Get-RequiredProperty -InputObject $roundTripLock -Name 'coreSha256' -ReasonPrefix 'generated-lock') -cne $inspection.CoreSha256 -or
        (Get-RequiredProperty -InputObject $roundTripLock -Name 'configSha256' -ReasonPrefix 'generated-lock') -cne (Get-Sha256Hex -Path $showConfigPath)) {
        throw 'generated-lock-byte-verification-failed'
    }

    if (Test-Path -LiteralPath $runtimeTarget) {
        throw 'runtime-target-created-during-prepare'
    }
    if (Test-Path -LiteralPath $userRootTarget) {
        throw 'user-root-target-created-during-prepare'
    }
    if (Test-Path -LiteralPath $lockPath) {
        throw 'artifact-lock-created-during-prepare'
    }
    Move-Item -LiteralPath $stagingRuntime -Destination $runtimeTarget
    $stagingRuntime = $null
    Move-Item -LiteralPath $stagingUserRoot -Destination $userRootTarget
    $stagingUserRoot = $null
    Move-Item -LiteralPath $temporaryLockPath -Destination $lockPath
    $temporaryLockPath = $null

    [ordered]@{
        schema = 1
        status = 'runtime-prepared'
        tag = $ExpectedTag
        commit = $ExpectedCommit
        archiveSha256 = $archiveHash
        coreSha256 = $inspection.CoreSha256
        layoutEngine = $LayoutEngine
    } | ConvertTo-Json -Depth 4 -Compress
}
finally {
    Remove-OwnedStagingPath -Candidate $stagingRuntime -Parent $runtimeParent -Prefix '.janvim-staging-'
    Remove-OwnedStagingPath -Candidate $stagingUserRoot -Parent $runtimeParent -Prefix '.user-root-staging-'
    if (-not [string]::IsNullOrWhiteSpace($temporaryLockPath) -and
        (Test-Path -LiteralPath $temporaryLockPath -PathType Leaf)) {
        $expectedLockPrefix = Join-Path $repositoryRoot '.janvim-artifact.lock.'
        $fullTemporaryLock = [System.IO.Path]::GetFullPath($temporaryLockPath)
        if (-not $fullTemporaryLock.StartsWith($expectedLockPrefix, [System.StringComparison]::OrdinalIgnoreCase) -or
            -not $fullTemporaryLock.EndsWith('.tmp', [System.StringComparison]::Ordinal)) {
            throw 'temporary-lock-cleanup-boundary-rejected'
        }
        [System.IO.File]::Delete($fullTemporaryLock)
    }
}
