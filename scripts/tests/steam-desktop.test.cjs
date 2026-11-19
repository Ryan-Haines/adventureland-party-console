const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {SteamPreferenceStore,assertLocalSteam}=require('../../tools/steam/preferences.ts');
const {LocalSteam}=require('../../tools/steam/service.ts');
const {automationEnvironment,libraryPaths}=require('../../tools/steam/platform.ts');
const {windowsTargets,linuxTargets,Inspector}=require('../../tools/steam/inspector.ts');
const {steamClientSetup}=require('../../dashboard/features/party/steam-client-setup.ts');
const {WebSocketServer}=require('../../.caracal/node_modules/ws');
const {createServer}=require('node:http');
const {gateway}=require('../../tools/hosting/gateway.ts');

test('setup preferences survive restart; remote, browser and unknown placement cannot launch',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'steam-desktop-'));
 try {
  const store=new SteamPreferenceStore(dir);assert.equal(await store.read(),null);
  await store.save({placement:'remote',client:'windows-steam'});
  const saved=await new SteamPreferenceStore(dir).read();assert.throws(()=>assertLocalSteam(saved,'win32'),/different PC/);
  assert.throws(()=>assertLocalSteam(null,'win32'),/setup/);
  assert.throws(()=>assertLocalSteam({placement:'same',client:'linux-steam'},'win32'),/matching/);
  assert.throws(()=>assertLocalSteam({placement:'same',client:'windows-browser'},'win32'),/matching/);
  assert.doesNotThrow(()=>assertLocalSteam({placement:'same',client:'linux-steam'},'linux'));
  await assert.rejects(store.save({placement:'unknown',client:'windows-steam'}),/Choose/);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('existing browser setup migrates without changing unrelated action data',()=>{
 const body={action:'primary',character:'QwenTina'},saved={placement:'remote',client:'linux-steam',https:true};
 assert.deepEqual(steamClientSetup(body,{getItem:()=>JSON.stringify(saved)}),{...body,clientSetup:{placement:'remote',client:'linux-steam'}});
 assert.equal(steamClientSetup(body,{getItem:()=>'{bad'}),body);
});
// The saved preferences, the setup page and the dashboard's first-use carry read
// tools/steam/clients.ts, the dashboard through runtime/lifecycle/api.ts, so a client added there is
// accepted by all three.
test('a Steam client added to the one client list is accepted by every setup reader',async()=>{
 const {STEAM_CLIENTS}=require('../../tools/steam/clients.ts'),{parsePreferences}=require('../../tools/steam/preferences.ts');
 STEAM_CLIENTS.push({value:'test-client',label:'Test client'});
 let dom;
 try{
  assert.deepEqual(parsePreferences({placement:'same',client:'test-client'}),{placement:'same',client:'test-client'});
  assert.deepEqual(steamClientSetup({action:'primary'},{getItem:()=>JSON.stringify({placement:'same',client:'test-client'})}),{action:'primary',clientSetup:{placement:'same',client:'test-client'}});
  // A fresh instance of page.ts builds its page from the list as it is now.
  const {JSDOM}=require('../../.caracal/node_modules/jsdom'),{pathToFileURL}=require('node:url');
  const {setupPage}=await import(pathToFileURL(require.resolve('../../tools/hosting/page.ts')).href+'?client=test-client');
  dom=new JSDOM(setupPage,{url:'http://lan:3010/setup?placement=same&client=test-client',runScripts:'dangerously',beforeParse(w){w.fetch=async()=>({ok:true,json:async()=>({configured:true})});}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(dom.window.document.getElementById('client').value,'test-client');
 }finally{dom?.window.close();STEAM_CLIENTS.pop();}
});
test('platform launches enable loopback-only inspectors without changing global environment',()=>{
 const env={PATH:'test'};assert.match(automationEnvironment('win32',env).WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS,/address=127.0.0.1/);
 assert.equal(automationEnvironment('linux',env).WEBKIT_INSPECTOR_HTTP_SERVER,'127.0.0.1:19245');assert.deepEqual(env,{PATH:'test'});
 assert.deepEqual(libraryPaths('"path" "D:\\\\SteamLibrary"'),['D:\\SteamLibrary']);
});
test('Windows and native Linux discovery select only game pages on local inspector sockets',()=>{
 assert.deepEqual(windowsTargets([{type:'page',url:'https://example.com',webSocketDebuggerUrl:'ws://evil/'}]),[]);
 assert.throws(()=>windowsTargets([{type:'page',url:'https://adventure.land/',webSocketDebuggerUrl:'ws://remote:19245/a'}]),/this computer/);
 const html=`<table><tr><td><div class="targeturl">https://adventure.land/</div></td><td onclick="window.open('Main.html?ws=' + window.location.host + '/socket/7/42/WebPage')"></td></tr></table>`;
 assert.deepEqual(linuxTargets(html),[{url:'https://adventure.land/',socket:'ws://127.0.0.1:19245/socket/7/42/WebPage'}]);
 assert.deepEqual(linuxTargets(html.replace('https://adventure.land/','https://example.com/')),[]);
});
function fixture(overrides={}) {
 let now=0,ready=false,pages=[],launched=0,attached=0,bridge=null;
 const calls=[];
 const preferences={read:async()=>({placement:'same',client:'windows-steam'})};
 const target={url:'https://adventure.land/',socket:'ws://127.0.0.1:19245/game'};
 const ports={platform:'win32',targets:async()=>pages,executable:async()=>'/game',running:async()=>false,
  launch:async()=>{launched++;pages=[target];},connect:async()=>({evaluate:async expression=>{calls.push(expression);if(expression.includes('X.characters')){if(bridge)ready=true;return{bridge};}attached++;ready=true;return true;},close(){}}),
  bridgeReady:async()=>ready,server:async()=>'http://127.0.0.1:3010/bridge/test',source:async()=>'/* bridge */',now:()=>now,sleep:async ms=>{now+=ms},...overrides};
 const service=new LocalSteam(preferences,ports);
 return {service,ports,preferences,calls,target,setPages:value=>pages=value,setReady:value=>ready=value,setBridge:value=>bridge=value,counts:()=>({launched,attached})};
}
test('cold launch attaches before reporting ready and never performs a game login itself',async()=>{
 const f=fixture();try{await f.service.ensure('QwenTina');assert.deepEqual(f.counts(),{launched:1,attached:1});assert.match(f.calls[0],/X\.characters\.some/);assert.doesNotMatch(f.calls[0],/location.href\s*=/);}finally{f.service.stop();}
});
test('already running inspectable client attaches without launching again',async()=>{
 const f=fixture();f.setPages([f.target]);try{await f.service.ensure('QwenTina');assert.deepEqual(f.counts(),{launched:0,attached:1});}finally{f.service.stop();}
});
// The desktop asks roster/connection.ts's rule, so a current bridge the CODE loader put in place
// stays, and a bridge of another server is replaced.
test('the desktop keeps a current bridge and replaces one of another server',async()=>{
 const {steamBridgeVersion}=require('../../runtime/lifecycle/roster/connection.ts');
 const f=fixture();f.setPages([f.target]);f.setBridge({version:steamBridgeVersion,server:'http://127.0.0.1:3010/bridge/test'});
 try{await f.service.ensure('QwenTina');assert.deepEqual(f.counts(),{launched:0,attached:0});}finally{f.service.stop();}
 const g=fixture();g.setPages([g.target]);g.setBridge({version:steamBridgeVersion,server:'http://127.0.0.1:924'});
 try{await g.service.ensure('QwenTina');assert.deepEqual(g.counts(),{launched:0,attached:1});}finally{g.service.stop();}
});
test('already running ordinary client returns actionable error without duplicate launch',async()=>{
 const f=fixture({running:async()=>true});try{await assert.rejects(f.service.ensure('QwenTina'),/Close it once/);assert.deepEqual(f.counts(),{launched:0,attached:0});}finally{f.service.stop();}
});
test('remote setup fails before process discovery but an existing remote bridge remains usable',async()=>{
 const f=fixture({executable:async()=>{throw Error('must not discover')}});f.preferences.read=async()=>({placement:'remote',client:'windows-steam'});
 try{await assert.rejects(f.service.ensure('QwenTina'),/different PC/);f.setReady(true);await f.service.ensure('QwenTina');assert.deepEqual(f.counts(),{launched:0,attached:0});}finally{f.service.stop();}
});
test('signed-out client times out without headless mutation; multiple windows are rejected',async()=>{
 const f=fixture({connect:async()=>({evaluate:async()=>false,close(){}})});
 try{await assert.rejects(f.service.ensure('QwenTina'),/Sign in/);assert.equal(f.counts().launched,1);}finally{f.service.stop();}
 const g=fixture();g.setPages([g.target,g.target]);try{await assert.rejects(g.service.ensure('QwenTina'),/Multiple/);assert.equal(g.counts().launched,0);}finally{g.service.stop();}
});
test('concurrent desktop requests cannot launch two clients',async()=>{
 let finish;const f=fixture({bridgeReady:()=>new Promise(resolve=>finish=resolve)});
 const first=f.service.ensure('QwenTina');assert.throws(()=>f.service.ensure('Other'),/in progress/);finish(true);await first;f.service.stop();
});
for(const nested of [false,true])test(`inspector evaluates through ${nested?'WebKit target messages':'CDP'} and closes pending requests`,async()=>{
 const server=new WebSocketServer({port:0,host:'127.0.0.1'});await new Promise(resolve=>server.once('listening',resolve));
 server.on('connection',socket=>{
  if(nested)socket.send(JSON.stringify({method:'Target.targetCreated',params:{targetInfo:{targetId:'page-1'}}}));
  socket.on('message',raw=>{
   const message=JSON.parse(String(raw));
   if(message.method==='Target.sendMessageToTarget'){
    socket.send(JSON.stringify({id:message.id,result:{}}));const inner=JSON.parse(message.params.message);
    socket.send(JSON.stringify({method:'Target.dispatchMessageFromTarget',params:{message:JSON.stringify({id:inner.id,result:{result:{value:42}}})}}));
   }else socket.send(JSON.stringify({id:message.id,result:{result:{value:42}}}));
  });
 });
 let connection;try{connection=await Inspector.connect({url:'https://adventure.land/',socket:`ws://127.0.0.1:${server.address().port}`});await new Promise(resolve=>setImmediate(resolve));assert.equal(await connection.evaluate('21*2'),42);}finally{connection?.close();await new Promise(resolve=>server.close(resolve));}
});

test('authorized gateway forwards ownership mutation only after desktop readiness and rejects remote launch',async()=>{
 const events=[];let fail=false;
 const upstream=createServer((req,res)=>{
  res.setHeader('Content-Type','application/json');
  if(req.url.startsWith('/party-api/state'))res.end(JSON.stringify({roster:[{name:'QwenTina'}],steamSwitch:{phase:'complete'}}));
  else{events.push('ownership');res.end(JSON.stringify({ok:true}));}
 });
 await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
 const server=gateway({configured:()=>true,access:{required:false},dashboardPort:1,apiPort:upstream.address().port,
  steam:{preferences:{save:async value=>{events.push(value.placement)}},ensure:async()=>{events.push('ready');if(fail)throw Error('Unable to start Steam client from a different PC.')}}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`;
 const post=body=>fetch(origin+'/party-api/steam/action',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
 try {
  const input={action:'primary',character:'QwenTina',clientSetup:{placement:'same',client:'windows-steam'}};
  assert.equal((await post(input)).status,200);assert.deepEqual(events,['same','ready','ownership']);
  events.length=0;fail=true;input.clientSetup.placement='remote';
  const response=await post(input);assert.equal(response.status,400);assert.match((await response.json()).error,/different PC/);assert.deepEqual(events,['remote','ready']);
  events.length=0;input.character='NotOwned';assert.equal((await post(input)).status,400);assert.ok(!events.includes('ready')&&!events.includes('ownership'));
 }finally{server.closeAllConnections();upstream.closeAllConnections();await Promise.all([new Promise(r=>server.close(r)),new Promise(r=>upstream.close(r))]);}
});
