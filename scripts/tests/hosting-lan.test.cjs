const {test}=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createServer,request}=require('node:http');
const {Access}=require('../../tools/hosting/access.ts');
const {gateway}=require('../../tools/hosting/gateway.ts');
const {setupAddress}=require('../../tools/hosting/address.ts');
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server.address().port)));
const close=server=>new Promise(resolve=>server.close(resolve));

test('setup detects the reachable address without exposing a Docker container IP',()=>{
 const interfaces={Ethernet:[{address:'192.168.1.25',family:'IPv4',internal:false}]};
 const req={headers:{host:'localhost:3010'}};
 assert.equal(setupAddress(req,undefined,interfaces,'win32'),'http://192.168.1.25:3010');
 assert.equal(setupAddress(req,undefined,interfaces,'linux'),'http://localhost:3010');
 assert.equal(setupAddress({headers:{host:'192.168.1.30:8080'}},undefined,interfaces,'linux'),'http://192.168.1.30:8080');
 assert.equal(setupAddress(req,'https://party.example',interfaces,'win32'),'https://party.example');
});

test('legacy credential files remain protected; explicit off persists despite credentials',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lan-migration-')),file=path.join(dir,'access.json');
 try {
  const fresh=new Access(file);await fresh.load();assert.equal(fresh.required,false);
  const browser=await fresh.setRequired(true),steam=await fresh.steam();
  const legacy=JSON.parse(await fs.readFile(file,'utf8'));delete legacy.requirePairing;await fs.writeFile(file,JSON.stringify(legacy));
  const restored=new Access(file);await restored.load();assert.equal(restored.required,true);assert.ok(restored.valid('browsers',browser));
  await restored.setRequired(false);const off=new Access(file);await off.load();assert.equal(off.required,false);assert.ok(off.valid('steam',steam));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('LAN gateway toggles without lockout, forwards API/builds, and guards both loader modes',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lan-gateway-')),file=path.join(dir,'access.json');
 const access=new Access(file);await access.load();
 const upstream=createServer((req,res)=>{res.setHeader('Access-Control-Allow-Origin','*');res.end(JSON.stringify({url:req.url,origin:req.headers.origin,cookie:req.headers.cookie}));});
 const port=await listen(upstream),server=gateway({access,configured:()=>true,dashboardPort:port,apiPort:port,publicUrl:"http://192.168.1.50:3010"});
 const base='http://127.0.0.1:'+await listen(server),lan='http://192.168.1.50:3010';
 const headers={Host:'192.168.1.50:3010',Origin:lan,'Content-Type':'application/json'};
 const post=(route,data,extra={})=>fetch(base+route,{method:'POST',headers:{...headers,...extra},body:JSON.stringify(data)});
 try {
  assert.equal((await fetch(base)).status,200);
  assert.deepEqual(await (await fetch(base+'/setup/state')).json(),{configured:true,requirePairing:false,canConfigureAccount:false,serverAddress:lan});
  assert.equal((await (await post('/setup/steam',{origin:lan})).json()).code,'$.getScript("'+lan+'/CODE/adventure_land/universal-loader.js");');
  assert.equal((await post('/setup/pairing',{requirePairing:'yes'})).status,400);
  assert.equal((await post('/setup/pairing',{requirePairing:true},{Origin:'https://evil.example'})).status,403);
  const forwarded=await (await post('/__dashboard/mode',{mode:'development'})).json();assert.equal(forwarded.origin,'http://127.0.0.1:'+port);
  const game=await post('/party-api/state',{}, {Origin:'https://adventure.land'});assert.equal(game.status,200);assert.equal(game.headers.get('access-control-allow-origin'),'https://adventure.land');
  assert.equal((await post('/party-api/state',{}, {Origin:'https://evil.example'})).status,403);
  const enabled=await post('/setup/pairing',{requirePairing:true});assert.equal(enabled.status,200);
  const Cookie=enabled.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(base+'/setup/state')).status,401);
  assert.equal((await post('/setup/pairing',{requirePairing:false})).status,401);
  assert.equal((await post('/party-api/state',{}, {Origin:'https://adventure.land'})).status,403);
  const code=(await (await post('/setup/steam',{origin:lan},{Cookie})).json()).code,credential=code.match(/bridge\/([a-f0-9]{64})/)[1];
  const bridge='/bridge/'+credential+'/party-api/state';
  assert.equal((await post(bridge,{}, {Origin:'https://adventure.land'})).status,200);
  assert.equal((await post('/setup/pairing',{requirePairing:false},{Cookie})).status,200);
  assert.equal((await fetch(base)).status,200);assert.equal((await fetch(base+bridge)).status,200);
  await post('/setup/revoke',{});assert.equal((await fetch(base+bridge)).status,401);
  const restarted=new Access(file);await restarted.load();assert.equal(restarted.required,false);
 }finally{await close(server);await close(upstream);await fs.rm(dir,{recursive:true,force:true});}
});

