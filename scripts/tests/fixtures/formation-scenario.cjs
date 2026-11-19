// The formation solver's setups (a shared setup builder
// lives in the test harness). Each builder runs shared.js's grouped reads in a fresh vm context on
// the shared movement harness (movement-owner-callers.cjs), with movement's formation solver and
// its corner and terrain recovery (helpers/formation.cjs) and combat steps
// (helpers/combat-steps.cjs) over the events owner's character facts (helpers/character-events.cjs), so a combat
// step goes through the owner's free-character service.
const { drivePositions } = require('../helpers/targeting-module.cjs');
const { testScope } = require('../helpers/run-scope.cjs');
const vm = require('node:vm');

// A warrior and a priest in Main around one goo that targets the warrior. With `priestSelf` the
// context's character is the priest. `moves` records each sent step; `now` sets the clock.
function formationScenario(priestSelf = false) {
  let now = 10000;
  const moves = [];
  const warrior = { name: 'W', ctype: 'warrior', map: 'main', x: 158, y: 0, range: 30, speed: 60, hp: 100, max_hp: 100, visible: true };
  const priest = { name: 'P', ctype: 'priest', map: 'main', x: 0, y: 0, range: 196, speed: 56, hp: 100, max_hp: 100, visible: true };
  const monster = { id: 'A', type: 'monster', mtype: 'goo', map: 'main', x: 186, y: 0, range: 20, target: 'W', visible: true };
  const players = { W: warrior, P: priest }, entities = { A: monster };
  // The tasks owner's party list, which a party of three replaces.
  const party = { list: ['W', 'P'] };
  const c = require('../helpers/client-dependencies.cjs').passingContext({ farmingTravelToken: null, character: priestSelf ? priest : warrior, leader: 'W', followLeader: true,
    farmingMode: 'default', eventTargetTypes: [], runtimeCurrent: () => true,
    // The turns executor reads the skill and item tables (executor.ts familyTable, potionSlot).
    G: { maps: { main: {} }, monsters: { goo: { range: 20 } }, skills: {}, items: {} }, parent: { entities },
    get_player: name => players[name], get_entity: id => entities[id], currentPartyList: () => ['W', 'P'],
    reunionRealm: () => 'USII', coordinatorClockOffset: 0, leaderCombatSelection: null, groupedCombat: null,
    combatSelection: { id: null, revision: 0 }, convoyRuntimeId: 'runtime',
    // The hunting owner's Cave and grouped answers as shared.js binds them for movement (turnsPorts `dungeonOwned`,
    // `groupedFarming`): no Cave run owns this pair, and W leads a grouped farm P follows.
    dungeonOwned: () => false, groupedFarming: () => true,
    Date: class extends Date { static now() { return now; } },
    can_move_to: () => true, is_in_range: () => true, kiteState: {},
    // The game's `distance` on the CODE frame, hitbox-free here.
    distance: (a, b) => Math.hypot(a.x - b.x, a.y - b.y),
    move: (x, y) => { moves.push({ x, y }); return new Promise(() => {}); },
  }, { tasks: { partyList: () => party.list, membership: { leader: () => 'W', followLeader: () => true } },
    hunting: { farm: { grouped: () => true } } }); c.root = c;
  // The grouped and passing reads this file kept; targeting's functions come from its module
  // (helpers/targeting-module.cjs).
  drivePositions(c, [warrior, priest].map(p => ({ ...p, seenAt: now, server: 'USII' })));
  require('../helpers/queue-markers.cjs').installQueueMarkers(c);
  require('../helpers/walk-reports.cjs').installWalkDefense(c);
  require('../helpers/group-movement.cjs').installGroupMoves(c);
  require('../helpers/formation.cjs').installFormation(c);
  require('../helpers/combat-steps.cjs').installCombatSteps(c);
  return { c, warrior, priest, monster, moves, players, entities, party, now: value => now = value };
}

