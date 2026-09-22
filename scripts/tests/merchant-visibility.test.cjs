const test = require('node:test'), assert = require('node:assert/strict');
const { merchantVisibility } = require('../../runtime/coordinator/merchant/visibility.ts');
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
test('recipient drops invisibility, holds it briefly, and clears the hold when service ends', async () => {
  const source = fs.readFileSync('characters/shared.js', 'utf8'), calls = [];
  const context = vm.createContext({ Date, Math, character: { map: 'main', in: 'main', x: 0, y: 0, s: { invis: {} } },
    get_player: () => ({ map: 'main', in: 'main', x: 100, y: 0 }), stop: async action => calls.push(action) });
  vm.runInContext(source.slice(source.indexOf('  var merchantVisibilityUntil'), source.indexOf('  async function tick()')), context);
  await context.applyMerchantVisibility('M');
  assert.deepEqual(calls, ['invis']); assert.ok(context.merchantVisibilityUntil > Date.now());
  await context.applyMerchantVisibility(null); assert.equal(context.merchantVisibilityUntil, 0);
  context.get_player = () => ({ map: 'bank', x: 0, y: 0 });
  await context.applyMerchantVisibility('M'); assert.equal(calls.length, 1);
});
