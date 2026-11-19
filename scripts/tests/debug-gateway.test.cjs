// The debug instance's gateway (tools/debug/gateway.ts) on its own: hosting.test.cjs loads the game
// client files for its other rows, which this row needs none of.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {Access}=require('../../tools/hosting/access.ts');
const {debugGateway}=require('../../tools/debug/gateway.ts');

// The gateway proxies to the ports instance.mts starts its children on.
test('the debug gateway reaches the coordinator on the port its instance names',async()=>{
 const coordinator=http.createServer((req,res)=>{
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(req.url==='/party-api/apps/verify'?{ok:true}:{path:req.url}));
 });
 await new Promise(resolve=>coordinator.listen(0,'127.0.0.1',resolve));const apiPort=coordinator.address().port;
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'party-debug-gateway-')),a=new Access(path.join(dir,'access.json'));await a.load();
 const token='a'.repeat(64),server=debugGateway(a,token,async()=>true,{dashboardPort:1,apiPort});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try {
  const answer=await fetch('http://127.0.0.1:'+server.address().port+'/party-api/state',{headers:{Cookie:'debug_'+token.slice(0,12)+'='+token,Authorization:'Bearer known'}});
  assert.equal(answer.status,200,'the gateway proxied to a port its instance did not name');
  assert.deepEqual(await answer.json(),{path:'/party-api/state'});
 }finally{coordinator.close();await new Promise(resolve=>server.close(resolve));await fs.rm(dir,{recursive:true,force:true});}
});
