const test = require('node:test');
const assert = require('node:assert/strict');
const {observeScatter} = require('../../runtime/coordinator/status/scatter.ts');
const {consumeOneShotReports} = require('../../runtime/coordinator/status/catalogs.ts');
const state = () => ({scatterPartySignature:'P|W',scatterMonsterTypes:['goo'],scatterEpoch:2,
 scatterBreakTarget:null,partyFarmingMode:'scatter',partyFarmingMonsterType:'goo',farmingPolicy:'automatic'});

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
 s.farmingPolicy='scatter';observeScatter(s,['P'],{},undefined,[],101);assert.equal(s.partyFarmingMode,'scatter');
});
