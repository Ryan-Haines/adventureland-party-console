const { targetingContext, targetingModule, answerDrain } = require('./helpers/targeting-module.cjs');
// Each published read of the targeting owner answers with its module's own function.
// Movement's moved code asks these reads, so each row checks that the read's `HOOKS`
// row is declared and that `core:targeting` answers it with the module function of the name shared.js
// gave it (install.ts `reads`). A row plants that function as a probe that echoes its own name and
// arguments, so a read wired to the wrong function, or one that drops or adds an argument, fails.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { scenarioTable } = require('./fixtures/scenarios.cjs');
const { HOOKS, createRegistry } = require('../../runtime/hooks/registry.ts');
const { publishTargetingReads } = require('../../runtime/characters/targeting/install.ts');
const { installCharacterEvents } = require('./helpers/character-events.cjs');
const { eventAreas, eventReservedBy } = require('../../runtime/events/rules.ts');

const FILE = 'scripts/tests/targeting-selection.test.cjs';
// reads: the hook, today's function and the arguments a caller passes.
const target = { id: 'goo1', type: 'monster', mtype: 'goo' };
const READS = [
  ['targeting.partyAttacker', 'getNearestPartyAttacker'], ['targeting.partyTarget', 'getNearestPartyTarget'],
  ['targeting.engagedMonster', 'engagedMonster'], ['targeting.focusedInRadius', 'visibleFocusedMonsterWithinRadius'],
  ['targeting.dungeonTarget', 'getDungeonTarget'], ['targeting.eventTarget', 'nearestEventTarget'],
  ['targeting.returnDefenseTarget', 'returnDefenseTarget'], ['targeting.rareTarget', 'rareTarget'],
  ['targeting.passingTarget', 'passingTarget'], ['targeting.defensiveTarget', 'groupedDefensiveTarget'],
  ['targeting.activeTarget', 'activeCombatTarget'],
  ['targeting.allowed', 'isAllowedTarget', target, true, 'diagnostic'], ['targeting.claimed', 'isExternallyClaimedMonster', target],
  ['targeting.attacking', 'isAttackingPartyMember', target], ['targeting.priority', 'monsterPriority', target],
  ['targeting.lockAllows', 'leaderLockAllows', target], ['targeting.partyTargetIs', 'isCurrentPartyTarget', target],
  ['targeting.returnAttacker', 'returnAttacker', target], ['targeting.groupReady', 'groupedAttackAllowed', target],
  ['targeting.rareAllows', 'rareAttackAllowed', target, 'attack'], ['targeting.committedEncounter', 'committedHuntEncounter', target],
  ['targeting.passingEncounter', 'isPassingEncounter', target], ['targeting.levelAllows', 'passiveLevelAllowed', target],
  ['targeting.passiveStop', 'passiveStopRequired', target], ['targeting.departureEngaged', 'departureTargetEngaged', target],
  ['targeting.dungeonAllows', 'dungeonTargetAllowed', target], ['targeting.frankyAllows', 'frankyTargetAllowed', target],
  ['targeting.drainAllows', 'consoleDrainAllows', target], ['targeting.graveyardAreaAllows', 'graveyardAreaAttackAllowed', 120],
  ['targeting.passingKey', 'passingKey', target, 'USII'],
  ['targeting.returnActive', 'returnCombatActive'], ['targeting.unfinished', 'unfinishedFight'],
  ['targeting.drainCombat', 'consoleDrainCombatActive'], ['targeting.departurePending', 'departureCombatPending'],
  ['targeting.anchorVisible', 'groupedAnchorVisible'],
  ['targeting.report', 'queueReport'], ['targeting.acknowledgement', 'groupedAcknowledgement'],
  ['targeting.entityReport', 'groupedEntityReport', target], ['targeting.passingReport', 'passingEncounterReport'],
  ['targeting.publishSelection', 'publishCombatSelection', target, true], ['targeting.beginPassing', 'beginPassingAttack', target, { at: 1 }, false],
  ['targeting.acceptQueue', 'acceptQueue', { key: 'party' }], ['targeting.acceptControl', 'acceptCombatControl', { mode: 'grouped' }],
  ['targeting.cancelReturnTown', 'cancelReturnTownUnderAttack'],
];

// The module's reads in a context that plants each function as a probe state at known values, and the
// queue writer `acceptQueue` as the probe the `receive` row reads (helpers/targeting-module.cjs builds
// the module and sets each planted name in it).
function world() {
  const c = targetingContext({ character: { name: 'W', map: 'main', in: 'main' }, groupedCombat: { key: 'party' }, combatTargetId: 'goo0', combatSelection: { id: 'goo0', revision: 3 },
    leaderTarget: 'goo2', leaderCombatSelection: null, partyTargets: ['goo3'], partyThreats: ['goo4'], scatterBreakTarget: null,
    lastAttackAt: 5, lastAttackTarget: 'goo0', fightDeaths: [], passingEncounters: {} });
  const calls = [];
  for (const [, name] of READS) c[name] = (...args) => { calls.push(name); return { fn: name, args }; };
  const hooks = createRegistry();
  publishTargetingReads(c.targeting.reads(), hooks);
  return { c, hooks, calls };
}
const row = (hook, words, run) => [`${hook}: ${words}`, run];

