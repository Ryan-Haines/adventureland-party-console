// The metrics service on the settings owner's journal
// (runtime/status/coordinator/metrics/service.ts). The journal's own rows (a torn tail, corruption,
// compaction) are the settings owner's coordinator-jsonl-store.test.cjs. Failure modes here:
// 1. One storage error leaves the metrics off after the store writes again.
// 2. A kill or a drop resent in a later batch counts twice; kills and loot dedupe by different rules.
// 4. A frame or a range past the coordinator's clock is refused with no bound firing.
// 5. The character's collector keeps a seen id deduped past METRIC_SEEN_MS until a pruning clock
//    comes round, and a credit with no covering death marks its frame partial with no bound firing.
// 6. A sample counts the login handshake as ping for a fixed time after connect, not until the
//    game has measured a round trip since its login.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createMetricsService}=require('../../runtime/status/coordinator/metrics/service.ts');
const {METRIC_BUCKET_MS}=require('../../runtime/status/rules.ts');

function service(t,ports={}){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'metrics-service-'));
 const file=path.join(directory,'party.metrics.jsonl'),handlers=new Map(),warnings=[];
 const metrics=createMetricsService(file,{owned:name=>name==='W',now:()=>Date.now(),timers:{setTimeout,clearTimeout},warn:error=>warnings.push(error),accountGold:()=>5,...ports});
 metrics.install({get:(route,handler)=>handlers.set('GET '+route,handler),post:(route,handler)=>handlers.set('POST '+route,handler)});
 t.after(async()=>{await metrics.close();fs.rmSync(directory,{recursive:true,force:true});});
 const call=async(key,body,query={})=>{let status=200,value;await handlers.get(key)({body,query},{status(code){status=code;return this;},json(v){value=v;return this;}});return {status,value};};
 return {file,call,warnings};
}
const sample=at=>({at,gold:0,luck:100,ping:null,level:50,xp:0,maxXp:100});
const frame=(at,sequence,extra={})=>({at,sequence,observedMs:1000,partial:false,first:sample(at),last:sample(at+1000),damage:[],credits:[],kills:[],loot:[],...extra});

test('(1): the metrics come back once the store writes again after one storage error',async t=>{
 // The journal keeps one open handle (jsonl-store.ts), so a read-only file still takes its writes;
 // the store's own write throws instead while `failing` holds.
 const {CoordinatorJsonlStore}=require('../../runtime/settings/coordinator/api.ts');
 const write=CoordinatorJsonlStore.prototype.setSerialized;let failing=false;
 t.mock.method(CoordinatorJsonlStore.prototype,'setSerialized',function(...args){
  if(failing)throw Object.assign(new Error('EACCES: the store refuses writes'),{code:'EACCES'});
  return write.apply(this,args);
 });
 const {call,warnings}=service(t);
 failing=true;
 await new Promise(resolve=>setTimeout(resolve,METRIC_BUCKET_MS+500));
 assert.ok(warnings.length>0,'the failed bucket write warned once');
 assert.equal((await call('GET /party-api/metrics',undefined)).status,503,'off while the store refuses writes');
 failing=false;
 await new Promise(resolve=>setTimeout(resolve,METRIC_BUCKET_MS+500));
 assert.notEqual((await call('GET /party-api/metrics',undefined)).status,503,'back at the next bucket the store writes');
});

test('(2): a kill and a drop resent in a later batch count once, by their ids',async t=>{
 const {call}=service(t);
 const at=Math.floor(Date.now()/METRIC_BUCKET_MS)*METRIC_BUCKET_MS;
 // The loot variant is the character's own value: the item's level and properties as JSON (status/character/telemetry.ts).
 const events={kills:[{id:'kill-1',at:at+10,monster:'goo',actor:'W'}],loot:[{id:'loot-1',at:at+20,item:'gem0',variant:'{"level":0}',quantity:1}]};
 const batch=sequence=>({character:'W',server:'USII',runtime:'r1',frames:[frame(at,sequence,events)]});
 assert.equal((await call('POST /party-api/metrics',batch(1))).status,200);
 assert.equal((await call('POST /party-api/metrics',batch(2))).status,200);
 // The kills route takes the dashboard's day range too, and refuses an end past now (metrics/http.ts).
 const kills=(await call('GET /party-api/metrics/kills',undefined,{from:String(at-METRIC_BUCKET_MS),to:String(Date.now()),
  dayFrom:String(at-METRIC_BUCKET_MS),dayTo:String(at+METRIC_BUCKET_MS)})).value;
 assert.equal(kills.monsters.find(row=>row.monster==='goo')?.count,1,'the resent kill counts once');
});

