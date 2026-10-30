import { test, expect } from './fixtures';
import { sectionFields, shadowFastOmitted } from '../runtime/coordinator/telemetry/character-fields.ts';

// Field registry behavior through the real coordinator and dashboard
// (docs/state-field-registry.md, Failure inventory items 3, 5, 7 and 11).
// scripts/tests/character-field-registry.test.cjs checks catalog completeness;
// these journeys check what the sections send and what the dashboard shows.

const fast = async (url: string) => (await (await fetch(`${url}/party-api/state?section=fast&dashboard=1`)).json()).characters;
const carried = async (page: import('@playwright/test').Page) =>
  Number(/carried: ([\d,]+)/.exec(await page.getByTitle(/carried: /).getAttribute('title') || '')?.[1].replaceAll(',', ''));

test.describe('enforced field registry', () => {
  test.use({ stateFields: 'enforce' });
  test('the fast section sends only whitelisted fields and the dashboard still reads them', async ({ page, app }, info) => {
    const allowed = new Set<string>(sectionFields.fast);
    await expect.poll(async () => Object.keys(await fast(app.url) || {}).sort()).toEqual(['M', 'P', 'W']);
    const sent = await fast(app.url), full = (await app.state()).characters;
    const fields = Object.fromEntries(Object.entries(sent).map(([name, status]) => [name, Object.keys(status as object)]));
    await info.attach('enforced-fast-fields', { body: JSON.stringify({ fields, full: Object.keys(full.W) }, null, 1), contentType: 'application/json' });
    for (const [name, keys] of Object.entries(fields)) {
      expect(keys.filter(key => !allowed.has(key)), name).toEqual([]);
      expect(keys).toEqual(expect.arrayContaining(['hp', 'max_hp', 'gold', 'map', 'seenAt']));
      // The debug tier keeps every stored field; fast leaves the fixture's debug fields out.
      expect(Object.keys(full[name])).toEqual(expect.arrayContaining(['runtime', 'threats', 'items', ...keys]));
      expect(keys).not.toContain('threats');
    }
    // Without the live stream the dashboard polls section=fast (query-cache.tsx).
    await page.route('**/party-api/dashboard-stream**', route => route.abort());
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'M', exact: true })).toBeVisible();
    await expect(page.getByText('1,000 / 1,000').first()).toBeVisible();
    await expect.poll(() => carried(page)).toBeGreaterThanOrEqual(1_000_000);
  });
});

test('the default shadow mode sends every stored field except the v1.4.0 omit list', async ({ app }, info) => {
  await expect.poll(async () => Object.keys(await fast(app.url) || {}).sort()).toEqual(['M', 'P', 'W']);
  const sent = await fast(app.url), full = (await app.state()).characters;
  const omitted = new Set<string>(shadowFastOmitted);
  await info.attach('shadow-fast-fields', { body: JSON.stringify(Object.keys(sent.M)), contentType: 'application/json' });
  for (const name of ['W', 'P', 'M']) {
    // Both reads come from the same stored status, apart from the fixture heartbeat between them.
    expect(Object.keys(sent[name]).sort()).toEqual(Object.keys(full[name]).filter(key => !omitted.has(key)).sort());
    expect(Object.keys(sent[name])).toEqual(expect.arrayContaining(['runtime', 'threats']));
  }
});
