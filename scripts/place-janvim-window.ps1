[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateRange(1, 2147483647)]
    [int]$ChildProcessId,

    [Parameter(Mandatory = $true)]
    [int]$X,

    [Parameter(Mandatory = $true)]
    [int]$Y,

    [Parameter(Mandatory = $true)]
    [ValidateRange(1, 32768)]
    [int]$Width,

    [Parameter(Mandatory = $true)]
    [ValidateRange(1, 32768)]
    [int]$Height,

    [ValidateRange(1, 10000)]
    [int]$TimeoutMs = 10000,

    [switch]$Maximize
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# PowerShell cannot unload Add-Type definitions from a live runspace. Bump this
# suffix whenever the native interop contract changes so an operator can reload
# an updated helper without restarting the rehearsal shell.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class JanVimExhibitionWindowV4
{
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MONITORINFO { public int Size; public RECT Monitor; public RECT Work; public uint Flags; }

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool IsZoomed(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern IntPtr MonitorFromWindow(IntPtr hWnd, uint flags);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern IntPtr GetWindow(IntPtr hWnd, uint command);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool SetWindowPos(
        IntPtr hWnd,
        IntPtr insertAfter,
        int x,
        int y,
        int width,
        int height,
        uint flags
    );

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool ShowWindowAsync(IntPtr hWnd, int command);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT rectangle);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool GetClientRect(IntPtr hWnd, out RECT rectangle);
}
'@

$ownerCommand = [uint32]4
$showCommand = 5
$noZOrder = [uint32]0x0004
$noActivate = [uint32]0x0010
$clock = [System.Diagnostics.Stopwatch]::StartNew()
$window = [IntPtr]::Zero
$matchCount = 0

while ($clock.ElapsedMilliseconds -lt $TimeoutMs) {
    $matches = [System.Collections.Generic.List[IntPtr]]::new()
    $callback = [JanVimExhibitionWindowV4+EnumWindowsProc]{
        param([IntPtr]$handle, [IntPtr]$state)

        $windowPid = [uint32]0
        [void][JanVimExhibitionWindowV4]::GetWindowThreadProcessId($handle, [ref]$windowPid)
        $isVisible = [JanVimExhibitionWindowV4]::IsWindowVisible($handle)
        $owner = [JanVimExhibitionWindowV4]::GetWindow($handle, $ownerCommand)
        if ($windowPid -eq [uint32]$ChildProcessId -and $isVisible -and $owner -eq [IntPtr]::Zero) {
            $client = [JanVimExhibitionWindowV4+RECT]::new()
            $hasClient = [JanVimExhibitionWindowV4]::GetClientRect($handle, [ref]$client)
            $clientWidth = $client.Right - $client.Left
            $clientHeight = $client.Bottom - $client.Top
            if ($hasClient -and $clientWidth -gt 0 -and $clientHeight -gt 0) {
                $matches.Add($handle)
            }
        }
        return $true
    }

    if (-not [JanVimExhibitionWindowV4]::EnumWindows($callback, [IntPtr]::Zero)) {
        throw 'EnumWindows failed.'
    }

    $matchCount = $matches.Count
    if ($matchCount -gt 1) {
        throw "Multiple eligible windows found for child PID $ChildProcessId."
    }
    if ($matchCount -eq 1) {
        $window = $matches[0]
        break
    }
    [System.Threading.Thread]::Sleep(50)
}

if ($window -eq [IntPtr]::Zero) {
    throw "No eligible window found for child PID $ChildProcessId within $TimeoutMs ms."
}

$flags = $noZOrder -bor $noActivate
if (-not [JanVimExhibitionWindowV4]::SetWindowPos(
    $window,
    [IntPtr]::Zero,
    $X,
    $Y,
    $Width,
    $Height,
    $flags
)) {
    throw "SetWindowPos failed with Win32 error $([Runtime.InteropServices.Marshal]::GetLastWin32Error())."
}
[void][JanVimExhibitionWindowV4]::ShowWindowAsync($window, $showCommand)

if ($Maximize) {
    [void][JanVimExhibitionWindowV4]::ShowWindowAsync($window, 3)
    while (-not [JanVimExhibitionWindowV4]::IsZoomed($window) -and $clock.ElapsedMilliseconds -lt $TimeoutMs) {
        [Threading.Thread]::Sleep(50)
    }
    if (-not [JanVimExhibitionWindowV4]::IsZoomed($window)) { throw 'janvim-maximize-timeout' }
}

$actual = [JanVimExhibitionWindowV4+RECT]::new()
if (-not [JanVimExhibitionWindowV4]::GetWindowRect($window, [ref]$actual)) {
    throw "GetWindowRect failed with Win32 error $([Runtime.InteropServices.Marshal]::GetLastWin32Error())."
}

$receipt = [ordered]@{
    schema = 1
    pid = $ChildProcessId
    matchedWindowCount = $matchCount
    hwnd = ('0x{0:X16}' -f $window.ToInt64())
    visible = [JanVimExhibitionWindowV4]::IsWindowVisible($window)
    owned = [JanVimExhibitionWindowV4]::GetWindow($window, $ownerCommand) -ne [IntPtr]::Zero
    requested = [ordered]@{
        x = $X
        y = $Y
        width = $Width
        height = $Height
    }
    actual = [ordered]@{
        x = $actual.Left
        y = $actual.Top
        width = $actual.Right - $actual.Left
        height = $actual.Bottom - $actual.Top
    }
}

if ($Maximize) {
    $monitor = [JanVimExhibitionWindowV4]::MonitorFromWindow($window, [uint32]0)
    $info = [JanVimExhibitionWindowV4+MONITORINFO]::new()
    $info.Size = [Runtime.InteropServices.Marshal]::SizeOf($info)
    if ($monitor -eq [IntPtr]::Zero -or -not [JanVimExhibitionWindowV4]::GetMonitorInfo($monitor, [ref]$info)) { throw 'janvim-monitor-unavailable' }
    $receipt.maximized = [JanVimExhibitionWindowV4]::IsZoomed($window)
    $receipt.monitorBounds = [ordered]@{ x=$info.Monitor.Left; y=$info.Monitor.Top; width=$info.Monitor.Right-$info.Monitor.Left; height=$info.Monitor.Bottom-$info.Monitor.Top }
    $receipt.workingArea = [ordered]@{ x=$info.Work.Left; y=$info.Work.Top; width=$info.Work.Right-$info.Work.Left; height=$info.Work.Bottom-$info.Work.Top }
    if ($info.Monitor.Left -ne $X -or $info.Monitor.Top -ne $Y -or $info.Monitor.Right-$info.Monitor.Left -ne $Width -or $info.Monitor.Bottom-$info.Monitor.Top -ne $Height) { throw 'janvim-maximized-on-wrong-monitor' }
    # Maximizing a background window alone can leave its taskbar attention state
    # active. Hand foreground to this verified show HWND once, after placement.
    # Windows may refuse while an operator uses another app; record that outcome
    # without stealing focus repeatedly or interrupting the exhibition.
    $receipt.foregroundActivationAccepted = [JanVimExhibitionWindowV4]::SetForegroundWindow($window)
}
$receipt | ConvertTo-Json -Depth 4 -Compress