scenarioTable("each published read answers as its shared.js function did", world, [
  ...READS.map(([hook, name, ...args]) => row(hook, `answers as ${name} did`, w => {
    const declared = HOOKS[hook];
    assert.ok(declared, `${hook} is a declared hook`);
    assert.deepEqual([declared.kind, declared.answers, declared.core], ['request', 'one', true]);
    assert.equal(declared.fixture, `${FILE}#${hook}: answers as ${name} did`);
    assert.deepEqual(w.hooks.ask(hook, ...args), { fn: name, args }, `${hook} reaches ${name} with the caller's arguments`);
    assert.deepEqual(w.calls, [name], 'one call, to that function only');
  })),
  row('targeting.groupView', "declared with CF3's state reads and requests", w => {
    for (const hook of ['targeting.queue', 'targeting.selection', 'targeting.setTargetId', 'targeting.noteAttack', 'targeting.receive', 'targeting.groupView'])
      assert.deepEqual([HOOKS[hook].kind, HOOKS[hook].answers, HOOKS[hook].core], ['request', 'one', true], hook);
    assert.ok(w.hooks.registrations().some(r => r.name === 'core:targeting'));
  }),
  ['a CODE reload publishes its own closure functions in the same registration', w => {
    const reloaded = { ...w.c.targeting.reads(), 'targeting.claimed': () => 'reloaded' };
    publishTargetingReads(reloaded, w.hooks);
    assert.equal(w.hooks.ask('targeting.claimed', target), 'reloaded');
    assert.equal(w.hooks.registrations().filter(r => r.name === 'core:targeting').length, 1);
  }],
  // The published read is rules.ts `pullOnly` itself, and a monster that already targets someone is
  // never a pull-only target.
  row('targeting.pullOnly', 'answers as rules.ts pullOnly does (TRN-Q-DPS)', w => {
    assert.equal(HOOKS['targeting.pullOnly'].fixture, `${FILE}#targeting.pullOnly: answers as rules.ts pullOnly does (TRN-Q-DPS)`);
    assert.equal(w.hooks.ask('targeting.pullOnly', target, 'supershot'), w.c.targeting.reads()['targeting.pullOnly'](target, 'supershot'));
    assert.equal(w.hooks.ask('targeting.pullOnly', { ...target, target: 'E2EWarrior' }, 'supershot'), false);
  }),
  row('targeting.queue', "answers today's groupedCombat, the same object", w => {
    assert.equal(w.hooks.ask('targeting.queue'), w.c.groupedCombat);
    w.c.groupedCombat = null;
    assert.equal(w.hooks.ask('targeting.queue'), null, 'read at the call');
  }),
  row('targeting.selection', "answers today's selection variables, read at the call", w => {
    assert.deepEqual(JSON.parse(JSON.stringify(w.hooks.ask('targeting.selection'))), { targetId: 'goo0', selection: { id: 'goo0', revision: 3 },
      leaderTarget: 'goo2', partyTargets: ['goo3'], partyThreats: ['goo4'], scatterBreakTarget: null, lastAttack: { target: 'goo0', at: 5 },
      leaderSelection: null, deaths: [], passingEncounters: {} });
    w.c.combatTargetId = 'goo9';
    assert.equal(w.hooks.ask('targeting.selection').targetId, 'goo9');
  }),
  row('targeting.setTargetId', "writes combatTargetId as today's bare write", w => {
    w.hooks.ask('targeting.setTargetId', 'goo7', '02');
    assert.equal(w.c.combatTargetId, 'goo7');
    w.hooks.ask('targeting.setTargetId', null, '02');
    assert.equal(w.c.combatTargetId, null);
  }),
  row('targeting.noteAttack', 'writes lastAttackTarget and lastAttackAt', w => {
    w.hooks.ask('targeting.noteAttack', 'goo8', 42, '02');
    assert.deepEqual([w.c.lastAttackTarget, w.c.lastAttackAt], ['goo8', 42]);
  }),
  row('targeting.receive', "writes the reply's fields it carries, the queue through acceptQueue", w => {
    w.hooks.ask('targeting.receive', { partyThreats: ['t'], partyTargets: ['p'], leaderTarget: 'l', scatterBreakTarget: { id: 's' },
      combatTargetId: null, leaderCombatSelection: { id: 'l' }, groupedCombat: { key: 'next' } });
    assert.deepEqual([w.c.partyThreats, w.c.partyTargets, w.c.leaderTarget, w.c.scatterBreakTarget, w.c.combatTargetId, w.c.leaderCombatSelection],
      [['t'], ['p'], 'l', { id: 's' }, null, { id: 'l' }]);
    assert.deepEqual(w.calls, ['acceptQueue'], 'the queue goes through acceptQueue');
    w.hooks.ask('targeting.receive', { leaderTarget: 'm' });
    assert.deepEqual([w.c.leaderTarget, w.c.partyTargets], ['m', ['p']], 'a field the reply leaves out stays');
  }),
]);

// During Franky the selection takes no passing target,
// and a changed event target replaces the kept selection. The selection pass over a context where
// the events owner's Franky fact holds and the event target is planted.
const pass=()=>{
  const event={id:'franky',type:'monster',visible:true},add={id:'mummy',type:'monster',visible:true};
  const c=targetingContext({character:{ctype:'warrior',map:'level2w',in:'level2w'},characterEvents:{frankyActive:()=>true},nearestEventTarget:()=>event,
    passingTarget:()=>add,isAllowedTarget:()=>true,getPriorityEventTarget:()=>null,returnCombatActive:()=>false,rareTarget:()=>null,
    setCombatTarget(){},sharedTargetId:()=>null,get_entity:id=>id===event.id?event:id===add.id?add:null,partyCombatState:{}});
  c.root=c;
  const p=c.targeting.selectionPass({root:c,allows:()=>true,reset(){},retire:()=>null,covers:()=>false,equipment:()=>null,notify(){},follow:async()=>{},errorReason:String});
  return {c,p,event,add};
};
// Franky's fight on the events owner's facts as shared.js installs them
// (helpers/character-events.cjs): the member selected Franky, joined it and its attendance owns it,
// on level2w with Franky's game data. The boss stands nearest; one spawn targets this character, a
// nearer one another member.
const frankyFight=()=>{
  const at={type:'monster',visible:true,hp:1000,map:'level2w',in:'level2w',y:0};
  const entities={boss:{...at,id:'boss',mtype:'franky',x:40},mine:{...at,id:'mine',mtype:'nerfedmummy',target:'Hero',x:90},
    other:{...at,id:'other',mtype:'nerfedmummy',target:'Ally',x:10}};
  const c=targetingContext({character:{name:'Hero',ctype:'warrior',map:'level2w',in:'level2w',x:0,y:0},parent:{entities},
    G:{maps:{level2w:{event:'franky'}},monsters:{franky:{spawns:[[15000,'nerfedmummy']]},nerfedmummy:{}}},
    eventAttend:{selected:name=>name==='franky',joined:()=>'franky',traveling:()=>null,active:()=>({name:'franky'}),owns:name=>name==='franky'},
    eventTargetTypes:['franky'],combatTargetId:null});
  c.root=c;installCharacterEvents(c);
  return {c,entities,...entities};
};
scenarioTable("during Franky the selection follows the event target",pass,[
  ['no passing target is taken during Franky',({p})=>{ assert.equal(p.passingTarget(),null); }],
  ['a changed event target replaces the kept selection',async ({c,p,event})=>{
    await p.selectTarget();assert.equal(p.selected(),'franky');
    const next={id:'franky2',type:'monster',visible:true};c.nearestEventTarget=()=>next;c.get_entity=id=>id==='franky2'?next:id==='franky'?event:null;
    await p.selectTarget();assert.equal(p.selected(),'franky2');
  }],
  // The attacker half: Franky's attackers are its timed spawns in `G.monsters.franky.spawns`
  // (`nerfedmummy`, `targets.attackers`, rules.ts `eventAttackers`), which combat.ts publishes
  // as `attackers`. Targeting's Franky row (`frankyAttacker`) allows one whose target is this
  // character, and the finder takes those first, then the boss.
  ['the Franky row allows a Franky spawn that targets this character, and no other',()=>{
    const {c,boss,mine,other}=frankyFight();
    assert.deepEqual(c.characterEvents.attackers('franky'),['nerfedmummy'],"the boss's timed spawns are its attackers");
    assert.deepEqual([c.frankyTargetAllowed(boss),c.frankyTargetAllowed(mine),c.frankyTargetAllowed(other)],[true,true,false]);
    assert.equal(c.frankyAttacker(boss),false,'the boss is no attacker');
  }],
  ['the Franky finder takes an attacker of this character before the nearer boss',()=>{
    const {c,entities}=frankyFight();
    assert.equal(c.nearestEventTarget().id,'mine','the attacker goes first, the spawn on another member stays out');
    delete entities.mine;
    assert.equal(c.nearestEventTarget().id,'boss','with no attacker the finder takes the boss');
  }],
]);

