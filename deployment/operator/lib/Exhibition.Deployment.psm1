Set-StrictMode -Version Latest

$script:RehearsalParent = 'D:\VirtualData\JanVim-Exhibition-Rehearsals'
$script:MaximumDisplayMapBytes = 65536
$script:MaximumPointerBytes = 16384
$script:MaximumDefaultsBytes = 4096
$script:HashPattern = '^[0-9a-f]{64}$'
$script:TimestampPattern = '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3,7}Z$'

function Resolve-DeploymentAbsolutePath {
    param(
        [Parameter(Mandatory = $true)][string] $Path,
        [Parameter(Mandatory = $true)][string] $Reason
    )

    if ([string]::IsNullOrWhiteSpace($Path) -or -not [IO.Path]::IsPathFullyQualified($Path)) {
        throw "$Reason-invalid"
    }
    try {
        return [IO.Path]::GetFullPath($Path)
    }
    catch {
        throw "$Reason-invalid"
    }
}

function Test-DeploymentAtOrBelow {
    param(
        [Parameter(Mandatory = $true)][string] $Candidate,
        [Parameter(Mandatory = $true)][string] $Root
    )

    $resolvedCandidate = (Resolve-DeploymentAbsolutePath -Path $Candidate -Reason 'candidate').TrimEnd('\', '/')
    $resolvedRoot = (Resolve-DeploymentAbsolutePath -Path $Root -Reason 'root').TrimEnd('\', '/')
    return [string]::Equals(
        $resolvedCandidate,
        $resolvedRoot,
        [StringComparison]::OrdinalIgnoreCase
    ) -or $resolvedCandidate.StartsWith(
        "$resolvedRoot\",
        [StringComparison]::OrdinalIgnoreCase
    )
}

function Read-DeploymentBoundedJson {
    param(
        [Parameter(Mandatory = $true)][string] $Path,
        [Parameter(Mandatory = $true)][int] $MaximumBytes,
        [Parameter(Mandatory = $true)][string] $Reason
    )

    $resolved = Resolve-DeploymentAbsolutePath -Path $Path -Reason $Reason
    if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
        throw "$Reason-missing"
    }
    $item = Get-Item -LiteralPath $resolved -Force -ErrorAction Stop
    if (
        $item.Length -gt $MaximumBytes -or
        ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0
    ) {
        throw "$Reason-invalid"
    }
    $bytes = [IO.File]::ReadAllBytes($resolved)
    if ($bytes.Length -gt $MaximumBytes) {
        throw "$Reason-invalid"
    }
    try {
        $text = [Text.UTF8Encoding]::new($false, $true).GetString($bytes)
        return [pscustomobject]@{
            Path = $resolved
            Value = $text | ConvertFrom-Json -NoEnumerate -DateKind String
        }
    }
    catch {
        throw "$Reason-invalid"
    }
}

function Assert-DeploymentExactProperties {
    param(
        [Parameter(Mandatory = $true)] $Value,
        [Parameter(Mandatory = $true)][string[]] $Expected,
        [Parameter(Mandatory = $true)][string] $Reason
    )

    if ($null -eq $Value -or $Value -isnot [pscustomobject]) {
        throw "$Reason-invalid"
    }
    $actual = @($Value.PSObject.Properties.Name | Sort-Object)
    $wanted = @($Expected | Sort-Object)
    if (
        $actual.Count -ne $wanted.Count -or
        (Compare-Object -ReferenceObject $wanted -DifferenceObject $actual)
    ) {
        throw "$Reason-invalid"
    }
}

function Test-DeploymentInteger {
    param($Value)

    return $Value -is [byte] -or $Value -is [sbyte] -or
        $Value -is [int16] -or $Value -is [uint16] -or
        $Value -is [int32] -or $Value -is [uint32] -or
        $Value -is [int64] -or $Value -is [uint64]
}

function Assert-DeploymentRectangle {
    param(
        [Parameter(Mandatory = $true)] $Value,
        [Parameter(Mandatory = $true)][string] $Reason
    )

    Assert-DeploymentExactProperties `
        -Value $Value `
        -Expected @('x', 'y', 'width', 'height') `
        -Reason $Reason
    foreach ($name in @('x', 'y', 'width', 'height')) {
        if (-not (Test-DeploymentInteger -Value $Value.$name)) {
            throw "$Reason-invalid"
        }
    }
    if (
        [Math]::Abs([int64]$Value.x) -gt 262144 -or
        [Math]::Abs([int64]$Value.y) -gt 262144 -or
        [int64]$Value.width -lt 1 -or [int64]$Value.width -gt 32768 -or
        [int64]$Value.height -lt 1 -or [int64]$Value.height -gt 32768
    ) {
        throw "$Reason-invalid"
    }
}

function Assert-DeploymentDisplayRecord {
    param(
        [Parameter(Mandatory = $true)] $Value,
        [Parameter(Mandatory = $true)][bool] $Binding
    )

    $expected = @(
        'displayId', 'label', 'bounds', 'workingArea',
        'scaleFactor', 'rotation', 'geometrySha256'
    )
    if ($Binding) { $expected = @('softId') + $expected }
    Assert-DeploymentExactProperties -Value $Value -Expected $expected -Reason 'display-map'
    if (
        $Value.displayId -isnot [string] -or
        [string]::IsNullOrWhiteSpace($Value.displayId) -or
        $Value.displayId.Length -gt 256 -or
        $Value.label -isnot [string] -or
        $Value.label.Length -gt 512 -or
        $Value.geometrySha256 -isnot [string] -or
        $Value.geometrySha256 -cnotmatch $script:HashPattern
    ) {
        throw 'display-map-invalid'
    }
    if ($Binding -and $Value.softId -cnotin @('SCREEN-1', 'SCREEN-2', 'SCREEN-3')) {
        throw 'display-map-invalid'
    }
    Assert-DeploymentRectangle -Value $Value.bounds -Reason 'display-map'
    Assert-DeploymentRectangle -Value $Value.workingArea -Reason 'display-map'
    if (
        $Value.scaleFactor -isnot [ValueType] -or
        [double]$Value.scaleFactor -le 0 -or
        [double]$Value.scaleFactor -gt 8 -or
        $Value.rotation -cnotin @(0, 90, 180, 270)
    ) {
        throw 'display-map-invalid'
    }
}

function Read-ProductionDisplayMap {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string] $Path)

    $snapshot = Read-DeploymentBoundedJson `
        -Path $Path `
        -MaximumBytes $script:MaximumDisplayMapBytes `
        -Reason 'display-map'
    $map = $snapshot.Value
    Assert-DeploymentExactProperties `
        -Value $map `
        -Expected @(
            'schema', 'mappingStatus', 'mode', 'layoutSha256', 'capturedAtUtc',
            'topologySha256', 'bindings', 'unassignedDisplays'
        ) `
        -Reason 'display-map'
    if (-not (Test-DeploymentInteger -Value $map.schema) -or [int64]$map.schema -ne 2) {
        throw 'display-map-schema-invalid'
    }
    if ($map.mappingStatus -cne 'confirmed' -or $map.mode -cne 'production-3') {
        throw 'display-map-mode-invalid'
    }
    if (
        $map.layoutSha256 -isnot [string] -or
        $map.layoutSha256 -cnotmatch $script:HashPattern -or
        $map.topologySha256 -isnot [string] -or
        $map.topologySha256 -cnotmatch $script:HashPattern
    ) {
        throw 'display-map-hash-invalid'
    }
    if ($map.capturedAtUtc -isnot [string] -or $map.capturedAtUtc -cnotmatch $script:TimestampPattern) {
        throw 'display-map-timestamp-invalid'
    }
    if ($map.bindings -isnot [array] -or $map.bindings.Count -ne 3) {
        throw 'display-map-bindings-invalid'
    }
    if ($map.unassignedDisplays -isnot [array] -or $map.unassignedDisplays.Count -gt 13) {
        throw 'display-map-unassigned-invalid'
    }
    foreach ($binding in $map.bindings) {
        Assert-DeploymentDisplayRecord -Value $binding -Binding $true
    }
    foreach ($display in $map.unassignedDisplays) {
        Assert-DeploymentDisplayRecord -Value $display -Binding $false
    }
    $softIds = @($map.bindings | ForEach-Object { $_.softId })
    if (
        @($softIds | Select-Object -Unique).Count -ne 3 -or
        @($softIds | Where-Object { $_ -ceq 'SCREEN-3' }).Count -ne 1
    ) {
        throw 'display-map-screen-3-invalid'
    }
    $screen3 = @($map.bindings | Where-Object { $_.softId -ceq 'SCREEN-3' })[0]
    return [pscustomobject][ordered]@{
        mapPath = $snapshot.Path
        screen3 = [pscustomobject][ordered]@{
            displayId = $screen3.displayId
            x = [int]$screen3.bounds.x
            y = [int]$screen3.bounds.y
            width = [int]$screen3.bounds.width
            height = [int]$screen3.bounds.height
        }
    }
}

function New-ExhibitionLaunchPlan {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $PackageRoot,
        [Parameter(Mandatory = $true)][string] $DisplayMapPath,
        [ValidateRange(1, 3600)][int] $DurationSeconds = 3600
    )

    $resolvedPackage = Resolve-DeploymentAbsolutePath -Path $PackageRoot -Reason 'package-root'
    $resolvedMap = Resolve-DeploymentAbsolutePath -Path $DisplayMapPath -Reason 'display-map'
    return [pscustomobject][ordered]@{
        schema = 1
        packageRoot = $resolvedPackage
        displayMapPath = $resolvedMap
        durationSeconds = $DurationSeconds
        listen = $true
        startPolicy = 'Automatic'
        components = @(
            [pscustomobject][ordered]@{
                name = 'sound'
                launcher = Join-Path $resolvedPackage 'app\sound\joint-rehearsal.ps1'
            }
            [pscustomobject][ordered]@{
                name = 'jianshan'
                executable = Join-Path $resolvedPackage 'runtime\jianshan\jianshan.exe'
            }
            [pscustomobject][ordered]@{
                name = 'show'
                launcher = Join-Path $resolvedPackage 'app\sound\joint-rehearsal.ps1'
            }
        )
    }
}

function Read-ExhibitionSiteDefaults {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string] $Path)

    $snapshot = Read-DeploymentBoundedJson `
        -Path $Path `
        -MaximumBytes $script:MaximumDefaultsBytes `
        -Reason 'site-defaults'
    $value = $snapshot.Value
    Assert-DeploymentExactProperties `
        -Value $value `
        -Expected @(
            'schema', 'packageRoot', 'rehearsalParent', 'siteConfigRoot',
            'audioOutputDevice', 'durationSeconds'
        ) `
        -Reason 'site-defaults'
    if (
        -not (Test-DeploymentInteger -Value $value.schema) -or
        [int64]$value.schema -ne 1 -or
        $value.packageRoot -cne 'D:\github\JanVim-Exhibition-Deploy' -or
        $value.rehearsalParent -cne $script:RehearsalParent -or
        $value.siteConfigRoot -cne (Join-Path $script:RehearsalParent 'site-config') -or
        $value.audioOutputDevice -isnot [string] -or
        $value.audioOutputDevice -cne 'Windows WASAPI : Speakers (Realtek High Definition Audio)' -or
        -not (Test-DeploymentInteger -Value $value.durationSeconds) -or
        [int64]$value.durationSeconds -ne 3600
    ) {
        throw 'site-defaults-invalid'
    }
    return $value
}

function Assert-DeploymentElectronRuntime {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string] $AppRoot)

    $app = Resolve-DeploymentAbsolutePath -Path $AppRoot -Reason 'electron-app-root'
    $inventory = (Read-DeploymentBoundedJson `
        -Path (Join-Path $PSScriptRoot '..\..\config\electron-runtime.lock.json') `
        -MaximumBytes 32768 -Reason 'electron-runtime-lock').Value
    Assert-DeploymentExactProperties -Value $inventory `
        -Expected @('schema', 'version', 'platform', 'archive', 'files') -Reason 'electron-runtime-lock'
    if (
        -not (Test-DeploymentInteger $inventory.schema) -or $inventory.schema -ne 1 -or
        $inventory.version -isnot [string] -or $inventory.version -cne '44.0.0' -or
        $inventory.platform -isnot [string] -or $inventory.platform -cne 'win32-x64' -or
        $inventory.files -isnot [array] -or $inventory.files.Count -ne 73
    ) { throw 'electron-runtime-lock-invalid' }
    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($entry in $inventory.files) {
        Assert-DeploymentExactProperties -Value $entry -Expected @('path', 'bytes', 'sha256') -Reason 'electron-runtime-lock'
        if (
            $entry.path -isnot [string] -or $entry.path.Length -gt 256 -or
            $entry.path -cnotmatch '^[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*$' -or
            @($entry.path.Split('/') | Where-Object { $_ -in @('.', '..') }).Count -ne 0 -or
            -not $seen.Add($entry.path) -or
            -not (Test-DeploymentInteger $entry.bytes) -or $entry.bytes -lt 0 -or $entry.bytes -gt 268435456 -or
            $entry.sha256 -isnot [string] -or $entry.sha256 -cnotmatch $script:HashPattern
        ) { throw 'electron-runtime-lock-invalid' }
    }
    foreach ($directory in @($app, (Join-Path $app 'node_modules'), (Join-Path $app 'node_modules\electron'))) {
        if (-not (Test-Path -LiteralPath $directory -PathType Container)) { throw 'electron-runtime-directory-missing' }
        if (((Get-Item -LiteralPath $directory -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw 'electron-runtime-reparse-rejected'
        }
    }
    $runtime = Join-Path $app 'node_modules\electron'
    $relativeFiles = @('path.txt', 'package.json') + @($inventory.files | ForEach-Object { 'dist/' + $_.path })
    foreach ($relative in $relativeFiles) {
        $file = Join-Path $runtime $relative
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "electron-runtime-file-missing:$relative" }
        $segments = $relative.Split('/')
        $candidate = $runtime
        foreach ($segment in $segments) {
            $candidate = Join-Path $candidate $segment
            if (((Get-Item -LiteralPath $candidate -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw 'electron-runtime-reparse-rejected'
            }
        }
    }
    $launcher = Join-Path $runtime 'path.txt'
    if ((Get-Item -LiteralPath $launcher).Length -ne 12 -or [IO.File]::ReadAllText($launcher) -cne 'electron.exe') {
        throw 'electron-runtime-launcher-invalid'
    }
    $package = (Read-DeploymentBoundedJson -Path (Join-Path $runtime 'package.json') `
        -MaximumBytes 65536 -Reason 'electron-runtime-package').Value
    $versionPath = Join-Path $runtime 'dist\version'
    if (
        $package.version -isnot [string] -or $package.version -cne $inventory.version -or
        (Get-Item -LiteralPath $versionPath).Length -ne 6 -or
        [IO.File]::ReadAllText($versionPath) -cne $inventory.version
    ) { throw 'electron-runtime-version-invalid' }
    foreach ($entry in $inventory.files) {
        $file = Join-Path $runtime ('dist/' + $entry.path)
        if (
            (Get-Item -LiteralPath $file).Length -ne $entry.bytes -or
            (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -cne $entry.sha256
        ) { throw ('electron-runtime-identity-mismatch:dist/' + $entry.path) }
    }
    return [pscustomobject]@{ version = $inventory.version; files = $inventory.files.Count }
}

function Assert-DeploymentProcessIdentityRecord {
    param($Value)

    if ($null -eq $Value) { return }
    Assert-DeploymentExactProperties `
        -Value $Value `
        -Expected @('pid', 'startedAtUtc', 'executable') `
        -Reason 'active-deployment'
    if (
        -not (Test-DeploymentInteger -Value $Value.pid) -or
        [int64]$Value.pid -lt 1 -or [int64]$Value.pid -gt 2147483647 -or
        $Value.startedAtUtc -isnot [string] -or
        $Value.startedAtUtc -cnotmatch $script:TimestampPattern -or
        $Value.executable -isnot [string] -or
        -not [IO.Path]::IsPathFullyQualified($Value.executable)
    ) {
        throw 'active-deployment-invalid'
    }
}

function Assert-ActiveDeploymentPointerValue {
    param([Parameter(Mandatory = $true)] $Value)

    Assert-DeploymentExactProperties `
        -Value $Value `
        -Expected @(
            'schema', 'runRoot', 'sessionFile', 'soundWrapper',
            'jianshan', 'showWrapper', 'controller'
        ) `
        -Reason 'active-deployment'
    if (
        -not (Test-DeploymentInteger -Value $Value.schema) -or
        [int64]$Value.schema -ne 1 -or
        $Value.runRoot -isnot [string] -or
        $Value.sessionFile -isnot [string] -or
        -not (Test-DeploymentAtOrBelow -Candidate $Value.runRoot -Root $script:RehearsalParent) -or
        -not (Test-DeploymentAtOrBelow -Candidate $Value.sessionFile -Root $script:RehearsalParent)
    ) {
        throw 'active-deployment-invalid'
    }
    foreach ($name in @('soundWrapper', 'jianshan', 'showWrapper', 'controller')) {
        Assert-DeploymentProcessIdentityRecord -Value $Value.$name
    }
}

function Read-ActiveDeploymentPointer {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string] $Path)

    $snapshot = Read-DeploymentBoundedJson `
        -Path $Path `
        -MaximumBytes $script:MaximumPointerBytes `
        -Reason 'active-deployment'
    $value = $snapshot.Value
    Assert-ActiveDeploymentPointerValue -Value $value
    return $value
}

function Write-ActiveDeploymentPointerAtomic {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $Path,
        [Parameter(Mandatory = $true)] $Value
    )

    Assert-ActiveDeploymentPointerValue -Value $Value
    $resolved = Resolve-DeploymentAbsolutePath -Path $Path -Reason 'active-deployment'
    $parent = [IO.Path]::GetDirectoryName($resolved)
    if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
        throw 'active-deployment-parent-missing'
    }
    $parentItem = Get-Item -LiteralPath $parent -Force -ErrorAction Stop
    if (($parentItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'active-deployment-parent-invalid'
    }
    if (Test-Path -LiteralPath $resolved) {
        $existing = Get-Item -LiteralPath $resolved -Force -ErrorAction Stop
        if ($existing.PSIsContainer -or ($existing.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw 'active-deployment-invalid'
        }
    }
    $json = ($Value | ConvertTo-Json -Depth 8 -Compress) + "`n"
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes($json)
    if ($bytes.Length -gt $script:MaximumPointerBytes) {
        throw 'active-deployment-invalid'
    }
    $temporary = Join-Path $parent ('.active-deployment-{0}.tmp' -f [Guid]::NewGuid().ToString('N'))
    $stream = $null
    try {
        $stream = [IO.File]::Open(
            $temporary,
            [IO.FileMode]::CreateNew,
            [IO.FileAccess]::Write,
            [IO.FileShare]::Read
        )
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Flush($true)
        $stream.Dispose()
        $stream = $null
        [IO.File]::Move($temporary, $resolved, $true)
    }
    finally {
        if ($null -ne $stream) { $stream.Dispose() }
        if (Test-Path -LiteralPath $temporary) {
            Remove-Item -LiteralPath $temporary -Force
        }
    }
}

function Remove-ActiveDeploymentPointer {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string] $Path)

    $resolved = Resolve-DeploymentAbsolutePath -Path $Path -Reason 'active-deployment'
    if (-not (Test-Path -LiteralPath $resolved)) { return }
    $item = Get-Item -LiteralPath $resolved -Force -ErrorAction Stop
    if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'active-deployment-invalid'
    }
    Remove-Item -LiteralPath $resolved -Force
}

function Enter-ExhibitionLaunchGuard {
    [CmdletBinding()]
    param()
    $guard = [Threading.Mutex]::new($false, 'Global\JanVimExhibitionDeployment')
    try {
        $owned = $false
        try { $owned = $guard.WaitOne(0) }
        catch [Threading.AbandonedMutexException] { $owned = $true }
        if (-not $owned) { throw 'exhibition-launch-already-running' }
        return $guard
    } catch {
        $guard.Dispose()
        throw
    }
}

function Restore-ExhibitionStartupAfterReboot {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $Path,
        [Parameter(Mandatory = $true)][string] $ArchiveRoot,
        [Parameter(Mandatory = $true)][datetime] $BootTimeUtc
    )

    $resolved = Resolve-DeploymentAbsolutePath -Path $Path -Reason 'active-deployment'
    if (-not (Test-Path -LiteralPath $resolved)) { return }
    $pointer = Read-ActiveDeploymentPointer -Path $resolved
    $boot = $BootTimeUtc.ToUniversalTime()
    $item = Get-Item -LiteralPath $resolved -Force -ErrorAction Stop
    # Only a previous Windows boot proves that all original processes are gone.
    # Current-boot and inconsistent records remain fail-closed, including reused PIDs.
    if ($item.LastWriteTimeUtc -ge $boot) { throw 'active-deployment-already-exists' }
    foreach ($name in @('soundWrapper','jianshan','showWrapper','controller')) {
        $identity = $pointer.$name
        if ($null -eq $identity) { continue }
        $started = [DateTimeOffset]::ParseExact($identity.startedAtUtc, 'o', [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind).UtcDateTime
        if ($started -ge $boot) { throw 'active-deployment-already-exists' }
    }
    $archiveDirectory = Resolve-DeploymentAbsolutePath -Path $ArchiveRoot -Reason 'recovery-archive'
    $directory = Get-Item -LiteralPath $archiveDirectory -Force -ErrorAction Stop
    if (-not $directory.PSIsContainer -or ($directory.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'recovery-archive-invalid' }
    $archive = [IO.Path]::GetFullPath((Join-Path $archiveDirectory 'previous-active-deployment.json'))
    if ([IO.Path]::GetDirectoryName($archive) -ine $archiveDirectory -or (Test-Path -LiteralPath $archive)) { throw 'recovery-archive-invalid' }
    # Caller holds the launch mutex until the whole show exits. Preserve exact bytes;
    # do not read old session/control files, stop unrelated processes or restore maps.
    Move-Item -LiteralPath $resolved -Destination $archive -ErrorAction Stop
    return [pscustomobject]@{status='previous-boot-marker-preserved';archivePath=$archive}
}

function Get-DeploymentProcessIdentity {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][Diagnostics.Process] $Process,
        [string] $ExpectedExecutable
    )

    try {
        $pinnedHandle = $Process.SafeHandle
        if ($pinnedHandle.IsInvalid -or $pinnedHandle.IsClosed) {
            throw 'deployment-process-identity-unavailable'
        }
    }
    catch {
        throw 'deployment-process-identity-unavailable'
    }
    $path = $null
    $started = $null
    $available = $false
    $expected = if ([string]::IsNullOrWhiteSpace($ExpectedExecutable)) { $null } else {
        Resolve-DeploymentAbsolutePath -Path $ExpectedExecutable -Reason 'deployment-process-executable'
    }
    # A just-created native image can precede readable module metadata.
    # Keep the original handle and bound the total retry delay to 1,950 ms.
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        try {
            $Process.Refresh()
            if ($Process.HasExited) { break }
            $path = $Process.Path
        }
        catch {
            $path = $null
        }
        if (-not [string]::IsNullOrWhiteSpace($path)) {
            $resolvedPath = Resolve-DeploymentAbsolutePath -Path $path -Reason 'deployment-process-executable'
            if ($null -ne $expected -and -not [string]::Equals($resolvedPath, $expected, [StringComparison]::OrdinalIgnoreCase)) {
                throw 'deployment-process-executable-mismatch'
            }
            try {
                $started = $Process.StartTime.ToUniversalTime()
                $available = $true
            }
            catch { $available = $false }
        }
        if ($available) { break }
        if ($attempt -lt 39) { Start-Sleep -Milliseconds 50 }
    }
    if (-not $available) {
        throw 'deployment-process-identity-unavailable'
    }
    return [pscustomobject][ordered]@{
        pid = [int]$Process.Id
        startedAtUtc = $started.ToString('o')
        executable = $resolvedPath
    }
}

