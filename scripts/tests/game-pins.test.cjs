// The game stack's one pin: the run manifest records the revisions the stack builds, which
// compose.yml takes from tools/sim/pins.json. A second copy of the pin drifted before
// (bootstrap.cjs recorded 90052162 while pins.json pinned).
const test=require('node:test'),assert=require('node:assert/strict');
const {revisions}=require('../../e2e/game/bootstrap.cjs');
const pins=require('../../tools/sim/pins.json');
test('the run manifest records the revisions pins.json names',()=>{
  assert.deepEqual(revisions,{game:pins.game,common:pins.common,config:pins.config});
});