// (and upstream issues" row 39): during a safe console load the selection takes one of the drain's
// targets: live, visible, on the character's map and instance, not known dead, not another party's
// unless it attacks ours, the party's attackers first, then the nearest; and a drain target passes
// the group lock.
const drain=()=>{
  const at={type:'monster',visible:true,hp:100,map:'main',in:'main'};
  const entities={near:{...at,id:'near',x:5,y:0},far:{...at,id:'far',x:50,y:0},other:{...at,id:'other',x:1,y:0,map:'cave'},
    claimed:{...at,id:'claimed',x:2,y:0},dead:{...at,id:'dead',x:3,y:0}};
  const c=targetingContext({character:{ctype:'warrior',map:'main',in:'main',x:0,y:0},parent:{entities},root:{},
    isExternallyClaimedMonster:e=>e.id==='claimed',isAttackingPartyMember:e=>e.target==='W',
    getPriorityEventTarget:()=>null,returnCombatActive:()=>false,rareTarget:()=>null,setCombatTarget(){},sharedTargetId:()=>null,
    get_entity:id=>entities[id]||null,partyCombatState:{},leaderLockAllows:()=>false},undefined,{walks:{reunionRealm:()=>'USII'}});
  // The lifecycle owner's drain answer (`lifecycle.drain`) lists the five
  // targets.
  answerDrain(c,()=>({targets:Object.fromEntries(['near','far','other','claimed','dead'].map(id=>['USII:main:main:'+id,true]))}));
  const p=c.targeting.selectionPass({root:c,allows:()=>true,reset(){},retire:()=>null,covers:()=>false,equipment:()=>null,notify(){},follow:async()=>{},errorReason:String});
  return {c,p,entities};
};
scenarioTable('the drain row picks its own targets',drain,[
  ['a known-dead monster is never the pick',async ({p})=>{p.invalidateTarget('dead');await p.selectTarget();assert.notEqual(p.selected(),'dead');}],
  ["another map's monster is never the pick",async ({p})=>{await p.selectTarget();assert.notEqual(p.selected(),'other');}],
  ["another party's monster is never the pick",async ({p})=>{p.invalidateTarget('dead');await p.selectTarget();assert.equal(p.selected(),'near');}],
  // A draining console keeps its current target, so the attacker row starts with no selection.
  ["another party's monster that attacks ours is the pick",async ({p,entities})=>{
    entities.claimed.target='W';p.invalidateTarget('dead');await p.selectTarget();assert.equal(p.selected(),'claimed');}],
  ['an attacker comes before a nearer monster',async ({p,entities})=>{p.invalidateTarget('dead');entities.far.target='W';await p.selectTarget();assert.equal(p.selected(),'far');}],
  ['a drain target passes the group lock',({c,entities})=>{assert.equal(c.isAllowedTarget(entities.far),true);}],
  // shared.js:2447-2466: the drain also fights an unlisted monster that attacks the party.
  ['an unlisted monster that attacks the party is a drain pick',async ({p,entities})=>{
    entities.raider={type:'monster',visible:true,hp:100,map:'main',in:'main',id:'raider',x:90,y:0,target:'W'};
    p.invalidateTarget('dead');await p.selectTarget();assert.equal(p.selected(),'raider');}],
]);

// Table A, M's membership rows and M's priority rows answer as v1.5.0's
// `isAllowedTarget` and `monsterPriority` did, reason and all, on one world per row. The old
// functions run from their source text over the world's names (fixtures/targeting-.cjs); the new ones
// run in the module with the same world planted as its functions and shared.js's ports, and the events owner's
// facts over the world's attendance and types (helpers/character-events.cjs), with the Franky fight,
// the A/B opponent and the Graveyard pick planted as the world says. A row that answers otherwise
// names the decision behind it (`decided`).
const oldB9 = require('./fixtures/targeting-b9b5c91e.cjs');
const old9855 = require('./fixtures/targeting-9855e8c9.cjs');
const BASE = () => ({ graveyard: false, drainAllows: true, cave: false, dungeonOwns: false, dungeonAllowed: false, returnActive: false,
  returnAttacker: false, franky: false, frankyAllowed: false, travel: false, departureEngaged: false, huntPending: false, passiveRules: {},
  levelAllowed: true, passing: false, recovery: false, dead: false, unfinished: false, lock: true, rare: null, abOpponent: false,
  claimed: false, narrows: false, keep: true, joined: null, active: null, setAside: {}, passiveRare: false, attacking: false,
  engagement: null, inArea: true, inRadius: true, retentions: [], grouped: null, realm: 'USII', huntType: null, radius: 300, threat: false,
  combatTargetId: null, lastAttackTarget: null, lastAttackAt: 0, groupWalk: { travel: null }, partyThreats: [], scatterBreak: null,
  eventTypes: [], focus: ['goo'], mode: 'default', scatterType: null, followLeader: false, leaderTarget: null, map: 'main',
  priorities: {}, rareActive: false, target: { id: 'g1', type: 'monster', mtype: 'goo', x: 10, y: 0 }, command: undefined });
