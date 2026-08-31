# Task 9 Recovery Rehearsal Runbook

This runbook is for the exhibition controller only. The controller owns the show clock. Do not
use global keyboard injection, coordinate clicking, product source changes, or network
automation. Run deliberate fault blocks only during an operator-observed acceptance rehearsal;
they are never development or automated-test commands.

Every controller invocation owns a fresh direct child of the external rehearsal parent. A
completed ValidateOnly, Soak3, Show, or connected diagnostic root is immutable evidence and is
never reused for another invocation. Rerun Preflight plus Display Capture and Confirmation to
create a new root before moving to the next mode.

## Preflight

Precondition -> PowerShell 7 is open at the exhibition worktree root; the frozen artifact,
content manifest, external rehearsal parent, and operator are present.

Exact command/action -> run this once for the next single controller invocation:

```powershell
# block: setup
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repo = (Get-Location).Path
$runId = "g3-monitor-$([DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss'))"
$root = "D:\VirtualData\JanVim-Exhibition-Rehearsals\$runId"
$map = "$root\display-map.json"

if ($runId -cnotmatch '^[A-Za-z0-9._-]{1,64}$') {
    throw 'run-id-invalid'
}
if (-not (Test-Path -LiteralPath "$repo\AGENTS.md" -PathType Leaf)) {
    throw 'exhibition-repository-marker-missing'
}
if (-not (Test-Path -LiteralPath "$repo\scripts\start-g2-rehearsal.ps1" -PathType Leaf)) {
    throw 'public-g2-launcher-missing'
}
if (-not (Test-Path -LiteralPath "$repo\scripts\start-show.ps1" -PathType Leaf)) {
    throw 'public-show-launcher-missing'
}
if (Test-Path -LiteralPath $root) {
    throw 'fresh-rehearsal-root-required'
}
if (Test-Path -LiteralPath $map) {
    throw 'fresh-display-map-required'
}

[pscustomobject]@{
    repo = $repo
    runId = $runId
    rehearsalRoot = $root
    displayMapPath = $map
} | Format-List
```

Visible result -> four values are printed; the root and map do not yet exist and both paths are
outside every source repository.

Machine evidence -> record the printed run ID with the artifact commit, tag, byte size, SHA-256,
content hashes, and intended mode.

Bounded failure branch -> stop before launch on any thrown check. Correct only the shell location
or external rehearsal inputs, wait for a new UTC second if the generated root already exists,
then rerun this section once; never repair an input during a run.

## Display Capture and Confirmation

Precondition -> both intended screens are powered on, the Preflight variables describe a fresh
external root, and the checked-in display map remains unconfirmed.

Exact command/action -> first run `start-g2-rehearsal.ps1 Capture`:

```powershell
# block: capture
pwsh -NoProfile -File "$repo\scripts\start-g2-rehearsal.ps1" -Mode Capture -RehearsalRoot $root -DisplayMapPath $map
if ($LASTEXITCODE -ne 0) {
    throw "display-capture-failed:$LASTEXITCODE"
}
```

Inspect the two captured IDs, FHD geometry, scale, and geometry hashes on the actual screens.
Assign the roles explicitly; do not infer roles from array order. Then run
`start-g2-rehearsal.ps1 Confirm`:

```powershell
# block: confirm
$primaryDisplayId = Read-Host 'Captured ID physically showing the JanVim primary'
$secondaryDisplayId = Read-Host 'Captured ID physically showing the Web secondary'
if ([string]::IsNullOrWhiteSpace($primaryDisplayId)) {
    throw 'primary-display-id-required'
}
if ([string]::IsNullOrWhiteSpace($secondaryDisplayId)) {
    throw 'secondary-display-id-required'
}
if ($primaryDisplayId -ceq $secondaryDisplayId) {
    throw 'display-ids-must-be-distinct'
}
pwsh -NoProfile -File "$repo\scripts\start-g2-rehearsal.ps1" -Mode Confirm -RehearsalRoot $root -DisplayMapPath $map -PrimaryDisplayId $primaryDisplayId -SecondaryDisplayId $secondaryDisplayId
if ($LASTEXITCODE -ne 0) {
    throw "display-confirm-failed:$LASTEXITCODE"
}
$mapSha256 = (Get-FileHash -LiteralPath $map -Algorithm SHA256).Hash.ToLowerInvariant()
[pscustomobject]@{ runId = $runId; displayMapSha256 = $mapSha256 } | Format-List
```

Visible result -> the fresh external map is confirmed while the checked-in display map remains
unconfirmed.

Machine evidence -> Capture and Confirm receipts name the external map, the two explicit display
IDs, and the printed external map SHA-256.

Bounded failure branch -> stop if either display differs. Discard this external root as failed
evidence, correct cabling or display settings, then perform one new Preflight/Capture/Confirm
sequence; never confirm a checked-in map.

## Physical Network Disconnect

Precondition -> preflight and display confirmation passed for the current fresh root.

Exact command/action -> manually disconnect Wi-Fi and Ethernet before an acceptance launch; the
launcher only observes network state and never changes networking.

Visible result -> the operating system shows no external connection.

Machine evidence -> every controller network snapshot has `offline: true`, zero active external
default routes, and zero connected external profiles.

Bounded failure branch -> do not launch or continue. Reconnect only after the rehearsal is closed,
correct the physical disconnect, then repeat this section once.

## ValidateOnly

Precondition -> the current external display map is confirmed, its root has no controller output,
and the physical network is disconnected. A connected diagnostic uses a separate fresh root and
never counts as acceptance.

Exact command/action -> normal validation uses the public launcher and the offline policy:

```powershell
# block: launch
pwsh -NoProfile -File "$repo\scripts\start-show.ps1" -Mode ValidateOnly -RehearsalRoot $root -DisplayMapPath $map -RunId $runId -NetworkPolicy OfflineRequired
if ($LASTEXITCODE -ne 0) {
    throw "validate-only-failed:$LASTEXITCODE"
}
```

Only when diagnosing a deliberately connected machine, use a separately prepared fresh root:

```powershell
# block: diagnostic-connected
Write-Warning 'DiagnosticConnected records diagnostics only and cannot pass acceptance.'
pwsh -NoProfile -File "$repo\scripts\start-show.ps1" -Mode ValidateOnly -RehearsalRoot $root -DisplayMapPath $map -RunId $runId -NetworkPolicy DiagnosticConnected
if ($LASTEXITCODE -ne 0) {
    throw "connected-diagnostic-failed:$LASTEXITCODE"
}
```

Visible result -> validation exits without opening the show or starting JanVim. The connected
variant is visibly classified diagnostic rather than pass.

Machine evidence -> one strict terminal result records validated frozen inputs, network sampling,
the selected policy, and no show loop.

Bounded failure branch -> stop on any nonzero result. Preserve the root as failed evidence,
correct only the recorded external input mismatch, then create a fresh root before one repeat.

## Soak3

