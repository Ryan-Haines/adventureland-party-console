// Survival's needs on a planted party (a shared setup lives
// in the harness). One builder serves the potion table,
// the heal choice and the emergency Stomp, so their cases are rows of the tables that use it.
const { createNeeds, potionChoice } = require('../../../runtime/characters/survival/needs.ts');
const { testScope } = require('../helpers/run-scope.cjs');

// One character's view for the potion table: its class, its vitals, its two lines (whole percents,
// the settings "HP potion below" and "MP potion below", 3.9), the escape's MP budget while it
// escapes, the warrior leader's Taunt cost while a monster threatens the party, and the HP the
// bag's last HP potion gives (the merchant's row 6).
const potionView = (ctype, vitals, extra = {}) => ({ ctype, max_hp: 5000, max_mp: 2000, hp: 5000, mp: 2000,
  lines: ctype === 'merchant' ? { hp: 20, mp: 20 } : { hp: 50, mp: 20 }, escape: null, tauntCost: null, potionGives: 400, ...vitals, ...extra });
function potionTable() {
  return { choice: (ctype, vitals, extra) => potionChoice(potionView(ctype, vitals, extra)) };
}

// The game globals the needs read, the ports with the party's reports, and one role loop pass.
// `kind` is the character: a priest for the heal choice, a warrior with a basher for the Stomp;
// `stats` changes the character's own numbers. A member's live entity is its report unless the row
// gives it an `entity` of its own, and the roster holds the names the rows added.
const CHARACTERS = {
  priest: { name: 'Priest', ctype: 'priest', map: 'main', in: 'main', level: 80, hp: 100, max_hp: 100, mp: 1000, max_mp: 1000, heal: 10 },
  warrior: { name: 'Warrior', ctype: 'warrior', map: 'main', in: 'main', x: 0, y: 0, mp: 120, max_mp: 1000, hp: 100, max_hp: 100, slots: { mainhand: { name: 'basher' } } },
};
function needsWorld(kind = 'priest', stats = {}) {
  const g = globalThis, members = [], entities = {}, state = {}, roster = [];
  const world = { members, franky: false, kiting: false };
  g.character = { ...structuredClone(CHARACTERS[kind]), ...stats };
  roster.push(g.character.name);
  g.G = { skills: { partyheal: { mp: 400, levels: [[60, 800]] }, heal: { class: ['priest'] }, stomp: { mp: 120, range: 400 } },
    items: { basher: { wtype: 'basher' }, fireblade: { wtype: 'short_sword' } } };
  g.parent = { entities: {} };
  g.get_entity = () => null;
  g.is_on_cooldown = () => false; g.can_use = () => true;
  g.is_in_range = target => !target.unreachable;
  g.get_player = name => name === g.character.name ? g.character : entities[name] || null;
  // The Stomp's gates (needs.ts `stompHeld`): the events owner's Franky fight stands for another owner's hold, and
  // The targeting owner's published reads answer as a plain farm unless a row plants `world.reads`.
  world.mode = 'default'; world.reads = {};
  const reads = { 'targeting.graveyardAreaAllows': () => true, 'targeting.rareTarget': () => null, 'targeting.unfinished': () => false,
    'targeting.lockAllows': () => true, 'targeting.attacking': () => false };
  const needs = createNeeds({ members: () => members, sameTeam: m => m.friendly !== false, escapeStage: () => null, townCasting: () => !!world.townCasting,
    partyhealAllowed: () => true, isLeader: () => false, partyAttacker: () => null, fighting: () => false, lines: () => ({ hp: 50, mp: 20 }),
    state: () => state, stomp: { franky: () => world.franky, mode: () => world.mode, ask: (hook, ...args) => (world.reads[hook] ?? reads[hook])(...args) },
    kiting: () => world.kiting, roster: () => roster });
  const view = { character: g.character, roleLoop: true, pulse: false, healFirstBelow: 80 };
  return { g, world, members, state, needs, view,
    add(name, hp, extra = {}) {
      const member = { name, ctype: 'warrior', hp, max_hp: 100, map: 'main', ...extra };
      members.push(member); roster.push(name);
      entities[name] = extra.entity ? { ...member, ...extra.entity } : member;
      return member;
    },
    heals: () => needs.heal(view) || [],
    stomp: () => needs.stomp(view)?.skill === 'stomp' };
}

// Survival installed on a needs world's character (install.ts: the character half shared.js builds,
// then the role runner's install) with planted ports: `world` holds the recovery phase, the survival
// band's answer, whether the executor refuses the escape's spends, `shared`,
// shared.js ports the row replaces, and `events`, the events owner's character facts the row replaces. `realm` is
// where the install publishes `__partySurvival`; a row that asks the registration's answers passes
// `globalThis`, which they read.
function installedSurvival(t, world, realm = {}) {
  const { installSurvivalCharacter, installSurvival } = require('../../../runtime/characters/survival/install.ts');
  const registrations = new Map(), told = [];
  // Survival asks the events owner's facts through api.ts `eventFacts()`: the
  // event team, the A/B partyheal mode, Franky's fight, the marker, the rejoin mark, the join rule
  // and the Goo Brawl exit. They answer as a plain farm outside any event; `stopAll` puts back what
  // the realm held before.
  const before = globalThis.__partyEventFacts;
  globalThis.__partyEventFacts = { sameTeam: () => true, partyhealAllowed: () => true, frankyActive: () => false, joinedEventName: () => null,
    travellingEventName: () => null, rejoinPending: () => null, joins: () => false, rejoin: async () => ({ status: 'recovered' }),
    exitGoobrawlForRecovery: async () => undefined, ...world.events };
  const hooks = { publish: r => { registrations.set(r.name, r); return { ok: true }; }, notify: (hook, payload) => { told.push([hook, payload]); },
    ask: () => undefined, calls: { band: () => world.band, margin: () => 0 } };
  const none = () => null, no = () => false;
  // Survival's `act` handle on the process's run scope (shared.js `scopes.act05`).
  const half = installSurvivalCharacter(realm, hooks, { current: () => true, act: testScope('05', 'act'), hand: none,
    movement: () => ({ townCasting: no, release() {}, endClimb() {}, stop: async () => undefined, climbing: none }),
    members: () => t.members, reports: () => t.members, roster: () => [], isLeader: no,
    healFirstBelow: () => 80, kiting: no, combatMode: () => 'default',
    socket: () => undefined, ownActor: no,
    deathAt: () => 0, reportGap: () => 1000, scope: none, clockOffset: () => 0, recoveryHolds: no, taskPhase: none,
    memberTask: none, revision: () => 0, farmReturn: no, nextReport: () => new Promise(() => {}), holdIdle() {}, ...world.shared });
  half.recoveryPhase = () => world.phase;
  half.potionLines = () => ({ hp: 50, mp: 20 });
  // `world.turns` replaces the executor's members a row reads, such as the pulse pass and its next edge.
  const turns = { spend: () => world.refuse ? Promise.reject({ reason: 'no_mp' }) : Promise.resolve(), ready: () => ({ ready: true, flying: false, cost: 0, reserve: 0 }), margin: () => 0,
    pass() {}, nextReady: () => null, ...world.turns };
  const survival = installSurvival(realm, { hooks, character: half, turns: () => turns, state: () => t.state, dead() {} });
  return Object.assign(survival, { half, told, registration: () => registrations.get('core:survival'), stopAll() { survival.stop(); half.stop(); globalThis.__partyEventFacts = before; } });
}

module.exports = { potionTable, needsWorld, installedSurvival };
