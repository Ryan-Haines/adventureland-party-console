const test = require('node:test'), assert = require('node:assert/strict');
const {startCoordinatorMail} = require('../../runtime/items/coordinator/mail.ts');
const {installItems} = require('../../runtime/items/coordinator/owner.ts');
const {testRegistry} = require('./helpers/test-registry.cjs');

// The game's mail API behind a planted fetch: each request is logged and answers the account's mail.
function mailFetch() {
  const requests = [], mail = [{id: 'one', to: 'A', subject: 'first', sent: '2026-09-10', item: null, taken: false},
    {id: 'two', to: 'B', subject: 'second', sent: '2026-09-11', item: null, taken: false}];
  const fetch = async (url, options) => {requests.push([url, options]); return {ok: true, json: async () => [{type: 'mail', mail}]};};
  return {requests, fetch};
}

test('the inbox reads the roster and the merchant queue as they stand at each cycle', async () => {
  const f = mailFetch(), account = {response: {characters: [{name: 'A'}]}};
  const state = {merchantCurrent: {id: 'active'}, merchantQueue: [null, {id: 'queued', reason: 'collect mail', mail: {id: 'one'}}]};
  const inbox = startCoordinatorMail(state, account, {persist() {}, session: 's', enqueue() {}, loadFetch: async () => f.fetch});
  await inbox.refresh();
  assert.deepEqual(inbox.snapshot().messages.map(mail => [mail.id, mail.collection]), [['one', 'queued']]);
  account.response = {characters: [{name: 'B'}]}; state.merchantCurrent = null; state.merchantQueue = [];
  await inbox.refresh();
  assert.deepEqual(inbox.snapshot().messages.map(mail => [mail.id, mail.collection]), [['two', null]]);
});

test('mail transport loads fetch lazily and sends the session cookie and a JSON body with an abort signal', async () => {
  const f = mailFetch();
  let loads = 0;
  const inbox = startCoordinatorMail({merchantQueue: []}, {response: {characters: [{name: 'A'}]}},
    {persist() {}, session: 'test-session', enqueue() {}, loadFetch: async () => {loads++; return f.fetch;}});
  assert.equal(loads, 0);
  await inbox.refresh();
  assert.equal(loads, 1);
  const [url, {signal, ...options}] = f.requests[0];
  assert.equal(url, 'https://adventure.land/api/pull_mail');
  assert.deepEqual(options, {method: 'POST', headers: {Cookie: 'auth=test-session', 'Content-Type': 'application/json; charset=utf-8'}, body: '{}'});
  assert.ok(signal instanceof AbortSignal);
});

// owner.ts startMail: the first cycle runs at once and the next waits the player's
// mailCheckSeconds on the items owner's run scope.
test('a failed cycle shows in the inbox list and the items owner still schedules the next one', async t => {
  const seconds = 45;
  testRegistry(t).publish({name: 'core:settings', folder: 'core', author: 'test', summary: 'Answers the mail period.',
    hooks: {'settings.read': query => query.field === 'mailCheckSeconds' ? seconds : undefined}});
  const timers = [], state = {merchantCharacter: 'M', statuses: {}, marked: {}, merchantMarked: {}, upgrades: {}, compounds: {}, statScrolls: {},
    autoCompounds: {}, autoItemMarks: {}, autoUpgradeMarks: {}, withdrawals: {}, merchantQueue: [], merchantCurrent: null, merchantBlacklist: {},
    goldTargets: {}, standBids: {}, standListings: [], npcSaleMarks: [], bankbois: {}, merchantDeliveries: {}, nextCommandId: 1, production: {attempts: {}}};
  const owner = installItems(state, {account: {response: {characters: [{name: 'A'}]}, resolve_realm: () => null, updateInfo: async () => {}},
    scope: {setTimeout: (run, ms) => timers.push([run, ms])}, persist() {}, merchantHeld: () => false, queue() {}, deconstruct: () => false,
    automaticSales: () => false, characterId: () => undefined, observePonty() {}, adoptReservedCargo() {}, persistBank() {}, marketReport() {},
    storage: {busy: () => false, start: async () => {}}, log() {}, removeQueued() {}, observe() {}, ponty() {}, aldata() {}, dispatch() {}});
  const inbox = owner.startMail({session: 's', enqueue() {}, loadFetch: async () => {throw Error('offline');}});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(inbox.snapshot().error, 'offline');
  assert.deepEqual(timers.map(([, ms]) => ms / 1e3), [seconds]);
  timers[0][0]();
  assert.deepEqual(timers.map(([, ms]) => ms / 1e3), [seconds, seconds]);
});

