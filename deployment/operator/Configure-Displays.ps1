[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$packageRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$rootItem = Get-Item -LiteralPath $packageRoot -Force
if (-not $rootItem.PSIsContainer -or ($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'deployment-package-root-invalid'
}
Import-Module (Join-Path $PSScriptRoot 'lib\Exhibition.Deployment.psm1') -Force
$defaults = Read-ExhibitionSiteDefaults -Path (Join-Path $packageRoot 'config\site-defaults.json')
if (-not [string]::Equals($packageRoot, $defaults.packageRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'deployment-package-root-invalid'
}

$pointerPath = Join-Path $defaults.siteConfigRoot 'active-deployment.json'
if (Test-Path -LiteralPath $pointerPath) { throw 'active-deployment-already-exists' }
if (-not (Test-Path -LiteralPath $defaults.rehearsalParent -PathType Container)) {
    throw 'rehearsal-parent-missing'
}
$parentItem = Get-Item -LiteralPath $defaults.rehearsalParent -Force
if (($parentItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'rehearsal-parent-invalid'
}

$id = 'display-config-{0}-{1}' -f `
    [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ'), `
    [Guid]::NewGuid().ToString('N').Substring(0, 12)
$captureRoot = Join-Path $defaults.rehearsalParent $id
$captureMap = Join-Path $captureRoot 'display-map.json'
$configure = Join-Path $packageRoot 'app\scripts\configure-displays.ps1'
$powerShell = @(Get-Command pwsh.exe -CommandType Application -ErrorAction Stop)[0].Source

& $powerShell -NoLogo -NoProfile -File $configure `
    -RehearsalRoot $captureRoot `
    -DisplayMapPath $captureMap
if ($LASTEXITCODE -ne 0) { throw 'display-configuration-failed' }
$confirmed = Read-ProductionDisplayMap -Path $captureMap

if (-not (Test-Path -LiteralPath $defaults.siteConfigRoot)) {
    [void](New-Item -ItemType Directory -Path $defaults.siteConfigRoot)
}
$siteItem = Get-Item -LiteralPath $defaults.siteConfigRoot -Force
if (-not $siteItem.PSIsContainer -or ($siteItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'site-config-root-invalid'
}
$destination = Join-Path $defaults.siteConfigRoot 'display-map.json'
$temporary = Join-Path $defaults.siteConfigRoot ('.display-map-{0}.tmp' -f [Guid]::NewGuid().ToString('N'))
try {
    $bytes = [IO.File]::ReadAllBytes($confirmed.mapPath)
    if ($bytes.Length -gt 65536) { throw 'display-map-invalid' }
    $stream = [IO.File]::Open($temporary, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
    try {
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Flush($true)
    }
    finally {
        $stream.Dispose()
    }
    [IO.File]::Move($temporary, $destination, $true)
}
finally {
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
}
[ordered]@{
    schema = 1
    status = 'display-map-saved'
    displayMapPath = $destination
    screen3 = $confirmed.screen3
} | ConvertTo-Json -Depth 4 -Compress