function Get-DeploymentExactProcess {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)] $Identity)

    Assert-DeploymentProcessIdentityRecord -Value $Identity
    if ($null -eq $Identity) { return $null }
    $candidate = $null
    try {
        $expectedStart = [DateTimeOffset]::ParseExact(
            $Identity.startedAtUtc,
            'o',
            [Globalization.CultureInfo]::InvariantCulture,
            [Globalization.DateTimeStyles]::RoundtripKind
        ).UtcDateTime
        $candidate = [Diagnostics.Process]::GetProcessById([int]$Identity.pid)
        $pinnedHandle = $candidate.SafeHandle
        if ($pinnedHandle.IsInvalid -or $pinnedHandle.IsClosed) {
            throw 'deployment-process-identity-unavailable'
        }
        $actualStart = $candidate.StartTime.ToUniversalTime()
        $actualPath = Resolve-DeploymentAbsolutePath `
            -Path $candidate.Path `
            -Reason 'deployment-process-executable'
        if (
            $actualStart.Ticks -ne $expectedStart.Ticks -or
            -not [string]::Equals(
                $actualPath,
                $Identity.executable,
                [StringComparison]::OrdinalIgnoreCase
            )
        ) {
            $candidate.Dispose()
            $candidate = $null
        }
        return $candidate
    }
    catch {
        if ($null -ne $candidate) { $candidate.Dispose() }
        return $null
    }
}

