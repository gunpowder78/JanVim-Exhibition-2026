<#
.SYNOPSIS
Runs one attended joint-rehearsal operator action.

.DESCRIPTION
Prepare creates a fresh session and prints SESSION_FILE. Pass that exact file to
Sound, Show, Status, or StopSound. If DisplayMapPath or SessionFile is omitted,
the script prompts for the explicit path; it never searches for a recent run.

.PARAMETER Listen
Enables hardware sound only for this Sound invocation. Sound is silent by default.

.PARAMETER InstrumentProfile
Selects the opt-in sound profile for this Sound invocation. The default preserves
LegacyPluckV1; StoneAndSignalV2 remains an attended candidate.
#>
[CmdletBinding(PositionalBinding = $false)]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Prepare', 'Sound', 'Show', 'Status', 'StopSound')]
    [string] $Action,

    [string] $SessionFile,

    [string] $DisplayMapPath,

    [ValidateRange(0, 3600)]
    [int] $Duration = 600,

    [switch] $Listen,

    [ValidateSet('LegacyPluckV1', 'StoneAndSignalV2')]
    [string] $InstrumentProfile = 'LegacyPluckV1',

    [switch] $OfflineRequired,

    [ValidateSet('Operator', 'Automatic')]
    [string] $StartPolicy = 'Operator',

    [string] $NodeExecutable
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$rehearsalParent = 'D:\VirtualData\JanVim-Exhibition-Rehearsals'
$maximumSessionBytes = 4096
$maximumDisplayMapBytes = 65536
$maximumReadyBytes = 65536
$maximumSummaryBytes = 65536
$maximumReceiptBytes = 4096

function Resolve-AbsolutePath {
    param(
        [Parameter(Mandatory = $true)][string] $Path,
        [Parameter(Mandatory = $true)][string] $Reason
    )

    if ([string]::IsNullOrWhiteSpace($Path) -or -not [IO.Path]::IsPathFullyQualified($Path)) {
        throw "$Reason path must be absolute"
    }
    try {
        $resolved = [IO.Path]::GetFullPath($Path)
    }
    catch {
        throw "$Reason path is invalid"
    }
    if ($resolved.Length -gt 3) {
        $resolved = $resolved.TrimEnd([char[]]@('\', '/'))
    }
    return $resolved
}

function Test-SamePath {
    param(
        [Parameter(Mandatory = $true)][string] $Left,
        [Parameter(Mandatory = $true)][string] $Right
    )

    return [string]::Equals(
        (Resolve-AbsolutePath -Path $Left -Reason 'left'),
        (Resolve-AbsolutePath -Path $Right -Reason 'right'),
        [StringComparison]::OrdinalIgnoreCase
    )
}

function Assert-ExactLeaf {
    param(
        [Parameter(Mandatory = $true)][string] $Path,
        [Parameter(Mandatory = $true)][string] $Reason
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "$Reason missing"
    }
    $item = Get-Item -LiteralPath $Path -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "$Reason path escape rejected"
    }
    $providerPath = (Resolve-Path -LiteralPath $Path).ProviderPath
    if (-not (Test-SamePath -Left $providerPath -Right $Path)) {
        throw "$Reason path escape rejected"
    }
    return $item
}

function Assert-ExactDirectory {
    param(
        [Parameter(Mandatory = $true)][string] $Path,
        [Parameter(Mandatory = $true)][string] $Reason
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        throw "$Reason missing"
    }
    $item = Get-Item -LiteralPath $Path -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "$Reason path escape rejected"
    }
    $providerPath = (Resolve-Path -LiteralPath $Path).ProviderPath
    if (-not (Test-SamePath -Left $providerPath -Right $Path)) {
        throw "$Reason path escape rejected"
    }
}

