const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../../characters/shared.js'), 'utf8');
const code = source.slice(source.indexOf('  async function regenerateHpOrMp('), source.indexOf('  async function energizeLowestMana('));
const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const calls = [], entities = {};
  const character = { name: 'Priest', ctype: 'priest', map: 'main', hp: 100, max_hp: 100, mp: 100, max_mp: 100 };
  const r = vm.createContext({ character, partyPositions: [], healingBusy: false, regenerationBusy: false, reunion: null,
    escapeOwns: () => false, runtimeCurrent: () => true, sameEventTeamMember: m => m.friendly !== false,
    get_player: name => entities[name], can_heal: target => !target.unreachable,
    heal: async target => { calls.push(['heal', target.name]); target.hp = target.max_hp; },
    use_skill: async skill => calls.push(['skill', skill]), is_on_cooldown: () => false, can_use: () => true,
    isLiveAbtesting: () => false, abtestingStrategy: null, G: { skills: { heal: { mp: 10 }, partyheal: { mp: 20 } } },
    game_log() {}, engagedMonster: () => null, setTimeout, clearTimeout,
    anniversaryStaging: false, anniversaryBusy: false, eventTraveling: false, townTraveling: false,
    forceTraveling: false, convoyTraveling: false, partyConvoyActive: false, followingLeader: false,
    departurePending: false, partyTownActive: false, banking: false, stocking: false, upgrading: false, gatheringActive: false,
  });
  r.root = r;
  r.partyCombatState = {};
  vm.runInContext(code, r);
  return { r, calls, add(name, hp = 95, extra = {}) {
    const member = { name, hp, max_hp: 100, map: 'main', ...extra };
    r.partyPositions.push(member); entities[name] = member; return member;
  } };
}

for (const flag of ['anniversaryStaging', 'anniversaryBusy', 'convoyTraveling', 'eventTraveling', 'followingLeader', 'partyTownActive'])
  test('regular healing continues during ' + flag, async () => {
    const t = fixture(); t.r[flag] = true; t.add('Warrior', 95);
    t.r.passiveRegenerationTick(); await settle();
    assert.deepEqual(t.calls, [['heal', 'Warrior']]);
  });

test('movement allows regular heals and priest regeneration in the same pulse', async () => {
  const t = fixture(); t.r.character.moving = true; t.r.character.mp = 70; t.add('Warrior');
  t.r.passiveRegenerationTick(); await settle();
  assert.deepEqual(t.calls, [['heal', 'Warrior'], ['skill', 'regen_mp']]);
});

test('only an acknowledged heal publishes success telemetry', async () => {
  const t = fixture(); t.add('Warrior', 70);
  t.r.partyCombatState = { error: 'too_far', errorAt: 1 };
  await t.r.healPartyBelow(.9);
  assert.equal(t.r.partyCombatState.lastHealTarget, 'Warrior');
  assert.ok(t.r.partyCombatState.lastHealAt > 0);
  assert.equal(t.r.partyCombatState.error, null);
  t.r.partyCombatState = {};
  t.r.partyPositions[0].hp = 70;
  t.r.heal = async () => { throw { reason: 'too_far' }; };
  await assert.rejects(t.r.healPartyBelow(.9));
  assert.equal(t.r.partyCombatState.lastHealAt, undefined);
  assert.equal(t.r.partyCombatState.error, 'too_far');
  assert.ok(t.r.partyCombatState.errorAt > 0);
});

test('passive pulse never uses partyheal even for multiple critical members', async () => {
  const t = fixture(); t.r.anniversaryStaging = true; t.add('Warrior', 30); t.add('Mage', 40);
  t.r.passiveRegenerationTick(); await settle(); assert.deepEqual(t.calls, [['heal', 'Warrior']]);
});

test('ordinary combat retains the 90 percent threshold and critical partyheal', async () => {
  const t = fixture(); t.add('Warrior', 95);
  assert.equal(await t.r.healPartyBelow(0.9), false);
  t.r.partyPositions[0].hp = 30; t.add('Mage', 40);
  assert.equal(await t.r.healPartyBelow(0.9), true);
  assert.deepEqual(t.calls, [['skill', 'partyheal']]);
});

