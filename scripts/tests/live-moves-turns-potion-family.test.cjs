// TC9's first half, which left the live W06 window (test-windows DESIGN.md 4.3, T44): the live
// row read the client's game data and the executor's family table, neither of which needs a
// fight. W06 and the goo walk-in window keep the potions sent in play.
const assert = require('node:assert/strict'), vm = require('node:vm');
const { scenarioTable } = require('./fixtures/scenarios.cjs');
const { downloadedGameSource } = require('./helpers/downloaded-game.cjs');
const { familyOf } = require('../../runtime/characters/turns/api.ts');

const POTION_SKILLS = ['use_hp', 'use_mp', 'regen_hp', 'regen_mp'];
// The newest pinned game's data, as the client loads it.
function skills() { const game = {}; vm.runInNewContext(downloadedGameSource('data.js'), game); return game.G.skills; }

scenarioTable('the four potion skills are one cooldown family', skills, [
  ['game data puts them in one group, and the executor\'s family table names them one family', G => {
    assert.deepEqual(POTION_SKILLS.map(s => G[s].cooldown_group ?? G[s].share ?? s), POTION_SKILLS.map(() => 'potion'), 'TC9: game data puts the four potion skills in one group');
    assert.deepEqual(POTION_SKILLS.map(s => familyOf(G, s)), POTION_SKILLS.map(() => 'potion'), "TC9: the executor's family table names the four potion skills one family");
  }],
]);