function Read-BoundedBytes {
    param(
        [Parameter(Mandatory = $true)][string] $Path,
        [Parameter(Mandatory = $true)][int] $MaximumBytes,
        [Parameter(Mandatory = $true)][string] $Reason
    )

    $item = Assert-ExactLeaf -Path $Path -Reason $Reason
    if ($item.Length -gt $MaximumBytes) {
        throw "$Reason size limit exceeded"
    }
    $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    try {
        if ($stream.Length -gt $MaximumBytes) {
            throw "$Reason size limit exceeded"
        }
        $bytes = [byte[]]::new([int]$stream.Length)
        $offset = 0
        while ($offset -lt $bytes.Length) {
            $count = $stream.Read($bytes, $offset, $bytes.Length - $offset)
            if ($count -eq 0) {
                throw "$Reason short read"
            }
            $offset += $count
        }
        if ($stream.ReadByte() -ne -1) {
            throw "$Reason size limit exceeded"
        }
        return ,$bytes
    }
    finally {
        $stream.Dispose()
    }
}

function Read-BoundedJson {
    param(
        [Parameter(Mandatory = $true)][string] $Path,
        [Parameter(Mandatory = $true)][int] $MaximumBytes,
        [Parameter(Mandatory = $true)][string] $Reason
    )

    $bytes = Read-BoundedBytes -Path $Path -MaximumBytes $MaximumBytes -Reason $Reason
    try {
        $text = [Text.UTF8Encoding]::new($false, $true).GetString($bytes)
        return $text | ConvertFrom-Json -NoEnumerate
    }
    catch {
        throw "$Reason invalid JSON"
    }
}

function Assert-ExactProperties {
    param(
        [Parameter(Mandatory = $true)] $Value,
        [Parameter(Mandatory = $true)][string[]] $Expected,
        [Parameter(Mandatory = $true)][string] $Reason
    )

    if ($null -eq $Value -or $Value -isnot [pscustomobject]) {
        throw "$Reason schema invalid"
    }
    $actual = @($Value.PSObject.Properties.Name | Sort-Object)
    $wanted = @($Expected | Sort-Object)
    if ($actual.Count -ne $wanted.Count -or (Compare-Object -ReferenceObject $wanted -DifferenceObject $actual)) {
        throw "$Reason schema invalid"
    }
}

function Test-JsonInteger {
    param($Value)

    return $Value -is [byte] -or $Value -is [sbyte] -or
        $Value -is [int16] -or $Value -is [uint16] -or
        $Value -is [int32] -or $Value -is [uint32] -or
        $Value -is [int64] -or $Value -is [uint64]
}

function New-ControlledPaths {
    param([Parameter(Mandatory = $true)][string] $SessionId)

    return [pscustomobject]@{
        SessionId = $SessionId
        SessionRoot = Join-Path $rehearsalParent "joint-session-$SessionId"
        SessionFile = Join-Path $rehearsalParent "joint-session-$SessionId\session.json"
        SoundRoot = Join-Path $rehearsalParent "joint-sound-$SessionId"
        ValidateRoot = Join-Path $rehearsalParent "joint-validate-$SessionId"
        ShowRoot = Join-Path $rehearsalParent "joint-show-$SessionId"
    }
}

function Read-OperatorSession {
    param([Parameter(Mandatory = $true)][string] $Path)

    $resolvedPath = Resolve-AbsolutePath -Path $Path -Reason 'operator session'
    $sessionRoot = [IO.Path]::GetDirectoryName($resolvedPath)
    if (
        [IO.Path]::GetFileName($resolvedPath) -cne 'session.json' -or
        -not (Test-SamePath -Left ([IO.Path]::GetDirectoryName($sessionRoot)) -Right $rehearsalParent) -or
        [IO.Path]::GetFileName($sessionRoot) -cnotmatch '^joint-session-'
    ) {
        throw 'operator session path escape rejected'
    }
    Assert-ExactDirectory -Path $sessionRoot -Reason 'operator session directory'
    $session = Read-BoundedJson -Path $resolvedPath -MaximumBytes $maximumSessionBytes -Reason 'operator session'
    Assert-ExactProperties -Value $session -Expected @('version', 'sessionId', 'duration') -Reason 'operator session'
    if (
        -not (Test-JsonInteger -Value $session.version) -or [long]$session.version -ne 1 -or
        $session.sessionId -isnot [string] -or $session.sessionId -cnotmatch '^\d{8}T\d{9}Z-[0-9a-f]{12}$' -or
        -not (Test-JsonInteger -Value $session.duration) -or
        [long]$session.duration -lt 0 -or [long]$session.duration -gt 3600
    ) {
        throw 'operator session schema invalid'
    }
    $paths = New-ControlledPaths -SessionId $session.sessionId
    if (-not (Test-SamePath -Left $resolvedPath -Right $paths.SessionFile)) {
        throw 'operator session path escape rejected'
    }
    $paths | Add-Member -NotePropertyName Duration -NotePropertyValue ([int]$session.duration)
    return $paths
}

