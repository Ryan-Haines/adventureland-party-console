// The character's escape (runtime/characters/survival/escape.ts) and a warrior mid-escape
// (a shared setup lives in the harness).
// The module runs in a vm context with the shared movement harness (fixtures/movement-owner-callers.cjs),
// so its game globals are the context's, over a turns owner that sends each push as the game call
// and reads readiness from the context's cooldowns.
const { createMovementContext } = require('./movement-owner-callers.cjs');
const vm = require('node:vm');
const { installReunion } = require('../helpers/crossings.cjs');
const { contextScope } = require('../helpers/run-scope.cjs');
let bundle;
const flush = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
// `fresh` starts with no escape; otherwise the context's mage holds stage `blink` of escape `op`.
function runtime(overrides = {}, { fresh = false } = {}) {
  bundle ??= require('esbuild').buildSync({ stdin: { contents: "export { createEscape, createEscapeSpends, escapeCost } from './runtime/characters/survival/escape.ts'; export { createNeeds } from './runtime/characters/survival/needs.ts';",
    resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'iife', globalName: 'SurvivalTest', platform: 'browser' }).outputFiles[0].text;
  const casts = [], told = [], r = createMovementContext({ character: { name: 'mage', ctype: 'mage', map: 'cave', in: 'cave', x: 0, y: 0, mp: 100, max_mp: 2000, hp: 100, max_hp: 100 },
    G: { skills: { charge: { mp: 0 }, blink: { mp: 1600 }, magiport: { mp: 900 }, hardshell: { mp: 480 }, dash: { mp: 120 }, curse: { mp: 400 }, partyheal: { mp: 400 }, heal: { mp: 20 } }, maps: { cave: { doors: [[200, 0, 20, 20, 'main']] } } },
    root: {}, parent: { entities: {} }, can_move: () => true, can_move_to: () => true,
    is_on_cooldown: () => false, can_use: () => true, use_skill: async (skill) => casts.push(skill),
    anniversaryWithTimeout: p => p, setTimeout, clearTimeout, setInterval, clearInterval, ...overrides });
  r.root.__partyReunion = overrides.reunion ?? null;
  // The walk home asks the events owner's facts through api.ts `eventFacts()`, which the bundle
  // reads off this context: the marker from `joinedEventName` and `travellingEventName`, the walk
  // home's Town gate (`eventTravelling`, no event exit running), and a Goo Brawl exit that returns
  // at once.
  r.__partyEventFacts ??= { joinedEventName: () => r.joinedEventName ?? null, travellingEventName: () => r.travellingEventName ?? null,
    eventTravelling: () => !!r.travellingEventName, exitRunning: () => false, exitGoobrawlForRecovery: async () => undefined };
  installReunion(r);
  // The targeting owner's module holds the party's member reports the escape and its needs read.
  const targeting = require('../helpers/targeting-module.cjs').targetingModule(r);
  vm.runInContext(bundle, r);
  require('../helpers/requesters.cjs').installHolds(r);
  const S = r.SurvivalTest;
  r.escapeCost = S.escapeCost;
  // Survival's `act` handle on the context's run scope, as install.ts passes `shared.act` to both.
  const scope = contextScope(r, '05', 'act');
  const escape = S.createEscape({ scope, current: () => true, held: () => false, movement: () => r.movement,
    blinkAs: (request, x, y) => r.blinkAs(request, x, y), timed: request => r.timed(request), holdIdle: request => r.holdIdle(request),
    nextReport: () => r.nextReport(), reportGap: () => 1000, sleep: ms => r.sleep ? r.sleep(ms) : Promise.resolve(),
    smartMove: (destination, callback, options) => r.smart_move(destination, callback, options), realm: () => 'USII', reports: () => targeting.positions(),
    socket: () => r.socket, notify: (hook, payload) => told.push([hook, payload]) });
  const turns = { spend: ask => !r.can_use(ask.skill) || r.is_on_cooldown(ask.skill) ? Promise.reject({ reason: 'waiting' }) : Promise.resolve(r.use_skill(ask.skill, ...(ask.targets || []))),
    ready: skill => ({ ready: !r.is_on_cooldown(skill) && r.can_use(skill), flying: false, cost: S.escapeCost(skill), reserve: 0 }) };
  const needs = S.createNeeds({ members: () => targeting.positions(), sameTeam: () => true, escapeStage: escape.stage,
    townCasting: () => !!r.townCasting, partyhealAllowed: () => true, isLeader: () => false, partyAttacker: () => null,
    fighting: () => false, lines: () => ({ hp: 50, mp: 20 }), state: () => ({}) });
  const spends = S.createEscapeSpends({ scope, turns: () => turns, margin: () => 0, healFirstBelow: () => 80,
    local: () => escape.owns() ? escape.record() : null, current: () => escape.owns() }, needs);
  escape.adopt({ spends, scareDue: () => false, respawn: async () => undefined, ring() {} });
  if (!fresh) void escape.apply({ id: 'op', stage: 'blink', leader: 'mage', participants: ['mage', 'warrior', 'priest'], ports: ['warrior', 'priest'], walk: [] });
  return { r, casts, told, escape, spends, needs, flush };
}
function escapingWarrior(mp = 1000) {
  const f = runtime(), { r, casts } = f;
  Object.assign(r.character, { name: 'warrior', id: 'w-id', ctype: 'warrior', mp, max_mp: 2000, s: {}, moving: true, direction: 2 });
  r.use_skill = async (skill) => {
    casts.push(skill);
    r.character.mp -= r.escapeCost(skill);
    if (skill === 'hardshell') r.character.s.hardshell = {};
  };
  r.is_on_cooldown = (skill) => skill === 'use_mp';
  return f;
}

module.exports = { runtime, escapingWarrior, flush };
