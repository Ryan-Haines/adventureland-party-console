const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {createHash,webcrypto}=require('node:crypto');
const {JSDOM,ResourceLoader}=require('../../.caracal/node_modules/jsdom');
const jquery=require('../../.caracal/node_modules/jquery');
const {initializeConnection,needsSteamBridge,steamBootstrap,steamBridgeVersion}=require('../../runtime/steam/connection.ts');

test('bridge download retries without another Engage, serializes requests, and respects disposal and manual stops',async()=>{
 const loader=fs.readFileSync('.build/runtime/universal-loader.js','utf8');
 for(const mode of ['recover','dispose','stopped']) {
  const dom=new JSDOM('',{url:'https://adventure.land',runScripts:'dangerously'}),w=dom.window;
  let interval,attempts=0,release,installs=0;
  const code='globalThis.characterInstalled=true;',hash=createHash('sha256').update(code).digest('hex');
  Object.defineProperty(w.crypto,'subtle',{value:webcrypto.subtle});
  Object.assign(w,{TextEncoder,AbortSignal,AbortController,character:{name:'P',ctype:'warrior'},game_log(){},
   setInterval:fn=>{interval=fn;return 1;},clearInterval(){},
   fetch:async url=>{
    if(url.includes('steam-bridge.js')){attempts++;if(attempts===1)throw Error('temporary outage');return new Promise(resolve=>{release=()=>resolve({ok:true,text:async()=>`globalThis.bridgeReady();globalThis.__partySteamBridge={version:${steamBridgeVersion},server:globalThis.__partyServer};`})})}
    return {ok:true,text:async()=>url.includes('manifest.json')?JSON.stringify({schema:1,classes:{warrior:{file:`generated/${hash}/warrior.js`,sha256:hash}}}):code};
   },bridgeReady:()=>installs++});
  const flush=async()=>{for(let n=0;n<10;n++)await new Promise(r=>setImmediate(r));};
  const until=async predicate=>{for(let n=0;n<200&&!predicate();n++)await new Promise(r=>setTimeout(r,10));assert.ok(predicate());};
  try{
   if(mode==='stopped')w.localStorage.setItem('party-code-stopped:P','1');
   w.eval(loader);await flush();assert.equal(attempts,1);
   // WebCrypto completes on a worker thread; event-loop turns are not a deadline.
   if(mode!=='stopped')await until(()=>w.characterInstalled===true);
   interval();interval();await flush();assert.equal(attempts,2);
   if(mode==='dispose')w.__partyCodeLoader.dispose();
   release();await flush();interval();await flush();
   assert.equal(attempts,2);assert.equal(installs,mode==='dispose'?0:1);
   assert.equal(w.characterInstalled,mode==='stopped'?undefined:true);
   if(mode==='stopped'){
    assert.equal(w.localStorage.getItem('party-code-stopped:P'),'1');
    w.localStorage.setItem('party-code-stopped:P','0');interval();await until(()=>w.characterInstalled===true);assert.equal(w.characterInstalled,true);
   }
  }finally{w.__partyCodeLoader?.dispose();w.close();}
 }
});

test('loader URL wins over stale globals and preserves the gateway prefix',()=>{
 const host={__partyServer:'http://old:924',parent:{__partyServer:'http://older:924'},document:{currentScript:{src:'https://pi:3010/bridge/token/CODE/adventure_land/universal-loader.js?_=123#ignored'}}};
 assert.equal(initializeConnection(host),'https://pi:3010/bridge/token');
 assert.equal(host.__partyServer,host.parent.__partyServer);
 for(const host of [{},{parent:{__partyServer:'http://pi:3010/bridge/token/'}},{__partyServer:'http://legacy:924',document:{currentScript:null}}]) {
  const expected=host.__partyServer || host.parent?.__partyServer.replace(/\/$/,'') || 'http://127.0.0.1:924';
  assert.equal(initializeConnection(host),expected);
 }
 assert.equal(needsSteamBridge({realmProtocol:2},'http://pi:924'),true);
 assert.equal(needsSteamBridge({version:3,server:'http://old:924'},'http://pi:924'),true);
 assert.equal(needsSteamBridge({version:3,server:'http://pi:924'},'http://pi:924'),true);
 assert.equal(needsSteamBridge({version:4,server:'http://pi:924'},'http://pi:924'),true);
 assert.equal(needsSteamBridge({version:5,server:'http://pi:924'},'http://pi:924'),true);
 assert.equal(needsSteamBridge({version:steamBridgeVersion,server:'http://pi:924'},'http://pi:924'),false);
});

test('jQuery loads the real bundle, retaining its address through bridge setup and hot reload',async()=>{
 const loader=fs.readFileSync('.build/runtime/universal-loader.js','utf8');
 for(const base of ['http://127.0.0.1:924','http://192.168.1.50:3010','http://pi:3010/bridge/abc']) {
  const scriptRequests=[],requests=[],errors=[],starts=[];
  class Resources extends ResourceLoader {
   fetch(url){scriptRequests.push(url);return Promise.resolve(Buffer.from(loader));}
  }
  const dom=new JSDOM('',{url:'https://adventure.land',runScripts:'dangerously',resources:new Resources()});
  const w=dom.window;
  let interval,revision=1;
  const code=()=>`globalThis.installed=${revision};`;
  const hash=()=>createHash('sha256').update(code()).digest('hex');
  Object.defineProperty(w.crypto,'subtle',{value:webcrypto.subtle});
  Object.assign(w,{TextEncoder,AbortSignal,AbortController,character:{name:'P',ctype:'warrior'},__partyServer:'http://stale:924',
   __partySteamBridge:{realmProtocol:2},game_log:(message,color)=>{if(color==='red')errors.push(message);},
   setInterval:fn=>{interval=fn;return 1;},clearInterval(){},start_runner:(id,source)=>starts.push(source),
   fetch:async url=>{requests.push(url);return {ok:true,text:async()=>url.includes('steam-bridge.js')
    ? `globalThis.bridgeInstalls=(globalThis.bridgeInstalls||0)+1;globalThis.__partySteamBridge={version:${steamBridgeVersion},server:globalThis.__partyServer};`
    :url.includes('manifest.json')?JSON.stringify({schema:1,classes:{warrior:{file:`generated/${hash()}/warrior.js`,sha256:hash()}}}):code()};}});
  const until=async predicate=>{for(let i=0;i<100&&!predicate();i++)await new Promise(r=>setTimeout(r,10));assert.ok(predicate());};
  try {
   w.$=jquery(w);
   w.eval(steamBootstrap(base));
   await until(()=>w.installed===1);
   assert.equal(w.__partyServer,base);assert.equal(w.bridgeInstalls,1);
   assert.ok(scriptRequests[0].startsWith(base+'/CODE/adventure_land/universal-loader.js?'));
   assert.ok(requests.every(url=>url.startsWith(base+'/CODE/adventure_land/')));
   revision=2;interval();await until(()=>starts.length===1);
   assert.equal(starts[0],steamBootstrap(base));
   w.eval(starts[0]);await until(()=>w.installed===2);
   assert.equal(w.bridgeInstalls,1);
   w.localStorage.setItem('party-code-stopped:P','1');
   const before=requests.length;interval();await new Promise(r=>setImmediate(r));assert.equal(requests.length,before);
   assert.deepEqual(errors,[]);
  } finally {w.__partyCodeLoader?.dispose();w.close();}
 }
});
