[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'lib\Exhibition.Taskbar.psm1') -Force
Set-ExhibitionTaskbarVisibility -Visible $true | ConvertTo-Json -Compress
