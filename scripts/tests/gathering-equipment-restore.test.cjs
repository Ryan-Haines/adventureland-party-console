// The hands owner (runtime/merchant-hands/character/owner.ts): the lease, the normal
// record, `settle` and the restore, over the ports shared.js gives it in play. Each equip and unequip
// asks the call budget's job band (3.13).
const test = require('node:test'), assert = require('node:assert/strict');
const { createMerchantHands } = require('../../runtime/merchant-hands/character/owner.ts');
const { partyHooks } = require('../../runtime/hooks/index.ts');
const { boundsPending, boundsSent } = require('../../runtime/status/api.ts');
const { CALL_WINDOW_MS } = require('../../runtime/characters/call-budget.ts');
const asked = [], band = { answer: 'send' };
if (!partyHooks().map().registrations.some(r => r.name === 'core:hands-band-fixture'))
  partyHooks().register({ name: 'core:hands-band-fixture', folder: 'core', author: 'test', summary: 'test',
    hooks: { 'calls.band': question => { asked.push(question.method); return band.answer; }, 'calls.window': () => CALL_WINDOW_MS, 'calls.margin': () => 5 } });
// The call budget's run scope, which the reply bound's timer sits on (lifecycle
// character/run.ts `scope`).
const scope = { setTimeout: (callback, ms) => setTimeout(callback, ms), clearTimeout: id => clearTimeout(id) };
globalThis.parent = { ...(globalThis.parent || {}), __partyRunScope: { scope: () => scope } };

// The items owner's bank look (items.fetch, items/character/bank.ts `fetch`): the walk, then one
// withdrawal from the newest fixture's bank.
let banked = null;
if (!partyHooks().map().registrations.some(r => r.name === 'core:hands-fetch-fixture'))
  partyHooks().register({ name: 'core:hands-fetch-fixture', folder: 'core', author: 'test', summary: 'test',
    hooks: { 'items.fetch': async (_character, name) => { await banked.walkToBank(); await banked.retrieve(name); return true; } } });
// `root` plants what an earlier runtime left on the runtime root.
function fixture(tool = 'rod', root = {}) {
  const broom = {name:'broom',level:1}, statuses=[], calls=[], reports=[];
  const same = (a,b) => !!a && !!b && a.name===b.name && a.level===b.level;
  const c = {root,merchantWeapon:null,listings:[],bankWalks:0,
    character:{ctype:'merchant',slots:{mainhand:{name:tool,level:4}},items:[broom]}};
  globalThis.G = {items:{broom:{wtype:'staff',type:'weapon'},sword:{wtype:'sword',type:'weapon'},axe:{wtype:'axe',type:'weapon'}},
    classes:{merchant:{mainhand:{staff:true,sword:true},doublehand:{axe:true}}},
    skills:{fishing:{wtype:['rod']},mining:{wtype:['pickaxe']}}};
  globalThis.equip = async (index,slot) => { calls.push('equip '+slot); const old=c.character.slots[slot];c.character.slots[slot]=c.character.items[index];c.character.items[index]=old; };
  globalThis.unequip = async slot => { calls.push('unequip '+slot); c.character.items.push(c.character.slots[slot]);c.character.slots[slot]=null; };
  const hands = createMerchantHands({
    root: () => c.root, character: () => c.character, current: () => true, sleep: async () => {},
    request: async () => ({}), intent: () => c.merchantWeapon && c.merchantWeapon.item || null, listings: () => c.listings,
    sameItem: same, findItem: item => c.character.items.findIndex(candidate => same(candidate,item)), fingerprint: item => item ? {...item} : null,
    count: name => c.character.items.filter(item => item && item.name === name).length,
    status: (...args) => statuses.push(args), report: body => reports.push(body), baseline: () => [],
    crafts: () => false, holdForOrder: () => {}, closeStand: async () => {},
  });
  banked = {
    walkToBank: async () => { c.bankWalks++; c.character.bank ||= {items0:[]}; },
    retrieve: async name => { const pack=c.character.bank.items0, at=pack.findIndex(item => item && item.name===name); if (at>=0) c.character.items.push(pack.splice(at,1)[0]); },
  };
  return {c,hands,broom,statuses,calls,reports};
}
// The lease as gathering takes it at the spot: the broom is in hand, and the tool goes on.
async function leased(f) {
  const {c,hands}=f, tool=c.character.slots.mainhand;
  c.character.items=[tool];c.character.slots.mainhand=f.broom;
  await hands.equipGatheringTool({tool:tool.name},()=>true);
  assert.equal(c.character.slots.mainhand.name,tool.name);
  f.calls.length=0;
}

