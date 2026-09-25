const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const { transformSync } = require('esbuild');
const React = require('../../dashboard/node_modules/react');
const { create, act } = require('../../dashboard/node_modules/react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;

async function fixture(t) {
  let model, failure, handler, authQueries;
  const requests = [], invalidations = [];
  const data = { characters: {}, marked: {}, activeSlots: [] };
  const client = { invalidateQueries: async value => invalidations.push(value), removeQueries() {} };
  const filename = path.resolve('dashboard/features/party/use-party-console.tsx');
  const loaded = new Module(filename, module); loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const baseRequire = loaded.require.bind(loaded);
  loaded.require = name => {
    if (name === '@tanstack/react-query') return { useQueryClient: () => client, useQueries: value => { authQueries = value.queries; } };
    if (name === './query-cache') return { useDomain: () => ({ data }), useVisible: () => true, key: name => ['party', name], read: async () => ({ auth: 'CORRECT' }) };
    if (name === './query-actions') return { usePartyAction: () => ({ mutateAsync: async ({ path, body }) => {
      requests.push({ path, body }); if (handler) return handler(path, body); if (failure) throw failure; return {};
    } }) };
    if (name === '@/lib/party-routing') return { canRouteToMonster: () => true };
    if (name.startsWith('./')) {
      const tsfile = ['.ts', '.tsx'].map(ext => path.resolve(path.dirname(filename), name + ext)).find(file => fs.existsSync(file));
      if (tsfile) {
        const child = new Module(tsfile, loaded); child.filename = tsfile; child.paths = loaded.paths; child.require = loaded.require;
        child._compile(transformSync(fs.readFileSync(tsfile, 'utf8'), { loader: 'tsx', format: 'cjs' }).code, tsfile);
        return child.exports;
      }
    }
    return baseRequire(name);
  };
  loaded._compile(transformSync(fs.readFileSync(filename, 'utf8'), { loader: 'tsx', format: 'cjs' }).code, filename);
  const previous = global.document; global.document = {};
  function Harness() { model = loaded.exports.usePartyConsole(); return null; }
  let tree; await act(async () => { tree = create(React.createElement(Harness)); });
  t.after(async () => { await act(async () => tree.unmount()); global.document = previous; });
  return { get model() { return model; }, requests, invalidations,
    fail(value = new Error('Server explanation')) { failure = value; },
    handle(value) { handler = value; },
    async run(fn) { await act(async () => fn(model)); },
    async pollAuth() { await act(async () => authQueries[0].queryFn({ signal: new AbortController().signal })); },
  };
}
const entry = { slot: 2, item: { name: 'ring', q: 2 } };
const forms = [
  ['create', m => { m.setCreateOpen(true); m.setNewName('ValidName'); }, m => m.createCharacter(), m => m.newName, m => m.setNewName('OtherName'), m => m.setCreateOpen(false)],
  ['donation', m => { m.setDonationOpen(true); m.setDonationAmount('100'); }, m => m.donateGold(), m => m.donationAmount, m => m.setDonationAmount('200'), m => m.setDonationOpen(false)],
  ['giveaway', m => { m.setGiveawayOpen(true); m.setGiveawayRealm('US I'); m.setGiveawayMerchant('Seller'); }, m => m.joinGiveaway(), m => m.giveawayMerchant, m => m.setGiveawayMerchant('Other'), m => m.setGiveawayOpen(false)],
  ['realm', m => { m.setRealmConfirmOpen(true); m.setRealmDestination('US I'); }, m => m.switchRealm(), m => m.realmConfirmOpen, m => m.setRealmSetHome(true), m => m.setRealmConfirmOpen(false)],
  ['stand', m => m.setStandItem({ entry, price: '100', quantity: '1', markAll: false }), m => m.saveStandListing(), m => m.standItem, m => m.setStandItem(old => ({ ...old, price: '200' })), m => m.setStandItem(null)],
  ['npcSale', m => m.setNpcSaleItem({ entry, source: 'merchant', quantity: '1', acknowledged: false }), m => m.confirmNpcSale(), m => m.npcSaleItem, m => m.setNpcSaleItem(old => ({ ...old, quantity: '2' })), m => m.setNpcSaleItem(null)],
  ['autoNpcSale', m => m.setAutoNpcSaleItem(entry), m => m.confirmAutoNpcSale(), m => m.autoNpcSaleItem, m => m.setAutoNpcSaleItem({ ...entry, slot: 3 }), m => m.setAutoNpcSaleItem(null)],
  ['travel', m => m.setTravelCharacter('A'), m => m.submitCharacterTravel('A', { map: 'main', x: 0, y: 0 }, 'Main'), m => m.travelCharacter, m => m.setTravelCharacter('B'), m => m.setTravelCharacter(null)],
  ['threshold', m => m.editThreshold('0'), m => m.save(), m => m.threshold, m => m.editThreshold('100'), m => m.clearCollectionErrors()],
  ['itemCollectionThreshold', m => m.editItemCollectionThreshold('42'), m => m.saveItemCollectionThreshold(), m => m.itemCollectionThreshold, m => m.editItemCollectionThreshold('1'), m => m.clearCollectionErrors()],
];
for (const [scope, setup, submit, draft, edit, close] of forms) test(`${scope}: rejection preserves draft, edits/close/retry clear inline error, success is quiet`, async t => {
  const f = await fixture(t); await f.run(setup); const before = draft(f.model); f.fail();
  await f.run(submit); assert.equal(f.model[scope + 'Error'], 'Server explanation'); assert.deepEqual(draft(f.model), before); assert.equal(f.model.actionError, null);
  await f.run(edit); assert.equal(f.model[scope + 'Error'], null);
  await f.run(submit); await f.run(close); assert.equal(f.model[scope + 'Error'], null);
  await f.run(setup); await f.run(submit); f.fail(null); await f.run(submit);
  assert.equal(f.model[scope + 'Error'], null); assert.equal(f.model.actionError, null);
  assert.ok(f.requests.length >= 4);
});
test('invalid inputs stay local and zero gold remains valid', async t => {
  const f = await fixture(t);
  for (const [setup, submit, field, pattern] of [
    [m => m.setNewName('a'), m => m.createCharacter(), 'createError', /4-12/],
    [m => m.setDonationAmount('0'), m => m.donateGold(), 'donationError', /positive/],
    [m => m.setGiveawayRealm(''), m => m.joinGiveaway(), 'giveawayError', /both/],
    [m => m.editThreshold('-1'), m => m.save(), 'thresholdError', /non-negative whole number/],
    [m => m.editItemCollectionThreshold('43'), m => m.saveItemCollectionThreshold(), 'itemCollectionThresholdError', /1 to 42/],
    [m => m.setNpcSaleItem({ entry, quantity: '3' }), m => m.confirmNpcSale(), 'npcSaleError', /1 to 2/],
    [m => m.setNpcSaleItem({ entry: { ...entry, item: { name: 'ring', level: 1 } }, quantity: '1' }), m => m.confirmNpcSale(), 'npcSaleError', /warning/],
  ]) { await f.run(setup); await f.run(submit); assert.match(f.model[field], pattern); }
  assert.equal(f.requests.length, 0); await f.run(m => m.editThreshold('0')); await f.run(m => m.save());
  assert.deepEqual(f.requests[0], { path: '/config', body: { threshold: 0 } });
});
test('NPC bulk retry submits only remaining slots after partial failure', async t => {
  const f = await fixture(t); let calls = 0;
  f.handle(() => { if (++calls === 2) throw Error('Second slot failed'); return {}; });
  await f.run(m => m.setNpcSaleItem({ entry, source: 'bank', targets: [2, 3].map(slot => ({ pack: 'items0', entry: { ...entry, slot } })), quantity: '4', acknowledged: false }));
  await f.run(m => m.confirmNpcSale()); assert.equal(f.model.npcSaleError, 'Second slot failed');
  assert.deepEqual(f.model.npcSaleItem.targets.map(t => t.entry.slot), [3]);
  await f.run(m => m.confirmNpcSale()); assert.equal(f.model.npcSaleItem, null);
  assert.deepEqual(f.requests.map(r => r.body.slot), [2, 3, 3]);
});
test('generic failures use shared errors; commerce keeps the original structured rejection', async t => {
  const f = await fixture(t); const error = Object.assign(new Error('Conflict'), { details: { code: 'auto_bank_confirmation_required' } }); f.fail(error);
  await f.run(m => m.command('A', 'bank')); assert.equal(f.model.actionError, 'Conflict');
  await f.run(m => { m.setActionError(null); m.setCommerceMode('buy'); });
  await assert.rejects(f.model.submitMerchantOrder([], []), e => e === error);
  assert.equal(f.model.actionError, null); assert.equal(f.model.commerceMode, 'buy');
});
test('ALData checks and pending authentication retain visible status without announcements', async t => {
  const f = await fixture(t); const previous = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ auth: 'NO' }) }); t.after(() => { global.fetch = previous; });
  await f.run(m => m.aldataAction('check')); assert.equal(f.model.aldataAuthStatus, 'NO');
  await f.run(m => m.setALDataAuthPending(true)); await f.pollAuth();
  assert.equal(f.model.aldataAuthStatus, 'CORRECT'); assert.equal(f.model.aldataAuthPending, false); assert.equal(f.model.actionError, null);
  await f.run(m => m.aldataAction('refresh')); assert.ok(f.invalidations.some(v => v.queryKey[1] === 'market'));
});