// IT32: a cycle over several deletable mails pulls the inbox twice whatever their count, the
// once before its actions and once after.
test('a started inbox pulls twice in a cycle that deletes several mails', async () => {
  let listed = ['a', 'b', 'c'];
  const urls = [], fetch = async (url, options) => {
    urls.push(url);
    if (url.endsWith('/delete_mail')) { const mid = JSON.parse(options.body).mid; listed = listed.filter(id => id !== mid); return {ok: true, json: async () => []}; }
    return {ok: true, json: async () => [{type: 'mail', mail: listed.map(id => ({id, to: 'A', item: {name: 'hpot0'}, taken: true}))}]};
  };
  const state = {merchantQueue: [], mailbox: {settings: {autoCollect: false, autoDelete: true}, seenIds: [], outbox: []}};
  const inbox = startCoordinatorMail(state, {response: {characters: [{name: 'A'}]}}, {persist() {}, session: 's', enqueue() {}, loadFetch: async () => fetch});
  await inbox.refresh();
  assert.deepEqual(listed, []);
  assert.equal(urls.filter(url => url.endsWith('/pull_mail')).length, 2);
  assert.equal(urls.filter(url => url.endsWith('/delete_mail')).length, 3);
});

// The merchant job owner's completion route answers through the items owner's `mailComplete`, which
// reaches the inbox `startMail` builds and does nothing before it starts.
test('mailComplete reaches the started inbox and shows the failed collection on its mail', async t => {
  testRegistry(t).publish({name: 'core:settings', folder: 'core', author: 'test', summary: 'Answers the mail period.',
    hooks: {'settings.read': query => query.field === 'mailCheckSeconds' ? 45 : undefined}});
  const f = mailFetch(), state = {merchantCharacter: 'M', statuses: {}, marked: {}, merchantMarked: {}, upgrades: {}, compounds: {}, statScrolls: {},
    autoCompounds: {}, autoItemMarks: {}, autoUpgradeMarks: {}, withdrawals: {}, merchantQueue: [], merchantCurrent: null, merchantBlacklist: {},
    goldTargets: {}, standBids: {}, standListings: [], npcSaleMarks: [], bankbois: {}, merchantDeliveries: {}, nextCommandId: 1, production: {attempts: {}}};
  const owner = installItems(state, {account: {response: {characters: [{name: 'A'}]}, resolve_realm: () => null, updateInfo: async () => {}},
    scope: {setTimeout() {}}, persist() {}, merchantHeld: () => false, queue() {}, deconstruct: () => false,
    automaticSales: () => false, characterId: () => undefined, observePonty() {}, adoptReservedCargo() {}, persistBank() {}, marketReport() {},
    storage: {busy: () => false, start: async () => {}}, log() {}, removeQueued() {}, observe() {}, ponty() {}, aldata() {}, dispatch() {}});
  owner.mailComplete('one', false, 'Inventory full');
  const inbox = owner.startMail({session: 's', enqueue() {}, loadFetch: async () => f.fetch});
  await inbox.refresh();
  assert.equal(inbox.snapshot().messages.find(mail => mail.id === 'one').collection, null, 'a completion before the start reaches no inbox');
  owner.mailComplete('one', false, 'Inventory full');
  const one = inbox.snapshot().messages.find(mail => mail.id === 'one');
  assert.deepEqual([one.collection, one.collectionError], ['failed', 'Inventory full']);
});

// The kept bound: a game mail API that never answers ends at
// mailRequestBoundMs, the cycle's read fails, and the status owner's bound record counts the firing. The row saves
// a short bound through the settings writer onto the loaded hidden settings, which mail.ts reads.
test('mailRequestBoundMs: a mail request that never answers trips the bound and records it', async () => {
  const { hiddenSettings, holdHiddenSettings } = require('../../runtime/settings/coordinator/table.ts');
  const { settingsWriter } = require('./helpers/settings-writer.cjs');
  const { boundFirings } = require('../../runtime/status/coordinator/api.ts');
  const before = boundFirings().counts.mailRequestBoundMs || 0;
  try {
    const hidden = hiddenSettings({});
    assert.equal(settingsWriter(hidden).write({ by: 'dashboard:settings', changes: [{ field: 'mailRequestBoundMs', value: 50 }] }).ok, true);
    const inbox = startCoordinatorMail({ merchantQueue: [] }, { response: { characters: [{ name: 'A' }] } }, { persist() {}, session: 's', enqueue() {},
      loadFetch: async () => (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason))) });
    await inbox.refresh().catch(() => {});
    assert.equal(boundFirings().counts.mailRequestBoundMs, before + 1);
    const entry = boundFirings().entries.at(-1); assert.equal(entry.owner, '10');
  } finally { holdHiddenSettings(null); }
});
