// Crash recovery: docs/efficiency.md (Persistence), failure inventory P6
// items 5-7. The test SIGKILLs a writer process that saves at live-like rates,
// at random moments and at each compaction and shutdown step. A fresh process
// then reopens the journal under a time limit and reports what it holds.
// CRASH_ROOT runs the same journeys against another checkout.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {spawn,spawnSync}=require('node:child_process');
const root=path.resolve(process.env.CRASH_ROOT||path.join(__dirname,'../..'));
const persistence=path.join(root,'runtime/coordinator/persistence');
const HISTORY_WINDOW_MS=5000,SETTINGS_WINDOW_MS=1000,MARGIN_MS=750,REOPEN_LIMIT_MS=15000;

// Saves a direct key, a combat line and every fifth tick a material setting
// every 20 ms, and reports each save after it returns.
const writer=`
const fs=require('node:fs'),{syncBuiltinESMExports}=require('node:module');
const {CoordinatorJsonlStore}=require(${JSON.stringify(path.join(persistence,'jsonl-store.ts'))});
const {createCoordinatorPersistence}=require(${JSON.stringify(path.join(persistence,'writer.ts'))});
const [directory,mode]=process.argv.slice(1);
const hold=step=>{process.send({type:'step',step});Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10000);};
const store=new CoordinatorJsonlStore(directory+'/state.jsonl',directory+'/state.new.jsonl');
const rename=fs.renameSync;
fs.renameSync=(...args)=>{if(mode==='before-rename')hold(mode);rename(...args);if(mode==='after-rename')hold(mode);};
syncBuiltinESMExports();
const state={aldata:{},merchantActivity:[],combatLogs:{F:[]},threshold:0,production:{attempts:{}},
 eventAttendance:{F:{boss:{lastLiveAt:0,lastObservedAt:0,elapsedMs:0}}}};
const persist=createCoordinatorPersistence(state,store);
let n=0;
const tick=setInterval(()=>{
 n++;
 store.set('direct',{n,filler:'d'.repeat(2000)});
 state.combatLogs.F.push({at:Date.now(),message:'line '+n+' '+'c'.repeat(300)});
 if(state.combatLogs.F.length>500)state.combatLogs.F.splice(0,state.combatLogs.F.length-500);
 persist.history();
 state.eventAttendance.F.boss.lastLiveAt=Date.now();
 if(n%5===0)state.threshold=n;
 persist.scheduleSettings();
 process.send({type:'ack',n});
 if(n%40===0&&mode.endsWith('rename'))store.refactor();
 if(mode==='shutdown'&&n===Number(process.argv[3])){clearInterval(tick);process.send({type:'closing'});persist.flush();store.close();hold('closed');}
},20);
process.send({type:'ready'});
`;
const reader=`
const {CoordinatorJsonlStore}=require(${JSON.stringify(path.join(persistence,'jsonl-store.ts'))});
const directory=process.argv[1];
const store=new CoordinatorJsonlStore(directory+'/state.jsonl',directory+'/state.new.jsonl');
const history=store.get('party_dashboard_history_state_v1')||{};
const lines=(history.combatLogs?.F||[]).map(entry=>Number(/line (\\d+)/.exec(entry.message)[1]));
const settings=store.get('party_dashboard_settings_state_v1')||{};
store.close();
console.log(JSON.stringify({directN:(store.get('direct')||{}).n||0,history:Math.max(0,...lines),threshold:Number(settings.threshold)||0}));
`;
const flags=['--experimental-strip-types','--no-warnings'];

