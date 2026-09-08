[CmdletBinding()]
param(
    [switch] $Listen,

    [ValidateRange(1, 3600)]
    [double] $Duration = 45,

    [string] $RunRoot,

    [ValidateSet('Simulated', 'RealCursor')]
    [Alias('Input')]
    [string] $SoundInput = 'Simulated',

    [switch] $FlockIngress,

    [ValidateSet('LegacyPluckV1', 'StoneAndSignalV2')]
    [string] $InstrumentProfile = 'LegacyPluckV1',

    [string] $NodeExecutable
)

$ErrorActionPreference = 'Stop'
if ($FlockIngress -and $SoundInput -ne 'RealCursor') {
    throw 'FlockIngress requires -Input RealCursor'
}
if ($InstrumentProfile -eq 'StoneAndSignalV2' -and $SoundInput -ne 'RealCursor') {
    throw 'StoneAndSignalV2 requires -Input RealCursor'
}
. (Join-Path $PSScriptRoot 'node-runtime.ps1')
$node = Resolve-JanVimNodeExecutable -ExplicitPath $NodeExecutable

$runScript = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'run.mjs'))
$arguments = [System.Collections.Generic.List[string]]::new()
$arguments.Add($runScript)
$arguments.Add('--mode')
$arguments.Add($(if ($Listen) { 'listen' } else { 'silent' }))
$arguments.Add('--duration')
$arguments.Add($Duration.ToString([System.Globalization.CultureInfo]::InvariantCulture))
if ($SoundInput -eq 'RealCursor') {
    $arguments.Add('--input')
    $arguments.Add('real-cursor')
}
if ($FlockIngress) {
    $arguments.Add('--flock-input')
    $arguments.Add('enabled')
}
if ($InstrumentProfile -eq 'StoneAndSignalV2') {
    $arguments.Add('--instrument-profile')
    $arguments.Add('stone-and-signal-v2')
}
if (-not [string]::IsNullOrWhiteSpace($RunRoot)) {
    if (-not [System.IO.Path]::IsPathFullyQualified($RunRoot)) {
        throw 'RunRoot must be an absolute path'
    }
    $arguments.Add('--output')
    $arguments.Add([System.IO.Path]::GetFullPath($RunRoot))
}

& $node $arguments.ToArray()
exit $LASTEXITCODE