test('travel renders validation and server feedback once, preserves coordinates, and clears on edits', async () => {
  const filename = path.resolve('dashboard/features/party/character-travel-dialog.tsx');
  const loaded = new Module(filename, module); loaded.filename = filename; loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const baseRequire = loaded.require.bind(loaded);
  loaded.require = name => name.startsWith('@/components/ui/') || name === 'lucide-react' ? new Proxy({}, { get: (_, key) => key }) : baseRequire(name);
  loaded._compile(transformSync(fs.readFileSync(filename, 'utf8'), { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code, filename);
  let calls = 0;
  function Harness() {
    const [error, setError] = React.useState(null);
    return React.createElement(loaded.exports.CharacterTravelDialog, { character: 'A', places: [], error, setError, onClose() {}, onTravel: async () => { calls++; setError('Server rejected travel'); } });
  }
  let tree; await act(async () => { tree = create(React.createElement(Harness)); });
  const submit = () => tree.root.findAllByType('Button').at(-1).props.onClick();
  const alerts = () => tree.root.findAllByProps({ role: 'alert' });
  await act(async () => tree.root.findAllByType('Input')[0].props.onChange({ target: { value: '' } }));
  await act(async () => submit()); assert.equal(calls, 0); assert.equal(alerts().length, 1);
  assert.match(alerts()[0].children.join(''), /map and finite coordinates/);
  await act(async () => tree.root.findAllByType('Input')[0].props.onChange({ target: { value: 'cave' } }));
  assert.equal(alerts().length, 0); await act(async () => submit());
  assert.equal(alerts().length, 1); assert.equal(alerts()[0].children[0], 'Server rejected travel');
  assert.equal(tree.root.findAllByType('Input')[0].props.value, 'cave');
  await act(async () => tree.root.findAllByType('Input')[1].props.onChange({ target: { value: '50' } }));
  assert.equal(alerts().length, 0); await act(async () => tree.unmount());
});
