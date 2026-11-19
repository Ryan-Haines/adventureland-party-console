const test = require('node:test');
const assert = require('node:assert/strict');
const {startRecovery, recoveryDelay, probeDashboard, clearRecoveryHistory, clearWhenUp, recoveryStoragePrefix} = require('../../dashboard/lib/dashboard-recovery.ts');
// The probe times for `count` failed probes in a row: each waits recoveryDelay of the failures before it.
const schedule = count => Array.from({length:count},(_,i)=>Array.from({length:i+1},(_,k)=>recoveryDelay(k)).reduce((a,b)=>a+b));
function fixture(probe = async () => null, claimed = () => false, claim = null) {
  let now = 0, sequence = 0;
  const timers = new Map(), attempts = [], statuses = [], reloads = [], claims = [];
  const recovery = startRecovery({now:()=>now,
    later(fn, ms) { const id=++sequence; timers.set(id,{at:now+ms,fn}); return id; },
    cancel:id=>timers.delete(id),
    probe:signal=>{attempts.push(now);return probe(signal);}, claimed,
    claim:id=>claim ? claim(id) : claims.push(id), reload:()=>reloads.push(now), update:s=>statuses.push(s)});
  async function advance(ms) {
    const end=now+ms;
    while (true) {
      const next=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];
      if(!next) break;
      now=next[1].at; timers.delete(next[0]); next[1].fn();
      for(let i=0;i<8;i++) await Promise.resolve();
    }
    now=end;
  }
  return {recovery,advance,attempts,statuses,reloads,claims,timers};
}
test('each failed probe doubles the delay from one second to a sixty-second cap with countdown',async()=>{
  assert.deepEqual(Array.from({length:8},(_,i)=>recoveryDelay(i)),[1000,2000,4000,8000,16000,32000,60000,60000]);
  const f=fixture(); await f.advance(schedule(3).at(-1));
  assert.deepEqual(f.attempts,schedule(3));
  assert.equal(f.statuses.at(-1).seconds,8);
  await f.advance(1000);assert.equal(f.statuses.at(-1).seconds,7);
  f.recovery.dispose();
});
test('healthy server reloads once and stops polling',async()=>{
  const f=fixture(async()=> 'v1');await f.advance(10000);
  assert.deepEqual(f.claims,['v1']);assert.equal(f.reloads.length,1);assert.equal(f.attempts.length,1);
});
test('repeated render failure waits for another instance; manual retry overrides the guard',async()=>{
  let instance='v1';const f=fixture(async()=>instance,id=>id==='v1');
  await f.advance(1000);assert.equal(f.statuses.at(-1).blocked,true);assert.equal(f.reloads.length,0);
  instance='v2';await f.advance(1000);assert.deepEqual(f.claims,['v2']);
  const manual=fixture(async()=> 'v1',()=>true);await manual.advance(1000);
  manual.recovery.retry();await manual.advance(0);assert.equal(manual.reloads.length,1);
});
test('a storage that refuses the claim shows the manual reload instead of probing on',async()=>{
  const f=fixture(async()=> 'v1',()=>false,()=>{throw Error('quota');});
  await f.advance(1000);
  assert.equal(f.reloads.length,0);assert.equal(f.statuses.at(-1).blocked,true);
  f.recovery.retry();await f.advance(0);assert.equal(f.reloads.length,1);
});
test('requests timeout without overlap and cleanup aborts the active probe',async()=>{
  let aborted=0;
  const f=fixture(signal=>new Promise((_,reject)=>signal.addEventListener('abort',()=>{aborted++;reject(Error('timeout'));})));
  await f.advance(5000);assert.equal(f.attempts.length,1);
  f.recovery.retry();assert.equal(f.attempts.length,1);
  await f.advance(1000);assert.equal(aborted,1);assert.equal(f.statuses.at(-1).timedOut,true);
  await f.advance(2000);assert.equal(f.attempts.length,2);
  f.recovery.dispose();await f.advance(100000);assert.equal(aborted,2);assert.equal(f.timers.size,0);
});
test('manual retry checks immediately and restarts the one-second schedule',async()=>{
  const f=fixture();await f.advance(12000);f.recovery.retry();await f.advance(0);
  assert.equal(f.statuses.at(-1).seconds,1);await f.advance(1000);assert.equal(f.attempts.at(-1),13000);
  f.recovery.dispose();
});
test('probe requires valid HTML and the same instance after checking the page',async()=>{
  const ready={ready:true,busy:false,error:null,instance:'a'};
  async function run(states,page= new Response('ok',{headers:{'content-type':'text/html'}})) {
    let calls=0;const fetcher=async url=>{calls++;return url==='/__dashboard/state'?Response.json(states.shift()):page;};
    const result=await probeDashboard(fetcher,'/',new AbortController().signal);return {result,calls};
  }
  assert.equal((await run([ready,ready])).result,'a');
  assert.equal((await run([ready,{...ready,instance:'b'}])).result,null);
  assert.equal((await run([ready],new Response('error',{status:500}))).result,null);
  assert.equal((await run([ready],Response.json({error:'starting'}))).result,null);
});

