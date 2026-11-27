param([Parameter(Mandatory=$true)][string]$RootPath)
$ErrorActionPreference = 'Stop'
$received = [IO.Path]::GetFullPath($RootPath)
$expected = [IO.Path]::GetFullPath((Get-Location).Path)
if ($received -ne $expected) { throw "Incorrect BAT-to-PowerShell folder argument." }
Write-Host "PASS: quoted Windows folder argument resolves correctly."
