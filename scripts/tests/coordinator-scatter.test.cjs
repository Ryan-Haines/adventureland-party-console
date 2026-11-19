const test = require('node:test');
const assert = require('node:assert/strict');
const {observeScatter, consumeOneShotReports} = require('../../runtime/hunting/coordinator/modes.ts');
// observeScatter reads the first member's live task and group from the tasks owner; these rows run with none.
require('../../runtime/tasks/api.ts').publishTasks({assignment:()=>null,groupOf:()=>null});
const state = () => ({scatterPartySignature:'P|W',scatterMonsterTypes:['goo'],scatterEpoch:2,
 scatterBreakTarget:null,partyFarmingMode:'scatter',partyFarmingMonsterType:'goo',combatMode:'auto'});

test('first learned kill supplies farming authority before a character has a target', () => {
 const s=state(), body={oneShotMonsterTypes:['rat'],oneShotEpoch:2};
 const learned=consumeOneShotReports(body,{types:s.scatterMonsterTypes,epoch:s.scatterEpoch});
 observeScatter(s,['P','W'],{},undefined,learned,100);
 assert.equal(s.partyFarmingMonsterType,'rat');assert.equal(s.partyFarmingMode,'scatter');
});

test('off-type threat suspends automatic scatter and remains until absent for three seconds', () => {
 const s=state(), authority={name:'P',farmingMonsterType:'goo'};
 observeScatter(s,['P','W'],{P:authority,W:{name:'W',threats:[{id:'r',mtype:'rat'}]}},authority,[],100);
 assert.equal(s.partyFarmingMode,'default');assert.equal(s.partyFarmingMonsterType,'rat');
 observeScatter(s,['P','W'],{P:authority},authority,[],3100);assert.ok(s.scatterBreakTarget);
 observeScatter(s,['P','W'],{P:authority},authority,[],3101);assert.equal(s.scatterBreakTarget,null);
 assert.equal(s.partyFarmingMode,'scatter');
});

test('membership change resets learning; explicit policy still overrides automatic mode', () => {
 const s=state();observeScatter(s,['P'],{},undefined,[],100);
 assert.deepEqual(s.scatterMonsterTypes,[]);assert.equal(s.scatterEpoch,3);assert.equal(s.partyFarmingMode,'default');
 s.combatMode='scatter';observeScatter(s,['P'],{},undefined,[],101);assert.equal(s.partyFarmingMode,'scatter');
});

// HN12: each row answers through rules.ts `combatModeAnswer`, the one copy that observeScatter
// and the reply's farmingReply both ask.
test('HN12 the combat mode answer follows H5 row by row, first match wins', () => {
 const {combatModeAnswer}=require('../../runtime/hunting/rules.ts');
 const facts=over=>({task:null,combatMode:'auto',scatterBreak:false,type:'goo',learned:['goo'],...over});
 assert.equal(combatModeAnswer(facts({task:'cave',combatMode:'scatter'})),'default');
 assert.equal(combatModeAnswer(facts({task:'rare',combatMode:'scatter'})),'default');
 assert.equal(combatModeAnswer(facts({task:'death-recovery',combatMode:'scatter'})),'default');
 assert.equal(combatModeAnswer(facts({combatMode:'default'})),'default');
 assert.equal(combatModeAnswer(facts({combatMode:'scatter',learned:[]})),'scatter');
 assert.equal(combatModeAnswer(facts({})),'scatter');
 assert.equal(combatModeAnswer(facts({scatterBreak:true})),'default');
 assert.equal(combatModeAnswer(facts({learned:[]})),'default');
});

// HN13: a farming profile saved with learned types loads them for the same roster and clears them
// on the first report from another roster.
test('HN13 learned scatter types survive a save and load for the same roster only', () => {
 const {observeScatter}=require('../../runtime/hunting/coordinator/api.ts');
 const {createFarmingScopes}=require('../../runtime/tasks/coordinator/groups.ts');
 const lists=require('../../runtime/settings/coordinator/table.ts').coordinatorSettings().lists;
 const load=()=>{
  const saved=JSON.parse(JSON.stringify({P:{scatterMonsterTypes:['goo'],scatterPartySignature:'P|W',scatterEpoch:2}}));
  const root={leader:'P',followers:{W:true},merchantCharacter:null,farmingProfiles:saved};
  createFarmingScopes(root,lists,()=>100);
  return root.farmingProfiles.P;
 };
 const same=load();
 assert.deepEqual(same.scatterMonsterTypes,['goo']);
 observeScatter(same,['P','W'],{},{name:'P',farmingMonsterType:'goo'},[],100);
 assert.deepEqual(same.scatterMonsterTypes,['goo']);assert.equal(same.partyFarmingMode,'scatter');
 const other=load();
 observeScatter(other,['P','X'],{},{name:'P',farmingMonsterType:'goo'},[],100);
 assert.deepEqual(other.scatterMonsterTypes,[]);assert.equal(other.partyFarmingMode,'default');
});
