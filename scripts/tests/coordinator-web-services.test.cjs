const test = require('node:test'), assert = require('node:assert/strict');
const { startCoordinatorWebServices } = require('../../runtime/coordinator/http/web-services.ts');

function fixture(overrides = {}) {
  const calls = [], server = { listen: (...args) => calls.push(['listen', ...args]),
    use: (path, middleware) => calls.push(['use', path, typeof middleware]) };
  const monitor = { router: server };
  const ports = { createRouter: () => { calls.push('createRouter'); return server; },
    createMonitor: options => { calls.push(['monitor', options]); return monitor; },
    retainMonitor: value => calls.push(['retained', value === monitor]),
    staticFiles: path => { calls.push(['static', path]); return () => {}; },
    dashboard: value => calls.push(['dashboard', value === server]),
    info: details => calls.push(['info', details.type]), error: (...args) => calls.push(['error', ...args]),
    directory: '/caracal/standalones', updateRate: 1000, ...overrides };
  return { calls, ports, run: (settings, enabled = false) => startCoordinatorWebServices(settings, enabled, ports) };
}

test('disabled web services allocate nothing', () => {
  const f = fixture(); f.run(undefined); f.run({ port: 924 });
  assert.deepEqual(f.calls, []);
});

test('dashboard creates one loopback server, serves CODE before routes, then reuses it for TYPECODE', () => {
  const f = fixture(); f.run({ port: 924, party_dashboard: true, expose_TYPECODE: true }, true);
  assert.deepEqual(f.calls, [
    'createRouter', ['listen', 924, '127.0.0.1'], ['info', 'CODE_exposed'],
    ['use', '/CODE', 'function'], ['static', '/caracal/standalones/../CODE'], ['use', '/CODE', 'function'],
    ['dashboard', true], ['info', 'party_dashboard'], ['info', 'TYPECODE_exposed'],
    ['static', '/caracal/standalones/../TYPECODE.out'], ['use', '/TYPECODE', 'function'],
  ]);
});

test('both monitor options retain and reuse its router without an extra listen', () => {
  for (const flag of ['enable_bwi', 'enable_minimap']) {
    const f = fixture(); f.run({ port: 924, [flag]: true, party_dashboard: true });
    assert.deepEqual(f.calls.slice(0, 2), [['monitor', { port: 924, password: null, updateRate: 1000 }], ['retained', true]]);
    assert.equal(f.calls.includes('createRouter'), false);
    assert.equal(f.calls.some(call => call[0] === 'listen'), false);
    assert.ok(f.calls.some(call => call[0] === 'dashboard'));
  }
});
test('BWI router needs no listen method when reused for dashboard and code routes', () => {
  const routes = [], router = {use: path => routes.push(path)}, monitor = {router, publisher: {}};
  let retained, installed;
  const f = fixture({createMonitor: () => monitor, retainMonitor: value => {retained = value;},
    dashboard: value => {installed = value;}, createRouter: () => {throw Error('unexpected listener');}});
  f.run({port: 924, enable_bwi: true, party_dashboard: true, expose_TYPECODE: true}, true);
  assert.equal(retained, monitor); assert.equal(installed, router);
  assert.deepEqual(routes, ['/CODE', '/CODE', '/TYPECODE']);
  assert.equal(f.calls.some(call => call[0] === 'error'), false);
});

test('TYPECODE-only setup retains legacy host binding and requires both feature flags', () => {
  const f = fixture(); f.run({ port: 924, expose_TYPECODE: true });
  assert.deepEqual(f.calls, []);
  f.run({ port: 924, expose_TYPECODE: true }, true);
  assert.deepEqual(f.calls.slice(0, 2), ['createRouter', ['listen', 924]]);
});

test('failed dashboard initialization reports the error and skips later services without losing the monitor', () => {
  const error = Error('route failure'), f = fixture({ dashboard: () => { throw error; } });
  f.run({ port: 924, enable_bwi: true, party_dashboard: true, expose_TYPECODE: true }, true);
  assert.deepEqual(f.calls[1], ['retained', true]);
  assert.deepEqual(f.calls.slice(-2), [['error', 'failed to start web services.', error], ['error', 'no web services will be available']]);
  assert.equal(f.calls.some(call => call[1] === 'TYPECODE_exposed'), false);
});
