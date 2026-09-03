[CmdletBinding(PositionalBinding = $false)]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-z0-9]+(?:-[a-z0-9]+)*$')]
    [string]$Profile
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$expectedContentLockSha256 = '5d27312d2dfd3ccebc28771314df1846e50fcd724effabfe8dc83c0577ffd08d'
$expectedContentLockBytes = 2332L
$expectedPoemSha256 = 'b699de273f5bbaedb08241495f52ce863d3e8e1851275ce3b6251484d75190a8'
$allowedProfiles = @('p0-baseline', 'songfeng-source', 'river-channel', 'tower-codebook')
$maximumContentLockBytes = 32768L
$maximumPaperBytes = 32768L
$maximumManifestBytes = 131072L
$maximumPoemBytes = 65536L

function Get-ExactSha256 {
    param([Parameter(Mandatory = $true)][byte[]]$Bytes)

    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        return [Convert]::ToHexString($sha.ComputeHash($Bytes)).ToLowerInvariant()
    }
    finally {
        $sha.Dispose()
    }
}

function Read-BoundedBytes {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][long]$MaximumBytes,
        [Parameter(Mandatory = $true)][string]$Reason
    )

    $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    if (
        $item.PSIsContainer -or
        ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
        $item.Length -lt 1 -or
        $item.Length -gt $MaximumBytes
    ) {
        throw $Reason
    }
    $bytes = [IO.File]::ReadAllBytes($item.FullName)
    if ($bytes.LongLength -ne $item.Length) {
        throw $Reason
    }
    return [pscustomobject]@{
        Bytes = $bytes
        ByteLength = [long]$bytes.LongLength
        Sha256 = Get-ExactSha256 -Bytes $bytes
    }
}

function Convert-BoundedJson {
    param(
        [Parameter(Mandatory = $true)][pscustomobject]$Snapshot,
        [Parameter(Mandatory = $true)][string]$Reason
    )

    try {
        $utf8 = [Text.UTF8Encoding]::new($false, $true)
        $text = $utf8.GetString($Snapshot.Bytes)
        return $text | ConvertFrom-Json -Depth 64 -NoEnumerate -ErrorAction Stop
    }
    catch {
        throw $Reason
    }
}

function Assert-ExactProperties {
    param(
        [Parameter(Mandatory = $true)][object]$Value,
        [Parameter(Mandatory = $true)][string[]]$Names,
        [Parameter(Mandatory = $true)][string]$Reason
    )

    if ($null -eq $Value -or $Value -is [string]) {
        throw $Reason
    }
    $actual = @($Value.PSObject.Properties.Name | Sort-Object -CaseSensitive)
    $expected = @($Names | Sort-Object -CaseSensitive)
    if ($actual.Count -ne $expected.Count) {
        throw $Reason
    }
    for ($index = 0; $index -lt $expected.Count; $index++) {
        if ($actual[$index] -cne $expected[$index]) {
            throw $Reason
        }
    }
}

function Get-Property {
    param(
        [Parameter(Mandatory = $true)][object]$Value,
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Reason
    )

    $property = $Value.PSObject.Properties[$Name]
    if ($null -eq $property -or $null -eq $property.Value) {
        throw $Reason
    }
    return $property.Value
}

function Test-ExactInteger {
    param([object]$Value, [long]$Expected)

    return (
        $Value -is [ValueType] -and
        $Value -isnot [double] -and
        $Value -isnot [single] -and
        [long]$Value -eq $Expected
    )
}

