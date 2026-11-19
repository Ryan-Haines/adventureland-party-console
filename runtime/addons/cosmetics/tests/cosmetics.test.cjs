// Isolated checks for the cosmetics report (runtime/addons/cosmetics/report.ts), the panel rows
// the card draws from it (panel.ts) and the presses the panel sends (commands.ts, index.ts). The
// report reads the character object the game hands each status, which no live scenario can set to a
// chosen wardrobe, so the rows below fix one. The presses run against a recording `act`, since the
// action queue and the owners' doors are the console's own and carry their own fixtures.
//
// Failure list, written before the code:
// F1 a character with no cx, acx or items (a fresh login) throws instead of reporting empty lists
// F2 an empty cosmetic slot ('' or null) shows as a worn look
// F3 a look the character sent away (acx count 0) still shows as owned
// F4 a worn look is not marked worn in the owned list
// F5 a bag cell that is empty or holds another item shows as a CX jar
// F6 a CX jar with no look inside breaks the report
// F7 an emote the character does not own, or a skill that is no emote, shows as an emote
// F8 the lists come back in the game's key order, so the card reorders between reports
// F9 the card draws a report of the wrong shape (an older report, or none) instead of the empty line
// F10 the registration answers a hook the console does not let an add-on answer
// F11 an owned look the panel offers to put on carries no slot, or the wrong one, so equip_cx misfiles it
// F12 a targeted emote gets a play button, though the emote action sends no target
// F13 a press with a broken body, or no character, reaches the action queue
// F14 a press asks the wrong action or args: put on and take off go to item.wearLook, an emote to emote
// F15 an outcome for a replaced press overwrites the newest press's line, or a settled press stays pending
const test = require('node:test');
const assert = require('node:assert/strict');
const { cosmeticsReport } = require('../report.ts');
const { lastLine, panelRows } = require('../panel.ts');
const { commandAsk } = require('../commands.ts');
const { registration } = require('../index.ts');

const G = { skills: {
  wave: { name: 'Wave', emote: 'wave' },
  kiss: { name: 'Kiss', emote: 'ikissyou', target: true },
  dance: { name: 'Dance', emote: 'dance' },
  attack: { name: 'Attack' },
}, sprites: {
  hats: { type: 'hat', matrix: [['bwhat', ''], ['tophat']] },
  heads: { type: 'head', matrix: [['slimehead0']] },
  hairs: { type: 'hair', matrix: [['hairdo600']] },
  odd: { type: 'animation', matrix: [['halo']] },
} };
const view = (character) => ({ character: { name: 'W', ctype: 'warrior', ...character }, entities: {}, G, now: 0 });

test('F1: a character with no wardrobe fields reports empty lists', () => {
  assert.deepEqual(cosmeticsReport(view({})), { worn: {}, owned: [], jars: [], emotes: [] });
  assert.equal(cosmeticsReport({}), undefined, 'no character in the view reports nothing');
});

test('F2, F3, F4: worn slots skip empties, owned looks skip zero counts and mark the worn ones', () => {
  const r = cosmeticsReport(view({ cx: { hat: 'bwhat', head: 'slimehead0', back: '', face: null },
    acx: { slimehead0: 1, bwhat: 2, halo: 0, hairdo600: 1 } }));
  assert.deepEqual(r.worn, { hat: 'bwhat', head: 'slimehead0' });
  assert.deepEqual(r.owned, [
    { name: 'bwhat', count: 2, worn: true, slot: 'hat' },
    { name: 'hairdo600', count: 1, worn: false, slot: 'hair' },
    { name: 'slimehead0', count: 1, worn: true, slot: 'head' },
  ]);
});

test('F5, F6: only CX jars in the bag show, each with its bag cell and the look inside or none', () => {
  const r = cosmeticsReport(view({ items: [null, { name: 'hpot0', q: 5 }, { name: 'cxjar', data: 'hairdo600' }, { name: 'cxjar' }] }));
  assert.deepEqual(r.jars, [{ cell: 2, look: 'hairdo600' }, { cell: 3, look: null }]);
});

test('F7, F8: emotes are the owned emote skills, sorted by name', () => {
  const r = cosmeticsReport(view({ acx: { wave: 1, ikissyou: 1 } }));
  assert.deepEqual(r.emotes, [
    { skill: 'kiss', name: 'Kiss', targeted: true },
    { skill: 'wave', name: 'Wave', targeted: false },
  ]);
});

