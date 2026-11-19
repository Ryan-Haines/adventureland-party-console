const test=require('node:test'),assert=require('node:assert/strict');
const {initializeCoordinatorState}=require('../../runtime/settings/coordinator/initial.ts');
const {stateKeys}=require('../../runtime/settings/coordinator/persistence/snapshots.ts');
test('portable merchant defaults preserve saved selection and explicit absence without writing storage', () => {
  for (const [savedMerchant, merchantDefault, expected] of [
    [undefined, 'AccountMerchant', 'AccountMerchant'],
    ['SavedMerchant', 'AccountMerchant', 'SavedMerchant'],
    [undefined, null, null], ['SavedMerchant', null, 'SavedMerchant'],
    // A fresh console names no merchant until one connects; the old row asserted the owner's
    // merchant, the bug itself.
    ['', null, null], [undefined, undefined, null],
  ]) {
    const storage = {get: key => key === stateKeys.settings ? JSON.stringify({merchantCharacter: savedMerchant}) : undefined,
      set: () => assert.fail('default selection must not rewrite saved settings')};
    const result = initializeCoordinatorState(storage, {}, 'SR_USII', {
      merchantDefault, now: () => 100, loadBankVaultDefinitions: () => [], log: { warn: () => assert.fail('valid defaults warned') },
    });
    assert.equal(result.party.merchantCharacter, expected);
    assert.equal(result.persistedSettings.merchantCharacter, savedMerchant);
  }
});

// An empty journal loads every declared field as the current console's fresh install does
// (fresh-state-.json, made by the command it names), its scoped fields through the farming scopes
// the start makes, and a field new since then loads its declared default. The row reads the state
// the start itself composed.
test('an empty journal loads every declared field as a fresh install does', async () => {
  const fresh = require('./fixtures/fresh-state-b9b5c91e.json').state;
  const {table} = require('../../runtime/settings/coordinator/table.ts').coordinatorSettings();
  // The farming scopes as the start composes them (application.ts): the row runs the start and
  // keeps the scope builder and the lists it hands it, then builds them over an empty journal's load.
  let startScopes;
  await require('./helpers/coordinator-host.cjs').run(100, {'../tasks/coordinator/api.ts': api => ({...api,
    createFarmingScopes(state, lists, ...rest) { startScopes = {build: api.createFarmingScopes, lists}; return api.createFarmingScopes(state, lists, ...rest); }})});
  assert.ok(startScopes, 'the start makes the farming scopes');
  const {party} = initializeCoordinatorState({get: () => undefined, set: () => {}}, {}, 'SR_USII', {
    now: () => 100, loadBankVaultDefinitions: () => [], log: { warn: () => assert.fail('an empty journal warned') },
  });
  startScopes.build(party, startScopes.lists, () => 100);
  const json = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  // A setting with a `path` sits inside a `party` object: the ALData key is `party.aldata.key`.
  const at = (value, {field, setting}) => setting.path ? value?.[setting.path[0]]?.[setting.path[1]] : value?.[field];
  // A fresh install's value a later fix changed on purpose: v1.5.0 named the
  // owner's merchant, and a fresh console now names none until one connects. The relocation switch
  // left the Hunt settings for its own root setting (hunting/coordinator/record.ts), so the Hunt
  // settings load without it.
  const {relocateIfCompeting: _moved, ...huntSettings} = fresh.huntSettings;
  const fixed = {merchantCharacter: null, huntSettings};
  for (const declared of table.fields.values()) {
    const fromFresh = declared.setting.path ? declared.setting.path[0] in fresh : declared.field in fresh;
    const expected = declared.field in fixed ? fixed[declared.field] : fromFresh ? at(fresh, declared) : json(declared.setting.default);
    assert.deepEqual(json(at(party, declared)), expected, declared.field);
  }
  // The settings that held an environment value load as that value unset, the value each environment reader returned for an empty value
  // before deleted it (tasks/escape-hold.ts, lifecycle/console-control.ts, now runtime/lifecycle/coordinator/control.ts): the stuck notice
  // null (two report intervals on each character), the click wait with no entry (the reply's 5 s), the Resume lockout 5 s and the resume wait
  // after a clean shutdown 180 s.
  assert.equal(party.movementStuckNoticeMs, null);
  assert.deepEqual(party.movementClickWaitMs, {});
  assert.equal(party.escapeResumeLockoutMs, 5_000);
  assert.equal(party.consoleResumeWaitMs, 180_000);
});

