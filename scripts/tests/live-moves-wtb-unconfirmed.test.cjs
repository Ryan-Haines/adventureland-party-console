// A stale unconfirmed WTB purchase and its resolution, which left the live WTB spec (test-windows
// DESIGN.md 4.1, M64, M65 and M66): the live rows restored a pending purchase whose merchant job
// no longer runs, answered it from the dashboard and read the saved state back, so the route and
// the dashboard row need no game. The route is the items owner's native stand answer
// (runtime/items/coordinator/market.ts `resolvePurchase`), whose bought answer fills the bid
// through the bid purchases' `fulfill`; the row is dashboard/features/party/wtb-unconfirmed-purchase.tsx.
const assert = require('node:assert/strict');
const { scenarioTable } = require('./fixtures/scenarios.cjs');
const { createNativeStandAnswers, createBidPurchases } = require('../../runtime/items/coordinator/market.ts');
const load = require('./helpers/dashboard-query-module.cjs');
const React = load.dashboardRequire('react'), renderer = load.dashboardRequire('react-test-renderer');

// The live case from 2026-10-11: a Spider Silk purchase left by a merchant job that no longer
// exists, beside an unrelated Leather WTB.
const stale = 'merchant-1791749596518-1791748423642';
const key = `${stale}:MtlSnk:EU:IV:trade1:spidersilk:0:117600`;
function stand({ queued = false } = {}) {
  const state = {
    merchantCharacter: 'E2EMerchant', merchantCurrent: null, nextCommandId: 1, activeRealm: 'EUIV',
    merchantQueue: queued ? [{ id: stale, target: 'E2EMerchant', reason: 'stand purchases', queuedAt: 1, listings: [] }] : [],
    standBids: { spidersilk: { price: 150000, quantity: 45, minimumQuality: 0, useStandSlot: false, revision: 1 },
      leather: { price: 1000, quantity: 3, minimumQuality: 0, useStandSlot: false, revision: 1 } },
    nativeStand: { sequence: 0, offers: {}, problems: {}, purchases: {
      [key]: { item: { name: 'spidersilk', q: 1, price: 117600, rid: 'g2uO' }, quantity: 1, jobId: stale } } },
  };
  const bids = createBidPurchases(state, { publish() {}, log() {}, persist() {} });
  const answer = createNativeStandAnswers(state, { fulfill: (item, quantity) => bids.fulfill(item, quantity), persist() {}, dispatch() {} });
  const resolve = (id, bought) => answer({ action: 'resolve-purchase', id, bought });
  const read = () => ({ purchases: state.nativeStand.purchases, silk: state.standBids.spidersilk?.quantity, leather: state.standBids.leather.quantity });
  return { state, resolve, read };
}

scenarioTable('M64 and M65: a stale unconfirmed WTB purchase is resolved once from the dashboard', stand, [
  ['an unknown purchase is refused', ({ resolve }) => {
    const answer = resolve('missing', false);
    assert.equal(answer.status, 409); assert.match(answer.body.error, /no longer pending/i);
  }],
  ['M64: not bought releases the purchase, counts nothing, and a second answer is refused', ({ state, resolve, read }) => {
    assert.equal(resolve(key, false).status, undefined);
    assert.deepEqual(read(), { purchases: {}, silk: 45, leather: 3 });
    assert.match(resolve(key, false).body.error, /no longer pending/i);
    // A restart reloads the saved state as it was written.
    assert.deepEqual(JSON.parse(JSON.stringify(state)).nativeStand.purchases, {});
  }],
  ['M65: bought counts the purchase toward its own WTB once, and Leather is untouched', ({ state, resolve, read }) => {
    assert.equal(resolve(key, true).status, undefined);
    assert.deepEqual(read(), { purchases: {}, silk: 44, leather: 3 });
    assert.match(resolve(key, true).body.error, /no longer pending/i);
    assert.deepEqual(read(), { purchases: {}, silk: 44, leather: 3 }, 'counted once');
    assert.equal(JSON.parse(JSON.stringify(state)).standBids.spidersilk.quantity, 44);
  }],
]);

scenarioTable('M66: unconfirmed WTB resolution refuses a still queued purchase job', () => stand({ queued: true }), [
  ['both answers are refused while the job is queued, and the purchase resolves once it is cancelled', ({ state, resolve, read }) => {
    for (const bought of [false, true]) assert.match(resolve(key, bought).body.error, /still in progress/i);
    assert.deepEqual([Object.keys(read().purchases), read().silk, read().leather], [[key], 45, 3]);
    state.merchantQueue = [];
    resolve(key, true);
    assert.deepEqual(read(), { purchases: {}, silk: 44, leather: 3 });
  }],
]);

// The dashboard row shows the stuck purchase and the two answers, each posting the route above.
scenarioTable('M64 and M65: the dashboard row shows the unconfirmed purchase and posts the answer', () => {
  const posts = [];
  const { WTBUnconfirmedPurchase } = load('wtb-unconfirmed-purchase.tsx', {
    '@/components/ui/button': { Button: props => React.createElement('button', props) },
    './query-actions': { usePartyAction: () => ({ reset() {}, mutateAsync: async request => { posts.push(request); }, isPending: false, error: null }) },
  });
  const purchases = stand().state.nativeStand.purchases;
  let root;
  renderer.act(() => { root = renderer.create(React.createElement(WTBUnconfirmedPurchase, { itemId: 'spidersilk', name: 'Spider Silk', purchases })); });
  return { root, posts };
}, [
  ['the row names the problem, the purchase and both answers', ({ root, posts }) => {
    const row = root.root.findByProps({ 'aria-label': 'Unconfirmed purchase of Spider Silk' });
    const text = row.findByType('p').children.join('');
    assert.match(text, /Purchase outcome unconfirmed/);
    assert.match(text, /1 × Spider Silk at 117,600/);
    const buttons = row.findAllByType('button');
    assert.deepEqual(buttons.map(b => b.props.children), ['It was bought', "It wasn't bought"]);
    for (const button of buttons) renderer.act(() => button.props.onClick());
    assert.deepEqual(posts.map(p => [p.path, p.body.action, p.body.id, p.body.bought]),
      [['/merchant/native-stand', 'resolve-purchase', key, true], ['/merchant/native-stand', 'resolve-purchase', key, false]]);
  }],
]);
