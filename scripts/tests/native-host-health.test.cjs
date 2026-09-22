const { test } = require('node:test');
const assert = require('node:assert/strict');
const { servicesHealthy } = require('../../tools/hosting/health.ts');

test('health checks use the native API port and retain the existing default', async (t) => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    requests.push(url);
    return Response.json({ ready: true });
  });
  assert.equal(await servicesHealthy(true, 3030, 1924), true);
  assert.deepEqual(requests, ['http://127.0.0.1:3030/__dashboard/state', 'http://127.0.0.1:1924/party-api/state?catalog=0']);
  requests.length = 0;
  assert.equal(await servicesHealthy(true), true);
  assert.equal(requests[1], 'http://127.0.0.1:924/party-api/state?catalog=0');
  requests.length = 0;
  assert.equal(await servicesHealthy(false, 3030, 1924), true);
  assert.equal(requests.length, 1);
});
