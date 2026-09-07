[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$packageRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$rootItem = Get-Item -LiteralPath $packageRoot -Force
if (-not $rootItem.PSIsContainer -or ($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'deployment-package-root-invalid'
}
$modulePath = Join-Path $PSScriptRoot 'lib\Exhibition.Deployment.psm1'
Import-Module $modulePath -Force
$defaults = Read-ExhibitionSiteDefaults -Path (Join-Path $packageRoot 'config\site-defaults.json')
if (-not [string]::Equals($packageRoot, $defaults.packageRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'deployment-package-root-invalid'
}

$powerShell = @(Get-Command pwsh.exe -CommandType Application -ErrorAction Stop)[0].Source
$node = Join-Path $packageRoot 'tools\node\node.exe'
$joint = Join-Path $packageRoot 'app\sound\joint-rehearsal.ps1'
$verify = Join-Path $PSScriptRoot 'Verify-Deployment.ps1'
$configGenerator = Join-Path $PSScriptRoot 'lib\jianshan-config.mjs'
$placementHelper = Join-Path $packageRoot 'app\scripts\place-jianshan-window.ps1'
$jianshanRoot = Join-Path $packageRoot 'runtime\jianshan'
$jianshanExecutable = Join-Path $jianshanRoot 'jianshan.exe'
$jianshanTemplate = Join-Path $jianshanRoot 'jianshan-flock-v1.toml'
$displayMapPath = Join-Path $defaults.siteConfigRoot 'display-map.json'
$pointerPath = Join-Path $defaults.siteConfigRoot 'active-deployment.json'

function Invoke-DeploymentProcessCaptured {
    param(
        [Parameter(Mandatory = $true)][string] $FilePath,
        [Parameter(Mandatory = $true)][string[]] $Arguments,
        [Parameter(Mandatory = $true)][int] $TimeoutMs,
        [string] $WorkingDirectory = $packageRoot
    )

    $startInfo = [Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $FilePath
    $startInfo.WorkingDirectory = $WorkingDirectory
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    foreach ($argument in $Arguments) { [void]$startInfo.ArgumentList.Add($argument) }
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    try {
        if (-not $process.Start()) { throw 'deployment-child-start-failed' }
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit($TimeoutMs)) {
            try { $process.Kill($true) } catch {}
            [void]$process.WaitForExit(2000)
            throw 'deployment-child-timeout'
        }
        return [pscustomobject]@{
            ExitCode = $process.ExitCode
            Stdout = $stdout.GetAwaiter().GetResult()
            Stderr = $stderr.GetAwaiter().GetResult()
        }
    }
    finally {
        $process.Dispose()
    }
}

function Start-DeploymentChild {
    param(
        [Parameter(Mandatory = $true)][string] $FilePath,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]] $Arguments,
        [Parameter(Mandatory = $true)][string] $WorkingDirectory,
        [hashtable] $Environment = @{}
    )

    $startInfo = [Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $FilePath
    $startInfo.WorkingDirectory = $WorkingDirectory
    $startInfo.UseShellExecute = $false
    foreach ($argument in $Arguments) { [void]$startInfo.ArgumentList.Add($argument) }
    foreach ($name in $Environment.Keys) { $startInfo.Environment[$name] = [string]$Environment[$name] }
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    if (-not $process.Start()) {
        $process.Dispose()
        throw 'deployment-child-start-failed'
    }
    return $process
}

function Wait-DeploymentFile {
    param(
        [Parameter(Mandatory = $true)][string] $Path,
        [Parameter(Mandatory = $true)][int] $TimeoutMs,
        [Parameter(Mandatory = $true)][int] $MaximumBytes,
        [Parameter(Mandatory = $true)][string] $Reason
    )

    $clock = [Diagnostics.Stopwatch]::StartNew()
    while ($clock.ElapsedMilliseconds -lt $TimeoutMs) {
        if (Test-Path -LiteralPath $Path -PathType Leaf) {
            $item = Get-Item -LiteralPath $Path -Force
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $item.Length -gt $MaximumBytes) {
                throw "$Reason-invalid"
            }
            return $item
        }
        [Threading.Thread]::Sleep(50)
    }
    throw "$Reason-timeout"
}

function Get-OutputValue {
    param(
        [Parameter(Mandatory = $true)][string] $Text,
        [Parameter(Mandatory = $true)][string] $Label
    )

    $matches = @($Text -split '\r?\n' | Where-Object { $_.StartsWith("$Label ", [StringComparison]::Ordinal) })
    if ($matches.Count -ne 1) { throw "deployment-$($Label.ToLowerInvariant())-invalid" }
    return $matches[0].Substring($Label.Length + 1)
}

function Read-DeploymentJson {
    param(
        [Parameter(Mandatory = $true)][string] $Path,
        [Parameter(Mandatory = $true)][int] $MaximumBytes,
        [Parameter(Mandatory = $true)][string] $Reason
    )

    $item = Wait-DeploymentFile -Path $Path -TimeoutMs 1 -MaximumBytes $MaximumBytes -Reason $Reason
    try {
        $bytes = [IO.File]::ReadAllBytes($item.FullName)
        return [Text.UTF8Encoding]::new($false, $true).GetString($bytes) |
            ConvertFrom-Json -NoEnumerate -DateKind String
    }
    catch {
        throw "$Reason-invalid"
    }
}

function Write-CurrentPointer {
    $value = [pscustomobject][ordered]@{
        schema = 1
        runRoot = $runRoot
        sessionFile = $sessionFile
        soundWrapper = $soundIdentity
        jianshan = $jianshanIdentity
        showWrapper = $showIdentity
        controller = $controllerIdentity
    }
    Write-ActiveDeploymentPointerAtomic -Path $pointerPath -Value $value
}

function Request-SoundStop {
    if ([string]::IsNullOrWhiteSpace($sessionFile)) { return }
    $result = Invoke-DeploymentProcessCaptured `
        -FilePath $powerShell `
        -Arguments @(
            '-NoLogo', '-NoProfile', '-NonInteractive', '-File', $joint,
            '-Action', 'StopSound', '-SessionFile', $sessionFile,
            '-NodeExecutable', $node
        ) `
        -TimeoutMs 15000
    if ($result.ExitCode -ne 0) { throw 'deployment-sound-stop-failed' }
}

$soundProcess = $null
$jianshanProcess = $null
$showProcess = $null
$soundIdentity = $null
$jianshanIdentity = $null
$showIdentity = $null
$controllerIdentity = $null
$sessionFile = ''
$soundRoot = ''
$runRoot = ''
$pointerWritten = $false

try {
    if (Test-Path -LiteralPath $pointerPath) { throw 'active-deployment-already-exists' }

    # Deployment stage: verify
    $verification = Invoke-DeploymentProcessCaptured `
        -FilePath $powerShell `
        -Arguments @('-NoLogo', '-NoProfile', '-NonInteractive', '-File', $verify) `
        -TimeoutMs 60000
    if ($verification.ExitCode -ne 0 -or $verification.Stdout -cnotmatch 'DEPLOYMENT_VERIFY_PASS') {
        throw 'deployment-verification-failed'
    }

    $display = Read-ProductionDisplayMap -Path $displayMapPath
    $plan = New-ExhibitionLaunchPlan `
        -PackageRoot $packageRoot `
        -DisplayMapPath $displayMapPath `
        -DurationSeconds ([int]$defaults.durationSeconds)

    $runId = 'deployment-{0}-{1}' -f `
        [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ'), `
        [Guid]::NewGuid().ToString('N').Substring(0, 12)
    $runRoot = Join-Path $defaults.rehearsalParent $runId
    [void](New-Item -ItemType Directory -Path $runRoot)

    # Deployment stage: prepare
    $prepare = Invoke-DeploymentProcessCaptured `
        -FilePath $powerShell `
        -Arguments @(
            '-NoLogo', '-NoProfile', '-NonInteractive', '-File', $joint,
            '-Action', 'Prepare', '-DisplayMapPath', $plan.displayMapPath,
            '-Duration', ([string]$plan.durationSeconds)
        ) `
        -TimeoutMs 30000
    if ($prepare.ExitCode -ne 0) { throw 'deployment-prepare-failed' }
    $sessionFile = Get-OutputValue -Text $prepare.Stdout -Label 'SESSION_FILE'
    $soundRoot = Get-OutputValue -Text $prepare.Stdout -Label 'SOUND_ROOT'

    # Deployment stage: sound
    $soundProcess = Start-DeploymentChild `
        -FilePath $powerShell `
        -WorkingDirectory (Join-Path $packageRoot 'app') `
        -Arguments @(
            '-NoLogo', '-NoProfile', '-NonInteractive', '-File', $joint,
            '-Action', 'Sound', '-SessionFile', $sessionFile,
            '-Listen', '-NodeExecutable', $node
        )
    $soundIdentity = Get-DeploymentProcessIdentity -Process $soundProcess -ExpectedExecutable $powerShell

    [void](Wait-DeploymentFile -Path (Join-Path $soundRoot 'ready.json') -TimeoutMs 45000 -MaximumBytes 65536 -Reason 'sound-ready')
    $descriptorPath = Join-Path $soundRoot 'flock-input.json'
    [void](Wait-DeploymentFile -Path $descriptorPath -TimeoutMs 45000 -MaximumBytes 4096 -Reason 'flock-input')

    # Deployment stage: jianshan-config
    $liveConfig = Join-Path $runRoot 'jianshan-live.toml'
    $config = Invoke-DeploymentProcessCaptured `
        -FilePath $node `
        -Arguments @(
            $configGenerator, '--template', $jianshanTemplate,
            '--descriptor', $descriptorPath, '--output', $liveConfig
        ) `
        -WorkingDirectory $jianshanRoot `
        -TimeoutMs 5000
    if ($config.ExitCode -ne 0 -or $config.Stdout -cnotmatch 'jianshan-live-config-written') {
        throw 'jianshan-live-config-failed'
    }

    $jianshanProcess = Start-DeploymentChild `
        -FilePath $jianshanExecutable `
        -Arguments @() `
        -WorkingDirectory $jianshanRoot `
        -Environment @{ JIANSHAN_CONFIG_PATH = $liveConfig }
    $jianshanIdentity = Get-DeploymentProcessIdentity `
        -Process $jianshanProcess `
        -ExpectedExecutable $jianshanExecutable

    # Deployment stage: jianshan-place
    $placement = Invoke-DeploymentProcessCaptured `
        -FilePath $powerShell `
        -Arguments @(
            '-NoLogo', '-NoProfile', '-NonInteractive', '-File', $placementHelper,
            '-ChildProcessId', ([string]$jianshanIdentity.pid),
            '-ExpectedStartedAtUtc', $jianshanIdentity.startedAtUtc,
            '-X', ([string]$display.screen3.x), '-Y', ([string]$display.screen3.y),
            '-Width', ([string]$display.screen3.width), '-Height', ([string]$display.screen3.height),
            '-TimeoutMs', '10000'
        ) `
        -TimeoutMs 20000
    if ($placement.ExitCode -ne 0) { throw 'jianshan-window-placement-failed' }

    Write-CurrentPointer
    $pointerWritten = $true

    # Deployment stage: show
    $showProcess = Start-DeploymentChild `
        -FilePath $powerShell `
        -WorkingDirectory (Join-Path $packageRoot 'app') `
        -Arguments @(
            '-NoLogo', '-NoProfile', '-NonInteractive', '-File', $joint,
            '-Action', 'Show', '-SessionFile', $sessionFile,
            '-StartPolicy', 'Automatic', '-NodeExecutable', $node
        )
    $showIdentity = Get-DeploymentProcessIdentity -Process $showProcess -ExpectedExecutable $powerShell
    Write-CurrentPointer

    $showRoot = Get-OutputValue -Text $prepare.Stdout -Label 'SHOW_ROOT'
    $leasePath = Join-Path $showRoot 'run-lease.json'
    [void](Wait-DeploymentFile -Path $leasePath -TimeoutMs 45000 -MaximumBytes 4096 -Reason 'show-run-lease')
    $lease = Read-DeploymentJson -Path $leasePath -MaximumBytes 4096 -Reason 'show-run-lease'
    if ($lease.schema -ne 1 -or $null -eq $lease.controller) { throw 'show-run-lease-invalid' }
    $controllerProcess = [Diagnostics.Process]::GetProcessById([int]$lease.controller.pid)
    try {
        $actualController = Get-DeploymentProcessIdentity -Process $controllerProcess
    }
    finally {
        $controllerProcess.Dispose()
    }
    $controllerIdentity = [pscustomobject][ordered]@{
        pid = [int]$lease.controller.pid
        startedAtUtc = [string]$lease.controller.startedAtUtc
        executable = $actualController.executable
    }
    if (-not (Test-DeploymentProcessIdentity -Identity $controllerIdentity)) {
        throw 'show-controller-identity-invalid'
    }
    Write-CurrentPointer

    if (-not $showProcess.WaitForExit(([int]$plan.durationSeconds + 120) * 1000)) {
        throw 'show-wrapper-timeout'
    }
    $showExitCode = $showProcess.ExitCode
    if ($showExitCode -eq 3) { throw 'show-stop-shortcut-unavailable' }
    if ($showExitCode -ne 0) { throw "show-wrapper-failed-$showExitCode" }

    if (-not (Stop-DeploymentProcessExact -Identity $jianshanIdentity -TimeoutMs 5000 -CloseFirst)) {
        throw 'jianshan-cleanup-failed'
    }

    $summaryPath = Join-Path $soundRoot 'summary.json'
    try {
        [void](Wait-DeploymentFile -Path $summaryPath -TimeoutMs 10000 -MaximumBytes 65536 -Reason 'sound-summary')
    }
    catch {
        Request-SoundStop
        [void](Wait-DeploymentFile -Path $summaryPath -TimeoutMs 10000 -MaximumBytes 65536 -Reason 'sound-summary')
    }
    $summary = Read-DeploymentJson -Path $summaryPath -MaximumBytes 65536 -Reason 'sound-summary'
    if ($summary.clean -isnot [bool] -or -not $summary.clean -or $summary.runRoot -cne $soundRoot) {
        throw 'sound-summary-not-clean'
    }
    if (-not (Wait-DeploymentProcessExit -Identity $soundIdentity -TimeoutMs 5000)) {
        throw 'sound-wrapper-cleanup-failed'
    }

    Remove-ActiveDeploymentPointer -Path $pointerPath
    $pointerWritten = $false
    [ordered]@{
        schema = 1
        status = 'exhibition-complete'
        runRoot = $runRoot
        showExitCode = $showExitCode
        soundClean = $true
    } | ConvertTo-Json -Compress
}
catch {
    $failure = $_.Exception.Message
    $cleanupFailed = $false
    foreach ($identity in @($controllerIdentity, $showIdentity, $jianshanIdentity)) {
        if ($null -ne $identity) {
            try {
                if (-not (Stop-DeploymentProcessExact -Identity $identity -TimeoutMs 3000 -CloseFirst)) {
                    $cleanupFailed = $true
                }
            }
            catch { $cleanupFailed = $true }
        }
    }
    try { Request-SoundStop } catch { $cleanupFailed = $true }
    if ($null -ne $soundIdentity) {
        try {
            if (-not (Stop-DeploymentProcessExact -Identity $soundIdentity -TimeoutMs 3000)) {
                $cleanupFailed = $true
            }
        }
        catch { $cleanupFailed = $true }
    }
    if ($pointerWritten -and -not $cleanupFailed) {
        try { Remove-ActiveDeploymentPointer -Path $pointerPath } catch { $cleanupFailed = $true }
    }
    if ($cleanupFailed) { throw "${failure}:deployment-cleanup-incomplete" }
    throw $failure
}
finally {
    foreach ($process in @($showProcess, $jianshanProcess, $soundProcess)) {
        if ($null -ne $process) { $process.Dispose() }
    }
}