Precondition -> an offline ValidateOnly from a separate immutable root passed immediately before
this run; Preflight and display confirmation have produced a new root, and the physical network
remains disconnected.

Exact command/action -> launch through the public surface:

```powershell
# block: launch
pwsh -NoProfile -File "$repo\scripts\start-show.ps1" -Mode Soak3 -RehearsalRoot $root -DisplayMapPath $map -RunId $runId -NetworkPolicy OfflineRequired
if ($LASTEXITCODE -ne 0) {
    throw "soak3-failed:$LASTEXITCODE"
}
```

Press the on-surface Start control once after ready appears.

Visible result -> exactly three loops reset to the original poem and the controller performs one
normal shutdown.

Machine evidence -> strict evidence has three original-poem reset hashes, all offline samples
true, one terminal marker, bounded resource summaries, and cumulative visible drift below 250 ms.

Bounded failure branch -> stop on the first failed loop or missing reset, preserve the complete
root, and run the frozen G2 short loop instead of adding P1 behavior.

## Show

Precondition -> a current accepted Soak3 root is immutable, Preflight and display confirmation
have produced a different fresh root, and the physical network remains disconnected. Before an
operator-observed fault rehearsal, open an observer PowerShell and copy the exact printed
`$repo`, `$runId`, `$root`, and `$map` values from this run into that shell.

Exact command/action -> launch through the public surface:

```powershell
# block: launch
pwsh -NoProfile -File "$repo\scripts\start-show.ps1" -Mode Show -RehearsalRoot $root -DisplayMapPath $map -RunId $runId -NetworkPolicy OfflineRequired
if ($LASTEXITCODE -ne 0) {
    throw "show-failed:$LASTEXITCODE"
}
```

Visible result -> the controller reaches ready with the JanVim primary projector and Web
secondary surface prepared.

Machine evidence -> the token-free lease, fixed bounded controller logs, renderer PID,
run/controller IDs, generation ID, and ready status all belong to this exact external root.

Bounded failure branch -> do not Start. Use Stop Show, preserve the root, and return to
ValidateOnly or G2 fallback as indicated by the failure.

## Start

Precondition -> Show is explicitly `ready`; a new invocation after a crash is also `ready` with no
checkpoint and no automatic Start.

Exact command/action -> press the Web show surface Start control once.

Visible result -> one fresh loop begins and the key overlay and editor cues derive from the same
controller cue.

Machine evidence -> status changes to `running`, one generation/loop ID is logged, and no
duplicate write-back appears.

Bounded failure branch -> if Start is rejected or duplicated, do not retry by keyboard; choose
Restart Loop once only when it becomes actionable, or Stop Show.

## Restart Loop

Precondition -> the controller is `safe-ready` after a bounded recovery limit or startup hold.

Exact command/action -> press the Web show surface Restart Loop control once.

Visible result -> one fresh generation reaches `running` only after original-poem preparation
succeeds.

Machine evidence -> the recovery record names domain, attempt, delay, new generation ID, and
reset hash.

Bounded failure branch -> if it returns to `safe-ready`, stop and preserve evidence; do not issue
further automatic restarts.

## Stop Show

Precondition -> the controller is ready, running, recovering, or safe-ready.

Exact command/action -> press the Web show surface Stop Show button once.

Visible result -> the show enters shutdown and then stopped with no new loop.

Machine evidence -> one terminal marker, one evidence finalization, zero remaining controller
listeners/timers/connections, and the shutdown ladder receipt are logged.

Bounded failure branch -> if the surface is unavailable, use the controller's bounded close path;
Alt+F4 is only the frozen G2 manual acceptance flow, never a normal Task 9 stop action.

## Secondary Fault

Precondition -> Show is running; the observer shell contains the exact active `$repo`, `$runId`,
and `$root`; the fixed controller log has the exact current secondary renderer PID and UTC start
identity; an operator is watching the primary and secondary surfaces. Do not run this block during
development or automated tests.

Exact command/action -> read the strict current token-free lease and the four fixed controller log
slots with finite bounds, accept exactly one current `secondary-opened` identity, hold exact
process handles, compare the renderer PID and StartTime immediately before the fault, and perform
the approved deliberate renderer fault against that exact identity by stopping only that renderer
PID:

