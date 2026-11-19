// The add-on doors and reads of three owners:
// each door keeps its bound, and each READS row answers from its owner's door.
const test = require('node:test'), assert = require('node:assert/strict');

// The game globals a character door reads, set for one test and put back after it.
function withGame(globals, run) {
  const saved = Object.fromEntries(Object.keys(globals).map(key => [key, globalThis[key]]));
  Object.assign(globalThis, globals);
  return Promise.resolve().then(run).finally(() => Object.assign(globalThis, saved));
}
// The character's calls files install the doors, as the character's load does.
const character = { items: '../../runtime/items/character/calls.ts', events: '../../runtime/events/character/calls.ts' };
// The run scope handle the items owner's calls wait on, as item-operations.test.cjs sets it.
const handle = { once: (target, event, listener) => target.once(event, listener), sleep: ms => new Promise(resolve => setTimeout(resolve, ms)), setTimeout: (callback, ms) => setTimeout(callback, ms), clearTimeout: id => clearTimeout(id) };
const runScope = { __partyRunScope: { scope: () => handle } };
// What the dispatcher hands a door beside the args (registry.ts `DoorAsk`).
const ask = (band, facts) => ({ id: 't1', action: 'test', band, addon: 'a', character: 'C', reason: 'test', ...(facts ? { facts } : {}) });
const budget = (answer = 'send') => ({ calls: { band: () => answer, wait: async () => {}, window: () => 1, margin: () => 5 } });

test('items.grade: the grade from G on the character and from the published catalog on the coordinator', () =>
  withGame({ G: { items: { blade: { upgrade: {}, grades: [3, 6, 9, 12] } } } }, () => {
    const { itemGradeOf, publishItemData } = require('../../runtime/items/api.ts');
    assert.equal(itemGradeOf('blade', 7), 2);
    assert.equal(itemGradeOf('nothing', 7), null);
    globalThis.G = undefined;
    publishItemData(name => name === 'ring' ? { compound: {}, grades: [2, 4, 6, 8] } : undefined);
    assert.equal(itemGradeOf('ring', 4), 2);
    assert.equal(itemGradeOf('blade', 7), null);
  }));

test("npc.stock: the item names an NPC sells, and none for one that sells nothing", () =>
  withGame({ G: { npcs: { ron: { items: ['hpot0', null, 'mpot0'] }, pete: {} } } }, () => {
    const { npcStock } = require('../../runtime/items/api.ts');
    assert.deepEqual(npcStock('ron'), ['hpot0', 'mpot0']);
    assert.deepEqual(npcStock('pete'), []);
  }));

test('market.listings: wts is the sell offers and wtb the buy orders', () =>
  withGame({ __partyMarketReads: { ponty: () => [{ item: { name: 'a' } }], listings: () => [{ item: { name: 'a' } }, { item: { name: 'b' }, buyer: 'x' }] } }, () => {
    const { marketListings, marketPonty } = require('../../runtime/items/coordinator/api.ts');
    assert.deepEqual(marketListings('wts').map(l => l.item.name), ['a']);
    assert.deepEqual(marketListings('wtb').map(l => l.item.name), ['b']);
    assert.equal(marketPonty().length, 1);
  }));

test('item.wearLook: a look the character owns is sent; another look and a refused band are refused', () => {
  const sent = [];
  return withGame({ __partyHooks: budget(), parent: runScope, character: { gold: 0, items: [], acx: { tophat: 1 } },
    equip_cx: (slot, name) => { sent.push([slot, name]); return Promise.resolve({ success: true }); } }, async () => {
    require(character.items);
    const { wearLook } = require('../../runtime/items/api.ts');
    assert.equal((await wearLook({ slot: 'hat', name: 'tophat' }, ask('background'))).outcome, 'sent');
    assert.match((await wearLook({ slot: 'hat', name: 'crown' }, ask('background'))).reason, /not a look this character owns/);
    globalThis.__partyHooks = budget('wait');
    assert.match((await wearLook({ slot: 'hat', name: 'tophat' }, ask('background'))).reason, /call budget refused/);
    assert.deepEqual(sent, [['hat', 'tophat']]);
  });
});

