// The production decisions the unit run never reached, one row per failure mode: an upgrade
// pass's journal settle, the bank upgrade refusal, the journal's slot check, the reviewed
// commerce recovery and manual abort, and the lucky slot resume release.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {beginProduction,checkpointProduction,finishProduction,resolveUnknownProduction,abortManualProduction,bankUpgradeRefusal,
 receiveLuckySlotTracking,productionReport}=require('../../runtime/items/coordinator/production.ts');
const sword=level=>({name:'sword',level});
function journalState(extra={}){
 return {merchantCharacter:'M',production:{attempts:{}},autoUpgradeMarks:{},autoCompounds:{},statuses:{M:{inventorySize:4,items:[]}},
  upgrades:{M:[]},merchantQueue:[],merchantCurrent:null,...extra};
}
const pass={passId:'p1',slot:0,item:sword(7),tiers:2,auto:true};
// One upgrade roll from +7 whose complete journal names `pass` and the roll's outcome.
function settle(outcome,{destroyed=false,intent=pass}={}){
 const state=journalState({upgrades:{M:[{...pass}]}});
 beginProduction(state,{id:'a1',item:sword(7),kind:'upgrade'});
 checkpointProduction(state,{id:'a1',journal:{id:'a1',item:sword(7),phase:'complete',slots:[2],outcomeItem:outcome,destroyed,
  request:{kind:'upgrade',automatic:{family:'upgrade',mark:intent}}}});
 finishProduction(state,'a1',true);
 return state.upgrades.M;
}
test('a complete journal settles the pass it names',()=>{
 assert.deepEqual(settle(sword(9)),[],'a pass that reaches its target ends');
 const below=settle(sword(8));
 assert.equal(below.length,1,'a pass below its target stays');assert.equal(below[0].liveSlot,2);assert.deepEqual(below[0].liveItem,sword(8));
 assert.deepEqual(settle(sword(7),{destroyed:true}),[],'a destroyed copy ends its pass');
 assert.equal(settle({name:'bow',level:9}).length,1,'another item\'s outcome leaves the pass');
 assert.equal(settle(sword(9),{intent:{...pass,passId:'p2'}}).length,1,'another pass\'s journal leaves this one');
});
test('a bank upgrade target is refused unless the copy is the merchant\'s upgradeable cell',()=>{
 const state={merchantCharacter:'M',upgrades:{},bankbois:{},bankSnapshot:{packs:{items0:[{slot:3,item:sword(7),meta:{upgradeable:true}}]}}};
 const ask=(body,name='M',item=sword(7))=>bankUpgradeRefusal(state,{pack:'items0',slot:3,upgradeTiers:2,...body},name,item);
 assert.equal(ask({}),null);
 for(const [row,outcome] of [['another character',ask({},'P')],['zero tiers',ask({upgradeTiers:0})],['past the accepted target',ask({upgradeTiers:99})],
  ['a changed copy',ask({},'M',sword(6))],['an empty cell',ask({slot:4})]])assert.ok(outcome,row);
 state.bankSnapshot.packs.items0[0].meta={upgradeable:false};
 assert.ok(ask({}),'a copy the catalog cannot upgrade');
});
test('a journal slot past the merchant\'s bag is refused',()=>{
 const state=journalState(),journal=slots=>({id:'a1',journal:{id:'a1',item:sword(7),phase:'prepared',slots}});
 beginProduction(state,{id:'a1',item:sword(7),kind:'upgrade'});
 assert.throws(()=>checkpointProduction(state,journal([4])),/Invalid production recovery journal/);
 assert.throws(()=>checkpointProduction(state,journal([])),/Invalid production recovery journal/);
 checkpointProduction(state,journal([3]));
 assert.deepEqual(state.production.attempts.a1.journal.slots,[3]);
});
test('a reviewed missing commerce receipt keeps the order\'s paid progress, and only a manual attempt aborts',()=>{
 const job={id:'o1',reason:'commerce',resumeState:{sequence:4,activeItem:sword(7),pendingUpgrade:{slot:0}}};
 const state=journalState({merchantQueue:[job]});
 beginProduction(state,{id:'a1',item:sword(7),kind:'upgrade',journal:{id:'a1',item:sword(7),phase:'running',slots:[0],
  commerce:{key:'party-commerce:o1',sequence:4}}});
 resolveUnknownProduction(state,{id:'a1',item:sword(7),kind:'upgrade',reason:'checked the bag',resumeMissing:true},50);
 assert.equal(job.resumeState.sequence,5);assert.equal(job.resumeState.pendingUpgrade.outcome.reviewedMissing,true);
 assert.equal(job.resumeState.pendingUpgrade.outcome.resolution.at,50);
 const pending=productionReport(state,()=>{})({character:'M',action:'pending'}).body;
 assert.deepEqual(pending.completedCommerce,[],'a receipt with no complete journal is not a completed commerce receipt');
 state.production.attempts.a1.journal.phase='complete';
 assert.deepEqual(productionReport(state,()=>{})({character:'M',action:'pending'}).body.completedCommerce.map(entry=>entry.id),['a1']);
 state.merchantQueue=[];
 assert.deepEqual(productionReport(state,()=>{})({character:'M',action:'pending'}).body.completedCommerce,[],'an order no longer queued');
 const manual=journalState({upgrades:{M:[{requestId:'r1',slot:0,item:sword(7),tiers:1,offering:'offering'}]}});
 beginProduction(manual,{id:'m1',item:sword(7),kind:'upgrade',requestId:'r1',offering:'offering'});
 manual.production.attempts.m2={name:'sword',level:8,kind:'upgrade',rules:[]};
 assert.throws(()=>abortManualProduction(manual,'m2'),/Only an unissued manual offering attempt/);
 abortManualProduction(manual,'m1');
 assert.equal(manual.production.attempts.m1,undefined);
});
test('a lucky slot resume releases once the slot shows more rolls',()=>{
 const report=rolls=>({version:1,streamId:'client-a',slots:{0:{totalRolls:rolls,sumRolls:0.1*rolls,rollsAbove96_3:0,perfectRolls:0}}});
 const state={luckySlotResume:{M:{slot:0,rolls:2}}};
 receiveLuckySlotTracking(state,'M',report(2));
 assert.equal(state.luckySlotTracking.M['client-a'].slots[0].totalRolls,2);
 assert.deepEqual(state.luckySlotResume.M,{slot:0,rolls:2},'the rolls the resume saw');
 assert.equal(receiveLuckySlotTracking(state,'M',report(3)),true);
 assert.equal(state.luckySlotResume.M,undefined);
});
