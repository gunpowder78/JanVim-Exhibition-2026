Set-StrictMode -Version Latest

if (-not ("JanVim.Sound.BoundedProcessRunner" -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading.Tasks;

namespace JanVim.Sound
{
    public sealed class BoundedProcessResult
    {
        public int? ExitCode { get; set; }
        public bool TimedOut { get; set; }
        public bool KillDeadlineExceeded { get; set; }
        public bool CaptureIncomplete { get; set; }
        public string StdOut { get; set; }
        public string StdErr { get; set; }
        public bool StdOutTruncated { get; set; }
        public bool StdErrTruncated { get; set; }
    }

    internal sealed class BoundedTextCapture
    {
        private readonly object sync = new object();
        private readonly StringBuilder text;
        private readonly int limit;
        private bool truncated;

        internal BoundedTextCapture(int limit)
        {
            this.limit = limit;
            text = new StringBuilder(Math.Min(limit, 4096));
        }

        internal void Append(char[] buffer, int count)
        {
            lock (sync)
            {
                int remaining = limit - text.Length;
                int accepted = Math.Min(Math.Max(remaining, 0), count);
                if (accepted > 0)
                {
                    text.Append(buffer, 0, accepted);
                }
                if (accepted < count)
                {
                    truncated = true;
                }
            }
        }

        internal string Text
        {
            get { lock (sync) { return text.ToString(); } }
        }

        internal bool Truncated
        {
            get { lock (sync) { return truncated; } }
        }
    }

    public static class BoundedProcessRunner
    {
        private static async Task PumpAsync(TextReader reader, BoundedTextCapture capture)
        {
            char[] buffer = new char[4096];
            while (true)
            {
                int count = await reader.ReadAsync(buffer, 0, buffer.Length).ConfigureAwait(false);
                if (count == 0)
                {
                    return;
                }
                capture.Append(buffer, count);
            }
        }

        private static int RemainingMilliseconds(Stopwatch stopwatch, int deadlineMilliseconds)
        {
            long remaining = deadlineMilliseconds - stopwatch.ElapsedMilliseconds;
            if (remaining <= 0)
            {
                return 0;
            }
            return (int)Math.Min(remaining, int.MaxValue);
        }

        public static BoundedProcessResult Run(
            string executable,
            string[] arguments,
            string workingDirectory,
            int timeoutMilliseconds,
            int killTimeoutMilliseconds,
            int maxCaptureCharacters)
        {
            using (Process process = new Process())
            {
                process.StartInfo.FileName = executable;
                process.StartInfo.WorkingDirectory = workingDirectory;
                process.StartInfo.UseShellExecute = false;
                process.StartInfo.CreateNoWindow = true;
                process.StartInfo.RedirectStandardOutput = true;
                process.StartInfo.RedirectStandardError = true;
                foreach (string argument in arguments)
                {
                    process.StartInfo.ArgumentList.Add(argument);
                }

                if (!process.Start())
                {
                    throw new InvalidOperationException("Failed to start sclang");
                }

                BoundedTextCapture stdout = new BoundedTextCapture(maxCaptureCharacters);
                BoundedTextCapture stderr = new BoundedTextCapture(maxCaptureCharacters);
                Task stdoutTask = PumpAsync(process.StandardOutput, stdout);
                Task stderrTask = PumpAsync(process.StandardError, stderr);
                bool timedOut = !process.WaitForExit(timeoutMilliseconds);
                bool killDeadlineExceeded = false;
                Stopwatch cleanup = Stopwatch.StartNew();

                if (timedOut)
                {
                    try
                    {
                        process.Kill(true);
                    }
                    catch (InvalidOperationException)
                    {
                        // The process exited between the timeout and kill request.
                    }

                    if (!process.HasExited)
                    {
                        int remaining = RemainingMilliseconds(cleanup, killTimeoutMilliseconds);
                        if (remaining == 0 || !process.WaitForExit(remaining))
                        {
                            killDeadlineExceeded = true;
                        }
                    }
                }

                Task captureTasks = Task.WhenAll(stdoutTask, stderrTask);
                int captureRemaining = RemainingMilliseconds(cleanup, killTimeoutMilliseconds);
                bool captureIncomplete = captureRemaining == 0 || !captureTasks.Wait(captureRemaining);
                int? exitCode = process.HasExited ? process.ExitCode : (int?)null;

                return new BoundedProcessResult
                {
                    ExitCode = exitCode,
                    TimedOut = timedOut,
                    KillDeadlineExceeded = killDeadlineExceeded,
                    CaptureIncomplete = captureIncomplete,
                    StdOut = stdout.Text,
                    StdErr = stderr.Text,
                    StdOutTruncated = stdout.Truncated,
                    StdErrTruncated = stderr.Truncated
                };
            }
        }
    }
}
'@
}

function Assert-JanVimUdpPortAvailable {
    param([int]$UdpPort)

    $socket = [System.Net.Sockets.Socket]::new(
        [System.Net.Sockets.AddressFamily]::InterNetwork,
        [System.Net.Sockets.SocketType]::Dgram,
        [System.Net.Sockets.ProtocolType]::Udp
    )
    try {
        $socket.ExclusiveAddressUse = $true
        $socket.Bind([System.Net.IPEndPoint]::new([System.Net.IPAddress]::Any, $UdpPort))
    } catch [System.Net.Sockets.SocketException] {
        throw [System.InvalidOperationException]::new(
            "UDP port $UdpPort is unavailable; refusing to launch sclang",
            $_.Exception
        )
    } finally {
        $socket.Dispose()
    }
}

function Invoke-JanVimIsolatedSclang {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$ScriptPath,

        [ValidateRange(1, 65535)]
        [int]$UdpPort = 57140,

        [ValidateRange(1, 3600000)]
        [int]$TimeoutMilliseconds = 30000,

        [ValidateRange(1, 30000)]
        [int]$KillTimeoutMilliseconds = 2000,

        [ValidateRange(1, 1048576)]
        [int]$MaxCaptureCharacters = 65536,

        [string]$WorkingDirectory = [System.Environment]::CurrentDirectory
    )

    $sclang = "C:\Program Files\SuperCollider-3.14.1\sclang.exe"
    $classLibrary = Join-Path (Split-Path $sclang -Parent) "SCClassLibrary"
    $configFile = Join-Path $PSScriptRoot "sclang-conf.yaml"
    $isolationClasses = Join-Path $PSScriptRoot "sclang-isolation"

    foreach ($requiredPath in @($sclang, $classLibrary, $configFile, $isolationClasses, $ScriptPath, $WorkingDirectory)) {
        if (-not (Test-Path -LiteralPath $requiredPath)) {
            throw "Required isolated sclang path does not exist: $requiredPath"
        }
    }

    Assert-JanVimUdpPortAvailable -UdpPort $UdpPort

    $arguments = [System.Collections.Generic.List[string]]::new()
    foreach ($argument in @(
        "-a",
        "-l", [System.IO.Path]::GetFullPath($configFile),
        "--include-path", [System.IO.Path]::GetFullPath($classLibrary),
        "--include-path", [System.IO.Path]::GetFullPath($isolationClasses),
        "-u", $UdpPort.ToString([System.Globalization.CultureInfo]::InvariantCulture),
        [System.IO.Path]::GetFullPath($ScriptPath)
    )) {
        $arguments.Add($argument)
    }

    return [JanVim.Sound.BoundedProcessRunner]::Run(
        $sclang,
        $arguments.ToArray(),
        [System.IO.Path]::GetFullPath($WorkingDirectory),
        $TimeoutMilliseconds,
        $KillTimeoutMilliseconds,
        $MaxCaptureCharacters
    )
}

Export-ModuleMember -Function Invoke-JanVimIsolatedSclang
