const { scenarioTable } = require('./fixtures/scenarios.cjs');
const assert = require('node:assert/strict');
const { monsterAttackBlock: block, effectiveAttackDamageType } = require('../../runtime/characters/targeting/gates.ts');
const { reflectLists, reflectChoices } = require('../../runtime/characters/targeting/reflect.ts');
const { targetingSavedFields } = require('../../runtime/characters/targeting/saved-fields.ts');
const { setGameMonsters } = require('../../runtime/movement/coordinator/planner-service.ts');
// The reflect lists read the coordinator's game data through movement's published read
// `movement.gameMonsters`, which core:movement
// answers on the coordinator.
const { partyHooks } = require('../../runtime/hooks/index.ts');
const { createRegistry } = require('../../runtime/hooks/registry.ts');
partyHooks().register(require('../../runtime/movement/coordinator/runtime.ts').coordinatorMovementRegistration(() => undefined, { time: async () => 0, statuses: () => ({}) }, partyHooks().walks));

// Before implementation: actual native Slender RED proved the serialized
// physical warrior lacks damage_type. Resolve current equipment accurately,
// preserve native overrides, and keep unknown/reflected magic fail-closed.
const damageData = { items: { blade: {damage_type:'physical'}, staff: {damage_type:'magical'}, pure: {damage_type:'pure'} },
  classes: { warrior: {damage_type:'physical'}, priest: {damage_type:'magical'} } };
