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
// 7. A next-row bucket is written more than once: once per finest bucket it takes in.
// 8. A commit rewrites its whole bucket, frames from earlier commits included, when one more frame arrives.
// 14. An acknowledged frame waits in the character's outbox, a localStorage key each, for a later
//     commit; or a crash between a bucket start's part and its batch parts' delete counts them twice.
// 9. Memory and the journal keep a closed day's buckets uncompressed.
// 10. Moving history to day files loses or doubles a measurement: a query, the lifetime kill total or
//     the retained totals answer differently, or a v1.5.0 journal (receipt ids, `sources` lists, a
//     crash leftover listed in a rollup, the saved lifetime list) does not load as it was.
// 11. A day's expiry drops its kills from the lifetime total, or keeps its damage in the retained total.
// 12. A frame resent after a restart counts again when its receipt was saved as a v1.5.0 receipt id.
// 13. A kills reset leaves kills in a day file or in the lifetime total.
// 15. A POST that the shutdown's HTTP server takes after the close writes into the closed store and
//     warns "Metrics retention failed: Storage is closed".
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createMetricsService}=require('../../runtime/status/coordinator/metrics/service.ts');
const {METRIC_BUCKET_MS}=require('../../runtime/status/rules.ts');
const {settle}=require('./helpers/settle.cjs');

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
 // The bucket timer runs on the row's clock (clockService below): each tick is the next bucket start.
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'metrics-service-')),clock={now:Date.UTC(2026,10,20,12)};
 const {metrics,call,tick,warnings}=clockService(t,path.join(directory,'party.metrics.jsonl'),clock);
 t.after(async()=>{await metrics.close();fs.rmSync(directory,{recursive:true,force:true});});
 const nextBucket=async()=>{clock.now+=METRIC_BUCKET_MS;tick();await settle();};
 failing=true;
 await nextBucket();
 assert.ok(warnings.length>0,'the failed bucket write warned once');
 assert.equal((await call('GET /party-api/metrics',undefined)).status,503,'off while the store refuses writes');
 failing=false;
 await nextBucket();
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

const DAY=86_400_000;
function clockService(t,file,clock){
 const ticks=[],handlers=new Map(),warnings=[];
 const metrics=createMetricsService(file,{owned:()=>true,now:()=>clock.now,warn:error=>warnings.push(error),accountGold:()=>5,
  timers:{setTimeout:(run,ms)=>{if(!ms){setImmediate(run);return 0;}ticks.push(run);return ticks.length;},clearTimeout(){}}});
 metrics.install({get:(route,handler)=>handlers.set('GET '+route,handler),post:(route,handler)=>handlers.set('POST '+route,handler)});
 const call=async(key,body,query={})=>{let status=200,value;await handlers.get(key)({body,query},{status(code){status=code;return this;},json(v){value=v;return this;}});return {status,value};};
 // The bucket timer's latest callback: a bucket start on the simulated clock.
 const tick=()=>ticks.splice(0).forEach(run=>run());
 return {metrics,call,tick,warnings};
}
const records=file=>fs.readFileSync(file,'utf8').split('\n').filter(Boolean).map(line=>{const key=Object.keys(JSON.parse(line))[0];return [key,JSON.parse(line)[key]];});
const row=(character,at,extra={})=>({character,server:'USII',observedMs:METRIC_BUCKET_MS,partial:false,first:{...sample(at),gold:100},last:{...sample(at+9000),gold:150},
 samples:10,luckSum:1000,pingSum:0,pingSamples:0,damage:[{monster:'goo',skill:'attack',amount:40,hits:2}],credits:[],loot:[],...extra});
const bucket=(at,width,extra={})=>({at,width,values:[row('W',at)],kills:[{server:'USII',monster:'goo',actor:'W',count:2}],bounds:[],receipts:[],events:[],sources:[],...extra});

