$ErrorActionPreference = "Stop"

$sclang = "C:\Program Files\SuperCollider-3.14.1\sclang.exe"
$testFile = Join-Path $PSScriptRoot "policy.scd"
$process = $null

if (-not (Test-Path -LiteralPath $sclang -PathType Leaf)) {
    throw "sclang not found at $sclang"
}

$startInfo = [System.Diagnostics.ProcessStartInfo]::new()
$startInfo.FileName = $sclang
$startInfo.UseShellExecute = $false
$startInfo.RedirectStandardOutput = $true
$startInfo.RedirectStandardError = $true
$startInfo.ArgumentList.Add("-u")
$startInfo.ArgumentList.Add("57140")
$startInfo.ArgumentList.Add($testFile)

try {
    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    if (-not $process.Start()) {
        throw "Failed to start sclang"
    }

    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()

    if (-not $process.WaitForExit(30000)) {
        $process.Kill($true)
        $process.WaitForExit()
        throw "sclang policy test exceeded 30 seconds"
    }

    $stdout = $stdoutTask.GetAwaiter().GetResult()
    $stderr = $stderrTask.GetAwaiter().GetResult()
    if ($stdout) { Write-Output $stdout.TrimEnd() }
    if ($stderr) { Write-Error $stderr.TrimEnd() }

    if ($process.ExitCode -ne 0) {
        exit $process.ExitCode
    }
} finally {
    if ($null -ne $process) {
        $process.Dispose()
    }
}
