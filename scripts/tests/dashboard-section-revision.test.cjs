const { test } = require('node:test');
const assert = require('node:assert/strict');
const load = require('./helpers/dashboard-query-module.cjs');
const { QueryObserver } = require('../../dashboard/node_modules/@tanstack/react-query');
const { createDashboardClient, domainOptions, key } = load('query-cache.tsx');
const { performAction } = load('query-actions.ts');

// C3 dashboard failure modes (docs/efficiency.md § Requests and logs):
// 1. a 304 answer replaces the cached bank, logs or market data with nothing;
// 2. the dashboard sends a revision for data it no longer holds (cleared cache,
//    replaced by setQueryData) and keeps showing it after a 304;
// 3. structural sharing loses the revision, so the dashboard never gets a 304;
// 4. a mutation's invalidation no longer refetches the section;
// 5. auth and server errors stop behaving as before.
function server(sections) {
  const requests = [];
  const fetch = async (url) => {
    const parsed = new URL(url, 'http://dashboard');
    const section = parsed.searchParams.get('section'), current = sections[section];
    requests.push({ section, revision: parsed.searchParams.get('revision') });
    if (current.status && current.status !== 200) return { ok: false, status: current.status, redirected: false, headers: new Headers(), json: async () => ({}) };
    if (parsed.searchParams.get('revision') === current.revision) return { ok: false, status: 304, redirected: false, headers: new Headers({ ETag: `"${current.revision}"` }), json: async () => { throw new Error('304 has no body'); } };
    return { ok: true, status: 200, redirected: false, headers: new Headers({ ETag: `"${current.revision}"` }), json: async () => JSON.parse(JSON.stringify(current.body)) };
  };
  return { requests, fetch };
}
async function withFetch(fake, run) {
  const original = global.fetch; global.fetch = fake;
  try { return await run(); } finally { global.fetch = original; }
}

for (const domain of ['bank', 'logs', 'market']) test(`${domain}: 304 keeps the cached data object and later changes arrive`, async () => {
  const client = createDashboardClient();
  client.setQueryData(key('core'), { referenceRevision: 'catalog-1' });
  const sections = { [domain]: { revision: 'r1', body: { value: 1, nested: { items: [1, 2] } } } };
  const fake = server(sections);
  await withFetch(fake.fetch, async () => {
    const fetch = async () => { await client.fetchQuery({ ...domainOptions(client, domain), staleTime: 0 }); return client.getQueryData(key(domain)); };
    const first = await fetch();
    assert.deepEqual(first, sections[domain].body);
    const second = await fetch();
    assert.equal(second, first, '304 keeps the same cached object, so nothing re-renders');
    assert.deepEqual(fake.requests.map((entry) => entry.revision), [null, 'r1']);
    sections[domain] = { revision: 'r2', body: { value: 2, nested: { items: [1, 2] } } };
    const third = await fetch();
    assert.equal(third.value, 2);
    assert.equal(third.nested, first.nested, 'unchanged parts keep their identity');
    const fourth = await fetch();
    assert.equal(fourth, third);
    assert.deepEqual(fake.requests.map((entry) => entry.revision), [null, 'r1', 'r1', 'r2']);
  });
  client.clear();
});

test('a replaced or cleared cache entry is fetched in full, never answered from a 304', async () => {
  const client = createDashboardClient();
  client.setQueryData(key('core'), { referenceRevision: 'catalog-1' });
  const sections = { bank: { revision: 'r1', body: { bank: { gold: 1 } } } };
  const fake = server(sections);
  await withFetch(fake.fetch, async () => {
    await client.fetchQuery({ ...domainOptions(client, 'bank'), staleTime: 0 });
    client.setQueryData(key('bank'), { bank: { gold: 999 } });
    const refetched = await client.fetchQuery({ ...domainOptions(client, 'bank'), staleTime: 0 });
    assert.equal(refetched.bank.gold, 1);
    assert.equal(fake.requests[1].revision, null);
    client.removeQueries({ queryKey: key('bank') });
    await client.fetchQuery({ ...domainOptions(client, 'bank'), staleTime: 0 });
    assert.equal(fake.requests[2].revision, null);
  });
  client.clear();
});

test('a mutation still refetches an active bank query at once, and a changed bank arrives', async () => {
  const client = createDashboardClient();
  client.setQueryData(key('core'), { referenceRevision: 'catalog-1' });
  const sections = { bank: { revision: 'r1', body: { bank: { gold: 1 } } } };
  const fake = server(sections);
  const observer = new QueryObserver(client, { ...domainOptions(client, 'bank'), refetchInterval: false });
  const stop = observer.subscribe(() => {});
  await withFetch(async (url, init) => String(url).includes('/state?') ? fake.fetch(url, init) : { ok: true, status: 200, json: async () => ({}) }, async () => {
    await observer.refetch();
    sections.bank = { revision: 'r2', body: { bank: { gold: 2 } } };
    await performAction(client, '/bank/unlock', {});
    assert.equal(client.getQueryData(key('bank')).bank.gold, 2);
  }).finally(stop);
  client.clear();
});

test('auth loss and server errors behave as before', async () => {
  const client = createDashboardClient();
  client.setQueryData(key('core'), { referenceRevision: 'catalog-1' });
  const failing = server({ logs: { status: 503, revision: 'x', body: {} } });
  await withFetch(failing.fetch, () => assert.rejects(client.fetchQuery({ ...domainOptions(client, 'logs'), staleTime: 0 }), /Reconnecting/));
  // Auth loss clears every cache, which also cancels the read in flight.
  const lost = server({ logs: { status: 401, revision: 'x', body: {} } });
  await withFetch(lost.fetch, () => assert.rejects(client.fetchQuery({ ...domainOptions(client, 'logs'), staleTime: 0 })));
  assert.equal(client.getQueryData(key('core')), undefined);
  client.clear();
});
