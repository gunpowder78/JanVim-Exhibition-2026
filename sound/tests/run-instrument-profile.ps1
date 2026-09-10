$ErrorActionPreference = 'Stop'

$testFile = Join-Path $PSScriptRoot 'instrument-profile.scd'
$soundRoot = Split-Path $PSScriptRoot -Parent
$launcher = Join-Path $soundRoot 'sclang-launch.psm1'

Import-Module $launcher -Force

$result = Invoke-JanVimIsolatedSclang `
    -ScriptPath $testFile `
    -UdpPort 57140 `
    -TimeoutMilliseconds 30000 `
    -KillTimeoutMilliseconds 2000 `
    -MaxCaptureCharacters 65536 `
    -WorkingDirectory $PSScriptRoot

if ($result.StdOut) { Write-Output $result.StdOut.TrimEnd() }
if ($result.StdErr) { [Console]::Error.WriteLine($result.StdErr.TrimEnd()) }
if ($result.TimedOut) { throw 'sclang instrument profile test exceeded 30 seconds' }
if ($result.KillDeadlineExceeded) { throw 'sclang did not exit within the 2-second kill deadline' }
if ($result.CaptureIncomplete) { throw 'sclang output capture did not finish within the cleanup deadline' }
if ($result.StdOutTruncated -or $result.StdErrTruncated) { throw 'sclang output exceeded the capture bound' }
if ($null -eq $result.ExitCode) { throw 'sclang exit code was unavailable' }
exit $result.ExitCode
