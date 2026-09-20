const test = require('node:test'), assert = require('node:assert/strict');
const {installCoordinatorDashboard} = require('../../runtime/coordinator/http/dashboard.ts');
const {partyApiResponseHeaders} = require('../../runtime/coordinator/http/middleware.ts');

function fixture(overrides = {}) {
  const calls = [], tokens = new Map();
  function token(path) {
    if (!tokens.has(path)) tokens.set(path, new Proxy(() => {}, {get: (_, name) => token(path + '.' + String(name))}));
    return tokens.get(path);
  }
  const handlers = token('handlers');
  const router = Object.fromEntries(['get', 'post', 'use'].map(method => [method, (...args) => calls.push([method, ...args])]));
  const ports = {json: options => {calls.push(['json', options]); return token('json');},
    text: options => {calls.push(['text', options]); return token('text');},
    ...Object.fromEntries(['maps', 'roster', 'combatLogs'].map(name => [name, value => {
      assert.equal(value, router); calls.push([name]);
    }])),
    startMail: () => {calls.push(['mail-start']); return {snapshot: token('mail.snapshot'), action: name => token('mail.' + name)};},
    ...overrides};
  return {calls, tokens, handlers, run: () => installCoordinatorDashboard(router, handlers, ports)};
}

test('dashboard preserves parser limits and routes handlers behind the correct middleware', () => {
  const t = fixture(); t.run();
  assert.deepEqual(t.calls.slice(0, 10), [
    ['json', {limit: '32mb'}], ['use', t.tokens.get('json')], ['use', '/party-api', partyApiResponseHeaders],
    ['get', '/party-api/state', t.handlers.publicStateRoute],
    ['get', '/party-api/dashboard-state/export', t.handlers.dashboardImportRoutes.exportState],
    ['post', '/party-api/dashboard-preferences', t.handlers.dashboardImportRoutes.preferences],
    ['get', '/party-api/dashboard-state', t.handlers.dashboardImportRoutes.metadata],
    ['text', {type: 'text/plain', limit: '128mb'}],
    ['post', '/party-api/dashboard-state/preview', t.tokens.get('text'), t.handlers.dashboardImportRoutes.preview],
    ['text', {type: 'text/plain', limit: '128mb'}],
  ]);
  assert.deepEqual(t.calls[10], ['post', '/party-api/dashboard-state/import', t.tokens.get('text'), t.handlers.dashboardImportRoutes.importState]);
  assert.deepEqual(t.calls.find(call => call[1] === '/party-api/mail/delete'), ['post', '/party-api/mail/delete', t.tokens.get('mail.delete')]);
});

test('dashboard retains side-effect installation order between route groups', () => {
  const t = fixture(); t.run();
  const order = t.calls.map(call => call[1] || call[0]);
  const markers = ['/party-api/aldata/refresh', 'maps', '/party-api/roster/create', '/party-api/bankbois/:name/delete',
    'roster', '/party-api/realm/switch', '/party-api/status', 'combatLogs', '/party-api/escape',
    'mail-start', '/party-api/mail', '/party-api/mail/refresh', '/party-api/mail/collect', '/party-api/mail/delete'];
  let previous = -1;
  for (const marker of markers) {
    const index = order.indexOf(marker, previous + 1); assert.ok(index > previous, marker); previous = index;
  }
  assert.ok(previous < t.calls.length - 1, 'merchant transactions follow mailbox setup');
});

test('dashboard propagates mailbox setup failure without installing later routes', () => {
  const failure = Error('mail startup'), t = fixture({startMail: () => {throw failure;}});
  assert.throws(t.run, error => error === failure);
  assert.equal(t.calls.some(call => call[1] === '/party-api/mail'), false);
  assert.ok(t.calls.some(call => call[1] === '/party-api/status'));
});
