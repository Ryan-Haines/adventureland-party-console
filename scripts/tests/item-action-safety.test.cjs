const {test}=require('node:test');
const assert=require('node:assert/strict');
const {isEquipment,isUsable}=require('../../dashboard/features/party/item-actions.ts');
// The equipment test is the hands owner's (runtime/merchant-hands/character/owner.ts).
const {isDashboardEquipment}=require('../../runtime/merchant-hands/character/owner.ts');
// The recipient's equip of a delivery is the job owner's (runtime/merchant-jobs/character/visits.ts).
const {createMerchantVisits}=require('../../runtime/merchant-jobs/character/visits.ts');
// The dashboard's Use and equip are market.ts's (runtime/items/character/market.ts) on the market
// harness; the game's consume and equip log their slots.
const {marketHarness}=require('./helpers/items-character.cjs');
function fixture(){
 const calls=[],equips=[],definitions={sword:{type:'weapon'},tracktrix:{type:'tracker'},shadowstone:{type:'stone'},fieldgen0:{type:'spawner'},elixir:{type:'elixir'}};
 const character={name:'P',ctype:'warrior',items:[{name:'elixir'}],slots:{}},G={items:definitions,skills:{}};
 globalThis.G=G;
 const {market}=marketHarness({character,G,game:{consume:async slot=>calls.push(slot),equip:async slot=>equips.push(slot)},merchant:{isEquipment:isDashboardEquipment}});
 const context={G,character,isDashboardEquipment,useDashboardItem:market.useDashboardItem,equipDashboardItem:market.equipDashboardItem};
 context.equipDeliveredItems=createMerchantVisits({character:()=>context.character,isEquipment:isDashboardEquipment,sameItemState:context.sameItemState,
  sleep:async()=>{},log(){},equip:slot=>context.equip(slot),unequip:slot=>context.unequip(slot)}).equipDeliveredItems;
 return {context,calls,equips,definitions};
}
test('equipment eligibility excludes consumables and unknown types, and matches the execution guard',()=>{
 const {context,definitions}=fixture();
 for(const [name,definition] of Object.entries(definitions))assert.equal(context.isDashboardEquipment({name}),isEquipment(definition));
 for(const type of ['tracker','stone','spawner','elixir','unknown'])assert.equal(isEquipment({type}),false);
 for(const type of ['weapon','ring','misc_offhand','tool'])assert.equal(isEquipment({type}),true);
 assert.equal(isEquipment(),false);assert.equal(isUsable({type:'elixir'}),true);
 // The Use menu's other three branches, and a plain item it leaves out.
 assert.equal(isUsable({type:'licence'}),true);assert.equal(isUsable({type:'spawner'}),true);
 assert.equal(isUsable({type:'box',gives:[['hp',100]]}),true);assert.equal(isUsable({type:'material'}),false);
});
test('stale delivery equipment requests reject non-equipment before any game action',async()=>{
 const {context,calls}=fixture();
 const results=await context.equipDeliveredItems([{name:'fieldgen0'},{name:'tracktrix'},{name:'shadowstone'},{name:'elixir'}]);
 assert.equal(results.length,4);assert.ok(results.every(result=>result.success===false&&result.error==='item is not equipment'));assert.deepEqual(calls,[]);
});
test('explicit Use consumes the selected item and rejects stale slots or unsupported items',async()=>{
 const {context,calls}=fixture();
 await context.useDashboardItem({slot:0,item:{name:'elixir'}});assert.deepEqual(calls,[0]);
 await assert.rejects(context.useDashboardItem({slot:0,item:{name:'fieldgen0'}}),/no longer matches/);
 context.character.items[0]={name:'sword'};
 await assert.rejects(context.useDashboardItem({slot:0,item:{name:'sword'}}),/no supported Use/);
 assert.deepEqual(calls,[0]);
});

// Manual equipment recovery isolation: native items can omit null metadata
// present in a previously rendered inventory command. Missing stock must report
// a failed selection instead of silently acknowledging an equip that never ran.
test('manual orb equip normalizes legacy null metadata and reports missing inventory',async()=>{
 const {context,equips:calls}=fixture();context.G.items.cave_loaded_die={type:'orb'};
 context.character.items=[{name:'cave_loaded_die',level:0}];
 await context.equipDashboardItem({item:{name:'cave_loaded_die',level:0,p:null}});
 assert.deepEqual(calls,[0]);
 context.character.items=[];
 await assert.rejects(context.equipDashboardItem({item:{name:'cave_loaded_die',level:0}}),/no longer.*inventory/);
 assert.deepEqual(calls,[0]);
});

// The merchant's give meets the player first. A meet that fails at SEND_MEET_MS is the player never
// coming, which reports the bound; a meet that ends early (a newer command) reports nothing.
test('a give whose meet runs out its deadline reports SEND_MEET_MS; an interrupted meet does not',async()=>{
 const {boundsPending,boundsSent}=require('../../runtime/status/api.ts');
 boundsSent(boundsPending().length);
 const character={name:'M',ctype:'merchant',items:[{name:'elixir'}],slots:{}},G={items:{elixir:{type:'elixir'}},skills:{}};
 let meet=async()=>{throw new Error('P rendezvous timed out');};
 const sends=[],h=marketHarness({character,G,game:{sendItem:async(...args)=>sends.push(args)},
  reads:{waitForPlayer:async(name,timeout)=>{h.clock.now+=timeout;return meet(name,timeout);}}});
 await assert.rejects(h.market.giveDashboardItem({slot:0,item:{name:'elixir'},target:'P'}),/timed out/);
 assert.deepEqual(boundsPending().map(firing=>[firing.bound,firing.owner,firing.state.player]),[['SEND_MEET_MS','10','P']]);
 assert.equal(sends.length,0);
 boundsSent(boundsPending().length);
 meet=async()=>{throw Object.assign(new Error('interrupted'),{code:'interrupted'});};
 h.p.reads.waitForPlayer=async(name,timeout)=>meet(name,timeout);
 await assert.rejects(h.market.giveDashboardItem({slot:0,item:{name:'elixir'},target:'P'}),/interrupted/);
 assert.deepEqual(boundsPending(),[]);
});
