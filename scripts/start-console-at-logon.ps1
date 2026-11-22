[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot
$logDirectory = Join-Path $repoRoot '.build/startup'
New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
Start-Transcript -Path (Join-Path $logDirectory 'logon.log') -Append | Out-Null
try {
    # Do not restart a console that was already launched manually.
    $port = if ($env:AL_PORT) { [int]$env:AL_PORT } else { 3010 }
    if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) {
        Write-Host "Port $port is already listening; leaving the running service alone."
        return
    }
    if (-not (Test-Path -LiteralPath (Join-Path $repoRoot '.caracal/session.clixml'))) {
        throw 'Run scripts/start-console.ps1 interactively once to save your session.'
    }
    & (Join-Path $PSScriptRoot 'start-console.ps1')
} finally {
    Stop-Transcript | Out-Null
}
