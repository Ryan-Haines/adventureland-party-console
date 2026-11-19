const {bankRuntime}=require('./helpers/bank-stacks.cjs');
const {scenarioTable}=require('./fixtures/scenarios.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const routing = require('../../runtime/items/coordinator/storage.ts');
const {stackKey} = require('../../runtime/items/identity.ts');
const entry = (q, extra = {}) => ({ item: { name: 'leather', q, ...extra }, meta: { definition: { s: 9999 } } });
scenarioTable('the storage plan routes stacks, workers and overflow',null,[
 ['normal panes win over worker stacks; staging is never a permanent home',() => {
  const bank = { packs: { items0: [entry(10)], items1: Array(35).fill(null).concat(entry(20)) } };
  const worker = { name: 'bankboi0', items: [entry(49)] };
  const homes = routing.homes(bank, { bankboi0: worker });
  assert.equal(homes[stackKey(entry(1).item)].owner, 'bank');
  assert.equal(routing.needsReconcile(worker, homes, []), true);
  assert.equal(routing.needsReconcile(worker, homes, [{ pack: 'bankboi:bankboi0', item: entry(1).item }]), false);
}],
 ['existing stack owner receives new cargo even with all 42 inventory slots occupied',() => {
  const first = { name: 'bankboi0', items: [] };
  const owner = { name: 'bankboi1', items: [entry(49), ...Array.from({ length: 41 }, (_, n) => ({ item: { name: 'sword' + n } }))] };
  const homes = routing.homes(null, { first, owner });
  assert.equal(routing.accepts(first, entry(10), homes), false);
  assert.equal(routing.accepts(owner, entry(10), homes), true);
}],
 ['worker duplicates converge deterministically and full stacks permit overflow',() => {
  const a = { name: 'a', items: [entry(49)] }, b = { name: 'b', items: [entry(10)] };
  const homes = routing.homes(null, { b, a });
  assert.equal(routing.needsReconcile(a, homes, []), false);
  assert.equal(routing.needsReconcile(b, homes, []), true);
  assert.equal(routing.homes({ packs: { items0: [entry(9999)] } }, { b })[stackKey(entry(1).item)].owner, 'b');
  assert.notEqual(stackKey(entry(1, { l: 'l' }).item), stackKey(entry(1).item));
}],
 ['newly unlocked sparse pane schedules all 26 overflow items and blocks no-progress retries',() => {
  const worker = {name:'B', state:'ready', items:Array.from({length:26}, (_,i)=>({item:{name:'sword'+i}}))};
  const party = {merchantCharacter:'M', withdrawals:{M:[]}, bankbois:{B:worker}, bankboiQueue:[],
    bankSnapshot:{packs:{items0:Array(42).fill(entry(9999)),items1:Array(35).fill(entry(9999)),items2:[]}}};
  assert.equal(routing.unloadPlan(party,worker).length,26);
  assert.equal(routing.servicePlan(party).candidate.name,'B');
  worker.unloadBlockedSignature=routing.storageSignature(party,worker);
  assert.equal(routing.servicePlan(party),null);
  party.bankSnapshot.packs.items0[0]=null;
  assert.ok(routing.servicePlan(party));
}],
 ['unload planning allocates slots once and respects withdrawal reservations and stack limits',() => {
  const worker={name:'B',items:[entry(5),entry(9),{item:{name:'sword'}}]};
  const party={bankbois:{B:worker},withdrawals:{M:[{pack:'items2',slot:1},{pack:'bankboi:B',item:{name:'sword'}}]},
    bankSnapshot:{packs:{items1:Array(35).fill(entry(9999)),items2:[entry(9990),null,...Array(40).fill(entry(9999))]}}};
  assert.equal(routing.unloadPlan(party,worker).length,1);
}],
// Failure inventory: per-copy bank and storage worker entries carry no
// definition, so partial stacks lose their home and unload never tops them up.
 ['per-copy bank entries read the stack limit from the catalog',() => {
  const routing = require('../../runtime/items/coordinator/storage.ts');
  const merchantCatalog = { allItems: [{ id: 'gem1', meta: { definition: { s: 9999 } } }] };
  const slim = q => ({ item: { name: 'gem1', q }, meta: { properties: {} } });
  const bank = { packs: { items0: [{ slot: 0, ...slim(40) }] } };
  assert.deepEqual(routing.homes(bank, {}), {});
  const homes = routing.homes(bank, {}, merchantCatalog);
  assert.equal(homes[stackKey(slim(1).item)].room, 9959);
  const worker = { name: 'b', items: [{ slot: 0, ...slim(2) }] };
  const party = { bankSnapshot: bank, withdrawals: {}, merchantCatalog };
  assert.deepEqual(routing.unloadPlan(party, worker).map(move => [move.pack, move.bankSlot]), [['items0', 0]]);
}],
]);

// A BankBoi worker on the bank floor over bank.ts (helpers/bank-stacks.cjs `bankRuntime`), staging on.
// `c` holds what a row replaces after the build: the game's bank_store, bank_retrieve and
// smart_move, the coordinator's `request` and the stack homes; the bank checkpoint stays bankRuntime's. A store with no cell merges into an
// existing pile, and a retrieve merges into a carried pile, as the game does.
function runtime(items, bank) {
  const calls = [];
  const c = { bankStackHomes: {}, smart_move: async () => {},
    request: async (path, options) => calls.push(['complete', options.body]),
    bank_store: async (slot, pack, index) => {
      const item = items[slot];
      if (index === undefined) {
        const existing = pack
          ? (bank[pack] || []).find(x => x?.name === item.name)
          : Object.values(bank).flat().find(x => x?.name === item.name);
        assert.ok(existing); existing.q += item.q;
        items[slot] = null;
      } else {
        items[slot] = bank[pack][index] || null;
        bank[pack][index] = item;
      } calls.push(['store', pack || 'merge']);
    },
    bank_retrieve: async (pack, slot) => {
      const item = bank[pack][slot];
      const existing = items.find(x => x?.name === item.name);
      if (existing) existing.q += item.q;
      else items[items.findIndex(x => !x)] = item;
      bank[pack][slot] = null; calls.push(['retrieve', pack, slot]);
      return { inv: items.indexOf(existing || item) };
    },
  };
  let r;
  r = bankRuntime(bank, items, { leather: 9999 }, { character: { slots: {}, gold: 0, name: 'bankboi0', ctype: undefined }, ports: {
    staging: () => true, stackHomes: () => c.bankStackHomes,
    request: (path, ...rest) => path === '/merchant/bank-sort/checkpoint' ? { mode: 'off', protection: r.game.protection } : c.request(path, ...rest),
    bankStore: (...args) => c.bank_store(...args), bankRetrieve: (...args) => c.bank_retrieve(...args) } });
  r.game.smart_move = floor => c.smart_move(floor);
  Object.assign(c, { character: r.character, game: r.game, G: r.G, runBankboiService: r.bank.runBankboiService, bankStoreFully: r.bank.bankStoreFully });
  Object.defineProperty(c, 'banking', { get: () => r.bag.facts().banking });
  return { c, calls };
}
scenarioTable('a bank worker unloads, deposits and reports over the bank runtime',null,[
 ['unloading fills a new pane directly and leaves transfer slots empty',async () => {
  const bank={items0:Array(42).fill({name:'full'}),items1:Array(35).fill({name:'full'}),items2:[]};
  const {c,calls}=runtime([{name:'leather',q:49},{name:'sword'},null],bank);
  await c.runBankboiService({id:1,unload:true});
  const report=calls.at(-1)[1];
  assert.equal(report.error,undefined);
  assert.equal(report.relocated.length,2);
  assert.equal(report.items.filter(Boolean).length,0);
  assert.equal(bank.items2[0].q,49);
  assert.equal(bank.items2[1].name,'sword');
  assert.equal(bank.items1.slice(35).filter(Boolean).length,0);
}],
 ['unloading handles staged deposits and preserves explicit retrievals',async () => {
  const bank={items0:[],items1:Array(42).fill(null)};
  bank.items1[35]={name:'leather',q:2};
  const {c,calls}=runtime([{name:'leather',q:49},{name:'sword'},null],bank);
  await c.runBankboiService({id:1,unload:true,requests:[{id:'a',pack:'items1',slot:35,item:{name:'leather',q:2}}],retrievals:[{item:{name:'sword'}}]});
  const report=calls.at(-1)[1];
  assert.equal(report.error,undefined);
  assert.equal(bank.items0[0].q,51);
  assert.equal(report.deposited.length,1);
  assert.equal(bank.items1[35].name,'sword');
}],
 ['unloading checks other bank floors and reports transfers before a later failure',async () => {
  const bank={items1:Array(35).fill({name:'full'}),items8:[]};
  const {c,calls}=runtime([{name:'leather',q:49},{name:'sword'}],bank);
  c.game.bank_packs={items1:['bank'],items8:['bank_b']};c.G.maps.bank={doors:[[0,0,0,0,'bank_b']]};
  const moves=[]; c.smart_move=async floor=>{moves.push(floor);c.character.map=floor;};
  const store=c.bank_store;
  c.bank_store=async (...args)=>{if(args[0]===1) throw Error('interrupted');return store(...args);};
  await c.runBankboiService({id:1,unload:true});
  const report=calls.at(-1)[1];
  assert.equal(report.error,'interrupted');
  assert.equal(report.relocated.length,1);
  assert.equal(report.items.filter(Boolean).length,1);
  assert.ok(moves.includes('bank_b'));
}],
 ['worker returns leather to the normal stack and reports an empty inventory',async () => {
  const bank = { items0: [{ name: 'leather', q: 10 }], items1: Array(42).fill(null) };
  const { c, calls } = runtime([{ name: 'leather', q: 49 }, null], bank);
  const homes = routing.homes({ packs: { items0: [entry(10)] } }, {});
  await c.runBankboiService({ id: 1, stackHomes: homes });
  assert.equal(bank.items0[0].q, 59);
  assert.equal(c.character.items.filter(Boolean).length, 0);
  assert.equal(calls.at(-1)[1].error, undefined);
}],
 ['worker waits for the reserved bank pane to hydrate after entering the bank',async () => {
  const bank = { items0: [], items1: Array(42).fill(null) };
  const { c, calls } = runtime([null], bank);
  c.character.bank = undefined;
  c.smart_move = async () => { c.character.bank = bank; };
  await c.runBankboiService({ id: 1 });
  assert.equal(calls.at(-1)[1].error, undefined);
  assert.ok(calls.at(-1)[1].bank.packs.items1);
}],
 ['a stale staging request cannot retrieve a normal bank stack',async () => {
  const bank = { items0: [{ name: 'leather', q: 49 }], items1: Array(42).fill(null) };
  const { c, calls } = runtime([null], bank);
  await c.runBankboiService({ id: 1, requests: [{ id: 'stale', pack: 'items1', slot: 35, item: entry(1).item }] });
  assert.equal(calls.some(x => x[0] === 'retrieve'), false);
  assert.equal(bank.items0[0].q, 49);
  assert.deepEqual(Array.from(calls.at(-1)[1].completed), ['stale']);
}],
 ['new deposits stage for an existing virtual home instead of opening a normal-bank stack',async () => {
  const bank = { items0: Array(42).fill(null), items1: Array(42).fill(null) };
  const { c, calls } = runtime([{ name: 'leather', q: 10 }], bank);
  c.character.name = 'Merchant';
  c.bankStackHomes = routing.homes(null, { worker: { name: 'bankboi0', items: [entry(49)] } });
  await c.bankStoreFully(0);
  assert.equal(bank.items0.filter(Boolean).length, 0);
  assert.equal(bank.items1[35].q, 10);
  assert.equal(calls[0][0], 'store');
}],
 ['staged leather merges into a full worker inventory without requiring an empty slot',async () => {
  const bank = { items0: [], items1: Array(42).fill(null) };
  bank.items1[35] = { name: 'leather', q: 10 };
  const { c, calls } = runtime([{ name: 'leather', q: 49 }], bank);
  await c.runBankboiService({ id: 1, requests: [{ id: 'merge', pack: 'items1', slot: 35, item: entry(10).item }] });
  assert.equal(c.character.items[0].q, 59);
  assert.equal(bank.items1[35], null);
  assert.equal(calls.at(-1)[1].error, undefined);
}],
 ['two virtual panes reconcile through staging into a single stack',async () => {
  const bank = { items0: [], items1: Array(42).fill(null) };
  const homes = routing.homes(null, { a: { name: 'bankboi0', items: [entry(49)] }, b: { name: 'bankboi1', items: [entry(10)] } });
  const donor = runtime([{ name: 'leather', q: 10 }], bank);
  donor.c.character.name = 'bankboi1';
  await donor.c.runBankboiService({ id: 1, stackHomes: homes });
  assert.equal(donor.c.character.items.filter(Boolean).length, 0);
  assert.equal(bank.items1[35].q, 10);
  const recipient = runtime([{ name: 'leather', q: 49 }], bank);
  await recipient.c.runBankboiService({ id: 2, requests: [{ id: 'handoff', pack: 'items1', slot: 35, item: entry(10).item }] });
  assert.equal(recipient.c.character.items[0].q, 59);
  assert.equal(bank.items1[35], null);
}],
 ['compatible leather deposits merge in staging instead of consuming another reserve slot',async () => {
  const bank = {items0:Array(42).fill(null),items1:Array(42).fill(null)};
  bank.items1[35]={name:'leather',q:7};
  const {c}=runtime([{name:'leather',q:8}],bank);
  await c.bankStoreFully(0);
  assert.equal(bank.items1[35].q,15);
  assert.equal(bank.items1.filter(Boolean).length,1);
  assert.equal(bank.items0.filter(Boolean).length,0);
}],
 ['normal-bank deposits let the game merge into a compatible stack when duplicates exist',async () => {
  const bank={items0:[{name:'leather',q:17},{name:'leather',q:385}],items1:Array(42).fill(null)};
  const {c}=runtime([{name:'leather',q:4}],bank);
  await c.bankStoreFully(0);
  assert.equal(bank.items0[0].q,21);
  assert.equal(bank.items0[1].q,385);
  assert.equal(c.character.items[0],null);
}],
 ['overflow inventory items are recovered into a valid slot before banking',async () => {
  const items = Array(43).fill(null);
  items[42] = {name:'leather',q:4};
  const bank={items0:[{name:'leather',q:17}],items1:Array(42).fill(null)};
  const {c}=runtime(items,bank);
  c.character.isize=42;
  await c.bankStoreFully(42);
  assert.equal(bank.items0[0].q,21);
  assert.equal(c.character.items.filter(Boolean).length,0);
}],
 ['full staging is drained before a requested worker withdrawal is deposited',async()=>{
  const bank={items0:[],items1:Array(42).fill(null)};
  for(let i=35;i<42;i++) bank.items1[i]={name:'leather',q:1};
  const {c,calls}=runtime([{name:'leather',q:10},{name:'sword'},null],bank);
  await c.runBankboiService({id:1,requests:Array.from({length:7},(_,i)=>({id:String(i),pack:'items1',slot:35+i,item:{name:'leather',q:1}})),retrievals:[{item:{name:'sword'}}]});
  assert.equal(calls.at(-1)[1].error,undefined);
  assert.equal(calls.at(-1)[1].deposited.length,1);
  assert.equal(bank.items1[35].name,'sword');
  assert.equal(c.character.items[0].q,17);
  assert.equal(c.banking,false);
}],
 ['a partially failed service reports completed transfers and current inventory',async()=>{
  const bank={items0:[],items1:Array(42).fill(null)}; bank.items1[35]={name:'leather',q:2}; bank.items1[36]={name:'sword'};
  const {c,calls}=runtime([{name:'leather',q:10},null],bank);
  const retrieve=c.bank_retrieve;
  c.bank_retrieve=async(pack,slot)=>{assert.equal(c.banking,true);if(slot===36) throw Error('bank_unavailable');return retrieve(pack,slot);};
  await c.runBankboiService({id:1,requests:[{id:'a',pack:'items1',slot:35,item:{name:'leather'}},{id:'b',pack:'items1',slot:36,item:{name:'sword'}}]});
  const report=calls.at(-1)[1];
  assert.equal(report.error,'bank_unavailable');
  assert.deepEqual(Array.from(report.completed),['a']);
  assert.equal(report.items[0].item.q,12);
  assert.equal(c.banking,false);
}],
 ['bank checkpoint yields a merchant job after publishing the updated bank',async()=>{
  const bank={items0:[],items1:Array(42).fill(null)};
  const {c}=runtime([{name:'leather',q:2}],bank);c.character.ctype='merchant';
  let snapshot;
  c.request=async(url,options)=>{snapshot=options.body.bank;return {pending:true};};
  await assert.rejects(c.bankStoreFully(0),/bankboi_pending/);
  assert.equal(snapshot.packs.items0[0].item.q,2);
}],
// An interrupted worker (retryable code) runs again at its next report, so it has no cooldown.
 ['full staging during a second worker cooldown yields instead of declaring bank full',async()=>{
  const bank={items0:Array.from({length:42},()=>({name:'sword'})),items1:Array.from({length:42},()=>({name:'sword'}))};
  const {c}=runtime([{name:'dexamulet',level:2}],bank);c.character.ctype='merchant';
  const full=bank.items0.map(item=>({item}));
  const party={merchantCharacter:'M',withdrawals:{M:[]},bankSnapshot:{packs:{items0:full,items1:full}},
    bankbois:{B:{name:'B',state:'ready',items:full},C:{name:'C',state:'error',code:'interrupted',error:'interrupted',items:Array(42).fill(null)}},
    bankboiQueue:[{id:'a',state:'staged',slot:35,item:{name:'sword'}}]};
  c.request=async()=>({pending:!!routing.servicePlan(party)});
  await assert.rejects(c.bankStoreFully(0),/bankboi_pending/);
  assert.equal(c.character.items[0].name,'dexamulet');
}],
// B159: the BankBoi's bag sort ends on a swap the game never confirmed, and the
// report says so. b9b5c91e shared.js:4763 slept 120 ms after each swap and went on to the next.
 ['B159: the BankBoi bag sort stops at a swap the game does not confirm',async () => {
  const bank = { items0: [], items1: Array(42).fill(null) };
  const { c, calls } = runtime([{ name: 'wbook0' }, { name: 'sword' }, { name: 'apple' }, { name: 'hpot0' }, { name: 'bow' }], bank);
  const swaps = [];
  c.game.swap = async (a, b) => { swaps.push([a, b]); };
  await c.runBankboiService({ id: 1 });
  const report = calls.at(-1)[1];
  assert.equal(swaps.length, 1, 'the sort sends no swap after the unconfirmed one');
  assert.ok(report.activity.some(line => line.message === 'BankBoi bag sort stopped: a swap was not confirmed'), JSON.stringify(report.activity));
}],
]);

function bankMarks(c, automatic) {
  const party = { marked: { M: [{ slot: 1, item: { ...c.character.items[1] } }] },
    merchantMarked: {}, autoItemMarks: { M: automatic ? { 'leather@+0': 'bank' } : {} } };
  const { reconcileCollectionMarks } = require('../../runtime/items/coordinator/fates.ts');
  const { ruleMode } = require('../../runtime/items/identity.ts');
  return reconcileCollectionMarks(party.marked.M, [], c.character.items.map((item, slot) => ({ item, slot })),
    entry => ruleMode(party.autoItemMarks.M, entry.item)).bank;
}

for (const automatic of [false, true]) {
  test(automatic ? 'auto mark for bank deposits every matching stack' : 'mark for bank preserves an unmarked matching stack', async () => {
    const { c, calls } = runtime([{ name: 'leather', q: 10 }, { name: 'leather', q: 20 }], { items0: [{ name: 'leather', q: 30 }] });
    const marks = bankMarks(c, automatic);
    assert.deepEqual(Array.from(marks, mark => mark.slot).sort(), automatic ? [0, 1] : [1]);
    for (const mark of marks) await c.bankStoreFully(mark.slot);
    assert.equal(c.character.bank.items0[0].q, automatic ? 60 : 50);
    assert.equal(c.character.items[1], null);
    if (automatic) assert.ok(c.character.items.every(x => !x));
    else assert.deepEqual(c.character.items[0], { name: 'leather', q: 10 });
    assert.equal(calls.some(call => call[0] === 'retrieve'), false, 'deposits must not withdraw unrequested bank stock');
  });
}

