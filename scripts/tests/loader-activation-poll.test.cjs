const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {createHash,webcrypto}=require('node:crypto');
const {JSDOM}=require('../../.caracal/node_modules/jsdom');

// H2 failure modes (docs/efficiency.md § Requests and logs):
// 1. the loader asks for activation.json every 2 s while the host has none (a 404 each time);
// 2. the loader ignores an activation the host publishes later, or adopts it a tick late;
// 3. the loader stops asking a host that does not report its activation for the record;
// 4. the console-deployment poll, its maintenance hold, or the startup manifest load change.
function loader(host){
 const source=fs.readFileSync('.build/runtime/universal-loader.js','utf8');
 const dom=new JSDOM('',{url:'https://adventure.land',runScripts:'dangerously'}),w=dom.window;
 const requests=[];let interval;
 const code=revision=>`globalThis.installed=${JSON.stringify(revision)};`,hash=revision=>createHash('sha256').update(code(revision)).digest('hex');
 const manifest=revision=>({schema:1,classes:{warrior:{file:`generated/${hash(revision)}/warrior.js`,sha256:hash(revision)}}});
 Object.defineProperty(w.crypto,'subtle',{value:webcrypto.subtle});
 Object.assign(w,{TextEncoder,AbortSignal,AbortController,character:{name:'P',ctype:'warrior'},game_log(){},caracAL:{},
  setInterval:fn=>{interval=fn;return 1;},clearInterval(){},
  fetch:async url=>{
   const name=new URL(url).pathname.split('/').pop();requests.push(name);
   if(name==='console-deployment')return {ok:true,json:async()=>({serverNow:Date.now(),consoleMaintenance:host.maintenance||null,...('activation' in host?{activation:host.activation}:{})})};
   if(name==='activation.json')return host.record?{ok:true,status:200,text:async()=>JSON.stringify({id:host.record,manifest:manifest(host.record)})}:{ok:false,status:404,text:async()=>''};
   if(name==='manifest.json')return {ok:true,status:200,text:async()=>JSON.stringify(manifest('startup'))};
   const revision=[host.record,'startup'].find(value=>value&&url.includes(hash(value)));
   return {ok:true,status:200,text:async()=>code(revision)};
  }});
 w.eval(source);
 const until=async predicate=>{for(let i=0;i<200&&!predicate();i++)await new Promise(r=>setTimeout(r,10));assert.ok(predicate());};
 const tick=async()=>{interval();for(let n=0;n<20;n++)await new Promise(r=>setImmediate(r));};
 return {w,requests,until,tick,count:name=>requests.filter(value=>value===name).length};
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