const characterOf = w => ({ name: 'W', map: w.map, in: w.map, x: 0, y: 0, cave: w.cave });
function oldRules(w) {
  // v1.5.0's death recovery refuses every target while it runs and is not finishing,
  // so a running recovery is the world's `recovery` flag.
  const env = {
    character: characterOf(w), excludedGraveyardTarget: () => w.graveyard, consoleDrainAllows: () => w.drainAllows,
    dungeonTargetAllowed: () => w.dungeonAllowed, returnCombatActive: () => w.returnActive, returnAttacker: () => w.returnAttacker,
    frankyCombatActive: () => w.franky, frankyTargetAllowed: () => w.frankyAllowed, travelCombatActive: () => w.travel,
    departureTargetEngaged: () => w.departureEngaged, isAttackingPartyMember: () => w.attacking, passiveHunting: { rules: w.passiveRules },
    passiveLevelAllowed: () => w.levelAllowed, unfinishedFight: () => w.unfinished, eventTargetTypes: w.eventTypes, monsterFocus: w.focus,
    isPassingEncounter: () => w.passing, combatRecoveryActive: () => w.recovery,
    root: { partyRoleRunner: { isKnownDead: () => w.dead }, __partyFarmingEngagement: w.engagement, partyLootClient: { huntPending: () => w.huntPending },
      __partyDungeonRuntime: { owns: () => w.dungeonOwns }, __partyCombatRecovery: { phase: 'running', targets: [] } },
    leaderLockAllows: () => w.lock, rareTarget: () => w.rare, validAbtestingOpponent: () => w.abOpponent, isExternallyClaimedMonster: () => w.claimed,
    joinedEvent: w.joined, farmApproach: { failed: w.setAside }, passiveRareCandidate: () => w.passiveRare, inFarmArea: () => w.inArea,
    inFarmRadius: () => w.inRadius, partyLocation: null, groupedCombat: w.grouped, reunionRealm: () => w.realm, huntCombatTarget: w.huntType,
    monsterSearchRadius: w.radius, activeCombatEvent: () => w.active, isPartyThreat: () => w.threat, queueRetentions: () => w.retentions,
    combatTargetId: w.combatTargetId, lastAttackTarget: w.lastAttackTarget, lastAttackAt: w.lastAttackAt, convoyTraveling: !!w.groupWalk.travel,
    partyThreats: w.partyThreats, scatterBreakTarget: w.scatterBreak, farmingMode: w.mode, partyFarmingMonsterType: w.scatterType,
    followLeader: w.followLeader, leaderTarget: w.leaderTarget, monsterPriorities: w.priorities, rareActive: () => w.rareActive };
  const load = source => new Function('env', `with (env) { return (${source}); }`)(env);
  return { isAllowedTarget: load(oldB9.isAllowedTarget), monsterPriority: load(oldB9.monsterPriority) };
}
// The hunting owner's farming facts as facts.ts holds them, the hunting door's
// `facts`.
const huntingOf = w => ({ cave: { owned: w.dungeonOwns }, focus: { contains: () => w.inArea, inRadius: () => w.inRadius, focus: w.focus,
  huntTarget: w.huntType, partyType: w.scatterType, mode: w.mode, lootPending: w.huntPending,
  rare: { candidate: () => w.passiveRare, active: w.rareActive, control: null } } });
