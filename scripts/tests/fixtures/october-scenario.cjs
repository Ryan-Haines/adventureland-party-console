// The October runtime on one character (runtime/events/october/ports.ts over october-runtime.ts),
// with every port a plain value the row sets (a shared
// setup lives in the harness). The round is a Witch's Cipher board whose gathering ends at
// `gatherEnd`; the plan's owner is the warrior, and `plan: false` leaves the owner to choose it.
const { installEventOctober } = require('../../../runtime/events/october/ports.ts');

const INGREDIENTS = [['verdantspore', ['goo']], ['frostscale', ['arcticbee']], ['embercoal', ['plantoid']], ['gloomfeather', ['snake']]];

// `name` is this character; `merchant` the party's Cipher merchant; `items` this character's bag.
// `liveStock` is the party's stock after the plan was chosen; the plan keeps the stock it was chosen from.
function octoberScenario(over = {}) {
  const t = { name: 'W', ctype: 'warrior', merchant: 'M', now: 1000, gatherEnd: 1000000, end: 2000000, plan: true, items: [], freeSlots: 10, leads: null,
    mode: 'brewing', minClues: 1, runnerHolds: false, bagErrand: false, inventoryCommand: false, merchantAt: 100, rip: false, ...over };
  const sends = [], walks = [], saved = {};
  const character = () => ({ name: t.name, ctype: t.ctype, rip: t.rip, map: 'halloween', real_x: 0, real_y: 0, items: t.items, trickortreat: t.doors ?? null });
  const board = () => ({ live: true, id: 'r1', gather_end: t.gatherEnd, end: t.end, board: t.board ?? [], mixes: t.mixes ?? 0 });
  const stock = { verdantspore: 2, frostscale: 1, embercoal: 3, gloomfeather: 2 };
  const october = installEventOctober({
    now: () => t.now, feed: () => ({ witchcipher: board(), halloween: t.halloween ?? true }), realm: () => 'US I', character,
    cipherMerchant: () => t.merchant, settings: () => ({ witchcipher: { cipher: { automatic: true, minClues: t.minClues } } }),
    gathering: () => ({ owner: 'W', round: 'r1', ready: true, stock: t.liveStock ?? stock, ...(t.fetching ? { fetching: true } : {}),
      ...(t.plan ? { plan: { round: 'r1', realm: 'US I', owner: 'W', mode: t.mode, reason: 'initial stock', stock, selectedAt: 1 } } : {}) }),
    game: () => ({ events: { witchcipher: { ingredients: INGREDIENTS }, trickortreat: { doors: [['halloween', 10, 10]], knocks: 1 } },
      // The Cipher's monster walk asks the hunting owner's spawn catalog for the type's first spawn.
      monsters: { arcticbee: { name: 'Arctic Bee' } },
      maps: { halloween: { npcs: [{ id: 'witch', position: [500, 600] }] }, winterland: { name: 'Winterland', monsters: [{ type: 'arcticbee', count: 4, boundary: [10, 20, 110, 220] }] } } }),
    load: key => saved[key] ?? null, save: (key, value) => { saved[key] = value; },
    walk: async (point) => { walks.push(point); },
    walkAlone: async (point) => { walks.push({ ...point, alone: true }); },
    knock: async () => ({}), info: async () => ({ mixes_left: 3 }), brew: async () => ({}),
    current: () => true, selected: name => name === 'witchcipher', runnerHolds: () => t.runnerHolds, bagErrand: () => t.bagErrand, inventoryCommand: () => t.inventoryCommand,
    player: name => (name === t.merchant ? { rip: false } : null), distance: () => t.merchantAt,
    send: async (to, slot, count) => { sends.push([to, slot, count]); await t.sendWait?.(); },
    freeSlots: () => t.freeSlots, leads: () => t.leads,
  });
  return { runtime: october(), t, sends, walks };
}

module.exports = { octoberScenario };
