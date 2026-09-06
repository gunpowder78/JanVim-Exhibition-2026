Set-StrictMode -Version Latest

function Assert-JanVimNodeNoReparseTraversal {
    param([Parameter(Mandatory = $true)][string] $Path)

    $resolved = [IO.Path]::GetFullPath($Path)
    $root = [IO.Path]::GetPathRoot($resolved)
    $relative = $resolved.Substring($root.Length)
    $current = $root
    foreach ($segment in $relative.Split([char[]]@('\', '/'), [StringSplitOptions]::RemoveEmptyEntries)) {
        $current = Join-Path $current $segment
        if (-not (Test-Path -LiteralPath $current)) {
            continue
        }
        $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw 'node-executable-reparse-rejected'
        }
    }
}

function Invoke-JanVimNodeVersionProbe {
    param([Parameter(Mandatory = $true)][string] $Path)

    $startInfo = [Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $Path
    $startInfo.ArgumentList.Add('--version')
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    try {
        if (-not $process.Start()) {
            throw 'node-version-check-failed'
        }
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(1000)) {
            try { $process.Kill($true) } catch {}
            [void]$process.WaitForExit(1000)
            throw 'node-version-check-failed'
        }
        $stdout = $stdoutTask.GetAwaiter().GetResult()
        $stderr = $stderrTask.GetAwaiter().GetResult()
        if (
            [Text.Encoding]::UTF8.GetByteCount($stdout) -gt 4096 -or
            [Text.Encoding]::UTF8.GetByteCount($stderr) -gt 4096 -or
            $process.ExitCode -ne 0 -or
            -not [string]::IsNullOrWhiteSpace($stderr) -or
            $stdout.Trim() -cne 'v22.23.0'
        ) {
            throw 'node-version-mismatch'
        }
    }
    catch {
        if ($_.Exception.Message -in @('node-version-check-failed', 'node-version-mismatch')) {
            throw
        }
        throw 'node-version-check-failed'
    }
    finally {
        $process.Dispose()
    }
}

function Resolve-JanVimNodeExecutable {
    param([string] $ExplicitPath)

    if ([string]::IsNullOrWhiteSpace($ExplicitPath)) {
        $verifiedNode = 'C:\Users\hxj\AppData\Local\hermes\node\node.exe'
        $candidate = if (Test-Path -LiteralPath $verifiedNode -PathType Leaf) {
            $verifiedNode
        }
        else {
            (Get-Command node.exe -CommandType Application -ErrorAction Stop).Source
        }
    }
    else {
        if (-not [IO.Path]::IsPathFullyQualified($ExplicitPath)) {
            throw 'node-executable-must-be-absolute'
        }
        $candidate = [IO.Path]::GetFullPath($ExplicitPath)
    }

    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
        throw 'node-executable-missing'
    }
    Assert-JanVimNodeNoReparseTraversal -Path $candidate
    $resolved = [IO.Path]::GetFullPath(
        (Get-Item -LiteralPath $candidate -Force -ErrorAction Stop).FullName
    )
    if ([IO.Path]::GetFileName($resolved) -cne 'node.exe') {
        throw 'node-executable-name-invalid'
    }
    Invoke-JanVimNodeVersionProbe -Path $resolved
    return $resolved
}