test('skip unreachable, dead, other-map and opposing-team members without moving', async () => {
  const t = fixture(); t.add('Far', 10, { unreachable: true }); t.add('Dead', 1, { rip: true });
  t.add('OtherMap', 5, { map: 'cave' }); t.add('Enemy', 5, { friendly: false }); t.add('Near', 80);
  assert.equal(await t.r.healPartyBelow(1, { regularOnly: true }), true);
  assert.deepEqual(t.calls, [['heal', 'Near']]);
});

test('no heal when dead, out of mana, on cooldown, stale-full, or an ordinary combat pulse', async () => {
  for (const mode of ['dead', 'mp', 'cooldown', 'full', 'combat']) {
    const t = fixture(); t.r.anniversaryStaging = mode !== 'combat'; const member = t.add('Warrior');
    if (mode === 'dead') t.r.character.rip = true;
    if (mode === 'mp') t.r.character.mp = 0;
    if (mode === 'cooldown') t.r.can_heal = () => false;
    if (mode === 'full') t.r.get_player = () => ({ ...member, hp: 100 });
    t.r.passiveRegenerationTick(); await settle(); assert.equal(t.calls.some(c => c[0] === 'heal'), false, mode);
  }
});

test('pending heals cannot overlap role healing; rejection releases the guard', async () => {
  const t = fixture(); t.add('Warrior', 80); let reject;
  t.r.heal = () => new Promise((_, fail) => { reject = fail; });
  const pending = t.r.healPartyBelow(1, { regularOnly: true });
  assert.equal(await t.r.healPartyBelow(0.9), false);
  reject(new Error('cooldown')); await assert.rejects(pending); assert.equal(t.r.healingBusy, false);
});

test('topping off the warrior lets existing regeneration select MP', async () => {
  const t = fixture(); const warrior = t.add('Warrior', 95, { ctype: 'warrior', mp: 70, max_mp: 100 });
  await t.r.healPartyBelow(1, { regularOnly: true }); t.r.character = warrior;
  await t.r.regenerateHpOrMp(); assert.deepEqual(t.calls, [['heal', 'Warrior'], ['skill', 'regen_mp']]);
});

test('merchant cannot take regular healing priority or trigger partyheal with one injured fighter', async () => {
 const t=fixture();t.add('Merchant',1,{ctype:'merchant'});t.add('Warrior',40,{ctype:'warrior'});
 await t.r.healPartyBelow(.9);assert.deepEqual(t.calls,[['heal','Warrior']]);
 t.calls.length=0;await t.r.healPartyBelow(1,{regularOnly:true});assert.deepEqual(t.calls,[]);
});
test('live merchant identity is rejected even when snapshot class is missing', async () => {
 const t=fixture();const merchant=t.add('Merchant',1);t.r.partyPositions[0]={...merchant};merchant.ctype='merchant';
 await t.r.healPartyBelow(.9);assert.deepEqual(t.calls,[]);
});

test('merchant uses actual potion healing amount rather than HP percentage, even during a service job', async()=>{
 const t=fixture();t.r.character.ctype='merchant';t.r.character.max_hp=2000;t.r.character.hp=1599;
 t.r.character.items=[{name:'hpot1'}];t.r.G.items={hpot1:{gives:[['hp',400]]}};
 t.r.banking=true;t.r.passiveRegenerationTick();await settle();assert.deepEqual(t.calls,[['skill','use_hp']]);
 t.calls.length=0;t.r.character.hp=1600;await t.r.regenerateHpOrMp();assert.deepEqual(t.calls,[['skill','regen_hp']]);
});
test('merchant potion follows inventory selection, respects cooldown, and cannot overlap requests',async()=>{
 const t=fixture();t.r.character.ctype='merchant';t.r.character.max_hp=2000;t.r.character.hp=1700;
 t.r.character.items=[{name:'hpot1'},{name:'hpot0'}];t.r.G.items={hpot0:{gives:[['hp',200]]},hpot1:{gives:[['hp',400]]}};
 t.r.is_on_cooldown=()=>true;assert.equal(await t.r.regenerateHpOrMp(),false);assert.equal(t.calls.length,0);
 t.r.is_on_cooldown=()=>false;let finish;t.r.use_skill=skill=>{t.calls.push(skill);return new Promise(resolve=>finish=resolve);};
 const pending=t.r.regenerateHpOrMp();assert.equal(await t.r.regenerateHpOrMp(),false);finish();await pending;assert.deepEqual(t.calls,['use_hp']);
});