```powershell
# block: fault-secondary
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$maximumLeaseBytes = 4096
$maximumControllerLogBytes = 8 * 1024 * 1024
$maximumControllerLogLineCharacters = 16384
$maximumControllerLogRecords = 8192

function Read-BoundedUtf8Text {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][long]$MaximumBytes
    )
    $stream = [IO.File]::Open(
        $Path,
        [IO.FileMode]::Open,
        [IO.FileAccess]::Read,
        [IO.FileShare]::Read
    )
    try {
        if ($stream.Length -lt 1 -or $stream.Length -gt $MaximumBytes) {
            throw "bounded-file-size-invalid:$Path"
        }
        $encoding = [Text.UTF8Encoding]::new($false, $true)
        $reader = [IO.StreamReader]::new($stream, $encoding, $true, 4096, $true)
        try {
            return $reader.ReadToEnd()
        }
        finally {
            $reader.Dispose()
        }
    }
    finally {
        $stream.Dispose()
    }
}

function Assert-NoDuplicateJsonProperties {
    param(
        [Parameter(Mandatory = $true)][string]$Text,
        [int]$MaximumDepth = 8,
        [int]$MaximumNodes = 4096
    )
    try {
        $document = [Text.Json.JsonDocument]::Parse($Text)
    }
    catch {
        throw 'json-syntax-invalid'
    }
    try {
        $pending = [Collections.Generic.Stack[object]]::new()
        $pending.Push([pscustomobject]@{ Element = $document.RootElement; Depth = 0 })
        $nodeCount = 0
        while ($pending.Count -gt 0) {
            $frame = $pending.Pop()
            $nodeCount += 1
            if ($nodeCount -gt $MaximumNodes -or $frame.Depth -gt $MaximumDepth) {
                throw 'json-structure-bound-exceeded'
            }
            $element = [Text.Json.JsonElement]$frame.Element
            if ($element.ValueKind -eq [Text.Json.JsonValueKind]::Object) {
                $names = [Collections.Generic.HashSet[string]]::new(
                    [StringComparer]::Ordinal
                )
                foreach ($property in $element.EnumerateObject()) {
                    if (-not $names.Add($property.Name)) {
                        throw "json-property-duplicate:$($property.Name)"
                    }
                    $pending.Push([pscustomobject]@{
                        Element = $property.Value
                        Depth = [int]$frame.Depth + 1
                    })
                }
            }
            elseif ($element.ValueKind -eq [Text.Json.JsonValueKind]::Array) {
                foreach ($item in $element.EnumerateArray()) {
                    $pending.Push([pscustomobject]@{
                        Element = $item
                        Depth = [int]$frame.Depth + 1
                    })
                }
            }
        }
    }
    finally {
        $document.Dispose()
    }
}

function Assert-ExactPropertySet {
    param(
        [Parameter(Mandatory = $true)][psobject]$InputObject,
        [Parameter(Mandatory = $true)][string[]]$ExpectedNames
    )
    $actualNames = @($InputObject.PSObject.Properties.Name)
    if ($actualNames.Count -ne $ExpectedNames.Count) {
        throw 'json-property-count-invalid'
    }
    foreach ($name in $ExpectedNames) {
        if ($name -cnotin $actualNames) {
            throw "json-property-missing:$name"
        }
    }
}

function Convert-StrictUtcInstant {
    param([Parameter(Mandatory = $true)][object]$Value)
    if (
        $Value -isnot [string] -or
        $Value -cnotmatch '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,9})?Z$'
    ) {
        throw 'utc-identity-invalid'
    }
    $parsed = [DateTimeOffset]::MinValue
    $styles = [Globalization.DateTimeStyles]::AssumeUniversal -bor
        [Globalization.DateTimeStyles]::AdjustToUniversal
    if (-not [DateTimeOffset]::TryParse(
        $Value,
        [Globalization.CultureInfo]::InvariantCulture,
        $styles,
        [ref]$parsed
    )) {
        throw 'utc-identity-invalid'
    }
    return $parsed.ToUniversalTime()
}

function Complete-StrictControllerLogRecord {
    param(
        [Parameter(Mandatory = $true)][string]$Line,
        [Parameter(Mandatory = $true)][psobject]$State,
        [Parameter(Mandatory = $true)][string]$RunId,
        [Parameter(Mandatory = $true)][string]$ControllerRunId,
        [Parameter(Mandatory = $true)][long]$GenerationId
    )
    if ([string]::IsNullOrWhiteSpace($Line)) {
        return
    }
    $State.ParsedRecordCount += 1
    try {
        Assert-NoDuplicateJsonProperties -Text $Line
        $record = $Line | ConvertFrom-Json -Depth 8 -DateKind String -NoEnumerate
    }
    catch {
        throw 'controller-log-json-invalid'
    }
    if ($record -isnot [pscustomobject]) {
        throw 'controller-log-object-required'
    }
    $typeProperty = $record.PSObject.Properties['type']
    if ($null -eq $typeProperty -or $record.type -isnot [string]) {
        throw 'controller-log-type-invalid'
    }
    if ($record.type -cne 'secondary-opened') {
        return
    }
    $actualNames = @($record.PSObject.Properties.Name)
    $currentNames = @(
        'type', 'runId', 'controllerRunId', 'generationId', 'rendererPid',
        'rendererStartedAtUtc'
    )
    $legacyNames = @(
        'type', 'runId', 'controllerRunId', 'generationId', 'rendererPid'
    )
    $isCurrentShape = $actualNames.Count -eq $currentNames.Count
    foreach ($name in $currentNames) {
        if ($name -cnotin $actualNames) {
            $isCurrentShape = $false
        }
    }
    $isLegacyShape = $actualNames.Count -eq $legacyNames.Count
    foreach ($name in $legacyNames) {
        if ($name -cnotin $actualNames) {
            $isLegacyShape = $false
        }
    }
    if (-not $isCurrentShape -and -not $isLegacyShape) {
        throw 'json-property-count-invalid'
    }
    if (
        $record.runId -isnot [string] -or
        $record.runId -cnotmatch '^[A-Za-z0-9._-]{1,64}$' -or
        $record.runId -cmatch '[0-9A-Fa-f]{48}' -or
        $record.controllerRunId -isnot [string] -or
        $record.controllerRunId -cnotmatch '^[A-Za-z0-9._-]{1,96}$' -or
        $record.controllerRunId -cmatch '[0-9A-Fa-f]{48}' -or
        $record.generationId -isnot [long] -or
        $record.generationId -le 0 -or
        $record.generationId -gt 9007199254740991 -or
        $record.rendererPid -isnot [long] -or
        $record.rendererPid -le 0 -or
        $record.rendererPid -gt [int]::MaxValue
    ) {
        throw 'secondary-opened-scalar-invalid'
    }
    $matchesCurrent =
        $record.runId -ceq $RunId -and
        $record.controllerRunId -ceq $ControllerRunId -and
        $record.generationId -eq $GenerationId
    if ($isLegacyShape) {
        if ($matchesCurrent) {
            throw 'current-secondary-start-identity-missing'
        }
        return
    }
    [void](Convert-StrictUtcInstant -Value $record.rendererStartedAtUtc)
    if ($matchesCurrent) {
        $State.MatchingCount += 1
        if ($State.MatchingCount -gt 1) {
            throw 'current-secondary-identity-not-unique'
        }
        $State.MatchingEvent = $record
    }
}

function Read-BoundedControllerLogRecords {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][long]$MaximumBytes,
        [Parameter(Mandatory = $true)][int]$MaximumLineCharacters,
        [Parameter(Mandatory = $true)][int]$MaximumRecords,
        [Parameter(Mandatory = $true)][psobject]$State,
        [Parameter(Mandatory = $true)][string]$RunId,
        [Parameter(Mandatory = $true)][string]$ControllerRunId,
        [Parameter(Mandatory = $true)][long]$GenerationId
    )
    $stream = [IO.File]::Open(
        $Path,
        [IO.FileMode]::Open,
        [IO.FileAccess]::Read,
        [IO.FileShare]::Read
    )
    try {
        if ($stream.Length -lt 1 -or $stream.Length -gt $MaximumBytes) {
            throw "bounded-file-size-invalid:$Path"
        }
        $encoding = [Text.UTF8Encoding]::new($false, $true)
        $reader = [IO.StreamReader]::new($stream, $encoding, $false, 4096, $true)
        $lineBuilder = [Text.StringBuilder]::new($MaximumLineCharacters)
        $lineOpen = $false
        $previousWasCarriageReturn = $false
        try {
            while ($true) {
                $codePoint = $reader.Read()
                if ($codePoint -eq -1) {
                    break
                }
                $character = [char]$codePoint
                if ($character -eq [char]13) {
                    if (-not $lineOpen) {
                        $State.PhysicalRecordCount += 1
                        if ($State.PhysicalRecordCount -gt $MaximumRecords) {
                            throw 'controller-log-record-bound-exceeded'
                        }
                    }
                    Complete-StrictControllerLogRecord -Line $lineBuilder.ToString() -State $State -RunId $RunId -ControllerRunId $ControllerRunId -GenerationId $GenerationId
                    [void]$lineBuilder.Clear()
                    $lineOpen = $false
                    $previousWasCarriageReturn = $true
                    continue
                }
                if ($character -eq [char]10) {
                    if ($previousWasCarriageReturn) {
                        $previousWasCarriageReturn = $false
                        continue
                    }
                    if (-not $lineOpen) {
                        $State.PhysicalRecordCount += 1
                        if ($State.PhysicalRecordCount -gt $MaximumRecords) {
                            throw 'controller-log-record-bound-exceeded'
                        }
                    }
                    Complete-StrictControllerLogRecord -Line $lineBuilder.ToString() -State $State -RunId $RunId -ControllerRunId $ControllerRunId -GenerationId $GenerationId
                    [void]$lineBuilder.Clear()
                    $lineOpen = $false
                    continue
                }
                $previousWasCarriageReturn = $false
                if (-not $lineOpen) {
                    $State.PhysicalRecordCount += 1
                    if ($State.PhysicalRecordCount -gt $MaximumRecords) {
                        throw 'controller-log-record-bound-exceeded'
                    }
                    $lineOpen = $true
                }
                if ($lineBuilder.Length -ge $MaximumLineCharacters) {
                    throw 'controller-log-line-bound-exceeded'
                }
                [void]$lineBuilder.Append($character)
            }
            if ($lineOpen) {
                Complete-StrictControllerLogRecord -Line $lineBuilder.ToString() -State $State -RunId $RunId -ControllerRunId $ControllerRunId -GenerationId $GenerationId
            }
        }
        finally {
            $reader.Dispose()
        }
    }
    finally {
        $stream.Dispose()
    }
}

function Read-StrictCurrentLease {
    $leasePath = "$root\run-lease.json"
    $leaseText = Read-BoundedUtf8Text -Path $leasePath -MaximumBytes $maximumLeaseBytes
    Assert-NoDuplicateJsonProperties -Text $leaseText
    try {
        $lease = $leaseText | ConvertFrom-Json -Depth 8 -DateKind String -NoEnumerate
    }
    catch {
        throw 'run-lease-json-invalid'
    }
    if ($lease -isnot [pscustomobject]) {
        throw 'run-lease-object-required'
    }
    Assert-ExactPropertySet -InputObject $lease -ExpectedNames @(
        'schema', 'runId', 'controllerRunId', 'generationId', 'controller', 'janvim'
    )
    if ($lease.controller -isnot [pscustomobject] -or $lease.janvim -isnot [pscustomobject]) {
        throw 'run-lease-nested-object-invalid'
    }
    Assert-ExactPropertySet -InputObject $lease.controller -ExpectedNames @(
        'pid', 'startedAtUtc'
    )
    Assert-ExactPropertySet -InputObject $lease.janvim -ExpectedNames @(
        'pid', 'startedAtUtc', 'hwnd', 'executableRelativePath', 'executableSha256'
    )
    if (
        $lease.schema -isnot [long] -or $lease.schema -ne 1 -or
        $lease.runId -isnot [string] -or
        $lease.runId -cnotmatch '^[A-Za-z0-9._-]{1,64}$' -or
        $lease.runId -cmatch '[0-9A-Fa-f]{48}' -or
        $lease.runId -cne $runId -or
        $lease.controllerRunId -isnot [string] -or
        $lease.controllerRunId -cnotmatch '^[A-Za-z0-9._-]{1,96}$' -or
        $lease.controllerRunId -cmatch '[0-9A-Fa-f]{48}' -or
        $lease.generationId -isnot [long] -or
        $lease.generationId -le 0 -or
        $lease.generationId -gt 9007199254740991 -or
        $lease.controller.pid -isnot [long] -or $lease.controller.pid -le 0 -or
        $lease.controller.pid -gt [int]::MaxValue -or
        $lease.janvim.pid -isnot [long] -or $lease.janvim.pid -le 0 -or
        $lease.janvim.pid -gt [int]::MaxValue -or
        $lease.janvim.hwnd -isnot [string] -or
        $lease.janvim.hwnd -cnotmatch '^0x[0-9A-Fa-f]{1,16}$' -or
        $lease.janvim.hwnd -cmatch '^0x0+$' -or
        $lease.janvim.executableRelativePath -isnot [string] -or
        $lease.janvim.executableRelativePath -cne 'janvim-core.exe' -or
        $lease.janvim.executableSha256 -isnot [string] -or
        $lease.janvim.executableSha256 -cnotmatch '^[0-9a-f]{64}$'
    ) {
        throw 'run-lease-scalar-invalid'
    }
    [void](Convert-StrictUtcInstant -Value $lease.controller.startedAtUtc)
    [void](Convert-StrictUtcInstant -Value $lease.janvim.startedAtUtc)
    return $lease
}

$lease = Read-StrictCurrentLease
$controllerPid = [int]$lease.controller.pid
$controllerProcess = Get-Process -Id $controllerPid -ErrorAction Stop
$rendererProcess = $null
try {
    [void]$controllerProcess.Handle
    $expectedControllerStart = Convert-StrictUtcInstant -Value $lease.controller.startedAtUtc
    $actualControllerStartMs =
        ([DateTimeOffset]$controllerProcess.StartTime.ToUniversalTime()).ToUnixTimeMilliseconds()
    if ($actualControllerStartMs -ne $expectedControllerStart.ToUnixTimeMilliseconds()) {
        throw 'current-controller-start-identity-mismatch'
    }

    $controllerLogPaths = @(
        "$root\show-run.log.controller",
        "$root\show-run.log.controller.1",
        "$root\show-run.log.controller.2",
        "$root\show-run.log.controller.3"
    )
    $logState = [pscustomobject]@{
        PhysicalRecordCount = 0
        ParsedRecordCount = 0
        MatchingCount = 0
        MatchingEvent = $null
    }
    $existingLogCount = 0
    foreach ($controllerLogPath in $controllerLogPaths) {
        if (-not (Test-Path -LiteralPath $controllerLogPath -PathType Leaf)) {
            continue
        }
        $existingLogCount += 1
        Read-BoundedControllerLogRecords -Path $controllerLogPath -MaximumBytes $maximumControllerLogBytes -MaximumLineCharacters $maximumControllerLogLineCharacters -MaximumRecords $maximumControllerLogRecords -State $logState -RunId $runId -ControllerRunId $lease.controllerRunId -GenerationId $lease.generationId
    }
    if ($existingLogCount -lt 1 -or $logState.ParsedRecordCount -lt 1) {
        throw 'controller-log-missing'
    }
    if ($logState.MatchingCount -ne 1 -or $null -eq $logState.MatchingEvent) {
        throw 'current-secondary-identity-not-unique'
    }

    $rendererPid = [int]$logState.MatchingEvent.rendererPid
    $rendererProcess = Get-Process -Id $rendererPid -ErrorAction Stop
    [void]$rendererProcess.Handle
    $expectedRendererStart = Convert-StrictUtcInstant -Value (
        $logState.MatchingEvent.rendererStartedAtUtc
    )
    $actualRendererStart = [DateTimeOffset]$rendererProcess.StartTime.ToUniversalTime()
    if ($actualRendererStart.Ticks -ne $expectedRendererStart.Ticks) {
        throw 'current-secondary-start-identity-mismatch'
    }
    Stop-Process -Id $rendererPid
}
finally {
    if ($null -ne $rendererProcess) {
        $rendererProcess.Dispose()
    }
    $controllerProcess.Dispose()
}
```

