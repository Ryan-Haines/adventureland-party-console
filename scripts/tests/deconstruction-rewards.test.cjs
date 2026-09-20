const test = require('node:test');
const assert = require('node:assert/strict');
const {buildDeconstructionCatalog} = require('../../runtime/coordinator/merchant/deconstruction.ts');
const {deconstructionRewards} = require('../../dashboard/features/party/deconstruction.ts');

test('dismantle rewards distinguish quantities from probabilities and retain independent bonus rolls', () => {
  const catalog = buildDeconstructionCatalog({dismantle: {
    lostearring: {cost: 36000, items: [[0.12, 'goldnugget']]},
    goldenegg: {cost: 120000, items: [[1, 'goldnugget'], [0.5, 'goldnugget']]},
    bronzeingot: {cost: 120000, items: [[16, 'bronzenugget']]},
  }});
  assert.deepEqual(deconstructionRewards({name:'lostearring'}, catalog), [{name:'goldnugget',quantity:1,chance:0.12,level:0}]);
  assert.deepEqual(deconstructionRewards({name:'goldenegg'}, catalog).map(r=>[r.quantity,r.chance]), [[1,1],[1,0.5]]);
  assert.deepEqual(deconstructionRewards({name:'bronzeingot'}, catalog).map(r=>[r.quantity,r.chance]), [[16,1]]);
});
test('compound dismantling previews three guaranteed copies at the previous level', () => {
  const catalog = buildDeconstructionCatalog({items:{ring:{compound:{}}}});
  assert.deepEqual(deconstructionRewards({name:'ring',level:4,stat_type:'int'},catalog),
    [{name:'ring',level:3,quantity:3,chance:1}]);
  assert.equal(deconstructionRewards({name:'unknown'},catalog),null);
});
