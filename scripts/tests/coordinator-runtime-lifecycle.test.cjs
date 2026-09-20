const test = require('node:test'), assert = require('node:assert/strict');
const { coordinatorGenerationPorts, installCoordinatorShutdownSignals } = require('../../runtime/coordinator/characters/runtime-lifecycle.ts');

test('generation adapter preserves partially initialized worker fields without scheduling disabled workers', () => {
  const instance = {}, workers = {A: {enabled: true, instance}, B: {instance}, C: {enabled: true, instance: null}};
  const ports = coordinatorGenerationPorts(workers, {owned: () => ({}), stop: async () => {}, report() {}});
  const [worker] = ports.workers();
  assert.equal(ports.workers().length, 1);
  assert.equal(worker.className, undefined);
  assert.equal(worker.script, undefined);
  delete workers.A.enabled;
  assert.equal(ports.current(worker), undefined);
  assert.deepEqual(ports.workers(), []);
});

test('generation reloads select live enabled workers and reject a replaced process', async () => {
  const instance = {}, workers = { A: { enabled: true, instance, script: 'old' },
    B: { enabled: false, instance: {}, script: 'old' }, C: { enabled: true, script: 'old' } };
  const stops = [], ports = coordinatorGenerationPorts(workers, { owned: () => ({ type: 'mage' }),
    stop: async (block, reason) => stops.push([block.script, reason]), report() {} });
  assert.equal(ports.directory, './CODE/adventure_land');
  const [worker] = ports.workers(); assert.equal(ports.workers().length, 1);
  assert.equal(worker.process, instance); assert.equal(worker.className, 'mage');
  assert.equal(ports.current(worker), true);
  workers.A.instance = {}; assert.equal(ports.current(worker), false);
  workers.A.instance = instance; workers.A.enabled = false; assert.equal(ports.current(worker), false);
  ports.activated(worker, 'hot'); assert.equal(workers.A.script, 'hot');
  await ports.restart(worker, 'replacement', 'reload failed');
  assert.deepEqual(stops, [['replacement', 'reload failed']]);
});

test('restart retains the selected replacement script when stopping rejects', async () => {
  const workers = { A: { enabled: true, instance: {}, script: 'old' } };
  const ports = coordinatorGenerationPorts(workers, { owned: () => ({ type: 'mage' }),
    stop: async () => { throw Error('stop failed'); }, report() {} });
  await assert.rejects(ports.restart(ports.workers()[0], 'new', 'retry'), /stop failed/);
  assert.equal(workers.A.script, 'new');
});

test('shutdown hooks preserve signal order and ignore unrelated IPC messages', () => {
  const listeners = new Map(), reasons = [];
  installCoordinatorShutdownSignals({ on: (name, handler) => listeners.set(name, handler) },
    async reason => { reasons.push(reason); });
  assert.deepEqual([...listeners.keys()], ['SIGINT', 'SIGTERM', 'SIGQUIT', 'message']);
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGQUIT']) listeners.get(signal)();
  for (const message of [null, undefined, '', 1, {}, { type: 'status' }]) listeners.get('message')(message);
  listeners.get('message')({ type: 'coordinator_shutdown' });
  assert.deepEqual(reasons, ['SIGINT', 'SIGTERM', 'SIGQUIT', 'coordinator reload request']);
});
