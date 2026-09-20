const test = require('node:test');
const assert = require('node:assert/strict');
const {startRecovery, recoveryDelay, probeDashboard, clearRecoveryHistory, recoveryStoragePrefix} = require('../../dashboard/lib/dashboard-recovery.ts');
function fixture(probe = async () => null, claimed = () => false) {
  let now = 0, sequence = 0;
  const timers = new Map(), attempts = [], statuses = [], reloads = [], claims = [];
  const recovery = startRecovery({now:()=>now,
    later(fn, ms) { const id=++sequence; timers.set(id,{at:now+ms,fn}); return id; },
    cancel:id=>timers.delete(id),
    probe:signal=>{attempts.push(now);return probe(signal);}, claimed,
    claim:id=>claims.push(id), reload:()=>reloads.push(now), update:s=>statuses.push(s)});
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
test('ten one-second attempts then doubling to a sixty-second cap with countdown',async()=>{
  assert.deepEqual(Array.from({length:18},(_,i)=>recoveryDelay(i)),[...Array(10).fill(1000),2000,4000,8000,16000,32000,60000,60000,60000]);
  const f=fixture(); await f.advance(10000);
  assert.deepEqual(f.attempts,Array.from({length:10},(_,i)=>(i+1)*1000));
  assert.equal(f.statuses.at(-1).seconds,2);
  await f.advance(1000);assert.equal(f.statuses.at(-1).seconds,1);
  await f.advance(1000);assert.equal(f.attempts.at(-1),12000);
  assert.equal(f.statuses.at(-1).seconds,4);f.recovery.dispose();
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
test('requests timeout without overlap and cleanup aborts the active probe',async()=>{
  let aborted=0;
  const f=fixture(signal=>new Promise((_,reject)=>signal.addEventListener('abort',()=>{aborted++;reject(Error('timeout'));})));
  await f.advance(5000);assert.equal(f.attempts.length,1);
  f.recovery.retry();assert.equal(f.attempts.length,1);
  await f.advance(1000);assert.equal(aborted,1);
  await f.advance(1000);assert.equal(f.attempts.length,2);
  f.recovery.dispose();await f.advance(100000);assert.equal(aborted,2);assert.equal(f.timers.size,0);
});
test('manual retry checks immediately and restarts the one-second schedule',async()=>{
  const f=fixture();await f.advance(12000);f.recovery.retry();await f.advance(0);
  assert.equal(f.statuses.at(-1).seconds,1);await f.advance(1000);assert.equal(f.attempts.at(-1),13000);
  f.recovery.dispose();
});
test('probe requires readiness, valid HTML, and the same ready instance after checking the page',async()=>{
  const ready={ready:true,busy:false,error:null,instance:'a'};
  async function run(states,page= new Response('ok',{headers:{'content-type':'text/html'}})) {
    let calls=0;const fetcher=async url=>{calls++;return url==='/__dashboard/state'?Response.json(states.shift()):page;};
    const result=await probeDashboard(fetcher,'/',new AbortController().signal,undefined,true);return {result,calls};
  }
  assert.deepEqual(await run([{...ready,busy:true}]),{result:null,calls:1});
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

test('error recovery accepts a working dashboard when supervisor reports a failed build or is unavailable',async()=>{
  for(const supervisor of [()=>Response.json({ready:false,busy:false,error:'build failed',instance:'old'}),
    ()=>new Response('not found',{status:404}),()=>Response.json({ready:false,busy:true,instance:'old'})]) {
    const fetcher=async url=>url==='/__dashboard/state'?supervisor():new Response('working dashboard',{headers:{'content-type':'text/html'}});
    assert.ok(await probeDashboard(fetcher,'/',new AbortController().signal));
    assert.equal(await probeDashboard(fetcher,'/',new AbortController().signal,undefined,true),null,
      'requested rebuild still waits for the new build');
  }
});

test('countdown displays every backoff stage in order without racing through retries',async()=>{
  const f=fixture();await f.advance(132000);
  assert.deepEqual(f.attempts,[...Array.from({length:10},(_,i)=>(i+1)*1000),12000,16000,24000,40000,72000,132000]);
  assert.equal(f.statuses.at(-1).seconds,60);f.recovery.dispose();
});
