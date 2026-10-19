// Compare the same real gameplay at doubling requested rates, stopping at a confirmed plateau.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,cpSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {sourceFingerprint} from '../console-build/builder.ts';

const root=fileURLToPath(new URL('../../',import.meta.url));
const out=path.join(root,'.build/e2e-rate-benchmarks',new Date().toISOString().replace(/[:.]/g,'-'));
mkdirSync(out,{recursive:true});
const sourceHash=await sourceFingerprint(root);
const npm=process.env.npm_execpath||path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
const title='armadillo Hunt kills passing goos outbound and returning before claiming Daisy';
const startRate=Number(process.env.E2E_RATE_SWEEP_START||4);
assert(Number.isInteger(startRate)&&startRate>=4&&startRate<=512&&(startRate&(startRate-1))===0,'Sweep start must be a power of two from4 through512');
type Sample={wallSeconds:number;gameplaySeconds:number;cpuSeconds:number;logicalProcessors:number;renderer:string;accountingComplete:boolean;requestedClockRate:number;achievedClockRate:number};
type Run={rate:number;tag:string;archive:string;commandWallSeconds:number;medianBodySeconds:number;achievedClockRate:number;browserMachinePercent:number;samples:Sample[]};
const runs:Run[]=[];
let candidate:string|undefined;
const median=(values:number[])=>{const v=values.slice().sort((a,b)=>a-b);return (v[Math.floor((v.length-1)/2)]+v[Math.floor(v.length/2)])/2;};
function persist(extra:Record<string,unknown>={}){writeFileSync(path.join(out,'comparison.json'),JSON.stringify({schema:1,title,sourceHash,candidate,workers:1,repetitions:3,minimumImprovement:0.03,runs,...extra},null,2));}
function command(args:string[],env=process.env){const r=spawnSync(process.execPath,args,{cwd:root,env,stdio:'inherit',windowsHide:true});if(r.error)throw r.error;return r.status;}
async function run(rate:number,tag:string){
  assert.equal(await sourceFingerprint(root),sourceHash,'Sources changed during rate comparison');
  console.log(`[rate sweep] ${tag}: requested ${rate}x, three identical gameplay repetitions`);
  const started=performance.now();
  const status=command([npm,'run','test:e2e','--','--project=live','--grep',title,'--repeat-each=3','--workers=1'],{
    ...process.env,E2E_GAMEPLAY_BACKEND:'simulation',E2E_CLOCK_RATE:String(rate),E2E_CLOCK_WINDOW_MS:'250',
    E2E_BROWSER_RENDERING:'hardware',E2E_MEASURE_BROWSER_CPU:'1',
    E2E_DASHBOARD_CANDIDATE_ID:candidate,
  });
  const commandWallSeconds=(performance.now()-started)/1000;
  const archive=path.join(out,tag);
  mkdirSync(path.join(archive,'.build'),{recursive:true});
  for(const name of ['e2e-report','e2e-results'])cpSync(path.join(root,'.build',name),path.join(archive,'.build',name),{recursive:true});
  assert.equal(command(['e2e/verify-artifacts.cjs',archive]),0,'Evidence verification or gameplay failed');
  assert.equal(status,0,'Focused gameplay command failed');
  assert.equal(await sourceFingerprint(root),sourceHash,'Sources changed during gameplay');
  const manifest=JSON.parse(readFileSync(path.join(archive,'.build/e2e-report/manifest.json'),'utf8'));
  assert.equal(manifest.tests.length,3);assert.equal(manifest.workers,1);
  assert.equal(manifest.gameplayClockRate,rate);
  assert.equal(manifest.dashboardCandidate.sourceHash,sourceHash);
  candidate??=manifest.dashboardCandidate.id;
  assert.equal(manifest.dashboardCandidate.id,candidate);
  const rows=readFileSync(path.join(archive,'.build/e2e-results/outcomes.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line));
  const samples:Sample[]=rows.map(row=>{
    assert.equal(row.status,'passed');assert(row.title.endsWith(title));
    const attachment=row.attachments.find((a:{name:string})=>a.name==='browser-rendering-cpu');
    const sample=JSON.parse(readFileSync(path.resolve(archive,attachment.path),'utf8')) as Sample;
    assert(sample.accountingComplete,'Browser process turnover makes CPU accounting incomplete');
    assert(!/swiftshader|llvmpipe|software/i.test(sample.renderer),'Hardware renderer required');
    assert.equal(sample.requestedClockRate,rate);assert(sample.gameplaySeconds>0&&sample.wallSeconds>0);
    return sample;
  });
  const wall=samples.reduce((s,x)=>s+x.wallSeconds,0);
  const result={rate,tag,archive,commandWallSeconds,medianBodySeconds:median(samples.map(x=>x.wallSeconds)),
    achievedClockRate:samples.reduce((s,x)=>s+x.gameplaySeconds,0)/wall,
    browserMachinePercent:samples.reduce((s,x)=>s+x.cpuSeconds,0)/wall/samples[0].logicalProcessors*100,samples};
  runs.push(result);persist();console.log(JSON.stringify({...result,samples:undefined}));return result;
}
try{
  let best=await run(startRate,`rate-${startRate}`);
  for(let rate=startRate*2;rate<=1024;rate*=2){
    const challenger=await run(rate,`rate-${rate}`);
    if(challenger.medianBodySeconds<best.medianBodySeconds*0.97){best=challenger;continue;}
    await run(best.rate,`confirm-best-${best.rate}-at-${rate}`);
    await run(rate,`confirm-rate-${rate}`);
    const pooled=(requested:number)=>median(runs.filter(r=>r.rate===requested).flatMap(r=>r.samples.map(s=>s.wallSeconds)));
    if(pooled(rate)<pooled(best.rate)*0.97){best=challenger;continue;}
    persist({complete:true,stopReason:'confirmed plateau',bestRequestedRate:best.rate,plateauRequestedRate:rate,
      pooledBestMedianSeconds:pooled(best.rate),pooledChallengerMedianSeconds:pooled(rate)});
    console.log(`[rate sweep] Confirmed plateau at ${rate}x; best requested rate ${best.rate}x. Evidence: ${out}`);
    process.exit(0);
  }
  persist({complete:true,stopReason:'administrative ceiling reached',bestRequestedRate:best.rate});
}catch(error){persist({complete:false,error:String(error)});throw error;}
