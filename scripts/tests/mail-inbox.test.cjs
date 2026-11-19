const test = require('node:test');
const assert = require('node:assert/strict');
const {createMailInbox} = require('../../runtime/items/coordinator/mail.ts');
const create = ports => createMailInbox({}, { now: () => 0, persist() {}, ...ports });
function setup() {
  const queued = [], calls = [];
  const mail = { id: 'ML_one', fro: 'Friend', to: 'Merchant', subject: 'Gift', sent: '2026-09-10', item: { name: 'wbreeches', level: 8 }, taken: false };
  let fail = false;
  const inbox = create({ names: () => ['Merchant', 'Fighter'], jobs: () => queued,
    enqueue: entry => queued.push({ reason: 'collect mail', mail: entry }),
    api: async (method, args) => {
      calls.push([method, args]); if (fail) throw new Error('Offline');
      if (method === 'delete_mail') { mail.deleted = true; return [{ type: 'message' }]; }
      return [{ type: 'mail', mail: args.cursor ? [mail, { ...mail, id: 'self', fro: 'Fighter', item: null }] :
        [...(mail.deleted ? [] : [mail]), { ...mail, id: 'sent', to: 'Other' }],
      more: !args.cursor && !mail.deleted, cursor: args.cursor || mail.deleted ? null : '40' }];
    } });
  return { inbox, mail, queued, calls, fail: () => { fail = true; } };
}
test('all pages are deduplicated and sent-only messages are excluded without marking read', async () => {
  const { inbox, calls } = setup(); await Promise.all([inbox.refresh(), inbox.refresh()]);
  assert.equal(inbox.snapshot().count, 2); assert.equal(calls.length, 2);
  assert.ok(calls.every(([method]) => method === 'pull_mail'));
});
test('claim jobs deduplicate; uncertain attachment states cannot be deleted or reclaimed', async () => {
  const { inbox, mail, queued } = setup();
  await Promise.all([inbox.collect(mail.id), inbox.collect(mail.id)]); assert.equal(queued.length, 1);
  await assert.rejects(inbox.remove(mail.id), /Collect the attachment/);
  queued.length = 0; mail.taken = 'claim_token';
  await assert.rejects(inbox.collect(mail.id), /still processing/);
  await assert.rejects(inbox.remove(mail.id), /Collect the attachment/);
  mail.taken = true; await inbox.collect(mail.id); assert.equal(queued.length, 0);
  await inbox.remove(mail.id); assert.equal(inbox.snapshot().count, 0);
});
test('failed refresh retains last inbox and blocks unsafe actions', async () => {
  const { inbox, mail, fail, queued } = setup(); await inbox.refresh(); fail();
  await assert.rejects(inbox.collect(mail.id), /Offline/);
  assert.equal(queued.length, 0); assert.equal(inbox.snapshot().count, 2);
  assert.equal(inbox.snapshot().error, 'Offline');
  await assert.rejects(inbox.remove(mail.id), /Offline/);
});

test('game JSON attachments preserve their names, levels and stack quantities', async () => {
  const { inbox, mail } = setup();
  mail.item = JSON.stringify({ name: 'slice_citrus', q: 270 });
  await inbox.refresh();
  assert.deepEqual(inbox.snapshot().messages.find(entry => entry.id === mail.id).item, { name: 'slice_citrus', q: 270 });
  mail.item = JSON.stringify({ name: 'wbreeches', level: 8 });
  await inbox.refresh();
  assert.equal(inbox.snapshot().messages.find(entry => entry.id === mail.id).item.level, 8);
  mail.item = 'invalid';
  await assert.rejects(inbox.remove(mail.id), /Invalid mail attachment/);
});
// The merchant's mail jobs (market.ts `merchantSendMail`, `collectMail`) over marketHarness.
test('text-only mail sends without touching inventory or travel', async () => {
  const { marketHarness } = require('./helpers/items-character.cjs');
  const sent = [], completed = [], walks = [];
  const { market } = marketHarness({ character: { name: 'Merchant', ctype: 'merchant', gold: 1e6, items: [] },
    game: { sendMail: async (...args) => { sent.push(args); } },
    ports: { request: async (...args) => completed.push(args), walk: async destination => walks.push(destination) } });
  await market.merchantSendMail({ jobId: 'job', mail: { recipient: 'Friend', subject: 'Hello', message: 'Hi' } });
  assert.equal(sent[0][3], false); assert.equal(completed[0][1].body.success, true); assert.deepEqual(walks, []);
});