// The priest in the warrior's frame: the game's loot(id) reads parent.parent, the warrior's game.
test("item.openChest: the chest opens on the character's own socket, not its commander's", () => {
  const own = [], commander = [];
  const open = list => id => { list.push(id); return Promise.resolve({ success: true }); };
  return withGame({ __partyHooks: budget(), parent: { ...runScope, open_chest: open(own), parent: { open_chest: open(commander) } },
    character: { gold: 0, items: [] }, loot: id => globalThis.parent.parent.open_chest(id) }, async () => {
    require(character.items);
    const { openChest } = require('../../runtime/items/api.ts');
    assert.equal((await openChest({ chest: 'c1' }, ask('job'))).outcome, 'sent');
    assert.deepEqual({ own, commander }, { own: ['c1'], commander: [] });
  });
});

test("gold.donate: refused with no coordinator facts and below the working gold; sent above it", () => {
  const sent = [];
  return withGame({ __partyHooks: budget(), parent: runScope, character: { gold: 900, items: [] },
    donate_gold: gold => { sent.push(gold); return Promise.resolve({ success: true }); } }, async () => {
    require(character.items);
    const { donate } = require('../../runtime/items/api.ts');
    assert.match((await donate({ gold: 100 }, ask('background'))).reason, /working gold is not known/);
    assert.match((await donate({ gold: 600 }, ask('background', { floor: 500 }))).reason, /less than the working gold/);
    assert.equal((await donate({ gold: 400 }, ask('background', { floor: 500 }))).outcome, 'sent');
    assert.deepEqual(sent, [400]);
  });
});

test("gold.send and item.send: any recipient, gold above the working gold, and no copy another fate holds", () => {
  const sent = [];
  return withGame({ __partyHooks: budget(), parent: runScope, character: { gold: 900, items: [{ name: 'hpot0', q: 5 }, { name: 'ring' }] },
    send_gold: (to, gold) => { sent.push(['gold', to, gold]); return Promise.resolve({}); },
    send_item: (to, slot, q) => { sent.push(['item', to, slot, q]); return Promise.resolve({}); } }, async () => {
    require(character.items);
    const { sendGold, sendItem } = require('../../runtime/items/api.ts');
    assert.match((await sendGold({ to: 'Stranger', gold: 10 }, ask('background'))).reason, /working gold is not known/);
    assert.match((await sendGold({ to: 'Stranger', gold: 600 }, ask('background', { floor: 500 }))).reason, /less than the working gold/);
    assert.equal((await sendGold({ to: 'Stranger', gold: 10 }, ask('background', { floor: 500 }))).outcome, 'sent');
    assert.match((await sendItem({ to: 'Stranger', slot: 0 }, ask('background'))).reason, /fates are not known/);
    assert.match((await sendItem({ to: 'Stranger', slot: 1 }, ask('background', { held: [1] }))).reason, /another fate holds/);
    assert.equal((await sendItem({ to: 'Stranger', slot: 0, quantity: 2 }, ask('background', { held: [1] }))).outcome, 'sent');
    assert.deepEqual(sent, [['gold', 'Stranger', 10], ['item', 'Stranger', 0, 2]]);
  });
});

test('the per-function item doors: a held copy, a spend below the working gold and bad args refuse; the rest are sent', () => {
  const sent = [];
  const record = name => (...args) => { sent.push([name, ...args.filter(a => typeof a !== 'function')]); return Promise.resolve({ success: true }); };
  return withGame({ __partyHooks: budget(), parent: runScope, character: { gold: 1200, items: [{ name: 'hpot0', q: 5 }, { name: 'ring' }, null] },
    G: { items: { hpot0: { g: 20 } }, craft: { elixir: { items: [[1, 'ring']], cost: 0 } } },
    sell: record('sell'), buy: record('buy'), swap: record('swap'), send_mail: record('mail'), auto_craft: record('craft') }, async () => {
    require(character.items);
    const doors = require('../../runtime/items/api.ts');
    const facts = { floor: 500, held: [1] };
    assert.match((await doors.sell({ slot: 1 }, ask('background', facts))).reason, /another fate holds/);
    assert.equal((await doors.sell({ slot: 0, quantity: 2 }, ask('background', facts))).outcome, 'sent');
    assert.match((await doors.buy({ name: 'hpot0', quantity: 40 }, ask('background', facts))).reason, /less than the working gold/);
    assert.equal((await doors.buy({ name: 'hpot0', quantity: 2 }, ask('background', facts))).outcome, 'sent');
    assert.match((await doors.move({ from: 0, to: 9 }, ask('background', facts))).reason, /needs bag slots/);
    assert.equal((await doors.move({ from: 0, to: 2 }, ask('background', facts))).outcome, 'sent');
    assert.match((await doors.craft({ name: 'elixir' }, ask('background', facts))).reason, /holds a copy this call takes/);
    assert.match((await doors.sendMail({ to: 'Anyone', subject: 'hi' }, ask('background', facts))).reason, /less than the working gold/);
    assert.deepEqual(sent, [['sell', 0, 2], ['buy', 'hpot0', 2], ['swap', 0, 2]]);
  });
});

