// Survival's needs on a planted character: the potion table for every class, the heal choice and
// the emergency Stomp, and two reads of characters/shared.js. Isolated, each table for its own
// reason (13, "Each separate test"): no live fixture carries a rogue or a paladin; the heal
// choice's rows plant members out of range, dead, on another map, of another event team or a
// merchant, and heal numbers the fixture's priest does not have (its heal is 21189); the Stomp's
// rows plant party reports, weapon swaps and missing weapon data the default table does not.
// Failure modes: a class drinks no HP below its HP line (bug 3b, 2026-11-01); a class drinks
// MP first below its HP line (2026-11-02); a class drinks no MP below its MP line; the escape's
// MP budget or the warrior leader's Taunt MP comes before the HP line (bug 3 part); the merchant's
// lines and its missing-HP row change; a class gets another answer than the others for the same
// vitals; a heal counts before its reply, or goes to a member out of range, dead, on another map, of
// another event team, or a merchant by its report or its live entity; partyheal restores less than
// one heal above the urgent line, or does not go for two members below it; the emergency Stomp stops
// or goes outside its gates; the farm fact misses an unseen member.
const assert = require('node:assert/strict');
const { scenarioTable } = require('./fixtures/scenarios.cjs');
const { potionTable, needsWorld, installedSurvival } = require('./fixtures/survival-needs-scenario.cjs');

const CLASSES = ['warrior', 'priest', 'mage', 'paladin', 'ranger', 'rogue'];

scenarioTable('one potion table answers every class from the character\'s own lines', potionTable, [
 ['every fighter class answers the same rows for the same vitals', ({ choice }) => {
  const rows = [
    ['HP below its line', { hp: 2000 }, 'use_hp'],
    ['MP below its line', { mp: 300 }, 'use_mp'],
    ['both below: HP first', { hp: 2000, mp: 300 }, 'use_hp'],
    ['both above', { hp: 3000, mp: 1000 }, null],
  ];
  for (const ctype of CLASSES) for (const [name, vitals, expected] of rows)
    assert.equal(choice(ctype, vitals), expected, `${ctype}: ${name}`);
 }],
 ['the lines are the character\'s own settings', ({ choice }) => {
  assert.equal(choice('ranger', { hp: 2000 }, { lines: { hp: 30, mp: 20 } }), null, 'HP at 40% above a 30% line');
  assert.equal(choice('ranger', { mp: 500 }, { lines: { hp: 50, mp: 30 } }), 'use_mp', 'MP at 25% below a 30% line');
 }],
 ['the escape\'s MP budget and the leader\'s Taunt MP come after the HP line', ({ choice }) => {
  for (const ctype of CLASSES) {
    assert.equal(choice(ctype, { hp: 2000, mp: 500 }, { escape: { budget: 1500 } }), 'use_hp', `${ctype}: escaping below the HP line`);
    assert.equal(choice(ctype, { hp: 3000, mp: 500 }, { escape: { budget: 1500 } }), 'use_mp', `${ctype}: escaping under the MP budget`);
  }
  assert.equal(choice('warrior', { hp: 2000, mp: 30 }, { tauntCost: 40 }), 'use_hp', 'the leader below the HP line');
  assert.equal(choice('warrior', { hp: 3000, mp: 30 }, { tauntCost: 40 }), 'use_mp', 'the leader under the Taunt cost');
  // Row 5: escaping, HP below max, not a mage (shared.js:106's entry).
  assert.equal(choice('warrior', { hp: 4000 }, { escape: { budget: 0 } }), 'use_hp', 'escaping warrior tops HP');
  assert.equal(choice('mage', { hp: 4000 }, { escape: { budget: 0 } }), null, 'escaping mage keeps its potion for MP');
 }],
 ['the merchant keeps 20 and 20 and its missing-HP row', ({ choice }) => {
  assert.equal(choice('merchant', { hp: 900 }), 'use_hp', 'below 20%');
  assert.equal(choice('merchant', { mp: 300 }), 'use_mp', 'MP below 20%');
  assert.equal(choice('merchant', { hp: 4500 }), 'use_hp', 'missing more than its potion gives');
  assert.equal(choice('merchant', { hp: 4700 }), null, 'missing less than its potion gives');
 }],
 // ("HP comes before mana"): rule 2, an MP row drinks HP while HP reads the lower share; rule 3,
 // a healer below its HP line with MP under its own heal's cost drinks MP first when one heal
 // restores more than its HP potion. The escape's rows stay as before.
 ['rule 2: an MP row drinks HP while HP reads the lower share', ({ choice }) => {
  const lines = { hp: 20, mp: 90 };
  for (const ctype of CLASSES) {
    assert.equal(choice(ctype, { hp: 1500, mp: 1700 }, { lines }), 'use_hp', `${ctype}: 30% HP, 85% MP, MP line 90`);
    assert.equal(choice(ctype, { hp: 4500, mp: 1700 }, { lines }), 'use_mp', `${ctype}: 90% HP, 85% MP, MP line 90`);
  }
  assert.equal(choice('warrior', { hp: 1500, mp: 30 }, { tauntCost: 40, lines: { hp: 20, mp: 20 } }), 'use_mp', 'the leader at 30% HP and 1.5% MP: MP is the lower share');
  assert.equal(choice('warrior', { hp: 1500, mp: 1800 }, { tauntCost: 1900, lines: { hp: 20, mp: 20 } }), 'use_hp', 'the leader at 30% HP and 90% MP under the Taunt cost');
 }],
 ['rule 3: a healer without MP for its heal drinks MP first when one heal beats its potion', ({ choice }) => {
  const low = { hp: 2000, mp: 30 };
  assert.equal(choice('priest', low, { heal: { cost: 40, amount: 2000 } }), 'use_mp', 'the priest with a 2000 HP heal and a 400 HP potion');
  assert.equal(choice('priest', low, { heal: { cost: 40, amount: 300 } }), 'use_hp', 'a heal smaller than the potion');
  assert.equal(choice('priest', { hp: 2000, mp: 500 }, { heal: { cost: 40, amount: 2000 } }), 'use_hp', 'MP enough for the heal');
  assert.equal(choice('ranger', low, { heal: null }), 'use_hp', 'a class whose heal is not its own');
 }],
]);