Visible result -> the secondary enters safe-cruise, is replaced at black, the healthy session
resets to the original poem, and one fresh loop starts; no old cue is replayed.

Machine evidence -> a secondary recovery record includes the exact prior generation, one
1/2/4-second bounded delay, outcome, renderer PID and start identity, and fresh loop ID.

Bounded failure branch -> any missing, malformed, stale, duplicate, oversized, or mismatched
identity aborts before the stop. After the fourth real failure the controller is safe-ready; Stop
Show and use G2 fallback.

## JanVim Fault

Precondition -> Show is running; the observer shell contains the exact active `$repo`, `$runId`,
and `$root`; the token-free lease has the exact JanVim PID, HWND, start identity, and executable hash;
an operator is watching both surfaces. Do not run this block during development or automated tests.

Exact command/action -> read a bounded strict lease and artifact lock, prove the live controller
and JanVim identities while holding their process handles, prove the immutable executable's
direct-child path, byte size, and SHA-256, then perform the approved deliberate fault only against that exact JanVim identity by stopping only its PID:

```powershell
# block: fault-janvim
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$maximumLeaseBytes = 4096
$maximumArtifactLockBytes = 65536

function Read-BoundedUtf8Text {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][long]$MaximumBytes
    )
    $stream = [IO.File]::Open(
        $Path,
        [IO.FileMode]::Open,
        [IO.FileAccess]::Read,
        [IO.FileShare]::Read
    )
    try {
        if ($stream.Length -lt 1 -or $stream.Length -gt $MaximumBytes) {
            throw "bounded-file-size-invalid:$Path"
        }
        $encoding = [Text.UTF8Encoding]::new($false, $true)
        $reader = [IO.StreamReader]::new($stream, $encoding, $true, 4096, $true)
        try {
            return $reader.ReadToEnd()
        }
        finally {
            $reader.Dispose()
        }
    }
    finally {
        $stream.Dispose()
    }
}

function Assert-NoDuplicateJsonProperties {
    param(
        [Parameter(Mandatory = $true)][string]$Text,
        [int]$MaximumDepth = 8,
        [int]$MaximumNodes = 4096
    )
    try {
        $document = [Text.Json.JsonDocument]::Parse($Text)
    }
    catch {
        throw 'json-syntax-invalid'
    }
    try {
        $pending = [Collections.Generic.Stack[object]]::new()
        $pending.Push([pscustomobject]@{ Element = $document.RootElement; Depth = 0 })
        $nodeCount = 0
        while ($pending.Count -gt 0) {
            $frame = $pending.Pop()
            $nodeCount += 1
            if ($nodeCount -gt $MaximumNodes -or $frame.Depth -gt $MaximumDepth) {
                throw 'json-structure-bound-exceeded'
            }
            $element = [Text.Json.JsonElement]$frame.Element
            if ($element.ValueKind -eq [Text.Json.JsonValueKind]::Object) {
                $names = [Collections.Generic.HashSet[string]]::new(
                    [StringComparer]::Ordinal
                )
                foreach ($property in $element.EnumerateObject()) {
                    if (-not $names.Add($property.Name)) {
                        throw "json-property-duplicate:$($property.Name)"
                    }
                    $pending.Push([pscustomobject]@{
                        Element = $property.Value
                        Depth = [int]$frame.Depth + 1
                    })
                }
            }
            elseif ($element.ValueKind -eq [Text.Json.JsonValueKind]::Array) {
                foreach ($item in $element.EnumerateArray()) {
                    $pending.Push([pscustomobject]@{
                        Element = $item
                        Depth = [int]$frame.Depth + 1
                    })
                }
            }
        }
    }
    finally {
        $document.Dispose()
    }
}

function Assert-ExactPropertySet {
    param(
        [Parameter(Mandatory = $true)][psobject]$InputObject,
        [Parameter(Mandatory = $true)][string[]]$ExpectedNames
    )
    $actualNames = @($InputObject.PSObject.Properties.Name)
    if ($actualNames.Count -ne $ExpectedNames.Count) {
        throw 'json-property-count-invalid'
    }
    foreach ($name in $ExpectedNames) {
        if ($name -cnotin $actualNames) {
            throw "json-property-missing:$name"
        }
    }
}

function Convert-StrictUtcInstant {
    param([Parameter(Mandatory = $true)][object]$Value)
    if (
        $Value -isnot [string] -or
        $Value -cnotmatch '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,9})?Z$'
    ) {
        throw 'utc-identity-invalid'
    }
    $parsed = [DateTimeOffset]::MinValue
    $styles = [Globalization.DateTimeStyles]::AssumeUniversal -bor
        [Globalization.DateTimeStyles]::AdjustToUniversal
    if (-not [DateTimeOffset]::TryParse(
        $Value,
        [Globalization.CultureInfo]::InvariantCulture,
        $styles,
        [ref]$parsed
    )) {
        throw 'utc-identity-invalid'
    }
    return $parsed.ToUniversalTime()
}

function Test-PositiveSafeInteger {
    param([Parameter(Mandatory = $true)][object]$Value)
    return (
        $Value -is [long] -and
        $Value -gt 0 -and
        $Value -le 9007199254740991
    )
}

function Test-NonEmptyString {
    param([Parameter(Mandatory = $true)][object]$Value)
    return $Value -is [string] -and $Value.Length -gt 0
}

function Test-LowerSha256 {
    param([Parameter(Mandatory = $true)][object]$Value)
    return $Value -is [string] -and $Value -cmatch '^[0-9a-f]{64}$'
}

$leasePath = "$root\run-lease.json"
$leaseText = Read-BoundedUtf8Text -Path $leasePath -MaximumBytes $maximumLeaseBytes
Assert-NoDuplicateJsonProperties -Text $leaseText
try {
    $lease = $leaseText | ConvertFrom-Json -Depth 8 -DateKind String -NoEnumerate
}
catch {
    throw 'run-lease-json-invalid'
}
if ($lease -isnot [pscustomobject]) {
    throw 'run-lease-object-required'
}
Assert-ExactPropertySet -InputObject $lease -ExpectedNames @(
    'schema', 'runId', 'controllerRunId', 'generationId', 'controller', 'janvim'
)
if ($lease.controller -isnot [pscustomobject] -or $lease.janvim -isnot [pscustomobject]) {
    throw 'run-lease-nested-object-invalid'
}
Assert-ExactPropertySet -InputObject $lease.controller -ExpectedNames @(
    'pid', 'startedAtUtc'
)
Assert-ExactPropertySet -InputObject $lease.janvim -ExpectedNames @(
    'pid', 'startedAtUtc', 'hwnd', 'executableRelativePath', 'executableSha256'
)
if (
    $lease.schema -isnot [long] -or $lease.schema -ne 1 -or
    $lease.runId -isnot [string] -or
    $lease.runId -cnotmatch '^[A-Za-z0-9._-]{1,64}$' -or
    $lease.runId -cmatch '[0-9A-Fa-f]{48}' -or
    $lease.runId -cne $runId -or
    $lease.controllerRunId -isnot [string] -or
    $lease.controllerRunId -cnotmatch '^[A-Za-z0-9._-]{1,96}$' -or
    $lease.controllerRunId -cmatch '[0-9A-Fa-f]{48}' -or
    $lease.generationId -isnot [long] -or
    $lease.generationId -le 0 -or
    $lease.generationId -gt 9007199254740991 -or
    $lease.controller.pid -isnot [long] -or $lease.controller.pid -le 0 -or
    $lease.controller.pid -gt [int]::MaxValue -or
    $lease.janvim.pid -isnot [long] -or $lease.janvim.pid -le 0 -or
    $lease.janvim.pid -gt [int]::MaxValue -or
    $lease.janvim.hwnd -isnot [string] -or
    $lease.janvim.hwnd -cnotmatch '^0x[0-9A-Fa-f]{1,16}$' -or
    $lease.janvim.hwnd -cmatch '^0x0+$' -or
    $lease.janvim.executableRelativePath -isnot [string] -or
    $lease.janvim.executableRelativePath -cne 'janvim-core.exe' -or
    $lease.janvim.executableSha256 -isnot [string] -or
    $lease.janvim.executableSha256 -cnotmatch '^[0-9a-f]{64}$'
) {
    throw 'run-lease-scalar-invalid'
}
$expectedControllerStart = Convert-StrictUtcInstant -Value $lease.controller.startedAtUtc
$expectedJanVimStart = Convert-StrictUtcInstant -Value $lease.janvim.startedAtUtc

$artifactLockPath = "$repo\janvim-artifact.lock.json"
$artifactLockText =
    Read-BoundedUtf8Text -Path $artifactLockPath -MaximumBytes $maximumArtifactLockBytes
Assert-NoDuplicateJsonProperties -Text $artifactLockText
try {
    $artifactLock = $artifactLockText | ConvertFrom-Json -Depth 8 -DateKind String -NoEnumerate
}
catch {
    throw 'artifact-lock-json-invalid'
}
if ($artifactLock -isnot [pscustomobject]) {
    throw 'artifact-lock-object-required'
}
Assert-ExactPropertySet -InputObject $artifactLock -ExpectedNames @(
    'schema',
    'sourceRepository',
    'tag',
    'commit',
    'archive',
    'archiveBytes',
    'archiveSha256',
    'checksum',
    'checksumSha256',
    'core',
    'coreBytes',
    'coreSha256',
    'runtimeLua',
    'runtimeLuaSha256',
    'artifactConfig',
    'artifactConfigSha256',
    'config',
    'configSha256',
    'layoutEngine',
    'role',
    'provenanceKind',
    'provenanceReference',
    'provenanceRecord',
    'provenanceSha256',
    'evidenceRecord',
    'evidenceSha256',
    'pluginLabConfig',
    'pluginLabConfigSha256'
)
if (
    $artifactLock.schema -isnot [long] -or $artifactLock.schema -ne 1 -or
    $artifactLock.sourceRepository -isnot [string] -or
    $artifactLock.sourceRepository -cne 'D:/github/JanVim' -or
    $artifactLock.tag -isnot [string] -or
    $artifactLock.tag -cne 'v0.10.1-gmk.4' -or
    $artifactLock.commit -isnot [string] -or
    $artifactLock.commit -cne 'e95633101d93f8448b0f906e918b5d836ab95273' -or
    -not (Test-NonEmptyString -Value $artifactLock.archive) -or
    -not (Test-PositiveSafeInteger -Value $artifactLock.archiveBytes) -or
    -not (Test-LowerSha256 -Value $artifactLock.archiveSha256) -or
    -not (Test-NonEmptyString -Value $artifactLock.checksum) -or
    -not (Test-LowerSha256 -Value $artifactLock.checksumSha256) -or
    $artifactLock.core -isnot [string] -or $artifactLock.core -cne 'janvim-core.exe' -or
    -not (Test-PositiveSafeInteger -Value $artifactLock.coreBytes) -or
    $artifactLock.coreBytes -ne 18866688 -or
    -not (Test-LowerSha256 -Value $artifactLock.coreSha256) -or
    $artifactLock.coreSha256 -cne '224b3457d89fbc6cf946359683632f29f9262bae08b6f0d2e3043a3a7a6d83b3' -or
    -not (Test-NonEmptyString -Value $artifactLock.runtimeLua) -or
    -not (Test-LowerSha256 -Value $artifactLock.runtimeLuaSha256) -or
    -not (Test-NonEmptyString -Value $artifactLock.artifactConfig) -or
    -not (Test-LowerSha256 -Value $artifactLock.artifactConfigSha256) -or
    $artifactLock.config -isnot [string] -or
    $artifactLock.config -cne 'show/janvim-show.toml' -or
    -not (Test-LowerSha256 -Value $artifactLock.configSha256) -or
    $artifactLock.layoutEngine -isnot [string] -or
    $artifactLock.layoutEngine -cne 'orthogonal' -or
    $artifactLock.role -isnot [string] -or
    $artifactLock.role -cne 'primary-projector' -or
    -not (Test-NonEmptyString -Value $artifactLock.provenanceKind) -or
    -not (Test-NonEmptyString -Value $artifactLock.provenanceReference) -or
    -not (Test-NonEmptyString -Value $artifactLock.provenanceRecord) -or
    -not (Test-LowerSha256 -Value $artifactLock.provenanceSha256) -or
    -not (Test-NonEmptyString -Value $artifactLock.evidenceRecord) -or
    -not (Test-LowerSha256 -Value $artifactLock.evidenceSha256) -or
    $artifactLock.pluginLabConfig -isnot [string] -or
    $artifactLock.pluginLabConfig -cne 'runtime/user-root/plugin-lab/config/init.lua' -or
    -not (Test-LowerSha256 -Value $artifactLock.pluginLabConfigSha256) -or
    $lease.janvim.executableSha256 -cne $artifactLock.coreSha256
) {
    throw 'artifact-lock-core-identity-invalid'
}

$runtimeRoot = [IO.Path]::GetFullPath("$repo\runtime\janvim").TrimEnd('\', '/')
$runtimeRootItem = Get-Item -LiteralPath $runtimeRoot -ErrorAction Stop
if (
    -not $runtimeRootItem.PSIsContainer -or
    ($runtimeRootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0
) {
    throw 'runtime-root-identity-invalid'
}
$janvimExecutable = [IO.Path]::GetFullPath(
    [IO.Path]::Combine($runtimeRoot, $lease.janvim.executableRelativePath)
)
if (-not [string]::Equals(
    [IO.Path]::GetDirectoryName($janvimExecutable),
    $runtimeRoot,
    [StringComparison]::OrdinalIgnoreCase
)) {
    throw 'runtime-executable-escaped-root'
}
$janvimExecutableItem = Get-Item -LiteralPath $janvimExecutable -ErrorAction Stop
if (
    $janvimExecutableItem.PSIsContainer -or
    ($janvimExecutableItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
    $janvimExecutableItem.Length -ne $artifactLock.coreBytes
) {
    throw 'runtime-executable-file-identity-invalid'
}
$janvimExecutableSha256 =
    (Get-FileHash -LiteralPath $janvimExecutable -Algorithm SHA256).Hash.ToLowerInvariant()
if (
    $janvimExecutableSha256 -cne $artifactLock.coreSha256 -or
    $janvimExecutableSha256 -cne $lease.janvim.executableSha256
) {
    throw 'runtime-executable-hash-mismatch'
}

$controllerPid = [int]$lease.controller.pid
$janvimPid = [int]$lease.janvim.pid
$controllerProcess = Get-Process -Id $controllerPid -ErrorAction Stop
$janvimProcess = Get-Process -Id $janvimPid -ErrorAction Stop
try {
    [void]$controllerProcess.Handle
    [void]$janvimProcess.Handle
    $actualControllerStartMs =
        ([DateTimeOffset]$controllerProcess.StartTime.ToUniversalTime()).ToUnixTimeMilliseconds()
    if ($actualControllerStartMs -ne $expectedControllerStart.ToUnixTimeMilliseconds()) {
        throw 'current-controller-start-identity-mismatch'
    }
    $actualJanVimStartTicks = $janvimProcess.StartTime.ToUniversalTime().Ticks
    if ($actualJanVimStartTicks -ne $expectedJanVimStart.UtcDateTime.Ticks) {
        throw 'janvim-start-identity-mismatch'
    }
    $actualJanVimPath = [IO.Path]::GetFullPath($janvimProcess.Path)
    if (-not [string]::Equals(
        $actualJanVimPath,
        $janvimExecutable,
        [StringComparison]::OrdinalIgnoreCase
    )) {
        throw 'janvim-process-path-mismatch'
    }
    $expectedHwnd = [Convert]::ToUInt64($lease.janvim.hwnd.Substring(2), 16)
    $actualHwnd = [uint64]$janvimProcess.MainWindowHandle.ToInt64()
    if ($actualHwnd -eq 0 -or $actualHwnd -ne $expectedHwnd) {
        throw 'janvim-hwnd-identity-mismatch'
    }
    Stop-Process -Id $janvimPid
}
finally {
    $janvimProcess.Dispose()
    $controllerProcess.Dispose()
}
```

