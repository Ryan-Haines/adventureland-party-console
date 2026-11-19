const {productionHarness} = require('./helpers/items-character.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const coordinator = require('./helpers/coordinator-source.cjs').coordinatorSource();

// A fighter's marked upgrade run (production.ts `merchantImprove`) over a twelve cell bag; each
// upgrade the game answers raises the level, and `calls` keeps the slots in order.
function improveRun(items){
 const character={name:'F',ctype:'warrior',items,q:{}},calls=[];
 items[0]={name:'scroll0',q:50};
 const {production}=productionHarness({character,G:{items:{ololipop:{upgrade:{}},scroll0:{}},skills:{}},ports:{
  request:async()=>({craftProtection:{requirements:[]},upgradeOfferingRules:[],upgradeOfferingStock:{}}),
  upgrade:async slot=>{calls.push(slot);items[slot]={...items[slot],level:items[slot].level+1};return {success:true,num:slot};}}});
 return {calls,improve:(...upgrades)=>production.merchantImprove({upgrades},[])};
}
test('displaced manual upgrade selects unfinished stock without treating finished duplicates as survivors',async()=>{
 const bag=()=>{const items=Array(12).fill(null);items[3]={name:'ololipop',level:8};items[5]={name:'ololipop',level:8};items[10]={name:'ololipop',level:5};return items;};
 const mark={requestId:'manual',slot:7,item:{name:'ololipop',level:5},tiers:3};
 let run=improveRun(bag());await run.improve({...mark});assert.equal(run.calls[0],10);
 let items=bag();items[11]={name:'ololipop',level:6};run=improveRun(items);
 await assert.rejects(run.improve({...mark}),/Upgrade inventory recovery ambiguous.*ololipop.*5.*8/);
 items=bag();items[11]={name:'ololipop',level:6};run=improveRun(items);await run.improve({...mark,liveSlot:11});assert.equal(run.calls[0],11);
 // A slot an earlier mark of the run used is not a survivor.
 items=bag();items[11]={name:'ololipop',level:6};run=improveRun(items);
 await run.improve({...mark,requestId:'first',liveSlot:11,tiers:2},{...mark});assert.deepEqual([run.calls[0],run.calls[2]],[11,10]);
 // v1.5 row 2: an admitted automatic pass whose copy is gone blocks with its target kept; a manual
 // mark and an automatic mark not yet admitted answer no slot.
 const gone={auto:true,passId:'pass',slot:7,item:{name:'ololipop',level:9},tiers:2};
 await assert.rejects(improveRun(bag()).improve({...gone}),/Automatic upgrade survivor is ambiguous or missing: ololipop; preserved target \+11/);
 run=improveRun(bag());await run.improve({...gone,passId:undefined});assert.deepEqual(run.calls,[]);
 run=improveRun(bag());await run.improve({...gone,auto:false,requestId:undefined});assert.deepEqual(run.calls,[]);
});
// The live automatic offering row (e2e/live-bankboi-offerings.spec.ts 'BankBoi-only offering supplies
// required automatic native upgrade'): the pass's first copy went poof, and the next mark's offering
// demand read every mark of the job, the destroyed one too. v1.5 blocks a gone copy only at its own
// turn (aac30d45 shared.js:6286), so the run goes on to the next copy.
test('an automatic pass whose copy went poof this run goes on to the next mark under an offering rule',async()=>{
 const items=Array(12).fill(null),calls=[];
 items[0]={name:'scroll0',q:50};items[1]={name:'offeringp',q:2};items[3]={name:'ololipop',level:8};items[5]={name:'ololipop',level:8};
 const character={name:'F',ctype:'warrior',items,q:{}};
 const {production}=productionHarness({character,G:{items:{ololipop:{upgrade:{}},scroll0:{},offeringp:{}},skills:{}},ports:{
  request:async()=>({craftProtection:{requirements:[]},upgradeOfferingRules:[{name:'ololipop',floor:8,ceiling:9,offering:'offeringp',required:false}],
   upgradeOfferingStock:{offeringp:2}}),
  upgrade:async slot=>{calls.push(slot);if(calls.length===1){items[slot]=null;return {failed:true,success:false,num:slot};}
   items[slot]={...items[slot],level:items[slot].level+1};return {success:true,num:slot};}}});
 const mark=slot=>({auto:true,passId:'pass',slot,item:{name:'ololipop',level:8},tiers:1});
 await production.merchantImprove({upgrades:[mark(3),mark(5)]},[]);
 assert.deepEqual(calls,[3,5],'the second copy is upgraded after the first went poof');
 assert.equal(items[5].level,9);
});

// A merchant's upgrade (production.ts `upgradeConfirmed`) under the production journal and the lucky
// slot service; `checkpoint` is the game's change while the protection checkpoint is out.
function merchantUpgrade(items,{checkpoint=()=>{}}={}){
 const character={name:'M',ctype:'merchant',items,q:{}},calls=[];
 const h=productionHarness({character,ports:{job:()=>({jobId:'j'}),
  request:async(path,{body})=>{
   if(path==='/merchant/checkpoint')checkpoint(items);
   return path==='/merchant/production'&&body.action==='pending'?{pending:[]}:{};
  },
  swap:async(a,b)=>{[items[a],items[b]]=[items[b],items[a]];},
  upgrade:async(slot,scroll)=>{calls.push([slot,scroll]);items[slot]={...items[slot],level:items[slot].level+1};items[scroll]={...items[scroll],q:items[scroll].q-1};return {success:true,num:slot};}}});
 return {...h,calls};
}
test('upgrade reselects a scroll moved during its asynchronous protection checkpoint', async () => {
  const items = [{name:'wcap',level:1},{name:'scroll0',q:4},null,null,null,null,null,null];
  const {production,calls}=merchantUpgrade(items,{checkpoint:bag=>{if(bag[1]){bag[2]=bag[1];bag[1]=null;}}});
  production.setLuckySlot(7);
  await production.upgradeConfirmed(0,1,'wcap',2);
  assert.deepEqual(calls,[[7,2]]);
});
// The lucky slot is the verified one, else the slot search's next (cursor 0 with no rolls seen),
// else, on discovery data the search cannot read, the item's own slot.
for(const [verified,expected] of [[null,0],['corrupt',2],[7,7]])test('upgrade executes selected slot and restores inventory: '+JSON.stringify({verified}),async()=>{
 const items=Array(42).fill(null);items[2]={name:'wcap',level:0};items[4]={name:'scroll0',q:2};items[0]={name:'tracker'};
 const {production,calls,stored}=merchantUpgrade(items);
 if(verified==='corrupt')production.luckyReply({luckySlotTracking:{M:{other:'corrupt'}}});else production.setLuckySlot(verified);
 await production.upgradeConfirmed(2,4,'wcap',1);
 assert.deepEqual(calls,[[expected,4]]);assert.equal(items[2].level,1);assert.equal(items[0].name,'tracker');assert.equal(stored['party-lucky-upgrade']??null,null);
});

test('bank-sourced pass persists before production and resumes at its original target after relocation', () => {
  const {beginProduction, finishProduction} = require('../../runtime/items/coordinator/production.ts');
  const {reconcileCoordinatorUpgradeMarks} = require('../../runtime/items/coordinator/production.ts');
  const {processingPending} = require('../../runtime/items/rules.ts');
  const {party, r, status} = marksRuntime();
  Object.assign(party, {merchantCharacter:'M', production:{attempts:{}}, autoCompounds:{}});
  const mark = {passId:'pass',slot:19,item:{name:'wcap',level:0},tiers:8,auto:true};
  beginProduction(party,{id:'first',kind:'upgrade',item:mark.item,automatic:{family:'upgrade',key:'wcap@+0',mark}});
  // v1.5 row 2: a mark keeps the copy's live cell and fingerprint beside its original.
  assert.deepEqual(party.upgrades.M,[{...mark,liveItem:mark.item,liveSlot:19}]);
  finishProduction(party,'first',true);
  const busy = {items:[],upgradeInventoryBusy:true};
  assert.equal(reconcileCoordinatorUpgradeMarks(party,'M',busy),false);
  assert.deepEqual(party.upgrades.M,[{...mark,liveItem:mark.item,liveSlot:19}]);
  party.upgrades=JSON.parse(JSON.stringify(party.upgrades));
  const snapshot=status(4);snapshot.items[0].slot=7;
  r.reconcileAutoUpgradeMarks('M',snapshot);
  assert.deepEqual(party.upgrades.M,[{...mark,slot:7,liveSlot:7,liveItem:{name:'wcap',level:4}}]);
  assert.equal(processingPending(party,{name:'wcap',level:4}),true);
  assert.equal(processingPending(party,{name:'wcap',level:8}),false);
  r.clearResolvedUpgradeMarks('M',[mark]);
  assert.deepEqual(party.upgrades.M,[]);
});

test('relocating a pass does not steal a survivor already owned by another pass', () => {
  const {party,r,status}=marksRuntime();r.reconcileAutoUpgradeMarks('M',status(0));
  const existing={...party.upgrades.M[0],slot:7,passId:'other'};
  party.upgrades.M.push(existing);
  const snapshot=status(4);snapshot.items[0].slot=7;
  r.reconcileAutoUpgradeMarks('M',snapshot);
  assert.deepEqual(party.upgrades.M,[existing]);
});

function marksRuntime() {
  const party = { autoUpgradeMarks: { M: { 'wcap@+0': { tiers: 8, quantity: -1 } } }, upgrades: { M: [] } };
  const policies = require('../../runtime/items/coordinator/production.ts');
  const r = {
    reconcileAutoUpgradeMarks(name, status) {
      const result = policies.reconcileUpgradeMarks(party.upgrades[name] || [], party.autoUpgradeMarks[name] || {}, status.items);
      party.upgrades[name] = result.marks;
      return result.changed;
    },
    clearResolvedUpgradeMarks(name, resolved) {
      party.upgrades[name] = policies.clearResolvedUpgradeMarks(party.upgrades[name] || [], resolved);
    },
  };
  return { party, r, status: level => ({ items: [
    { slot: 19, item: { name: 'wcap', level }, meta: { upgradeable: true } },
  ] }) };
}

test('automatic +0 to +8 intent survives intermediate +1 and +4 statuses and reconnects', () => {
  const { party, r, status } = marksRuntime();
  r.reconcileAutoUpgradeMarks('M', status(0));
  for (const level of [1, 4, 8]) {
    party.upgrades = JSON.parse(JSON.stringify(party.upgrades));
    r.reconcileAutoUpgradeMarks('M', status(level));
    assert.equal(party.upgrades.M.length, 1);
    assert.equal(party.upgrades.M[0].item.level, 0);
    assert.equal(party.upgrades.M[0].tiers, 8);
  }
});

test('a rule at the intermediate level cannot replace the unfinished original target', () => {
  const { party, r, status } = marksRuntime();
  r.reconcileAutoUpgradeMarks('M', status(0));
  party.autoUpgradeMarks.M['wcap@+4'] = { tiers: 5, quantity: -1 };
  r.reconcileAutoUpgradeMarks('M', status(4));
  assert.equal(party.upgrades.M[0].item.level, 0);
  assert.equal(party.upgrades.M[0].tiers, 8);
});

test('destroyed items and removed rules retire automatic marks', () => {
  const { party, r, status } = marksRuntime();
  r.reconcileAutoUpgradeMarks('M', status(0));
  r.reconcileAutoUpgradeMarks('M', { items: [] });
  assert.equal(party.upgrades.M.length, 0);
  r.reconcileAutoUpgradeMarks('M', status(0));
  party.autoUpgradeMarks.M = {};
  r.reconcileAutoUpgradeMarks('M', status(4));
  assert.equal(party.upgrades.M.length, 0);
});

test('finishing one batch preserves upgrade marks queued during that batch', () => {
  const { party, r, status } = marksRuntime();
  r.reconcileAutoUpgradeMarks('M', status(0));
  const dispatched = JSON.parse(JSON.stringify(party.upgrades.M));
  const snapshot = status(4);
  snapshot.items.push({ slot: 25, item: { name: 'wcap', level: 0 }, meta: { upgradeable: true } });
  r.reconcileAutoUpgradeMarks('M', snapshot);
  r.clearResolvedUpgradeMarks('M', dispatched);
  assert.equal(party.upgrades.M.length, 1);
  assert.equal(party.upgrades.M[0].slot, 25);
});

// Step 10: the Town override is a rank 85 claim; the 100 ms watchdog that stopped movement went.
test('the Town override never claims or stops a merchant, even with a stale global hold', async () => {
  const stops = [], claims = [];
  const r = vm.createContext({ escapeOwns: () => false, character: { ctype: 'merchant', map: 'main', x: -207, y: -220 },
    root: {}, partyTownActive: true, townTraveling: false,
    smart: { moving: true }, stop: kind => stops.push(kind), is_moving: () => true,
    movement: { hold: request => { claims.push(request.owner); return 'granted'; } },
  });
  // The override is the movement requesters' (runtime/movement/character/owner.ts).
  require('./helpers/requesters.cjs').installRequesters(r);
  await r.enforcePartyTownOverride();
  assert.deepEqual(stops, []);
  assert.deepEqual(claims, []);
});
test('legacy manual bank pass identity survives normalization and an admitted old command',()=>{
 const {initialItemIntents}=require('../../runtime/items/saved-fields.ts');
 const {rememberUpgradeContinuation}=require('../../runtime/items/coordinator/production.ts');
 const mark={passId:'bank-manual-pass',slot:7,item:{name:'sshield',level:0},tiers:4};
 const intents=initialItemIntents({upgrades:{M:[mark]}},{declared:require('../../runtime/settings/coordinator/table.ts').declared});
 assert.equal(intents.upgrades.M[0].requestId,mark.passId);
 const state={...intents,merchantCharacter:'M',autoUpgradeMarks:{}};
 const body={kind:'upgrade',item:{name:'sshield',level:1},automatic:{family:'manual-upgrade',mark:{...mark,slot:9}}};
 rememberUpgradeContinuation(state,body);
 assert.equal(state.upgrades.M[0].liveSlot,9);
 assert.equal(state.upgrades.M[0].liveItem.level,1);
 assert.throws(()=>rememberUpgradeContinuation(state,{...body,automatic:{family:'manual-upgrade',mark:{...mark,passId:'other'}}}),/continuation changed/);
 assert.throws(()=>rememberUpgradeContinuation(state,{...body,item:{name:'helmet',level:1}}),/item changed/);
 assert.throws(()=>rememberUpgradeContinuation(state,{...body,automatic:{family:'manual-upgrade',mark:{...mark,tiers:5}}}),/target changed/);
});

// An intent holds its copy by identity,
// follows it below its target, and ends at its target or when its copy leaves the bag.
test('intents follow their copies by identity and end at their target or when the copy leaves', () => {
  const {reconcileUpgradeMarks} = require('../../runtime/items/coordinator/production.ts');
  const bag = (...entries) => entries.map(([slot, level]) => ({slot, item: {name: 'wcap', level}, meta: {upgradeable: true}}));
  const manual = (requestId, slot) => ({requestId, slot, item: {name: 'wcap', level: 0}, tiers: 2});
  // A tidy moved two identical copies: each request takes a distinct unfinished copy.
  let result = reconcileUpgradeMarks([manual('a', 3), manual('b', 4)], {}, bag([10, 1], [11, 0]));
  assert.deepEqual(result.marks.map(mark => mark.slot).sort(), [10, 11]);
  // One copy left: one request keeps it and the other ends; two requests never share a copy.
  result = reconcileUpgradeMarks([manual('a', 3), manual('b', 4)], {}, bag([10, 1]));
  assert.deepEqual(result.marks.map(mark => [mark.requestId, mark.slot]), [['a', 10]]);
  // A finished copy elsewhere is never claimed by a moved intent.
  result = reconcileUpgradeMarks([manual('a', 3)], {}, bag([10, 2]));
  assert.deepEqual(result.marks, []);
  // A manual request ends when its copy reaches its target, and stays while it is below it.
  result = reconcileUpgradeMarks([manual('a', 3)], {}, bag([3, 2]));
  assert.deepEqual(result.marks, []);
  result = reconcileUpgradeMarks([manual('a', 3)], {}, bag([3, 1]));
  assert.deepEqual(result.marks.map(mark => mark.slot), [3]);
});
