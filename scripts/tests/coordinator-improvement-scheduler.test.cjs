// Native merchant status always reports all 42 inventory slots.
const nativeInventory=(items=[])=>items.concat(Array(42-items.length).fill(null));
const {withDoor}=require('./helpers/coordinator-merchant.cjs');
const test=require('node:test'),assert=require('node:assert/strict');
const {createImprovementScheduler}=require('../../runtime/items/coordinator/production.ts');
function fixture(){const state={merchantCharacter:'M',merchantAutomations:{},bankSnapshot:{packs:{}},autoCompounds:{},autoExchanges:{},merchantCatalog:{exchangeable:[]},merchantCurrent:null,merchantQueue:[]},calls=[];
 const service=createImprovementScheduler(Object.assign(state,{production:state.production||{attempts:{}}}),withDoor(state,{now:()=>100,nextCommand:()=>1,stamp:job=>({...job,priority:9}),queue:(...args)=>calls.push(args),persist:()=>calls.push('persist'),log:(...args)=>calls.push(args)}));
 return {state,calls,service};}
const ring=level=>({item:{name:'ring',level}});
const stored=(slot,level=0)=>({slot,...ring(level)});
test('bankboi ingredients stage one missing triple and repeated observations do not duplicate it',()=>{
 const f=fixture();f.state.autoCompounds.M=[{name:'ring',targetTier:2}];
 f.state.bankbois={B:{name:'B',items:[stored(0),stored(1),stored(2),stored(3)]}};
 assert.equal(f.service.compound('M',{items:nativeInventory([ring(0)])}),false);
 assert.deepEqual(f.state.withdrawals.M.map(x=>[x.pack,x.slot]),[['bankboi:B',0],['bankboi:B',1]]);
 f.service.compound('M',{items:nativeInventory([ring(0)])});assert.equal(f.state.withdrawals.M.length,2);
 // Normal-bank staging is still an outstanding withdrawal, so it cannot trigger another batch.
 f.state.withdrawals.M=f.state.withdrawals.M.map(x=>({...x,pack:'items1'}));
 f.service.compound('M',{items:nativeInventory([ring(0)])});assert.equal(f.state.withdrawals.M.length,2);
});
test('bankboi selection prefers highest complete triple and excludes locked ingredients',()=>{
 const f=fixture();f.state.autoCompounds.M=[{name:'ring',targetTier:3}];
 f.state.bankbois={B:{name:'B',items:[stored(0,0),stored(1,0),stored(2,0),stored(3,2),
  {slot:4,item:{name:'ring',level:2,l:'l'}},stored(5,2)]}};
 f.service.compound('M',{items:nativeInventory([ring(2)])});
 assert.deepEqual(f.state.withdrawals.M.map(x=>x.slot),[3,5]);
});
test('incomplete mixed levels and party character rules do not retrieve bankboi items',()=>{
 const f=fixture();f.state.autoCompounds={M:[{name:'ring',targetTier:7}],F:[{name:'ring',targetTier:7}]};
 f.state.bankbois={B:{name:'B',items:[stored(0,6),stored(1,6)]}};
 assert.equal(f.service.compound('M',{items:nativeInventory([ring(0)])}),true); // Bank the leftover; do not retrieve an incomplete group.
 assert.equal(f.service.compound('F',{items:nativeInventory([ring(6)])}),true);
 assert.deepEqual(f.calls.at(-1),[['F'],'marked items']);
 assert.equal(f.state.withdrawals,undefined);
});
test('completed quota remains saved and active work defers retrieval',()=>{
 const f=fixture();f.state.autoCompounds.M=[{name:'ring',targetTier:2,quantity:0}];
 f.state.bankbois={B:{name:'B',items:[stored(0,2),stored(1),stored(2),stored(3)]}};
 assert.equal(f.service.compound('M',{items:nativeInventory([])}),false);assert.equal(f.state.autoCompounds.M[0].quantity,0);
 assert.equal(f.state.withdrawals,undefined);
 f.state.autoCompounds.M=[{name:'ring',targetTier:2}];f.state.merchantCurrent={reason:'auto compound'};
 assert.equal(f.service.compound('M',{items:nativeInventory([])}),false);assert.equal(f.state.withdrawals,undefined);
 f.state.merchantCurrent=null;f.state.bankboiTransaction={};
 f.service.compound('M',{items:nativeInventory([])});assert.equal(f.state.withdrawals,undefined);
});
test('improvement commands preserve remaining quota regardless of owned stock',()=>{
 const {ownMerchantCommand,partyMerchantCommand}=require('../../runtime/merchant-jobs/coordinator/commands.ts');
 const work={autoCompounds:[{name:'ring',targetTier:2,quantity:3}],upgrades:[],purchases:[],
  statScrolls:[],compounds:[],withdrawals:[],marked:[],deliveries:[]};
 const inputs={merchant:'M',workingGold:0,visitWithdrawals:()=>[],work:()=>work,restock:()=>({}),statScrolls:{},
  bankboiItems:[ring(2),ring(3),ring(1),{item:{name:'other',level:3}}]};
 const job={id:'job',target:'M',reason:'auto compound'};
 assert.equal(ownMerchantCommand(1,job,inputs).autoCompounds[0].quantity,3);
 assert.deepEqual(partyMerchantCommand(1,{...job,target:'F'},{items:[ring(2)]},inputs).autoCompounds,[]);
});
test('merchant compound uses bank triplets while ordinary characters use their own bags',()=>{
 const f=fixture();f.state.autoCompounds={M:[{name:'ring',targetTier:2}],F:[{name:'ring',targetTier:2}]};f.state.bankSnapshot.packs.items1=[ring(0),ring(0)];
 assert.equal(f.service.compound('M',{items:nativeInventory([ring(0)])}),true);assert.deepEqual(f.calls,[[['M'],'auto compound']]);
 assert.equal(f.service.compound('F',{items:nativeInventory([ring(0)])}),true);
 assert.deepEqual(f.calls.at(-1),[['F'],'marked items']);
});
test('existing finished items do not satisfy a production quota',()=>{
 const f=fixture();f.state.autoCompounds.M=[{name:'ring',targetTier:2,quantity:1},{name:'ring',targetTier:3}];
 assert.equal(f.service.compound('M',{items:nativeInventory([ring(2),ring(0),ring(0),ring(0)])}),true);
 assert.equal(f.state.autoCompounds.M.length,2);assert.equal(f.state.autoCompounds.M[0].quantity,1);assert.deepEqual(f.calls[0],[['M'],'auto compound']);
});
test('exchange combines bank quantities, stamps one job, and respects existing exchange work',()=>{
 const f=fixture();f.state.autoExchanges={'leather@0':{name:'leather'}};f.state.merchantCatalog.exchangeable=[{id:'leather',required:10}];
 f.state.bankSnapshot.packs.items1=[{item:{name:'leather',q:18}}];const status={name:'M',items:[{item:{name:'leather',q:7}}]};
 assert.equal(f.service.exchange(status),true);assert.deepEqual(f.state.merchantQueue[0].exchanges,[{id:'leather',level:0,quantity:2}]);assert.equal(f.state.merchantQueue[0].priority,9);
 assert.equal(f.service.exchange(status),false);f.state.merchantQueue=[];f.state.merchantCurrent={reason:'exchange'};assert.equal(f.service.exchange(status),false);
});
test('disabled improvements and nonmerchant exchange reports do not mutate work',()=>{
 const f=fixture();f.state.autoExchanges={'leather@0':{name:'leather'}};f.state.merchantCatalog.exchangeable=[{id:'leather',required:10}];
 f.state.bankSnapshot.packs.items1=[{item:{name:'leather',q:18}}];const stack={name:'M',items:[{item:{name:'leather',q:7}}]};
 // The planted stack is exchangeable, so only the switch can make exchange answer false.
 f.state.merchantAutomations={'automatic exchange':false,'auto compound':false};
 assert.equal(f.service.compound('M',{items:nativeInventory([])}),false);assert.equal(f.service.exchange(stack),false);
 f.state.merchantAutomations={};assert.equal(f.service.exchange({...stack,name:'F'}),false);assert.equal(f.service.compound('M',null),false);assert.deepEqual(f.calls,[]);
 assert.deepEqual(f.state.merchantQueue,[]);
 assert.equal(f.service.exchange(stack),true,'with the switch on the same stack queues an exchange');
});
test('missing bank panes and empty entries do not hide a valid compound triplet',()=>{
 const f=fixture();
 f.state.autoCompounds.M=[{name:'ring',targetTier:2}];
 f.state.bankSnapshot.packs={items0:undefined,items1:[null,ring(0),ring(0)]};
 assert.equal(f.service.compound('M',{items:nativeInventory([ring(0)])}),true);
 assert.deepEqual(f.calls,[[['M'],'auto compound']]);
 assert.equal(f.state.bankSnapshot.packs.items0,undefined);
});
// A Ponty job queued on SR_USII before a party realm switch to SR_EUI is built after
// the switch, so its trip home goes to SR_EUI, with no hop pair.
test('a command built after a party realm switch names the new home',()=>{
 const {ownMerchantCommand}=require('../../runtime/merchant-jobs/coordinator/commands.ts');
 const work={autoCompounds:[],upgrades:[],purchases:[],statScrolls:[],compounds:[],withdrawals:[],marked:[],deliveries:[]};
 const inputs={merchant:'M',activeRealm:'SR_EUI',workingGold:0,visitWithdrawals:()=>[],work:()=>work,restock:()=>({}),statScrolls:{},bankboiItems:[]};
 const job={id:'job',target:'M',reason:'Ponty purchases',homeRealm:'SR_USII'};
 assert.equal(ownMerchantCommand(1,job,inputs).aldataHomeRealm,'SR_EUI');
});