function run(directory,mode,{killAfter,closeAt,tear}){
 return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[...flags,'-e',writer,directory,mode,String(closeAt||0)],{stdio:['ignore','ignore','pipe','ipc']});
  let stderr='';child.stderr.on('data',chunk=>{stderr+=chunk;});
  const acks=[];let killedAt=0,timer;
  const kill=()=>{if(!killedAt){killedAt=Date.now();child.kill('SIGKILL');}};
  child.on('message',message=>{
   if(message.type==='ready'&&killAfter!==undefined)timer=setTimeout(kill,killAfter);
   if(message.type==='ack')acks.push({n:message.n,at:Date.now()});
   if(message.type==='step')kill();
   if(message.type==='closing'&&closeAt)setTimeout(kill,Math.floor(Math.random()*15));
  });
  const limit=setTimeout(()=>{kill();},20000);
  child.on('exit',()=>{
   clearTimeout(timer);clearTimeout(limit);
   if(!killedAt)return reject(Error('writer exited before the kill: '+stderr));
   const main=path.join(directory,'state.jsonl');
   const lockLeft=fs.existsSync(main+'.writer.lock');
   if(tear)tearTail(main);
   const started=Date.now();
   const result=spawnSync(process.execPath,[...flags,'-e',reader,directory],{timeout:REOPEN_LIMIT_MS,encoding:'utf8'});
   resolve({acks,killedAt,lockLeft,reopenMs:Date.now()-started,result,directory});
  });
 });
}
// Cuts the journal inside its last line, as a power loss mid-append can.
function tearTail(main){
 const bytes=fs.readFileSync(main);
 if(bytes.length<2)return;
 const end=bytes[bytes.length-1]===10?bytes.length-1:bytes.length;
 const start=bytes.lastIndexOf(10,end-1)+1;
 if(end-start<2)return;
 fs.truncateSync(main,start+1+Math.floor(Math.random()*(end-start-1)));
}
function check(outcome,{tear}={}){
 const {acks,killedAt,result}=outcome;
 assert.notEqual(result.error?.code,'ETIMEDOUT','reopen hung for '+REOPEN_LIMIT_MS+' ms');
 assert.equal(result.status,0,'reopen failed: '+result.stderr);
 const saved=JSON.parse(result.stdout.trim().split('\n').at(-1));
 const last=acks.at(-1)?.n||0;
 // A torn tail drops the one record that was in flight.
 assert.ok(saved.directN>=last-(tear?1:0),'direct save '+last+' acknowledged, '+saved.directN+' reopened');
 const before=window=>Math.max(0,...acks.filter(ack=>ack.at<=killedAt-window-MARGIN_MS).map(ack=>ack.n));
 assert.ok(saved.history>=before(HISTORY_WINDOW_MS),'history line '+before(HISTORY_WINDOW_MS)+' is older than the window, reopened '+saved.history);
 const setting=before(SETTINGS_WINDOW_MS);
 assert.ok(saved.threshold>=setting-setting%5,'setting '+(setting-setting%5)+' is older than the window, reopened '+saved.threshold);
 return saved;
}

const random=(low,high)=>low+Math.floor(Math.random()*(high-low));
const cases=[
 ...Array.from({length:14},(_,i)=>['random moment '+(i+1),'random',{killAfter:random(30,2000)}]),
 ...Array.from({length:6},(_,i)=>['after the history window '+(i+1),'random',{killAfter:random(6500,8000)}]),
 ...Array.from({length:8},(_,i)=>['compaction before rename '+(i+1),'before-rename',{}]),
 ...Array.from({length:8},(_,i)=>['compaction after rename '+(i+1),'after-rename',{}]),
 ...Array.from({length:8},(_,i)=>['shutdown '+(i+1),'shutdown',{closeAt:random(10,120)}]),
 ...Array.from({length:6},(_,i)=>['torn tail '+(i+1),'random',{killAfter:random(100,2500),tear:true}]),
];
for(const [name,mode,options] of cases)
 test('SIGKILL at '+name+' reopens in bounded time with every saved record',async t=>{
  const outcome=await run(prepare(t),mode,options);
  if(mode!=='shutdown')assert.ok(outcome.lockLeft,'the killed writer left its lock behind');
  check(outcome,options);
  assert.ok(outcome.reopenMs<REOPEN_LIMIT_MS);
 });
function prepare(t){
 fs.mkdirSync('.build/store-tests',{recursive:true});
 const directory=fs.mkdtempSync(path.resolve('.build/store-tests/crash-'));
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 return directory;
}
