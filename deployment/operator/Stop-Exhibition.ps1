[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$packageRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Import-Module (Join-Path $PSScriptRoot 'lib\Exhibition.Deployment.psm1') -Force
$defaults = Read-ExhibitionSiteDefaults -Path (Join-Path $packageRoot 'config\site-defaults.json')
if (-not [string]::Equals($packageRoot, $defaults.packageRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'deployment-package-root-invalid'
}

$pointerPath = Join-Path $defaults.siteConfigRoot 'active-deployment.json'
$pointer = Read-ActiveDeploymentPointer -Path $pointerPath
$joint = Join-Path $packageRoot 'app\sound\joint-rehearsal.ps1'
$node = Join-Path $packageRoot 'tools\node\node.exe'
$powerShell = @(Get-Command pwsh.exe -CommandType Application -ErrorAction Stop)[0].Source
$failures = [Collections.Generic.List[string]]::new()

try {
    & $powerShell -NoLogo -NoProfile -NonInteractive -File $joint `
        -Action StopSound -SessionFile $pointer.sessionFile -NodeExecutable $node
    if ($LASTEXITCODE -ne 0) { $failures.Add('sound-stop-request-failed') }
}
catch {
    $failures.Add('sound-stop-request-failed')
}

foreach ($entry in @(
    [pscustomobject]@{ Name = 'jianshan'; Identity = $pointer.jianshan; CloseFirst = $true },
    [pscustomobject]@{ Name = 'controller'; Identity = $pointer.controller; CloseFirst = $true },
    [pscustomobject]@{ Name = 'show-wrapper'; Identity = $pointer.showWrapper; CloseFirst = $true },
    [pscustomobject]@{ Name = 'sound-wrapper'; Identity = $pointer.soundWrapper; CloseFirst = $false }
)) {
    if ($null -eq $entry.Identity) { continue }
    try {
        $stopped = if ($entry.CloseFirst) {
            Stop-DeploymentProcessExact -Identity $entry.Identity -TimeoutMs 5000 -CloseFirst
        }
        else {
            Stop-DeploymentProcessExact -Identity $entry.Identity -TimeoutMs 5000
        }
        if (-not $stopped) { $failures.Add("$($entry.Name)-cleanup-failed") }
    }
    catch {
        $failures.Add("$($entry.Name)-cleanup-failed")
    }
}

if ($failures.Count -gt 0) {
    throw ('deployment-stop-incomplete:' + ($failures -join ','))
}
Remove-ActiveDeploymentPointer -Path $pointerPath
[ordered]@{
    schema = 1
    status = 'exhibition-stopped'
    runRoot = $pointer.runRoot
    clean = $true
} | ConvertTo-Json -Compress