// The merchant's command target is the items owner's working
// gold, so the errands keep it between jobs.
test('the command target is the working gold', () => {
  const { ownMerchantCommand } = require('../../runtime/merchant-jobs/coordinator/commands.ts');
  const inputs = workingGold => ({ merchant: 'M', activeRealm: 'SR_USII', aldataKey: '', threshold: 0, gatheringModes: [], cargo: null,
    npcSales: [], standListings: [], statScrolls: {}, workingGold, visitWithdrawals: () => [], work: () => ({ withdrawals: [], marked: [], goldTarget: 0 }), restock: () => null });
  const job = { id: 'j', target: 'M', reason: 'manual upgrades' };
  for (const gold of [250000, 400000, 0]) {
    const command = ownMerchantCommand(1, job, inputs(gold));
    assert.deepEqual([command.merchantGoldTarget, command.goldTarget], [gold, gold]);
  }
});


// Dispatch line: the line is the kind's record, with v1.5.0's wording for the automatic NPC sale
// stock and an add-on kind's own label.
test('the dispatch line reads the kind record, an add-on label included', () => {
  const { ownCommandDescription } = require('../../runtime/merchant-jobs/coordinator/commands.ts');
  const { admitAddonKinds, addonReason } = require('../../runtime/merchant-jobs/rules.ts');
  assert.equal(ownCommandDescription({ id: 'a', reason: 'auto npc withdrawals' }), 'Merchant dispatched to retrieve bank stock for automatic NPC sales');
  assert.equal(ownCommandDescription({ id: 'b', reason: 'stand search', itemId: 'ring' }), 'Merchant searching player stands for ring');
  admitAddonKinds([{ addon: 'probe', answer: [{ kind: 'polish', command: 'merchant-self-bank', realm: 'home', label: 'polishing rings', priority: 5 }] }]);
  assert.equal(ownCommandDescription({ id: 'c', reason: addonReason('probe', 'polish') }), 'Merchant dispatched for polishing rings');
  admitAddonKinds([]);
});
