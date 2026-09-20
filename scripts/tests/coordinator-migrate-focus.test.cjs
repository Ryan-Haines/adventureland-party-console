const test=require('node:test'),assert=require('node:assert/strict');
const {migrateSharedMonsterFocus}=require('../../runtime/coordinator/navigation/migrate-focus.ts');
const {migrateEmptyFocusIntents}=require('../../runtime/coordinator/navigation/migrate-focus.ts');
test('empty focus migration cancels shared then independent return intent only without saved navigation',()=>{
 const state={leader:'L',monsterFocus:[],monsterFocusByCharacter:{L:[],F:[],Solo:['bat'],Bad:null}},calls=[];
 const navigation={members:()=>['L','F'],invalidate:(...args)=>calls.push(args)};
 migrateEmptyFocusIntents(undefined,state,navigation);
 assert.deepEqual(calls,[[['L','F'],'empty focus on migration',true],[['F'],'empty focus on migration']]);
 calls.length=0;migrateEmptyFocusIntents({},state,navigation);assert.deepEqual(calls,[]);
 state.monsterFocus=['bat'];migrateEmptyFocusIntents(null,state,navigation);assert.deepEqual(calls,[[['F'],'empty focus on migration']]);
});
test('legacy leader focus replaces stale shared focus and removes only participating overrides',()=>{
 const selected=['bat'];const state={leader:'L',monsterFocus:['phoenix'],monsterFocusByCharacter:{L:selected,F:['goo'],Solo:['snake']},followers:{F:true,Solo:false}};
 migrateSharedMonsterFocus(state);assert.deepEqual(state.monsterFocus,['bat']);assert.notEqual(state.monsterFocus,selected);assert.deepEqual(state.monsterFocusByCharacter,{Solo:['snake']});
 state.monsterFocus=[];migrateSharedMonsterFocus(state);assert.deepEqual(state.monsterFocus,[]);
});
test('an explicit empty leader focus clears the shared focus',()=>{
 const state={leader:'L',monsterFocus:['bat'],monsterFocusByCharacter:{L:[]},followers:{}};
 migrateSharedMonsterFocus(state);assert.deepEqual(state.monsterFocus,[]);assert.deepEqual(state.monsterFocusByCharacter,{});
});
test('no legacy leader override leaves follower selections intact',()=>{
 const state={leader:'L',monsterFocus:['bat'],monsterFocusByCharacter:{F:['goo']},followers:{F:true}},focus=state.monsterFocus;
 migrateSharedMonsterFocus(state);assert.equal(state.monsterFocus,focus);assert.deepEqual(state.monsterFocusByCharacter,{F:['goo']});
});
