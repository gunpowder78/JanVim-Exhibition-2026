[CmdletBinding()]
param(
    [string] $HandoffReceiptPath,
    [string] $ProgressPath,
    [switch] $DeferDisplayMapping
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$expectedPackageRoot = 'D:\github\JanVim-Exhibition-Deploy'
$packageRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not [string]::Equals($packageRoot, $expectedPackageRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'deployment-package-root-invalid'
}
$rootItem = Get-Item -LiteralPath $packageRoot -Force
if (-not $rootItem.PSIsContainer -or ($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'deployment-package-root-invalid'
}

Import-Module (Join-Path $PSScriptRoot 'lib\Exhibition.Deployment.psm1') -Force
$defaults = Read-ExhibitionSiteDefaults -Path (Join-Path $packageRoot 'config\site-defaults.json')
$node = Join-Path $packageRoot 'tools\node\node.exe'
$manifestTool = Join-Path $PSScriptRoot 'lib\package-manifest.mjs'
$results = [Collections.Generic.List[object]]::new()
$script:verificationClock = [Diagnostics.Stopwatch]::StartNew()
$script:progressEntries = 0
if (-not [string]::IsNullOrWhiteSpace($ProgressPath)) {
    if (-not [IO.Path]::IsPathFullyQualified($ProgressPath)) { throw 'verification-progress-path-invalid' }
    # CreateNew preserves evidence from every previous attempt.
    $progressFile = [IO.File]::Open($ProgressPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
    $progressFile.Dispose()
}

function Write-VerificationProgress {
    param(
        [ValidateLength(1, 80)][string] $Stage,
        [ValidateSet('started', 'passed', 'failed')][string] $Status
    )
    if ([string]::IsNullOrWhiteSpace($ProgressPath)) { return }
    if ($script:progressEntries -ge 32) { throw 'verification-progress-limit' }
    $entry = [ordered]@{
        atUtc = [DateTime]::UtcNow.ToString('o')
        elapsedMs = $script:verificationClock.ElapsedMilliseconds
        stage = $Stage
        status = $Status
    } | ConvertTo-Json -Compress
    [IO.File]::AppendAllText($ProgressPath, $entry + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
    $script:progressEntries++
}

function Add-Check {
    param([string] $Name, [bool] $Passed, [string] $Detail)
    $results.Add([pscustomobject]@{ 检查 = $Name; 结果 = if ($Passed) { '通过' } else { '失败' }; 说明 = $Detail })
    Write-VerificationProgress -Stage $Name -Status $(if ($Passed) { 'passed' } else { 'failed' })
    if (-not $Passed) { throw "deployment-prerequisite-failed:$Name" }
}

function Assert-FileIdentity {
    param(
        [Parameter(Mandatory = $true)][string] $Path,
        [Parameter(Mandatory = $true)][int64] $Bytes,
        [Parameter(Mandatory = $true)][string] $Sha256,
        [Parameter(Mandatory = $true)][string] $Label
    )
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "$Label-missing" }
    $item = Get-Item -LiteralPath $Path -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $item.Length -ne $Bytes) {
        throw "$Label-identity-mismatch"
    }
    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
    if ($hash -cne $Sha256) { throw "$Label-identity-mismatch" }
}

function Invoke-Captured {
    param(
        [Parameter(Mandatory = $true)][string] $FilePath,
        [Parameter(Mandatory = $true)][string[]] $Arguments,
        [ValidateRange(1, 120000)][int] $TimeoutMs = 20000
    )
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $FilePath
    $info.WorkingDirectory = $packageRoot
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    foreach ($argument in $Arguments) { [void]$info.ArgumentList.Add($argument) }
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $info
    try {
        if (-not $process.Start()) { throw 'deployment-probe-start-failed' }
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit($TimeoutMs)) {
            try { $process.Kill($true) } catch {}
            [void]$process.WaitForExit(2000)
            throw 'deployment-probe-timeout'
        }
        $out = $stdout.GetAwaiter().GetResult()
        $err = $stderr.GetAwaiter().GetResult()
        if ([Text.Encoding]::UTF8.GetByteCount($out) -gt 65536 -or [Text.Encoding]::UTF8.GetByteCount($err) -gt 65536) {
            throw 'deployment-probe-output-too-large'
        }
        return [pscustomobject]@{ ExitCode = $process.ExitCode; Stdout = $out; Stderr = $err }
    }
    finally {
        $process.Dispose()
    }
}

Write-VerificationProgress -Stage 'node-identity' -Status 'started'
Assert-FileIdentity `
    -Path $node -Bytes 86988616 `
    -Sha256 '17347995af08dadcc73a1a154f0942559fbc3f37b9ba57d4576b4d2bcb2834a2' `
    -Label 'node'
$nodeVersion = Invoke-Captured -FilePath $node -Arguments @('--version') -TimeoutMs 2000
Add-Check -Name '包内 Node.js' -Passed (
    $nodeVersion.ExitCode -eq 0 -and $nodeVersion.Stdout.Trim() -ceq 'v22.23.0'
) -Detail 'v22.23.0，身份匹配'

Write-VerificationProgress -Stage 'package-manifest' -Status 'started'
$manifestResult = Invoke-Captured `
    -FilePath $node `
    -Arguments @($manifestTool, 'verify-installed', '--root', $packageRoot) `
    -TimeoutMs 120000
if ($manifestResult.ExitCode -ne 0) { throw 'deployment-package-manifest-invalid' }
$manifestReceipt = $manifestResult.Stdout | ConvertFrom-Json -NoEnumerate -DateKind String
Add-Check -Name '部署包清单' -Passed ($manifestReceipt.status -ceq 'package-installed-payload-verified') `
    -Detail "$($manifestReceipt.immutableFiles) 个固定文件，清单 SHA-256 $($manifestReceipt.manifestSha256)"
Add-Check -Name '运行缓存与状态' -Passed $true `
    -Detail "$($manifestReceipt.runtimeStateFiles) 个额外运行文件，$($manifestReceipt.runtimeStateBytes) 字节；路径、类型与限额通过"

Write-VerificationProgress -Stage 'electron-runtime' -Status 'started'
$electronRuntime = Assert-DeploymentElectronRuntime -AppRoot (Join-Path $packageRoot 'app')
Add-Check -Name 'Electron 运行时' -Passed $true `
    -Detail "$($electronRuntime.version)，$($electronRuntime.files) 个官方运行时文件、版本与入口完整"

if (-not [string]::IsNullOrWhiteSpace($HandoffReceiptPath)) {
    if (-not [IO.Path]::IsPathFullyQualified($HandoffReceiptPath)) { throw 'handoff-receipt-invalid' }
    $receiptItem = Get-Item -LiteralPath $HandoffReceiptPath -Force
    if ($receiptItem.PSIsContainer -or $receiptItem.Length -gt 65536 -or ($receiptItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'handoff-receipt-invalid'
    }
    $handoff = Get-Content -LiteralPath $receiptItem.FullName -Raw |
        ConvertFrom-Json -NoEnumerate -DateKind String
    if (
        $handoff.schema -ne 1 -or
        $handoff.acceptance -cne 'awaiting-mini-pc-attended-acceptance' -or
        $handoff.manifest.bytes -ne $manifestReceipt.manifestBytes -or
        $handoff.manifest.sha256 -cne $manifestReceipt.manifestSha256
    ) { throw 'handoff-receipt-invalid' }
    Add-Check -Name '外部交接回执' -Passed $true -Detail '清单身份匹配'
}

Write-VerificationProgress -Stage 'janvim-runtime' -Status 'started'
$runtimeVerification = Invoke-Captured `
    -FilePath (Get-Command pwsh.exe -CommandType Application -ErrorAction Stop)[0].Source `
    -Arguments @('-NoLogo', '-NoProfile', '-NonInteractive', '-File', (Join-Path $packageRoot 'app\scripts\verify-runtime.ps1')) `
    -TimeoutMs 30000
Add-Check -Name 'JanVim 固定产物' -Passed ($runtimeVerification.ExitCode -eq 0) -Detail '锁文件与运行时通过原验证器'

$electron = Join-Path $packageRoot 'app\apps\controller\dist\main\electron-main.js'
Assert-FileIdentity `
    -Path $electron -Bytes 553166 `
    -Sha256 'e0bc73cf3860b209c598bca26dfcf0505caf3fc1c0b1e4e240c8ae15491e20af' `
    -Label 'electron-main'
Add-Check -Name '控制器 Electron bundle' -Passed $true -Detail '字节数与 SHA-256 匹配'

$jianshanFiles = @(
    @('runtime\jianshan\jianshan.exe', 9799168, 'ac160b7eb4e34c52906b151aed441ea683ad093d89e59459b5ecb12c3055770f'),
    @('runtime\jianshan\jianshan-flock-v1.toml', 6238, '510398aeff0f567bf351aa2ce025cbb6989a6865328115f726032549821a3fae'),
    @('runtime\jianshan\jianshan.toml', 5894, '9b83e9d471cfbde76224b8c565ccd9fd4427c143c65201d36312f966bb9e56cf'),
    @('runtime\jianshan\assets\gpu_rankings.toml', 4099, '503ab9637470722f3ce2766c6820667f99c27ee952a119239d6da537410d9932'),
    @('runtime\jianshan\CONCRT140.dll', 324208, '2405355f0a58067b258f8df33c327e3a3d716eaac5a3a5aebb757842d85bd376'),
    @('runtime\jianshan\MSVCP140.dll', 557728, '0f885b509a685d2bbfa652fed26b5fb31d88fbdab0a978c641d1c7b8aa460aa9'),
    @('runtime\jianshan\VCRUNTIME140.dll', 124544, 'd5e4d9a3e835fa679450145d6a7d94e36573a509317111904d9b3712c30d9066'),
    @('runtime\jianshan\VCRUNTIME140_1.dll', 49792, '1f2d41c4aa5db0bc33ebf7b66d72943a817d7ce6cbe880502a9403823633093f'),
    @('runtime\jianshan\native\mediapipe\hand_landmarker.dll', 8635904, '3cfb4b559a16778291b472d53e448297f149f9067793325ed14043fd5ee9227f'),
    @('runtime\jianshan\native\mediapipe\opencv_world3410.dll', 55907328, 'b925e1955af1718ed1ae10d1f3f1db57e5ab8c4865729e4748d0ba721edca687'),
    @('runtime\public\models\hand_landmarker.task', 7819105, 'fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1')
)
foreach ($identity in $jianshanFiles) {
    Assert-FileIdentity `
        -Path (Join-Path $packageRoot $identity[0]) `
        -Bytes ([int64]$identity[1]) `
        -Sha256 $identity[2] `
        -Label 'jianshan-runtime'
}
Add-Check -Name '《见山》候选运行时' -Passed $true -Detail 'EXE、配置、DLL 与模型身份匹配'

Add-Check -Name 'PowerShell' -Passed (
    $PSVersionTable.PSVersion.ToString() -ceq '7.6.5' -and [Environment]::Is64BitProcess
) -Detail '要求 7.6.5 x64'

$sclang = 'C:\Program Files\SuperCollider-3.14.1\sclang.exe'
if (-not (Test-Path -LiteralPath $sclang -PathType Leaf)) { throw 'supercollider-missing' }
$scVersion = Invoke-Captured -FilePath $sclang -Arguments @('-v') -TimeoutMs 5000
Add-Check -Name 'SuperCollider' -Passed (
    $scVersion.ExitCode -eq 0 -and $scVersion.Stdout -match '^sclang 3\.14\.1\b'
) -Detail '3.14.1，固定安装路径'

$probePath = Join-Path ([IO.Path]::GetTempPath()) ('janvim-sc-device-{0}.scd' -f [Guid]::NewGuid().ToString('N'))
$udp = [Net.Sockets.UdpClient]::new(0)
try { $languagePort = ([Net.IPEndPoint]$udp.Client.LocalEndPoint).Port } finally { $udp.Dispose() }
$targetDevice = $defaults.audioOutputDevice.Replace('"', '\"')
$probeSource = @"
(
var target = "$targetDevice";
var devices = ServerOptions.outDevices;
if(devices.includesEqual(target), {
    "SC_AUDIO_ENDPOINT_PASS".postln;
    0.exit;
}, {
    "SC_AUDIO_ENDPOINT_MISSING".postln;
    1.exit;
});
)
"@
Write-VerificationProgress -Stage 'audio-endpoint' -Status 'started'
try {
    [IO.File]::WriteAllText($probePath, $probeSource, [Text.UTF8Encoding]::new($false))
    $deviceProbe = Invoke-Captured `
        -FilePath $sclang `
        -Arguments @('-D', '-u', ([string]$languagePort), $probePath) `
        -TimeoutMs 20000
    Add-Check -Name '耳机输出端点' -Passed (
        $deviceProbe.ExitCode -eq 0 -and $deviceProbe.Stdout -match 'SC_AUDIO_ENDPOINT_PASS'
    ) -Detail $defaults.audioOutputDevice
}
finally {
    if (Test-Path -LiteralPath $probePath) { Remove-Item -LiteralPath $probePath -Force }
}

