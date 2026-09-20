const test=require('node:test'),assert=require('node:assert/strict');
const {dispatchRuntime}=require('./helpers/coordinator-dispatch.cjs');
const {installLootClient}=require('../../runtime/combat/departure-loot.ts');
test('full merchant banks authorized deposits before optional purchases and leaves party cleanout queued',()=>{
 const r=dispatchRuntime();r.party.merchantQueue=[{id:'collect',target:'Q',reason:'inventory cleanout'},{id:'buy',target:'M',reason:'Ponty purchases'}];
 r.merchantTransferCapacityBlocked=j=>j.reason==='inventory cleanout';r.dispatchMerchant();
 assert.equal(r.party.commands.M.type,'merchant-self-bank');assert.equal(r.party.commands.M.capacityRecovery,true);
 assert.deepEqual(r.party.commands.M.merchantBankMarked,r.party.marked.M);
 assert.deepEqual(r.party.commands.M.merchantWithdrawals,[]);assert.deepEqual(r.party.commands.M.withdrawals,[]);
 assert.equal(r.party.merchantQueue[0].id,'collect');
 r.party.merchantCurrent=null;r.pickJobByPriority=()=>r.party.merchantQueue.pop();r.dispatchMerchant();assert.notEqual(r.party.commands.M.type,'merchant-self-bank','capacity attempts are bounded');
});
test('capacity recovery does not invent bank permissions for unmarked inventory',()=>{
 const r=dispatchRuntime();r.party.marked.M=[];r.party.merchantQueue=[{id:'collect',target:'Q',reason:'inventory cleanout'}];
 r.merchantTransferCapacityBlocked=()=>true;r.dispatchMerchant();assert.equal(r.party.merchantCurrent,null);
});
test('actual capacity rejection releases farming combat but retains the loot barrier and return protection',()=>{
 const prior=global.setInterval;global.setInterval=()=>0;let api,blocked=true;
 try{
  const mission={cycleId:'bee',currentIndex:0,stage:'farming',target:'arcticbee',participants:['W'],missions:[{target:'arcticbee',owners:['W']}],loot:{id:'drops',complete:false}};
  api=installLootClient({},{departureLootPorts:()=>({name:()=> 'W',quest:()=>({id:'arcticbee',count:0}),cancelled:()=>false,position:()=>({}),capacityBlocked:()=>blocked})});
  api.accept({serverNow:1,monsterHunt:mission});assert.equal(api.huntPending(),false);assert.equal(mission.loot.complete,false);
  blocked=false;assert.equal(api.huntPending(),true);
  blocked=true;api.accept({serverNow:2,monsterHunt:{...mission,stage:'returning'}});assert.equal(api.huntPending(),true);
 }finally{api?.stop();global.setInterval=prior;}
});