// Big check part 7: a kept safety bound's firing (bounds.ts `boundFired`) counts in the metrics
// history as a series per bound, so the end run reads firings over time beside the kills.
test('(3): a bound firing counts in the series of its bucket',async t=>{
 const {call}=service(t);
 const {boundFired}=require('../../runtime/status/coordinator/api.ts');
 const at=Math.floor(Date.now()/METRIC_BUCKET_MS)*METRIC_BUCKET_MS;
 boundFired({bound:'JOB_LIVE_MS',owner:'08',subject:'M',state:{}});boundFired({bound:'JOB_LIVE_MS',owner:'08',subject:'M',state:{}});
 const points=(await call('GET /party-api/metrics',undefined,{from:String(at-METRIC_BUCKET_MS)})).value.points;
 assert.equal(points.flatMap(point=>point.bounds).filter(row=>row.bound==='JOB_LIVE_MS'&&row.owner==='08').reduce((sum,row)=>sum+row.count,0),2);
});
test('(4): a frame or a range past the coordinator clock fires its bound',async t=>{
 const {call}=service(t);
 const {boundFirings}=require('../../runtime/status/coordinator/api.ts');
 const count=bound=>boundFirings().counts[bound]||0,ahead=count('FRAME_AHEAD_MS'),skew=count('CLOCK_SKEW_MS');
 const at=Math.floor(Date.now()/METRIC_BUCKET_MS)*METRIC_BUCKET_MS+3*METRIC_BUCKET_MS;
 assert.equal((await call('POST /party-api/metrics',{character:'W',server:'USII',runtime:'r1',frames:[frame(at,1)]})).status,400);
 assert.equal(count('FRAME_AHEAD_MS'),ahead+1);
 assert.equal((await call('GET /party-api/metrics',undefined,{from:String(Date.now()-1000),to:String(Date.now()+120000)})).status,400);
 assert.equal(count('CLOCK_SKEW_MS'),skew+1);
});
test('(6): a sample takes the ping once the game has measured a round trip since login',()=>{
 const {steadyPing}=require('../../runtime/status/character/telemetry.ts');
 assert.equal(steadyPing(320,[320]),null,'the login handshake alone');
 assert.equal(steadyPing(180,[320,40]),180,'the game average once a round trip is in');
 assert.equal(steadyPing(40,undefined),null);
});
test('(5): the collector forgets a seen id at its first write past METRIC_SEEN_MS, and an uncovered credit fires its bound',async()=>{
 const {installPartyMetrics}=require('../../runtime/status/character/telemetry.ts');
 const {boundsPending,boundsSent}=require('../../runtime/status/api.ts');
 const {METRIC_SEEN_MS}=require('../../runtime/status/rules.ts');
 boundsSent(boundsPending().length);
 const items=new Map(),storage={getItem:k=>items.has(k)?items.get(k):null,setItem:(k,v)=>items.set(k,String(v)),removeItem:k=>items.delete(k),key:i=>[...items.keys()][i]??null,get length(){return items.size;}};
 let now=Math.floor(Date.now()/METRIC_BUCKET_MS)*METRIC_BUCKET_MS;const batches=[];
 const metrics=installPartyMetrics({now:()=>now,current:()=>true,connected:()=>true,name:()=>'W',own:actor=>actor==='W',ownedCharacter:()=>true,
  context:()=>({server:'USII',map:'main',instance:'main',party:[]}),sample:()=>({gold:0,luck:1,ping:null,level:1,xp:0,maxXp:1}),storage,
  send:async batch=>{batches.push(batch);return {ok:true};}});
 const kill=id=>metrics.hit({id,hid:'W',kill:true,damage:1},{id,type:'monster',mtype:'goo'});
 const kills=()=>batches.flatMap(batch=>batch.frames).flatMap(frame=>frame.kills).length;
 kill('m1');now+=METRIC_SEEN_MS-500;kill('m2');
 // m1's death seen again past METRIC_SEEN_MS: the write prunes first, so it counts again.
 now+=700;kill('m1');metrics.pulse();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(kills(),3);
 // A credit whose monster no observed death covers.
 now+=METRIC_BUCKET_MS;metrics.credit({mtype:'bee'});metrics.pulse();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(batches.flatMap(batch=>batch.frames).some(frame=>frame.partial&&frame.credits.some(c=>c.monster==='bee')),true);
 assert.deepEqual(boundsPending().filter(f=>!f.cap).map(f=>[f.bound,f.state.monster]),[['CREDIT_COVERAGE_MS','bee']]);
 boundsSent(boundsPending().length);
});
// The bucket timer runs on the status owner's run scope handle, so the run's stop ends it;
// the service starts no bare timer.
test('D-D24: the metrics bucket timer goes through the run scope handle',async t=>{
 const set=[],cleared=[];
 service(t,{timers:{setTimeout:(callback,ms)=>{set.push(ms);return 41;},clearTimeout:id=>cleared.push(id)}});
 assert.equal(set.length,1,'one timer, at the next bucket start');
 assert.ok(set[0]>0&&set[0]<=METRIC_BUCKET_MS);
 assert.deepEqual(cleared,[]);
});

// B81: v1.5.0's restore threw on the first malformed saved bucket
// (service.ts:142-145), so the service never started and every metrics route answered 503 for the
// run. The malformed record now costs itself, with a warning, and the rest of the history loads.
test('B81: one malformed saved bucket costs that record, and the metrics routes answer',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'metrics-service-'));
 const file=path.join(directory,'party.metrics.jsonl'),at=Math.floor(Date.now()/METRIC_BUCKET_MS)*METRIC_BUCKET_MS;
 fs.writeFileSync(file,[{startedAt:at},{['bucket:'+at]:{at:'broken'}},{['accountGold:'+at]:{at,total:5}}].map(line=>JSON.stringify(line)).join('\n')+'\n');
 const warnings=[],handlers=new Map();
 const metrics=createMetricsService(file,{owned:name=>name==='W',now:()=>Date.now(),timers:{setTimeout,clearTimeout},warn:error=>warnings.push(error),accountGold:()=>5});
 t.after(async()=>{await metrics.close();fs.rmSync(directory,{recursive:true,force:true});});
 metrics.install({get:(route,handler)=>handlers.set('GET '+route,handler),post:(route,handler)=>handlers.set('POST '+route,handler)});
 assert.match(String(warnings[0]?.message),new RegExp('Skipped the saved metrics record bucket:'+at));
 let status=200;await handlers.get('GET /party-api/metrics')({query:{}},{status(code){status=code;return this;},json(){return this;}});
 assert.notEqual(status,503);
 // v1.5.0's restore called the same reader with no catch, so this throw ended the
 // service's start.
 const {storedBucket}=require('../../runtime/status/coordinator/metrics/history.ts');
 assert.throws(()=>storedBucket({at:'broken'}),/Invalid metrics history envelope/);
});