const targets = asks => asks.map(a => [a.skill, a.targets.map(t => t.name).join()]);
const skills = w => w.heals().map(a => a.skill);
// The Stomp's world: the warrior with one ally and a monster on it (shared.js
// `emergencyWarriorStomp`'s gates, now needs.ts `stomp` with the other owners' holds through its
// `stompHeld` port). The turns executor checks the Stomp's MP, cooldown and unlock and asks the
// call budget, so those rows are the executor's (the turns owner's TC rows).
const stompWorld = w => {
  w.g.parent.entities.m = { type: 'monster', visible: true, target: 'Ally', x: 20, y: 0 };
  w.add('Ally', 59, { in: 'main', seenAt: Date.now() });
  return w;
};

scenarioTable('the heal choice and the emergency Stomp on a planted party', needsWorld, [
 // The heal choice: the failure modes v1.5.0's `healPartyBelow` (shared.js) held, on the
 // one heal choice; an overlapping heal is the executor's flight.
 ['only an acknowledged heal publishes success telemetry', t => {
  t.add('Warrior', 70);
  Object.assign(t.state, { error: 'too_far', errorAt: 1 });
  const [ask] = t.heals();
  assert.deepEqual(targets([ask]), [['heal', 'Warrior']]);
  assert.equal(t.state.lastHealAt, undefined, 'nothing is published before the reply');
  ask.book.accepted();
  assert.equal(t.state.lastHealTarget, 'Warrior');
  assert.ok(t.state.lastHealAt > 0);
  assert.equal(t.state.error, null);
  delete t.state.lastHealAt;
  t.heals()[0].book.rejected({ reason: 'too_far' });
  assert.equal(t.state.lastHealAt, undefined);
  assert.equal(t.state.error, 'too_far');
  assert.ok(t.state.errorAt > 0);
 }, 'priest'],
 ['skip unreachable, dead, other-map and opposing-team members', t => {
  // Without the MP for partyheal, which reaches the whole party, the single heal decides.
  t.add('Far', 10, { unreachable: true }); t.add('Dead', 1, { rip: true });
  t.add('OtherMap', 5, { map: 'cave' }); t.add('Enemy', 5, { friendly: false }); t.add('Near', 70);
  assert.deepEqual(targets(t.heals()), [['heal', 'Near']]);
 }, 'priest', { mp: 300 }],
 ['merchant cannot take healing or trigger partyheal with one injured fighter', t => {
  t.add('Merchant', 1, { ctype: 'merchant' }); t.add('Warrior', 40);
  assert.deepEqual(targets(t.heals()), [['heal', 'Warrior']]);
 }, 'priest'],
 ['live merchant identity is rejected even when the report carries no class', t => {
  t.add('Merchant', 1, { ctype: undefined, entity: { ctype: 'merchant' } });
  assert.deepEqual(targets(t.heals()), []);
 }, 'priest'],
 // The partyheal line: partyheal goes when two members each miss at least its output, and
 // the HP it restores across the members (each one's missing HP, up to its output) is at least one
 // heal's output (`character.heal`), so its MP never buys less healing than a heal gives.: the
 // priest's Curse waits on `isPartyHealthy`, which reads each member's HP from the client's entity
 // first. The earlier row's plant lowers the heartbeat too, so this row holds the case it cannot:
 // hurt on the client, full in the heartbeat.
 ['a member hurt on the client and full in its report reads the party unhealthy', t => {
  const member = t.add('Warrior', 100, { entity: { hp: 70 } });
  assert.equal(t.needs.partyHealthy(), false, 'the client sees the warrior at 70%');
  t.g.get_player(member.name).hp = 100;
  assert.equal(t.needs.partyHealthy(), true, 'the warrior healed on the client');
 }],
 ['partyheal restores at least one heal', t => {
  const warrior = t.add('Warrior', 4100, { max_hp: 5000 }); t.add('Mage', 4100, { ctype: 'mage', max_hp: 5000 });
  t.add('Priest', 5000, { ctype: 'priest', max_hp: 5000 });
  // Two members each miss 900, 800 each restored: 1600 under a 2000 heal.
  assert.ok(!skills(t).includes('partyheal'), 'partyheal restoring 1600 against a 2000 heal');
  warrior.hp = 3500;
  // 800 and 800 restored, still 1600: the line is the restored HP, not the missing HP.
  assert.ok(!skills(t).includes('partyheal'), 'a larger loss restores no more than the output');
  t.g.character.hp = 4000;
  // The priest misses 1000 too: 2400 restored.
  assert.ok(skills(t).includes('partyheal'), 'partyheal restoring 2400 against a 2000 heal');
 }, 'priest', { hp: 5000, max_hp: 5000, mp: 5000, max_mp: 5000, heal: 2000 }],
 // Partyheal also goes, whatever the heal, when two members are below "Heal first below", since
 // one heal reaches only one of them. The priest's heal of 21189 (the default fixture's)
 // outgrows partyheal's 800 a member.
 ['partyheal goes when two members are below "Heal first below", whatever the heal', t => {
  t.add('Warrior', 3900, { max_hp: 5000 }); const mage = t.add('Mage', 4500, { ctype: 'mage', max_hp: 5000 });
  t.add('Priest', 5000, { ctype: 'priest', max_hp: 5000 });
  assert.deepEqual(skills(t), ['heal'], 'one member below the line gets the single heal');
  mage.hp = 3900;
  // Two members below 80%: partyheal, although it restores 1600 against a 21189 heal.
  assert.ok(skills(t).includes('partyheal'), 'two members below the line get partyheal');
 }, 'priest', { hp: 5000, max_hp: 5000, mp: 5000, max_mp: 5000, heal: 21189 }],
 // The emergency Stomp.
 ['low ally HP asks the Stomp on every pass and stops at 60%', t => {
  const w = stompWorld(t);
  assert.equal(w.stomp(), true);
  assert.equal(w.stomp(), true);
  w.members[0].hp = 60;
  assert.equal(w.stomp(), false);
 }, 'warrior'],
 ['self kiting, ally kiting, and two own attackers each trigger independently', t => {
  const w = stompWorld(t), entities = w.g.parent.entities;
  w.members[0].hp = 100;
  w.world.kiting = true;
  assert.equal(w.stomp(), true);
  w.world.kiting = false;
  w.members[0].kiting = true;
  assert.equal(w.stomp(), true);
  w.members[0].kiting = false;
  entities.m.target = 'Warrior';
  entities.n = { ...entities.m };
  assert.equal(w.stomp(), true);
  delete entities.n;
  assert.equal(w.stomp(), false);
 }, 'warrior'],
 ['another owner\'s hold, a stale, distant or dead member and an empty range ask no Stomp', () => {
  for (const change of [w => w.world.franky = true,
    w => w.members[0].seenAt = 1, w => w.members[0].in = 'other',
    w => w.members[0].rip = true, w => w.members[0].name = 'Outsider',
    w => w.g.parent.entities.m.x = 1000]) {
    const w = stompWorld(needsWorld('warrior')); change(w);
    assert.equal(w.stomp(), false);
  }
 }],
 ['incompatible or missing weapon data asks no Stomp', () => {
  for (const change of [
    g => g.character.slots.mainhand = { name: 'fireblade' },
    g => g.character.slots.mainhand = null,
    g => delete g.character.slots,
    g => g.character.slots.mainhand = { name: 'unknown' },
    g => delete g.G.items.basher.wtype,
  ]) {
    const w = stompWorld(needsWorld('warrior')); change(w.g);
    assert.equal(w.stomp(), false);
  }
 }],
 ['the Stomp rechecks the equipped weapon after every swap', t => {
  const w = stompWorld(t);
  w.g.character.slots.mainhand = { name: 'fireblade' };
  assert.equal(w.stomp(), false);
  w.g.character.slots.mainhand = { name: 'basher' };
  assert.equal(w.stomp(), true);
  w.g.character.slots.mainhand = { name: 'fireblade' };
  assert.equal(w.stomp(), false);
 }, 'warrior'],
 ['the Stomp asks at `survival` only on a role loop pass, where today\'s tick asked it', t => {
  const w = stompWorld(t), character = w.g.character;
  assert.equal(w.needs.stomp({ character, roleLoop: false, pulse: false, healFirstBelow: 80 }), undefined);
  assert.equal(w.needs.stomp({ character, roleLoop: true, pulse: false, healFirstBelow: 80 }).rank, 'survival');
 }, 'warrior'],
 // 3.10: the character's survival ring, 64 entries in the shared ring shape (`part: 'survival'`): a
 // need the executor refused, a verdict change, a respawn `not-now` or refusal, an escape stage
 // change. A need that goes at once writes none.
 ["the character's survival ring records refusals, verdict changes, respawn answers and escape stages (3.10)", async t => {
  const world = { phase: null, stage: null, band: 'send', refuse: true };
  t.g.respawn = () => Promise.resolve();
  const survival = installedSurvival(t, world);
  try {
   const ring = () => survival.records().map(e => [e.part, e.decision]);
   assert.deepEqual(ring(), [], 'a fresh install has written nothing');
   world.refuse = false; await survival.escape.use('use_hp');
   assert.deepEqual(ring(), [], 'a need that goes at once writes none');
   world.refuse = true; await survival.escape.use('use_hp').catch(() => undefined);
   // A request the server rejects reaches the need through its booking.
   t.g.character.hp = 10; survival.needs.potion(t.view).book.rejected({ reason: 'no_item' }); t.g.character.hp = 100;
   survival.needs.characterVerdict(); world.phase = 'finishing'; survival.needs.characterVerdict();
   // The console Pause reaches the respawn as the band's held row (death.ts `answer`), so the death
   // first waits on the band, then sends, then waits on its respawn in flight.
   t.g.character.rip = true; world.band = 'not-now'; survival.death.answer({ by: 'test' });
   world.band = 'send'; survival.death.answer({ by: 'test' }); survival.death.answer({ by: 'test' });
   // A respawn that came some other way (the Cave's rescue) ends this death: the next death's first
   // answer writes again, whatever the last death's was.
   t.g.character.rip = false; survival.death.answer({ by: 'test' }); t.g.character.rip = true; survival.death.answer({ by: 'test' });
   await survival.half.escape.apply({ id: 'op', stage: 'blink' });
   assert.deepEqual(ring(), [['survival', 'refused'], ['survival', 'refused'], ['survival', 'verdict'], ['survival', 'respawn'], ['survival', 'respawn'], ['survival', 'respawn'], ['survival', 'escape']]);
   const entries = survival.records();
   assert.deepEqual([entries[0].skill, entries[0].reason, entries[1].skill, entries[1].reason, entries[2].verdict, entries[3].answer, entries[4].answer, entries[5].answer, entries[6].stage],
    ['use_hp', 'no_mp', 'use_hp', 'no_item', 'finish', 'not-now', 'not-now', 'not-now', 'blink']);
   assert.ok(entries.every(e => Number.isInteger(e.seq) && Number.isFinite(e.at)), 'each entry is numbered and dated');
  } finally { survival.stopAll(); }
 }],
 // With no `defeated_by_a_monster` response the death message names the last monster that hit the
 // character in this life, read from the attacker's entity on the client, since the hit packet
 // carries no monster type. No live row gives the warrior a named hit before its planted
 // death, so this row holds the named case.
 ['the death names the monster whose hit the client saw last', async t => {
  const handlers = {}, me = t.g.character.name;
  t.g.G.monsters = { fairy: { name: 'Fairy' }, goo: { name: 'Goo' } };
  const entities = { m1: { type: 'monster', mtype: 'goo' }, m2: { type: 'monster', mtype: 'fairy' } };
  t.g.get_entity = id => entities[id] || null;
  const world = { phase: null, stage: null, band: 'send', refuse: false,
   shared: { socket: () => ({ on: (event, listener) => { handlers[event] = listener; } }), ownActor: id => id === me } };
  const survival = installedSurvival(t, world);
  try {
   handlers.hit({ id: me, hid: 'm1', damage: 40 });
   handlers.hit({ id: me, hid: 'm2', damage: 900 });
   t.g.character.rip = true; handlers.death({ id: me });
   const deaths = survival.told.filter(([hook]) => hook === 'survival.died').map(([, p]) => p);
   assert.deepEqual(deaths.map(d => [d.cause, d.details.monster]), [['Killed by Fairy', 'fairy']]);
  } finally { survival.stopAll(); }
 }],
 // 3.5, the server's respawn wait (13.7's state table, 13.8): a `cant_respawn` reply sets the
 // wait for that death. The Cave's Nera rescue revives the character inside it, and the next
 // death's first respawn goes, since the server sets that death's own wait.
 ["a Cave rescue inside the server's respawn wait leaves no wait ahead of the next death (3.5)", async t => {
  const world = { phase: null, stage: null, band: 'send', refuse: false };
  t.g.respawn = () => Promise.reject({ reason: 'cant_respawn', ms: 12000 });
  const survival = installedSurvival(t, world);
  try {
   t.g.character.rip = true; survival.death.seen(true);
   await survival.death.respawn('test').catch(() => undefined);
   assert.equal(survival.death.answer({ by: 'test' }).answer, 'not-now', "the server's wait holds this death's next ask");
   // Nera's `cave_fallen` rescue: the character lives, then dies again inside the old wait.
   t.g.character.rip = false; survival.death.seen(false);
   t.g.character.rip = true; survival.death.seen(true);
   assert.equal(survival.death.answer({ by: 'test' }).answer, 'sent', "the next death's first ask goes");
  } finally { survival.stopAll(); }
 }],
 // (13.5a item 4): the respawn goes on the first tick that reads `rip`, and the death packet can
 // land after the refusal of that respawn. Layer 7's run G read it twice in: the death recorded 1 ms
 // and 2 ms after the `cant_respawn`, and a second respawn went 2 ms and 502 ms later.
 ["a death recorded after its first respawn's refusal keeps the server's wait", async t => {
  const world = { phase: null, stage: null, band: 'send', refuse: false };
  t.g.respawn = () => Promise.reject({ reason: 'cant_respawn', ms: 12000 });
  const survival = installedSurvival(t, world);
  try {
   t.g.character.rip = true;
   await survival.death.respawn('test').catch(() => undefined);
   survival.death.seen(true);
   assert.equal(survival.death.answer({ by: 'test' }).answer, 'not-now', "the server's wait holds the ask after the late death record");
  } finally { survival.stopAll(); }
 }],
]);

