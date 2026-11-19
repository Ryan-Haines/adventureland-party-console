// The offering supply's authorization chain: the job and command checks, manual, automatic
// and bank continuation admission, and ruleRoom's -1 and finite quantities.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createExchangeRequests}=require('../../runtime/items/coordinator/production.ts');
const sword=level=>({name:'sword',level});
function supply({items=[{slot:0,item:sword(7)}],upgrades=[],saved=upgrades,bankUpgradeRules,autoRules={},queued=true}={}){
 const state={merchantCharacter:'M',merchantCurrent:{id:'j1',commandId:7,target:'M',reason:'upgrade'},statuses:{M:{items}},
  commands:{M:{id:7,upgrades,bankUpgradeRules}},upgrades:{M:saved},autoUpgradeMarks:{M:autoRules},
  upgradeOfferingRules:[{id:'primling',name:'sword',floor:7,ceiling:9,offering:'offeringp',required:true}]};
 const asked=[];
 const answer=createExchangeRequests(state,{persist(){},queueOffering:(offering,quantity)=>{asked.push([offering,quantity]);return queued;}}).offeringSupply;
 const ask=(mark,extra={})=>answer({jobId:'j1',commandId:7,offering:'offeringp',item:sword(7),mark,...extra});
 return {state,asked,ask};
}
const manual={slot:0,item:sword(7),tiers:2,auto:false};
const automatic={slot:0,item:sword(7),tiers:2,auto:true};
test('the offering supply admits only the current job, its command and a live authorized mark',()=>{
 const rows=[
  ['a manual mark the command admitted and the player saved',supply({upgrades:[manual]}),manual,{},200],
  ['a stale job',supply({upgrades:[manual]}),manual,{jobId:'old'},409],
  ['another command',supply({upgrades:[manual]}),manual,{commandId:8},409],
  ['a mark the command never admitted',supply({upgrades:[],saved:[manual]}),manual,{},409],
  ['a manual mark the player removed',supply({upgrades:[manual],saved:[]}),manual,{},409],
  ['a copy no longer in the bag',supply({upgrades:[manual],items:[]}),manual,{},409],
  ['an automatic mark under its rule',supply({upgrades:[automatic],autoRules:{'sword@+7':{tiers:2,quantity:1}}}),automatic,{},200],
  ['an automatic mark whose rule ran out',supply({upgrades:[automatic],autoRules:{'sword@+7':{tiers:2,quantity:0}}}),automatic,{},409],
 ];
 for(const [row,f,mark,extra,status] of rows)assert.equal(f.ask(mark,extra).status||200,status,row);
});
test('the admitted demand is the offering steps left, queued once',()=>{
 const f=supply({upgrades:[manual]}),answer=f.ask(manual);
 assert.equal(answer.body.pending,true);assert.equal(answer.body.outstanding,2);assert.deepEqual(f.asked,[['offeringp',2]]);
 assert.equal(f.state.merchantCurrent.offeringSupply.state,'pending');
 const none=supply({upgrades:[manual],queued:false}).ask(manual);
 assert.equal(none.body.pending,false);assert.equal(none.body.state,'unavailable');
});
test('bank continuations mark the bag copies each bank rule has room for',()=>{
 const items=[{slot:0,item:sword(7)},{slot:1,item:sword(7)},{slot:2,item:sword(7)}];
 for(const [row,quantity,marked] of [['quantity -1 marks every copy',-1,3],['a finite quantity marks up to it',2,2]]){
  const rule={name:'sword',level:7,tiers:2,quantity};
  const f=supply({items,upgrades:[],saved:[],bankUpgradeRules:[rule],autoRules:{'sword@+7':{tiers:2,quantity}}});
  assert.equal(f.ask(automatic).status||200,200,row);
  assert.equal(f.state.commands.M.upgrades.length,marked,row);
  assert.equal(f.state.upgrades.M.length,marked,row);
 }
});