test('fishing and mining restore the displaced broom without a merchant weapon mark',async()=>{
  for(const tool of ['rod','pickaxe']) {
    const f=fixture(tool);await leased(f);
    assert.equal(await f.hands.restoreGatheringEquipment(()=>true),true);
    assert.deepEqual(f.c.character.slots.mainhand,f.broom);
  }
});
test('explicit merchant weapon overrides saved equipment; sale markings release saved equipment',async()=>{
  const f=fixture();await leased(f);
  f.c.merchantWeapon={item:{name:'sword',level:0}};f.c.character.items.push(f.c.merchantWeapon.item);
  assert.equal(await f.hands.restoreGatheringEquipment(()=>true),true);
  assert.equal(f.c.character.slots.mainhand.name,'sword');
  const second=fixture();await leased(second);second.c.listings=[{item:second.broom}];
  assert.equal(await second.hands.restoreGatheringEquipment(()=>true),true);
  assert.equal(second.c.character.slots.mainhand,null);
});
test('a two-handed normal weapon clears the offhand first, and each call asks the job band',async()=>{
  const f=fixture();f.c.character.slots.offhand={name:'shield',level:0};
  f.c.merchantWeapon={item:{name:'axe',level:0}};f.c.character.items.push(f.c.merchantWeapon.item);
  asked.length=0;
  assert.equal(await f.hands.restoreGatheringEquipment(()=>true),true);
  assert.deepEqual(f.calls,['unequip offhand','equip mainhand']);assert.deepEqual(asked,['unequip','equip']);
  // A wait on the band ends with no call once the holder is cancelled.
  const cancelled=fixture();band.answer='not-now';
  assert.equal(await cancelled.hands.restoreGatheringEquipment((()=>{let first=true;return ()=>{const was=first;first=false;return was;};})()),false);
  band.answer='send';assert.deepEqual(cancelled.calls,[]);
  // An unequip whose reply never comes ends after two margins, reports handReplyBound, and the
  // restore names the hand it could not clear.
  const lost=fixture(),unequip=globalThis.unequip;boundsSent(boundsPending().length);
  globalThis.unequip=()=>new Promise(()=>{});
  assert.equal(await lost.hands.restoreGatheringEquipment(()=>true),false);
  globalThis.unequip=unequip;
  assert.deepEqual(boundsPending().map(firing=>[firing.bound,firing.owner,firing.state.method,firing.state.ms]),[['handReplyBound','09','unequip',10]]);
});
// decisions.md answer 2: settle answers false while the saved weapon is missing, so
// runner.accept defers a job command (gathering-ownership.test.cjs "a job command waits").
test('a missing normal weapon is looked for in the bank once per change, named, and settle answers false until it is back',async()=>{
  const f=fixture();await leased(f);f.c.character.items=f.c.character.items.filter(item=>item.name!=='broom');
  assert.equal(await f.hands.settle({type:'merchant-ponty-buy'}),false);
  assert.equal(f.c.bankWalks,1);assert.ok(f.statuses.some(s=>s[0]==='Marked weapon missing: broom'));
  // The tool still leaves the hand, so a command that runs does not start with it.
  assert.equal(f.c.character.slots.mainhand,null);
  // The lease stays, so the next settle restores again; the look waits for a bag or bank change.
  assert.equal(await f.hands.settle({type:'merchant-ponty-buy'}),false);assert.equal(f.c.bankWalks,1);
  // The bank changes: the look runs again and finds it.
  f.c.character.bank.items0.push(f.broom);
  assert.equal(await f.hands.settle({type:'merchant-ponty-buy'}),true);
  assert.equal(f.c.bankWalks,2);assert.deepEqual(f.c.character.slots.mainhand,f.broom);
  assert.equal(await f.hands.settle({type:'merchant-ponty-buy'}),true,'the lease ended with the restore');
  // A restore whose holder is no longer current changes no hand.
  const obsolete=fixture();await leased(obsolete);
  assert.equal(await obsolete.hands.restoreGatheringEquipment(()=>false),false);
  assert.equal(obsolete.c.character.slots.mainhand.name,'rod');
});
test('tool equip captures the current broom instead of stale session equipment',async()=>{
  const f=fixture('rod',{__merchantHands:{lease:null,observed:{mainhand:{name:'sword',level:0},offhand:null},missing:{}}});
  await leased(f);
  assert.equal(await f.hands.restoreGatheringEquipment(()=>true),true);
  assert.deepEqual(f.c.character.slots.mainhand,f.broom);
});
// A merchant-gather's pass is runner.accept's row, so settle has no case for it.
test('settle restores before any command the lease does not own',async()=>{
  for(const type of ['merchant-ponty-buy','merchant-service','travel','event-join']) {
    const f=fixture();await leased(f);
    await f.hands.settle({type});
    assert.deepEqual(f.c.character.slots.mainhand,f.broom,type);
  }
  const f=fixture();await leased(f);
  // With no lease a command passes untouched.
  await f.hands.restoreGatheringEquipment(()=>true);f.calls.length=0;
  await f.hands.settle({type:'merchant-service'});assert.deepEqual(f.calls,[]);
});
test('a manual equip makes its hand normal, and a call that changes no hand saves no tool',async()=>{
  const f=fixture();await leased(f);
  const sword={name:'sword',level:0};f.c.character.items.push(sword);
  const before=f.hands.hands();await globalThis.equip(f.c.character.items.indexOf(sword),'mainhand');f.hands.manual(before);
  assert.equal(await f.hands.restoreGatheringEquipment(()=>true),true);assert.equal(f.c.character.slots.mainhand.name,'sword');
  const g=fixture();await leased(g);
  g.hands.manual(g.hands.hands());
  assert.equal(await g.hands.restoreGatheringEquipment(()=>true),true);assert.deepEqual(g.c.character.slots.mainhand,g.broom);
});
// A4: a lease change and a failed restore send one notice each, `by` the hands owner,
// and an add-on's `hands.normal` ask reads the normal record. Separate: a lease needs a cast, which
// the merchant hooks table does not reach.
test("A4: the hands owner's notices: a lease is taken and ended, a failed restore is told, and the normal record reads",async()=>{
  const heard=[];
  if(!partyHooks().map().registrations.some(r=>r.name==='core:hands-notices-fixture'))
    partyHooks().register({name:'core:hands-notices-fixture',folder:'core',author:'test',summary:'Hears the hands notices.',
      hooks:Object.fromEntries(['hands.lease.taken','hands.lease.ended','hands.restore.failed'].map(n=>[n,payload=>heard.push([n,payload.lease??payload.error,payload.by])]))});
  const f=fixture();await leased(f);
  assert.deepEqual(partyHooks().askRow('hands.normal',[]),{mainhand:f.broom,offhand:null});
  const equip=globalThis.equip;
  globalThis.equip=async()=>{throw new Error('planted');};
  assert.equal(await f.hands.restoreGatheringEquipment(()=>true),false);
  globalThis.equip=equip;
  assert.equal(await f.hands.restoreGatheringEquipment(()=>true),true);
  assert.deepEqual(heard,[['hands.lease.taken','rod','core:merchant-hands'],['hands.restore.failed','planted','core:merchant-hands'],
    ['hands.lease.ended','rod','core:merchant-hands']]);
});
test("P12: the add-on's restore names its own weapon; a listed item keeps the observed hand",async()=>{
  const sword={name:'sword',level:2};let answer={mainhand:sword};
  partyHooks().register({name:'p12-restore',folder:'addons',author:'test',summary:'Restores its own weapon.',hooks:{'hands.normal':()=>answer}});
  partyHooks().configure({'p12-restore':{enabled:true}});
  try{
    const f=fixture();await leased(f);f.c.character.items.push(sword);
    assert.equal(await f.hands.restoreGatheringEquipment(()=>true),true);
    assert.deepEqual(f.c.character.slots.mainhand,sword);
    const g=fixture();await leased(g);g.c.character.items.push(sword);g.c.listings=[{item:sword}];
    assert.equal(await g.hands.restoreGatheringEquipment(()=>true),true);
    assert.deepEqual(g.c.character.slots.mainhand,g.broom);
    // Readers still get core's checked record.
    answer={mainhand:{name:'rod',level:4}};
    assert.deepEqual(partyHooks().askRow('hands.normal',[]).mainhand,g.broom);
  }finally{partyHooks().configure({'p12-restore':{enabled:false}});}
});

// Separate: the live manual weapon rows saw three Broom equips in one millisecond, from the
// command's settle and the gathering attempt's end restoring the same hands at once, with the
// manual Equip's own call never sent.
test('a manual Equip of a weapon settles with no restore, and restores asked together send one equip', async () => {
  const f = fixture('rod'); await leased(f);
  const {c, hands} = f;
  c.merchantWeapon = {item: f.broom};
  assert.equal(await hands.settle({type: 'equip', item: f.broom}), true);
  assert.deepEqual(f.calls, []);
  const answers = await Promise.all([hands.settle({type: 'bank'}), hands.restoreGatheringEquipment(() => true), hands.restoreGatheringEquipment(() => true)]);
  assert.deepEqual(answers, [true, true, true]);
  assert.deepEqual(f.calls, ['equip mainhand']);
  assert.equal(c.character.slots.mainhand.name, 'broom');
});