function Test-DeploymentProcessIdentity {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)] $Identity)

    $candidate = Get-DeploymentExactProcess -Identity $Identity
    try {
        return $null -ne $candidate
    }
    finally {
        if ($null -ne $candidate) { $candidate.Dispose() }
    }
}

function Wait-DeploymentProcessExit {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] $Identity,
        [ValidateRange(0, 60000)][int] $TimeoutMs
    )

    $clock = [Diagnostics.Stopwatch]::StartNew()
    while ($clock.ElapsedMilliseconds -lt $TimeoutMs) {
        if (-not (Test-DeploymentProcessIdentity -Identity $Identity)) { return $true }
        [Threading.Thread]::Sleep([Math]::Min(50, [Math]::Max(1, $TimeoutMs - [int]$clock.ElapsedMilliseconds)))
    }
    return -not (Test-DeploymentProcessIdentity -Identity $Identity)
}

function Stop-DeploymentProcessExact {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] $Identity,
        [ValidateRange(0, 60000)][int] $TimeoutMs = 5000,
        [switch] $CloseFirst
    )

    Assert-DeploymentProcessIdentityRecord -Value $Identity
    $candidate = Get-DeploymentExactProcess -Identity $Identity
    if ($null -eq $candidate) { return $true }
    try {
        if ($CloseFirst) { [void]$candidate.CloseMainWindow() }
    }
    finally {
        $candidate.Dispose()
    }
    if (Wait-DeploymentProcessExit -Identity $Identity -TimeoutMs $TimeoutMs) { return $true }
    $candidate = Get-DeploymentExactProcess -Identity $Identity
    if ($null -eq $candidate) { return $true }
    try {
        $candidate.Kill($true)
    }
    finally {
        $candidate.Dispose()
    }
    return Wait-DeploymentProcessExit -Identity $Identity -TimeoutMs $TimeoutMs
}

