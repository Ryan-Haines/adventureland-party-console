param(
    [string]$RunnerDirectory = (Join-Path $PSScriptRoot '../../.build/self-hosted-runner')
)
$ErrorActionPreference = 'Stop'
$RunnerDirectory = (Resolve-Path -LiteralPath $RunnerDirectory).Path
if (!(Test-Path -LiteralPath (Join-Path $RunnerDirectory '.runner'))) { throw 'Register the local runner before starting it.' }
# Keep interactive apps responsive; job workers can use all available CPUs.
$process = [System.Diagnostics.Process]::GetCurrentProcess()
$process.PriorityClass = [System.Diagnostics.ProcessPriorityClass]::BelowNormal
Set-Location -LiteralPath $RunnerDirectory
& ./run.cmd
exit $LASTEXITCODE
