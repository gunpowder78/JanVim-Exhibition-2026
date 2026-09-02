[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateRange(1, 2147483647)]
    [int]$ChildProcessId,

    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$Hwnd
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$interopTypeName = 'JanVimExhibitionWindowCloseV1'
if ($null -eq ($interopTypeName -as [type])) {
    $interopSource = @'
using System;
using System.Runtime.InteropServices;

public static class JanVimExhibitionWindowCloseV1
{
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool IsWindow(IntPtr window);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    [DllImport("user32.dll")]
    public static extern IntPtr GetParent(IntPtr window);

    [DllImport("user32.dll")]
    public static extern IntPtr GetWindow(IntPtr window, uint command);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool IsWindowVisible(IntPtr window);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool PostMessage(
        IntPtr window,
        uint message,
        IntPtr messageParameter,
        IntPtr additionalParameter
    );
}
'@

    try {
        $null = Add-Type -TypeDefinition $interopSource -ErrorAction Stop
    }
    catch {
        $errorName = ([string]$_.FullyQualifiedErrorId -split ',', 2)[0]
        if ($errorName -ne 'TYPE_ALREADY_EXISTS') {
            throw
        }
    }
}

if ($null -eq ($interopTypeName -as [type])) {
    throw 'Window close interop type is unavailable.'
}

if ($Hwnd -notmatch '\A0[xX](?<digits>[0-9A-Fa-f]{1,16})\z') {
    throw 'Hwnd must be an unsigned hexadecimal pointer.'
}

$handleValue = [UInt64]0
if (-not [UInt64]::TryParse(
    $Matches['digits'],
    [Globalization.NumberStyles]::AllowHexSpecifier,
    [Globalization.CultureInfo]::InvariantCulture,
    [ref]$handleValue
)) {
    throw 'Hwnd must be an unsigned hexadecimal pointer.'
}
if ($handleValue -eq [UInt64]0) {
    throw 'Hwnd must not be zero.'
}

if ([IntPtr]::Size -eq 4) {
    if ($handleValue -gt [UInt64][UInt32]::MaxValue) {
        throw 'Hwnd exceeds the native pointer width.'
    }
    $handleBytes = [BitConverter]::GetBytes([UInt32]$handleValue)
    $window = [IntPtr]::new([BitConverter]::ToInt32($handleBytes, 0))
}
else {
    $handleBytes = [BitConverter]::GetBytes($handleValue)
    $window = [IntPtr]::new([BitConverter]::ToInt64($handleBytes, 0))
}

$gwOwner = [uint32]4
$wmClose = [uint32]0x0010
$normalizedHwnd = '0x{0:X16}' -f $handleValue

if (-not [JanVimExhibitionWindowCloseV1]::IsWindow($window)) {
    throw "HWND $normalizedHwnd is not a live window."
}

$windowPid = [uint32]0
$threadId = [JanVimExhibitionWindowCloseV1]::GetWindowThreadProcessId(
    $window,
    [ref]$windowPid
)
if ($threadId -eq [uint32]0 -or $windowPid -ne [uint32]$ChildProcessId) {
    throw "HWND $normalizedHwnd is not owned by PID $ChildProcessId."
}

$parent = [JanVimExhibitionWindowCloseV1]::GetParent($window)
if ($parent -ne [IntPtr]::Zero) {
    throw "HWND $normalizedHwnd is not top-level."
}

$owner = [JanVimExhibitionWindowCloseV1]::GetWindow($window, $gwOwner)
if ($owner -ne [IntPtr]::Zero) {
    throw "HWND $normalizedHwnd has an owner."
}

if (-not [JanVimExhibitionWindowCloseV1]::IsWindowVisible($window)) {
    throw "HWND $normalizedHwnd is not visible."
}

$closePosted = [JanVimExhibitionWindowCloseV1]::PostMessage(
    $window,
    $wmClose,
    [IntPtr]::Zero,
    [IntPtr]::Zero
)
if (-not $closePosted) {
    throw "PostMessage failed with Win32 error $([Runtime.InteropServices.Marshal]::GetLastWin32Error())."
}

$receipt = [ordered]@{
    schema = 1
    pid = $ChildProcessId
    hwnd = $normalizedHwnd
    ownershipVerified = $true
    topLevel = $true
    closePosted = $true
}

$receipt | ConvertTo-Json -Compress
