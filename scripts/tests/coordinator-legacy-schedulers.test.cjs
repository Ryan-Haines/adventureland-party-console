const {withDoor}=require('./helpers/coordinator-merchant.cjs');
const test=require('node:test'),assert=require('node:assert/strict');
const {createLuckScheduler,hasStrongMluck}=require('../../runtime/merchant-jobs/coordinator/sources.ts');
const {createBankQueue}=require('../../runtime/items/coordinator/storage.ts');
function luck(){const state={merchantCharacter:'M',merchantAutomations:{},merchantCurrent:null,merchantQueue:[],statuses:{M:{name:'M',level:40,seenAt:100000,server:'II',ctype:'merchant'},F:{name:'F',server:'II'},Other:{name:'Other',server:'I'}}},calls=[];
 const service=createLuckScheduler(state,withDoor(state,{now:()=>100000,nextCommand:()=>1,names:()=>Object.keys(state.statuses),strong:s=>s.strong,remaining:s=>s.name==='M'?0:10000,lead:()=>30000,persist:()=>calls.push('persist'),dispatch:()=>calls.push('dispatch'),log:(...args)=>calls.push(args)}));
 return {state,calls,service};}
test('Luck schedules one party itinerary even when the merchant is due first',()=>{
 const f=luck();f.service.schedule();assert.equal(f.state.merchantQueue[0].target,'F');assert.equal(f.state.merchantQueue[0].expandLuckCluster,true);assert.equal(f.state.merchantQueue[0].castMerchantLuck,true);assert.deepEqual(f.calls.slice(-2),['persist','dispatch']);
 f.service.schedule();assert.equal(f.state.merchantQueue.length,1);
});
test('Luck timing projection preserves merchant tie priority and excludes unavailable recipients',()=>{
 const f=luck();assert.equal(f.service.snapshot().target,'M');f.state.statuses.F.rip=true;f.state.statuses.M.strong=true;assert.equal(f.service.snapshot(),null);
});
test('Luck rejects stale, low-level, disabled, and already queued exchange work',()=>{
 const f=luck();f.state.statuses.M.seenAt=1;f.service.schedule();f.state.statuses.M.seenAt=100000;f.state.statuses.M.level=39;f.service.schedule();assert.equal(f.state.merchantQueue.length,0);
 f.state.statuses.M.level=40;f.state.merchantAutomations['merchant luck']=false;assert.equal(f.service.schedule(),false);
 f.state.merchantAutomations['merchant luck']=true;f.state.merchantQueue.push({reason:'merchant luck exchange'});f.service.schedule();assert.equal(f.state.merchantQueue.length,1);
});
test('bank queue deduplicates per character and job type while serializing dispatch',()=>{
 const state={bankCurrent:null,bankQueue:[],bankStartedAt:0,location:{map:'cave'},commands:{},upgrades:{F:['upgrade']},purchases:{},compounds:{},marked:{F:['bank']},withdrawals:{},goldTargets:{F:0}};let id=1;
 const service=createBankQueue(state,{now:()=>100,nextCommand:()=>id++});service.queue(['F','F']);service.queue(['F']);service.queue(['F'],'upgrade');
 assert.deepEqual(state.bankQueue,[{name:'F',type:'upgrade'}]);assert.equal(state.commands.F.type,'bank');assert.equal(state.commands.F.goldTarget,0);assert.equal(state.bankStartedAt,100);
 state.bankCurrent=null;service.dispatch();assert.equal(state.commands.F.type,'upgrade');assert.deepEqual(state.commands.F.items,['upgrade']);assert.equal(state.commands.F.returnLocation,state.location);
});
// Our own luck is always strong, so the old skip left a fighter with 1 s of our luck unrefreshed
// against a 60 s lead; another merchant's strong luck stays.
test('our own strong luck is refreshed on its lead, and another merchant\'s strong luck is left alone',()=>{
 const own={name:'F',server:'II',conditions:[{id:'mluck',source:'M',live:{strong:true}}]};
 const other={name:'F',server:'II',conditions:[{id:'mluck',source:'Rival',live:{strong:true}}]};
 assert.deepEqual([hasStrongMluck(own,'M'),hasStrongMluck(other,'M')],[false,true]);
 const f=luck();f.state.statuses.F={...own};
 const service=createLuckScheduler(f.state,withDoor(f.state,{now:()=>100000,nextCommand:()=>1,names:()=>Object.keys(f.state.statuses),strong:s=>hasStrongMluck(s,'M'),
  remaining:s=>s.name==='F'?1000:3_600_000,lead:()=>60000,persist(){},dispatch(){},log(){}}));
 assert.equal(service.snapshot().target,'F','the fighter with 1 s of our luck is next, due now');
 assert.equal(service.snapshot().dispatchInMs,0);
 f.state.statuses.F={...other};
 assert.notEqual(service.snapshot()?.target,'F','another merchant\'s strong luck is not overwritten');
});
// Reproduced on v1.5.0. The items owner's bank dispatch wrote over the
// events owner's unapplied event-resume-travel, the return's reconcile wrote it back over the bank
// command, and the present holder never freed the bank slot. The rows: the writer's refused and
// written pairs, then the bank visit waits behind the return and runs once the return ends, and a
// return written over a running visit frees the slot and puts the visit back at the queue's head.
test('one slot writer ranks a write over a retained command, and the bank queue never stalls behind an event return',()=>{
 const {writeSlot}=require('../../runtime/status/api.ts');
 const {bankVisitStalled}=require('../../runtime/items/coordinator/storage.ts');
 const {merchantSlotCommand}=require('../../runtime/merchant-jobs/coordinator/api.ts');
 const resume={id:1,type:'event-resume-travel',cycleId:'e'},town={id:2,type:'town-party'};
 const rows=[
  ['bank over an event return',resume,{id:9,type:'bank'},'refused'],
  ['an event return over Town',town,{id:9,type:'event-return-town'},'refused'],
  ['an event-return walk over Town',town,{id:9,type:'party-monster-travel',requester:{tier:'event-return'}},'refused'],
  ['an event return over bank',{id:3,type:'bank'},{id:9,type:'event-resume-travel'},'written'],
  ['the return\'s next leg over its own',resume,{id:9,type:'event-resume-travel',cycleId:'e'},'written'],
  ['an unranked command over a retained one',resume,{id:9,type:'use-item'},'written'],
 ];
 for(const [row,held,command,answer] of rows){const commands={F:held};
  assert.equal(writeSlot(commands,'F',command),answer,row);assert.equal(commands.F,answer==='written'?command:held,row);}
 const state={bankCurrent:null,bankQueue:[],bankStartedAt:0,location:{map:'main'},commands:{F:{...resume}},upgrades:{},purchases:{},compounds:{},
  marked:{F:['coat']},withdrawals:{},goldTargets:{F:0},statuses:{F:{name:'F',seenAt:Date.now()}}};let id=10;
 const queue=createBankQueue(state,{now:()=>100,nextCommand:()=>id++});
 queue.queue(['F']);
 assert.equal(state.commands.F.type,'event-resume-travel','the bank visit leaves the return its slot');
 assert.deepEqual([state.bankCurrent,state.bankQueue],[null,[{name:'F',type:'bank'}]]);
 merchantSlotCommand(state,'event:e',null,'F');queue.dispatch();
 assert.equal(state.commands.F.type,'bank');assert.deepEqual(state.bankCurrent,{name:'F',type:'bank'});
 assert.equal(bankVisitStalled(state,Date.now()),null,'a present holder running its visit holds the slot');
 assert.equal(merchantSlotCommand(state,'event:e2',{id:id++,type:'event-resume-travel',cycleId:'e2'},'F'),'written');
 assert.equal(bankVisitStalled(state,Date.now()),'slot-taken','a return written over the visit frees the bank slot');
});
