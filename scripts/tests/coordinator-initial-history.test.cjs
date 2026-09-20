const test=require('node:test'),assert=require('node:assert/strict');
const {initialCoordinatorHistory}=require('../../runtime/coordinator/telemetry/initial-history.ts');
test('history documents take precedence and arrays retain only the latest 500 entries',()=>{
 const entries=Array.from({length:501},(_,at)=>({message:'hit',at}));
 const result=initialCoordinatorHistory({merchantActivity:entries,combatLogs:{F:entries}},{merchantActivity:['old'],combatLogs:{Old:[]}});
 assert.equal(result.merchantActivity.length,500);assert.equal(result.combatLogs.F[0],entries[1]);assert.equal(result.combatLogs.Old,undefined);assert.equal(entries.length,501);
 assert.deepEqual(initialCoordinatorHistory({merchantActivity:[],combatLogs:{}},{merchantActivity:['old']}),{merchantActivity:[],combatLogs:{}});
});
test('legacy potion and invalid kill entries are removed before consecutive skill deduplication',()=>{
 const skill=at=>({type:'skill',message:'Slam',at});
 const entries=[null,{message:'Used HP potion'},{message:'Used MP potion'},{type:'kill'},skill(0),{type:'kill',details:{xp:'bad'}},skill(999),skill(1000),{type:'kill',details:{xp:'0'}},skill(1001)];
 const result=initialCoordinatorHistory({},{combatLogs:{F:entries,B:'bad'}});
 assert.deepEqual(result.combatLogs.F,[skill(0),skill(1000),{type:'kill',details:{xp:'0'}},skill(1001)]);assert.deepEqual(result.combatLogs.B,[]);
});
test('out-of-order nearby skill timestamps use absolute distance and compare retained entries',()=>{
 const entries=[2000,1500,1000].map(at=>({type:'skill',message:'Cleave',at}));
 assert.deepEqual(initialCoordinatorHistory({combatLogs:{F:entries}},{}).combatLogs.F,[entries[0],entries[2]]);
});
