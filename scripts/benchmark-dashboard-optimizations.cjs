// Deterministic, offline replay. Never contacts or changes the running game.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {execFileSync}=require('node:child_process'),ts=require('typescript');
const {httpFixture}=require('./tests/helpers/coordinator-http.cjs');
const {replay}=require('./tests/helpers/dashboard-card-replay.cjs');
const ref=process.argv[2]||'34e3ee7418223620567cfb2b26f1f4e7cb49653e';
function baseline(){
 const filename=path.resolve('runtime/coordinator/telemetry/benchmark-stream.cjs');
 const source=execFileSync('git',['show',ref+':runtime/coordinator/telemetry/dashboard-stream.ts'],{encoding:'utf8',windowsHide:true});
 const m=new Module(filename,module);m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename));
 m._compile(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename);
 return m.exports.createDashboardStream;
}
function streamReplay(create,scenario){
 const names=['A','B','C','M'],f=httpFixture();let now=1000;
 const conditions=ms=>Array.from({length:6},(_,i)=>({id:'buff'+i,name:'Buff '+i,remainingMs:ms,source:'Priest',live:{ms},
  definition:{duration:120000,explanation:'Representative status metadata '.repeat(12)},sprite:{file:'conditions',x:0,y:0,width:20,height:20}}));
 const statuses=Object.fromEntries(names.map(name=>[name,{name,dashboardRuntime:'r',hp:1000,map:'main',x:0,y:0,items:[],slots:{},conditions:conditions(120000)}]));
 const stream=create({now:()=>now,statuses:()=>statuses,active:()=>true,every:()=>1,cancel(){}});stream.install(f.router);
 let connection=f.invoke('GET','/party-api/dashboard-stream'),bytes=0,messages=0;
 const collect=()=>{for(const chunk of connection.response.chunks){bytes+=Buffer.byteLength(chunk);messages++;}connection.response.chunks.length=0;};
 collect();const start=performance.now(),cpu=process.cpuUsage();
 for(let sample=1;sample<=100;sample++){
  now+=100;
  for(const name of names){
   const vitals={conditions:conditions(120000-sample*100)};
   if(scenario==='movement'||scenario==='mixed')Object.assign(vitals,{x:sample*2,y:sample,map:sample<50?'main':'cave',in:sample<50?'main':'instance'});
   if(scenario==='combat'||scenario==='mixed')vitals.hp=1000-sample;
   const items=scenario==='mixed'&&sample%20===0?{0:sample%40?{slot:0,item:{name:'hpot0',q:sample}}:null}:{};
   f.invoke('POST','/party-api/dashboard-telemetry',{name,runtime:'r',...stream.lease(name),sample,sampledAt:now,data:{vitals,items}});
  }
  collect();
  if(scenario==='mixed'&&sample===70){connection.request.close();connection=f.invoke('GET','/party-api/dashboard-stream');collect();}
 }
 const used=process.cpuUsage(cpu);connection.request.close();
 return {bytes,messages,wallMs:performance.now()-start,cpuMs:(used.user+used.system)/1000};
}
async function main(){
 const old=baseline(),current=require('../runtime/coordinator/telemetry/dashboard-stream.ts').createDashboardStream;
 const streams={};for(const scenario of ['idle-buffs','movement','combat','mixed']){
  // Warm up both variants, then alternate identical measured workloads.
  streamReplay(old,scenario);streamReplay(current,scenario);
  streams[scenario]={baseline:[],current:[]};
  for(let i=0;i<5;i++){streams[scenario].baseline.push(streamReplay(old,scenario));streams[scenario].current.push(streamReplay(current,scenario));}
 }
 const cards={baseline:[],current:[]};
 for(let i=0;i<3;i++){cards.baseline.push(await replay({ref,steps:20}));cards.current.push(await replay({steps:20}));}
 const result={baseline:ref,at:new Date().toISOString(),caveat:'Synthetic four-character 10 Hz stream and two actual connected React cards with visual leaves stubbed. Render invocations, not browser paint or CPU. Card elapsed time includes async flush delays. Five stream runs and three card runs. No live gameplay changes.',streams,cards};
 fs.writeFileSync('.build/dashboard-optimizations-benchmark.json',JSON.stringify(result,null,2));
 for(const [scenario,data]of Object.entries(streams))console.log(scenario,JSON.stringify({baseline:data.baseline[0],current:data.current[0]}));
 console.log('cards',JSON.stringify({baseline:cards.baseline[0],current:cards.current[0]}));
}
main().then(()=>process.exit(0),error=>{console.error(error);process.exit(1);});
