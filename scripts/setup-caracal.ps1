[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot
try {
    node tools/hosting/install-caddy.mts
    if ($LASTEXITCODE -ne 0) { throw 'HTTPS service installation failed.' }
    npm ci
    if ($LASTEXITCODE -ne 0) { throw 'Root dependency installation failed.' }
    npm --prefix dashboard ci
    if ($LASTEXITCODE -ne 0) { throw 'Dashboard dependency installation failed.' }
    node tools/caracal/setup.mts
    if ($LASTEXITCODE -ne 0) { throw 'Portable caracAL installation failed.' }
    npm --prefix .caracal ci
    if ($LASTEXITCODE -ne 0) { throw 'caracAL dependency installation failed.' }
    node tools/build-shared.mts --publish
    if ($LASTEXITCODE -ne 0) { throw 'Shared build failed.' }
    node tools/build-runtime.mts --publish
    if ($LASTEXITCODE -ne 0) { throw 'Runtime build failed.' }
    node tools/game/build.mts --publish
    if ($LASTEXITCODE -ne 0) { throw 'Character build failed.' }
    Write-Host 'Setup complete. Run .\scripts\start-caracal.ps1.'
} finally { Pop-Location }