function newRules(w) {
  const root = { partyRoleRunner: { isKnownDead: () => w.dead }, __partyFarmingEngagement: w.engagement };
  // Goo Brawl's goos are game data the area event's list reads (`targets.first`, `G.monsters`).
  const G = { monsters: { rgoo: {}, bgoo: {}, goo: {} } };
  const c = targetingContext({ character: characterOf(w), parent: { entities: {} }, root, G,
    characterEvents: { frankyActive: () => w.franky, validOpponent: () => w.abOpponent,
      // The area and reserved boss as combat.ts reads them; the world's flag stands in for the pick.
      eventTargets: () => ({ types: w.eventTypes, area: eventAreas(G).get(w.map) ?? null, reservedBy: eventReservedBy, excluded: () => w.graveyard }) },
    consoleDrainAllows: () => w.drainAllows, drainListed: () => false,
    dungeonTargetAllowed: () => w.dungeonAllowed, returnCombatActive: () => w.returnActive, returnAttacker: () => w.returnAttacker,
    frankyTargetAllowed: () => w.frankyAllowed, departureTargetEngaged: () => w.departureEngaged, isAttackingPartyMember: () => w.attacking,
    passiveLevelAllowed: () => w.levelAllowed, unfinishedFight: () => w.unfinished, isPassingEncounter: () => w.passing,
    recoveryRefuses: () => w.recovery, leaderLockAllows: () => w.lock, rareTarget: () => w.rare, isExternallyClaimedMonster: () => w.claimed,
    getGroupedTarget: () => null, isPartyThreat: () => w.threat, queueRetentions: () => w.retentions,
    groupedCombat: w.grouped, combatTargetId: w.combatTargetId, lastAttackTarget: w.lastAttackTarget, lastAttackAt: w.lastAttackAt,
    partyThreats: w.partyThreats, scatterBreakTarget: w.scatterBreak, leaderTarget: w.leaderTarget, setAside: w.setAside,
    eventAttend: { active: () => w.active, joined: () => w.joined, traveling: () => null },
    eventTargetTypes: w.eventTypes,
    // The module's killed list (install.ts `killed`) holds the world's confirmed death.
    killed: new Map(w.dead ? [[w.target.id, 0]] : []),
    partyLocation: null, monsterPriorities: w.priorities }, undefined, {
    tasks: { membership: { followLeader: () => w.followLeader }, partyList: () => ['W'] },
    walks: { groupWalk: w.groupWalk, travelCombatActive: () => w.travel, reunionRealm: () => w.realm },
    hunting: { facts: huntingOf(w), rares: { passive: () => ({ rules: w.passiveRules }) }, farm: { radius: () => w.radius } } });
  // The realm's hooks: the world's narrowing add-on, no rule add-on and, for the lifecycle owner's
  // `lifecycle.drain`, no drain.
  root.__partyHooks = { targeting: { narrows: () => w.narrows, candidates: v => w.keep ? v.candidates : [], rules: () => false }, ask: () => null };
  return { isAllowedTarget: (...a) => c.isAllowedTarget(...a), monsterPriority: target => c.monsterPriority(target) };
}
const goo = (extra = {}) => ({ id: 'g1', type: 'monster', mtype: 'goo', x: 10, y: 0, ...extra });
const hunt = { purpose: 'monster-hunt', combatHandoffAllowed: true, huntTarget: 'goo' };
const same = over => () => {
  const w = { ...BASE(), ...over };
  const oldDiag = {}, newDiag = {};
  const was = oldRules(w).isAllowedTarget(w.target, w.command, oldDiag), now = newRules(w).isAllowedTarget(w.target, w.command, newDiag);
  assert.deepEqual([now, newDiag.reason], [was, oldDiag.reason]);
};
// A row whose refusal label changed since an earlier build answers as it did, under the
// new label.
const relabelled = (over, reason) => () => {
  const w = { ...BASE(), ...over };
  const oldDiag = {}, newDiag = {};
  const was = oldRules(w).isAllowedTarget(w.target, w.command, oldDiag), now = newRules(w).isAllowedTarget(w.target, w.command, newDiag);
  assert.equal(now, was);
  assert.ok(oldDiag.reason, 'the old rule refused with a label');
  assert.equal(newDiag.reason, reason);
};
// A row whose answer a decision changed since an earlier build: v1.5.0 answered
// `was`, and the module answers `now` with the decision's reason.
const decided = (over, was, now) => () => {
  const w = { ...BASE(), ...over };
  const oldDiag = {}, newDiag = {};
  assert.deepEqual([oldRules(w).isAllowedTarget(w.target, w.command, oldDiag), oldDiag.reason], was);
  assert.deepEqual([newRules(w).isAllowedTarget(w.target, w.command, newDiag), newDiag.reason], now);
};
scenarioTable("tables A and M answer as the earlier console's isAllowedTarget did", () => null, [
  ['A1 the Graveyard exclusion', same({ graveyard: true })],
  ['A2 the drain gate', same({ drainAllows: false })],
  ['A3 Cave answers by the dungeon rule', same({ cave: true, dungeonAllowed: true })],
  ['A3 Cave refuses by the dungeon rule', same({ dungeonOwns: true, dungeonAllowed: false })],
  ['A4 return defence', same({ returnActive: true, returnAttacker: true })],
  // The label is v1.5.0's, which names the attackers the row now allows.
  ['A5 Franky only', relabelled({ franky: true, frankyAllowed: false }, 'Franky attendance permits Franky and mummies targeting this character')],
  ['A6 travel owns combat', same({ travel: true })],
  ['A6 a Hunt hand-off passes travel', same({ travel: true, command: hunt })],
  ['A7 Hunt loot pending', same({ huntPending: true })],
  ['A8 missing target', same({ target: null })],
  ['A9 passive max level', same({ passiveRules: { goo: { enabled: true, priority: 60 } }, levelAllowed: false, focus: [] })],
  ['A10 passing owns it', same({ passing: true })],
  ['A11 death recovery', same({ recovery: true })],
  ['A12 known dead', same({ dead: true })],
  ['A13 Franky allows', same({ franky: true, frankyAllowed: true })],
  ['A14 field generator', same({ target: goo({ mtype: 'fieldgen0' }) })],
  ['A15 unfinished fight on a Hunt hand-off', same({ command: hunt, unfinished: true })],
  ['A16 the group lock', same({ lock: false })],
  ['A17 tinyp', same({ target: goo({ mtype: 'tinyp' }) })],
  ['A18 the rare target', same({ rare: goo(), lock: true })],
  ['A19 a character', same({ target: goo({ type: 'character' }), abOpponent: true })],
  ['A20 claimed elsewhere', same({ claimed: true })],
  // v1.5.0 had no add-on hook adds `targeting.candidates`.
  ['A21 an add-on refuses', decided({ narrows: true, keep: false }, [true, undefined], [false, 'refused by an add-on'])],
  ['A22 an event boss outside its event', same({ target: goo({ mtype: 'horseman' }) })],
  ['A23 set aside on a Hunt hand-off', same({ command: hunt, setAside: { g1: Date.now() + 60_000 } })],
  ['A24 passive rare', same({ passiveRare: true, focus: [] })],
  ['A25 attacks the party', same({ attacking: true, focus: [] })],
  ['A26 the farming engagement inside its area', same({ engagement: { target: { id: 'g1' } }, focus: [] })],
  ['A26 the farming engagement outside its area', same({ engagement: { target: { id: 'g1' } }, inArea: false })],
  ['A27 the unfinished target', same({ unfinished: true, grouped: { target: { id: 'g1', map: 'main', in: 'main', server: 'USII' } }, focus: [], inArea: false, inRadius: false })],
  ['A28 outside the farm area', same({ inArea: false, inRadius: false })],
  ['A28 the Goo Brawl map is no farm area', same({ map: 'goobrawl', inArea: false, inRadius: false, focus: [] })],
  ['A28 a retained queue target', same({ inArea: false, inRadius: false, retentions: [{ id: 'g1', eligible: true }] })],
  ['M2 the current target', same({ focus: [], combatTargetId: 'g1' })],
  ['M3 a convoy threat', same({ focus: [], groupWalk: { travel: { phase: 'walk' } }, partyThreats: [{ id: 'g1' }] })],
  ['M4 a party threat', same({ focus: [], threat: true })],
  ['M5 the scatter break target', same({ focus: [], scatterBreak: { id: 'g1' } })],
  ['M6 an event target type', same({ focus: [], eventTypes: ['goo'] })],
  ['M7 the scatter type in scatter mode', same({ focus: [], mode: 'scatter', scatterType: 'goo' })],
  ["M8 the leader's target under Follow", same({ focus: [], followLeader: true, leaderTarget: { id: 'g1' } })],
  ['M9 focus all', same({ focus: ['all'] })],
  ['M10 the focus types', same({})],
  ['no M row holds', same({ focus: [] })],
  ...[['P1 the passive rule', { passiveRules: { goo: { enabled: true, priority: 70 } } }], ['P2 tinyp', { target: goo({ mtype: 'tinyp' }) }],
    ['P3 a rare type while a rare runs', { target: goo({ mtype: 'phoenix' }), rareActive: true }],
    ['P4 the saved priorities', { priorities: { goo: 80 } }], ['P5 every other monster', {}]].map(([name, over]) => [`${name} ranks as monsterPriority did`, () => {
    const w = { ...BASE(), ...over };
    assert.equal(newRules(w).monsterPriority(w.target), oldRules(w).monsterPriority(w.target));
  }]),
]);

