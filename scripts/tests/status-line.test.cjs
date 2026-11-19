// Table L, the card line. Each row plants one state, or two that overlap, and reads the line
// runtime/status/coordinator/line.ts derives. The overlaps are planted owner answers, so they share no
// live run: a live party holds one of them at a time.
const test = require('node:test'), assert = require('node:assert/strict');
const { createCardLines } = require('../../runtime/status/coordinator/line.ts');

// One character's state, every owner's answer empty unless the row plants it.
function lineOf(plant = {}) {
  const state = { statuses: { W: { seenAt: 1, ctype: 'warrior', map: 'main', ...plant.status } }, targetMode: 'farming', combatMode: 'auto',
    leader: 'W', followers: {}, monsterFocus: ['goo'], monsterFocusByCharacter: {}, merchantCharacter: plant.merchant ?? null, ...plant.state };
  const ports = {
    assignment: () => plant.assignment ?? { kind: 'farming', owner: 'farming', tier: 'farming', reunion: 'none' },
    monsterName: key => ({ goo: 'Goo', bee: 'Bee' })[key],
    groupLine: () => plant.group ?? null,
    lifecycle: () => plant.lifecycle ?? { paused: false, drain: null },
    hunt: () => plant.hunt,
    merchantJob: () => !!plant.merchantJob,
    escaping: () => plant.escape,
    recovery: () => plant.recovery,
    cave: () => plant.cave ?? { members: [], travel: null },
    entryLabel: (slot, mode) => slot === 'target-mode' ? { farming: 'Farming', hunt: 'Hunt' }[mode] : { auto: 'Auto', scatter: 'Scatter' }[mode],
  };
  return createCardLines(state, ports)('W');
}
const escape = { id: 'e1', stage: 'blink', label: 'Escaping - Blink', climbs: false };
const click = { walking: true, label: 'Your click' };
const banking = { banking: true, map: 'bank' };
const needsYou = { group: 'party', phase: 'hold', label: 'W: no potions - needs your action', since: 1, reasons: [{ kind: 'hold:10', label: 'W: no potions', since: 1, needsAction: true }] };

// and: one row per table L row, with today's words (activity.ts's strings).
const rows = [
  ['L1 escape', { escape }, 'Escaping - Blink'],
  ['L1 own death', { status: { rip: true } }, 'Dead - waiting to respawn'],
  ['L2 click walking', { status: { movementClick: click } }, 'Your click'],
  ['L2 click countdown', { status: { movementClick: { walking: false, label: 'Your click - taking over in 3 s' } } }, 'Your click - taking over in 3 s'],
  ['L3 climber', { status: { movementClimb: { activity: 'Regrouping after escape', trying: 'smart_move' } } }, 'Regrouping after escape - smart_move'],
  ['L4 Cave travel repair', { cave: { members: ['W'], travel: 'Cave travel - W did not arrive - trying Town' } }, 'Cave travel - W did not arrive - trying Town'],
  ['L5 Pause', { lifecycle: { paused: true, drain: null } }, 'Paused'],
  ['L6 needs your action', { group: needsYou }, 'W: no potions - needs your action'],
  ['L7 merchant idle', { merchant: 'W' }, 'Merchant - waiting for the next job'],
  ['L8 character travel', { status: { movementLive: { kind: 'manual', owner: 'travel', tier: 'manual', journey: true, label: 'Character travel - Travelling to the chosen spot' } } },
    'Character travel - Travelling to the chosen spot'],
  ['L8 Town cast', { status: { movementLive: { kind: 'town', owner: 'town', tier: 'town', journey: false, label: 'Casting Town' } } }, 'Casting Town'],
  ['L9 farming', {}, 'Farming (Auto): Fighting Goo'],
  // The card names the focus the hunting owner's farming reply sends, so a follower with its own
  // saved focus reads the party's.
  ['L9 a follower reads the party focus', { state: { leader: 'L', followers: { W: true }, monsterFocusByCharacter: { W: ['bee'] } } }, 'Farming (Auto): Fighting Goo'],
  ['L9 idle with no farm', { assignment: { kind: 'idle', owner: 'idle', tier: 'idle', reunion: 'none' }, state: { monsterFocus: [] } }, 'Idle - no farm set'],
  // An add-on's task reads as the label it asked with, which the group line carries.
  ['L9 an add-on task', { assignment: { kind: 'addon:fixture', owner: 'addon:fixture:1', tier: 'addon-task', reunion: 'alone' },
    group: { group: 'party', phase: 'addon:fixture:walk', label: 'Fixture task', since: 1, reasons: [] } }, 'Fixture task'],
];
for (const [name, plant, words] of rows) test(`table L ${name} reads today's words`, () => {
  assert.equal(lineOf(plant)?.text, words);
});