function Resolve-LockedPath {
    param(
        [Parameter(Mandatory = $true)][string]$RepositoryRoot,
        [Parameter(Mandatory = $true)][string]$RelativePath,
        [Parameter(Mandatory = $true)][string]$ExpectedRelativePath,
        [Parameter(Mandatory = $true)][string]$Reason
    )

    if ($RelativePath -cne $ExpectedRelativePath -or $RelativePath -notmatch '^[a-zA-Z0-9./-]+$') {
        throw $Reason
    }
    $resolved = [IO.Path]::GetFullPath((Join-Path $RepositoryRoot ($RelativePath.Replace('/', '\'))))
    $prefix = $RepositoryRoot.TrimEnd('\') + '\'
    if (-not $resolved.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw $Reason
    }
    return $resolved
}

function Assert-LockedFile {
    param(
        [Parameter(Mandatory = $true)][object]$Record,
        [Parameter(Mandatory = $true)][string]$ExpectedPath,
        [Parameter(Mandatory = $true)][string]$RepositoryRoot,
        [Parameter(Mandatory = $true)][long]$MaximumBytes,
        [Parameter(Mandatory = $true)][string]$Reason
    )

    Assert-ExactProperties -Value $Record -Names @('path', 'bytes', 'sha256') -Reason $Reason
    $relativePath = Get-Property -Value $Record -Name 'path' -Reason $Reason
    $expectedBytes = Get-Property -Value $Record -Name 'bytes' -Reason $Reason
    $expectedHash = Get-Property -Value $Record -Name 'sha256' -Reason $Reason
    if (
        $relativePath -isnot [string] -or
        $expectedHash -isnot [string] -or
        $expectedHash -cnotmatch '^[0-9a-f]{64}$' -or
        -not (Test-ExactInteger -Value $expectedBytes -Expected ([long]$expectedBytes)) -or
        [long]$expectedBytes -lt 1 -or
        [long]$expectedBytes -gt $MaximumBytes
    ) {
        throw $Reason
    }
    $path = Resolve-LockedPath `
        -RepositoryRoot $RepositoryRoot `
        -RelativePath $relativePath `
        -ExpectedRelativePath $ExpectedPath `
        -Reason $Reason
    $snapshot = Read-BoundedBytes -Path $path -MaximumBytes $MaximumBytes -Reason $Reason
    if (
        $snapshot.ByteLength -ne [long]$expectedBytes -or
        $snapshot.Sha256 -cne $expectedHash
    ) {
        throw $Reason
    }
    return [pscustomobject]@{ Path = $path; Snapshot = $snapshot }
}

function Assert-ManifestContract {
    param(
        [Parameter(Mandatory = $true)][object]$Manifest,
        [Parameter(Mandatory = $true)][string]$ProfileId,
        [Parameter(Mandatory = $true)][string]$ExpectedRevision,
        [Parameter(Mandatory = $true)][string]$Reason
    )

    Assert-ExactProperties `
        -Value $Manifest `
        -Names @('schema', 'loopId', 'loopDurationMs', 'poemSha256', 'contentRevision', 'preparedBy', 'cues') `
        -Reason $Reason
    if (
        -not (Test-ExactInteger -Value (Get-Property $Manifest 'schema' $Reason) -Expected 1) -or
        (Get-Property $Manifest 'contentRevision' $Reason) -cne $ExpectedRevision -or
        (Get-Property $Manifest 'poemSha256' $Reason) -cne $expectedPoemSha256
    ) {
        throw $Reason
    }
    $duration = Get-Property $Manifest 'loopDurationMs' $Reason
    $expectedDuration = 90000L
    if (-not (Test-ExactInteger -Value $duration -Expected $expectedDuration)) {
        throw $Reason
    }
    $cues = @(Get-Property $Manifest 'cues' $Reason)
    if ($cues.Count -lt 1 -or $cues.Count -gt 256) {
        throw $Reason
    }
    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    $previousAt = -1L
    $insertCount = 0
    $moveCount = 0
    $resetCount = 0
    foreach ($cue in $cues) {
        Assert-ExactProperties -Value $cue -Names @('id', 'atMs', 'target', 'kind', 'payload') -Reason $Reason
        $cueId = Get-Property $cue 'id' $Reason
        $atMs = Get-Property $cue 'atMs' $Reason
        $kind = Get-Property $cue 'kind' $Reason
        if (
            $cueId -isnot [string] -or
            [string]::IsNullOrWhiteSpace($cueId) -or
            -not $seen.Add($cueId) -or
            -not (Test-ExactInteger -Value $atMs -Expected ([long]$atMs)) -or
            [long]$atMs -lt $previousAt -or
            [long]$atMs -gt $expectedDuration
        ) {
            throw $Reason
        }
        $previousAt = [long]$atMs
        if ($kind -ceq 'editor-action') {
            $payload = Get-Property $cue 'payload' $Reason
            Assert-ExactProperties -Value $payload -Names @('action', 'displayKeys', 'semanticLabel', 'critical') -Reason $Reason
            $action = Get-Property $payload 'action' $Reason
            $type = Get-Property $action 'type' $Reason
            if ($type -ceq 'insert') {
                Assert-ExactProperties -Value $action -Names @('type', 'text', 'charsPerSecond') -Reason $Reason
                $text = Get-Property $action 'text' $Reason
                if ($text -isnot [string] -or [Text.Encoding]::UTF8.GetByteCount($text) -gt 512) {
                    throw $Reason
                }
                $insertCount++
            }
            elseif ($type -ceq 'move') {
                Assert-ExactProperties -Value $action -Names @('type', 'keys', 'repeat') -Reason $Reason
                $keys = Get-Property $action 'keys' $Reason
                $repeat = Get-Property $action 'repeat' $Reason
                if (
                    $keys -cnotin @('h', 'j', 'k', 'l', 'w', 'b', 'e', '0', '$', 'G') -or
                    -not (Test-ExactInteger -Value $repeat -Expected ([long]$repeat)) -or
                    [long]$repeat -lt 0 -or
                    [long]$repeat -gt 256
                ) {
                    throw $Reason
                }
                $moveCount++
            }
            elseif ($type -ceq 'reset') {
                Assert-ExactProperties -Value $action -Names @('type') -Reason $Reason
                $resetCount++
            }
        }
    }
    $final = $cues[-1]
    $finalPayload = Get-Property $final 'payload' $Reason
    $finalAction = Get-Property $finalPayload 'action' $Reason
    if (
        (Get-Property $final 'kind' $Reason) -cne 'editor-action' -or
        (Get-Property $final 'target' $Reason) -cne 'both' -or
        -not (Test-ExactInteger -Value (Get-Property $final 'atMs' $Reason) -Expected $expectedDuration) -or
        (Get-Property $finalAction 'type' $Reason) -cne 'reset' -or
        $resetCount -ne 1
    ) {
        throw 'content-profile-reset-invalid'
    }
    if (
        $ProfileId -cne 'p0-baseline' -and
        ($insertCount -lt 12 -or $insertCount -gt 18 -or $moveCount -lt 18 -or $moveCount -gt 28)
    ) {
        throw $Reason
    }
}

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
$agentsPath = Join-Path $repositoryRoot 'AGENTS.md'
if (
    -not (Test-Path -LiteralPath $agentsPath -PathType Leaf) -or
    (Get-Content -Raw -LiteralPath $agentsPath) -cnotmatch 'JanVim Exhibition 2026 agent instructions'
) {
    throw 'exhibition-repository-marker-invalid'
}

$lockPath = Join-Path $repositoryRoot 'content\p0.1\content-lock.json'
$lockSnapshot = Read-BoundedBytes -Path $lockPath -MaximumBytes $maximumContentLockBytes -Reason 'content-lock-size-invalid'
if (
    $lockSnapshot.ByteLength -ne $expectedContentLockBytes -or
    $lockSnapshot.Sha256 -cne $expectedContentLockSha256
) {
    throw 'content-lock-hash-mismatch'
}
$lock = Convert-BoundedJson -Snapshot $lockSnapshot -Reason 'content-lock-invalid'
Assert-ExactProperties -Value $lock -Names @('schema', 'revision', 'poem', 'profiles') -Reason 'content-lock-invalid'
if (
    -not (Test-ExactInteger -Value (Get-Property $lock 'schema' 'content-lock-invalid') -Expected 1) -or
    (Get-Property $lock 'revision' 'content-lock-invalid') -cne '20260902-p0.1-r8'
) {
    throw 'content-lock-invalid'
}
$profiles = @(Get-Property $lock 'profiles' 'content-lock-invalid')
if ($profiles.Count -ne $allowedProfiles.Count) {
    throw 'content-profile-allowlist-invalid'
}
$selected = $null
for ($index = 0; $index -lt $allowedProfiles.Count; $index++) {
    $record = $profiles[$index]
    Assert-ExactProperties -Value $record -Names @('id', 'title', 'revision', 'paper', 'manifest') -Reason 'content-profile-record-invalid'
    if ((Get-Property $record 'id' 'content-profile-record-invalid') -cne $allowedProfiles[$index]) {
        throw 'content-profile-allowlist-invalid'
    }
    if ($allowedProfiles[$index] -ceq $Profile) {
        $selected = $record
    }
}
if ($null -eq $selected) {
    throw 'content-profile-not-allowlisted'
}

$poem = Assert-LockedFile `
    -Record (Get-Property $lock 'poem' 'content-lock-invalid') `
    -ExpectedPath 'content/fixture/poem.txt' `
    -RepositoryRoot $repositoryRoot `
    -MaximumBytes $maximumPoemBytes `
    -Reason 'content-poem-invalid'
if ($poem.Snapshot.Sha256 -cne $expectedPoemSha256) {
    throw 'content-poem-invalid'
}
$profileId = Get-Property $selected 'id' 'content-profile-record-invalid'
$revision = Get-Property $selected 'revision' 'content-profile-record-invalid'
$paper = Assert-LockedFile `
    -Record (Get-Property $selected 'paper' 'content-profile-record-invalid') `
    -ExpectedPath "content/p0.1/profiles/$profileId/paper.md" `
    -RepositoryRoot $repositoryRoot `
    -MaximumBytes $maximumPaperBytes `
    -Reason 'content-profile-paper-invalid'
$manifestFile = Assert-LockedFile `
    -Record (Get-Property $selected 'manifest' 'content-profile-record-invalid') `
    -ExpectedPath "content/p0.1/profiles/$profileId/show.manifest.json" `
    -RepositoryRoot $repositoryRoot `
    -MaximumBytes $maximumManifestBytes `
    -Reason 'content-profile-manifest-invalid'
$manifest = Convert-BoundedJson -Snapshot $manifestFile.Snapshot -Reason 'content-profile-manifest-invalid'
Assert-ManifestContract `
    -Manifest $manifest `
    -ProfileId $profileId `
    -ExpectedRevision $revision `
    -Reason 'content-profile-manifest-invalid'

$activePath = Join-Path $repositoryRoot 'content\fixture\show.manifest.json'
$activeBefore = Read-BoundedBytes -Path $activePath -MaximumBytes $maximumManifestBytes -Reason 'active-manifest-invalid'
$outcome = 'already-active'
if (
    $activeBefore.ByteLength -ne $manifestFile.Snapshot.ByteLength -or
    $activeBefore.Sha256 -cne $manifestFile.Snapshot.Sha256
) {
    $temporaryPath = "$activePath.profile-$PID-$([Guid]::NewGuid().ToString('N')).tmp"
    try {
        $stream = [IO.FileStream]::new(
            $temporaryPath,
            [IO.FileMode]::CreateNew,
            [IO.FileAccess]::Write,
            [IO.FileShare]::None,
            4096,
            [IO.FileOptions]::WriteThrough
        )
        try {
            $stream.Write($manifestFile.Snapshot.Bytes, 0, $manifestFile.Snapshot.Bytes.Length)
            $stream.Flush($true)
        }
        finally {
            $stream.Dispose()
        }
        $temporary = Read-BoundedBytes -Path $temporaryPath -MaximumBytes $maximumManifestBytes -Reason 'profile-stage-verification-failed'
        if (
            $temporary.ByteLength -ne $manifestFile.Snapshot.ByteLength -or
            $temporary.Sha256 -cne $manifestFile.Snapshot.Sha256
        ) {
            throw 'profile-stage-verification-failed'
        }
        [IO.File]::Move($temporaryPath, $activePath, $true)
        $outcome = 'applied'
    }
    finally {
        if (Test-Path -LiteralPath $temporaryPath -PathType Leaf) {
            [IO.File]::Delete($temporaryPath)
        }
    }
}

$activeAfter = Read-BoundedBytes -Path $activePath -MaximumBytes $maximumManifestBytes -Reason 'active-manifest-invalid'
if (
    $activeAfter.ByteLength -ne $manifestFile.Snapshot.ByteLength -or
    $activeAfter.Sha256 -cne $manifestFile.Snapshot.Sha256
) {
    throw 'profile-stage-verification-failed'
}

[ordered]@{
    schema = 1
    profile = $profileId
    title = Get-Property $selected 'title' 'content-profile-record-invalid'
    revision = $revision
    outcome = $outcome
    manifestBytes = $manifestFile.Snapshot.ByteLength
    manifestSha256 = $manifestFile.Snapshot.Sha256
    paperBytes = $paper.Snapshot.ByteLength
    paperSha256 = $paper.Snapshot.Sha256
    poemSha256 = $poem.Snapshot.Sha256
} | ConvertTo-Json -Compress
