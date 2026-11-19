const test = require('node:test');
const assert = require('node:assert/strict');
const { compoundPassCost } = require('../../dashboard/lib/compound-cost.ts');
const prices = [6400,240000,9200000,1840000000].map((cost,i)=>({id:'cscroll'+i,cost}));
test('one +2 item needs four successful combines, including its three +1 ingredients',()=>{
  assert.deepEqual(compoundPassCost([3,5,6,7],2,prices),{gold:25600,scrolls:4});
});
test('scroll grade changes at the source level threshold',()=>{
  assert.deepEqual(compoundPassCost([3,5,6,7],4,prices),{gold:39*6400+240000,scrolls:40});
  assert.deepEqual(compoundPassCost([4,5,6,7],4,prices),{gold:40*6400,scrolls:40});
});
test('high-grade items start at the correct scroll and missing prices are not zero',()=>{
  assert.deepEqual(compoundPassCost([0,0,6,7],1,prices),{gold:9200000,scrolls:1});
  assert.equal(compoundPassCost([0,0,6,7],1,prices.slice(0,2)),null);
});

// A booster's thresholds are out of order ([0, 10, 6, 7]); the game's calculate_item_grade takes
// the highest one reached, so the pass from +6 uses cscroll3, where a count of reached thresholds
// priced cscroll2.
test('a booster built to +7 prices its last pass with cscroll3',()=>{
  // Passes from +0 to +5 are grade 1 (3^6 + ... + 3^1 copies); the pass from +6 is grade 3.
  const grade1=3**6+3**5+3**4+3**3+3**2+3;
  assert.deepEqual(compoundPassCost([0,10,6,7],7,prices),{gold:grade1*prices[1].cost+prices[3].cost,scrolls:grade1+1});
});

// The upgrade and stat scroll costs read one catalog price table (catalogPrice), the items'
// game value, so scroll3, which no NPC sells, is priced.
const { catalogPrice, upgradeScrollCost, upgradeScrollGrades, statScrollCost, statScrollCount, upgradeScrollPrices } = require('../../dashboard/lib/game-formulas.ts');
const { statScrollsNeeded } = require('../../runtime/items/api.ts');
const { STAT_SCROLLS_BY_GRADE } = require('../../runtime/items/rules.ts');
const priced = (id,g) => ({id,meta:{definition:{g}}});
const scrollPrices = catalogPrice([[0,1234],[1,45678],[2,1650321],[3,64000123]].map(([grade,g])=>priced('scroll'+grade,g)).concat(priced("strscroll",5250)));
test('scroll costs read the catalog price table and a missing price is not zero',()=>{
  const definition={grades:[5,7,9,11]};
  assert.equal(upgradeScrollCost(definition,0,2,scrollPrices),2468);
  assert.equal(upgradeScrollCost(definition,0,2,catalogPrice([])),null);
  assert.equal(statScrollCost(definition,3,'strscroll',scrollPrices),5250*statScrollsNeeded(definition,3));
  assert.equal(statScrollCost(definition,3,'dexscroll',scrollPrices),null);
  assert.deepEqual(upgradeScrollPrices(scrollPrices),[1234,45678,1650321,64000123]);
  assert.equal(upgradeScrollCost({grades:[0,0,0,11]},0,1,scrollPrices),64000123,'a scroll3 tier reads its game value');
  // The catalog's definition carries no `upgrade` object (safeItemDefinition); the visual run's
  // menu priced every tier at scroll0 that way.
  assert.equal(upgradeScrollCost({grades:[0,4,10,12]},0,5,scrollPrices),4*45678+1650321,'the grade follows the grades with no upgrade object');
  assert.equal(upgradeScrollCost(definition,0,1,catalogPrice([{id:'scroll0',meta:null}])),null,'an item with no definition has no price');
  assert.equal(upgradeScrollPrices(catalogPrice([priced("scroll0",1234)])),null);
  // The stat scroll menu reads the same grades; a grade 0 read asked 1 scroll for a +10 item.
  assert.equal(statScrollCount({grades:[0,4,10,12]},10),STAT_SCROLLS_BY_GRADE[3],'the stat scroll count follows the grades with no upgrade object');
  assert.equal(statScrollCost({grades:[0,4,10,12]},10,'strscroll',scrollPrices),5250*STAT_SCROLLS_BY_GRADE[3]);
  // The upgrade menu marks a tier's cost as the NPC price when its run uses a scroll no NPC sells.
  assert.deepEqual(upgradeScrollGrades({grades:[0,4,10,12]},9,3),[2,3,3],'the run names the grade of each level');
});
// v1.5.0's requiredScrolls (stat-scroll-commands.ts:66-72) stopped at grade 3
// and asked 1,000 stat scrolls for a +12, where the game asks 9,999 at grade 4 (G
// node/server.js:7465-7468) and refuses the run with `upgrade_scroll_q`.
test('B151: a grade 4 item needs 9,999 stat scrolls',()=>{
  const definition={upgrade:{},grades:[9,10,11,12]};
  assert.equal(statScrollsNeeded(definition,11),1000,'grade 3');
  assert.equal(statScrollsNeeded(definition,12),9999,'grade 4');
});
