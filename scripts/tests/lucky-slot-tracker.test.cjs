const test=require('node:test'),assert=require('node:assert/strict');
const {createLuckySlotTracker}=require('../../runtime/items/character/production.ts');
function event(slot=7,nums=[4,3,2,1],ms=2000) {
 return {num:slot,p:{nums,name:'sword',level:0,scroll:'scroll0',chance:0.99},q:{upgrade:{num:slot,ms,len:10000}}};
}
function fixture(initial=null){let saved=initial,now=1000;
 const ports={read:()=>saved,write:value=>saved=structuredClone(value),now:()=>now,size:()=>42,isUpgradeScroll:name=>/^scroll[0-3]$/.test(name)};
 return {ports,tracker:createLuckySlotTracker(ports),advance:ms=>now+=ms,get saved(){return saved;}};
}

test('account ID bindings retain migration evidence and reset all lucky state for same-name recreation',()=>{
 const {receiveLuckySlotTracking}=require('../../runtime/items/coordinator/production.ts');
 const f=fixture();f.tracker.observe(event());const report=f.tracker.report();
 const state={luckySlotTracking:{M:{[report.streamId]:report}},luckyUpgradeSlots:{M:7},luckySlotLocks:{M:7},luckySlotResume:{M:{slot:8,rolls:1}}};
 assert.equal(receiveLuckySlotTracking(state,'M',null,'CH_old'),true);
 assert.equal(state.luckyUpgradeSlots.M,7);assert.equal(state.luckySlotCharacterIds.M,'CH_old');
 assert.equal(receiveLuckySlotTracking(state,'M',report,'CH_old','CH_old'),false);
 assert.equal(receiveLuckySlotTracking(state,'M',report,'CH_new','CH_old'),true);
 for(const key of ['luckySlotTracking','luckyUpgradeSlots','luckySlotLocks','luckySlotResume'])assert.equal(state[key].M,undefined);
 assert.equal(receiveLuckySlotTracking(state,'M',report,'CH_new','CH_old'),false);
 assert.equal(receiveLuckySlotTracking(state,'M',report,'CH_new','CH_new'),true);
});

test('verified account ID rename moves its own evidence and positions',()=>{
 const {receiveLuckySlotTracking}=require('../../runtime/items/coordinator/production.ts');
 const state={luckySlotCharacterIds:{Old:'CH_same'},luckySlotTracking:{Old:{}},luckyUpgradeSlots:{Old:7},luckySlotLocks:{Old:6},luckySlotResume:{Old:{slot:8,rolls:1}}};
 receiveLuckySlotTracking(state,'New',null,'CH_same');
 assert.equal(state.luckyUpgradeSlots.New,7);assert.equal(state.luckySlotLocks.New,6);assert.deepEqual(state.luckySlotResume.New,{slot:8,rolls:1});
 assert.equal(state.luckySlotCharacterIds.Old,undefined);assert.equal(state.luckyUpgradeSlots.Old,undefined);
});

