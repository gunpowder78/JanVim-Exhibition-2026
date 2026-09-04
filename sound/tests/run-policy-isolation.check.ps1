$ErrorActionPreference = "Stop"

$soundRoot = Split-Path $PSScriptRoot -Parent
$module = Join-Path $soundRoot "sclang-launch.psm1"
$config = Join-Path $soundRoot "sclang-conf.yaml"
$isolationClasses = Join-Path $soundRoot "sclang-isolation"
$sclang = "C:\Program Files\SuperCollider-3.14.1\sclang.exe"
$classLibrary = Join-Path (Split-Path $sclang -Parent) "SCClassLibrary"
$tempBase = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$testRoot = Join-Path $tempBase ("janvim-sc-isolation-" + [System.Guid]::NewGuid().ToString("N"))
$extensionClasses = Join-Path $testRoot "marker-extension"
$startupMarker = Join-Path $testRoot "startup-hook-ran.txt"
$extensionMarker = Join-Path $testRoot "extension-hook-ran.txt"
$probe = Join-Path $testRoot "probe.scd"
$previousStartupMarker = [System.Environment]::GetEnvironmentVariable("JANVIM_SC_STARTUP_MARKER")
$previousExtensionMarker = [System.Environment]::GetEnvironmentVariable("JANVIM_SC_EXTENSION_MARKER")

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
    [System.IO.Directory]::CreateDirectory($extensionClasses) | Out-Null
    [System.IO.File]::WriteAllText(
        (Join-Path $testRoot "startup.sc"),
        @'
StartUp.add({
    var marker = "JANVIM_SC_STARTUP_MARKER".getenv;
    File.use(marker, "w", { |file| file.write("startup-hook-ran") });
});
'@
    )
    [System.IO.File]::WriteAllText(
        (Join-Path $extensionClasses "JanVimIsolationMarker.sc"),
        @'
JanVimIsolationMarker {
    *initClass {
        StartUp.add({
            var marker = "JANVIM_SC_EXTENSION_MARKER".getenv;
            File.use(marker, "w", { |file| file.write("extension-hook-ran") });
        });
    }
}
'@
    )
    [System.IO.File]::WriteAllText($probe, '"ISOLATION_PROBE".postln; 0.exit;')
    [System.Environment]::SetEnvironmentVariable("JANVIM_SC_STARTUP_MARKER", $startupMarker)
    [System.Environment]::SetEnvironmentVariable("JANVIM_SC_EXTENSION_MARKER", $extensionMarker)

    Import-Module $module -Force

    # Bounded control: explicitly admitting the harmless extension must execute its hook.
    $controlArguments = [string[]]@(
        "-a",
        "-l", [System.IO.Path]::GetFullPath($config),
        "--include-path", [System.IO.Path]::GetFullPath($classLibrary),
        "--include-path", [System.IO.Path]::GetFullPath($isolationClasses),
        "--include-path", [System.IO.Path]::GetFullPath($extensionClasses),
        "-u", (Get-TestUdpPort).ToString([System.Globalization.CultureInfo]::InvariantCulture),
        [System.IO.Path]::GetFullPath($probe)
    )
    $control = [JanVim.Sound.BoundedProcessRunner]::Run(
        $sclang,
        $controlArguments,
        $testRoot,
        10000,
        1000,
        8192
    )
    if ($control.ExitCode -ne 0 -or $control.TimedOut -or $control.CaptureIncomplete) {
        throw "Harmless extension-hook control launch failed"
    }
    if (-not [System.IO.File]::Exists($extensionMarker)) {
        throw "Harmless extension-hook fixture did not execute in the control launch"
    }
    if ([System.IO.File]::Exists($startupMarker)) {
        throw "Project startupFiles override failed during the control launch"
    }
    [System.IO.File]::Delete($extensionMarker)

    # Production helper: hostile cwd startup and unlisted extension must both remain inert.
    $clean = Invoke-JanVimIsolatedSclang `
        -ScriptPath $probe `
        -UdpPort (Get-TestUdpPort) `
        -TimeoutMilliseconds 10000 `
        -KillTimeoutMilliseconds 1000 `
        -MaxCaptureCharacters 8192 `
        -WorkingDirectory $testRoot
    if ($clean.ExitCode -ne 0 -or $clean.TimedOut -or $clean.CaptureIncomplete) {
        throw "Clean isolation probe launch failed"
    }
    if ([System.IO.File]::Exists($startupMarker)) {
        throw "Untrusted cwd startup hook executed during clean launch"
    }
    if ([System.IO.File]::Exists($extensionMarker)) {
        throw "Unlisted extension StartUp hook executed during clean launch"
    }

    Write-Output "PASS: clean sclang profile excludes startup and extension hooks"
} finally {
    Remove-Module sclang-launch -ErrorAction SilentlyContinue
    [System.Environment]::SetEnvironmentVariable("JANVIM_SC_STARTUP_MARKER", $previousStartupMarker)
    [System.Environment]::SetEnvironmentVariable("JANVIM_SC_EXTENSION_MARKER", $previousExtensionMarker)
    $resolvedRoot = [System.IO.Path]::GetFullPath($testRoot)
    if (
        $resolvedRoot.StartsWith($tempBase, [System.StringComparison]::OrdinalIgnoreCase) -and
        [System.IO.Directory]::Exists($resolvedRoot)
    ) {
        [System.IO.Directory]::Delete($resolvedRoot, $true)
    }
}