test('merchant collection correlates replies, cleans listeners, and handles full inventory and timeouts', async () => {
  const { marketHarness } = require('./helpers/items-character.cjs');
  for (const mode of ['success', 'full', 'timeout', 'failure']) {
    const completions = [];
    let timeout, sent = 0, listeners;
    // The game's take: the reply wait is open before the request goes, as calls.ts sends it.
    const takeMail = async (_id, requestId, wait) => {
      const reply = wait();
      sent++;
      listeners.game_response?.({ request_id: 'someone-else', response: 'mail_item_taken' });
      if (mode === 'timeout') timeout();
      else listeners.game_response?.({ request_id: requestId, response: mode === 'failure' ? 'mail_take_item_failed' : 'mail_item_taken', failed: mode === 'failure' });
      return reply;
    };
    const h = marketHarness({ character: { name: 'Merchant', ctype: 'merchant', items: [] },
      reads: { freeInventorySlots: () => mode === 'full' ? 0 : 1 }, game: { takeMail },
      ports: { scope: { setTimeout: callback => { timeout = callback; return 1; }, clearTimeout() {} },
        request: async (_url, options) => completions.push(options.body) } });
    listeners = h.listeners;
    await h.market.collectMail({ type: 'merchant-collect-mail', jobId: 'one', mail: { id: 'ML_one' } });
    assert.equal(completions[0].success, mode === 'success', mode);
    assert.equal(sent, mode === 'full' ? 0 : 1);
    assert.equal(listeners.game_response, undefined);
  }
});
// and: one cycle over three deletable mails pulls twice whatever their count, and a refused delete
// is recorded, does not stop the next mail, is tried once per cycle and goes once it is no longer
// due (red on an earlier build).
test('a cycle pulls twice for many actions and records a refused mail without stopping the rest', async () => {
  const calls = [], saved = { mailbox: { settings: { autoCollect: false, autoDelete: true }, seenIds: [], outbox: [] } };
  let listed = ['a', 'b', 'c'], refuse = 'a';
  const inbox = createMailInbox(saved, { names: () => ['Merchant'], jobs: () => [], enqueue() {}, now: () => 0, persist() {},
    api: async (method, args) => {
      calls.push(method);
      if (method === 'delete_mail') { if (args.mid === refuse) throw new Error('refused'); listed = listed.filter(id => id !== args.mid); return []; }
      return [{ type: 'mail', mail: listed.map(id => ({ id, to: 'Merchant', item: { name: 'hpot0' }, taken: true })) }];
    } });
  await inbox.refresh();
  assert.deepEqual(calls.filter(m => m === 'pull_mail').length, 2);
  assert.deepEqual(listed, ['a']);
  assert.deepEqual(inbox.snapshot().automationErrors, [{ id: 'a', action: 'delete', error: 'refused' }]);
  assert.equal(inbox.snapshot().automationError, 'Automatic mail deletion failed (a): refused');
  calls.length = 0; await inbox.refresh(true);
  assert.equal(calls.filter(m => m === 'delete_mail').length, 1);
  refuse = null; await inbox.refresh(true);
  assert.deepEqual([inbox.snapshot().automationErrors, inbox.snapshot().automationError], [[], null]);
});

// Auto collect queued a failed collection again the moment it failed. The retry now waits for the
// next mail check, the player's "Check mail every".
test('a failed automatic collection waits for the next mail check', async () => {
  const { inbox, mail, queued } = setup();
  await inbox.configure({ autoCollect: true, autoDelete: false });
  assert.equal(queued.length, 1);
  queued.length = 0;
  inbox.complete(mail.id, false, 'Inventory full');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(queued.length, 0, 'the failure queues no collect on its own completion');
  await inbox.refresh(true);
  assert.equal(queued.length, 1, 'the next cycle retries it');
});

// The read marks follow the listed mail, the outbox keeps a sent mail once until it is removed,
// and a failed collection shows its outcome on its mail.
test('the read marks, the outbox and a collection outcome follow the inbox', async () => {
  let listed = ['ML_a', 'ML_b'];
  const inbox = create({ names: () => ['Merchant'], jobs: () => [], enqueue() {},
    api: async () => [{ type: 'mail', mail: listed.map(id => ({ id, to: 'Merchant', subject: 'Gift', taken: false })) }] });
  await inbox.refresh();
  assert.equal(inbox.snapshot().newCount, 2);
  assert.equal(inbox.seen().newCount, 0);
  listed = ['ML_b', 'ML_c'];
  await inbox.refresh();
  assert.equal(inbox.snapshot().newCount, 1, 'a read mark leaves with its mail');
  const sent = { recipient: 'Fighter', subject: 'Hi', message: 'Potions' };
  inbox.sent('out-1', sent);
  inbox.sent('out-1', sent);
  assert.deepEqual(inbox.snapshot().outbox.map(mail => mail.id), ['out-1']);
  assert.deepEqual(inbox.removeSent('out-1').outbox, []);
  inbox.complete('ML_b', false, 'inv_size');
  const mail = inbox.snapshot().messages.find(entry => entry.id === 'ML_b');
  assert.deepEqual([mail.collection, mail.collectionError], ['failed', 'inv_size']);
});

// A standing failure retries once a "Check mail every" period (mail.ts header); the refresh button
// and the cycles a setting change, a send or a collection start leave it for that period's cycle.
test('a refresh you ask for leaves a failed automatic delete to the next periodic cycle', async () => {
  const mail = { id: 'ML_taken', fro: 'Friend', to: 'Merchant', subject: 'Gift', sent: '2026-09-10', item: { name: 'wbreeches', level: 8 }, taken: true };
  const deletes = [];
  const inbox = createMailInbox({ mailbox: { settings: { autoCollect: false, autoDelete: true }, seenIds: [], outbox: [] } }, {
    now: () => 0, persist() {}, names: () => ['Merchant'], jobs: () => [], enqueue() {},
    api: async (method, args) => {
      if (method === 'delete_mail') { deletes.push(args.mid); throw new Error('exception'); }
      return [{ type: 'mail', mail: [mail], more: false, cursor: null }];
    } });
  await inbox.refresh(true);
  assert.deepEqual(deletes, ['ML_taken']);
  await inbox.refresh();
  assert.deepEqual(deletes, ['ML_taken'], 'the asked-for refresh does not retry the failed delete');
  assert.equal(inbox.snapshot().automationErrors.length, 1, 'the failure stays listed');
  await inbox.refresh(true);
  assert.deepEqual(deletes, ['ML_taken', 'ML_taken'], 'the next period retries it');
});
