const test=require('node:test');
const assert=require('node:assert/strict');
const {stateKeys,bankFields,rosterFields,selectionFields,settingsFields,selectSnapshot,settingsSnapshot,authSnapshot,historySnapshot}=require('../../runtime/coordinator/persistence/snapshots.ts');

test('v1 persistence keeps its exact keys and excludes transient runtime fields',()=>{
  assert.deepEqual(Object.values(stateKeys),['party_dashboard_bank_state_v1','party_dashboard_settings_state_v1',
    'party_dashboard_selections_state_v1','party_dashboard_history_state_v1','party_dashboard_roster_state_v1','party_dashboard_aldata_state_v1']);
  for(const fields of [bankFields,rosterFields,selectionFields]) {
    const state=Object.fromEntries(fields.map(field=>[field,{preserved:field}]));
    state.timer=setTimeout(()=>{},1000);state.transient='not saved';
    try {const snapshot=selectSnapshot(state,fields);assert.deepEqual(Object.keys(snapshot),fields);assert.doesNotThrow(()=>JSON.stringify(snapshot));}
    finally {clearTimeout(state.timer);}
  }
});

test('settings flatten only the persisted marketplace fields and preserve cleared focus separately',()=>{
  const state=Object.fromEntries(settingsFields.map(field=>[field,null]));
  state.aldata={marketListings:[{id:1}],marketBuyOrders:[],trades:[],merchantsUpdatedAt:10,tradesUpdatedAt:20,key:'secret',publishTimer:{}};
  const snapshot=settingsSnapshot(state);
  assert.equal(snapshot.aldataMarketListings,state.aldata.marketListings);assert.equal('aldata' in snapshot,false);
  assert.equal(JSON.stringify(snapshot).includes('secret'),false);
  assert.deepEqual(selectSnapshot({monsterFocus:[],eventReturn:{destination:'old'}},['monsterFocus']),{monsterFocus:[]});
  assert.deepEqual(authSnapshot({...state.aldata,auth:'YES',authCheckedAt:2,publishedAt:3}),{key:'secret',auth:'YES',authCheckedAt:2,publishedAt:3});
});

test('history snapshots cap every stream without modifying live arrays',()=>{
  const entries=Array.from({length:600},(_,id)=>({id}));
  const snapshot=historySnapshot(entries,{P:entries,M:entries.slice(0,20)});
  assert.equal(snapshot.merchantActivity.length,500);assert.equal(snapshot.combatLogs.P[0].id,100);
  assert.equal(snapshot.combatLogs.M.length,20);assert.equal(entries.length,600);
});
