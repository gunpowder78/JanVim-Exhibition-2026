[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateRange(1, 2147483647)]
    [int]$ChildProcessId,

    [Parameter(Mandatory = $true)]
    [ValidateLength(1, 64)]
    [string]$ExpectedStartedAtUtc,

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

try {
    $expectedStart = [DateTimeOffset]::ParseExact(
        $ExpectedStartedAtUtc,
        'o',
        [Globalization.CultureInfo]::InvariantCulture,
        [Globalization.DateTimeStyles]::RoundtripKind
    ).UtcDateTime
}
catch {
    throw 'jianshan-process-identity-invalid'
}

function Assert-JianShanProcessIdentity {
    param(
        [Parameter(Mandatory = $true)][int]$ProcessId,
        [Parameter(Mandatory = $true)][DateTime]$ExpectedStart
    )

    $candidate = $null
    try {
        $candidate = [Diagnostics.Process]::GetProcessById($ProcessId)
        $actualStart = $candidate.StartTime.ToUniversalTime()
        if ($actualStart.Ticks -ne $ExpectedStart.Ticks) {
            throw 'jianshan-process-identity-mismatch'
        }
    }
    catch {
        if ($_.Exception.Message -eq 'jianshan-process-identity-mismatch') {
            throw
        }
        throw 'jianshan-process-identity-mismatch'
    }
    finally {
        if ($null -ne $candidate) {
            $candidate.Dispose()
        }
    }
}

if ($null -eq ('JanVimExhibitionJianShanWindowV1' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class JanVimExhibitionJianShanWindowV1
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

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool GetClientRect(IntPtr hWnd, out RECT rectangle);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT rectangle);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW", SetLastError = true)]
    public static extern IntPtr GetWindowLongPtrW(IntPtr hWnd, int index);

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
    public static extern bool IsZoomed(IntPtr hWnd);
}
'@
}

$gwOwner = [uint32]4
$gwlExStyle = -20
$wsExTopmost = [int64]0x00000008
$wsExTransparent = [int64]0x00000020
$wsExNoActivate = [int64]0x08000000
$swMaximize = 3
$hwndTopmost = [IntPtr](-1)
$swpNoSize = [uint32]0x0001
$swpNoMove = [uint32]0x0002
$swpNoZOrder = [uint32]0x0004
$swpNoActivate = [uint32]0x0010
$swpShowWindow = [uint32]0x0040
$clock = [Diagnostics.Stopwatch]::StartNew()
$window = [IntPtr]::Zero
$matchCount = 0

Assert-JianShanProcessIdentity `
    -ProcessId $ChildProcessId `
    -ExpectedStart $expectedStart

while ($clock.ElapsedMilliseconds -lt $TimeoutMs) {
    $matches = [Collections.Generic.List[IntPtr]]::new()
    $callback = [JanVimExhibitionJianShanWindowV1+EnumWindowsProc]{
        param([IntPtr]$handle, [IntPtr]$state)

        $windowPid = [uint32]0
        [void][JanVimExhibitionJianShanWindowV1]::GetWindowThreadProcessId(
            $handle,
            [ref]$windowPid
        )
        if ($windowPid -ne [uint32]$ChildProcessId) {
            return $true
        }
        if (-not [JanVimExhibitionJianShanWindowV1]::IsWindowVisible($handle)) {
            return $true
        }
        if ([JanVimExhibitionJianShanWindowV1]::GetWindow($handle, $gwOwner) -ne [IntPtr]::Zero) {
            return $true
        }
        $client = [JanVimExhibitionJianShanWindowV1+RECT]::new()
        if (-not [JanVimExhibitionJianShanWindowV1]::GetClientRect($handle, [ref]$client)) {
            return $true
        }
        if (($client.Right - $client.Left) -gt 0 -and ($client.Bottom - $client.Top) -gt 0) {
            $matches.Add($handle)
        }
        return $true
    }

    if (-not [JanVimExhibitionJianShanWindowV1]::EnumWindows(
        $callback,
        [IntPtr]::Zero
    )) {
        throw 'jianshan-window-enumeration-failed'
    }

    $matchCount = $matches.Count
    if ($matchCount -gt 1) {
        throw 'jianshan-window-count-invalid'
    }
    if ($matchCount -eq 1) {
        $window = $matches[0]
        break
    }
    $remaining = $TimeoutMs - $clock.ElapsedMilliseconds
    if ($remaining -gt 0) {
        [Threading.Thread]::Sleep([Math]::Min(50, [int]$remaining))
    }
}

if ($window -eq [IntPtr]::Zero) {
    throw 'jianshan-window-not-found'
}

Assert-JianShanProcessIdentity `
    -ProcessId $ChildProcessId `
    -ExpectedStart $expectedStart

$moveFlags = $swpNoZOrder -bor $swpNoActivate -bor $swpShowWindow
if (-not [JanVimExhibitionJianShanWindowV1]::SetWindowPos(
    $window,
    [IntPtr]::Zero,
    $X,
    $Y,
    $Width,
    $Height,
    $moveFlags
)) {
    throw 'jianshan-window-placement-failed'
}

[void][JanVimExhibitionJianShanWindowV1]::ShowWindowAsync($window, $swMaximize)
$topmostFlags = $swpNoMove -bor $swpNoSize -bor $swpShowWindow
if (-not [JanVimExhibitionJianShanWindowV1]::SetWindowPos(
    $window,
    $hwndTopmost,
    0,
    0,
    0,
    0,
    $topmostFlags
)) {
    throw 'jianshan-window-topmost-failed'
}

while (
    -not [JanVimExhibitionJianShanWindowV1]::IsZoomed($window) -and
    $clock.ElapsedMilliseconds -lt $TimeoutMs
) {
    [Threading.Thread]::Sleep(25)
}

$actual = [JanVimExhibitionJianShanWindowV1+RECT]::new()
if (-not [JanVimExhibitionJianShanWindowV1]::GetWindowRect($window, [ref]$actual)) {
    throw 'jianshan-window-bounds-failed'
}
$extendedStyle = [JanVimExhibitionJianShanWindowV1]::GetWindowLongPtrW(
    $window,
    $gwlExStyle
).ToInt64()
$maximized = [JanVimExhibitionJianShanWindowV1]::IsZoomed($window)
$topmost = ($extendedStyle -band $wsExTopmost) -ne 0
$clickThrough = ($extendedStyle -band $wsExTransparent) -ne 0
$noActivate = ($extendedStyle -band $wsExNoActivate) -ne 0
if (-not $maximized -or -not $topmost -or $clickThrough -or $noActivate) {
    throw 'jianshan-window-final-state-invalid'
}

[ordered]@{
    schema = 1
    pid = $ChildProcessId
    startedAtUtc = $expectedStart.ToString('o')
    matchedWindowCount = $matchCount
    hwnd = ('0x{0:X16}' -f $window.ToInt64())
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
    maximized = $maximized
    topmost = $topmost
    clickThrough = $clickThrough
    noActivate = $noActivate
} | ConvertTo-Json -Depth 4 -Compress