// The character's tracker (production.ts `tracking`) keys its storage by owner and account ID; Table A's
// `lucky-settings` reply binds the ID.
function luckyCharacter(ports={}){
 const {productionHarness}=require('./helpers/items-character.cjs');
 return productionHarness({character:{owner:'owner',name:'M',items:Array(42).fill(null)},G:{items:{scroll0:{type:'uscroll'}},skills:{}},ports});
}
const bind=(production,id)=>production.luckyReply({luckySlotCharacterIds:{M:id}});
test('client lucky tracking uses account ID storage and never reloads name-only history',()=>{
 const {production,stored}=luckyCharacter();
 bind(production,'CH_old');production.tracking().observe(event());
 bind(production,'CH_new');assert.deepEqual(JSON.parse(JSON.stringify(production.tracking().report().slots)),{});
 assert.deepEqual(Object.keys(stored).filter(key=>key.startsWith('party-lucky-slot-tracking:')),['party-lucky-slot-tracking:owner:CH_old','party-lucky-slot-tracking:owner:CH_new']);
});
test('records reversed digits by physical slot, including zero and high rolls',()=>{
 const f=fixture();f.tracker.observe(event(0));f.tracker.observe(event(41,[9,9,9,9]));f.tracker.observe(event(7,[0,0,0,0]));
 assert.deepEqual(f.tracker.report().slots,{
  0:{totalRolls:1,sumRolls:0.1234,rollsAbove96_3:0,perfectRolls:0},
  41:{totalRolls:1,sumRolls:0.9999,rollsAbove96_3:1,perfectRolls:0},
  7:{totalRolls:1,sumRolls:0,rollsAbove96_3:0,perfectRolls:1}});
});
test('counts a completed roll once across later success packets and CODE reload',()=>{
 const f=fixture();assert.equal(f.tracker.observe(event()),true);f.advance(500);
 const repeated=event(7,[4,3,2,1],1500);repeated.p.success=true;
 assert.equal(f.tracker.observe(repeated),false);
 f.advance(86400000);const reloaded=createLuckySlotTracker(f.ports);assert.equal(reloaded.observe(repeated),false);
 assert.equal(reloaded.report().slots[7].totalRolls,1);
});
test('a managed new attempt can record the same complete roll without any partial reveals',()=>{
 const f=fixture();f.tracker.observe(event(7,[0,0,0,0],0));f.tracker.begin();f.tracker.observe(event(7,[0,0,0,0],0));
 assert.equal(f.tracker.report().slots[7].totalRolls,2);
});
test('same roll in a new operation counts again after partial digits or reset timer',()=>{
 const f=fixture();f.tracker.observe(event());f.tracker.observe(event(7,[4]));f.tracker.observe(event());
 f.tracker.observe(event(7,[4,3,2,1],2500));assert.equal(f.tracker.report().slots[7].totalRolls,3);
});
test('malformed, partial, out-of-range, and compound packets do not count',()=>{
 const f=fixture();const compound=event();compound.q={compound:{num:7,ms:2000,len:10000,nums:[]}};
 for(const packet of [null,{},event(-1),event(42),event('7'),event(7,[1]),event(7,[1,2,3,10]),event(7,[1,2,3,null]),event(7,[1,2,3,4,5]),compound,{...event(),q:{}}])assert.equal(f.tracker.observe(packet),false);
 assert.deepEqual(f.tracker.report().slots,{});
});
test('legacy digit strings are decoded and threshold is strictly above 0.963',()=>{
 const f=fixture();f.tracker.observe(event(0,['0','3','6','9']));f.tracker.observe(event(1,[1,3,6,9]));
 assert.equal(f.tracker.report().slots[0].rollsAbove96_3,0);assert.equal(f.tracker.report().slots[1].rollsAbove96_3,1);
});
test('storage failures do not throw and malformed saved statistics are ignored',()=>{
 const tracker=createLuckySlotTracker({read:()=>{throw Error('storage denied')},write:()=>{throw Error('quota')},now:()=>0,size:()=>42,isUpgradeScroll:name=>name==='scroll0'});
 assert.equal(tracker.observe(event()),true);assert.equal(tracker.report().slots[7].totalRolls,1);
 const f=fixture({slots:{7:{totalRolls:0},42:{totalRolls:1,sumRolls:0,rollsAbove96_3:0,perfectRolls:1}}});
 assert.deepEqual(f.tracker.report().slots,{});
});
test('reports cannot mutate state and different storage namespaces do not share statistics',()=>{
 const a=fixture(),b=fixture();a.tracker.observe(event());const report=a.tracker.report();report.slots[7].totalRolls=99;
 assert.equal(a.tracker.report().slots[7].totalRolls,1);assert.deepEqual(b.tracker.report().slots,{});
});
test('stat scrolls and offering-only operations do not bias the lucky-slot search',()=>{
 const f=fixture();for(const scroll of ['strscroll',null,'offeringp']){const packet=event();packet.p.scroll=scroll;assert.equal(f.tracker.observe(packet),false);}
 assert.deepEqual(f.tracker.report().slots,{});
});
test('durable coordinator evidence survives replay, restart, and native/headless moves',()=>{
 const {receiveLuckySlotTracking}=require('../../runtime/items/coordinator/production.ts');
 const {aggregateSlotTracking}=require('../../runtime/items/rules.ts');
 const state={};const a=fixture(),b=fixture();a.tracker.observe(event(7));b.tracker.observe(event(7,[0,0,0,0]));
 assert.equal(receiveLuckySlotTracking(state,'M',a.tracker.report()),true);
 assert.equal(receiveLuckySlotTracking(state,'M',a.tracker.report()),false);
 receiveLuckySlotTracking(state,'M',b.tracker.report());const restored=JSON.parse(JSON.stringify(state));
 assert.equal(aggregateSlotTracking(restored.luckySlotTracking.M).slots[7].totalRolls,2);
 a.tracker.sync(restored.luckySlotTracking.M);assert.equal(a.tracker.select(),8);
 assert.equal(aggregateSlotTracking(restored.luckySlotTracking.M,a.tracker.report()).slots[7].totalRolls,2);
 assert.equal(receiveLuckySlotTracking(restored,'Other',a.tracker.report()),true);
 assert.equal(aggregateSlotTracking(restored.luckySlotTracking.Other).slots[7].totalRolls,1);
 const {initialMerchantRuntime}=require('../../runtime/settings/coordinator/initial.ts');
 assert.deepEqual(initialMerchantRuntime(restored,'M').luckySlotTracking,restored.luckySlotTracking);
 const {createCoordinatorPersistence}=require('../../runtime/settings/coordinator/persistence/writer.ts');const writes=new Map();
 createCoordinatorPersistence({...restored,aldata:{}},{set:(key,value)=>writes.set(key,structuredClone(value))},{setTimeout,clearTimeout}).settings();
 assert.deepEqual(writes.get('party_dashboard_settings_state_v1').luckySlotTracking,restored.luckySlotTracking);
});
test('a high roll advances exploration one square without waiting for a verified slot',()=>{
 const f=fixture();assert.equal(f.tracker.select(),0);f.tracker.observe(event(7,[9,9,9,9]));assert.equal(f.tracker.select(),8);
});
test('each sampled slot advances the next test across all 42 slots and survives reload',()=>{
 const f=fixture();
 for(let slot=0;slot<42;slot++){assert.equal(f.tracker.select(),slot);f.tracker.begin();f.tracker.observe(event(slot));}
 assert.equal(f.tracker.select(),0);assert.equal(createLuckySlotTracker(f.ports).select(),0);
});
test('source-derived likelihoods do not treat one zero or a low average as proof',()=>{
 const {luckySlotSearch}=require('../../runtime/items/rules.ts');
 const f=fixture();f.tracker.observe(event(7,[0,0,0,0]));const first=luckySlotSearch(f.tracker.report());
 assert.equal(first.slot,7);assert.equal(first.inferred,false);assert.ok(first.confidence<0.7);
 const ordinary=luckySlotSearch({version:1,slots:{7:{totalRolls:1000,sumRolls:100,rollsAbove96_3:37,perfectRolls:0}}});
 assert.notEqual(ordinary.slot,7);assert.equal(ordinary.inferred,false);
});
test('rotating search converges on a simulated lucky slot using only scheduled attempts',()=>{
 const {luckySlotSearch,emptyRolls}=require('../../runtime/items/rules.ts');
 let seed=12345;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 const tracking={version:1,slots:{}};let decision=luckySlotSearch(tracking);
 for(let attempt=0;attempt<25000 && !decision.inferred;attempt++){
  const slot=decision.nextSlot;let roll=random();if(slot===23 && random()<0.6)roll=Math.max(random()/10000,roll*0.975-0.012);
  roll=Math.floor(roll*10000)/10000;const stats=tracking.slots[slot]??=emptyRolls();
  stats.totalRolls++;stats.sumRolls+=roll;if(roll===0)stats.perfectRolls++;if(roll>0.963)stats.rollsAbove96_3++;
  tracking.cursor={slot:(slot+1)%42,at:attempt+1,rolls:attempt+1};
  decision=luckySlotSearch(tracking);
 }
 assert.equal(decision.inferred,true);assert.equal(decision.slot,23);assert.ok(decision.confidence>=0.999);
 assert.deepEqual(luckySlotSearch(JSON.parse(JSON.stringify(tracking))),decision);
});
test('the character records listener packets, persists data and ignores retired runtime packets',()=>{
 let current=true,listener=null;
 // The items owner's observe handle (lifecycle `scope`) hands the listener to the test, not a socket.
 const game=globalThis.parent??={},before=game.__partyRunScope;
 game.__partyRunScope={scope:()=>({on:(socket,name,run)=>{assert.equal(name,'q_data');listener=run;}}),dispose(){}};
 try{
  const {production,stored}=luckyCharacter({current:()=>current});
  production.listen({});bind(production,'CH_Fonze');listener(event());
  assert.equal(production.tracking().report().slots[7].totalRolls,1);
  assert.ok('party-lucky-slot-tracking:owner:CH_Fonze' in stored);
  current=false;listener(event(0));assert.equal(production.tracking().report().slots[0],undefined);
 }finally{game.__partyRunScope=before;}
});