scenarioTable("the attack block reads the reflect lists and the attack's damage type (TG4, TG9, TG10, TG12, TG28)",()=>undefined,[
  ["missing native attack type resolves the currently equipped weapon before its class",()=>{
  assert.equal(effectiveAttackDamageType({ctype:'warrior',slots:{mainhand:{name:'blade'}}},damageData),'physical');
  assert.equal(effectiveAttackDamageType({ctype:'warrior',slots:{mainhand:{name:'staff'}}},damageData),'magical');
  assert.equal(effectiveAttackDamageType({ctype:'priest',slots:{mainhand:{name:'blade'}}},damageData),'physical');
  }],
  ["known native attack overrides remain authoritative over weapon and class defaults",()=>{
  for(const type of ['physical','magical','pure'])
    assert.equal(effectiveAttackDamageType({ctype:'warrior',damage_type:type,slots:{mainhand:{name:'staff'}}},damageData),type);
  }],
  ["class defaults handle unarmed clients while unresolved reflection remains blocked",()=>{
  assert.equal(effectiveAttackDamageType({ctype:'warrior',slots:{}},damageData),'physical');
  assert.equal(effectiveAttackDamageType({ctype:'priest',slots:{}},damageData),'magical');
  const unknown=effectiveAttackDamageType({ctype:'unknown',slots:{}},damageData);
  assert.equal(unknown,undefined);
  assert.ok(block('slenderman',unknown,200));
  assert.ok(block('slenderman',effectiveAttackDamageType({ctype:'warrior',slots:{mainhand:{name:'staff'}}},damageData),200));
  }],

  ["Porcupine physical attacks require a finite range stat of at least 75",()=>{
  for (const range of [0, 30, 74.99, NaN, Infinity]) assert.ok(block('porcupine', 'physical', range));
  for (const range of [75, 120, 300]) assert.equal(block('porcupine', 'physical', range), null);
  assert.equal(block('porcupine', 'magical', 30), null);
  assert.equal(block('porcupine', 'pure', 30), null);
  }],

  ["high reflection monsters block magic regardless of range, allowing physical and pure damage",()=>{
  for (const monster of ['slenderman', 'tiger', 'goblin']) {
    for (const range of [30, 75, 300]) {
      assert.ok(block(monster, 'magical', range));
      assert.equal(block(monster, 'physical', range), null);
      assert.equal(block(monster, 'pure', range), null);
    }
  }
  }],

  ["unknown attack stats fail closed only for requested dangerous monsters",()=>{
  assert.ok(block('porcupine', undefined, NaN));
  assert.ok(block('tiger', undefined, 120));
  for (const monster of ['goo', 'crab', 'armadillo', 'greenjr', undefined])
    assert.equal(block(monster, undefined, NaN), null);
  }],

// The two per-character reflect lists:
// TG9 the defaults, TG28 one character's list, TG10 the choices from game data, TG12 a skill by its
// own damage type. Pure functions of the lists, the attacker and game data, so they join this file.
  ["TG9: a character with no entry blocks today's monsters, and nothing new",()=>{
  const lists = reflectLists({}, {}, 'P');
  assert.deepEqual(lists, { magic: ['slenderman', 'tiger', 'goblin'], physical: ['porcupine'] });
  for (const monster of ['slenderman', 'tiger', 'goblin']) assert.ok(block(monster, 'magical', 300, lists), monster);
  assert.ok(block('porcupine', 'physical', 30, lists));
  assert.equal(block('porcupine', 'physical', 75, lists), null);
  for (const monster of ['sparkbot', 'iceroamer', 'armadillo', 'goo']) {
    assert.equal(block(monster, 'magical', 30, lists), null, monster);
    assert.equal(block(monster, 'physical', 30, lists), null, monster);
  }
  }],
  ["TG28: one character's lists block only that character's attacks",()=>{
  const magic = { P: ['sparkbot'] }, physical = { W: ['armadillo'] };
  const P = reflectLists(magic, physical, 'P'), W = reflectLists(magic, physical, 'W');
  assert.ok(block('sparkbot', 'magical', 200, P));
  assert.equal(block('sparkbot', 'magical', 200, W), null);
  // P's edited list replaces its defaults; W keeps them.
  assert.equal(block('goblin', 'magical', 200, P), null);
  assert.ok(block('goblin', 'magical', 200, W));
  // An added physical monster gets the porcupine entry's rule: blocked below range 75.
  assert.equal(block('armadillo', 'physical', 30, W), 'Armadillo damage return: physical attacks require range >= 75');
  assert.equal(block('armadillo', 'physical', 75, W), null);
  assert.equal(block('armadillo', 'physical', 30, P), null);
  assert.equal(block('porcupine', 'physical', 30, W), null, 'W took porcupine off its list');
  assert.equal(block('porcupine', 'physical', 30, P), 'Porcupine damage return: physical attacks require range >= 75');
  }],
  ["TG10: a list takes only the monsters game data rates for it",()=>{
  const settings = targetingSavedFields.settings, magic = settings.reflectMagicByCharacter.check, physical = settings.reflectPhysicalByCharacter.check;
  setGameMonsters({ bee: {}, sparkbot: { reflection: 10 }, goblin: { reflection: 50 }, porcupine: { dreturn: 4800 }, armadillo: { dreturn: 30 } });
  try {
    assert.deepEqual(reflectChoices(), { magic: ['goblin', 'sparkbot'], physical: ['armadillo', 'porcupine'] });
    assert.equal(magic({ P: ['sparkbot'] }), true);
    assert.equal(magic({ P: ['bee'] }), false);
    assert.equal(magic({ P: 'sparkbot' }), false);
    assert.equal(physical({ W: ['armadillo', 'porcupine'] }), true);
    assert.equal(physical({ W: ['sparkbot'] }), false);
    assert.equal(physical({ W: [] }), true, 'an empty list blocks nothing');
  } finally { setGameMonsters(null); }
  // Before the game data loads the check keeps a saved list, so a restart never resets it.
  assert.equal(magic({ P: ['bee'] }), true);
  }],
  ["movement.gameMonsters: the reflect choices read the coordinator's game data",()=>{
  setGameMonsters({ sparkbot: { reflection: 10 }, porcupine: { dreturn: 4800 } });
  const saved = globalThis.__partyHooks;
  try {
    assert.deepEqual(reflectChoices(), { magic: ['sparkbot'], physical: ['porcupine'] });
    // A realm where core:movement does not answer reads the table as not loaded: no choices yet.
    globalThis.__partyHooks = createRegistry();
    assert.deepEqual(reflectChoices(), { magic: [], physical: [] });
  } finally { globalThis.__partyHooks = saved; setGameMonsters(null); }
  }],
  ["TG12: a skill is blocked by its own damage type, not the attacker's",()=>{
  const { createAnswers } = require('../../runtime/characters/targeting/gates.ts');
  const saved = Object.fromEntries(['G', 'sharedRoutine', 'character'].map(k => [k, global[k]]));
  global.G = { skills: { mentalburst: { hostile: true, damage_type: 'magical' }, supershot: { hostile: true, damage_type: 'physical' }, taunt: { hostile: true } } };
  global.sharedRoutine = { skillTargetAllowed: () => true, rareAttackAllowed: () => true };
  try {
    const world = actor => ({ actor, skills: global.G.skills, context: { mode: 'grouped' } });
    const answers = actor => createAnswers({ world: () => world(actor), pullSafe: () => true, module: require('./helpers/targeting-module.cjs').answerModule(() => global.sharedRoutine), reflect: () => reflectLists({}, {}, actor.name),
      hooks: { targeting: { refuses: () => undefined }, calls: { band: () => 'send' } } });
    const goblin = { id: 'g', type: 'monster', mtype: 'goblin', target: 'W' };
    const warrior = { name: 'W', ctype: 'warrior', range: 30, hp: 100 }, priest = { name: 'P', ctype: 'priest', range: 200, hp: 100 };
    assert.equal(answers(warrior).allows(goblin, 'mentalburst'), 'unauthorized or immune target', "a physical attacker's magical skill is blocked");
    assert.equal(answers(priest).allows(goblin, 'supershot'), undefined, "a magical attacker's physical skill passes");
    assert.equal(answers(priest).allows(goblin, 'taunt'), undefined, 'Taunt passes the damage-type block');
  } finally { for (const [k, v] of Object.entries(saved)) if (v === undefined) delete global[k]; else global[k] = v; }
  }],
]);