// (the load keeps every value v1.5.0 loaded): a v1.5.0 settings document
// loads through declared() and the one pass over the declarations. A bag count past the base bag
// loads as 42, as clamp did; a wrong type loads its default, as v1.5.0's `=== true`
// and `!== false` did; a setting no initializer names (goldReserve, protectedFreeSlots,
// mailCheckSeconds, appLocks) keeps its save.: the status owner's two dashboard preferences load
// through the same pass, so status/fields.ts keeps no initializer of its own; a saved prefix of
// any text loads as did.
test('a the earlier console settings document loads through the declarations and keeps every value the earlier console loaded', () => {
  const saved = {itemCollectionThreshold: 50, autoStandBuys: 'yes', autoBlacklistMerchants: 'no', merchantForceStand: 1,
    gatheringMode: 'fishing', luckyUpgradeSlots: {GoldMajesty: 7, Other: 3}, activeRealm: 'ASIAI',
    goldReserve: 2500, protectedFreeSlots: 3, mailCheckSeconds: 60, appLocks: ['threshold'], bankboiPrefix: 'ab', anniversaryAutoChat: 'yes'};
  const {party} = initializeCoordinatorState({get: key => key === stateKeys.settings ? JSON.stringify(saved) : undefined, set: () => {}}, {}, 'SR_USII', {
    now: () => 100, loadBankVaultDefinitions: () => [], log: {warn: () => assert.fail('a valid document warned')}});
  assert.deepEqual([party.itemCollectionThreshold, party.autoStandBuys, party.autoBlacklistMerchants, party.merchantForceStand],
    [42, false, true, false]);
  assert.deepEqual([party.gatheringModes, party.luckyUpgradeSlots, party.activeRealm], [['fishing'], {Other: 3}, 'ASIAI']);
  assert.deepEqual([party.goldReserve, party.protectedFreeSlots, party.mailCheckSeconds, party.appLocks], [2500, 3, 60, ['threshold']]);
  assert.deepEqual([party.bankboiPrefix, party.anniversaryAutoChat], ['ab', false]);
  assert.equal(require('../../runtime/status/fields.ts').dashboardPreferences, undefined);
});

// The load migration (hunting/coordinator/record.ts): a save from before the root setting keeps the
// competing-farm switch in the party's Hunt settings, which loads as the root setting and leaves
// the Hunt settings without it.
test('a saved huntSettings.relocateIfCompeting false loads as the root setting', () => {
  const saved = {huntSettings: {relocateIfCompeting: false}};
  const {party} = initializeCoordinatorState({get: key => key === stateKeys.settings ? JSON.stringify(saved) : undefined, set: () => {}}, {}, 'SR_USII', {
    now: () => 100, loadBankVaultDefinitions: () => [], log: {warn: () => assert.fail('a valid document warned')}});
  assert.equal(party.relocateIfCompeting, false);
  assert.equal('relocateIfCompeting' in party.huntSettings, false);
});

test('malformed roster JSON falls back independently while valid settings survive',()=>{
 const warnings=[];
 const result=initializeCoordinatorState({get:key=>key===stateKeys.roster?'{broken':key===stateKeys.settings?'{"merchantCharacter":"M"}':undefined,set:()=>{}},
  {P:{enabled:true},Off:{enabled:false},M:{enabled:true}},'SR_USII',{
   now:()=>100,loadBankVaultDefinitions:()=>[],log:{warn:(details,message)=>warnings.push({details,message})},
  });
 assert.deepEqual(result.party.headlessSlots,['P','M',null,null]);assert.equal(result.party.merchantCharacter,'M');
 assert.equal(warnings.length,1);assert.equal(warnings[0].message,'Ignoring invalid persisted Party Console roster state');
 assert.ok(warnings[0].details.error instanceof SyntaxError);
});

