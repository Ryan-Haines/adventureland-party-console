const test=require('node:test'),assert=require('node:assert/strict');
const {initialRecoveryState,initialPartySelection,initialEventState,initialMarketObservations,initialCatalogs}=require('../../runtime/coordinator/initial-core.ts');
test('core initialization retains durable recovery and party selections',()=>{
 const saved={combatRecovery:{phase:'returning'},combatResetByCharacter:{F:3},groupedCombatResetAt:4,leader:'F',location:{map:'main'},followers:{P:true},eventSelectionsByCharacter:{F:[]}};
 const recovery=initialRecoveryState(saved),selection=initialPartySelection(saved);
 assert.equal(recovery.combatRecovery,saved.combatRecovery);assert.equal(recovery.combatResetByCharacter,saved.combatResetByCharacter);assert.equal(recovery.groupedCombatResetAt,4);assert.equal(selection.location,saved.location);assert.equal(selection.eventSelectionsByCharacter,saved.eventSelectionsByCharacter);
});
test('event startup preserves saved realm and returns while resetting runtime fields',()=>{
 const saved={activeRealm:'',eventReturn:{id:1},eventSessions:{a:{}},deferredEventReturns:{b:{}},abtestingStrategy:{stage:'pending'}};
 const state=initialEventState(saved,'SR_USII');assert.equal(state.activeRealm,'');assert.equal(state.eventReturn,saved.eventReturn);assert.equal(state.eventSessions,saved.eventSessions);assert.equal(state.deferredEventReturns,saved.deferredEventReturns);assert.equal(state.abtestingStrategy,saved.abtestingStrategy);assert.equal(state.realmSwitch,null);assert.equal(state.eventReturnLast,null);assert.equal(initialEventState({},'SR_USII').activeRealm,'SR_USII');
});
test('runtime market observations and catalogs start empty with independent collections',()=>{
 const a=initialMarketObservations(),b=initialMarketObservations();assert.equal(a.standSearch.status,'idle');assert.equal(a.ponty.updatedAt,0);assert.notEqual(a.ponty.listings,b.ponty.listings);assert.notEqual(a.standListingCache,b.standListingCache);assert.ok(Object.values(initialCatalogs()).every(value=>value===null));
});