// The order between rows that overlap.
const overlaps = [
  ['an escape over the click', { escape, status: { movementClick: click } }, 'Escaping - Blink'],
  ['the click over the character travel it paused', { status: { movementClick: click, movementLive: { kind: 'manual', owner: 'travel', tier: 'manual', journey: true, paused: true, label: 'Character travel - Travelling to the chosen spot' } } }, 'Your click'],
  ['the Pause over a needs-action reason', { lifecycle: { paused: true, drain: null }, group: needsYou }, 'Paused'],
  ['a needs-action reason over the request that holds the character', { group: needsYou, status: { movementLive: { kind: 'town', owner: 'town', tier: 'town', journey: false, label: 'Casting Town' } } },
    'W: no potions - needs your action'],
  ['the holder over the group task', { status: { movementLive: { kind: 'town', owner: 'town', tier: 'town', journey: false, label: 'Casting Town' } } }, 'Casting Town'],
  ['own death over a needs-action reason', { status: { rip: true }, group: needsYou }, 'Dead - waiting to respawn'],
];
for (const [name, plant, words] of overlaps) test(`table L orders ${name}`, () => {
  assert.equal(lineOf(plant)?.text, words);
});

// The items owner's bag facts with no live request, and the merchant's own
// rows.
const trips = [
  ['banking at the bank', { status: banking }, 'Banking'],
  ['stocking up at the bank', { status: { stocking: true, map: 'bank' } }, 'Stocking up'],
  ['a bank trip away from the bank', { status: { banking: true, map: 'main' } }, 'Travelling to bank'],
  ['the merchant banking with no job', { merchant: 'W', status: { banking: true, map: 'bank' } }, 'Banking'],
  ['the merchant running a job reads its group line', { merchant: 'W', merchantJob: true,
    group: { group: 'merchant', phase: 'merchant-job:job', label: 'Merchant job - Party collection - taking items from the bank', since: 1, reasons: [] } },
    'Merchant job - Party collection - taking items from the bank'],
];
for (const [name, plant, words] of trips) test(`table L keeps ${name}`, () => {
  assert.equal(lineOf(plant)?.text, words);
});

// A combat group with no leader holds no task once its source answers nothing, so its card drops
// the mode task on that tick and reads the focus fight with no mode words.
test('a leaderless combat group with no task drops its mode task at once', () => {
  const state = { statuses: { W: { seenAt: 1, ctype: 'warrior', map: 'main' } }, targetMode: 'farming', combatMode: 'auto', monsterFocus: ['goo'],
    leader: null, followers: {}, monsterFocusByCharacter: {} };
  const ports = { assignment: () => null, monsterName: key => ({ goo: 'Goo' })[key], groupLine: () => null,
    lifecycle: () => ({ paused: false, drain: null }), hunt: () => undefined, merchantJob: () => false, escaping: () => undefined,
    recovery: () => undefined, cave: () => ({ members: [], travel: null }),
    entryLabel: (slot, mode) => slot === 'target-mode' ? { farming: 'Farming' }[mode] : { auto: 'Auto' }[mode] };
  assert.equal(createCardLines(state, ports)('W')?.text, 'Fighting Goo');
});

// On the card: an app key's party walk ranks at `app` under L8 and names the app.
test("table L L8 an app key's party travel names the app", () => {
  const walk = { id: 'c1', participants: ['W'], phase: 'travel', purpose: null, label: 'bees', location: { map: 'main', x: 0, y: 0, label: 'bees' },
    requester: { tier: 'app', by: 'app:Spreadsheet' } };
  assert.equal(lineOf({ state: { activeConvoy: walk } })?.text, 'Party travel by Spreadsheet - Travelling to bees');
});