function Write-NewBytes {
    param(
        [Parameter(Mandatory = $true)][string] $Path,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][byte[]] $Bytes
    )

    $stream = [IO.File]::Open($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
    try {
        $stream.Write($Bytes, 0, $Bytes.Length)
        $stream.Flush($true)
    }
    finally {
        $stream.Dispose()
    }
}

function Assert-ReadyShape {
    param(
        [Parameter(Mandatory = $true)] $Ready,
        [Parameter(Mandatory = $true)][string] $SoundRoot
    )

    foreach ($name in @('version', 'runRoot', 'duration', 'mode', 'nodePid', 'nodeExecutable', 'session', 'service')) {
        if ($null -eq $Ready.PSObject.Properties[$name]) {
            throw 'sound ready schema invalid'
        }
    }
    if (
        -not (Test-JsonInteger -Value $Ready.version) -or [long]$Ready.version -ne 1 -or
        $Ready.runRoot -isnot [string] -or -not (Test-SamePath -Left $Ready.runRoot -Right $SoundRoot) -or
        -not (Test-JsonInteger -Value $Ready.duration) -or
        [long]$Ready.duration -lt 0 -or [long]$Ready.duration -gt 3600 -or
        $Ready.mode -isnot [string] -or $Ready.mode -cnotin @('silent', 'listen') -or
        -not (Test-JsonInteger -Value $Ready.nodePid) -or [long]$Ready.nodePid -lt 1 -or
        $Ready.nodeExecutable -isnot [string] -or -not [IO.Path]::IsPathFullyQualified($Ready.nodeExecutable) -or
        $Ready.session -isnot [string] -or [string]::IsNullOrWhiteSpace($Ready.session) -or
        $Ready.service -isnot [pscustomobject] -or
        $Ready.service.PSObject.Properties['session'] -eq $null -or
        $Ready.service.PSObject.Properties['hardwareOutput'] -eq $null -or
        $Ready.service.session -cne $Ready.session -or
        $Ready.service.hardwareOutput -isnot [bool] -or
        [bool]$Ready.service.hardwareOutput -ne ($Ready.mode -ceq 'listen')
    ) {
        throw 'sound ready schema invalid'
    }
}

function Assert-ControlShape {
    param(
        [Parameter(Mandatory = $true)] $Control,
        [Parameter(Mandatory = $true)][string] $SoundRoot
    )

    foreach ($name in @('version', 'active', 'host', 'port', 'runRoot', 'token', 'input')) {
        if ($null -eq $Control.PSObject.Properties[$name]) {
            throw 'sound control schema invalid'
        }
    }
    if (
        -not (Test-JsonInteger -Value $Control.version) -or [long]$Control.version -ne 1 -or
        $Control.active -isnot [bool] -or
        $Control.host -cne '127.0.0.1' -or
        -not (Test-JsonInteger -Value $Control.port) -or [long]$Control.port -lt 1 -or [long]$Control.port -gt 65535 -or
        $Control.runRoot -isnot [string] -or -not (Test-SamePath -Left $Control.runRoot -Right $SoundRoot) -or
        $Control.input -cne 'real-cursor' -or
        $Control.token -isnot [string] -or $Control.token -cnotmatch '^[0-9a-f]{64}$'
    ) {
        throw 'sound control schema invalid'
    }
}