// and: table S supplies the target v1.5.0's role runner chose (`chooseTarget`, its S
// functions, fixtures/targeting-.cjs) on one world per row, and with nothing registered on
// `targeting.prefers` the class finder's order is today's. The new pass runs in the module with every
// finder planted; the old functions run over the same world as the routine. v1.5.0's
// runner had no Manual branch, so the S1 rows that differ name the decision.
const S_BASE = () => ({ manual: false, own: null, inRange: true, priorityEvent: null, dungeon: false, dungeonTarget: null, returnActive: false,
  returnTarget: null, franky: false, eventTarget: null, merchant: false, grouped: false, groupedTarget: null, rare: null, classTarget: null });
const entity = id => id && { id, type: 'monster', visible: true, dead: false };
function oldChoice(w) {
  const sharedRoutine = { usesLeaderTarget: () => w.grouped, getGroupedTarget: () => entity(w.groupedTarget),
    getPriorityEventTarget: () => entity(w.priorityEvent), dungeonOwned: () => w.dungeon, getDungeonTarget: () => entity(w.dungeonTarget),
    returnCombatActive: () => w.returnActive, returnDefenseTarget: () => entity(w.returnTarget), frankyCombatActive: () => w.franky,
    getEventTarget: () => entity(w.eventTarget), getRareTarget: () => entity(w.rare) };
  const env = { sharedRoutine, character: { ctype: w.merchant ? 'merchant' : 'warrior', target: w.own },
    resolvedRole: () => ({ chooseTarget: () => entity(w.classTarget) }) };
  const source = require('esbuild').transformSync(oldB9.chooseTarget, { loader: 'ts' }).code;
  return new Function('env', `with (env) { ${source}\nreturn chooseTarget(); }`)(env)?.id ?? null;
}
async function newChoice(w) {
  const c = targetingContext({ character: { ctype: w.merchant ? 'merchant' : 'warrior', target: w.own, map: 'main', in: 'main' }, parent: { entities: {} },
    get_entity: entity, is_in_range: () => w.inRange, partyCombatState: {}, isAllowedTarget: () => true, setCombatTarget() {}, sharedTargetId: () => null,
    getGroupedTarget: () => entity(w.groupedTarget), getPriorityEventTarget: () => entity(w.priorityEvent), getDungeonTarget: () => entity(w.dungeonTarget),
    returnCombatActive: () => w.returnActive, returnDefenseTarget: () => entity(w.returnTarget), characterEvents: { frankyActive: () => w.franky },
    nearestEventTarget: () => entity(w.eventTarget), rareTarget: () => entity(w.rare), classTarget: () => entity(w.classTarget) }, undefined, {
    tasks: { holds: { handControl: () => w.manual ? { by: 'manual' } : null } },
    hunting: { farm: { grouped: () => w.grouped }, cave: { owned: () => w.dungeon } } });
  c.root = c;
  const p = c.targeting.selectionPass({ root: c, allows: () => true, reset() {}, retire: () => null, covers: () => false, equipment: () => null, notify() {},
    follow: async () => {}, errorReason: String });
  await p.selectTarget();
  return p.selected();
}
const sameChoice = over => async () => { const w = { ...S_BASE(), ...over }; assert.equal(await newChoice(w), oldChoice(w)); };
// v1.5.0 chose `was`; the module chooses `now` under the user's Manual rule (the tasks owner's hand
// control).
const manualChoice = (over, was, now) => async () => {
  const w = { ...S_BASE(), ...over };
  assert.deepEqual([oldChoice(w), await newChoice(w)], [was, now]);
};
scenarioTable("table S supplies the target the earlier console's chooseTarget did", () => null, [
  ["S1 Manual takes the player's own target (N2: the Manual rule)", manualChoice({ manual: true, own: 'mine', classTarget: 'role' }, 'role', 'mine')],
  ['S1 Manual takes its own pick in range', sameChoice({ manual: true, classTarget: 'role' })],
  ['S1 Manual takes no pick out of range (N2: the Manual rule)', manualChoice({ manual: true, classTarget: 'role', inRange: false }, 'role', null)],
  ['S2 the priority event', sameChoice({ priorityEvent: 'pumpkin', classTarget: 'role' })],
  ['S2 gives way to an exclusive row', sameChoice({ priorityEvent: 'pumpkin', dungeon: true, dungeonTarget: 'cave1' })],
  ['S3 Cave', sameChoice({ dungeon: true, dungeonTarget: 'cave1', classTarget: 'role' })],
  ['S3 Cave with no target stands', sameChoice({ dungeon: true, classTarget: 'role' })],
  ['S4 return defence', sameChoice({ returnActive: true, returnTarget: 'ret', classTarget: 'role' })],
  ['S5 Franky', sameChoice({ franky: true, eventTarget: 'franky', classTarget: 'role' })],
  ['S6 merchant', sameChoice({ merchant: true, classTarget: 'event', grouped: true, groupedTarget: 'lock' })],
  ['S7 grouped', sameChoice({ grouped: true, groupedTarget: 'lock', rare: 'phoenix', classTarget: 'role' })],
  ['S8 rare', sameChoice({ rare: 'phoenix', classTarget: 'role' })],
  ['S9 the class role', sameChoice({ classTarget: 'role' })],
  ['no row supplies a target', sameChoice({})],
]);
// With nothing registered on `targeting.prefers` the class finder takes the nearest goo of the top
// priority, as today; an add-on's order goes first inside that priority only.
const finder = order => {
  const goos = { near: { id: 'near', type: 'monster', mtype: 'goo', visible: true, x: 10, y: 0 }, far: { id: 'far', type: 'monster', mtype: 'goo', visible: true, x: 90, y: 0 },
    top: { id: 'top', type: 'monster', mtype: 'bee', visible: true, x: 200, y: 0 } };
  const hooks = createRegistry();
  if (order) {
    hooks.register({ name: 'order', folder: 'addons', author: 't', summary: 's', hooks: { 'targeting.prefers': order } });
    hooks.configure({ order: { enabled: true } });
  }
  const c = targetingContext({ character: { name: 'W', ctype: 'warrior', map: 'main', in: 'main', x: 0, y: 0 }, parent: { entities: goos },
    root: { __partyHooks: hooks }, monsterPriorities: { bee: 60 }, isExternallyClaimedMonster: () => false, partyTargets: [] }, undefined,
  { tasks: { partyList: () => ['W'] }, hunting: { facts: { focus: { focus: ['goo', 'bee'] } } } });
  return { c, goos };
};
scenarioTable('targeting.prefers orders only inside the top priority', () => null, [
  ['with nothing registered the order is distance', () => { assert.equal(finder().c.getNearestFocusedMonster().id, 'top'); }],
  ['inside one priority the order is distance with nothing registered', () => {
    const { c } = finder(); c.monsterPriorities = {}; assert.equal(c.getNearestFocusedMonster().id, 'near'); }],
  ['an add-on that prefers the farther goo takes it inside the priority', () => {
    const { c } = finder(v => [...v.candidates].reverse()); c.monsterPriorities = {}; assert.equal(c.getNearestFocusedMonster().id, 'top'); }],
  ['an add-on order never lifts a lower priority', () => {
    const { c } = finder(v => [...v.candidates].sort(a => a.id === 'near' ? -1 : 1)); assert.equal(c.getNearestFocusedMonster().id, 'top'); }],
  ["the view carries the character and the party", () => {
    let seen; const { c } = finder(v => { seen = v; return undefined; }); c.monsterPriorities = {}; c.getNearestFocusedMonster();
    assert.deepEqual([seen.character.name, seen.party, Object.keys(seen.entities).length], ['W', ['W'], 3]); }],
]);

