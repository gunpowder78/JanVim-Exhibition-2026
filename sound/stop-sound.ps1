[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string] $RunRoot,

    [string] $NodeExecutable
)

$ErrorActionPreference = 'Stop'
if (-not [System.IO.Path]::IsPathFullyQualified($RunRoot)) {
    throw 'RunRoot must be an absolute path'
}

. (Join-Path $PSScriptRoot 'node-runtime.ps1')
$node = Resolve-JanVimNodeExecutable -ExplicitPath $NodeExecutable

$runScript = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'run.mjs'))
& $node $runScript --stop ([System.IO.Path]::GetFullPath($RunRoot))
exit $LASTEXITCODE
