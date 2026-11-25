// Survival's regeneration wait (A9), the "HP potion below" write and the add-on's verdict read,
// which left the live W04 window (test-windows DESIGN.md 4.3, T45): SV5, SV13 and SV41. The live
// row planted each state mid-fight; here each is planted on the needs, the settings writer and the
// hook registry. W04 keeps SV1 and SV3's timing on a real fight and SV11's Town cast.
const assert = require('node:assert/strict');
const { scenarioTable } = require('./fixtures/scenarios.cjs');
const { needsWorld, installedSurvival } = require('./fixtures/survival-needs-scenario.cjs');
const { settingsWriter } = require('./helpers/settings-writer.cjs');
const { createNeeds } = require('../../runtime/characters/survival/needs.ts');
const { A9_LINE, linesOf } = require('../../runtime/characters/survival/lines.ts');
const { createRegistry } = require('../../runtime/hooks/registry.ts');
const { survivalRegistrations } = require('../../runtime/characters/survival/registrations.ts');

// Each fighter's own needs, as its client builds them, with the party in a fight while `fight`
// holds: the heartbeat lists both, and a fighter's live entity is its report.
function fighters() {
  const w = needsWorld('warrior', { hp: 100, max_hp: 100, mp: 50, max_mp: 100 }), state = { fight: true };
  const party = { Warrior: { ...globalThis.character }, Priest: { name: 'Priest', ctype: 'priest', map: 'main', in: 'main', hp: 100, max_hp: 100, mp: 50, max_mp: 100 } };
  const needsOf = {};
  for (const name of Object.keys(party)) needsOf[name] = createNeeds({ members: () => Object.values(party), sameTeam: () => true,
    escapeStage: () => null, townCasting: () => false, partyhealAllowed: () => true, isLeader: () => false, partyAttacker: () => null,
    fighting: () => state.fight, lines: () => ({ hp: 50, mp: 20 }), state: () => ({}) });
  globalThis.get_player = name => party[name] ?? null;
  // One turns pass of `name`'s client: its character is its own entity.
  const regeneration = name => { globalThis.character = party[name]; return needsOf[name].regeneration({ character: party[name], roleLoop: true, healFirstBelow: 80 }); };
  return { w, state, party, regeneration };
}

scenarioTable('SV5: regeneration waits in a fight once a fighter read below the A9 line, and goes on out of one', fighters, [
  ['in a fight, neither fighter regenerates after the warrior read below 80%, while the fight lasts', ({ party, regeneration }) => {
    assert.ok(regeneration('Warrior') && regeneration('Priest'), "SV5: the warrior's potion family is free before the plant");
    party.Warrior.hp = 70;
    assert.ok(party.Warrior.hp / party.Warrior.max_hp < A9_LINE, 'SV5: each fighter reads the warrior below 80%');
    for (const name of ['Warrior', 'Priest'])
      assert.equal(regeneration(name), undefined, `SV5: ${name}'s regeneration in a fight after a fighter read below 80%`);
    // The wait lasts the fight, so the warrior back above the line still waits.
    party.Warrior.hp = 100;
    assert.equal(regeneration('Priest'), undefined);
  }],
  ['out of a fight, the warrior at 70% regenerates on its next pass', ({ state, party, regeneration }) => {
    party.Warrior.hp = 70;
    assert.equal(regeneration('Warrior'), undefined);
    // The fight ends: the monster on a fighter, or the target a fighter holds, is gone.
    state.fight = false;
    assert.equal(regeneration('Warrior')?.skill, 'regen_hp', 'SV5: out of a fight the warrior at 70% regenerates within one regeneration cooldown');
  }],
]);

scenarioTable('SV13: "HP potion below" takes a write and reaches the character\'s lines', () => ({ state: { hpPotionBelow: {} } }), [
  ['a write of 30 and then 50 sets the warrior\'s HP line', ({ state }) => {
    const writer = settingsWriter(state);
    assert.equal(writer.write({ changes: [{ field: 'hpPotionBelow', character: 'W', value: 30 }] }).ok, true, 'SV13: "HP potion below" takes a write (step 2)');
    assert.equal(linesOf('warrior', { hp: state.hpPotionBelow.W }).hp, 30);
    assert.equal(writer.write({ changes: [{ field: 'hpPotionBelow', character: 'W', value: 50 }] }).ok, true);
    assert.equal(linesOf('warrior', { hp: state.hpPotionBelow.W }).hp, 50);
  }],
]);

// A page add-on with one registration and no core edit asks `survival.verdict({character})` on
// each turns pass; the farming warrior's own fight reads `fight`.
function verdictReader() {
  const w = needsWorld('warrior'), survival = installedSurvival({ members: w.members, state: {} }, { phase: null }, globalThis);
  const registry = createRegistry(), seen = [];
  for (const registration of survivalRegistrations) assert.deepEqual(registry.register(registration), { ok: true });
  const reader = { name: 'reader', rank: 'task', answer(view) { seen.push(registry.survival.verdict({ character: view.character.name })); return undefined; } };
  const registered = registry.register({ name: 'survival-reader-fixture', folder: 'addons', author: 'e2e', summary: 'Reads the survival verdict.', hooks: { 'skills.request': [reader] } });
  return { w, survival, registered, reader, seen };
}
scenarioTable('SV41: an add-on reads the survival verdict of the farming warrior', verdictReader, [
  ['the add-on\'s turns pass reads fight', ({ w, survival, registered, reader, seen }) => {
    try {
      assert.deepEqual(registered, { ok: true });
      reader.answer({ character: w.g.character });
      assert.ok(seen.length > 0, 'SV41: the add-on reads the verdict');
      assert.deepEqual([...new Set(seen)], ['fight'], "SV41: the add-on's verdict answers on the farming warrior");
    } finally { survival.stopAll(); }
  }],
]);
