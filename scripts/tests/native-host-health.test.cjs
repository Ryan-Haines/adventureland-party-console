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

const ready = () => Response.json({ ready: true });
const failedState = () => { throw new Error('full state requested'); };
const dashboardUrl = 'http://127.0.0.1:3030/__dashboard/state';
const coordinatorState = (requests) => requests.some((url) => url.includes('/party-api/state'));
// Each row plants its routes, calls servicesHealthy with its arguments, and checks the answer and
// the requests the check sent.
const cases = [
  { title: 'the native API port is used and the default port is kept', routes: { '/__dashboard/state': dashboard, '/party-api/ready': ready },
    calls: [{ args: [true, 3030, 1924], healthy: true, requests: [dashboardUrl, 'http://127.0.0.1:1924/party-api/ready'] },
      { args: [true], healthy: true, request: [1, 'http://127.0.0.1:924/party-api/ready'] },
      { args: [false, 3030, 1924], healthy: true, count: 1 }] },
  { title: 'a current coordinator is never asked for the full state', routes: { '/__dashboard/state': dashboard, '/party-api/ready': ready, '/party-api/state': failedState },
    calls: [true, true, true].map(() => ({ args: [true], healthy: true, noState: true })) },
  ...[new TypeError('fetch failed'), () => new Response('', { status: 503 }), () => new Response('', { status: 500 })].map((answer, index) => ({
    title: `a stopped or failing coordinator still fails health (${index})`,
    routes: { '/__dashboard/state': dashboard, '/party-api/ready': answer, '/party-api/state': () => Response.json({}) },
    calls: [{ args: [true], healthy: false, noState: true }] })),
  ...[[200, true], [503, false]].map(([status, healthy]) => ({
    title: `an older coordinator without the readiness route answers through the state route (${status})`,
    routes: { '/__dashboard/state': dashboard, '/party-api/state': () => new Response('{}', { status }) },
    calls: [{ args: [true], healthy, tail: ['http://127.0.0.1:924/party-api/ready', 'http://127.0.0.1:924/party-api/state?catalog=0'] }] })),
  { title: 'an unready dashboard fails health before the coordinator is asked', routes: { '/__dashboard/state': () => Response.json({ ready: false }), '/party-api/ready': ready },
    calls: [{ args: [true], healthy: false, count: 1 }] },
];
for (const row of cases) {
  test(`health: ${row.title}`, async (t) => {
    const server = respond(row.routes);
    t.mock.method(globalThis, 'fetch', server.fetch);
    for (const call of row.calls) {
      server.requests.length = 0;
      assert.equal(await servicesHealthy(...call.args), call.healthy);
      if (call.requests) assert.deepEqual(server.requests, call.requests);
      if (call.request) assert.equal(server.requests[call.request[0]], call.request[1]);
      if (call.count !== undefined) assert.equal(server.requests.length, call.count);
      if (call.tail) assert.deepEqual(server.requests.slice(1), call.tail);
      if (call.noState) assert.equal(coordinatorState(server.requests), false);
    }
  });
}
