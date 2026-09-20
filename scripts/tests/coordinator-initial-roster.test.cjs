const test=require('node:test'),assert=require('node:assert/strict');
const {initialHeadlessSlots,initialSteamRoster}=require('../../runtime/coordinator/characters/initial-roster.ts');
test('saved headless slots retain explicit empties and order without mutating the source',()=>{
 const saved=['B',null,'A','C','D'];assert.deepEqual(initialHeadlessSlots({headlessSlots:saved},{}),['B',null,'A','C']);assert.equal(saved.length,5);
 assert.deepEqual(initialHeadlessSlots({headlessSlots:[]},{F:{enabled:true}}),[null,null,null,null]);
 assert.deepEqual(initialHeadlessSlots({headlessSlots:['F']},{}),['F',null,null,null]);
});
test('missing saved slots inherit at most three enabled workers',()=>{
 assert.deepEqual(initialHeadlessSlots({}, {Off:{enabled:false},A:{enabled:true},B:{enabled:1},C:{enabled:true},D:{enabled:true}}),['A','B','C',null]);
});
test('Steam membership preserves saved arrays and migrates only absent legacy membership',()=>{
 const members=[],handoff={phase:'pending'};const state=initialSteamRoster({nativeOwner:'M',steamMembers:members,steamSwitch:handoff});
 assert.equal(state.steamMembers,members);assert.equal(state.steamSwitch,handoff);assert.equal(state.nativeOwner,'M');
 assert.deepEqual(initialSteamRoster({nativeOwner:'M'}).steamMembers,['M']);assert.deepEqual(initialSteamRoster({}).steamMembers,[]);assert.notEqual(initialSteamRoster({}).lifecycle,initialSteamRoster({}).lifecycle);
});
