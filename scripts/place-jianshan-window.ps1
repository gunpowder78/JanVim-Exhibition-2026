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

    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW", SetLastError = true)]
    public static extern IntPtr SetWindowLongPtrW(IntPtr hWnd, int index, IntPtr value);

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

}
'@
}

$gwlStyle = -16
$gwOwner = [uint32]4
$gwlExStyle = -20
$wsCaption = [int64]0x00C00000
$wsThickFrame = [int64]0x00040000
$wsMinimizeBox = [int64]0x00020000
$wsMaximizeBox = [int64]0x00010000
$wsSystemMenu = [int64]0x00080000
$wsMaximize = [int64]0x01000000
$wsExDialogModalFrame = [int64]0x00000001
$wsExWindowEdge = [int64]0x00000100
$wsExClientEdge = [int64]0x00000200
$wsExStaticEdge = [int64]0x00020000
$wsExTopmost = [int64]0x00000008
$wsExTransparent = [int64]0x00000020
$wsExNoActivate = [int64]0x08000000
$borderedStyleMask = $wsCaption -bor $wsThickFrame -bor $wsMinimizeBox -bor $wsMaximizeBox -bor $wsSystemMenu
$borderedExStyleMask = $wsExDialogModalFrame -bor $wsExWindowEdge -bor $wsExClientEdge -bor $wsExStaticEdge
$swRestore = 9
$hwndTopmost = [IntPtr](-1)
$swpNoActivate = [uint32]0x0010
$swpFrameChanged = [uint32]0x0020
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

[void][JanVimExhibitionJianShanWindowV1]::ShowWindowAsync($window, $swRestore)
[Threading.Thread]::Sleep(25)
$initialStyle = [JanVimExhibitionJianShanWindowV1]::GetWindowLongPtrW(
    $window,
    $gwlStyle
).ToInt64()
$initialExtendedStyle = [JanVimExhibitionJianShanWindowV1]::GetWindowLongPtrW(
    $window,
    $gwlExStyle
).ToInt64()
$borderlessStyle = $initialStyle -band (-bnot $borderedStyleMask)
$borderlessExtendedStyle = $initialExtendedStyle -band (-bnot $borderedExStyleMask)
[void][JanVimExhibitionJianShanWindowV1]::SetWindowLongPtrW(
    $window,
    $gwlStyle,
    [IntPtr]$borderlessStyle
)
[void][JanVimExhibitionJianShanWindowV1]::SetWindowLongPtrW(
    $window,
    $gwlExStyle,
    [IntPtr]$borderlessExtendedStyle
)
$fullscreenFlags = $swpNoActivate -bor $swpFrameChanged -bor $swpShowWindow
if (-not [JanVimExhibitionJianShanWindowV1]::SetWindowPos(
    $window,
    $hwndTopmost,
    $X,
    $Y,
    $Width,
    $Height,
    $fullscreenFlags
)) {
    throw 'jianshan-window-fullscreen-failed'
}

$fullscreen = $false
$borderless = $false
$maximized = $true
$topmost = $false
$clickThrough = $true
$noActivate = $true
$actual = [JanVimExhibitionJianShanWindowV1+RECT]::new()
while ($clock.ElapsedMilliseconds -lt $TimeoutMs) {
    if (-not [JanVimExhibitionJianShanWindowV1]::GetWindowRect($window, [ref]$actual)) {
        throw 'jianshan-window-bounds-failed'
    }
    $style = [JanVimExhibitionJianShanWindowV1]::GetWindowLongPtrW(
        $window,
        $gwlStyle
    ).ToInt64()
    $extendedStyle = [JanVimExhibitionJianShanWindowV1]::GetWindowLongPtrW(
        $window,
        $gwlExStyle
    ).ToInt64()
    $borderless = (($style -band $borderedStyleMask) -eq 0) -and
        (($extendedStyle -band $borderedExStyleMask) -eq 0)
    $maximized = ($style -band $wsMaximize) -ne 0
    $topmost = ($extendedStyle -band $wsExTopmost) -ne 0
    $clickThrough = ($extendedStyle -band $wsExTransparent) -ne 0
    $noActivate = ($extendedStyle -band $wsExNoActivate) -ne 0
    $fullscreen = $borderless -and -not $maximized -and
        $actual.Left -eq $X -and $actual.Top -eq $Y -and
        ($actual.Right - $actual.Left) -eq $Width -and
        ($actual.Bottom - $actual.Top) -eq $Height
    if ($fullscreen -and $topmost -and -not $clickThrough -and -not $noActivate) {
        break
    }
    [Threading.Thread]::Sleep(25)
}

if (-not $fullscreen -or -not $topmost -or $clickThrough -or $noActivate) {
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
    fullscreen = $fullscreen
    borderless = $borderless
    maximized = $maximized
    topmost = $topmost
    clickThrough = $clickThrough
    noActivate = $noActivate
} | ConvertTo-Json -Depth 4 -Compress