// Ron's buy prices a lot at four times its value per copy, as the game's lost-and-found dialog does.
test("npc.stock and npc.lostAndFoundList: Ron's list after a donation; npc.lostAndFoundBuy pays only a listed lot's price above the working gold", () => {
  const listeners = {}, bought = [];
  const socket = { emit: () => listeners.lostandfound?.([{ rid: 's1', name: 'staff', level: 7 }, { rid: 'r1', name: 'ring', q: 2 }, { nope: 1 }]),
    once: (event, listener) => { listeners[event] = listener; } };
  return withGame({ __partyHooks: budget(), parent: { ...runScope, socket }, character: { gold: 10_000, items: [] },
    item_value: item => item.name === 'staff' ? 2_000 : 500, buy_lost_and_found: async (rid, timeout) => { bought.push([rid, timeout]); return { success: true }; } }, async () => {
    require(character.items);
    const { lostAndFound, lostAndFoundList, buyLostAndFound, npcStock } = require('../../runtime/items/api.ts');
    assert.deepEqual(npcStock('lostandfound'), []);
    assert.equal((await lostAndFound({}, ask('background'))).outcome, 'sent');
    assert.deepEqual(npcStock('lostandfound'), ['staff', 'ring']);
    assert.deepEqual(lostAndFoundList(), [{ rid: 's1', name: 'staff', level: 7, quantity: 1, price: 8_000 }, { rid: 'r1', name: 'ring', level: null, quantity: 2, price: 4_000 }]);
    assert.match((await buyLostAndFound({ rid: 'x' }, ask('job', { floor: 0 }))).reason, /no lot with that id/);
    assert.match((await buyLostAndFound({ rid: 's1' }, ask('job', { floor: 5_000 }))).reason, /less than the working gold/);
    assert.match((await buyLostAndFound({ rid: 'r1' }, ask('job'))).reason, /working gold is not known/);
    assert.equal((await buyLostAndFound({ rid: 'r1' }, ask('job', { floor: 5_000 }))).outcome, 'sent');
    assert.deepEqual(bought, [['r1', 10]]);
    assert.deepEqual(lostAndFoundList().map(lot => lot.rid), ['s1'], 'a bought lot leaves the list');
  });
});

test('chat.say: public chat, party chat and a whisper to any player are sent', () => {
  const said = [];
  return withGame({ __partyHooks: budget(), say: m => said.push(['say', m]), party_say: m => said.push(['party', m]),
    parent: { private_say: (name, m) => said.push(['whisper', name, m]) } }, async () => {
    require(character.events);
    const { chatSay } = require('../../runtime/events/api.ts');
    assert.equal((await chatSay({ message: 'hi' }, ask('background'))).outcome, 'sent');
    assert.equal((await chatSay({ message: 'team', party: true }, ask('background'))).outcome, 'sent');
    assert.equal((await chatSay({ message: 'psst', name: 'Other' }, ask('background'))).outcome, 'sent');
    assert.match((await chatSay({ message: 'psst', name: '' }, ask('background'))).reason, /needs a player name/);
    assert.deepEqual(said, [['say', 'hi'], ['party', 'team'], ['whisper', 'Other', 'psst']]);
  });
});

test("the L3 rows: every hook row names its side, and every offered action's door is its owner's export", () => {
  const owners = { '06-events': '../../runtime/events/api.ts', '07-hunting': '../../runtime/hunting/api.ts', '10-items': '../../runtime/items/api.ts' };
  for (const [file, door] of Object.entries(owners)) {
    const rows = require(`../../runtime/hooks/rows/${file}.ts`), api = require(door);
    for (const [name, row] of Object.entries(rows.HOOKS)) assert.ok(['character', 'coordinator', 'both'].includes(row.side), `${file} ${name} has no side`);
    const coordinator = require(door.replace('/api.ts', '/coordinator/api.ts'));
    for (const [name, row] of Object.entries(rows.ACTIONS ?? {})) {
      if ('closed' in row) { assert.ok(row.cite, `${name} closes with no cite`); continue; }
      assert.equal(typeof (api[row.door] ?? coordinator[row.door]), 'function', `${name}'s door ${row.door} is not exported by ${door}`);
    }
    for (const [name, row] of Object.entries(rows.READS ?? {})) {
      const [path, exported] = row.door.split('#');
      assert.notEqual(require(`../../${path}`)[exported], undefined, `${name}'s door ${row.door} is not exported`);
    }
  }
});

