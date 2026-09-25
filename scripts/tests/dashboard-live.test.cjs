const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDashboardStream } = require('../../runtime/coordinator/telemetry/dashboard-stream.ts');
const { createDashboardSampler } = require('../../runtime/characters/dashboard-sampler.ts');
const { createLiveReceiver } = require('../../dashboard/features/party/live-protocol.ts');
const { httpFixture } = require('./helpers/coordinator-http.cjs');
function fixture() {
  const http = httpFixture(), timers = new Set(); let now = 1000;
  const statuses = { A: { name: 'A', dashboardRuntime: 'runtime1', seenAt: now, hp: 100,
    items: [{ slot: 0, item: { name: 'coat' }, meta: { sprite: 'coat' } }], slots: {} } };
  const stream = createDashboardStream({ now: () => now, statuses: () => statuses, active: name => !!statuses[name],
    every: (fn, ms) => { const timer = { fn, ms }; timers.add(timer); return timer; }, cancel: timer => timers.delete(timer) });
  stream.install(http.router);
  return { ...http, stream, timers, statuses, advance: ms => { now += ms; },
    connect: () => http.invoke('GET', '/party-api/dashboard-stream'),
    send: (sample, data, extra = {}) => http.invoke('POST', '/party-api/dashboard-telemetry', {
      name: 'A', runtime: 'runtime1', ...stream.lease('A'), sample, sampledAt: now, data, ...extra }).response };
}

test('stand status follows heartbeat snapshot and live open/closed deltas',()=>{
 const f=fixture();f.statuses.A.standOpen=true;
 const client=f.connect();
 assert.equal(messages(client.response)[0].characters.A.vitals.standOpen,true);
 f.send(1,{vitals:{standOpen:false}});
 assert.equal(messages(client.response).at(-1).characters.A.vitals.standOpen,false);
 f.send(2,{vitals:{standOpen:true}});
 assert.equal(messages(client.response).at(-1).characters.A.vitals.standOpen,true);
 client.request.close();
});
const messages = response => response.chunks.map(chunk => JSON.parse(chunk.slice(6)));

