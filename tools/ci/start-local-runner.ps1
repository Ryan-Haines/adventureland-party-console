param(
    [string]$RunnerDirectory = (Join-Path $PSScriptRoot '../../.build/self-hosted-runner')
)
$ErrorActionPreference = 'Stop'
$RunnerDirectory = (Resolve-Path -LiteralPath $RunnerDirectory).Path
if (!(Test-Path -LiteralPath (Join-Path $RunnerDirectory '.runner'))) { throw 'Register the local runner before starting it.' }
# Bound inherited CPU affinity and priority; the runner itself executes one job.
$process = [System.Diagnostics.Process]::GetCurrentProcess()
$process.PriorityClass = [System.Diagnostics.ProcessPriorityClass]::BelowNormal
$count = [Math]::Min(8, [Environment]::ProcessorCount)
$process.ProcessorAffinity = [IntPtr]([Math]::Pow(2, $count) - 1)
Set-Location -LiteralPath $RunnerDirectory
& ./run.cmd
exit $LASTEXITCODE