test('(7, 8, 14): a next-row bucket is written once, a POST writes its frames before it answers, and a bucket start writes one part per span',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'metrics-service-')),file=path.join(directory,'party.metrics.jsonl');
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const minute=Math.floor((Date.UTC(2026,10,20,12)-DAY-120_000)/60_000)*60_000,clock={now:Date.UTC(2026,10,20,12)};
 fs.writeFileSync(file,[{startedAt:minute-DAY},...[0,1,2,3,4,5].map(i=>({['bucket:10000:'+(minute+i*METRIC_BUCKET_MS)]:bucket(minute+i*METRIC_BUCKET_MS,METRIC_BUCKET_MS)}))].map(line=>JSON.stringify(line)).join('\n')+'\n');
 const {metrics,call,tick}=clockService(t,file,clock);
 assert.equal(records(file).filter(([key])=>key==='bucket:60000:'+minute).length,1,'one record of the minute, written once');
 const at=Math.floor(clock.now/METRIC_BUCKET_MS)*METRIC_BUCKET_MS;
 const batch=sequence=>({character:'W',server:'USII',runtime:'r1',frames:[frame(at,sequence,{damage:[{monster:'goo',skill:'attack',amount:7,hits:1}]})]});
 const live=()=>{const kept=new Map();for(const [key,value] of records(file))if(value===null)kept.delete(key);else kept.set(key,value);
  return [...kept.values()].filter(value=>value.at===at&&value.width===METRIC_BUCKET_MS);};
 const first=(await call('POST /party-api/metrics',batch(1))).value;
 assert.ok(first.durableCommit>=first.commit,'the answer names a commit already on disk');
 assert.deepEqual(live().map(value=>value.receipts),[[['W','r1',1,1]]],'the frame is on disk when the POST answers');
 clock.now+=METRIC_BUCKET_MS;tick();
 await call('POST /party-api/metrics',batch(2));clock.now+=METRIC_BUCKET_MS;tick();
 const written=live();
 assert.equal(written.length,2,'one part per span between bucket starts');
 assert.deepEqual(written.map(value=>value.values[0].samples),[1,1],'each part holds only its own span\'s frame');
 await metrics.close();
 // A crash between a bucket start's part and the delete of its batch parts: the batch part's frame counts once.
 fs.appendFileSync(file,JSON.stringify({['part:'+at+':crashed:1']:written[0]})+'\n');
 const again=clockService(t,file,clock);
 const history=(await again.call('GET /party-api/metrics',undefined,{from:String(at),to:String(clock.now)})).value;
 assert.equal(history.points.flatMap(point=>point.values).reduce((sum,row)=>sum+row.samples,0),2,'a leftover batch part counts again');
 await again.metrics.close();
});