function Read-SoundState {
    param([Parameter(Mandatory = $true)] $Paths)

    if (-not (Test-Path -LiteralPath $Paths.SoundRoot)) {
        return [pscustomobject]@{ Status = 'NOT_STARTED' }
    }
    Assert-ExactDirectory -Path $Paths.SoundRoot -Reason 'sound root'
    $summaryPath = Join-Path $Paths.SoundRoot 'summary.json'
    if (Test-Path -LiteralPath $summaryPath) {
        $summary = Read-BoundedJson -Path $summaryPath -MaximumBytes $maximumSummaryBytes -Reason 'sound summary'
        foreach ($name in @('version', 'runRoot', 'clean', 'reason')) {
            if ($null -eq $summary.PSObject.Properties[$name]) {
                throw 'sound summary schema invalid'
            }
        }
        if (
            -not (Test-JsonInteger -Value $summary.version) -or [long]$summary.version -ne 1 -or
            $summary.runRoot -isnot [string] -or -not (Test-SamePath -Left $summary.runRoot -Right $Paths.SoundRoot) -or
            $summary.clean -isnot [bool] -or $summary.reason -isnot [string]
        ) {
            throw 'sound summary schema invalid'
        }
        return [pscustomobject]@{ Status = 'ENDED'; Summary = $summary }
    }

    $readyPath = Join-Path $Paths.SoundRoot 'ready.json'
    if (-not (Test-Path -LiteralPath $readyPath)) {
        return [pscustomobject]@{ Status = 'STARTING' }
    }
    $ready = Read-BoundedJson -Path $readyPath -MaximumBytes $maximumReadyBytes -Reason 'sound ready'
    Assert-ReadyShape -Ready $ready -SoundRoot $Paths.SoundRoot

    $controlPath = Join-Path $Paths.SoundRoot 'control.json'
    $control = Read-BoundedJson -Path $controlPath -MaximumBytes $maximumReceiptBytes -Reason 'sound control'
    Assert-ControlShape -Control $control -SoundRoot $Paths.SoundRoot
    if (-not $control.active) {
        return [pscustomobject]@{ Status = 'STOPPING' }
    }

    try {
        $owner = Get-Process -Id ([int]$ready.nodePid) -ErrorAction Stop
        $ownerPath = $owner.Path
    }
    catch {
        return [pscustomobject]@{ Status = 'NOT_LIVE' }
    }
    if ([string]::IsNullOrWhiteSpace($ownerPath) -or -not (Test-SamePath -Left $ownerPath -Right $ready.nodeExecutable)) {
        return [pscustomobject]@{ Status = 'NOT_LIVE' }
    }
    if (Test-Path -LiteralPath $summaryPath) {
        return [pscustomobject]@{ Status = 'ENDED_RACE' }
    }
    return [pscustomobject]@{ Status = 'READY'; Ready = $ready }
}

function Assert-SoundReady {
    param([Parameter(Mandatory = $true)] $Paths)

    $state = Read-SoundState -Paths $Paths
    switch ($state.Status) {
        'READY' { return }
        'ENDED' { throw 'sound session has ended; Show is blocked' }
        'ENDED_RACE' { throw 'sound session became terminal; Show is blocked' }
        'STOPPING' { throw 'sound session is stopping and is not live; Show is blocked' }
        'NOT_LIVE' { throw 'sound session is not live; Show is blocked' }
        default { throw 'sound is not ready; run Sound in its own shell and retry Show' }
    }
}

if ($Listen -and $Action -cne 'Sound') {
    throw 'Listen is valid only for the Sound action'
}
if ($InstrumentProfile -ne 'LegacyPluckV1' -and $Action -cne 'Sound') {
    throw 'InstrumentProfile is valid only for the Sound action'
}
if ($OfflineRequired -and $Action -cne 'Show') {
    throw 'OfflineRequired is valid only for the Show action'
}
if ($StartPolicy -cne 'Operator' -and $Action -cne 'Show') {
    throw 'StartPolicy is valid only for the Show action'
}