function Invoke-ExhibitionPowerOff {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)] $TerminalMarker,
        [Parameter(Mandatory = $true)][string] $ExpectedRunId,
        [Parameter(Mandatory = $true)][int] $ExpectedControllerPid,
        [Parameter(Mandatory = $true)][int] $ShowExitCode,
        [Parameter(Mandatory = $true)][bool] $SoundClean,
        [Parameter(Mandatory = $true)][bool] $ChildrenExited
    )
    $names = @($TerminalMarker.PSObject.Properties.Name)
    $required = @('schema','runId','controllerRunId','controllerPid','outcome','reason')
    if ($names.Count -ne $required.Count -or @($required | Where-Object { $_ -cnotin $names }).Count -ne 0) { throw 'poweroff-terminal-invalid' }
    if ($TerminalMarker.schema -isnot [long] -and $TerminalMarker.schema -isnot [int]) { throw 'poweroff-terminal-invalid' }
    if (($TerminalMarker.controllerPid -isnot [long] -and $TerminalMarker.controllerPid -isnot [int]) -or
        $TerminalMarker.schema -ne 1 -or $TerminalMarker.runId -cne $ExpectedRunId -or
        $TerminalMarker.controllerPid -ne $ExpectedControllerPid -or $ExpectedControllerPid -lt 1 -or
        $TerminalMarker.controllerRunId -isnot [string] -or $TerminalMarker.controllerRunId -cnotmatch '^[A-Za-z0-9._-]{1,96}$' -or
        $TerminalMarker.outcome -cne 'intentional-success') { throw 'poweroff-terminal-invalid' }
    if ($ShowExitCode -ne 0 -or -not $SoundClean -or -not $ChildrenExited) { throw 'poweroff-cleanup-incomplete' }
    if ($TerminalMarker.reason -cne 'operator-stop-poweroff') { return }
    # Standard Windows shutdown; do not force-close unrelated applications.
    $process = Start-Process -FilePath (Join-Path ([Environment]::GetFolderPath('Windows')) 'System32\shutdown.exe') -ArgumentList @('/s','/t','0') -WindowStyle Hidden -PassThru
    try {
        if (-not $process.WaitForExit(5000)) { throw 'windows-shutdown-request-timeout' }
        if ($process.ExitCode -ne 0) { throw 'windows-shutdown-request-failed' }
    } finally { $process.Dispose() }
}

Export-ModuleMember -Function @(
    'Enter-ExhibitionLaunchGuard',
    'Restore-ExhibitionStartupAfterReboot',
    'Invoke-ExhibitionPowerOff',
    'Assert-DeploymentElectronRuntime',
    'Read-ExhibitionSiteDefaults',
    'Read-ProductionDisplayMap',
    'New-ExhibitionLaunchPlan',
    'Read-ActiveDeploymentPointer',
    'Write-ActiveDeploymentPointerAtomic',
    'Remove-ActiveDeploymentPointer',
    'Get-DeploymentProcessIdentity',
    'Test-DeploymentProcessIdentity',
    'Wait-DeploymentProcessExit',
    'Stop-DeploymentProcessExact'
)
