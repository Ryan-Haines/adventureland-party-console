const test=require('node:test');
const assert=require('node:assert/strict');
const {createMapStreams}=require('../../runtime/coordinator/telemetry/map-stream.ts');
const {createCombatLogRoutes}=require('../../runtime/coordinator/telemetry/combat-log.ts');
const {httpFixture}=require('./helpers/coordinator-http.cjs');

test('map streams replay the latest frame, heartbeat every fifteen seconds, and release subscribers on close',()=>{
 const timers=[],cancelled=[],http=httpFixture();
 const streams=createMapStreams({owned:name=>name==='P',definition:()=>null,every:(callback,ms)=>{const timer={callback,ms};timers.push(timer);return timer;},cancel:timer=>cancelled.push(timer)});
 streams.install(http.router);
 const frame={name:'P',map:'main',entities:[{id:'monster'}],extra:'retained'};
 assert.equal(http.invoke('POST','/party-api/map-frame',frame).response.code,204);
 const first=http.invoke('GET','/party-api/map-stream/:character',undefined,{character:'P'});
 const second=http.invoke('GET','/party-api/map-stream/:character',undefined,{character:'P'});
 assert.equal(streams.count('P'),2);assert.deepEqual(first.response.chunks,['data: '+JSON.stringify(frame)+'\n\n']);
 assert.equal(timers[0].ms,15000);timers[0].callback();assert.equal(first.response.chunks.at(-1),': keepalive\n\n');
 first.request.close();assert.equal(streams.count('P'),1);second.request.close();assert.equal(streams.count('P'),0);assert.equal(cancelled.length,2);
});

test('map routes reject unknown characters and malformed frames and cache map definitions',()=>{
 const http=httpFixture(),definition={name:'main'};
 createMapStreams({owned:name=>name==='P',definition:name=>name==='main'?definition:null,every:()=>0,cancel(){}}).install(http.router);
 assert.equal(http.invoke('POST','/party-api/map-frame',{name:'P',map:'main'}).response.code,400);
 assert.equal(http.invoke('GET','/party-api/map-stream/:character',undefined,{character:'Q'}).response.code,404);
 assert.equal(http.invoke('GET','/party-api/maps/:map',undefined,{map:'missing'}).response.code,404);
 const result=http.invoke('GET','/party-api/maps/:map',undefined,{map:'main'}).response;
 assert.equal(result.body,definition);assert.equal(result.headers['Cache-Control'],'public, max-age=3600');
});

test('combat logs bound batch and retention sizes, normalize values, and clear only the selected character',()=>{
 const http=httpFixture(),logs={P:Array.from({length:499},(_,at)=>({at,message:'old',type:'event',details:null})),Q:[]};let saves=0;
 createCombatLogRoutes(logs,{owned:name=>['P','Q'].includes(name),now:()=>1000,persist:()=>saves++}).install(http.router);
 const events=Array.from({length:25},(_,index)=>({at:0,type:'a'.repeat(50),message:'m'.repeat(300),details:{index}}));
 const result=http.invoke('POST','/party-api/combat-log',{character:'P',events}).response;
 assert.deepEqual(result.body,{ok:true,count:500});assert.equal(logs.P[480].details.index,5);
 assert.equal(logs.P.at(-1).at,1000);assert.equal(logs.P.at(-1).type.length,24);assert.equal(logs.P.at(-1).message.length,240);
 http.invoke('POST','/party-api/combat-log/:character/clear',undefined,{character:'P'});assert.deepEqual(logs,{P:[],Q:[]});assert.equal(saves,2);
 assert.equal(http.invoke('POST','/party-api/combat-log',{character:'unknown',events}).response.code,400);assert.equal(saves,2);
});
