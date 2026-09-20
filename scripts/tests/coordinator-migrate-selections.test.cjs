const test=require('node:test'),assert=require('node:assert/strict');
const {migrateCharacterSelections}=require('../../runtime/coordinator/characters/migrate-selections.ts');
test('legacy event flags migrate while explicit empty and undefined selections stay authoritative',()=>{
 const state={merchantCharacter:'M',eventSelectionsByCharacter:{Empty:[],Undefined:undefined},eventsByCharacter:{F:true,M:true,Empty:true,Undefined:true},headlessSlots:[],bankbois:{},activeRealm:'SR_USII'};
 migrateCharacterSelections(state,{F:{},Off:{},Empty:{},Undefined:{}},['franky','anniversary','abtesting']);
 assert.deepEqual(state.eventSelectionsByCharacter.F,['anniversary','franky','abtesting']);assert.deepEqual(state.eventSelectionsByCharacter.Off,['anniversary']);assert.deepEqual(state.eventSelectionsByCharacter.M,['anniversary']);assert.deepEqual(state.eventSelectionsByCharacter.Empty,[]);assert.equal(state.eventSelectionsByCharacter.Undefined,undefined);
});
test('only known occupied headless slots inherit the active realm, excluding BankBoi',()=>{
 const workers={F:{realm:'old'},B:{realm:'bank'},Steam:{realm:'steam'}};
 const state={merchantCharacter:'M',eventSelectionsByCharacter:{},eventsByCharacter:{},headlessSlots:['F','B','Unknown',null],bankbois:{B:{}},activeRealm:'SR_USII'};
 migrateCharacterSelections(state,workers,[]);assert.equal(workers.F.realm,'SR_USII');assert.equal(workers.B.realm,'bank');assert.equal(workers.Steam.realm,'steam');assert.equal(workers.Unknown,undefined);
});
