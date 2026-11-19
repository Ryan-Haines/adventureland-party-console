const test=require('node:test'),assert=require('node:assert/strict');
const {migrateHeadlessRealms}=require('../../runtime/merchant-realm/api.ts');
const {migrateEventSelections}=require('../../runtime/events/coordinator/api.ts');
// An older all-events flag selects the event kind rows but the anniversary and the Halloween fights.
const legacyFlag=['anniversary','abtesting','goobrawl','crabxx','franky','icegolem','snowman','horseman','graveyard','trickortreat','witchcipher'];
// The settings writer as the test's state: each change sets one character's entry.
function migrateCharacterSelections(state,workers){
 const batches=[];
 migrateEventSelections(state,workers,batch=>{batches.push(batch);for(const c of batch.changes)state.eventSelectionsByCharacter[c.character]=c.value;return {ok:true};},message=>assert.fail(message));
 for(const batch of batches)assert.equal(batch.by,'core:events');
 migrateHeadlessRealms(state,workers);
}
// Migration cannot be seeded through the live formation endpoint, which writes
// explicit selections. Failures: legacy true silently enables newly supported
// bosses; explicit opt-in is overwritten; merchant inherits legacy all-events.
test('new Halloween support leaves legacy all-events migration opt-in',()=>{
 const halloween=['slenderman','mrgreen','mrpumpkin'];
 const state={merchantCharacter:'M',eventSelectionsByCharacter:{Explicit:[...halloween],Empty:[]},eventsByCharacter:{F:true,M:true,Explicit:true,Empty:true},headlessSlots:[],bankbois:{},activeRealm:'SR_USII'};
 migrateCharacterSelections(state,{F:{},Explicit:{},Empty:{}});
 assert.deepEqual(state.eventSelectionsByCharacter.F,legacyFlag);
 assert.deepEqual(state.eventSelectionsByCharacter.Explicit,halloween);
 assert.deepEqual(state.eventSelectionsByCharacter.Empty,[]);
 assert.deepEqual(state.eventSelectionsByCharacter.M,['anniversary']);
});
test('legacy event flags migrate while explicit empty and undefined selections stay authoritative',()=>{
 const state={merchantCharacter:'M',eventSelectionsByCharacter:{Empty:[],Undefined:undefined},eventsByCharacter:{F:true,M:true,Empty:true,Undefined:true},headlessSlots:[],bankbois:{},activeRealm:'SR_USII'};
 migrateCharacterSelections(state,{F:{},Off:{},Empty:{},Undefined:{}});
 assert.deepEqual(state.eventSelectionsByCharacter.F,legacyFlag);assert.deepEqual(state.eventSelectionsByCharacter.Off,['anniversary']);assert.deepEqual(state.eventSelectionsByCharacter.M,['anniversary']);assert.deepEqual(state.eventSelectionsByCharacter.Empty,[]);assert.equal(state.eventSelectionsByCharacter.Undefined,undefined);
});
test('only known occupied headless slots inherit the active realm, excluding BankBoi',()=>{
 const workers={F:{realm:'old'},B:{realm:'bank'},Steam:{realm:'steam'}};
 const state={merchantCharacter:'M',eventSelectionsByCharacter:{},eventsByCharacter:{},headlessSlots:['F','B','Unknown',null],bankbois:{B:{}},activeRealm:'SR_USII'};
 migrateCharacterSelections(state,workers);assert.equal(workers.F.realm,'SR_USII');assert.equal(workers.B.realm,'bank');assert.equal(workers.Steam.realm,'steam');assert.equal(workers.Unknown,undefined);
});
