const test = require('node:test'), assert = require('node:assert/strict');
const { merchantVisibility } = require('../../runtime/merchant-jobs/coordinator/dispatch.ts');
const fs = require('node:fs'), vm = require('node:vm');
function fixture(reason = 'restock') {
  const status = { seenAt: 10000, server: 'USII', map: 'main', in: 'main', x: 0, y: 0 };
  return { merchantCharacter: 'M', merchantCurrent: { id: 'job', target: 'R', reason },
    commands: { M: { id: 1, jobId: 'job', type: 'merchant-service' } },
    statuses: { M: { ...status, name: 'M' }, R: { ...status, name: 'R', x: 100 } } };
}
test('every active merchant visit can reveal its nearby recipient', () => {
  for (const reason of ['restock', 'marked items', 'gold collection', 'item delivery', 'npc sale pickup', 'inventory cleanout']) {
    assert.equal(merchantVisibility(fixture(reason), 'R', 10000), 'M');
  }
});
test('queued, replaced, distant, stale, dead and cross-instance visits cannot reveal recipients', () => {
  for (const change of [s => s.merchantCurrent = null, s => s.commands.M.jobId = 'new',
    s => s.statuses.M.x = 500, s => s.statuses.M.seenAt = 1, s => s.statuses.R.rip = true,
    s => s.statuses.M.server = 'EUI', s => s.statuses.M.map = 'bank', s => s.statuses.M.in = 'other']) {
    const state = fixture(); change(state); assert.equal(merchantVisibility(state, 'R', 10000), null);
  }
  assert.equal(merchantVisibility(fixture(), 'M', 10000), null);
  assert.equal(merchantVisibility(fixture(), 'other', 10000), null);
});
test('commerce material sources are covered even when the delivery target is different', () => {
  const state = fixture('merchant commerce');
  state.merchantCurrent.target = 'Buyer';
  state.commands.M.order = { sources: { R: [{ name: 'wood', quantity: 1 }] } };
  assert.equal(merchantVisibility(state, 'R', 10000), 'M');
  state.commands.M.order.sources = {};
  assert.equal(merchantVisibility(state, 'R', 10000), null);
});
test('recipient drops invisibility, holds it while served, and clears the hold when service ends', async () => {
  // The fighter's half is the job owner's character module.
  const calls = [];
  const context = vm.createContext({ character: { map: 'main', in: 'main', x: 0, y: 0, s: { invis: {} } },
    get_player: () => ({ map: 'main', in: 'main', x: 100, y: 0 }) });
  require('./helpers/merchant-visits.cjs').installVisits(context, { stop: async action => calls.push(action) });
  await context.applyMerchantVisibility('M');
  assert.deepEqual(calls, ['invis']); assert.equal(context.merchantVisibilityActive(), true);
  // The hold lasts while the reply names the merchant and it is in range; the visit-waits row
  // below covers its end when the merchant leaves range.
  assert.equal(context.merchantVisibilityActive(), true);
  await context.applyMerchantVisibility('M'); assert.equal(context.merchantVisibilityActive(), true);
  const sent = calls.length;
  await context.applyMerchantVisibility(null); assert.equal(context.merchantVisibilityActive(), false);
  context.get_player = () => ({ map: 'bank', x: 0, y: 0 });
  await context.applyMerchantVisibility('M'); assert.equal(calls.length, sent);
});

// The visit's waits on the coordinator's word and the game's: the invisibility hold ends when the
// merchant leaves range, a cleanout asks again only once the bag changed after an answer, a
// `waiting` handoff asks again at the merchant's own next report, and a delivered item equips once
// the character's update shows it in the bag.
test('visit waits follow the reply, the bag and the reports, not a timer', async () => {
  const asks = [], reports = [], player = { map: 'main', in: 'main', x: 100, y: 0 };
  globalThis.G ||= { items: {}, classes: {} };
  const context = vm.createContext({ character: { name: 'F', ctype: 'priest', map: 'main', in: 'main', x: 0, y: 0, s: {}, items: [{ name: 'hpot0', q: 1 }], slots: {} },
    get_player: () => player, game_log() {},
    request: async (url) => { asks.push(url); return url === '/merchant/handoff' && asks.length < 3 ? { waiting: true } : { ok: true }; },
    ownReport: async () => { reports.push('report'); } });
  require('./helpers/merchant-visits.cjs').installVisits(context, { stop: async () => {}, isEquipment: () => true,
    sameItemState: (item, wanted) => !!item && item.name === wanted.name, equip: async () => { context.character.slots.mainhand = { name: 'blade' }; } });
  await context.applyMerchantVisibility('M'); assert.equal(context.merchantVisibilityActive(), true);
  player.x = 500; assert.equal(context.merchantVisibilityActive(), false);
  await context.requestMerchantCleanout(); await context.requestMerchantCleanout();
  assert.deepEqual(asks, ['/merchant/cleanout']);
  context.character.items.push({ name: 'bone', q: 1 }); await context.requestMerchantCleanout();
  assert.deepEqual(asks, ['/merchant/cleanout', '/merchant/cleanout']);
  asks.length = 0;
  assert.deepEqual(await context.requestMerchantHandoff('/merchant/handoff', {}), { ok: true });
  assert.deepEqual([asks.length, reports.length], [3, 2]);
  let updates = 0;
  context.gameUpdate = async (events, done) => { updates++; if (!done()) context.character.items.push({ name: 'blade' }); return done(); };
  const [result] = await context.equipDeliveredItems([{ name: 'blade' }]);
  assert.equal(result.success, true); assert.ok(updates >= 1);
});
