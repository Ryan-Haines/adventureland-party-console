const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { load, queryRoot } = require('./helpers/dashboard-query-module.cjs');
const React = require('../../dashboard/node_modules/react');
const { create, act } = require('../../dashboard/node_modules/react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;

// use-party-console runs over the real query-cache and React Query; the test answers the console's
// reads with `data` and its actions through the query-actions stub.
async function fixture(t) {
  let model, failure, handler, auth;
  const requests = [], invalidations = [];
  const data = { characters: {}, marked: {}, activeSlots: [] };
  const { usePartyConsole } = load('use-party-console.tsx', {
    // The real performAction and PartyActionError; the stub replaces only the hook's mutation.
    './query-actions': { ...load('query-actions.ts'), usePartyAction: () => ({ mutateAsync: async ({ path, body }) => {
      requests.push({ path, body }); if (handler) return handler(path, body); if (failure) throw failure; return {};
    } }) },
    '@/lib/party-routing': { canRouteToMonster: () => true },
  });
  const { client, wrap } = queryRoot(), invalidate = client.invalidateQueries.bind(client);
  client.invalidateQueries = async value => { invalidations.push(value); return invalidate(value); };
  const previousFetch = global.fetch, previous = global.document;
  const fixtureFetch = async url => { const body = String(url).includes('/aldata/auth') ? { auth } : data;
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }; };
  global.fetch = fixtureFetch;
  // A visible tab: query-cache's useVisible listens for visibilitychange on it.
  global.document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  function Harness() { model = usePartyConsole(); return null; }
  let tree; await act(async () => { tree = create(wrap(React.createElement(Harness))); });
  t.after(async () => { await act(async () => tree.unmount()); client.clear(); global.document = previous; global.fetch = previousFetch; });
  return { get model() { return model; }, requests, invalidations,
    fail(value = new Error('Server explanation')) { failure = value; },
    handle(value) { handler = value; },
    async run(fn) { await act(async () => fn(model)); },
    // The pending authentication poll's next read answers CORRECT, after the read the poll made on
    // its start has answered.
    async pollAuth() {
      await act(() => new Promise(resolve => setTimeout(resolve, 0)));
      const answer = global.fetch; auth = 'CORRECT'; global.fetch = fixtureFetch;
      try { await act(async () => client.refetchQueries({ queryKey: ['party', 'aldata-auth'] })); } finally { global.fetch = answer; }
    },
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
  global.fetch = async () => ({ ok: true, json: async () => ({ auth: 'NO' }), text: async () => JSON.stringify({ auth: 'NO' }) }); t.after(() => { global.fetch = previous; });
  await f.run(m => m.aldataAction('check')); assert.equal(f.model.aldataAuthStatus, 'NO');
  await f.run(m => m.setALDataAuthPending(true)); await f.pollAuth();
  assert.equal(f.model.aldataAuthStatus, 'CORRECT'); assert.equal(f.model.aldataAuthPending, false); assert.equal(f.model.actionError, null);
  await f.run(m => m.aldataAction('refresh')); assert.ok(f.invalidations.some(v => v.queryKey[1] === 'market'));
});