test('F9: the panel draws the report, and an empty line for no report or a broken one', () => {
  assert.deepEqual(panelRows(undefined), null);
  assert.deepEqual(panelRows({ worn: 'hat' }), null);
  const rows = panelRows({ worn: { hat: 'bwhat' }, owned: [{ name: 'bwhat', count: 2, worn: true, slot: 'hat' }], jars: [{ cell: 2, look: null }],
    emotes: [{ skill: 'wave', name: 'Wave', targeted: false }] });
  assert.deepEqual(rows, {
    worn: [{ slot: 'hat', look: 'bwhat' }],
    owned: [{ name: 'bwhat', label: 'bwhat x2', worn: true, slot: null }],
    jars: [{ cell: 2, label: 'Bag 3: unknown look' }],
    emotes: [{ skill: 'wave', label: 'Wave', playable: true }],
  });
});

test('F10: the registration answers the report, the press and its outcome', () => {
  assert.equal(registration.name, 'cosmetics');
  assert.deepEqual(Object.keys(registration.hooks), ['status.report', 'addon.command', 'addon.acted']);
});

test('F11: an owned look carries the slot its sprite type files it in, and none for a type with no slot', () => {
  const r = cosmeticsReport(view({ acx: { tophat: 1, halo: 1 } }));
  assert.deepEqual(r.owned.map(l => [l.name, l.slot]), [['halo', null], ['tophat', 'hat']]);
  assert.deepEqual(panelRows(r).owned.map(o => [o.name, o.slot]), [['halo', null], ['tophat', 'hat']],
    'only a look with a slot gets a put-on button');
});

test('F12: a targeted emote shows without a play button', () => {
  const rows = panelRows(cosmeticsReport(view({ acx: { wave: 1, ikissyou: 1 } })));
  assert.deepEqual(rows.emotes.map(e => [e.skill, e.playable]), [['kiss', false], ['wave', true]]);
});

// A coordinator context with a recording `act` and a party store.
function coordinator() {
  const asked = [], party = new Map();
  let n = 0;
  const ctx = { side: 'coordinator', scope: 'L', settings: {}, read() {}, outcome() {},
    act(ask) { asked.push(ask); n += 1; return { id: 'cosmetics:' + n }; },
    store: { party: { get: k => party.get(k), set: (k, v) => party.set(k, v), rev: () => 0 } } };
  const command = (body, character = 'W') => registration.hooks['addon.command']({ owner: 'L', character, store: {}, now: 0, body }, {}, ctx);
  const acted = payload => registration.hooks['addon.acted'](payload, {}, ctx);
  return { asked, party, command, acted };
}

test('F13: a broken body or a press with no character is refused before any action', () => {
  const c = coordinator();
  assert.deepEqual(c.command({ wear: { slot: 'hat' } }), { ok: false, status: 400, error: 'wear needs a slot and a look' });
  assert.equal(c.command({ takeOff: {} }).status, 400);
  assert.equal(c.command({ emote: '' }).status, 400);
  assert.equal(c.command({ dance: true }).status, 400);
  assert.equal(c.command({ emote: 'wave' }, null).error, 'a press names its character');
  assert.deepEqual(c.asked, []);
});

test('F14: each press asks its owner action for the named character', () => {
  const c = coordinator();
  assert.deepEqual(c.command({ wear: { slot: 'hat', name: 'tophat' } }), { ok: true, reply: { id: 'cosmetics:1' } });
  c.command({ takeOff: { slot: 'hat' } });
  c.command({ emote: 'wave' });
  assert.deepEqual(c.asked.map(a => [a.action, a.args, a.character]), [
    ['item.wearLook', { slot: 'hat', name: 'tophat' }, 'W'],
    ['item.wearLook', { slot: 'hat' }, 'W'],
    ['emote', { name: 'wave' }, 'W'],
  ]);
  assert.ok(c.asked.every(a => typeof a.reason === 'string' && a.reason));
  assert.equal(commandAsk({ emote: 'wave' }).label, 'Emote wave');
});

test('F15: only the newest press settles the line, and a settled press leaves pending', () => {
  const c = coordinator();
  c.command({ emote: 'wave' });
  c.command({ wear: { slot: 'hat', name: 'tophat' } });
  c.acted({ id: 'cosmetics:1', action: 'emote', character: 'W', addon: 'cosmetics', outcome: 'refused', by: 'queue', reason: 'replaced' });
  assert.equal(c.party.get('last.W'), undefined, 'the replaced press leaves no line');
  c.acted({ id: 'cosmetics:2', action: 'item.wearLook', character: 'W', addon: 'cosmetics', outcome: 'refused', by: 'items',
    reason: 'tophat is not a look this character owns' });
  assert.equal(lastLine(c.party.get('last.W')), 'Put on tophat: refused (items: tophat is not a look this character owns)');
  assert.equal(c.party.get('pending.W'), null);
  c.command({ emote: 'wave' });
  c.acted({ id: 'cosmetics:3', action: 'emote', character: 'W', addon: 'cosmetics', outcome: 'sent' });
  assert.equal(lastLine(c.party.get('last.W')), 'Emote wave: sent');
  assert.equal(lastLine(undefined), null);
});
