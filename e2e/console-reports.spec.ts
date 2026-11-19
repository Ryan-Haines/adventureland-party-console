import { test, expect } from './fixtures';

// Status report payloads through the real coordinator and dashboard
// (docs/efficiency.md, Report payload and Inventory deltas). The merchant
// fixture stays disconnected, so only these tests report M and no heartbeat
// replaces its inventory between steps.

test.use({ merchantConnected: false });

const inventory = async (url: string) => (await (await fetch(`${url}/party-api/state?section=inventory&dashboard=1`)).json()).characters?.M;
const coat = (level: number) => Array.from({ length: 42 }, (_, slot) => slot === 0 ? { slot, item: { name: 'coat', level }, meta: { properties: {} } } : null);

async function merchantReport(app: { state(): Promise<any> }) {
  const base = { ...(await app.state()).characters.W };
  for (const field of ['seenAt', 'inventorySeenAt', 'items', 'slots', 'bank']) delete base[field];
  return (extra: Record<string, unknown>) => ({ ...base, name: 'M', ctype: 'merchant', steamPrimary: false,
    runtimeId: 'e2e-report-M', clientInstance: 'e2e-report-M', ...extra });
}

test('a saved snapshot with per-copy item meta shows catalog names offline', async ({ page, app }, info) => {
  const report = await merchantReport(app);
  await app.deliverStatus(report({ items: coat(3), slots: {} }));
  // The roster keeps the per-copy meta; the dashboard joins the catalog's.
  expect((await app.state()).characterSnapshots.M.items[0]).toEqual({ slot: 0, item: { name: 'coat', level: 3 }, meta: { properties: {} } });
  await app.restartCoordinator();
  expect((await app.state()).characters.M).toBeUndefined();
  await page.goto('/');
  await page.getByRole('button', { name: 'Interface settings', exact: true }).click();
  await page.getByRole('button', { name: 'Inspect M', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Inspect Coat +3', exact: true })).toBeVisible();
  await info.attach('saved-snapshot-entry', { body: JSON.stringify((await app.state()).characterSnapshots.M.items[0]), contentType: 'application/json' });
});

test('a report that omits unchanged inventory keeps it, and an unknown revision answers 409', async ({ page, app }, info) => {
  const report = await merchantReport(app);
  const acknowledged = await app.deliverStatus(report({ items: coat(3), slots: {}, inventoryRevision: 'probe-1' })) as { inventoryRevision?: string };
  expect(acknowledged.inventoryRevision).toBe('probe-1');
  // Reports between inventory changes name the revision and leave the fields out.
  for (let index = 0; index < 3; index++) await app.deliverStatus(report({ hp: 900 + index, inventoryRevision: 'probe-1' }));
  const carried = await inventory(app.url);
  expect(carried.items[0].item).toEqual({ name: 'coat', level: 3 });
  expect((await app.state()).characters.M).toMatchObject({ hp: 902 });
  await page.goto('/');
  const merchant = page.locator('article').filter({ has: page.getByRole('heading', { name: 'M', exact: true }) });
  await expect(merchant.getByText('coat', { exact: true })).toBeVisible();
  // A revision this coordinator never held: the character must resend the inventory.
  await expect(app.deliverStatus(report({ hp: 950, inventoryRevision: 'probe-unknown' }))).rejects.toThrow(/409.*inventory-required/);
  expect((await app.state()).characters.M).toMatchObject({ hp: 902 });
  // The resend with the changed inventory replaces the carried one.
  await app.deliverStatus(report({ items: coat(4), slots: {}, inventoryRevision: 'probe-2' }));
  await app.deliverStatus(report({ inventoryRevision: 'probe-2' }));
  expect((await inventory(app.url)).items[0].item).toEqual({ name: 'coat', level: 4 });
  await info.attach('carried-inventory', { body: JSON.stringify((await inventory(app.url)).items[0]), contentType: 'application/json' });
});

test('a carried bank keeps the bank snapshot until the bank changes', async ({ app }, info) => {
  const report = await merchantReport(app);
  const bank = (names: string[]) => ({ gold: 5000, packs: { items0: names.map((name, slot) => ({ slot, item: { name }, meta: { properties: {} } })) } });
  const section = async () => (await (await fetch(`${app.url}/party-api/state?section=bank&dashboard=1`)).json()).bank;
  await app.deliverStatus(report({ items: coat(3), slots: {}, bank: bank(['bkey']), map: 'bank', inventoryRevision: 'bank-1' }));
  const first = await section();
  expect(first).toMatchObject({ character: 'M', gold: 5000 });
  expect(first.packs.items0.map((entry: any) => entry.item.name)).toEqual(['bkey']);
  // Reports that omit the unchanged bank leave the stored snapshot as it was.
  for (let index = 0; index < 3; index++) await app.deliverStatus(report({ map: 'bank', inventoryRevision: 'bank-1' }));
  expect(await section()).toEqual(first);
  await app.deliverStatus(report({ items: coat(3), slots: {}, bank: bank(['bkey', 'coat']), map: 'bank', inventoryRevision: 'bank-2' }));
  const changed = await section();
  expect(changed.packs.items0.map((entry: any) => entry.item.name)).toEqual(['bkey', 'coat']);
  await info.attach('bank-snapshots', { body: JSON.stringify({ first, changed }), contentType: 'application/json' });
});

// The reply names a ring only while a diagnostics view leases it; then
// the character posts it as its own request. The character's report carries no ring
// (status/character/report.ts has no ring field and rings.ts posts each one apart), so this row
// checks the coordinator's half: the lease and the post.
test('a ring rides only under the diagnostics lease, never in the report', async ({ app }, info) => {
  const report = await merchantReport(app);
  const unleased = await app.deliverStatus(report({})) as { diagnosticsRings?: string[] };
  expect(unleased.diagnosticsRings ?? [], 'no view, no leased ring').toEqual([]);
  const rings = 'movement,turns,targeting,calls,merchant,combat';
  expect((await fetch(`${app.url}/party-api/diagnostics/records?character=M&rings=${rings}`)).ok).toBe(true);
  const leased = await app.deliverStatus(report({})) as { diagnosticsRings?: string[] };
  expect([...(leased.diagnosticsRings ?? [])].sort(), 'every leased ring is named').toEqual(rings.split(',').sort());
  // The gateway takes a POST only from the dashboard's origin.
  const posted = await fetch(`${app.url}/party-api/diagnostics/records`, { method: 'POST', headers: { 'content-type': 'application/json', Origin: app.url },
    body: JSON.stringify({ character: 'M', ring: 'combat', records: [{ at: 2 }], incidents: [] }) });
  expect(posted.ok, 'a leased ring posts').toBe(true);
  await info.attach('df10', { body: JSON.stringify({ unleased, leased }), contentType: 'application/json' });
});
