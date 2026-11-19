const test=require('node:test'),assert=require('node:assert/strict');
const {walkStatePorts}=require('./helpers/walk-state-ports.cjs');
// The walk client builds the reports, which read its walk, lease and the lease's clock.
const {createWalkClient}=require('../../runtime/movement/character/walk-client.ts');
function fixture(){
 let now=5000,mono=5000,offset=100;const logs=[],errors=[];
 const host={parent:{},performance:{now:()=>mono},game_log:(message,colour)=>r.game_log(message,colour)};
 const r={root:host,game_log:message=>logs.push(message),character:{map:'arena',x:-129,y:-208}};
 const ports={...walkStatePorts(host),now:()=>now,character:()=>r.character,runtimeId:()=>'runtime-1',
  // The clock the reply sync reads and sets, and the clock error movement is told.
  clockOffset:()=>offset,setClockOffset:o=>{offset=o;},movement:()=>({setClockError:h=>errors.push(h.clock.networkMs)})},walk=createWalkClient(host,ports);
 walk.groupWalk.signal={id:'convoy-1',epoch:7,commandId:9,runtimeId:'runtime-1',routeVersion:3,validUntil:6000};
 Object.assign(r,walk);
 const convoy={id:'convoy-1',epoch:7,commandId:9,phase:'travelling'},command={routeVersion:3,location:{map:'arena',x:384,y:-420}};
 return {r,logs,errors,offset:()=>offset,setOffset(value){offset=value;},convoy,command,time(wall,elapsed=wall){now=wall;mono=elapsed;},capture(){r.captureConvoyFailureContext(convoy,command);return convoy.failureContext;}};
}
const {scenarioTable}=require('./fixtures/scenarios.cjs');
scenarioTable('a convoy failure captures a copyable context from the walk, its signal and its HTTP timings',fixture,[
['expired matching signal produces copyable pre-cancellation context and HTTP timings',f=>{
 f.r.rememberConvoyStatusRequest(4000,'success');f.time(6800);f.r.rememberConvoyStatusRequest(5500,'network');
 const c=f.capture();assert.equal(c.signal.state,'expired');assert.equal(c.signal.expiredByMs,900);assert.equal(c.lastStatusResponseAgeMs,1800);
 f.convoy.phase='failed';f.r.character.x=999;f.command.location.x=999;f.time(9000);f.capture();
 assert.equal(c.phase,'travelling');assert.equal(c.position.x,-129);assert.equal(c.destination.x,384);
 f.r.logConvoyFailureContext(c);assert.equal(f.logs.length,2);
 assert.match(f.logs[0],/phase=travelling.*position=arena \(-129,-208\).*destination=arena \(384,-420\).*convoy=convoy-1.*epoch=7.*command=9.*runtime=runtime-1.*route=3/);
 assert.match(f.logs[1],/expired.*900ms.*1800ms ago.*network after 1300ms/);
}],
...['id','epoch','commandId','runtimeId','routeVersion'].map(field=>['identity mismatch identifies '+field,f=>{
 f.r.groupWalk.signal[field]='different';const c=f.capture();
 assert.equal(c.signal.state,'identity mismatch');assert.equal(c.signal.mismatches[0].field,field);
 f.r.logConvoyFailureContext(c);assert.match(f.logs[1],new RegExp(field+' expected=.* received=different'));
}]),
['missing signals and timing data are explicitly unknown',f=>{
 f.r.groupWalk.signal=null;const c=f.capture();assert.equal(c.signal.state,'missing');
 f.r.logConvoyFailureContext(c);assert.match(f.logs[1],/missing.*expiry overrun=unknown.*last status response=unknown.*latest status failure=unknown/);
}],
['valid signals stay matching and numeric wire identities follow existing comparisons',f=>{
 f.r.groupWalk.signal.epoch='7';f.r.groupWalk.signal.commandId='9';assert.equal(f.capture().signal.state,'matching');
}],
['HTTP elapsed time is unaffected by a wall-clock adjustment',f=>{
 const start=f.r.convoyDiagnosticClock();f.time(-10000,5500);f.r.rememberConvoyStatusRequest(start,'timeout');
 const c=f.capture();assert.equal(c.lastStatusFailure.durationMs,500);assert.equal(c.lastStatusFailure.ageMs,0);
}],
['diagnostic collection and output failures do not throw',f=>{
 Object.defineProperty(f.r.root,'__partyConvoyHttp',{get(){throw Error('diagnostic failure');}});
 assert.doesNotThrow(()=>f.r.rememberConvoyStatusRequest(1,'network'));assert.doesNotThrow(()=>f.capture());
 f.r.game_log=()=>{throw Error('log unavailable');};assert.doesNotThrow(()=>f.r.logConvoyFailureContext(null));
}],
['a reply syncs the clock on its best network time and leases the signal net of transport time, as acceptTravelResponse did',f=>{
 const {errors,r}=f,walk=r,host=r.root;
 const travel={id:'convoy-1',epoch:7,commandId:9,routeVersion:3,navigationRevision:2};
 f.time(10000,500);f.setOffset(0);walk.groupWalk.signal=null;walk.groupWalk.travel=travel;
 const lease={id:'convoy-1',epoch:7,commandId:9,runtimeId:'runtime-1',routeVersion:3,navigationRevision:2,validUntil:23000};
 // 200 ms round trip, 50 ms of it coordinator processing: 150 ms of network time.
 f.time(10000,700);r.acceptTravelResponse({transportTiming:{receivedAt:19950,sentAt:20000},convoySignal:lease},{wall:9800,mono:500},true);
 assert.equal(f.offset(),(19950+20000-9800-10000)/2);assert.deepEqual(errors,[150]);
 assert.equal(walk.groupWalk.signal.localDeadline,700+3000-150);assert.equal(host.__partyTravelSignalAt,20000);
 // A slower sync inside a minute keeps the clock; an older reply leaves the lease.
 f.time(10000,1500);r.acceptTravelResponse({transportTiming:{receivedAt:19000,sentAt:19500},convoySignal:{...lease,validUntil:30000}},{wall:9000,mono:700},false);
 assert.deepEqual(errors,[150]);assert.equal(walk.groupWalk.signal.validUntil,23000);
 // A fast reply for another walk leaves the lease.
 r.acceptTravelResponse({transportTiming:{receivedAt:20900,sentAt:21000},convoySignal:{...lease,commandId:10,validUntil:30000}},{wall:9900,mono:1400},true);
 assert.equal(walk.groupWalk.signal.validUntil,23000);
 // An older full status keeps the walk active while the signal still holds, a newer one does not.
 assert.equal(r.convoyActivityFromStatus({serverNow:19000}),true);
 assert.equal(r.convoyActivityFromStatus({serverNow:20001}),false);
}],
]);
