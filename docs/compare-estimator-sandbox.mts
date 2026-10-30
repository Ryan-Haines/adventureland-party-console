import {build} from 'esbuild';
import {execFile,execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {startNetworkClock} from '../tools/sim/network-clock-broker.mts';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
await (await import('node:fs/promises')).mkdir('.build/ci-recovery',{recursive:true});
const require=createRequire(import.meta.url),rows=[];
const original=execFileSync('git',['show','cfc61bd:runtime/upgrade-estimate.ts'],{encoding:'utf8'});
for(const mode of process.argv.includes('--optimized')?['after']:['before','after']){
 const compiled=await build({...(mode==='before'?{stdin:{contents:original,loader:'ts',resolveDir:process.cwd()}}:{entryPoints:['runtime/coordinator/merchant/upgrade-estimate.ts']}),bundle:true,platform:'node',format:'cjs',write:false});
 const clock=await startNetworkClock(4);
 try{
 const script=`const vm=require('node:vm'),{performance}=require('node:perf_hooks'),m={exports:{}};
 vm.runInNewContext(${JSON.stringify(compiled.outputFiles[0].text)},{module:m,exports:m.exports,require,setTimeout,clearTimeout,console,Date,AbortSignal});
 const choice={id:'softstepgloves',cost:420000,upgradeable:true,upgradeGrade:1,grades:[0,5,8,9],scrollCosts:[1000,40000,1600000,64000000]};
 const start=performance.now(),cpu=process.cpuUsage();m.exports.estimateUpgrade(choice,1,12).then(result=>{console.log(JSON.stringify({mode:${JSON.stringify(mode)},wallMs:performance.now()-start,cpu:process.cpuUsage(cpu),result}));process.exit(0)});`;
 const child=await promisify(execFile)(process.execPath,[...(process.argv.includes('--profile')?['--cpu-prof','--cpu-prof-dir=.build/ci-recovery','--cpu-prof-name=estimator.cpuprofile']:[]),'--import',pathToFileURL(path.resolve('tools/sim/network-clock-preload.mjs')).href,'-e',script],{timeout:240000,windowsHide:true,env:{...process.env,NODE_OPTIONS:'',E2E_CLOCK_PRELOAD:'1',E2E_CLOCK_RATE:'4',E2E_CLOCK_WALL_EPOCH:String(clock.epoch),E2E_CLOCK_VIRTUAL_EPOCH:String(clock.epoch),E2E_CLOCK_BROKER:`http://127.0.0.1:${clock.port}`,E2E_CLOCK_TOKEN:clock.token,E2E_CLOCK_SCOPE:'estimator-sandbox-'+mode}});
 const row=JSON.parse(child.stdout);rows.push(row);console.log(JSON.stringify(row));
 }finally{await clock.close();}
}
const prior=process.argv.includes('--optimized')?JSON.parse(require('node:fs').readFileSync('.build/ci-recovery/sandbox-estimate-results.json')):undefined;
const before=prior?.rows[0]||rows[0],after=rows.at(-1);
if(JSON.stringify(before.result)!==JSON.stringify(after.result))throw Error('Estimator output changed');
await writeFile(process.argv.includes('--optimized')?'.build/ci-recovery/sandbox-estimate-optimized.json':'.build/ci-recovery/sandbox-estimate-results.json',JSON.stringify({rows:prior?[before,after]:rows,identicalResults:true,speedup:before.wallMs/after.wallMs},null,2));

