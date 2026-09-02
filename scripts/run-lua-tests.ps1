[CmdletBinding()]
param(
    [string]$NvimPath
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($NvimPath)) {
    $nvimCommand = Get-Command nvim -ErrorAction Stop
    $resolvedNvimPath = $nvimCommand.Source
}
else {
    $resolvedNvimPath = (Resolve-Path -LiteralPath $NvimPath -ErrorAction Stop).Path
}

$versionOutput = @(& $resolvedNvimPath --version)
if ($LASTEXITCODE -ne 0 -or $versionOutput.Count -eq 0) {
    throw 'Unable to read Neovim version.'
}

$version = $versionOutput[0].Trim()
if ($version -ne 'NVIM v0.10.1') {
    throw "JanVim Exhibition Lua tests require NVIM v0.10.1; found '$version'."
}

$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$nvimRoot = Join-Path $repositoryRoot 'nvim'
$tests = @(
    (Join-Path $nvimRoot 'tests\protocol_spec.lua'),
    (Join-Path $nvimRoot 'tests\agent_spec.lua')
)

$previousRuntimeRoot = $env:JANVIM_EXHIBITION_NVIM_ROOT
try {
    $env:JANVIM_EXHIBITION_NVIM_ROOT = $nvimRoot
    foreach ($test in $tests) {
        & $resolvedNvimPath -u NONE -i NONE --noplugin --headless -l $test
        if ($LASTEXITCODE -ne 0) {
            throw "Lua test failed: $test"
        }
    }
}
finally {
    if ($null -eq $previousRuntimeRoot) {
        Remove-Item Env:JANVIM_EXHIBITION_NVIM_ROOT -ErrorAction SilentlyContinue
    }
    else {
        $env:JANVIM_EXHIBITION_NVIM_ROOT = $previousRuntimeRoot
    }
}