test("event.join: refused with no K4 answer, a refused admission or an event the game does not join; sent when K4 admits it", () => {
  const joined = [];
  return withGame({ __partyHooks: budget(), G: { events: { goobrawl: { join: true }, franky: {} } }, join: event => { joined.push(event); return Promise.resolve({}); } }, async () => {
    require(character.events);
    const { eventJoin } = require('../../runtime/events/api.ts');
    assert.match((await eventJoin({ event: 'goobrawl' }, ask('background'))).reason, /admission is not known/);
    assert.match((await eventJoin({ event: 'goobrawl' }, ask('background', { admitted: false }))).reason, /admission refuses/);
    assert.match((await eventJoin({ event: 'franky' }, ask('background', { admitted: true }))).reason, /an event the game joins/);
    assert.equal((await eventJoin({ event: 'goobrawl' }, ask('background', { admitted: true }))).outcome, 'sent');
    assert.deepEqual(joined, ['goobrawl']);
  });
});

test('hunt.take: refused while the core Hunt holds the group or with no facts; sent otherwise', () => {
  const asked = [];
  return withGame({ __partyHooks: budget(), interact: name => { asked.push(name); return Promise.resolve({}); } }, async () => {
    const { huntTake } = require('../../runtime/hunting/api.ts');
    assert.match((await huntTake({}, ask('background'))).reason, /Hunt cycle is not known/);
    assert.match((await huntTake({}, ask('background', { held: true }))).reason, /core Hunt holds/);
    assert.equal((await huntTake({}, ask('background', { held: false }))).outcome, 'sent');
    assert.deepEqual(asked, ['monsterhunt']);
  });
});

test("dungeon.enter: the Cave's enter action refuses a run in progress, a member other than the leader and another key", () => {
  const { createCave } = require('../../runtime/hunting/coordinator/cave.ts');
  const { dungeonEnter } = require('../../runtime/hunting/coordinator/api.ts');
  const party = { leader: 'W', followers: { P: true }, merchantCharacter: 'Bank', statuses: {}, bankbois: {},
    dailyDungeons: { protectFromEvents: true, participants: ['W', 'P'], phase: 'active', run: 'run-1', server: 'II', commands: {}, operations: [] } };
  createCave(party, { now: () => 1, persist() {}, cancel() {}, online: () => true, offline: () => false });
  const ask = { addon: 'fixture', character: 'W', id: '1' };
  assert.match(dungeonEnter({ key: 'crypt' }, ask).reason, /Cave only/);
  assert.match(dungeonEnter({ key: 'cave' }, { ...ask, character: 'P' }).reason, /party leader/);
  assert.match(dungeonEnter({ key: 'cave' }, ask).reason, /already owns the party/);
});

// The completeness rule for those three owners: every value export of
// an owner's doors is in its READS, its DOOR_ONLY or an ACTIONS row, and every PLAIN read is a READS row.
test('the L3 doors: every export is a read, a door-only entry or an action', () => {
  const owners = { '06-events': 'events', '07-hunting': 'hunting', '10-items': 'items' };
  for (const [file, area] of Object.entries(owners)) {
    const rows = require(`../../runtime/hooks/rows/${file}.ts`);
    const covered = new Set([...Object.values(rows.READS).map(row => row.door.split('#')[1]), ...Object.keys(rows.DOOR_ONLY).map(key => key.split('#')[1]),
      ...Object.values(rows.ACTIONS).flatMap(row => row.door ? [row.door] : [])]);
    for (const door of [`runtime/${area}/api.ts`, `runtime/${area}/coordinator/api.ts`])
      for (const name of Object.keys(require(`../../${door}`))) assert.ok(covered.has(name), `${door} ${name} is in none of ${file}'s READS, DOOR_ONLY or ACTIONS`);
    const reads = new Set(Object.values(rows.READS).map(row => row.door.split('#')[1]));
    for (const [name, kind] of Object.entries(rows.PLAIN)) if (kind === 'read') assert.ok(reads.has(name), `${file} PLAIN read ${name} has no READS row`);
  }
});