// One selection pass reads each fact once, however many monsters its finders weigh. A counting port
// wraps each fact shared.js hands the view, and each of the events owner's facts the view asks
// (view.ts `EVENT_FACTS`).
scenarioTable('a selection pass reads each fact once', () => {
  const counts = {}, count = (name, value) => (...a) => { counts[name] = (counts[name] || 0) + 1; return typeof value === 'function' ? value(...a) : value; };
  const at = { type: 'monster', visible: true, hp: 100, mtype: 'goo', target: 'W' };
  const entities = Object.fromEntries(['a', 'b', 'c', 'd'].map((id, i) => [id, { ...at, id, x: 10 * (i + 1), y: 0 }]));
  const root = { partyLootClient: { huntPending: count('huntPending', false) }, __partyDungeonRuntime: { owns: count('dungeonOwns', false) } };
  let asked = 0;
  // The lifecycle owner's drain answer is the realm's `lifecycle.drain` ask.
  root.__partyHooks = { targeting: { narrows: () => { asked++; return false; }, orders: () => false, rules: () => false },
    survival: { escaping: () => undefined }, ask: count('drain', null) };
  const rareActive = count('rareActive', false);
  const c = targetingContext({ character: { name: 'W', ctype: 'priest', map: 'main', in: 'main', x: 0, y: 0 }, parent: { entities }, root,
    get_entity: id => entities[id] || null, partyCombatState: {}, groupWalk: { travel: null }, partyThreats: [], partyTargets: [],
    G: { monsters: {}, skills: {} }, characterEvents: { frankyActive: count('frankyCombatActive', false), active: count('activeCombatEvent', null) },
    classTarget: () => { c.engagedMonster(); return c.visibleFocusedMonsterWithinRadius(); } }, undefined, {
    tasks: { partyList: count('currentPartyList', ['W']), holds: { targetScope: count('targetScope', null), handControl: count('handControl', null) },
      assignment: { assignedTier: count('assignedTier', 'farming'), combatRecoveryHolds: count('combatRecoveryHolds', false) } },
    walks: { travelCombatActive: count('travelCombatActive', false), reunionRealm: count('reunionRealm', 'USII') },
    hunting: { farm: { grouped: count('groupedFarming', false) }, cave: { owned: count('dungeonOwned', false) },
      facts: { focus: { focus: ['goo'], contains: () => true, inRadius: () => true,
        rare: { control: null, get active() { return rareActive(); }, candidate: () => false } } } } });
  const p = c.targeting.selectionPass({ root: c, allows: () => true, reset() {}, retire: () => null, covers: () => false, equipment: () => null,
    notify() {}, follow: async () => {}, errorReason: String });
  return { p, c, counts, asked: () => asked };
}, [
  ['each fact is read at most once while A weighs every monster', async ({ p, counts, asked, c }) => {
    await p.selectTarget();
    assert.equal(c.partyCombatState.error, undefined, 'the pass ran without an error');
    assert.ok(asked() >= 4, `A ran for each monster (${asked()} asks)`);
    assert.deepEqual(Object.entries(counts).filter(([, n]) => n > 1), [], JSON.stringify(counts));
  }],
]);

// Each hidden pick reads its declaration's default, which is today's value, and no file of either
// targeting folder reads a pick's default other than through `pick`.
scenarioTable("each hidden pick reads its declaration at today's value", () => null, [
  ["the defaults are today's values", () => {
    const { pick } = require('../../runtime/characters/targeting/saved-fields.ts');
    const today = { setAsideMs: 10000, targetPassMs: 1000, crabReplyMs: 2000, attackStallMs: 5000, pursuitStallMs: 5000, unseenGoneMs: 8000,
      snapshotGapMs: 10000, successorGrantMs: 3000, passingMemoryMs: 60000, groupReadyMs: 500, queueTickMs: 100, lostTargetRadius: 180 };
    assert.deepEqual(Object.fromEntries(Object.keys(today).map(name => [name, pick(name)])), today);
  }],
  ['every read goes through pick', () => {
    const path = require('node:path'), root = path.join(__dirname, '../..');
    const files = ['runtime/characters/targeting', 'runtime/coordinator/targeting'].flatMap(dir =>
      fs.readdirSync(path.join(root, dir)).filter(f => f.endsWith('.ts') && f !== 'saved-fields.ts').map(f => path.join(dir, f)));
    const direct = files.filter(f => /targetingSavedFields\.settings\.\w+\.default/.test(fs.readFileSync(path.join(root, f), 'utf8')));
    assert.deepEqual(direct, []);
  }],
]);

// Table G: each row of G answers `targeting.allows` as did, reason and
// all, on one world per row. The old module runs from its source text (fixtures/targeting-.cjs) with
// today's `monsterAttackBlock` and `effectiveAttackDamageType`, which it imported; both read the
// same world. G alone keeps v1.5.0 had no single answer to replay (the fixture's header
// says why). Cleave stays out of the Franky rows: took it out of the Franky veto.
const G_BASE = () => ({ allowed: true, drainAllows: true, busy: false, disabled: false, ready: true, rare: true, returnActive: false,
  returnAttacker: true, franky: false, skillAllowed: true, world: true, pullSafe: true, hostile: true, reflect: { magic: [], physical: [] },
  passing: false, damageType: 'physical', actorType: 'physical', refuses: undefined, target: { id: 'g1', type: 'monster', mtype: 'goo' }, skill: 'attack' });