Visible result -> a full generation replacement occurs; a pending editor action cannot produce a
later old editor cue.

Machine evidence -> recovery evidence records the JanVim domain, old and new generations,
original-poem reset hash, exact prior process identity, and bounded retry delay.

Bounded failure branch -> any missing, malformed, stale, duplicate-field, reparse, path, process,
window, byte-size, or hash mismatch aborts before the stop. After the fourth real failure the
controller is safe-ready; Stop Show and use G2 fallback.

## Controller Fault

Precondition -> Show is running; the observer shell contains the exact active `$runId` and
`$root`; the strict current lease belongs to that run; the launcher watchdog remains alive; an
operator is watching both surfaces. Do not run this block during development or automated tests.

Exact command/action -> read the bounded strict token-free lease, prove the current controller PID
and UTC start identity while holding its process handle, then stop only that controller PID:

```powershell
# block: fault-controller
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$maximumLeaseBytes = 4096

function Read-BoundedUtf8Text {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][long]$MaximumBytes
    )
    $stream = [IO.File]::Open(
        $Path,
        [IO.FileMode]::Open,
        [IO.FileAccess]::Read,
        [IO.FileShare]::Read
    )
    try {
        if ($stream.Length -lt 1 -or $stream.Length -gt $MaximumBytes) {
            throw "bounded-file-size-invalid:$Path"
        }
        $encoding = [Text.UTF8Encoding]::new($false, $true)
        $reader = [IO.StreamReader]::new($stream, $encoding, $true, 4096, $true)
        try {
            return $reader.ReadToEnd()
        }
        finally {
            $reader.Dispose()
        }
    }
    finally {
        $stream.Dispose()
    }
}

function Assert-NoDuplicateJsonProperties {
    param(
        [Parameter(Mandatory = $true)][string]$Text,
        [int]$MaximumDepth = 8,
        [int]$MaximumNodes = 4096
    )
    try {
        $document = [Text.Json.JsonDocument]::Parse($Text)
    }
    catch {
        throw 'json-syntax-invalid'
    }
    try {
        $pending = [Collections.Generic.Stack[object]]::new()
        $pending.Push([pscustomobject]@{ Element = $document.RootElement; Depth = 0 })
        $nodeCount = 0
        while ($pending.Count -gt 0) {
            $frame = $pending.Pop()
            $nodeCount += 1
            if ($nodeCount -gt $MaximumNodes -or $frame.Depth -gt $MaximumDepth) {
                throw 'json-structure-bound-exceeded'
            }
            $element = [Text.Json.JsonElement]$frame.Element
            if ($element.ValueKind -eq [Text.Json.JsonValueKind]::Object) {
                $names = [Collections.Generic.HashSet[string]]::new(
                    [StringComparer]::Ordinal
                )
                foreach ($property in $element.EnumerateObject()) {
                    if (-not $names.Add($property.Name)) {
                        throw "json-property-duplicate:$($property.Name)"
                    }
                    $pending.Push([pscustomobject]@{
                        Element = $property.Value
                        Depth = [int]$frame.Depth + 1
                    })
                }
            }
            elseif ($element.ValueKind -eq [Text.Json.JsonValueKind]::Array) {
                foreach ($item in $element.EnumerateArray()) {
                    $pending.Push([pscustomobject]@{
                        Element = $item
                        Depth = [int]$frame.Depth + 1
                    })
                }
            }
        }
    }
    finally {
        $document.Dispose()
    }
}

function Assert-ExactPropertySet {
    param(
        [Parameter(Mandatory = $true)][psobject]$InputObject,
        [Parameter(Mandatory = $true)][string[]]$ExpectedNames
    )
    $actualNames = @($InputObject.PSObject.Properties.Name)
    if ($actualNames.Count -ne $ExpectedNames.Count) {
        throw 'json-property-count-invalid'
    }
    foreach ($name in $ExpectedNames) {
        if ($name -cnotin $actualNames) {
            throw "json-property-missing:$name"
        }
    }
}

function Convert-StrictUtcInstant {
    param([Parameter(Mandatory = $true)][object]$Value)
    if (
        $Value -isnot [string] -or
        $Value -cnotmatch '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,9})?Z$'
    ) {
        throw 'utc-identity-invalid'
    }
    $parsed = [DateTimeOffset]::MinValue
    $styles = [Globalization.DateTimeStyles]::AssumeUniversal -bor
        [Globalization.DateTimeStyles]::AdjustToUniversal
    if (-not [DateTimeOffset]::TryParse(
        $Value,
        [Globalization.CultureInfo]::InvariantCulture,
        $styles,
        [ref]$parsed
    )) {
        throw 'utc-identity-invalid'
    }
    return $parsed.ToUniversalTime()
}

$leasePath = "$root\run-lease.json"
$leaseText = Read-BoundedUtf8Text -Path $leasePath -MaximumBytes $maximumLeaseBytes
Assert-NoDuplicateJsonProperties -Text $leaseText
try {
    $lease = $leaseText | ConvertFrom-Json -Depth 8 -DateKind String -NoEnumerate
}
catch {
    throw 'run-lease-json-invalid'
}
if ($lease -isnot [pscustomobject]) {
    throw 'run-lease-object-required'
}
Assert-ExactPropertySet -InputObject $lease -ExpectedNames @(
    'schema', 'runId', 'controllerRunId', 'generationId', 'controller', 'janvim'
)
if ($lease.controller -isnot [pscustomobject] -or $lease.janvim -isnot [pscustomobject]) {
    throw 'run-lease-nested-object-invalid'
}
Assert-ExactPropertySet -InputObject $lease.controller -ExpectedNames @(
    'pid', 'startedAtUtc'
)
Assert-ExactPropertySet -InputObject $lease.janvim -ExpectedNames @(
    'pid', 'startedAtUtc', 'hwnd', 'executableRelativePath', 'executableSha256'
)
if (
    $lease.schema -isnot [long] -or $lease.schema -ne 1 -or
    $lease.runId -isnot [string] -or
    $lease.runId -cnotmatch '^[A-Za-z0-9._-]{1,64}$' -or
    $lease.runId -cmatch '[0-9A-Fa-f]{48}' -or
    $lease.runId -cne $runId -or
    $lease.controllerRunId -isnot [string] -or
    $lease.controllerRunId -cnotmatch '^[A-Za-z0-9._-]{1,96}$' -or
    $lease.controllerRunId -cmatch '[0-9A-Fa-f]{48}' -or
    $lease.generationId -isnot [long] -or
    $lease.generationId -le 0 -or
    $lease.generationId -gt 9007199254740991 -or
    $lease.controller.pid -isnot [long] -or $lease.controller.pid -le 0 -or
    $lease.controller.pid -gt [int]::MaxValue -or
    $lease.janvim.pid -isnot [long] -or $lease.janvim.pid -le 0 -or
    $lease.janvim.pid -gt [int]::MaxValue -or
    $lease.janvim.hwnd -isnot [string] -or
    $lease.janvim.hwnd -cnotmatch '^0x[0-9A-Fa-f]{1,16}$' -or
    $lease.janvim.hwnd -cmatch '^0x0+$' -or
    $lease.janvim.executableRelativePath -isnot [string] -or
    $lease.janvim.executableRelativePath -cne 'janvim-core.exe' -or
    $lease.janvim.executableSha256 -isnot [string] -or
    $lease.janvim.executableSha256 -cnotmatch '^[0-9a-f]{64}$'
) {
    throw 'run-lease-scalar-invalid'
}

$expectedControllerStart = Convert-StrictUtcInstant -Value $lease.controller.startedAtUtc
[void](Convert-StrictUtcInstant -Value $lease.janvim.startedAtUtc)
$controllerRunId = [string]$lease.controllerRunId
$currentGenerationId = [long]$lease.generationId
$controllerPid = [int]$lease.controller.pid
if (
    $controllerRunId -cnotmatch '^[A-Za-z0-9._-]{1,96}$' -or
    $currentGenerationId -le 0
) {
    throw 'current-controller-lease-identity-invalid'
}

$controllerProcess = Get-Process -Id $controllerPid -ErrorAction Stop
try {
    [void]$controllerProcess.Handle
    $actualControllerStartMs =
        ([DateTimeOffset]$controllerProcess.StartTime.ToUniversalTime()).ToUnixTimeMilliseconds()
    if ($actualControllerStartMs -ne $expectedControllerStart.ToUnixTimeMilliseconds()) {
        throw 'current-controller-start-identity-mismatch'
    }
    Stop-Process -Id $controllerPid
}
finally {
    $controllerProcess.Dispose()
}
```