// Settings layout 2: docs/efficiency.md (Persistence), failure inventory P3 items 1-3.
const fs=require('node:fs'),path=require('node:path');
const {CoordinatorJsonlStore}=require('../../runtime/settings/coordinator/persistence/jsonl-store.ts');
function journal(t,records){
 fs.mkdirSync('.build/store-tests',{recursive:true});const dir=fs.mkdtempSync(path.resolve('.build/store-tests/layout-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const main=path.join(dir,'state.jsonl');fs.writeFileSync(main,records.map(record=>JSON.stringify(record)+'\n').join(''));
 return new CoordinatorJsonlStore(main,path.join(dir,'state.new.jsonl'),{setTimeout,clearTimeout});
}
function load(storage){
 return initializeCoordinatorState(storage,{},'SR_USII',{now:()=>100,loadBankVaultDefinitions:()=>[],warn:(details,message)=>assert.fail(message)});
}
// Shape of a v1.4.0 journal: market cache and production inside settings.
const v140Settings={merchantCharacter:'M',threshold:7,production:{attempts:{a1:{journal:{phase:'complete'}}}},
 aldataMarketListings:[{item:'old'}],aldataMarketBuyOrders:[{item:'wtb'}],aldataTrades:[{id:1}],aldataMerchantsUpdatedAt:5,aldataTradesUpdatedAt:6};
test('a v1.4.0 journal with only the monolithic settings document loads every field',t=>{
 const store=journal(t,[{[stateKeys.settings]:{threshold:1}},{[stateKeys.settings]:v140Settings}]);
 try{
  const {party}=load(store);
  assert.equal(party.merchantCharacter,'M');assert.equal(party.threshold,7);
  assert.deepEqual(party.production,v140Settings.production);
  assert.deepEqual(party.aldata.marketListings,[{item:'old'}]);assert.deepEqual(party.aldata.marketBuyOrders,[{item:'wtb'}]);
  assert.deepEqual(party.aldata.trades,[{id:1}]);assert.equal(party.aldata.merchantsUpdatedAt,5);assert.equal(party.aldata.tradesUpdatedAt,6);
 }finally{store.close();}
});
test('split documents override a layout 2 settings document',t=>{
 const store=journal(t,[
  {[stateKeys.market]:{aldataMarketListings:[{item:'new'}],aldataMarketBuyOrders:[],aldataTrades:[],aldataMerchantsUpdatedAt:9,aldataTradesUpdatedAt:9}},
  {[stateKeys.production]:{production:{attempts:{a2:{journal:{phase:'running'}}}}}},
  {[stateKeys.settings]:{...v140Settings,persistenceLayout:2}},
 ]);
 try{
  const {party,persistedSettings}=load(store);
  assert.deepEqual(party.aldata.marketListings,[{item:'new'}]);assert.equal(party.aldata.merchantsUpdatedAt,9);
  assert.deepEqual(Object.keys(party.production.attempts),['a2']);assert.equal(party.threshold,7);
  assert.equal('persistenceLayout' in persistedSettings,false,'the marker is not a setting');
 }finally{store.close();}
});
test('settings rewritten by a v1.4.0 build after a rollback win over older split documents',t=>{
 const store=journal(t,[
  {[stateKeys.production]:{production:{attempts:{stale:{}}}}},
  {[stateKeys.market]:{aldataMarketListings:[{item:'stale'}]}},
  {[stateKeys.settings]:{...v140Settings,persistenceLayout:2}},
  {[stateKeys.settings]:v140Settings},
 ]);
 try{
  const {party}=load(store);
  assert.deepEqual(Object.keys(party.production.attempts),['a1']);assert.deepEqual(party.aldata.marketListings,[{item:'old'}]);
 }finally{store.close();}
});

// The start composes the hidden settings in one pass over the declarations, so a hidden setting no
// line names still reaches the state. above reads each declared default on an empty save; this row
// reads each saved copy, every owner's hidden setting at once, lifecycle's among them.
test('every hidden setting loads its saved copy through the one pass', () => {
  const {coordinatorSettings} = require('../../runtime/settings/coordinator/table.ts');
  const {declaredSettings} = require('../../runtime/settings/lists.ts');
  const hidden = declaredSettings(coordinatorSettings().table).filter(entry => !entry.record && entry.hidden);
  assert.ok(hidden.some(entry => entry.owner === 'core:lifecycle'), "lifecycle's hidden picks are in the table");
  const saved = Object.fromEntries(hidden.map(entry => [entry.field, Number(entry.default) + 1]));
  const {party} = initializeCoordinatorState({get: key => key === stateKeys.settings ? JSON.stringify(saved) : undefined, set: () => {}}, {}, 'SR_USII', {
    now: () => 100, loadBankVaultDefinitions: () => [], log: {warn: () => assert.fail('a saved hidden setting warned')},
  });
  for (const entry of hidden) assert.equal(party[entry.field], saved[entry.field], entry.field);
});

// The start builds each part after what it reads. The metrics service takes its first account gold
// point as it opens, which reads the roster projection (slotPayload); a projection declared later in
// application.ts threw "Cannot access 'rosterProjection' before initialization" there, and the
// start went on with metrics unavailable (side-by-side dry run, 2026-11-16).
test('the coordinator start reaches its ready state with no ReferenceError', async () => {
  const host = await require('./helpers/coordinator-host.cjs').run(100);
  const references = host.warnings.flat().filter(value => value instanceof ReferenceError || value?.error instanceof ReferenceError);
  assert.deepEqual(references.map(value => String(value.error ?? value)), []);
});
