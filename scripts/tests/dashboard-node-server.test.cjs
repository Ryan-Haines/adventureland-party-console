const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const {ROW_TIMEOUT_MS}=require('./fixtures/scenarios.cjs');

// ROW_TIMEOUT_MS is the harness's named hang guard; it only stops a launcher that never starts.
test('shared Node production launcher serves HTML, assets, and request bodies', {timeout:ROW_TIMEOUT_MS}, async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'party-node-dashboard-'));
 let child,exited,logs='',origin;
 try {
  await fs.mkdir(path.join(directory,'server'));await fs.mkdir(path.join(directory,'client','_next','static'),{recursive:true});
  await fs.writeFile(path.join(directory,'package.json'),' {"type":"module"}');
  await fs.writeFile(path.join(directory,'client','_next','static','asset.js'),'globalThis.partyTest=true;');
  await fs.writeFile(path.join(directory,'server','index.js'),`export default async function(request) {
   if(request.method==='POST')return new Response(await request.text());
   return new Response('<html><body>Party Console<script src="/_next/static/asset.js"></script></body></html>',{headers:{'content-type':'text/html'}});
  }`);
  // Port 0: the launcher binds a free port and its start line names it, so no probed port can be taken.
  // An empty gateway URL keeps that line on (node-server.mts `silent`).
  child=spawn(process.execPath,[path.resolve('tools/dashboard/node-server.mts'),'0',directory],{env:{...process.env,AL_DASHBOARD_GATEWAY_URL:''},windowsHide:true,stdio:['ignore','pipe','pipe']});
  exited=once(child,'exit');child.stderr.on('data',data=>logs+=data);
  origin=await new Promise((resolve,reject)=>{
   child.stdout.on('data',data=>{logs+=data;const started=/running at (http:\/\/\S+)/.exec(logs);if(started)resolve(started[1].replace(/\/$/,''));});
   exited.then(()=>reject(Error(logs)));
  });
  assert.match(await (await fetch(origin)).text(),/<html>/);
  const asset=await fetch(origin+'/_next/static/asset.js');assert.equal(asset.status,200);assert.match(asset.headers.get('content-type'),/javascript/);
  assert.equal(await asset.text(),'globalThis.partyTest=true;');
  assert.equal(await (await fetch(origin+'/action',{method:'POST',body:'round trip'})).text(),'round trip');
 } finally {
  if(child?.exitCode===null){child.kill();await exited;}
  await fs.rm(directory,{recursive:true,force:true});
 }
});
