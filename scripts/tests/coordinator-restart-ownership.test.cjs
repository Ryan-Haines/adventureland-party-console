const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {spawnSync}=require('node:child_process');
test('restart retires its own service launcher and leaves an unrelated parent alone',()=>{
 const file=path.resolve('scripts/start-caracal.ps1').replaceAll("'","''");
 const code=`
 $ErrorActionPreference='Stop'
 $ast=[System.Management.Automation.Language.Parser]::ParseFile('${file}',[ref]$null,[ref]$null)
 $fn=$ast.Find({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Stop-ExistingCaracalSupervisor'},$true)
 Invoke-Expression $fn.Extent.Text
 $repoRoot='${path.resolve('.build/restart-fixture/adventure_land').replaceAll("'","''")}'; $caracalRoot=Join-Path $repoRoot '.caracal'
 function Test-Path { return $true }
 function Get-Content { return '30' }
 function Get-Process { if (-not $script:stopped) { return [pscustomobject]@{ProcessName='node'} } }
 function Stop-ProcessTree {param($RootProcessId) $script:stopped=$RootProcessId}
 function Remove-Item {}
 function Get-CimInstance {
  param($ClassName,$Filter)
  switch ($Filter) {
   'ProcessId=30' {return [pscustomobject]@{ProcessId=30;ParentProcessId=20}}
   'ProcessId=20' {return [pscustomobject]@{ProcessId=20;ParentProcessId=10;Name='node.exe';CommandLine=$script:hostCommand}}
   'ProcessId=10' {return [pscustomobject]@{ProcessId=10;Name='pwsh.exe';CommandLine='pwsh -File scripts/start-caracal.ps1'}}
   default {throw "Unexpected process lookup: $Filter"}
  }
 }
 $script:hostCommand='node '+(Join-Path $repoRoot 'tools/hosting/local.mts');$script:stopped=0
 Stop-ExistingCaracalSupervisor
 if ($script:stopped -ne 10) {throw "Expected old launcher 10; stopped $script:stopped"}
 $script:hostCommand='node '+(Join-Path (Split-Path $repoRoot) 'other/tools/hosting/local.mts');$script:stopped=0
 Stop-ExistingCaracalSupervisor
 if ($script:stopped -ne 30) {throw "Unrelated parent must survive; stopped $script:stopped"}
 `;
 const shell=process.platform==='win32' ? path.join(process.env.ProgramFiles || 'C:\\Program Files','PowerShell/7/pwsh.exe') : 'pwsh';
 const result=spawnSync(shell,['-NoProfile','-Command',code],{encoding:'utf8',windowsHide:true});
 if(result.error)throw result.error;
 assert.equal(result.status,0,result.stdout+result.stderr);
});