function gateWorld(w) {
  const module = { isAllowedTarget: () => w.allowed, consoleDrainAllows: () => w.drainAllows, groupedAttackAllowed: () => w.ready,
    rareAttackAllowed: () => w.rare, returnCombatActive: () => w.returnActive, returnAttacker: () => w.returnAttacker, franky: () => w.franky,
    skillTargetAllowed: () => w.skillAllowed, describeAttackRange: () => null, combatTargetRevision: () => null };
  const ports = { hooks: { targeting: { refuses: () => w.refuses }, calls: { band: () => 'send' } }, currentTarget: () => null,
    passingTarget: () => w.passing ? w.target : null, equipmentBusy: () => w.busy, reflect: () => w.reflect,
    world: () => w.world ? { skills: { [w.skill]: { damage_type: w.damageType } }, actor: { range: 100 } } : null,
    pullSafe: () => w.pullSafe, franky: () => w.franky, module };
  const globals = { parent: { is_disabled: () => w.disabled }, character: { ctype: 'warrior', range: 100, slots: {}, damage_type: w.actorType },
    G: { skills: { [w.skill]: { hostile: w.hostile } }, items: {}, classes: { warrior: {} } } };
  return { module, ports, globals };
}
function gateAnswer(w, which) {
  const { module, ports, globals } = gateWorld(w);
  const saved = Object.fromEntries(Object.keys(globals).map(k => [k, globalThis[k]]));
  Object.assign(globalThis, globals);
  try {
    if (which === 'new') return require('../../runtime/characters/targeting/gates.ts').createAnswers(ports).allows(w.target, w.skill);
    const { transformSync } = require('esbuild');
    const code = transformSync(old9855.answers, { loader: 'ts', format: 'cjs' }).code;
    const exportsOf = {}, gates = require('../../runtime/characters/targeting/gates.ts');
    const sharedRoutine = { allowsTarget: module.isAllowedTarget, allowsPassingTarget: module.consoleDrainAllows, groupedAttackAllowed: module.groupedAttackAllowed,
      rareAttackAllowed: module.rareAttackAllowed, returnCombatActive: module.returnCombatActive, returnAttacker: module.returnAttacker,
      skillTargetAllowed: module.skillTargetAllowed };
    const loaded = { exports: exportsOf };
    new Function('module', 'exports', 'require', 'sharedRoutine', code)(loaded, exportsOf, id => id === './gates.ts' ? gates : {}, sharedRoutine);
    return loaded.exports.createAnswers(ports).allows(w.target, w.skill);
  } finally { Object.assign(globalThis, saved); }
}
// `refuses` says whether the row's world refuses, so a row that both answers leave open still fails.
const sameGate = (over, refuses = true) => () => {
  const w = { ...G_BASE(), ...over }, now = gateAnswer(w, 'new');
  assert.equal(now, gateAnswer(w, 'old'));
  assert.equal(typeof now === 'string', refuses, String(now));
};
scenarioTable("table G answers as the earlier console's createAnswers did", () => null, [
  ['G1 eligibility', sameGate({ allowed: false })],
  ['G1 the passing check', sameGate({ passing: true, drainAllows: false })],
  ['G2 the bow swap', sameGate({ busy: true })],
  ["G3 the game's is_disabled", sameGate({ disabled: true })],
  ["G4 the group's readiness", sameGate({ ready: false })],
  ['G4 a passing target skips readiness', sameGate({ passing: true, ready: false }, false)],
  ["G5 the reflect lists by the attack's damage type", sameGate({ reflect: { magic: ['goo'], physical: [] }, actorType: 'magical' })],
  ['G6 the rare policy', sameGate({ rare: false })],
  ['the attack allowed', sameGate({}, false)],
  ['G7 the return defence veto', sameGate({ skill: 'taunt', returnActive: true })],
  ['G8 the Franky veto', sameGate({ skill: 'charge', franky: true })],
  ['G8 a skill that is not hostile ends the table', sameGate({ skill: 'heal', hostile: false, skillAllowed: false }, false)],
  ["G9 the target's return veto", sameGate({ skill: 'supershot', returnActive: true, returnAttacker: false })],
  ['G9 no skill world', sameGate({ skill: 'supershot', world: false })],
  ["G10 the reflect lists by the skill's own damage type", sameGate({ skill: 'supershot', reflect: { magic: ['goo'], physical: [] }, damageType: 'magical' })],
  ['G10 Taunt is excepted', sameGate({ skill: 'taunt', reflect: { magic: ['goo'], physical: [] }, damageType: 'magical' }, false)],
  ['G11 eligibility with the skill', sameGate({ skill: 'supershot', skillAllowed: false })],
  ['G11 the rare policy refuses the skill', sameGate({ skill: 'supershot', rare: false })],
  ["G12 the turns owner's scatter pull check", sameGate({ skill: 'supershot', pullSafe: false })],
  ["G13 an add-on's refusal", sameGate({ refuses: 'tank: holding' })],
  ['the skill allowed', sameGate({ skill: 'supershot' }, false)],
]);

// The unit files build the module where a test asks for it. A context the test creates itself holds
// no targeting name until it asks; once it does, a name planted before the build is the module's own
// (red while the helper replaced vm.createContext for the process).
scenarioTable('a context holds targeting names only once its test builds the module', () => null, [
  ['a bare context reads no module name', () => {
    const c = vm.createContext({});
    assert.equal(vm.runInContext("typeof isAllowedTarget + ' ' + typeof leaderTarget", c), 'undefined undefined');
  }],
  ['a built context reads its planted state from the module', () => {
    const c = targetingContext({ leaderTarget: { id: 'goo1' } });
    assert.equal(c.targeting.state.leaderTarget.id, 'goo1');
    assert.equal(typeof c.isAllowedTarget, 'function');
  }],
]);

// shared.js hands targeting each owner's door (`targetingPorts()`), so a walk planted on movement's
// door is the one the travel stop answer reads.
const walkDoor = () => {
  const travel = { requester: { tier: 'farming' } };
  const t = targetingModule(vm.createContext({ character: { name: 'W', ctype: 'warrior', map: 'main', in: 'main' }, parent: { entities: {} } }),
    {}, { walks: { groupWalk: { travel } } });
  return { t, travel };
};
scenarioTable("targeting reads movement's walk from its door", walkDoor, [
  ['a farming walk on the door lets a passive rare stop it', ({ t }) => { assert.equal(t.passiveTravelInterruptible(), true); }],
  ["the door's walk is read at the ask, so a manual walk is never stopped", ({ t, travel }) => {
    travel.requester.tier = 'manual'; assert.equal(t.passiveTravelInterruptible(), false); }],
]);
