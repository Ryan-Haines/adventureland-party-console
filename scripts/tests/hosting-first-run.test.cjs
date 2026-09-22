const {test}=require('node:test'),assert=require('node:assert/strict');
const {createServer}=require('node:http'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {Access}=require('../../tools/hosting/access.ts');
const {gateway}=require('../../tools/hosting/gateway.ts');
const {verifyFirstRun}=require('../../tools/release/verify-startup.ts');
const {protectInternalServer,gatewayHeaders,dashboardReadyMessage}=require('../../tools/dashboard/gateway-access.ts');
const listen=s=>new Promise(r=>s.listen(0,'127.0.0.1',()=>r(s.address().port)));
const close=s=>new Promise(r=>{s.closeAllConnections();s.close(r);});

test('fresh packaged installation redirects internal ports through public setup, then serves the configured dashboard',async()=>{
 const saved={url:process.env.AL_DASHBOARD_GATEWAY_URL,token:process.env.AL_DASHBOARD_GATEWAY_TOKEN};
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'first-run-'));
 const access=new Access(path.join(dir,'access.json'));await access.load();
 let configured=false,loads=0;
 const app=createServer((req,res)=>{loads++;res.end('dashboard');});protectInternalServer(app);
 const appPort=await listen(app);
 const publicServer=gateway({access,configured:()=>configured,configure:async()=>{configured=true;},dashboardPort:appPort,
  updates:{async route(req,res){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({managed:true,current:'1.0.2'}));}}});
 const base='http://127.0.0.1:'+await listen(publicServer),internal='http://127.0.0.1:'+appPort;
 process.env.AL_DASHBOARD_GATEWAY_URL=base;process.env.AL_DASHBOARD_GATEWAY_TOKEN='test-proxy-token';
 try {
  await verifyFirstRun(base,internal);
  for(const route of ['/','/setup','/console-update']){
   const reply=await fetch(internal+route,{redirect:'manual'});
   assert.equal(reply.status,302);assert.equal(reply.headers.get('location'),base+route);
  }
  const page=await fetch(internal+'/',{headers:{Cookie:'party=old-installation-cookie'}});
  assert.equal(page.url,base+'/setup');assert.equal(page.status,200);assert.equal(loads,0);
  assert.equal((await (await fetch(base+'/setup/state')).json()).configured,false);
  const unavailable=await fetch(base+'/party-api/dashboard-state');
  assert.equal(unavailable.status,503);assert.equal((await unavailable.json()).setupUrl,'/setup');
  assert.equal((await (await fetch(internal+'/console-update')).json()).managed,true);
  const post=await fetch(internal+'/setup/account',{method:'POST',body:'{}',redirect:'manual'});
  assert.equal(post.status,409,'never silently replay a mutation across origins');
  const forged=await fetch(internal+'//evil.example/setup',{redirect:'manual'});
  assert.equal(new URL(forged.headers.get('location')).origin,base);
  const health=await fetch(internal+'/',{headers:gatewayHeaders()});assert.equal(await health.text(),'dashboard');
  configured=true;
  await assert.rejects(verifyFirstRun(base,internal), /true !== false/);
  const ready=await fetch(internal+'/');assert.equal(ready.url,base+'/');assert.equal(await ready.text(),'dashboard');
  assert.equal(dashboardReadyMessage('production',appPort),'Party Console ready. Open '+base+' (first-time installations continue to setup).');
 }finally{
  await close(publicServer);await close(app);await fs.rm(dir,{recursive:true,force:true});
  for(const [key,value]of [['AL_DASHBOARD_GATEWAY_URL',saved.url],['AL_DASHBOARD_GATEWAY_TOKEN',saved.token]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}
 }
});

test('standalone development dashboard does not redirect without a public gateway',async()=>{
 const {redirectInternal}=require('../../tools/dashboard/gateway-access.ts');
 assert.equal(redirectInternal({method:'GET',headers:{},url:'/'},{writeHead(){assert.fail();}}),false);
 assert.match(dashboardReadyMessage('development',3010),/http:\/\/127.0.0.1:3010/);
});