test('successful dashboard recovery clears old guards so later errors can recover on the same server',async()=>{
  const data=new Map([[recoveryStoragePrefix+'v1','1'],['unrelated-setting','keep']]);
  const storage={get length(){return data.size;},key:i=>[...data.keys()][i],removeItem:key=>data.delete(key)};
  const f=fixture(async()=> 'v1',id=>data.has(recoveryStoragePrefix+id));
  await f.advance(20000);
  assert.equal(f.reloads.length,0);
  assert.equal(f.statuses.at(-1).seconds,1,'healthy-but-blocked checks must not escalate backoff');
  clearRecoveryHistory(storage);
  assert.equal(data.get('unrelated-setting'),'keep');
  await f.advance(1000);assert.equal(f.reloads.length,1);
});

// The page used to clear the guard 10 s after it mounted, whether or not the dashboard had loaded,
// so a render error after a slow first status read reloaded in a loop. The guard now clears on
// the first committed render with a successful status read.
test('the render-loop guard holds until the page is up, then clears once',()=>{
  const data=new Map([[recoveryStoragePrefix+'v1','1'],['unrelated-setting','keep']]);
  let reads=0;
  const storage={get length(){return data.size;},key:i=>[...data.keys()][i],removeItem:key=>data.delete(key)};
  const up=clearWhenUp(()=>{reads++;return storage;});
  up(false);up(false);
  assert.equal(data.has(recoveryStoragePrefix+'v1'),true,'a page without a status read keeps the guard');
  up(true);
  assert.equal(data.has(recoveryStoragePrefix+'v1'),false);assert.equal(data.get('unrelated-setting'),'keep');
  data.set(recoveryStoragePrefix+'v2','1');up(false);up(true);
  assert.equal(data.has(recoveryStoragePrefix+'v2'),true,'the page clears once per load');assert.equal(reads,1);
  assert.doesNotThrow(()=>clearWhenUp(()=>{throw new Error('storage disabled');})(true));
});

test('error recovery accepts a working dashboard when supervisor reports a failed build or is unavailable',async()=>{
  for(const supervisor of [()=>Response.json({ready:false,busy:false,error:'build failed',instance:'old'}),
    ()=>new Response('not found',{status:404}),()=>Response.json({ready:false,busy:true,instance:'old'})]) {
    const fetcher=async url=>url==='/__dashboard/state'?supervisor():new Response('working dashboard',{headers:{'content-type':'text/html'}});
    assert.ok(await probeDashboard(fetcher,'/',new AbortController().signal));
  }
});

test('countdown displays every backoff stage in order without racing through retries',async()=>{
  const f=fixture();await f.advance(schedule(7).at(-1));
  assert.deepEqual(f.attempts,schedule(7));
  assert.equal(f.statuses.at(-1).seconds,60);f.recovery.dispose();
});
