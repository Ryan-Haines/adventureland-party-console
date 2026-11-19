const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const {spawn}=require('node:child_process');
const {once}=require('node:events');

test('shared Node production launcher serves HTML, assets, and request bodies', {timeout:20000}, async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'party-node-dashboard-'));
 // The launcher needs a port number up front, so the test frees a probed port and hands it over. Another
 // process can take it before the child binds; the child then exits with EADDRINUSE and the test probes again.
 const freePort=async()=>{
  const reservation=net.createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');
  const free=reservation.address().port;await new Promise(r=>reservation.close(r));return free;
 };
 let child,exited,logs='',port,origin;
 try {
  await fs.mkdir(path.join(directory,'server'));await fs.mkdir(path.join(directory,'client','_next','static'),{recursive:true});
  await fs.writeFile(path.join(directory,'package.json'),' {"type":"module"}');
  await fs.writeFile(path.join(directory,'client','_next','static','asset.js'),'globalThis.partyTest=true;');
  await fs.writeFile(path.join(directory,'server','index.js'),`export default async function(request) {
   if(request.method==='POST')return new Response(await request.text());
   return new Response('<html><body>Party Console<script src="/_next/static/asset.js"></script></body></html>',{headers:{'content-type':'text/html'}});
  }`);
  let ready=false;
  for(let attempt=0;attempt<3&&!ready;attempt++) {
   port=await freePort();logs='';
   child=spawn(process.execPath,[path.resolve('tools/dashboard/node-server.mts'),String(port),directory],{windowsHide:true,stdio:['ignore','pipe','pipe']});
   exited=once(child,'exit');child.stdout.on('data',data=>logs+=data);child.stderr.on('data',data=>logs+=data);
   origin='http://127.0.0.1:'+port;
   for(let i=0;i<100;i++) {
    if(child.exitCode!==null){if(/EADDRINUSE/.test(logs))break;throw Error(logs);}
    try {if((await fetch(origin,{signal:AbortSignal.timeout(500)})).ok){ready=true;break;}}catch{}
    await new Promise(r=>setTimeout(r,50));
   }
  }
  assert.ok(ready,logs);
  assert.match(await (await fetch(origin)).text(),/<html>/);
  const asset=await fetch(origin+'/_next/static/asset.js');assert.equal(asset.status,200);assert.match(asset.headers.get('content-type'),/javascript/);
  assert.equal(await asset.text(),'globalThis.partyTest=true;');
  assert.equal(await (await fetch(origin+'/action',{method:'POST',body:'round trip'})).text(),'round trip');
 } finally {
  if(child?.exitCode===null){child.kill();await exited;}
  await fs.rm(directory,{recursive:true,force:true});
 }
});
