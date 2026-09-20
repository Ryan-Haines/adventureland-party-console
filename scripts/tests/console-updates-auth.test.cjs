const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {Access}=require('../../tools/hosting/access.ts'),{gateway}=require('../../tools/hosting/gateway.ts');
test('updater routes require browser authorization and never accept a Steam credential',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'console-update-auth-')),access=new Access(path.join(dir,'access.json'));await access.load();await access.setRequired(true);
 const cookie=await access.pair(await access.invitation()),steam=await access.steam();let calls=0;
 const server=gateway({access,configured:()=>false,dashboardPort:1,updates:{route:async(_req,res)=>{calls++;res.writeHead(200,{'Content-Type':'application/json'});res.end('{}');}}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 try{
  await fetch(base+'/console-update',{redirect:'manual'});assert.equal(calls,0);
  assert.equal((await fetch(base+'/console-update/restart',{method:'POST',headers:{Origin:'https://evil.example',Cookie:'party='+cookie}})).status,403);
  assert.equal((await fetch(base+'/bridge/'+steam+'/console-update/restart',{method:'POST',headers:{Origin:'https://adventure.land'}})).status,404);
  await fetch(base+'/console-update',{headers:{Cookie:'party='+cookie}});assert.equal(calls,1);
  await fetch(base+'/console-update/restart',{method:'POST',headers:{Origin:base,Cookie:'party='+cookie},body:'{}'});assert.equal(calls,2);
 }finally{await new Promise(resolve=>server.close(resolve));await fs.rm(dir,{recursive:true,force:true});}
});
