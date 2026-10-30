const test=require('node:test'),assert=require('node:assert/strict');
const {initializeCoordinatorState}=require('../../runtime/coordinator/initialization.ts');
const {stateKeys}=require('../../runtime/coordinator/persistence/snapshots.ts');
test('portable merchant defaults preserve saved selection and explicit absence without writing storage', () => {
  for (const [savedMerchant, merchantDefault, expected] of [
    [undefined, 'AccountMerchant', 'AccountMerchant'],
    ['SavedMerchant', 'AccountMerchant', 'SavedMerchant'],
    [undefined, null, null], ['SavedMerchant', null, 'SavedMerchant'],
    ['', null, null], [undefined, undefined, 'GoldMajesty'],
  ]) {
    const storage = {get: key => key === stateKeys.settings ? JSON.stringify({merchantCharacter: savedMerchant}) : undefined,
      set: () => assert.fail('default selection must not rewrite saved settings')};
    const result = initializeCoordinatorState(storage, {}, 'SR_USII', {
      merchantDefault, now: () => 100, loadBankVaultDefinitions: () => [], warn: () => assert.fail('valid defaults warned'),
    });
    assert.equal(result.party.merchantCharacter, expected);
    assert.equal(result.persistedSettings.merchantCharacter, savedMerchant);
  }
});

test('malformed roster JSON falls back independently while valid settings survive',()=>{
 const warnings=[];
 const result=initializeCoordinatorState({get:key=>key===stateKeys.roster?'{broken':key===stateKeys.settings?'{"merchantCharacter":"M"}':undefined,set:()=>{}},
  {P:{enabled:true},Off:{enabled:false},M:{enabled:true}},'SR_USII',{
   now:()=>100,loadBankVaultDefinitions:()=>[],warn:(details,message)=>warnings.push({details,message}),
  });
 assert.deepEqual(result.party.headlessSlots,['P','M',null,null]);assert.equal(result.party.merchantCharacter,'M');
 assert.equal(warnings.length,1);assert.equal(warnings[0].message,'Ignoring invalid persisted Party Console roster state');
 assert.ok(warnings[0].details.error instanceof SyntaxError);
});

// Settings layout 2: docs/efficiency.md (Persistence), failure inventory P3 items 1-3.
const fs=require('node:fs'),path=require('node:path');
const {CoordinatorJsonlStore}=require('../../runtime/coordinator/persistence/jsonl-store.ts');
function journal(t,records){
 fs.mkdirSync('.build/store-tests',{recursive:true});const dir=fs.mkdtempSync(path.resolve('.build/store-tests/layout-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const main=path.join(dir,'state.jsonl');fs.writeFileSync(main,records.map(record=>JSON.stringify(record)+'\n').join(''));
 return new CoordinatorJsonlStore(main,path.join(dir,'state.new.jsonl'));
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
