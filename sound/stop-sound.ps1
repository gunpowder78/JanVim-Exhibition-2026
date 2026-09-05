[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string] $RunRoot
)

$ErrorActionPreference = 'Stop'
if (-not [System.IO.Path]::IsPathFullyQualified($RunRoot)) {
    throw 'RunRoot must be an absolute path'
}

$verifiedNode = 'C:\Users\hxj\AppData\Local\hermes\node\node.exe'
$node = if (Test-Path -LiteralPath $verifiedNode -PathType Leaf) {
    $verifiedNode
} else {
    (Get-Command node.exe -CommandType Application -ErrorAction Stop).Source
}
if ((& $node --version) -ne 'v22.23.0') {
    throw "JanVim sound requires Node 22.23.0: $node"
}

$runScript = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'run.mjs'))
& $node $runScript --stop ([System.IO.Path]::GetFullPath($RunRoot))
exit $LASTEXITCODE
