[CmdletBinding()]
param(
    [switch] $Listen,

    [ValidateRange(1, 3600)]
    [double] $Duration = 45,

    [string] $RunRoot
)

$ErrorActionPreference = 'Stop'
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
$arguments = [System.Collections.Generic.List[string]]::new()
$arguments.Add($runScript)
$arguments.Add('--mode')
$arguments.Add($(if ($Listen) { 'listen' } else { 'silent' }))
$arguments.Add('--duration')
$arguments.Add($Duration.ToString([System.Globalization.CultureInfo]::InvariantCulture))
if (-not [string]::IsNullOrWhiteSpace($RunRoot)) {
    if (-not [System.IO.Path]::IsPathFullyQualified($RunRoot)) {
        throw 'RunRoot must be an absolute path'
    }
    $arguments.Add('--output')
    $arguments.Add([System.IO.Path]::GetFullPath($RunRoot))
}

& $node $arguments.ToArray()
exit $LASTEXITCODE