test('(9-13): a closed day lives in one compressed file, and a v1.5.0 journal moves there losslessly',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'metrics-service-')),file=path.join(directory,'party.metrics.jsonl');
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const now=Date.UTC(2026,10,22,12),clock={now};
 const recent=Math.floor((now-3_600_000)/METRIC_BUCKET_MS)*METRIC_BUCKET_MS;
 const closed=Date.UTC(2026,10,18,6),old=Date.UTC(2026,9,10,6),expired=Date.UTC(2026,4,1,6);
 // v1.5.0's layout: a 10 s bucket with receipt ids, a 1-min bucket of a closed day, a 15-min rollup
 // that lists a 1-min source a crash left behind, a bucket past the 180 days, and the lifetime list.
 const lines=[{startedAt:expired},
  {['bucket:10000:'+recent]:bucket(recent,METRIC_BUCKET_MS,{receipts:[JSON.stringify(['W','r1',3])],events:[{id:'k1',at:recent}]})},
  {['bucket:60000:'+closed]:bucket(closed,60_000,{sources:['10000:'+closed]})},
  {['bucket:900000:'+old]:bucket(old,900_000,{sources:['60000:'+old]})},
  {['bucket:60000:'+old]:bucket(old,60_000)},
  {['bucket:900000:'+expired]:bucket(expired,900_000,{sources:[]})},
  {killTotals:[{server:'USII',monster:'goo',actor:'W',count:2*4+5}]}];
 fs.writeFileSync(file,lines.map(line=>JSON.stringify(line)).join('\n')+'\n');
 let service=clockService(t,file,clock);
 // Close waits for the day work; the restart reads the result.
 await service.metrics.close();
 service=clockService(t,file,clock);
 const journal=records(file).map(([key])=>key);
 assert.deepEqual(journal.filter(key=>key.startsWith('bucket:')&&!key.startsWith('bucket:'+METRIC_BUCKET_MS+':')),[],'no bucket of a closed day stays in the journal');
 const files=fs.readdirSync(file+'.days').sort();
 assert.deepEqual(files,['2026-10-10.900000.jsonl.gz','2026-11-18.60000.jsonl.gz'],'one compressed file per closed day');
 const zlib=require('node:zlib');
 assert.equal(zlib.gunzipSync(fs.readFileSync(path.join(file+'.days',files[1]))).toString().trim().split('\n').length,1);
 const range={from:String(now-180*DAY),to:String(now),dayFrom:String(now-12*3_600_000),dayTo:String(now)};
 const history=(await service.call('GET /party-api/metrics',undefined,{from:range.from,to:range.to})).value;
 const damage=history.points.flatMap(point=>point.values).flatMap(value=>value.damage).reduce((sum,hit)=>sum+hit.amount,0);
 assert.equal(damage,40*3,'the recent, closed and old buckets each count once; the expired one is gone');
 const kills=(await service.call('GET /party-api/metrics/kills',undefined,range)).value.monsters[0];
 assert.deepEqual([kills.count,kills.total,kills.today],[6,13,2],'the lifetime total keeps the expired day and the v1.5.0 list');
 const bars=(await service.call('GET /party-api/metrics/bars',undefined,{...range,metric:'damage'})).value.rows[0];
 assert.equal(bars.total,120,'the retained damage drops the expired day');
 const resent={character:'W',server:'USII',runtime:'r1',frames:[frame(recent,3,{damage:[{monster:'goo',skill:'attack',amount:7,hits:1}]})]};
 await service.call('POST /party-api/metrics',resent);
 const again=(await service.call('GET /party-api/metrics',undefined,{from:range.from,to:range.to})).value;
 assert.equal(again.points.flatMap(point=>point.values).flatMap(value=>value.damage).reduce((sum,hit)=>sum+hit.amount,0),120,'a v1.5.0 receipt id still refuses its frame');
 assert.equal((await service.call('POST /party-api/metrics/reset',{metric:'kills'})).status,200);
 const day=zlib.gunzipSync(fs.readFileSync(path.join(file+'.days','2026-11-18.60000.jsonl.gz'))).toString().trim().split('\n').map(line=>JSON.parse(line));
 assert.deepEqual(day.map(value=>value.kills),[[]],'the reset clears the kills in the day file');
 assert.equal((await service.call('GET /party-api/metrics/kills',undefined,range)).value.monsters.length,0);
 await service.metrics.close();
});

test('(15): a POST after the close answers 503, writes nothing and warns nothing',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'metrics-service-')),file=path.join(directory,'party.metrics.jsonl');
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const clock={now:Date.UTC(2026,10,20,12)},{metrics,call,warnings}=clockService(t,file,clock);
 const at=Math.floor(clock.now/METRIC_BUCKET_MS)*METRIC_BUCKET_MS;
 await metrics.close();
 const size=fs.statSync(file).size;
 const answer=await call('POST /party-api/metrics',{character:'W',server:'USII',runtime:'r1',frames:[frame(at,1)]});
 assert.equal(answer.status,503,'the collector keeps the frame for the next process');
 assert.deepEqual(warnings.map(error=>String(error?.message??error)),[],'no storage warning at shutdown');
 assert.equal(fs.statSync(file).size,size,'the closed journal takes no write');
});
