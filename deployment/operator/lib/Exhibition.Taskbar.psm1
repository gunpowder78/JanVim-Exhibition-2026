Set-StrictMode -Version Latest

function Set-ExhibitionTaskbarVisibility {
    param(
        [Parameter(Mandatory = $true)][bool] $Visible,
        [scriptblock] $Wait = { param($Milliseconds) [Threading.Thread]::Sleep($Milliseconds) }
    )
    if (-not ('ExhibitionTaskbarV1' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class ExhibitionTaskbarV1 {
    [DllImport("user32.dll", CharSet=CharSet.Unicode)]
    private static extern IntPtr FindWindow(string className, string title);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)]
    private static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string className, string title);
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool ShowWindowAsync(IntPtr window, int command);
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool IsWindowVisible(IntPtr window);
    public static IntPtr[] GetTaskbars() {
        var result = new List<IntPtr>();
        var primary = FindWindow("Shell_TrayWnd", null);
        if (primary != IntPtr.Zero) result.Add(primary);
        var after = IntPtr.Zero;
        for (int i=0; i<16; i++) {
            after = FindWindowEx(IntPtr.Zero, after, "Shell_SecondaryTrayWnd", null);
            if (after == IntPtr.Zero) break;
            result.Add(after);
        }
        return result.ToArray();
    }
}
'@
    }
    # Current interactive desktop only. SW_SHOWNOACTIVATE restores Explorer's
    # taskbars without changing foreground, auto-hide preferences, or geometry.
    $windows = @([ExhibitionTaskbarV1]::GetTaskbars())
    $command = if ($Visible) { 4 } else { 0 }
    foreach ($window in $windows) {
        [void][ExhibitionTaskbarV1]::ShowWindowAsync($window, $command)
    }
    for ($attempt = 0; $attempt -le 10; $attempt++) {
        $pending = @($windows | Where-Object { [ExhibitionTaskbarV1]::IsWindowVisible($_) -ne $Visible })
        if ($pending.Count -eq 0) {
            return [pscustomobject]@{ visible=$Visible; taskbarCount=$windows.Count }
        }
        if ($attempt -lt 10) { & $Wait 50 }
    }
    throw 'taskbar-visibility-not-applied'
}

function Enter-ExhibitionTaskbar {
    param([Parameter(Mandatory = $true)][hashtable] $State,
        [scriptblock] $Wait = { param($Milliseconds) [Threading.Thread]::Sleep($Milliseconds) })
    if ($State.RestoreRequired) { return }
    # Own restoration BEFORE touching any HWND, including partial hide failures.
    $State.RestoreRequired = $true
    Set-ExhibitionTaskbarVisibility -Visible $false -Wait $Wait
}

function Exit-ExhibitionTaskbar {
    param([Parameter(Mandatory = $true)][hashtable] $State,
        [scriptblock] $Wait = { param($Milliseconds) [Threading.Thread]::Sleep($Milliseconds) })
    if (-not $State.RestoreRequired) { return }
    $receipt = Set-ExhibitionTaskbarVisibility -Visible $true -Wait $Wait
    $State.RestoreRequired = $false
    return $receipt
}

Export-ModuleMember -Function Set-ExhibitionTaskbarVisibility, Enter-ExhibitionTaskbar, Exit-ExhibitionTaskbar
