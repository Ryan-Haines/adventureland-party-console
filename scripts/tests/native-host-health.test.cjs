const { test } = require('node:test');
const assert = require('node:assert/strict');
const { servicesHealthy } = require('../../tools/hosting/health.ts');

// Failure modes for the health check (docs/efficiency.md § Requests and logs, C1):
// 1. it builds the full coordinator state to answer "is the coordinator up";
// 2. it reports healthy while the coordinator is down or answering errors;
// 3. it reports unhealthy against an older coordinator without the readiness route;
// 4. it skips the dashboard check or asks the API before the user configures the account.
function respond(routes) {
  const requests = [];
  return {
    requests,
    fetch: async (url) => {
      requests.push(url);
      const route = routes[new URL(url).pathname];
      if (route instanceof Error) throw route;
      return route ? route() : new Response('', { status: 404 });
    },
  };
}
const dashboard = () => Response.json({ ready: true });

test('health checks use the native API port and retain the existing default', async (t) => {
  const server = respond({ '/__dashboard/state': dashboard, '/party-api/ready': () => Response.json({ ready: true }) });
  t.mock.method(globalThis, 'fetch', server.fetch);
  assert.equal(await servicesHealthy(true, 3030, 1924), true);
  assert.deepEqual(server.requests, ['http://127.0.0.1:3030/__dashboard/state', 'http://127.0.0.1:1924/party-api/ready']);
  server.requests.length = 0;
  assert.equal(await servicesHealthy(true), true);
  assert.equal(server.requests[1], 'http://127.0.0.1:924/party-api/ready');
  server.requests.length = 0;
  assert.equal(await servicesHealthy(false, 3030, 1924), true);
  assert.equal(server.requests.length, 1);
});

test('health never requests the full coordinator state from a current coordinator', async (t) => {
  const server = respond({ '/__dashboard/state': dashboard, '/party-api/ready': () => Response.json({ ready: true }),
    '/party-api/state': () => { throw new Error('full state requested'); } });
  t.mock.method(globalThis, 'fetch', server.fetch);
  for (let i = 0; i < 3; i++) assert.equal(await servicesHealthy(true), true);
  assert.equal(server.requests.some((url) => url.includes('/party-api/state')), false);
});

test('a stopped or failing coordinator still fails health', async (t) => {
  for (const ready of [new TypeError('fetch failed'), () => new Response('', { status: 503 }), () => new Response('', { status: 500 })]) {
    const server = respond({ '/__dashboard/state': dashboard, '/party-api/ready': ready, '/party-api/state': () => Response.json({}) });
    t.mock.method(globalThis, 'fetch', server.fetch);
    assert.equal(await servicesHealthy(true), false);
    assert.equal(server.requests.some((url) => url.includes('/party-api/state')), false);
    t.mock.restoreAll();
  }
});

test('an older coordinator without the readiness route answers through the state route', async (t) => {
  for (const [status, healthy] of [[200, true], [503, false]]) {
    const server = respond({ '/__dashboard/state': dashboard, '/party-api/state': () => new Response('{}', { status }) });
    t.mock.method(globalThis, 'fetch', server.fetch);
    assert.equal(await servicesHealthy(true), healthy);
    assert.deepEqual(server.requests.slice(1), ['http://127.0.0.1:924/party-api/ready', 'http://127.0.0.1:924/party-api/state?catalog=0']);
    t.mock.restoreAll();
  }
});

test('an unready dashboard fails health before the coordinator is asked', async (t) => {
  const server = respond({ '/__dashboard/state': () => Response.json({ ready: false }), '/party-api/ready': () => Response.json({ ready: true }) });
  t.mock.method(globalThis, 'fetch', server.fetch);
  assert.equal(await servicesHealthy(true), false);
  assert.equal(server.requests.length, 1);
});
