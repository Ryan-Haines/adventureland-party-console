const test=require('node:test');
const assert=require('node:assert/strict');
const {createMerchantRecovery}=require('../../runtime/merchant-jobs/coordinator/recovery.ts'),{pauseMerchantJob,endMerchantJob}=require('../../runtime/merchant-jobs/coordinator/owner.ts');
function fixture(job){
 const state={current:job,queue:[]},effects=[];let now=100000;
 // The slot's view of the recovery state, as the composition gives the one end and the one pause.
 const slot={merchantCharacter:'M',commands:{},get merchantCurrent(){return state.current;},set merchantCurrent(value){state.current=value;}};
 const ports={now:()=>now,nextCommand:()=>7,end:(job,code)=>{effects.push(['end',code]);endMerchantJob(slot,job,{decision:'ended',code});},restockSatisfied:()=>false,
  stamp:job=>({...job,priority:80}),log:message=>effects.push(message),persist:()=>effects.push('persist'),dispatch:()=>effects.push('dispatch'),recoverSale:()=>effects.push('sale'),
  recovers:()=>true,offline:()=>false,
  pause:(job,by)=>pauseMerchantJob(slot,job,by)};
 return {state,slot,effects,ports,time:value=>{now=value;},observe:(...args)=>createMerchantRecovery(state,ports).observe(...args),
  expire:name=>createMerchantRecovery(state,ports).expire(name)};
}
const {boundFirings}=require('../../runtime/status/coordinator/api.ts');
// The kept bound that trips tells the status owner's bound record with the job's state.
// A commerce job whose heartbeat goes on keeps its job; its game calls end at the
// reply bound (calls.ts `itemCall`), so the 90 s commerce progress bound went.
test('a commerce job with a live heartbeat keeps its job past 90 s with no checkpoint',()=>{
 const f=fixture({id:'long',target:'M',reason:'merchant commerce',phase:'processing',heartbeatAt:99999,startedAt:1});
 f.observe('M',[]);assert.equal(f.state.current.id,'long');assert.equal(f.state.queue.length,0);
});
test('a merchant whose reports stop naming its job trips JOB_LIVE_MS, records it and its recovery backoff',()=>{
 const before=boundFirings().counts.JOB_LIVE_MS||0;
 const f=fixture({id:'quiet',target:'M',reason:'upgrades and compounds',phase:'processing',heartbeatAt:79999,startedAt:70000});
 f.observe('M',[]);assert.equal(f.state.current,null);
 assert.equal(boundFirings().counts.JOB_LIVE_MS,before+1);
 const entries=boundFirings().entries,entry=entries.filter(e=>e.bound==='JOB_LIVE_MS').at(-1);assert.equal(entry.subject,'M');assert.equal(entry.state.heartbeatAge,20001);
 // The requeue's backoff is a bound against the outside failure, recorded after the trip.
 assert.deepEqual([entries.at(-1).bound,entries.at(-1).state.attempt],['RECOVERY_RETRY_MS',1]);
 // A report that names the running job keeps it live: the job's life is that report's age.
 const live=fixture({id:'live',target:'M',reason:'upgrades and compounds',phase:'processing',commandId:4,heartbeatAt:79999,startedAt:70000});
 live.observe('M',[],{jobId:'live',commandId:4,state:'running',at:100000});assert.equal(live.state.current.id,'live');assert.equal(live.state.current.heartbeatAt,100000);
});
test('completed restock dispatches before evaluating the next job recovery',()=>{
 const f=fixture({id:'restock',target:'M',reason:'restock'});f.ports.restockSatisfied=()=>true;
 f.ports.dispatch=()=>{f.effects.push('dispatch');f.state.current={id:'next',target:'M',reason:'other',phase:'processing',heartbeatAt:100000};};
 f.observe('M',[]);assert.equal(f.state.current.id,'next');assert.equal(f.state.queue.length,0);
 assert.deepEqual(f.effects,[['end','restock-satisfied'],'Merchant potion restock completed','persist','dispatch']);
});


test('anniversary deferral releases ownership once without losing purchase progress',()=>{
 const f=fixture({id:'p',commandId:9,target:'M',reason:'Ponty purchases',phase:'assigned',startedAt:70000,completedListingKeys:['bought']});
 const report={jobId:'p',commandId:9,state:'deferred',reason:'anniversary',at:100000};
 f.slot.commands.M={id:9,jobId:'p',type:'merchant-service'};
 f.observe('M',[],report);f.observe('M',[],report);
 assert.equal(f.state.current,null);assert.equal(f.state.queue.length,1);
 assert.equal(f.slot.commands.M,undefined,'the pause clears the job command from the merchant slot');
 assert.equal(f.state.queue[0].commandId,undefined);
 assert.deepEqual(f.state.queue[0].completedListingKeys,['bought']);
});
test('continuous non-anniversary deferrals cannot reset the watchdog',()=>{
 const f=fixture({id:'p',commandId:9,target:'M',reason:'marked items',phase:'assigned',startedAt:90000});
 f.observe('M',[],{jobId:'p',commandId:9,state:'deferred',reason:'escape',at:100000});
 assert.equal(f.state.current.startedAt,90000);
 f.time(111000);f.observe('M',[],{jobId:'p',commandId:9,state:'deferred',reason:'escape',at:111000});
 assert.equal(f.state.current,null);assert.equal(f.state.queue.length,1);
 assert.equal(f.state.queue[0].retryAt,131000);
});