test('travel renders validation and server feedback once, preserves coordinates, and clears on edits', async () => {
  const loaded = { exports: load('character-travel-dialog.tsx', { '@/components/ui/*': new Proxy({}, { get: (_, key) => key }),
    'lucide-react': new Proxy({}, { get: (_, key) => key }) }) };
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

// Every dashboard write and host request goes through the action client, so a lost
// session ends the page's session and a success refreshes the sections the write changed. The scan
// is the row per former plain fetch: no dashboard file but the action client sends a write.
function actionClient(lost) {
  return load('query-actions.ts', { './api': { API: '/party-api' },
    './query-cache': { authenticationLost: client => lost.push(client), key: domain => ['party', domain] },
    './steam-client-setup': { steamClientSetup: body => body },
    '@tanstack/react-query': { useMutation: () => ({}), useQueryClient: () => ({}) } });
}
test('a write and a host request end the session on 401, 403 or a pairing redirect, and a write refreshes its sections', async t => {
  const lost = [], invalidated = [], previous = global.fetch;
  t.after(() => { global.fetch = previous; });
  const client = { cancelQueries: async () => {}, invalidateQueries: async value => invalidated.push(value.queryKey), setQueryData() {} };
  const { performAction, hostAction } = actionClient(lost);
  for (const answer of [{ status: 401 }, { status: 403 }, { status: 200, redirected: true }]) {
    global.fetch = async () => ({ ok: answer.status === 200, status: answer.status, redirected: !!answer.redirected, json: async () => ({}), text: async () => JSON.stringify({}) });
    await assert.rejects(performAction(client, '/settings', { changes: [] }));
    await assert.rejects(hostAction(client, '/console-build/load', {}));
  }
  assert.equal(lost.length, 6, 'each lost session ends the page session, writes and host requests alike');
  global.fetch = async () => ({ ok: true, status: 200, redirected: false, json: async () => ({ ok: true }), text: async () => JSON.stringify({ ok: true }) });
  await performAction(client, '/settings', { changes: [] });
  assert.ok(invalidated.length > 0, 'a write refreshes the sections it changed');
  // The add-on manager's switch has its cache row; its list is its own cache (slots.tsx).
  await performAction(client, '/addons', { name: 'a', enabled: true });
  // The row per former plain fetch: no other dashboard file sends a write itself.
  const files = [];
  const walk = dir => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory() && !['node_modules', '.next', '.build'].includes(entry.name)) walk(file);
    else if (/\.tsx?$/.test(entry.name)) files.push(file);
  } };
  // The add-on system's own pages and the add-on dashboards write through the kit's action client too.
  for (const dir of ['dashboard/features', 'dashboard/app', 'dashboard/lib', 'dashboard/components', 'runtime/hooks/dashboard', 'runtime/addons']) if (fs.existsSync(dir)) walk(dir);
  // A fetch call is a read when it has no options or an inline literal with no spread and no method
  // but GET. Options held in a variable, spread in, or built by a helper may carry a write method.
  const fetchCalls = text => { const calls = [], pattern = /(?<![\w.])fetch\(/g; let match;
    while ((match = pattern.exec(text))) { let depth = 1, index = pattern.lastIndex, comma = -1;
      for (; index < text.length && depth; index++) { const char = text[index];
        if ('([{'.includes(char)) depth++; else if (')]}'.includes(char)) depth--; else if (char === ',' && depth === 1 && comma < 0) comma = index; }
      calls.push(comma < 0 ? '' : text.slice(comma + 1, index - 1).trim()); }
    return calls; };
  const isRead = options => !options || (options.startsWith('{') && !options.includes('...') && !/method:\s*(?!['"]GET['"])/.test(options));
  const writes = files.filter(file => !/(query-actions|api)\.ts$/.test(file))
    .filter(file => fetchCalls(fs.readFileSync(file, 'utf8')).some(options => !isRead(options)));
  assert.deepEqual(writes, []);
});

// v1.5.0's agent tools effect listed `state.characters` among its
// dependencies, so every poll that changed a character aborted and registered both WebMCP tools
// again. The tools register once per `post`, and `execute` reads the characters current when it runs.
test('X7: a poll that changes a character leaves the agent tools registered once, reading the new characters', async t => {
  const tools = [], data = { characters: { A: { name: 'A' } }, marked: {}, activeSlots: [] }, requests = [];
  // React Query's mutateAsync keeps one identity across renders, so `post` does too.
  const action = { mutateAsync: async ({ path, body }) => { requests.push({ path, body }); return {}; } };
  const { usePartyConsole } = load('use-party-console.tsx', {
    './query-actions': { ...load('query-actions.ts'), usePartyAction: () => action },
    '@/lib/party-routing': { canRouteToMonster: () => true },
  });
  const { client, wrap } = queryRoot(), previousFetch = global.fetch, previous = global.document;
  global.fetch = async () => ({ ok: true, status: 200, json: async () => structuredClone(data), text: async () => JSON.stringify(data) });
  global.document = Object.assign(new EventTarget(), { visibilityState: 'visible',
    modelContext: { registerTool: (tool, { signal }) => { tools.push({ tool, signal }); } } });
  function Harness() { usePartyConsole(); return null; }
  let tree; await act(async () => { tree = create(wrap(React.createElement(Harness))); });
  t.after(async () => { await act(async () => tree.unmount()); client.clear(); global.document = previous; global.fetch = previousFetch; });
  await act(() => new Promise(resolve => setTimeout(resolve, 0)));
  const registered = tools.length;
  data.characters = { A: { name: 'A' }, B: { name: 'B' } };
  await act(async () => client.refetchQueries());
  await act(() => new Promise(resolve => setTimeout(resolve, 0)));
  assert.equal(tools.length, registered, 'no tool registers again on a poll');
  const live = tools.filter(entry => !entry.signal.aborted);
  assert.deepEqual(live.map(entry => entry.tool.name), ['set_bank_threshold', 'send_character_to_bank'], 'the two tools stay live');
  const bank = live[1].tool;
  await bank.execute({ character: 'B' });
  assert.deepEqual(requests.at(-1), { path: '/command', body: { character: 'B', type: 'bank' } });
  await assert.rejects(bank.execute({ character: 'Missing' }), /Unknown character/);
  assert.equal(requests.length, 1, 'an unknown character posts nothing');
  const threshold = live[0].tool;
  assert.deepEqual(await threshold.execute({ threshold: 5000 }), { threshold: 5000 });
  assert.deepEqual(requests.at(-1), { path: '/config', body: { threshold: 5000 } });
  for (const bad of [-1, 1.5, '10']) await assert.rejects(threshold.execute({ threshold: bad }), /Invalid threshold/);
  assert.equal(requests.length, 2, 'an invalid threshold posts nothing');
});

// The cards follow the active slots by index and leave the bank characters out.
test('the console orders its cards by slot index and leaves out the bank characters', async t => {
  const data = { characters: { A: { name: 'A' }, B: { name: 'B' }, C: { name: 'C' }, Bank: { name: 'Bank' } }, marked: {},
    bankbois: [{ name: 'Bank' }], activeSlots: [{ index: 2, character: 'C' }, { index: 3, character: 'Bank' }, { index: 0, character: 'A' }, { index: 1, character: 'B' }] };
  const { usePartyConsole } = load('use-party-console.tsx', {
    './query-actions': { ...load('query-actions.ts'), usePartyAction: () => ({ mutateAsync: async () => ({}) }) },
    '@/lib/party-routing': { canRouteToMonster: () => true },
  });
  const { client, wrap } = queryRoot(), previousFetch = global.fetch, previous = global.document;
  global.fetch = async () => ({ ok: true, status: 200, json: async () => structuredClone(data), text: async () => JSON.stringify(data) });
  global.document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  let model;
  function Harness() { model = usePartyConsole(); return null; }
  let tree; await act(async () => { tree = create(wrap(React.createElement(Harness))); });
  t.after(async () => { await act(async () => tree.unmount()); client.clear(); global.document = previous; global.fetch = previousFetch; });
  await act(() => new Promise(resolve => setTimeout(resolve, 0)));
  assert.deepEqual(model.chars.map(char => char.name), ['A', 'B', 'C']);
});