Visible result -> the watchdog records the failed controller attempt and starts one new controller
invocation at explicit ready, with no checkpoint and no automatic Start.

Machine evidence -> the retained watchdog event records the failed controller run ID, exact PID,
exit, attempt, and 1/2/4-second delay; the new controller run ID is distinct and begins at ready.

Bounded failure branch -> any missing, malformed, stale, oversized, or mismatched lease/process
identity aborts before the stop. If the bounded watchdog cannot return to ready, preserve all
external evidence and run the frozen G2 short loop.

## Exact Shutdown

Precondition -> Stop Show, SIGINT, window-close, or an approved operator-observed fault has
requested shutdown.

Exact command/action -> allow the controller's one bounded ladder: invalidate generation; stop
driver; request agent shutdown (2 seconds, one retry); close the exact placed HWND (2 seconds,
4096-byte receipt); wait for JanVim (5 seconds); force only the exact proven PID if needed; wait
5 seconds; close bridge (5 seconds); flush, finalize evidence, and write the terminal marker.

Visible result -> exactly one cleanup settles, even when Stop, SIGINT, and window-close race.

Machine evidence -> shutdown records requested reason, phase failures, child settlement, lease
removal, forced termination, and zero retained active counts.

Bounded failure branch -> an unsettled child or failed phase is an incident: stop further
recovery, retain the lease/evidence, and hand off to the operator.

