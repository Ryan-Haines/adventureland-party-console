import { expect, test, type App } from './fixtures';
import { SETTINGS_KINDS_ADDON as ADDON, type FixtureWrite, type Heard } from './fixtures/settings-hooks-addon';

// The settings owner's hooks table. One fixture add-on (e2e/fixtures/settings-hooks-addon.ts) declares a setting of
// each add-on kind and hears every settings notice; each row is one hook or notice on one shared
// run of the console fixture with `fixtureAddon: true`: a write through each route, a refused
// write, an import, a restart. Every 11 hook fires on the coordinator, so the table needs no game
// server. Each step's title is the `fixture` its `HOOKS` row names (runtime/hooks/rows/11-settings.ts).
// The unit rows (`U:`) sit in scripts/tests/hook-registry.test.cjs: the core declaration refused at
// load fails the start, and this fixture runs no character runtime.
type Reply = { status: number; body: any };
async function call(app: App, route: string, body?: unknown, type = 'application/json'): Promise<Reply> {
  const response = await fetch(`${app.url}/party-api/${route}`, body === undefined ? { signal: AbortSignal.timeout(10_000) } : {
    method: 'POST', headers: { 'Content-Type': type, Origin: app.url }, body: typeof body === 'string' ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000) });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}
// The coordinator's clock stamps each notice. The test worker's Date runs on the shared gameplay
// clock once a live test in the same worker installed it, while this coordinator runs on wall time, so
// each window starts at the coordinator's own now.
const now = async (app: App) => (await call(app, 'e2e-settings-hooks', { op: 'now' })).body.now as number;
const heard = async (app: App, since: number) => (await call(app, 'e2e-settings-hooks', { op: 'heard', since })).body as Heard[];
const of = (list: Heard[], hook: string) => list.filter(h => h.hook === hook);
const ask = async (app: App, hook: 'settings.read' | 'settings.write', question: unknown) =>
  (await call(app, 'e2e-settings-hooks', { op: 'ask', hook, args: [question] })).body.answer;
const own = (key: string, value: unknown) => ({ field: 'addons', addon: ADDON, key, value });
const audit = async (app: App): Promise<{ field: string; addon?: string; key?: string; by: string }[]> => (await app.state()).settingsChanges;

test.describe('settings hooks', () => {
  test.use({ fixtureAddon: true });
  test('settings hooks: one fixture add-on registers every hook and event', async ({ app }, info) => {
    test.setTimeout(300_000);
    expect((await call(app, 'addons', { name: ADDON, enabled: true })).status, 'the fixture add-on turns on').toBe(200);
    const since = await now(app), rows: Record<string, unknown> = {};
    try {
      await test.step('L: the add-on writes its own setting, then a core one as console:<name>', async () => {
        const from = (await audit(app)).length;
        const writes: FixtureWrite[] = [{ changes: [own('limit', 7)], by: `addon:${ADDON}` },
          { changes: [{ field: 'targetMode', character: 'W', value: 'farming' }], by: `console:${ADDON}` }];
        for (const write of writes) expect(await ask(app, 'settings.write', write), JSON.stringify(write)).toMatchObject({ ok: true });
        const lines = (await audit(app)).slice(from);
        rows.writes = lines;
        expect(lines.map(l => [l.field, l.key ?? null, l.by])).toEqual(expect.arrayContaining([['addons', 'limit', `addon:${ADDON}`]]));
        expect(lines.filter(l => l.field === 'targetMode').every(l => l.by === `console:${ADDON}`), 'the core write names console:<name>').toBe(true);
      });
      await test.step('L: the add-on reads its own setting and a core one', async () => {
        const addons = await ask(app, 'settings.read', { field: 'addons' }) as Record<string, { settings?: Record<string, unknown> }>;
        expect(addons[ADDON]?.settings?.limit).toBe(7);
        expect(await ask(app, 'settings.read', { field: 'targetMode', character: 'W' })).toBe('farming');
      });
      await test.step('L: a route write, then the same write again: one notice, then none', async () => {
        const at = await now(app);
        for (let i = 0; i < 2; i++) expect((await call(app, 'addons', { name: ADDON, settings: { limit: 9 } })).status).toBe(200);
        await expect.poll(async () => of(await heard(app, at), 'settings.changed').filter(h => h.payload.addon === ADDON && h.payload.key === 'limit').length,
          { timeout: 10_000, intervals: [250] }).toBe(1);
        const changed = of(await heard(app, at), 'settings.changed').find(h => h.payload.key === 'limit')!;
        expect([changed.payload.old, changed.payload.new, changed.payload.by]).toEqual([7, 9, 'dashboard:addons']);
      });
      await test.step('L: a value out of range is refused, naming the field', async () => {
        const at = await now(app), refused = await call(app, 'addons', { name: ADDON, settings: { limit: 500 } });
        expect(refused.status).toBe(400);
        await expect.poll(async () => of(await heard(app, at), 'settings.refused').map(h => h.payload.field), { timeout: 10_000, intervals: [250] })
          .toContainEqual('addons');
      });
      await test.step('L: an import applies its settings and records', async () => {
        const at = await now(app), exported = (await call(app, 'dashboard-state/export')).body.settings;
        const source = JSON.stringify({ format: 'party-console-settings', version: 1, settings: exported });
        const preview = await fetch(`${app.url}/party-api/dashboard-state/preview`, { method: 'POST', headers: { 'Content-Type': 'text/plain', Origin: app.url }, body: source });
        const summary = await preview.json();
        expect(preview.status, JSON.stringify(summary)).toBe(200);
        const imported = await fetch(`${app.url}/party-api/dashboard-state/import`, { method: 'POST',
          headers: { 'Content-Type': 'text/plain', Origin: app.url, 'X-State-Preview': summary.digest }, body: source });
        expect(imported.status).toBe(200);
        await expect.poll(async () => of(await heard(app, at), 'settings.imported').map(h => h.payload.by), { timeout: 10_000, intervals: [250] })
          .toContainEqual('import');
      });
      await test.step('L: a write reaches the disk and survives a restart', async () => {
        const at = await now(app);
        expect((await call(app, 'addons', { name: ADDON, settings: { limit: 11 } })).status).toBe(200);
        await expect.poll(async () => of(await heard(app, at), 'settings.saved').map(h => h.payload.by), { timeout: 10_000, intervals: [250] })
          .toContainEqual('persistence');
        await app.restartCoordinator();
        const listed = (await call(app, 'addons')).body.addons as { name: string; settings: Record<string, { value: unknown }> }[];
        expect(listed.find(a => a.name === ADDON)?.settings.limit?.value).toBe(11);
      });
      // Every notice of the run names its by (14 0.4 part 2).
      expect((await heard(app, since)).filter(h => !h.payload.by).map(h => h.hook), 'every notice names its by').toEqual([]);
    } finally {
      await info.attach('settings-hooks', { body: JSON.stringify({ rows, heard: await heard(app, since).catch(() => []) }), contentType: 'application/json' });
    }
  });
});
