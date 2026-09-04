$ErrorActionPreference = "Stop"

$module = Join-Path (Split-Path $PSScriptRoot -Parent) "sclang-launch.psm1"
$tempBase = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$testRoot = Join-Path $tempBase ("janvim-sclang-launch-" + [System.Guid]::NewGuid().ToString("N"))

function Get-TestUdpPort {
    $socket = [System.Net.Sockets.Socket]::new(
        [System.Net.Sockets.AddressFamily]::InterNetwork,
        [System.Net.Sockets.SocketType]::Dgram,
        [System.Net.Sockets.ProtocolType]::Udp
    )
    try {
        $socket.ExclusiveAddressUse = $true
        $socket.Bind([System.Net.IPEndPoint]::new([System.Net.IPAddress]::Loopback, 0))
        return ([System.Net.IPEndPoint]$socket.LocalEndPoint).Port
    } finally {
        $socket.Dispose()
    }
}

try {
    [System.IO.Directory]::CreateDirectory($testRoot) | Out-Null
    $floodScript = Join-Path $testRoot "flood.scd"
    $hangScript = Join-Path $testRoot "hang.scd"
    [System.IO.File]::WriteAllText($floodScript, '"x".dup(20000).join.postln; 0.exit;')
    [System.IO.File]::WriteAllText($hangScript, 'loop { 1 + 1 };')

    Import-Module $module -Force

    $result = Invoke-JanVimIsolatedSclang `
        -ScriptPath $floodScript `
        -UdpPort (Get-TestUdpPort) `
        -TimeoutMilliseconds 10000 `
        -KillTimeoutMilliseconds 1000 `
        -MaxCaptureCharacters 1024 `
        -WorkingDirectory $testRoot

    if ($result.ExitCode -ne 0 -or $result.TimedOut) {
        throw "Bounded-output probe did not exit normally"
    }
    if (-not $result.StdOutTruncated) {
        throw "Oversized stdout was not reported as truncated"
    }
    if ($result.StdOut.Length -gt 1024 -or $result.StdErr.Length -gt 1024) {
        throw "Captured output exceeded the configured bound"
    }

    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $result = Invoke-JanVimIsolatedSclang `
        -ScriptPath $hangScript `
        -UdpPort (Get-TestUdpPort) `
        -TimeoutMilliseconds 2000 `
        -KillTimeoutMilliseconds 1000 `
        -MaxCaptureCharacters 1024 `
        -WorkingDirectory $testRoot
    $stopwatch.Stop()

    if (-not $result.TimedOut) {
        throw "Hanging sclang probe did not report timeout"
    }
    if ($result.KillDeadlineExceeded -or $result.CaptureIncomplete) {
        throw "Hanging sclang probe did not complete bounded cleanup"
    }
    if ($stopwatch.ElapsedMilliseconds -gt 5000) {
        throw "Timeout cleanup exceeded its finite deadline"
    }

    $occupiedPort = Get-TestUdpPort
    $occupiedSocket = [System.Net.Sockets.Socket]::new(
        [System.Net.Sockets.AddressFamily]::InterNetwork,
        [System.Net.Sockets.SocketType]::Dgram,
        [System.Net.Sockets.ProtocolType]::Udp
    )
    try {
        $occupiedSocket.ExclusiveAddressUse = $true
        $occupiedSocket.Bind(
            [System.Net.IPEndPoint]::new([System.Net.IPAddress]::Any, $occupiedPort)
        )
        $failedClosed = $false
        try {
            Invoke-JanVimIsolatedSclang `
                -ScriptPath $floodScript `
                -UdpPort $occupiedPort `
                -TimeoutMilliseconds 10000 `
                -KillTimeoutMilliseconds 1000 `
                -MaxCaptureCharacters 1024 `
                -WorkingDirectory $testRoot | Out-Null
        } catch {
            $failedClosed = $_.Exception.Message.Contains("UDP port $occupiedPort is unavailable")
        }
        if (-not $failedClosed) {
            throw "Occupied UDP port did not fail closed before launch"
        }
    } finally {
        $occupiedSocket.Dispose()
    }

    Write-Output "PASS: bounded isolated sclang launcher"
} finally {
    Remove-Module sclang-launch -ErrorAction SilentlyContinue
    $resolvedRoot = [System.IO.Path]::GetFullPath($testRoot)
    if (
        $resolvedRoot.StartsWith($tempBase, [System.StringComparison]::OrdinalIgnoreCase) -and
        [System.IO.Directory]::Exists($resolvedRoot)
    ) {
        [System.IO.Directory]::Delete($resolvedRoot, $true)
    }
}
