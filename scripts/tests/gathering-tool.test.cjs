// The tool look is the hands owner's (runtime/merchant-hands/character/owner.ts): the rows run it
// over its ports, with the replacement-craft opt-in (`gatheringAutoCraft`) as its `crafts` port.
const test = require('node:test'), assert = require('node:assert/strict');
const { createMerchantHands } = require('../../runtime/merchant-hands/character/owner.ts');
const { partyHooks } = require('../../runtime/hooks/index.ts');
// The items owner's bank look (items.fetch, items/character/bank.ts `fetch`) over the newest
// fixture's ports, as gathering-equipment-restore.test.cjs registers it.
let banked = null;
if (!partyHooks().map().registrations.some(r => r.name === 'core:tool-fetch-fixture'))
  partyHooks().register({ name: 'core:tool-fetch-fixture', folder: 'core', author: 'test', summary: 'test',
    hooks: { 'items.fetch': async (_character, name) => { await banked.walkToBank(); await banked.retrieve(name); return true; } } });
function hands({ carried = false, bank = false, cancel = false, autoCraft = {}, order = { jobId: 'craft-1' } } = {}) {
  const calls = [], character = { name: 'GoldMajesty', items: carried ? [{ name: 'rod' }] : [], slots: {} };
  let current = true;
  const ports = banked = { root: () => ({}), character: () => character, current: () => true, sleep: async () => {},
    request: async (_url, args) => { calls.push(args.body); return order; }, intent: () => null, listings: () => [],
    sameItem: (a, b) => !!a && !!b && a.name === b.name, findItem: () => -1, fingerprint: item => item, count: name => character.items.filter(item => item.name === name).length,
    status() {}, report: body => calls.push(body), baseline: () => ['baseline'], crafts: mode => autoCraft[mode] === true, holdForOrder: (jobId, tool) => calls.push(['hold', jobId, tool]),
    walkToBank: async () => { calls.push('bank'); character.bank ||= {}; if (cancel) current = false; },
    retrieve: async name => { if (bank || Object.values(character.bank || {}).some(pack => pack.some(item => item.name === name))) character.items.push({ name }); } };
  const owner = createMerchantHands(ports);
  return { owner, calls, character, current: () => current, session: { tool: 'rod', mode: 'fishing' } };
}
test('carried tool requires no bank visit', async () => {
  const r = hands({ carried: true });
  assert.equal(await r.owner.ensureGatheringTool(r.session, r.current), true);
  assert.deepEqual(r.calls, []);
});
test('missing tool is retrieved from bank and included in gathering baseline', async () => {
  const r = hands({ bank: true });
  assert.equal(await r.owner.ensureGatheringTool(r.session, r.current), true);
  assert.deepEqual(r.session.baseline, ['baseline']);
  assert.deepEqual(r.calls, ['bank']);
});
// A missing tool leaves the mode on. The look reports no tool once and walks to the bank
// again only when the bag or the bank changes; a tool that appears there is picked up and reported
// found. With `gatheringAutoCraft` on for the mode, a replacement is ordered and no tool report goes out.
test('absent tool leaves the mode on and reports no tool once; a bank change finds it, and the craft opt-in orders one', async () => {
  const r = hands();
  assert.equal(await r.owner.ensureGatheringTool(r.session, r.current), false);
  assert.deepEqual(r.calls, ['bank', { mode: 'fishing', noTool: true, message: 'Fishing waiting: no tool in inventory or bank', level: 'info' }]);
  assert.equal(await r.owner.ensureGatheringTool(r.session, r.current), false);
  assert.equal(r.calls.length, 2, 'no second walk or report while nothing changed');
  r.character.bank = { items0: [{ name: 'rod' }] };
  assert.equal(await r.owner.ensureGatheringTool(r.session, r.current), true);
  assert.deepEqual(r.calls.slice(2), ['bank', { mode: 'fishing', toolFound: true, message: 'Fishing tool found', level: 'info' }]);
  const crafting = hands({ autoCraft: { fishing: true } });
  assert.equal(await crafting.owner.ensureGatheringTool(crafting.session, crafting.current), false);
  // I-12: gathering holds on the order's job, not a fixed 5 s.
  assert.deepEqual(crafting.calls.slice(1), [{ buys: [], crafts: [{ id: 'rod', quantity: 1, level: 0 }] }, ['hold', 'craft-1', 'rod']]);
  // A refused order names no job: no hold, and the tool stays recorded missing, so the next pass
  // orders nothing until the bag or the bank changes.
  const refused = hands({ autoCraft: { fishing: true }, order: { error: 'refused' } });
  assert.equal(await refused.owner.ensureGatheringTool(refused.session, refused.current), false);
  assert.equal(await refused.owner.ensureGatheringTool(refused.session, refused.current), false);
  assert.deepEqual(refused.calls.slice(1), [{ buys: [], crafts: [{ id: 'rod', quantity: 1, level: 0 }] }]);
});
test('cancelled check does not disable a newer gathering session', async () => {
  const r = hands({ cancel: true });
  assert.equal(await r.owner.ensureGatheringTool(r.session, r.current), false);
  assert.deepEqual(r.calls, ['bank']);
});

// Separate: the live missing-tool rows, where the opt-in after the no-tool report ordered nothing,
// since the report's record held every later pass, and the coordinator's record was already gone.
test('the craft opt-in after the no-tool report orders, and a refused order waits for new materials', async () => {
  const autoCraft = {}, r = hands({ autoCraft, order: { error: 'crafting materials are no longer available' } });
  assert.equal(await r.owner.ensureGatheringTool(r.session, r.current), false);
  assert.equal(r.calls.filter(call => call.noTool).length, 1);
  autoCraft.fishing = true;
  assert.equal(await r.owner.ensureGatheringTool(r.session, r.current), false);
  assert.equal(await r.owner.ensureGatheringTool(r.session, r.current), false);
  const orders = () => r.calls.filter(call => call && Array.isArray(call.crafts));
  assert.equal(orders().length, 1, 'one order until the bag or the bank changes');
  r.character.items.push({ name: 'spidersilk', q: 1 });
  assert.equal(await r.owner.ensureGatheringTool(r.session, r.current), false);
  assert.equal(orders().length, 2);
  assert.equal(r.calls.filter(call => call.noTool).length, 1, 'the report still goes once');
});
