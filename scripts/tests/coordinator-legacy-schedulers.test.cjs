const test=require('node:test'),assert=require('node:assert/strict');
const {createLuckScheduler}=require('../../runtime/coordinator/merchant/luck-scheduler.ts');
const {createBankQueue}=require('../../runtime/coordinator/inventory/bank-queue.ts');
function luck(){const state={merchantCharacter:'M',merchantAutomations:{},merchantCurrent:null,merchantQueue:[],statuses:{M:{name:'M',level:40,seenAt:100000,server:'II',ctype:'merchant'},F:{name:'F',server:'II'},Other:{name:'Other',server:'I'}}},calls=[];
 const service=createLuckScheduler(state,{now:()=>100000,nextCommand:()=>1,names:()=>Object.keys(state.statuses),strong:s=>s.strong,remaining:s=>s.name==='M'?0:10000,lead:()=>30000,persist:()=>calls.push('persist'),dispatch:()=>calls.push('dispatch'),log:(...args)=>calls.push(args)});
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
