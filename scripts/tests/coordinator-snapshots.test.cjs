const test=require('node:test');
const assert=require('node:assert/strict');
const {selectSnapshot,settingsSnapshot,authSnapshot,historySnapshot}=require('../../runtime/settings/coordinator/persistence/snapshots.ts');
const {settingsFields}=require('../../runtime/settings/coordinator/table.ts').coordinatorSettings().lists;

test('settings flatten only the persisted marketplace fields and preserve cleared focus separately',()=>{
  const state=Object.fromEntries(settingsFields.map(field=>[field,null]));
  state.aldata={marketListings:[{id:1}],marketBuyOrders:[],trades:[],merchantsUpdatedAt:10,tradesUpdatedAt:20,key:'secret',publishTimer:{}};
  const snapshot=settingsSnapshot(state,settingsFields);
  assert.equal(snapshot.aldataMarketListings,state.aldata.marketListings);assert.equal('aldata' in snapshot,false);
  assert.equal(JSON.stringify(snapshot).includes('secret'),false);
  assert.deepEqual(selectSnapshot({monsterFocus:[],eventReturn:{destination:'old'}},['monsterFocus']),{monsterFocus:[]});
  assert.deepEqual(authSnapshot({...state.aldata,auth:'YES',authCheckedAt:2,publishedAt:3}),{key:'secret',auth:'YES',authCheckedAt:2,publishedAt:3});
});

test('history snapshots cap every stream without modifying live arrays',()=>{
  const entries=Array.from({length:600},(_,id)=>({id}));
  // The settings audit lines keep the same newest 500.
  const snapshot=historySnapshot(entries,{P:entries,M:entries.slice(0,20)},entries,500);
  assert.equal(snapshot.merchantActivity.length,500);assert.equal(snapshot.combatLogs.P[0].id,100);assert.equal(snapshot.settingsChanges[0].id,100);
  assert.equal(snapshot.combatLogs.M.length,20);assert.equal(entries.length,600);
});