$resolvedNodeExecutable = $null
if (-not [string]::IsNullOrWhiteSpace($NodeExecutable)) {
    . (Join-Path $PSScriptRoot 'node-runtime.ps1')
    $resolvedNodeExecutable = Resolve-JanVimNodeExecutable `
        -ExplicitPath $NodeExecutable
}

if ($Action -ceq 'Prepare') {
    if ([string]::IsNullOrWhiteSpace($DisplayMapPath)) {
        $DisplayMapPath = Read-Host 'DisplayMapPath (absolute)'
    }
    $resolvedDisplayMap = Resolve-AbsolutePath -Path $DisplayMapPath -Reason 'display map'
    $displayMapBytes = Read-BoundedBytes `
        -Path $resolvedDisplayMap `
        -MaximumBytes $maximumDisplayMapBytes `
        -Reason 'display map'

    $null = New-Item -ItemType Directory -Path $rehearsalParent -Force
    $sessionId = '{0}-{1}' -f `
        ([DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ', [Globalization.CultureInfo]::InvariantCulture)), `
        ([Guid]::NewGuid().ToString('N').Substring(0, 12))
    $paths = New-ControlledPaths -SessionId $sessionId
    foreach ($candidate in @($paths.SessionRoot, $paths.SoundRoot, $paths.ValidateRoot, $paths.ShowRoot)) {
        if (Test-Path -LiteralPath $candidate) {
            throw "fresh rehearsal path already exists: $candidate"
        }
    }

    $null = New-Item -ItemType Directory -Path $paths.ValidateRoot
    $null = New-Item -ItemType Directory -Path $paths.ShowRoot
    $null = New-Item -ItemType Directory -Path $paths.SessionRoot
    Write-NewBytes -Path (Join-Path $paths.ValidateRoot 'display-map.json') -Bytes $displayMapBytes
    Write-NewBytes -Path (Join-Path $paths.ShowRoot 'display-map.json') -Bytes $displayMapBytes
    $session = [ordered]@{ version = 1; sessionId = $sessionId; duration = $Duration }
    $sessionBytes = [Text.UTF8Encoding]::new($false).GetBytes((($session | ConvertTo-Json -Compress) + "`n"))
    Write-NewBytes -Path $paths.SessionFile -Bytes $sessionBytes

    Write-Output "SESSION_FILE $($paths.SessionFile)"
    Write-Output "SOUND_ROOT $($paths.SoundRoot)"
    Write-Output "VALIDATE_ROOT $($paths.ValidateRoot)"
    Write-Output "SHOW_ROOT $($paths.ShowRoot)"
    Write-Output "DURATION_SECONDS $Duration"
    exit 0
}

if ([string]::IsNullOrWhiteSpace($SessionFile)) {
    $SessionFile = Read-Host 'SessionFile (absolute)'
}
$paths = Read-OperatorSession -Path $SessionFile
$powerShell = @(Get-Command pwsh.exe -CommandType Application -ErrorAction Stop)[0].Source
$startSound = Join-Path $PSScriptRoot 'start-sound.ps1'
$stopSound = Join-Path $PSScriptRoot 'stop-sound.ps1'
$startShow = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\scripts\start-show.ps1'))