test('display countdown rounding includes nested timers without mutating samples or hiding other changes', () => {
  const f = fixture();
  const condition = ms => ({ id: 'buff', remainingMs: ms, live: { ms, s: 1 }, definition: { duration: 10000 }, source: 'A' });
  f.statuses.A.conditions = [condition(9950)];
  const client = f.connect();
  assert.equal(messages(client.response)[0].characters.A.vitals.conditions[0].live.ms, 10000);
  assert.equal(f.statuses.A.conditions[0].remainingMs, 9950);
  const data = { vitals: { conditions: [condition(9850)] } };
  const before = JSON.stringify(data), count = client.response.chunks.length;
  f.send(1, data);
  assert.equal(JSON.stringify(data), before);
  assert.equal(client.response.chunks.length, count);
  f.send(2, { vitals: { conditions: [condition(8950)] } });
  assert.equal(messages(client.response).at(-1).characters.A.vitals.conditions[0].remainingMs, 9000);
  for (const patch of [{ source: 'B' }, { stacks: 2 }, { definition: { duration: 20000 } }, { remainingMs: 12000 }, { remainingMs: null }, { remainingMs: -1 }]) {
    const n = client.response.chunks.length;
    f.send(3 + n, { vitals: { conditions: [{ ...condition(8950), ...patch }] } });
    assert.equal(client.response.chunks.length, n + 1);
  }
  f.send(100, { vitals: { conditions: [] } });
  assert.deepEqual(messages(client.response).at(-1).characters.A.vitals.conditions, []);
  client.request.close();
});
test('snapshot, shared viewer lease, explicit slot removals and reuse preserve display-only ownership', () => {
  const f = fixture(); assert.equal(f.stream.lease('A').duration, 0);
  const first = f.connect(), second = f.connect();
  assert.equal(f.stream.count(), 2); assert.equal(f.stream.lease('A').duration, 3000);
  assert.equal(messages(first.response)[0].type, 'snapshot');
  const before = JSON.stringify(f.statuses);
  assert.equal(f.send(1, { vitals: { hp: 90 }, items: { 0: null } }).code, 200);
  assert.equal(messages(first.response).at(-1).characters.A.items[0], null);
  f.send(2, { items: { 0: { slot: 0, item: { name: 'sword' }, meta: { sprite: 'sword' } } } });
  assert.deepEqual(messages(first.response).at(-1).characters.A.items[0].meta, { sprite: 'sword' });
  assert.equal(JSON.stringify(f.statuses), before, 'telemetry cannot change authoritative bot status');
  const count = first.response.chunks.length;
  f.send(3, { vitals: { hp: 90 } }); assert.equal(first.response.chunks.length, count);
  first.request.close(); assert.equal(f.stream.count(), 1);
  second.request.close(); assert.equal(f.stream.lease('A').duration, 0); assert.equal(f.timers.size, 0);
});
test('reordered samples and old runtime generations cannot overwrite newer telemetry', () => {
  const f = fixture(), client = f.connect(); const old = f.stream.lease('A');
  f.send(5, { vitals: { hp: 50 } }); assert.equal(f.send(4, { vitals: { hp: 100 } }).code, 409);
  f.statuses.A.dashboardRuntime = 'runtime2'; const fresh = f.stream.lease('A');
  assert.notEqual(fresh.generation, old.generation);
  assert.equal(f.send(6, { vitals: { hp: 1 } }, { ...old }).code, 409);
  f.send(1, { vitals: { hp: 75 } }, { runtime: 'runtime2' });
  assert.equal(messages(client.response).at(-1).characters.A.vitals.hp, 75);
  client.request.close();
});
test('heartbeat passage, logout removal, reconnect snapshot and stalled-client cleanup', () => {
  const f = fixture(), client = f.connect();
  const timer = [...f.timers][0]; assert.equal(timer.ms, 5000); timer.fn();
  assert.equal(messages(client.response).at(-1).type, 'heartbeat');
  delete f.statuses.A; timer.fn();
  assert.ok(messages(client.response).some(message => message.type === 'delta' && message.characters.A === null));
  client.request.close(); const next = f.connect(); assert.deepEqual(messages(next.response)[0].characters, {});
  next.response.write = () => false; [...f.timers][0].fn();
  assert.equal(f.stream.count(), 0); assert.equal(f.timers.size, 0); assert.equal(f.stream.metrics.slowClients, 1);
});
test('sampler keeps newest pending state, builds metadata only for changes, and expires its lease', async () => {
  let now = 100, samples = 0, builds = 0, resolve;
  let current = { vitals: { hp: 100 }, items: { 0: { name: 'coat' } }, slots: {} };
  const sent = [];
  const sampler = createDashboardSampler({ now: () => now, current: () => true, name: () => 'A', runtime: () => 'r',
    sample: () => { samples++; return current; }, entry: value => { builds++; return { item: value }; },
    send: body => { sent.push(body); return new Promise(done => { resolve = done; }); } });
  sampler.pulse(); assert.equal(samples, 0);
  sampler.renew({ epoch: 'e', generation: 'g', duration: 3000 }); sampler.pulse();
  current.vitals.hp = 80; sampler.pulse(); current.vitals.hp = 60; sampler.pulse();
  assert.equal(sent.length, 1); resolve(); await new Promise(done => setImmediate(done));
  assert.equal(sent.length, 2); assert.equal(sent[1].data.vitals.hp, 60); assert.deepEqual(sent[1].data.items, {});
  assert.equal(builds, 1); resolve(); await new Promise(done => setImmediate(done));
  sampler.pulse(); assert.equal(sent.length, 2);
  now += 3001; sampler.pulse(); assert.equal(samples, 4);
});
test('receiver drops stale epochs and sequences and replaces reused slot metadata', () => {
  const written = []; const receiver = createLiveReceiver((name, value) => written.push(value));
  const record = { generation: 'g', sample: 1, sampledAt: 10, vitals: { hp: 100 }, items: { 0: { item: { name: 'coat' }, meta: { sprite: 'coat' } } }, slots: {} };
  receiver.accept({ type: 'snapshot', epoch: 'e', sequence: 5, characters: { A: record } });
  assert.equal(receiver.accept({ type: 'delta', epoch: 'old', sequence: 6, characters: {} }), false);
  assert.equal(receiver.accept({ type: 'delta', epoch: 'e', sequence: 4, characters: {} }), false);
  receiver.accept({ type: 'delta', epoch: 'e', sequence: 6, characters: { A: { ...record, sample: 2, vitals: {}, items: { 0: null } } } });
  assert.equal(written.at(-1).items[0], null);
  receiver.accept({ type: 'delta', epoch: 'e', sequence: 7, characters: { A: { ...record, sample: 3, vitals: {}, items: { 0: { item: { name: 'sword' } } } } } });
  assert.deepEqual(written.at(-1).items[0], { item: { name: 'sword' } });
});
