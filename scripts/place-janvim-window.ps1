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
    [int]$TimeoutMs = 10000
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class JanVimExhibitionWindow
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
    $callback = [JanVimExhibitionWindow+EnumWindowsProc]{
        param([IntPtr]$handle, [IntPtr]$state)

        $windowPid = [uint32]0
        [void][JanVimExhibitionWindow]::GetWindowThreadProcessId($handle, [ref]$windowPid)
        $isVisible = [JanVimExhibitionWindow]::IsWindowVisible($handle)
        $owner = [JanVimExhibitionWindow]::GetWindow($handle, $ownerCommand)
        if ($windowPid -eq [uint32]$ChildProcessId -and $isVisible -and $owner -eq [IntPtr]::Zero) {
            $client = [JanVimExhibitionWindow+RECT]::new()
            $hasClient = [JanVimExhibitionWindow]::GetClientRect($handle, [ref]$client)
            $clientWidth = $client.Right - $client.Left
            $clientHeight = $client.Bottom - $client.Top
            if ($hasClient -and $clientWidth -gt 0 -and $clientHeight -gt 0) {
                $matches.Add($handle)
            }
        }
        return $true
    }

    if (-not [JanVimExhibitionWindow]::EnumWindows($callback, [IntPtr]::Zero)) {
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
if (-not [JanVimExhibitionWindow]::SetWindowPos(
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
[void][JanVimExhibitionWindow]::ShowWindowAsync($window, $showCommand)

$actual = [JanVimExhibitionWindow+RECT]::new()
if (-not [JanVimExhibitionWindow]::GetWindowRect($window, [ref]$actual)) {
    throw "GetWindowRect failed with Win32 error $([Runtime.InteropServices.Marshal]::GetLastWin32Error())."
}

$receipt = [ordered]@{
    schema = 1
    pid = $ChildProcessId
    matchedWindowCount = $matchCount
    hwnd = ('0x{0:X16}' -f $window.ToInt64())
    visible = [JanVimExhibitionWindow]::IsWindowVisible($window)
    owned = [JanVimExhibitionWindow]::GetWindow($window, $ownerCommand) -ne [IntPtr]::Zero
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

$receipt | ConvertTo-Json -Depth 4 -Compress