// A warrior, priest and mage, each in its own context, approaching one planned darkhound. With
// `invisible` only the warrior sees it. `tick` runs every member's formation move once and walks
// each moving member one 100 ms step at its speed.
function approachParty(invisible = false) {
  const w = { name: 'W', ctype: 'warrior', map: 'main', x: 162, y: 0, range: 30, speed: 60, hp: 100, max_hp: 100, visible: true };
  const p = { name: 'P', ctype: 'priest', map: 'main', x: 0, y: 0, range: 194, speed: 56, hp: 100, max_hp: 100, visible: true };
  const m = { name: 'M', ctype: 'mage', map: 'main', x: 20, y: 0, range: 200, speed: 52, hp: 100, max_hp: 100, visible: true };
  const target = { id: 'H', mtype: 'darkhound', type: 'monster', map: 'main', server: 'USII', x: 400, y: 0, hp: 19200, max_hp: 19200, range: 20, visible: true, target: null, state: 'planned' };
  const members = [w, p, m], contexts = members.map(actor => {
    const r = formationScenario(), c = r.c; c.character = actor; c.currentPartyList = () => members.map(a => a.name); r.party.list = members.map(a => a.name); c.get_player = name => members.find(a => a.name === name);
    c.get_entity = id => id === target.id && (!invisible || actor === w) ? target : null;
    c.parent.entities = actor === w || !invisible ? { H: target } : {};
    c.is_in_range = t => Math.hypot(actor.x - t.x, actor.y - t.y) <= actor.range;
    c.stop = () => { actor.moving = false; return Promise.resolve(); };
    c.move = (x, y) => { r.moves.push({ x, y }); actor.moving = true; actor.going_x = x; actor.going_y = y; return new Promise(() => {}); };
    return r;
  });
  let now = 10000;
  function tick(advance = true) {
    for (const r of contexts) {
      r.now(now); drivePositions(r.c, members.map(a => ({ ...a, server: 'USII', seenAt: now })));
      r.c.groupedCombat = { protocol: 4, key: 'party', selection: 'H', committed: true, seenAt: now, range: 174.6, priest: 'P', target, observers: [{ ...w, server: 'USII', seenAt: now }], recovering: [], fights: [] };
      r.c.formationMove(r.c.get_entity('H') || target);
    }
    if (advance) for (const a of members) if (a.moving) {
      const dx = a.going_x - a.x, dy = a.going_y - a.y, len = Math.hypot(dx, dy), fraction = Math.min(1, a.speed * 0.1 / len);
      if (len > 0) { a.x += dx * fraction; a.y += dy * fraction; }
    }
    now += 100;
  }
  return { members, contexts, target, tick };
}

// The role runner bundle with no install of its own: the rows install their role through `RunnerTest`.
const roleRunnerBundle = () => require('../helpers/role-runner-bundle.cjs').roleRunnerBundle({ install: false });

// The survival owner's character half (runtime/characters/survival/install.ts
// `installSurvivalCharacter`) for a runner a row starts with a planted `sharedRoutine`: no party
// list, no escape, no Cave and no setting, so its needs read only the character itself, and no
// socket for its death and hit handlers. Its event reads (the team, partyheal, Franky, the marker
// and the rejoin) are the events owner's facts, which the runner's context holds (helpers/character-events.cjs).
// `over` replaces a part, such as the Cave revival.
const survivalHalf = (over = {}) => {
  const no = () => false, none = () => null;
  const shared = { members: () => [], movement: () => ({ townCasting: no }), isLeader: no,
    combatMode: () => 'default', kiting: no, roster: () => [], healFirstBelow: none, current: no,
    socket: () => undefined, ownActor: no,
    // Survival's `act` handle on the process's run scope (shared.js `scopes.act05`).
    act: testScope('05', 'act'), hand: none, memberTask: none, farmReturn: no,
    nextReport: () => new Promise(() => {}), revision: () => 0 };
  return { shared, escape: { stage: none, owns: no, record: none, ownsRevival: no, adopt() {}, step() {}, answer: none },
    recovery: { climb: () => { throw Error('no event climb here'); }, hold() {}, done() {} },
    cave: { reserved: no, tick: async () => false }, atFarm: no, occupies: no, recoveryAnswer: none, recoveryPhase: none, potionLines: () => ({}), adopt() {}, ...over };
};

// The turns owner's stand-in reads (runtime/characters/turns/stand-ins/holds.ts) over a planted
// routine: the routine's own plants stay the test's, read as the turns rows: its
// `isOccupied` as the occupied escape row, `handControl` as the hand-control row. The
// event rows ask the events owner's facts, which the runner's context holds.
function turnsPorts() {
  const r = this, no = () => false, none = () => null;
  return { hand: () => r.handControl?.() ?? null, dungeonOwned: () => !!r.dungeonOwned?.(),
    cavePaused: no, current: () => true, previewing: no, leased: no, returnCombat: none, walk: none, walkState: () => ({}), merchantTidy: no,
    travelCombat: no, departing: no, departureCombat: no, monsterEngaged: no, huntDefense: no, huntLoot: no, bankQueued: no,
    recovery: no, escape: () => !!r.isOccupied?.(), rare: no, reunion: none, reunionBlocked: no, errands: no, gathering: no,
    feed: { strategy: none, team: none, enemySpawn: () => ({ x: 0, y: 0 }), step: async () => undefined },
    members: () => [], clockOffset: () => 0, roster: () => [], sameTeam: () => true, franky: () => !!r.frankyCombatActive?.(), groupedFarming: no, formationMembers: () => [],
    combatDistance: () => 0, desiredCombatRange: () => 0, safeCombatPoint: () => true,
    combatEvent: none, joinedEvent: none, leader: none, farmingMode: () => r.getFarmingMode?.() ?? 'default', liveAbtesting: no,
    roleFarmingMode: () => r.getFarmingMode?.() ?? 'default', isLeader: () => !!r.isLeader?.(), healFirstBelow: () => r.healFirstBelow?.() };
}

module.exports = { formationScenario, approachParty, roleRunnerBundle, survivalHalf, turnsPorts };