test('stale command acknowledgements cannot retain a replacement job',()=>{
 const f=fixture({id:'new',commandId:10,target:'M',reason:'Ponty purchases',phase:'assigned',startedAt:70000,recoveryAttempts:20});
 f.observe('M',[],{jobId:'new',commandId:9,state:'deferred',reason:'escape',at:100000});
 assert.equal(f.state.current,null);
});

test('production deferral keeps its actual reason through watchdog requeue',()=>{
 const f=fixture({id:'p',commandId:9,target:'M',reason:'merchant luck',phase:'assigned',startedAt:70000});
 f.observe('M',[],{jobId:'p',commandId:9,state:'deferred',reason:'Production recovery needs review: orphan',at:100000});
 assert.equal(f.state.queue[0].lastDeferredReason,'Production recovery needs review: orphan');
 assert.ok(f.effects.some(message=>typeof message==='string' && message.includes('Command deferred (Production recovery needs review: orphan); retry scheduled')));
 assert.ok(!f.effects.some(message=>typeof message==='string' && message.includes('not acknowledged')));
});

// An unresponsive job is never dropped on a count. Each recovery requeues it on the earlier
// console's wait and names the ladder failure the next claim books, climbing from the job's own
// count.
test('five unresponsive recoveries keep the job queued and climb the ladder to wait', () => {
  const {bookMerchantLadder} = require('../../runtime/merchant-jobs/coordinator/owner.ts');
  let job = { id: 'j', reason: 'manual upgrades', phase: 'processing', startedAt: 1 };
  const booked = [], ladder = { rung: () => 'walk', fail: (code, options) => { booked.push([code, options.from]); return { rung: 'regroup' }; }, progress() {} };
  for (const wait of [20000, 40000, 80000, 160000, 300000]) {
    const f = fixture(job); f.time(1 + 20001);
    f.observe('M');
    const queued = f.state.queue[0];
    assert.equal(queued.retryAt, 1 + 20001 + wait);
    assert.equal(queued.ladderDue, 'job-unresponsive');
    bookMerchantLadder(queued, ladder);
    assert.equal(queued.ladderDue, undefined);
    job = { ...queued, phase: 'processing', startedAt: 1 };
  }
  assert.deepEqual(booked.map(([, from]) => from), ['walk', 'alternative', 'regroup', 'safe-point', 'fall-back']);
});

// The dispatch pass's recovery reads the lifecycle owner's roster answer for the merchant, never the
// time since its last word. An online merchant keeps its job past 180 s; an offline one requeues it,
// and its ALData sale ends through the calls owner without a requeue.
test("only the lifecycle owner's offline answer recovers a silent job, and a sale never replays", () => {
  const job={id:'old',target:'M',reason:'manual upgrades',phase:'processing',startedAt:1,heartbeatAt:1};
  const f=fixture(job);f.time(1000000);f.expire('M');assert.equal(f.state.current,job);
  f.ports.offline=()=>true;f.ports.recovers=()=>false;f.expire('M');assert.equal(f.state.current,job);
  f.ports.recovers=()=>true;f.expire('M');assert.equal(f.state.current,null);assert.equal(f.state.queue[0].resumedFrom,'old');
  const sale=fixture({id:'sale',target:'M',reason:'ALData marketplace sales',phase:'processing',startedAt:1});
  sale.ports.offline=()=>true;sale.expire('M');assert.deepEqual(sale.effects,['sale']);assert.equal(sale.state.queue.length,0);
});
// Every ending's wait holds v1.5.0's values (252, commerce-progress.ts:21,
// recovery.ts:96), and the stopped job's requeue reads its wait from it.
test('J4 answers each ending wait and the stopped job requeue reads row 9 from it',()=>{
 const {ENDINGS,endingWaitMs}=require('../../runtime/merchant-jobs/rules.ts');
 for(const row of ENDINGS)assert.equal(typeof endingWaitMs(row.retryAt,1),'number',row.ending);
 assert.deepEqual([1,2,3,4,5].map(n=>endingWaitMs('commerce',n)),[10000,30000,60000,300000,300000]);
 assert.deepEqual([1,2,5,6].map(n=>endingWaitMs('recovery',n)),[20000,40000,300000,300000]);
 assert.equal(endingWaitMs('ten-seconds'),10000);assert.equal(endingWaitMs('realm'),10000);assert.equal(endingWaitMs('none'),0);
 const f=fixture({id:'quiet',target:'M',reason:'upgrades and compounds',phase:'processing',heartbeatAt:79999,startedAt:70000,recoveryAttempts:2});
 f.observe('M',[]);assert.equal(f.state.queue[0].retryAt,100000+endingWaitMs('recovery',3));
});
