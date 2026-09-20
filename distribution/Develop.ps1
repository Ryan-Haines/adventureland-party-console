[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'Start.ps1') -PrepareOnly
$appRoot = Join-Path $PSScriptRoot 'app'
$activeFile = Join-Path $PSScriptRoot 'active.json'
if (Test-Path -LiteralPath $activeFile) { $appRoot = Join-Path $PSScriptRoot ((Get-Content -LiteralPath $activeFile -Raw | ConvertFrom-Json).root) }
$resolved = [IO.Path]::GetFullPath($appRoot)
if (-not $resolved.StartsWith([IO.Path]::GetFullPath($PSScriptRoot) + [IO.Path]::DirectorySeparatorChar)) { throw 'Invalid active source directory.' }
Push-Location $appRoot
try {
    npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw 'Development dependency installation failed.' }
    npm.cmd --prefix dashboard ci
    if ($LASTEXITCODE -ne 0) { throw 'Dashboard dependency installation failed.' }
    Write-Host "Editable source: $appRoot"
    Write-Host 'Keep Start.cmd running. Character edits rebuild automatically below. For dashboard/coordinator edits, stop the console, run npm run build, and restart.'
    node tools/game/watch.mts
} finally { Pop-Location }
