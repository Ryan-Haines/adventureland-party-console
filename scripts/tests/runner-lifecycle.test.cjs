const { test } = require('node:test');
const assert = require('node:assert/strict');
const { RunnerScope, RetiredRunnerError } = require('../../runtime/lifecycle/character/run.ts');
const { ReloadQueue } = require('../../runtime/lifecycle/character/host.ts');

test('game methods preserve explicit entity receivers and revoke saved bound functions', () => {
  const scope = new RunnerScope();
  const host = { name: 'window', action(value) { return [this, value]; } };
  const entity = { name: 'target' }, proxy = scope.facade(host);
  const detached = proxy.action, bound = detached.bind(entity);
  assert.equal(proxy.action(1)[0], host);
  assert.equal(detached(1)[0], host);
  assert.deepEqual(detached.call(entity, 2), [entity, 2]);
  assert.deepEqual(detached.apply(entity, [3]), [entity, 3]);
  assert.deepEqual(bound(4), [entity, 4]);
  assert.equal(detached.call(scope.facade(entity), 5)[0], entity);
  scope.dispose();
  for (const invoke of [() => proxy.action(), () => detached(), () => bound(),
    () => detached.call(entity), () => detached.apply(entity, [])])
    assert.throws(invoke, RetiredRunnerError);
});

test('an old async continuation cannot issue another game action', async () => {
  let resume;
  const pending = new Promise(resolve => { resume = resolve; });
  let moves = 0;
  const scope = new RunnerScope();
  const parent = scope.facade({ move() { moves++; } });
  const old = (async () => { await pending; parent.move(); })();
  scope.dispose();
  resume();
  await assert.rejects(old, RetiredRunnerError);
  assert.equal(moves, 0);
});

test('reload queue prepares before disposal, serializes generations and skips duplicates', async () => {
  const events = [];
  const queue = new ReloadQueue();
  const prepare = name => async () => {
    events.push(`prepare:${name}`);
    return { async start() { events.push(`start:${name}`); }, async dispose() { events.push(`stop:${name}`); } };
  };
  await queue.reload('1', prepare('1'));
  await assert.rejects(queue.reload('bad', async () => { throw new Error('syntax'); }), /syntax/);
  await Promise.all([queue.reload('2', prepare('2')), queue.reload('2', prepare('duplicate')), queue.reload('3', prepare('3'))]);
  await queue.dispose();
  assert.deepEqual(events, ['prepare:1', 'start:1', 'prepare:2', 'stop:1', 'start:2', 'prepare:3', 'stop:2', 'start:3', 'stop:3']);
});

test('failed startup disposes its resources and allows subsequent recovery', async () => {
  const queue = new ReloadQueue();
  let disposed = 0;
  await assert.rejects(queue.reload('bad', async () => ({ async start() { throw new Error('failed'); }, async dispose() { disposed++; } })), /failed/);
  await queue.reload('good', async () => ({ async start() {}, async dispose() { disposed++; } }));
  await queue.dispose();
  assert.equal(disposed, 2);
});