scenarioTable('survival\'s farm fact, Stomp hold, Town gate, healthy answer, notices and picks', needsWorld, [
 // In a fight, the farm fact (needs.ts `atFarm`): the character, or a party member, stands where its
 // farm draws its targets. A member this client holds no entity for counts from its own report while
 // that report is fresh by the `walk` reading (two report gaps), the source the heal choice reads
 // for an unseen member. A support priest 513 from the spot lost sight of the warrior deeper in the
 // farm and regenerated with the warrior below 80% (13.4b item 3).
 ['the farm fact counts an unseen member from its fresh report', t => {
  const { atFarm } = require('../../runtime/characters/survival/needs.ts');
  const spot = { map: 'main', x: 0, y: 0 }, now = Date.now(), entities = {};
  const near = e => (!e.map || e.map === spot.map) && Math.hypot(e.x - spot.x, e.y - spot.y) <= 400;
  t.g.character = { name: 'Priest', map: 'main', x: 513, y: 0 }; t.g.get_player = name => entities[name] || null;
  const reports = [{ name: 'Warrior', map: 'main', x: 50, y: 0, seenAt: now - 500 }];
  const farm = () => atFarm({ scope: () => spot, roster: () => ['Priest', 'Warrior'], reports: () => reports, clockOffset: () => 0, reportGap: () => 1000,
    inFarmArea: near, inFarmRadius: near });
  assert.equal(farm(), true, 'an unseen warrior whose fresh report stands at the farm');
  reports[0].seenAt = now - 2500;
  assert.equal(farm(), false, 'a report older than two report gaps');
  reports[0].seenAt = now - 500; reports[0].x = 900;
  assert.equal(farm(), false, 'a fresh report away from the farm');
  reports[0].x = 50; reports[0].rip = true;
  assert.equal(farm(), false, 'a dead member');
  reports[0].rip = false; entities.Warrior = { name: 'Warrior', map: 'main', x: 900, y: 0 };
  assert.equal(farm(), false, 'a member the client sees reads its own entity');
 }],
 // The Stomp's hold (needs.ts `stompHeld`): in a grouped fight it holds while a neutral monster stands
 // in Stomp's range, and a neutral monster is one in range that is not the group's lock target and
 // targets no party member. With two monsters on the warrior the lock names one, and the second is no
 // neutral.
 ['the grouped hold counts as neutral only a monster that targets no party member', t => {
  const party = ['Warrior', 'Priest'], monster = (id, target, x = 20) => ({ id, type: 'monster', visible: true, dead: false, x, y: 0, target });
  t.world.reads = { 'targeting.unfinished': () => true, 'targeting.lockAllows': e => e.id === 'a', 'targeting.attacking': e => party.includes(e.target) };
  t.g.parent.entities = { a: monster('a', 'Warrior'), b: monster('b', 'Warrior') };
  assert.equal(t.needs.stompHeld(400), false, 'two monsters on the warrior: the second targets a member');
  t.g.parent.entities.c = monster('c', null);
  assert.equal(t.needs.stompHeld(400), true, 'an idle monster in range holds the Stomp');
  t.g.parent.entities.c.x = 1000;
  assert.equal(t.needs.stompHeld(400), false, 'an idle monster out of range holds nothing');
  t.world.mode = 'scatter';
  assert.equal(t.needs.stompHeld(400), true, 'scatter keeps its hold');
 }, 'warrior'],
 // A potion's `equip` and a heal end a Town channel (server.js:7657:3519), so the potion
 // need and the heal choice wait while a Town cast is in flight or channelled; the one gate
 // (`channelling`) is the escape's too (party-escape.test.cjs's row).
 ['the potion need and the heal choice wait inside a Town cast or channel', t => {
  t.add('Warrior', 40); t.g.character.hp = 20;
  t.world.townCasting = true;
  assert.equal(t.needs.potion(t.view), undefined, 'a Town cast in flight holds the potion');
  assert.deepEqual(t.heals(), [], 'and the heal');
  t.world.townCasting = false; t.g.character.c = { town: { ms: 3000 } };
  assert.equal(t.needs.channelling(), true);
  assert.equal(t.needs.potion(t.view), undefined, 'the channel holds the potion');
  delete t.g.character.c;
  assert.equal(t.needs.potion(t.view).skill, 'use_hp');
  assert.deepEqual(t.heals().map(a => a.skill), ['heal']);
 }, 'priest'],
 // `survival.healthy`: the turns owner's ranking asks it at the healthy share for a class that
 // heals, whose Curse waits while it fails.
 ['priest Curse waits while a member is below the share', async t => {
  const survival = installedSurvival(t, { phase: null, band: 'send', refuse: false }, globalThis);
  try {
   // The hook's own share is the one the code reads, so the row names no number for it.
   const healthy = () => survival.registration().hooks['survival.healthy']();
   const member = t.add('Warrior', 85);
   assert.equal(healthy(), false, 'a member at 85% holds the Curse');
   member.hp = 95; t.g.get_player(member.name).hp = 95;
   assert.equal(healthy(), true, 'every member at or above 90%');
  } finally { survival.stopAll(); }
 }, 'priest'],
 // `survival.mpPotion`: the turns owner's ranking counts an MP potion only where the potion
 // table drinks one, with one in the bag and the potion cooldown ready.
 ['the MP potion the ranking counts follows the potion table', t => {
  t.g.G.items.mpot1 = { gives: [['mp', 500]] };
  t.g.character.items = [{ name: 'mpot1' }];
  assert.equal(t.needs.mpPotion(t.g.character.max_mp), 0, 'at full MP the table drinks none');
  assert.equal(t.needs.mpPotion(0), 500, "with no MP the table drinks the bag's last MP potion");
  t.g.parent.next_skill = { use_hp: new Date(Date.now() + 1000) };
  assert.equal(t.needs.mpPotion(0), 0, 'the potion cooldown holds it');
  t.g.parent.next_skill = {}; t.g.character.items = [];
  assert.equal(t.needs.mpPotion(0), 0, 'none in the bag');
 }, 'priest'],
 // Each respawn answer and reply, and each change of the member's recovery stage,
 // sends its one notice.
 ['the respawn and the member recovery notice each change once', async t => {
  t.g.respawn = () => Promise.resolve();
  const survival = installedSurvival(t, { phase: null, band: 'send', refuse: false });
  try {
   t.g.character.rip = true;
   await survival.recoveryTick();
   t.g.character.rip = false;
   await survival.recoveryTick(); await survival.recoveryTick();
   assert.deepEqual(survival.told.filter(([h]) => h === 'survival.respawning').map(([, n]) => [n.by, n.outcome]), [['death-recovery', 'sent'], ['death-recovery', 'accepted']]);
   assert.deepEqual(survival.told.filter(([h]) => h === 'survival.memberRecovery').map(([, n]) => n.stage), ['respawning', 'respawn-waiting', 'respawned', 'recovery-waiting'],
    'one notice per stage change; the third tick waits in the same stage');
  } finally { survival.stopAll(); }
 }, 'priest'],
 // The escape's two picks and the survival lines live in lines.ts, so no saved value can stand for
 // them. The Stomp and healthy-share rows above read the lines through the code.
 ['the escape picks leave the saved settings table', () => {
  const { survivalSavedFields } = require('../../runtime/characters/survival/saved-fields.ts');
  assert.deepEqual(Object.keys(survivalSavedFields.settings), ['hpPotionBelow', 'mpPotionBelow']);
 }],
]);
