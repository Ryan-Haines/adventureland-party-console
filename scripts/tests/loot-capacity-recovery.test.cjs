const test=require('node:test'),assert=require('node:assert/strict');
const {dispatchRuntime}=require('./helpers/coordinator-dispatch.cjs');
const {installLootClient}=require('../../runtime/hunting/character/loot.ts');
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
// The loot client as loot.ts installs it: under the hunting owner's run scope, with its game ports and the
// character's socket, and the merchant cleanout's capacity block where loot.ts reads it
// (root.partyLootStatus).
test('actual capacity rejection releases farming combat but retains the loot barrier and return protection',()=>{
 const {processScope}=require('./helpers/run-scope.cjs');processScope();
 const listeners=new Map(),socket={on:(event,fn)=>listeners.set(event,fn),off:event=>listeners.delete(event)};
 const root={partyLootStatus:{capacityBlocked:true}};let api;
 try{
  const mission={cycleId:'bee',currentIndex:0,stage:'farming',target:'arcticbee',participants:['W'],missions:[{target:'arcticbee',owners:['W']}],loot:{id:'drops',complete:false}};
  api=installLootClient(root,{lootPorts:()=>({name:()=>'W',quest:()=>({id:'arcticbee',count:0}),positions:()=>[],clockOffset:()=>0,
   character:()=>({name:'W',map:'main',in:'main',x:0,y:0}),frame:()=>({entities:{}}),navigationCancelled:()=>false,escaping:()=>false,eventJoined:()=>false,
   defending:()=>false,passing:()=>false,engaged:()=>false,chests:()=>[],socket:()=>socket})});
  api.accept({serverNow:1,monsterHunt:mission});assert.equal(api.huntPending(),false);assert.equal(mission.loot.complete,false);
  root.partyLootStatus.capacityBlocked=false;assert.equal(api.huntPending(),true);
  root.partyLootStatus.capacityBlocked=true;api.accept({serverNow:2,monsterHunt:{...mission,stage:'returning'}});assert.equal(api.huntPending(),true);
 }finally{api?.stop();}
});
