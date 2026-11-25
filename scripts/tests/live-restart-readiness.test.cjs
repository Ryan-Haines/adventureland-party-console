const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {waitForLiveRestartState}=require('../../e2e/live-restart-readiness.ts');
const valid={gameVersion:15555,characters:{}};
async function server(handler,run){const s=http.createServer(handler);await new Promise(r=>s.listen(0,'127.0.0.1',r));try{await run('http://127.0.0.1:'+s.address().port);}finally{await new Promise(r=>s.close(r));}}
test('explicit restart waits for a real valid gateway state after503 without sending mutations',async()=>{
 let count=0;const observations=[];
 await server((req,res)=>{assert.equal(req.method,'GET');assert.equal(req.url,'/party-api/state?catalog=0');count++;res.writeHead(count===1?503:200,{'Content-Type':'application/json'});res.end(JSON.stringify(count===1?{error:'Service is starting or unavailable; retry shortly'}:valid));},async url=>{
  await waitForLiveRestartState(url,row=>observations.push(row),1000);
 });
 assert.equal(count,2);assert.equal(observations[0].status,503);assert.match(observations[0].body,/Service is starting/);assert.equal(observations.at(-1).ready,true);
});
for(const [status,body]of [[401,{error:'denied'}],[200,{characters:{}}]])test('restart readiness rejects invalid state '+status+' immediately',async()=>{
 let count=0;
 await server((req,res)=>{count++;res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));},async url=>assert.rejects(waitForLiveRestartState(url,()=>{},500)));
 assert.equal(count,1);
});
test('persistent503 cannot extend the bounded restart state-read budget',async()=>{
 // Every read the helper starts is inside the budget it was given, by its own elapsed reading.
 let count=0;const budget=120,rows=[];
 await server((req,res)=>{count++;res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'still starting'}));},async url=>assert.rejects(waitForLiveRestartState(url,row=>rows.push(row),budget),/ready/));
 assert.ok(count>=1);assert.ok(rows.length>=1&&rows.every(row=>row.elapsedMs<budget),JSON.stringify(rows.map(row=>row.elapsedMs)));
});