test('development upgrades forward bytes and require same-origin authorized browsers',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lan-ws-')),access=new Access(path.join(dir,'access.json'));await access.load();
 const upstream=createServer();upstream.on('upgrade',(req,socket)=>socket.end('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\nhello'));
 const server=gateway({access,configured:()=>true,dashboardPort:await listen(upstream)}),port=await listen(server);
 const upgrade=(Origin,Cookie='')=>new Promise((resolve,reject)=>{
  const req=request({port,host:'127.0.0.1',path:'/__vite_hmr',headers:{Origin,Cookie,Connection:'Upgrade',Upgrade:'websocket'}});
  req.on('upgrade',(res,socket,head)=>{assert.equal(head.toString(),'hello');socket.destroy();resolve(res.statusCode);});req.on('response',res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();
 });
 try {
  assert.equal(await upgrade('http://127.0.0.1:'+port),101);assert.equal(await upgrade('https://evil.example'),403);
  const browser=await access.setRequired(true);assert.equal(await upgrade('http://127.0.0.1:'+port),403);assert.equal(await upgrade('http://127.0.0.1:'+port,'party='+browser),101);
 }finally{await close(server);await close(upstream);await fs.rm(dir,{recursive:true,force:true});}
});

test('pairing cookies authorize LAN HTTP alongside a public HTTPS origin',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lan-cookie-')),access=new Access(path.join(dir,'access.json'));await access.load();
 const server=gateway({access,configured:()=>true,dashboardPort:1,publicUrl:'https://party.example'}),base='http://127.0.0.1:'+await listen(server);
 try {
  const enabled=await fetch(base+'/setup/pairing',{method:'POST',headers:{Origin:base},body:JSON.stringify({requirePairing:true})});
  assert.equal(enabled.status,200);assert.ok(!enabled.headers.get('set-cookie').includes('Secure'));
  const Cookie=enabled.headers.get('set-cookie').split(';')[0];
  const secure=await fetch(base+'/setup/pairing',{method:'POST',headers:{Origin:'https://party.example',Cookie},body:JSON.stringify({requirePairing:true})});
  assert.equal(secure.status,200);assert.ok(secure.headers.get('set-cookie').includes('; Secure'));
 }finally{await close(server);await fs.rm(dir,{recursive:true,force:true});}
});

test('setup omits pairing when off and account setup where unsupported',async()=>{
 const {JSDOM}=require('../../.caracal/node_modules/jsdom'),{setupPage}=require('../../tools/hosting/page.ts');
 for(const state of [{configured:true,requirePairing:false,canConfigureAccount:false},{configured:false,requirePairing:false,canConfigureAccount:true},{configured:true,requirePairing:true,canConfigureAccount:true}]) {
  const dom=new JSDOM(setupPage,{url:'http://lan:3010/setup',runScripts:'dangerously',beforeParse(w){w.fetch=async()=>({ok:true,json:async()=>state});}});
  try {
   await new Promise(resolve=>setImmediate(resolve));
   const el=id=>dom.window.document.getElementById(id);
   assert.equal(el('pair').hidden,true);assert.equal(el('settings').hidden,false);
   assert.equal(el('account').hidden,!state.canConfigureAccount||state.configured);
   assert.equal(el('invite').hidden,!state.requirePairing);assert.equal(el('address').textContent,'http://lan:3010');
  }finally{dom.window.close();}
 }
});
