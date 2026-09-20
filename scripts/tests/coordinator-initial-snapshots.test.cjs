const test=require('node:test'),assert=require('node:assert/strict');
const {readInitialCoordinatorSnapshots}=require('../../runtime/coordinator/persistence/initial-snapshots.ts');
test('startup reads the six versioned documents in order without writing',()=>{
 const keys=[],storage={get:key=>{keys.push(key);return JSON.stringify({key});},set:()=>{throw Error('unexpected write');}};
 const snapshots=readInitialCoordinatorSnapshots(storage,()=>{throw Error('unexpected warning');});
 assert.deepEqual(keys,['party_dashboard_bank_state_v1','party_dashboard_settings_state_v1','party_dashboard_selections_state_v1','party_dashboard_history_state_v1','party_dashboard_roster_state_v1','party_dashboard_aldata_state_v1']);
 assert.equal(snapshots.persistedRoster.key,keys[4]);assert.equal(snapshots.persistedALData.key,keys[5]);
});
test('one corrupt or unreadable document does not discard the others',()=>{
 const warnings=[];const result=readInitialCoordinatorSnapshots({get:key=>{if(key.includes('bank'))throw Error('read failed');if(key.includes('settings'))return '{';return '{"saved":true}';},set(){}},(...args)=>warnings.push(args));
 assert.deepEqual(result.persistedBankState,{});assert.deepEqual(result.persistedSettings,{});assert.deepEqual(result.persistedRoster,{saved:true});
 assert.equal(warnings[0][1],'Ignoring invalid persisted Party Console bank state');assert.equal(warnings[1][1],'Ignoring invalid persisted Party Console settings');
});
test('legacy JSON values remain unchanged while missing documents default independently',()=>{
 const result=readInitialCoordinatorSnapshots({get:key=>key.includes('roster')?'null':key.includes('history')?'[]':undefined,set(){}},()=>{});
 assert.equal(result.persistedRoster,null);assert.deepEqual(result.persistedHistory,[]);assert.deepEqual(result.persistedSettings,{});assert.notEqual(result.persistedSettings,result.persistedBankState);
});
