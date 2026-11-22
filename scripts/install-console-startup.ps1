[CmdletBinding()]
param([switch]$Remove)

$ErrorActionPreference = 'Stop'
$startup = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startup 'Adventure Land Party Console.lnk'
if ($Remove) {
    if (Test-Path -LiteralPath $shortcutPath) { Remove-Item -LiteralPath $shortcutPath }
    Write-Host 'Removed Party Console automatic startup for this Windows user.'
    return
}
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
$shortcut.Arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $PSScriptRoot 'start-console-at-logon.ps1') + '"'
$shortcut.WorkingDirectory = Split-Path -Parent $PSScriptRoot
$shortcut.WindowStyle = 7
$shortcut.Description = 'Start Party Console after Windows sign-in using the saved local session.'
$shortcut.Save()
Write-Host "Installed Windows sign-in startup: $shortcutPath"
