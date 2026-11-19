const test=require('node:test'),assert=require('node:assert/strict');
const {initialCoordinatorHistory}=require('../../runtime/status/coordinator/logs.ts');
test('history documents take precedence and arrays retain only the latest 500 entries',()=>{
 const entries=Array.from({length:501},(_,at)=>({message:'hit',at}));
 const result=initialCoordinatorHistory({merchantActivity:entries,combatLogs:{F:entries}},{merchantActivity:['old'],combatLogs:{Old:[]}});
 assert.equal(result.merchantActivity.length,500);assert.equal(result.combatLogs.F[0],entries[1]);assert.equal(result.combatLogs.Old,undefined);assert.equal(entries.length,501);
 assert.deepEqual(initialCoordinatorHistory({merchantActivity:[],combatLogs:{}},{merchantActivity:['old']}),{merchantActivity:[],combatLogs:{}});
});
test('legacy potion and invalid kill entries are removed and a line with a kept id is kept once',()=>{
 const skill=(at,seq)=>({type:'skill',message:'Slam',at,session:'s',seq});
 const entries=[null,{message:'Used HP potion'},{message:'Used MP potion'},{type:'kill'},skill(0,1),{type:'kill',details:{xp:'bad'}},skill(999,1),skill(1000,2),{type:'kill',details:{xp:'0'}},{type:'skill',message:'Slam',at:1001}];
 const result=initialCoordinatorHistory({},{combatLogs:{F:entries,B:'bad'}});
 assert.deepEqual(result.combatLogs.F,[skill(0,1),skill(1000,2),{type:'kill',details:{xp:'0'}},{type:'skill',message:'Slam',at:1001}]);assert.deepEqual(result.combatLogs.B,[]);
 // v1.5.0's saved lines carry no id, and its skill line repeated within 1 s folds on
 // load.
 const legacy=[{type:'skill',message:'Slam',at:0},{type:'skill',message:'Slam',at:500},{type:'skill',message:'Slam',at:1600}];
 assert.deepEqual(initialCoordinatorHistory({combatLogs:{F:legacy}},{}).combatLogs.F,[legacy[0],legacy[2]]);
});
