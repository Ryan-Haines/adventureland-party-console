const test = require('node:test');
const assert = require('node:assert/strict');
const create = require('../mail-inbox.cjs');
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
test('text-only mail sends without touching inventory or travel', async () => {
  const fs = require('node:fs'), vm = require('node:vm');
  const source = fs.readFileSync('characters/shared.js', 'utf8');
  const start = source.indexOf('  async function merchantSendMail(');
  const end = source.indexOf('\n  ', source.indexOf('\n  }', start) + 4);
  const sent = [], completed = [];
  const r = vm.createContext({ send_mail: async (...args) => { sent.push(args); }, request: async (...args) => completed.push(args) });
  vm.runInContext(source.slice(start, end), r);
  await r.merchantSendMail({ jobId: 'job', mail: { recipient: 'Friend', subject: 'Hello', message: 'Hi' } });
  assert.equal(sent[0][3], false); assert.equal(completed[0][1].body.success, true);
});

test('merchant collection correlates replies, cleans listeners, and handles full inventory and timeouts', async () => {
  const fs = require('node:fs'), vm = require('node:vm'), { EventEmitter } = require('node:events');
  const source = fs.readFileSync('characters/shared.js', 'utf8');
  const code = source.slice(source.indexOf('    if (command.type === "merchant-collect-mail"'),
    source.indexOf('    if (command.type === "merchant-send-mail"'));
  for (const mode of ['success', 'full', 'timeout', 'failure']) {
    const socket = new EventEmitter(), completions = [];
    let timeout, sent = 0;
    socket.on('mail_take_item', data => {
      sent++;
      socket.emit('game_response', { request_id: 'someone-else', response: 'mail_item_taken' });
      if (mode === 'timeout') timeout();
      else socket.emit('game_response', { request_id: data.request_id,
        response: mode === 'failure' ? 'mail_take_item_failed' : 'mail_item_taken', failed: mode === 'failure' });
    });
    const r = vm.createContext({ command: { type: 'merchant-collect-mail', jobId: 'one', mail: { id: 'ML_one' } },
      character: { ctype: 'merchant' }, parent: { socket }, freeInventorySlots: () => mode === 'full' ? 0 : 1,
      setTimeout: callback => { timeout = callback; return 1; }, clearTimeout() {},
      runMerchantJob: (_command, _label, action) => action(), afterCombat: action => action(),
      request: async (_url, options) => completions.push(options.body) });
    await vm.runInContext('(async function(){' + code + '})()', r);
    assert.equal(completions[0].success, mode === 'success', mode);
    assert.equal(sent, mode === 'full' ? 0 : 1);
    assert.equal(socket.listenerCount('game_response'), 0);
  }
});