Write-VerificationProgress -Stage 'camera-pnp' -Status 'started'
$cameraDetail = '未检测到可用相机；继续自动展示（相机交互可选）'
try {
    Import-Module PnpDevice -ErrorAction Stop
    $camera = @(
        Get-PnpDevice -PresentOnly -ErrorAction Stop |
            Where-Object { $_.Class -in @('Camera', 'Image') -and $_.Status -eq 'OK' } |
            Select-Object -First 1
    )
    if ($camera.Count -eq 1) {
        $cameraDetail = '检测到可用 Camera/Image PnP 设备（未打开相机；交互可选）'
    }
}
catch {
    $cameraDetail = '相机枚举不可用；继续自动展示（相机交互可选）'
}
Add-Check -Name '相机（可选）' -Passed $true -Detail $cameraDetail

Write-VerificationProgress -Stage 'display-driver' -Status 'started'
$displayAdapter = @(
    Get-CimInstance Win32_VideoController -ErrorAction Stop |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_.DriverVersion) } |
        Select-Object -First 1
)
Add-Check -Name 'GPU 驱动' -Passed ($displayAdapter.Count -eq 1) -Detail '检测到显示驱动；DX12 Compute 由首次《见山》启动确认'

if ($DeferDisplayMapping) {
    Add-Check -Name '三屏映射' -Passed $true -Detail '由启动器在包校验后按当前扩展显示器解析；尚未进行显示验收'
}
else {
    [void](Read-ProductionDisplayMap -Path (Join-Path $defaults.siteConfigRoot 'display-map.json'))
    Add-Check -Name '三屏映射' -Passed $true -Detail 'schema 2 / confirmed / production-3'
}

$results | Format-Table -AutoSize
'DEPLOYMENT_VERIFY_PASS'