## Evidence Review

Precondition -> the controller is stopped and its fixed log/evidence files are closed.

Exact command/action -> review the terminal marker, strict evidence, four fixed log slots per
stream, reset hashes, offline snapshots, recovery records, resource aggregates, and incident
entry.

Visible result -> each outcome is classified pass, diagnostic, or failed without claiming
physical-projector acceptance from simulation.

Machine evidence -> the evidence parser accepts the record; it retains at most three loop
summaries and bounded recovery/log records, with no raw RSS or ACK arrays.

Bounded failure branch -> if evidence is missing, non-strict, or inconsistent, classify the run
failed and preserve the external rehearsal folder for follow-up.

## G2 Fallback

Precondition -> Task 9 has failed or its evidence cannot be accepted.

Exact command/action -> stop the Task 9 controller and run the preserved frozen G2 short loop
using its approved manual acceptance flow.

Visible result -> the known G2 short loop completes independently of Task 9.

Machine evidence -> G2 receipts and the incident entry identify the fallback run separately.

Bounded failure branch -> if G2 also fails, stop all rehearsal activity and escalate; do not add P1 effects, media, or new content on installation day.

## Physical-Projector G4 Deferral

Precondition -> an automated or monitor-simulation rehearsal has finished.

Exact command/action -> record `physicalProjectorsTested: false` for monitor simulation and
schedule physical acceptance separately.

Visible result -> simulation evidence is retained without a G4 pass claim.

Machine evidence -> acceptance scope is monitor simulation and the G4 field remains deferred.

Bounded failure branch -> do not convert two-monitor evidence into G4; G4 requires three
consecutive loops on the two physical projectors, one offline run, and one forced-restart
recovery rehearsal.
