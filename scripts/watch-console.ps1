[CmdletBinding()]
param([switch]$Errors, [int]$Tail = 80)

$ErrorActionPreference = 'Stop'
$build = Join-Path (Split-Path -Parent $PSScriptRoot) '.build'
$suffix = if ($Errors) { '*.stderr.log' } else { '*.stdout.log' }
$log = Get-ChildItem -LiteralPath $build -Filter $suffix |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $log) { throw "No redirected console logs found in $build" }
$Host.UI.RawUI.WindowTitle = 'Adventure Land live logs'
Write-Host "Following $($log.FullName)"
Write-Host 'Closing this log viewer does not stop the game services. Use -Errors to view stderr.'
Get-Content -LiteralPath $log.FullName -Tail $Tail -Wait
