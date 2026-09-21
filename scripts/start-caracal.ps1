# Compatibility entry point; use start-console.ps1 for new commands.
[CmdletBinding()]
param(
    [switch]$ResetSession,
    [switch]$CoordinatorOnly,
    [switch]$DevDashboard,
    [switch]$ProductionDashboard
)
& (Join-Path $PSScriptRoot 'start-console.ps1') @PSBoundParameters
