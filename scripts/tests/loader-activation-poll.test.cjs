const {test}=require('node:test');
const assert=require('node:assert/strict');
const {loaderWindow,loaderSource,manifestFor,sha}=require('./fixtures/loader-scenario.cjs');

// H2 failure modes (docs/efficiency.md § Requests and logs):
// 1. the loader asks for activation.json every 2 s while the host has none (a 404 each time);
// 2. the loader ignores an activation the host publishes later, or adopts it a tick late;
// 3. the loader stops asking a host that does not report its activation for the record;
// 4. the console-deployment poll, its maintenance hold, or the startup manifest load change.
function loader(host){
 const requests=[];
 // Each kept bound's timeout signal, which a row aborts to trip it (loaderFetchMs, loaderLeaseFetchMs).
 const bounds=[];
 const TimedSignal=new Proxy(AbortSignal,{get:(target,key)=>key==='timeout'?ms=>{const c=new AbortController();bounds.push({ms,trip:()=>c.abort(new DOMException('bound','TimeoutError'))});return c.signal;}:Reflect.get(target,key)});
 const code=revision=>`globalThis.installed=${JSON.stringify(revision)};`,hash=revision=>sha(code(revision));
 const manifest=revision=>manifestFor(code(revision));
 const l=loaderWindow({globals:{AbortSignal:TimedSignal,caracAL:{}},fetch:async(url,init)=>{
   const name=new URL(url).pathname.split('/').pop();requests.push(name);
   // `host.hang` names a request the coordinator never answers; only its signal ends it.
   if(host.hang===name)return new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason)));
   if(name==='console-deployment')return {ok:true,json:async()=>({serverNow:Date.now(),consoleMaintenance:host.maintenance||null,...('activation' in host?{activation:host.activation}:{})})};
   if(name==='activation.json')return host.record?{ok:true,status:200,text:async()=>JSON.stringify({id:host.record,manifest:manifest(host.record)})}:{ok:false,status:404,text:async()=>''};
   if(name==='manifest.json')return {ok:true,status:200,text:async()=>JSON.stringify(manifest('startup'))};
   const revision=[host.record,'startup'].find(value=>value&&url.includes(hash(value)));
   return {ok:true,status:200,text:async()=>code(revision)};
  }});
 l.w.eval(loaderSource());
 const tick=async()=>{l.interval();for(let n=0;n<20;n++)await new Promise(r=>setImmediate(r));};
 return {w:l.w,requests,until:l.until,tick,bounds,count:name=>requests.filter(value=>value===name).length};
}

test('a host without an activation record is not asked for it; a later record is adopted in the same tick',async()=>{
 const host={activation:null};
 const l=loader(host);
 try{
  await l.until(()=>l.w.installed==='startup');
  await l.tick();
  const before=l.count('activation.json'),control=l.count('console-deployment');
  for(let i=0;i<5;i++)await l.tick();
  assert.equal(l.count('activation.json'),before,'no activation.json polls while the host has none');
  assert.equal(l.count('console-deployment'),control+5,'the control poll keeps its 2 s cadence');
  host.activation='lease-1';host.record='lease-1';
  await l.tick();
  await l.until(()=>l.w.installed==='lease-1');
  assert.equal(l.count('activation.json'),before+1);
 }finally{l.w.__partyCodeLoader?.dispose();l.w.close();}
});

test('a host that does not report its activation is asked for the record on every tick, as before',async()=>{
 const l=loader({});
 try{
  await l.until(()=>l.w.installed==='startup');
  await l.tick();
  const before=l.count('activation.json');
  for(let i=0;i<3;i++)await l.tick();
  assert.equal(l.count('activation.json'),before+3);
 }finally{l.w.__partyCodeLoader?.dispose();l.w.close();}
});

test('a host with an activation record keeps being asked for it, and maintenance still arrives',async()=>{
 const host={activation:'lease-1',record:'lease-1',maintenance:{id:'hold',expires:Date.now()+60000}};
 const l=loader(host);
 try{
  await l.until(()=>l.w.installed==='lease-1');
  await l.tick();
  const before=l.count('activation.json');
  for(let i=0;i<3;i++)await l.tick();
  assert.equal(l.count('activation.json'),before+3);
  assert.equal(l.w.__partyConsoleMaintenance.id,'hold');
 }finally{l.w.__partyCodeLoader?.dispose();l.w.close();}
});

// loaderFetchMs and loaderLeaseFetchMs (lifecycle/fields.ts, bigcheck/bounds.md): a coordinator that
// never answers the deployment poll or a CODE file request ends at the request's kept bound, and the
// firing waits in the frame's bound queue (status/character/bounds.ts) for the next status report.
test('a request the coordinator never answers ends at its kept bound and queues the firing',async()=>{
 const host={activation:'lease-1',record:'lease-1'};
 const l=loader(host);
 try{
  await l.until(()=>l.w.installed==='lease-1');
  host.hang='console-deployment';await l.tick();
  // The coordinator answers again before the next stall, so the poll that follows is not left hanging.
  l.bounds.filter(b=>b.ms===3000).at(-1).trip();host.hang=null;await l.tick();
  host.hang='activation.json';await l.tick();
  l.bounds.filter(b=>b.ms===6000).at(-1).trip();await l.tick();
  // The bounds owner queues each firing on the window's global for the next report (status/character/bounds.ts).
  const fired=Array.from(l.w.__partyBoundQueue.firings,f=>[f.bound,f.owner,f.state.what]);
  assert.deepEqual(fired.filter(f=>f[0]==='loaderLeaseFetchMs'),[['loaderLeaseFetchMs','13','console-deployment']]);
  assert.deepEqual(fired.filter(f=>f[0]==='loaderFetchMs'),[['loaderFetchMs','13','activation.json']]);
 }finally{l.w.__partyCodeLoader?.dispose();l.w.close();}
});