switch ($Action) {
    'Sound' {
        $childArguments = @(
            '-NoLogo', '-NoProfile', '-NonInteractive', '-File', $startSound,
            '-Input', 'RealCursor', '-FlockIngress',
            '-RunRoot', $paths.SoundRoot,
            '-Duration', $paths.Duration.ToString([Globalization.CultureInfo]::InvariantCulture)
        )
        if ($Listen) {
            $childArguments += '-Listen'
        }
        if ($InstrumentProfile -eq 'StoneAndSignalV2') {
            $childArguments += @('-InstrumentProfile', 'StoneAndSignalV2')
        }
        if ($null -ne $resolvedNodeExecutable) {
            $childArguments += @('-NodeExecutable', $resolvedNodeExecutable)
        }
        & $powerShell @childArguments
        exit $LASTEXITCODE
    }
    'Show' {
        Assert-SoundReady -Paths $paths
        Assert-ExactDirectory -Path $paths.ValidateRoot -Reason 'ValidateOnly root'
        Assert-ExactDirectory -Path $paths.ShowRoot -Reason 'Show root'
        $validateDisplayMap = Join-Path $paths.ValidateRoot 'display-map.json'
        $showDisplayMap = Join-Path $paths.ShowRoot 'display-map.json'
        $null = Assert-ExactLeaf -Path $validateDisplayMap -Reason 'ValidateOnly display map'
        $null = Assert-ExactLeaf -Path $showDisplayMap -Reason 'Show display map'
        $networkPolicy = if ($OfflineRequired) { 'OfflineRequired' } else { 'DiagnosticConnected' }

        $validateArguments = @(
            '-NoLogo', '-NoProfile', '-NonInteractive', '-File', $startShow,
            '-Mode', 'ValidateOnly',
            '-RehearsalRoot', $paths.ValidateRoot,
            '-DisplayMapPath', $validateDisplayMap,
            '-RunId', ([IO.Path]::GetFileName($paths.ValidateRoot)),
            '-NetworkPolicy', $networkPolicy,
            '-StartPolicy', 'Operator',
            '-SoundRunRoot', $paths.SoundRoot
        )
        if ($null -ne $resolvedNodeExecutable) {
            $validateArguments += @('-NodeExecutable', $resolvedNodeExecutable)
        }
        & $powerShell @validateArguments
        $validationExitCode = $LASTEXITCODE
        if ($validationExitCode -ne 0) {
            exit $validationExitCode
        }

        Assert-SoundReady -Paths $paths
        $showArguments = @(
            '-NoLogo', '-NoProfile', '-NonInteractive', '-File', $startShow,
            '-Mode', 'Show',
            '-RehearsalRoot', $paths.ShowRoot,
            '-DisplayMapPath', $showDisplayMap,
            '-RunId', ([IO.Path]::GetFileName($paths.ShowRoot)),
            '-NetworkPolicy', $networkPolicy,
            '-StartPolicy', $StartPolicy,
            '-SoundRunRoot', $paths.SoundRoot
        )
        if ($null -ne $resolvedNodeExecutable) {
            $showArguments += @('-NodeExecutable', $resolvedNodeExecutable)
        }
        & $powerShell @showArguments
        exit $LASTEXITCODE
    }
    'Status' {
        $state = Read-SoundState -Paths $paths
        Write-Output "SESSION_FILE $($paths.SessionFile)"
        Write-Output "SOUND_ROOT $($paths.SoundRoot)"
        if ($state.Status -ceq 'ENDED') {
            Write-Output "SOUND_STATUS ENDED clean=$($state.Summary.clean) reason=$($state.Summary.reason)"
        }
        else {
            Write-Output "SOUND_STATUS $($state.Status)"
        }
        if ($state.Status -ceq 'READY') {
            $flockInputPath = Join-Path $paths.SoundRoot 'flock-input.json'
            if (Test-Path -LiteralPath $flockInputPath) {
                $item = Assert-ExactLeaf -Path $flockInputPath -Reason 'flock input descriptor'
                if ($item.Length -gt $maximumReceiptBytes) {
                    throw 'flock input descriptor size limit exceeded'
                }
                Write-Output "FLOCK_INPUT_PATH $flockInputPath"
            }
        }
        exit 0
    }
    'StopSound' {
        Write-Output "StopSound targets current sound root: $($paths.SoundRoot)"
        Write-Output 'Full artwork Stop is the existing Stop Show button.'
        $stopArguments = @(
            '-NoLogo', '-NoProfile', '-NonInteractive', '-File', $stopSound,
            '-RunRoot', $paths.SoundRoot
        )
        if ($null -ne $resolvedNodeExecutable) {
            $stopArguments += @('-NodeExecutable', $resolvedNodeExecutable)
        }
        & $powerShell @stopArguments
        $stopExitCode = $LASTEXITCODE
        if ($stopExitCode -ne 0) {
            exit $stopExitCode
        }
        $summaryPath = Join-Path $paths.SoundRoot 'summary.json'
        if (Test-Path -LiteralPath $summaryPath) {
            $state = Read-SoundState -Paths $paths
            if ($state.Status -ceq 'ENDED') {
                Write-Output "SOUND_COMPLETION clean=$($state.Summary.clean) reason=$($state.Summary.reason)"
                exit 0
            }
        }
        Write-Output 'STOP_REQUESTED is only a request; clean completion is not yet verified. Run Status with this SessionFile.'
        exit 0
    }
}
