// The settings table: the rows that start from the console fixture. The console fixture runs the real coordinator and
// dashboard with no game server, restarts and crashes the coordinator, and answers a heartbeat
// with the real reply, which is every setup the settings owner's rows need. Rows that run over
// the declarations read them through e2e/settings-samples.ts, so a setting declared later is
// covered with no change here. Its reset is e2e/fixtures.ts `settingsRowsReset`.
import { appendFileSync, readFileSync } from 'node:fs';
import { expect, type App, type TableRow } from './fixtures';
import { settingSamples, declaredFor, declaredHidden, declaredSettings, secretReads } from './settings-samples';
import { supportedEvents } from '../runtime/events/rules';
import { zones, type Catalog } from '../runtime/hunting/zones';
import { SETTINGS_KINDS_ADDON, SETTINGS_KINDS_MODE } from './fixtures/settings-hooks-addon';
import { installed } from '../.build/addons/runtime';

// The start's migration knows only the entries registered when the coordinator starts: the
// installed add-on folders, not the fixture add-on, which joins after the start. So its add-on case
// takes the first installed target mode entry from the generated list, and names no add-on
//. With none installed, that case is an entry the start does not know.
const startEntry = installed.flatMap(({ registration: r }) => (r.slots ?? [])
  .filter(s => s.slot === 'target-mode' && s.fills === 'choice').map(s => ({ name: r.name, mode: s.mode })))[0];

type Row = TableRow<App>;
type Reply = { status: number; body: any };
async function call(app: App, route: string, body?: unknown): Promise<Reply> {
  const response = await fetch(`${app.url}/party-api/${route}`, body === undefined ? { signal: AbortSignal.timeout(10_000) } : {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: app.url }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}
// Every declared setting's value as the coordinator holds it now.
const listed = async (app: App): Promise<Record<string, unknown>> =>
  Object.fromEntries((await call(app, 'settings')).body.settings.map((s: { field: string; value: unknown }) => [s.field, s.value]));
const auditLines = async (app: App): Promise<any[]> => (await app.state()).settingsChanges;
const groups = async (app: App) => (await call(app, 'tasks')).body.groups.map((g: { id: string; members: string[] }) => ({ id: g.id, members: g.members }));
// Every declared setting at a valid value other than its default, written as one batch.
async function writeSamples(app: App) {
  const samples = settingSamples();
  // The writer holds a Phoenix order to the coordinator's spawn catalog: every Phoenix region once
  // (hunting/saved-fields.ts `phoenixRouteOrder`). The console fixture loads the game's catalog, so
  // the sample is its regions in reverse.
  const catalog = (await app.state()).monsterChoices as Catalog | undefined, phoenix = samples.find(s => s.field === 'phoenixRouteOrder');
  if (catalog?.length && phoenix) {
    phoenix.value = zones(catalog, ['phoenix']).map(z => z.id).reverse();
    expect((phoenix.value as string[]).length, "the catalog's Phoenix regions").toBeGreaterThan(0);
  }
  for (const sample of samples) expect(sample.setting.check?.(sample.value, undefined, catalog?.length ? { spawns: catalog } : undefined) ?? true,
    `${sample.field}'s sample passes its check`).toBe(true);
  for (const sample of samples) expect(sample.value, `${sample.field}'s sample is not its default`).not.toEqual(sample.setting.default);
  const written = await call(app, 'settings', { changes: samples.map(s => ({ field: s.field, value: s.value })) });
  expect(written.status, JSON.stringify(written.body)).toBe(200);
  return Object.fromEntries(samples.map(s => [s.field, s.value]));
}

// DSH-239 and SET-017: the account preference route refuses a bad draft and keeps a saved one
// through a page reload and a coordinator restart.
const accountPreference: Row = ['account preference rejects invalid drafts and survives reload and coordinator restart', async (app, testInfo, page) => {
  const evidence: Record<string, unknown> = { before: await app.state(), exchanges: [] };
  const exchanges = evidence.exchanges as unknown[];
  await page.goto('/');
  const openSettings = async () => {
    // Live cards require the browser's coordinator subscription to be mounted.
    await expect(page.getByRole('heading', { name: 'W', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Interface settings', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Interface settings' })).toBeVisible();
  };
  await openSettings();
  const input = page.getByLabel('Default name for bankboi', { exact: true });
  const initial = await input.inputValue();
  const save = async (value: string, status: number) => {
    await input.fill(value);
    const received = page.waitForResponse(response =>
      new URL(response.url()).pathname.endsWith('/dashboard-preferences') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Save name', exact: true }).click();
    const response = await received;
    // The settings UI consumes only rejected bodies; success is verified against real state.
    const body = response.ok() ? undefined : await response.json();
    exchanges.push({ request: response.request().postDataJSON(), status: response.status(), response: body });
    expect(response.status()).toBe(status);
    return body;
  };
  const rejected = await save('x', 400);
  await expect(page.getByRole('alert').filter({ hasText: rejected.error })).toBeVisible();
  await expect(input).toHaveValue('x');
  expect((await app.state()).bankboiPrefix || '').toBe(initial);
  await save('E2EBank', 200);
  await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: rejected.error })).toHaveCount(0);
  expect((await app.state()).bankboiPrefix).toBe('E2EBank');
  await save('!', 400);
  await expect(input).toHaveValue('!');
  expect((await app.state()).bankboiPrefix).toBe('E2EBank');
  await page.reload();
  await openSettings();
  await expect(input).toHaveValue('E2EBank');
  evidence.afterReload = await app.state();
  await app.restartCoordinator();
  await page.reload();
  await openSettings();
  await expect(input).toHaveValue('E2EBank');
  evidence.afterRestart = await app.state();
  expect((evidence.afterRestart as { bankboiPrefix?: string }).bankboiPrefix).toBe('E2EBank');
  await input.scrollIntoViewIfNeeded();
  await testInfo.attach('persisted-account-setting', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  await testInfo.attach('account-setting-http-and-state', { body: Buffer.from(JSON.stringify(evidence, null, 2)), contentType: 'application/json' });
}];

// A secret setting's value stays off the settings route; its own route reads it back.
const secret = (field: string) => Object.hasOwn(secretReads, field);
async function readBack(app: App) {
  const values = await listed(app);
  for (const [field, { route, key }] of Object.entries(secretReads)) values[field] = (await call(app, route)).body[key];
  // A hidden setting is not listed; the newest saved settings document holds it.
  const saved = savedSettings(app);
  for (const field of declaredHidden()) values[field] = saved[field];
  return values;
}

// Every declared setting, written through the writer, reads back the same after an orderly
// restart and again after a crash.
const survives: Row = ['every declared setting survives a restart and a crash', async (app, info) => {
  const expected = await writeSamples(app);
  const pick = (values: Record<string, unknown>) => Object.fromEntries(Object.keys(expected).map(field => [field, values[field]]));
  await app.restartCoordinator();
  const afterRestart = pick(await readBack(app));
  await app.crashCoordinator();
  const afterCrash = pick(await readBack(app));
  await info.attach('declared-settings-read-back', { body: JSON.stringify({ settings: Object.keys(expected).length, afterRestart, afterCrash }, null, 2), contentType: 'application/json' });
  expect(afterRestart).toEqual(expected);
  expect(afterCrash).toEqual(expected);
}];

// A character's next heartbeat reply, from its own report in the scenario.
const replyFor = async (app: App, name: string) => await app.deliverStatus({ ...(await app.state()).characters.W, name }) as Record<string, any>;

// A change reaches the characters with the next reply and the dashboard with the
// next config read, and the computed reply fields keep their rules (runtime/status/coordinator/reply.ts).
const reachesReaders: Row = ['a change reaches the characters with the next reply', async (app, info) => {
  const reply = (name: string) => replyFor(app, name);
  // Unset, the stuck notice leaves each character at two of its report intervals (null),
  // and the click wait is the decided 5 s.
  const unset = await reply('W');
  expect([unset.movementStuckNoticeMs, unset.movementClickWaitMs], 'the reply before any write').toEqual([null, 5000]);
  const sampled = await writeSamples(app);
  const leader = await reply('W');
  for (const { field, reply: name } of declaredFor('characters')) {
    expect(Object.hasOwn(leader, name), `the reply carries ${name}`).toBe(true);
    if (field in sampled) expect(leader[name], `${name} in the reply`).toEqual(sampled[field]);
  }
  const config = (await call(app, 'state?section=config')).body;
  for (const { field } of declaredFor('dashboard')) {
    expect(Object.hasOwn(config, field), `the config section carries ${field}`).toBe(true);
    if (field in sampled) expect(config[field], `${field} in the config section`).toEqual(sampled[field]);
  }
  const core = (await call(app, 'state?section=core&dashboard=1')).body;
  for (const field of declaredFor('dashboard-core').map(d => d.field).filter(field => !['combatLogs', 'merchantActivity', 'settingsChanges', 'standPriceHistory'].includes(field)))
    expect(Object.hasOwn(core, field), `the core section carries ${field}`).toBe(true);
  // The search radius is the leader's for every member, the event settings are the
  // member's own limits, a BankBoi gets no gathering modes, and no Hunt target shows outside
  // target Hunt. M is the table's seeded BankBoi.
  const member = await reply('P'), bank = await reply('M');
  await info.attach('replies', { body: JSON.stringify({ leader, member, bank }, null, 2), contentType: 'application/json' });
  expect([leader.monsterSearchRadius, member.monsterSearchRadius]).toEqual([300, 300]);
  expect(leader.eventSettings?.goobrawl).toMatchObject({ deathLimit: 2, timeLimitMinutes: 15 });
  expect(leader.gatheringModes).toEqual(['fishing']);
  expect(bank.gatheringModes).toEqual([]);
  expect(leader.huntCombatTarget).toBeNull();
}];

// The routes that write a setting through the writer: for each, a request it accepts, the lines that
// request writes (field, character, source), and a request it refuses before anything is
// written. The route rows run every entry, so a route converted later adds one entry here. `setup`
// writes the settings an entry needs first, such as a leader for a follower's saved mode.
interface RouteWrite { behaviour: string; route: string; setup?: { field: string; value: unknown; character?: string }[]; valid: Record<string, unknown>;
  lines: [field: string, character: string | null][]; by: string; bad?: Record<string, unknown>; refused?: number }
const routeWrites: RouteWrite[] = [
  { behaviour: 'HNT-034', route: 'hunt-settings', valid: { deathThreshold: 3 }, lines: [['huntSettings', null]], by: 'dashboard:hunt-settings',
    bad: { blacklistDeaths: false, deathThreshold: 0 }, refused: 400 },
  // A valid priority list beside a radius the route refuses: the priorities stay as they were.
  { behaviour: 'HNT-043', route: 'focus', valid: { character: 'W', monsterFocus: ['goo'], monsterPriorities: { goo: 7 }, monsterSearchRadius: 250 },
    lines: [['monsterPrioritiesByCharacter', 'W'], ['monsterSearchRadiusByCharacter', 'W']], by: 'dashboard:focus',
    bad: { character: 'W', monsterFocus: ['goo'], monsterPriorities: { goo: 3 }, monsterSearchRadius: 0 }, refused: 400 },
  { behaviour: 'HNT-046, HNT-068', route: 'rare-hunting', valid: { useFieldGenerators: false }, lines: [['passiveHunting', null]], by: 'dashboard:rare-hunting',
    bad: { useFieldGenerators: 'no' }, refused: 400 },
  // GRP-022 and HNT-113: a follower's mode lands in its own profile only, never the leader's scope.
  { behaviour: 'HNT-113, GRP-022', route: 'farming-mode', setup: [{ field: 'leader', value: 'W' }, { field: 'followers', character: 'P', value: true }],
    valid: { character: 'P', mode: 'scatter' }, lines: [['combatMode', 'P']], by: 'dashboard:farming-mode',
    bad: { character: 'P', mode: 'hunt' }, refused: 409 },
  // Step 4b: the merchant and item routes. A whole map setting written by a route carries no
  // character on its line.
  { behaviour: 'MJB-001, MJB-049', route: 'merchant/routine-priorities', valid: { priorities: { fishing: 37 }, enabled: { deliveries: false } },
    lines: [['merchantRoutinePriorities', null], ['merchantAutomations', null]], by: 'dashboard:routine-priorities',
    bad: { priorities: { fishing: 101 }, enabled: { deliveries: false } }, refused: 400 },
  { behaviour: 'MJB-036', route: 'merchant/gather', valid: { mode: 'mining', enabled: true }, lines: [['gatheringModes', null]], by: 'dashboard:merchant-gather',
    bad: { mode: 'logging', enabled: true }, refused: 400 },
  { behaviour: 'INV-009', route: 'market/ignored-items', valid: { action: 'add', name: 'wbook0', level: 1 }, lines: [['marketIgnoredItems', null]],
    by: 'dashboard:market-ignored-items', bad: { action: 'add', name: 'wbook0', level: -1 }, refused: 400 },
  { behaviour: 'INV-060', route: 'restock', valid: { character: 'W', hp: { min: 7, max: 30 } }, lines: [['restockPolicies', 'W']], by: 'dashboard:restock',
    bad: { character: 'W', hp: { min: 30, max: 7 } }, refused: 400 },
  { behaviour: 'INV-117', route: 'merchant/auto-npc-sale', valid: { item: { name: 'hpbelt' }, keep: 1 }, lines: [['autoNpcSales', null]], by: 'dashboard:auto-npc-sale',
    bad: { item: { name: 'hpbelt' }, keep: -1 }, refused: 400 },
  { behaviour: 'INV-117', route: 'merchant/auto-stand', valid: { item: { name: 'ringsj' }, price: 5000 }, lines: [['autoStandMarks', null]], by: 'dashboard:auto-stand',
    bad: { item: { name: 'ringsj' }, price: 0 }, refused: 400 },
  { behaviour: 'INV-013', route: 'merchant/blacklist', valid: { action: 'configure', enabled: false }, lines: [['autoBlacklistMerchants', null]],
    by: 'dashboard:merchant-blacklist', bad: { action: 'configure', enabled: 'no' }, refused: 400 },
  { behaviour: 'INV-016', route: 'merchant/native-stand', valid: { action: 'configure', enabled: true }, lines: [['autoStandBuys', null]],
    by: 'dashboard:native-stand', bad: { action: 'configure', enabled: 'yes' }, refused: 400 },
  { behaviour: 'INV-070', route: 'merchant/bank-sort', valid: { mode: 'request' }, lines: [['bankSortMode', null]], by: 'dashboard:bank-sort',
    bad: { mode: 'sometimes' }, refused: 400 },
  { behaviour: 'MJB-040', route: 'merchant/stand-location', setup: [{ field: 'merchantStandLocation', value: { map: 'main', x: -120, y: 40 } }],
    valid: { map: 'main', x: -63, y: 100 }, lines: [['merchantStandLocation', null]], by: 'dashboard:stand-location', bad: { map: 'jail', x: 0, y: 0 }, refused: 400 },
  // INV-112: the ALData key is a secret setting; its line names it with no values.
  { behaviour: 'INV-112', route: 'aldata/key', valid: {}, lines: [['aldataKey', null]], by: 'dashboard:aldata-key' },
];
async function routeSetup(app: App, entry: RouteWrite) {
  if (entry.setup) expect((await call(app, 'settings', { changes: entry.setup })).status, `${entry.route}'s setup`).toBe(200);
}

// A request with one bad field changes nothing, in memory or after a restart, and
// runs no membership move.
const oneBadField: Row = ['a request with one bad field changes nothing', async (app, info) => {
  const before = await listed(app), lines = (await auditLines(app)).length, groupsBefore = await groups(app);
  const refused = {
    // The console fixture launches no worker, so no leader is valid there; P's Follow switch is
    // the valid field the base route wrote before it refused the order.
    formation: await call(app, 'formation', { character: 'P', follow: !(before.followers as Record<string, boolean>).P, eventPriorities: ['no-such-event'] }),
    config: await call(app, 'config', { threshold: 250_001, buyUpgradeBatchSize: 99 }),
    // The fixture add-on's two kinds that name a character, each bad after a valid field.
    addon: await call(app, 'addons', { name: SETTINGS_KINDS_ADDON, enabled: true, settings: { roles: { W: 'near' }, member: 'Nobody' } }),
    addonRoles: await call(app, 'addons', { name: SETTINGS_KINDS_ADDON, enabled: true, settings: { member: 'W', roles: { Nobody: 'near' } } }),
  };
  await info.attach('refused', { body: JSON.stringify(refused, null, 2), contentType: 'application/json' });
  expect(Object.values(refused).map(r => r.status)).toEqual([400, 400, 400, 400]);
  // Each is refused for its bad field, after a valid one: P's Follow, the threshold, W's role, the member.
  expect([refused.formation.body.error, refused.config.body.error]).toEqual(['invalid event priorities', 'invalid upgrade batch size (1–42)']);
  // The writer checks an add-on value by its kind and names the setting by its label.
  expect(refused.addon.body.error).toBe("Member takes one of the party's fighters");
  expect(refused.addonRoles.body.error).toBe("Roles takes one of the party's fighters");
  expect(await listed(app)).toEqual(before);
  expect(await groups(app), 'a refused formation runs no membership move').toEqual(groupsBefore);
  expect((await auditLines(app)).length, 'a refused write writes no line').toBe(lines);
  // Every converted route refuses its bad request with nothing written.
  const routes: Record<string, unknown> = {};
  for (const entry of routeWrites.filter(entry => entry.bad)) {
    await routeSetup(app, entry);
    const was = await listed(app), from = (await auditLines(app)).length;
    const reply = routes[entry.route] = await call(app, entry.route, entry.bad);
    expect(reply.status, `${entry.route} refuses ${JSON.stringify(entry.bad)}`).toBe(entry.refused);
    expect(await listed(app), `${entry.route}'s refused request changes no setting`).toEqual(was);
    expect((await auditLines(app)).length, `${entry.route}'s refused request writes no line`).toBe(from);
  }
  await info.attach('refused-routes', { body: JSON.stringify(routes, null, 2), contentType: 'application/json' });
  const settled = await listed(app);
  await app.restartCoordinator();
  expect(await listed(app)).toEqual(settled);
}];

// An accepted change writes one line with its old value, new value and source; an
// unchanged value and a refused write write none; the lines survive a restart.
const auditLine: Row = ['every change writes one line naming its source', async (app, info) => {
  const before = await listed(app), from = (await auditLines(app)).length;
  expect((await call(app, 'dashboard-preferences', { bankboiPrefix: 'LineOne' })).status).toBe(200);
  expect((await call(app, 'dashboard-preferences', { bankboiPrefix: 'LineOne' })).status).toBe(200);
  expect((await call(app, 'dashboard-preferences', { bankboiPrefix: 'x' })).status).toBe(400);
  expect((await call(app, 'addons', { name: SETTINGS_KINDS_ADDON, enabled: true })).status).toBe(200);
  const expected = [
    { at: expect.any(Number), field: 'bankboiPrefix', old: before.bankboiPrefix, new: 'LineOne', by: 'dashboard:preferences', basis: null },
    // The switch is one addressed change, so its line names the add-on and key.
    { at: expect.any(Number), field: 'addons', addon: SETTINGS_KINDS_ADDON, key: 'enabled', old: (before.addons as Record<string, { enabled?: boolean }>)[SETTINGS_KINDS_ADDON]?.enabled, new: true, by: 'dashboard:addons', basis: null },
  ];
  const written = (await auditLines(app)).slice(from);
  await app.restartCoordinator();
  const afterRestart = (await auditLines(app)).slice(from);
  await info.attach('audit-lines', { body: JSON.stringify({ written, afterRestart }, null, 2), contentType: 'application/json' });
  expect(written).toEqual(expected);
  expect(afterRestart).toEqual(expected);
  // Every converted route writes one line per changed setting, naming the route. The follower's
  // saved mode is in its own profile, so the party scope's mode stays as it was.
  const routes: Record<string, unknown> = {};
  for (const entry of routeWrites) {
    await routeSetup(app, entry);
    const was = await listed(app), at = (await auditLines(app)).length;
    const reply = await call(app, entry.route, entry.valid);
    expect(reply.status, `${entry.route} accepts ${JSON.stringify(entry.valid)}: ${JSON.stringify(reply.body)}`).toBe(200);
    const now = await listed(app), lines = routes[entry.route] = (await auditLines(app)).slice(at);
    expect(lines.map(l => [l.field, l.character ?? null, l.by]), `${entry.route}'s lines`).toEqual(entry.lines.map(([field, character]) => [field, character, entry.by]));
    for (const line of lines.filter(l => l.character === undefined && !secret(l.field))) expect(line.new, `${line.field}'s line carries its new value`).toEqual(now[line.field]);
    for (const line of lines.filter(l => secret(l.field))) expect(Object.keys(line).sort(), `${line.field}'s line carries no values`).toEqual(['at', 'basis', 'by', 'field']);
    const scoped = ['combatMode', 'targetMode'];
    for (const line of lines.filter(l => l.character !== undefined && !scoped.includes(l.field)))
      expect(line.new, `${line.field}'s line carries ${line.character}'s new value`).toEqual((now[line.field] as Record<string, unknown>)[line.character]);
    if (entry.route === 'farming-mode') expect(scoped.map(f => now[f]), "the party scope's modes").toEqual(scoped.map(f => was[f]));
  }
  await info.attach('route-lines', { body: JSON.stringify(routes, null, 2), contentType: 'application/json' });
}];

// Decided by the user on 2026-11-03: a write whose basis is older than
// a later change of that field is refused, naming the field; another entry, a fresh basis and a
// write with no basis go through. The other page here is the dashboard's own route, which sends a whole event order.
const stalePage: Row = ['a write from a stale page is refused, naming the field', async (app, info) => {
  const basis: number = (await call(app, 'settings')).body.settingsAt;
  const moved = [supportedEvents.at(-1)!, ...supportedEvents.slice(0, -1)], swapped = [supportedEvents[1], supportedEvents[0], ...supportedEvents.slice(2)];
  expect((await call(app, 'formation', { character: 'W', eventPriorities: moved })).status, 'the other page saves first').toBe(200);
  const stale = await call(app, 'settings', { basis, changes: [{ field: 'eventPrioritiesByCharacter', character: 'W', value: swapped }] });
  const other = await call(app, 'settings', { basis, changes: [{ field: 'eventPrioritiesByCharacter', character: 'P', value: swapped }] });
  const fresh: number = (await call(app, 'settings')).body.settingsAt;
  const reloaded = await call(app, 'settings', { basis: fresh, changes: [{ field: 'eventPrioritiesByCharacter', character: 'W', value: swapped }] });
  const lines = (await auditLines(app)).slice(-3);
  await info.attach('stale-page', { body: JSON.stringify({ basis, stale, other, fresh, reloaded, lines }, null, 2), contentType: 'application/json' });
  expect(stale.status).toBe(409);
  // The refusal names the field, says the page was out of date and carries the value the
  // page reloads, the other page's order.
  expect(stale.body).toEqual({ ok: false, field: 'eventPrioritiesByCharacter', character: 'W', reason: 'out of date', current: moved,
    error: 'Event priority order was not saved: this page was out of date, so it shows the current value again' });
  expect([other.status, reloaded.status]).toEqual([200, 200]);
  expect((await listed(app)).eventPrioritiesByCharacter).toMatchObject({ W: swapped, P: swapped });
  expect(lines.map(l => [l.by, l.character, l.basis])).toEqual([['dashboard:formation', 'W', null], ['dashboard:settings', 'P', basis], ['dashboard:settings', 'W', fresh]]);
}];

// The settings that have no route of their own (the stuck notice, the click wait per
// character, the Resume lockout and the resume wait after a clean shutdown) are written through
// the settings route and read back from it, and the two the characters read
// reach them with the next reply, with no restart and no environment value. The Arena safe
// reload row reads the resume wait the console uses (e2e/console-reload-rows.ts).
const noRouteOfTheirOwn: { field: string; value: unknown; character?: string }[] = [
  { field: 'movementStuckNoticeMs', value: 9000 },
  { field: 'movementClickWaitMs', character: 'W', value: 1500 },
  { field: 'movementClickWaitMs', character: 'P', value: 0 },
  { field: 'escapeResumeLockoutMs', value: 7000 },
  { field: 'consoleResumeWaitMs', value: 120000 },
];
const settingsRoute: Row = ['the settings route writes every setting with no route of its own', async (app, info) => {
  const written = await call(app, 'settings', { changes: noRouteOfTheirOwn });
  expect(written.status, JSON.stringify(written.body)).toBe(200);
  const values = await listed(app);
  // The list leaves out each hidden setting
  // and shows every other one.
  expect(declaredHidden().length, 'movement declares hidden settings').toBeGreaterThan(0);
  expect(declaredHidden().filter(field => field in values), 'a hidden setting the list shows').toEqual([]);
  expect(declaredSettings().filter(field => !declaredHidden().includes(field) && !(field in values)), 'a player setting the list leaves out').toEqual([]);
  const reply = (name: string) => replyFor(app, name);
  const replies = { W: await reply('W'), P: await reply('P'), M: await reply('M') };
  await info.attach('settings-route', { body: JSON.stringify({ written: written.body, values, replies }, null, 2), contentType: 'application/json' });
  for (const { field, value, character } of noRouteOfTheirOwn)
    expect(character === undefined ? values[field] : (values[field] as Record<string, unknown>)[character], `${field}${character ? ` for ${character}` : ''} reads back`).toEqual(value);
  // Each character's next reply carries the stuck notice and its own click wait; M has no entry,
  // so it waits the decided 5 s.
  expect(Object.fromEntries(Object.entries(replies).map(([name, r]) => [name, [r.movementStuckNoticeMs, r.movementClickWaitMs]])))
    .toEqual({ W: [9000, 1500], P: [9000, 0], M: [9000, 5000] });
  // The tasks owner moves members on `settings.changed`, so a leader and Follow change written through
  // the settings route moves P at once, before any report rebuilds the groups.
  const inParty = async () => !!(await groups(app)).find((g: { id: string; members: string[] }) => g.id === 'party:W')?.members.includes('P');
  for (const follow of [true, false]) {
    const moved = await call(app, 'settings', { changes: [{ field: 'leader', value: 'W' }, { field: 'followers', character: 'P', value: follow }] });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect(await inParty(), `P ${follow ? 'joins' : 'leaves'} W's group with the write`).toBe(follow);
  }
}];

// The add-on test's row: every installed
// add-on's settings, read from the add-on route, save through it with one audit line, reach the
// characters with the next reply and survive a restart; the importable ones travel through the
// export and come back with the import, and the rest stay out of the export. A setting an add-on
// declares later is covered with no change here.
type AddonSetting = { kind: string; default: unknown; choices?: string[]; characters?: string[]; min?: number; max?: number; importable?: boolean;
  scope?: 'scope'; fields?: Record<string, AddonSetting> };
function addonSample(setting: AddonSetting): unknown {
  const other = (choices: string[] | undefined, not: unknown) => choices?.find(choice => choice !== not);
  switch (setting.kind) {
    case 'boolean': return !setting.default;
    case 'number': { const up = Number(setting.default) + 1; return up <= (setting.max ?? Infinity) ? up : Number(setting.default) - 1; }
    case 'choice': case 'character': return other(setting.choices, setting.default);
    case 'per-character': { const name = setting.characters![0]!; return { [name]: other(setting.choices, (setting.default as Record<string, unknown>)[name]) }; }
    case 'text': return String(setting.default ?? '') + 'sample';
    // npc-orders' `orders` is one: the sample is one record that sets every declared field. A
    // record's field has no default of its own.
    case 'records': return [Object.fromEntries(Object.entries(setting.fields ?? {}).map(([key, field]) =>
      [key, field.kind === 'number' ? field.min ?? 1 : field.kind === 'choice' ? field.choices![0] : addonSample(field)]))];
    default: throw Error(`No add-on sample for the kind ${setting.kind}`);
  }
}
async function importSettings(app: App, settings: unknown) {
  const source = JSON.stringify({ format: 'party-console-settings', version: 1, settings }), headers = { 'Content-Type': 'text/plain', Origin: app.url };
  const preview = await fetch(`${app.url}/party-api/dashboard-state/preview`, { method: 'POST', headers, body: source, signal: AbortSignal.timeout(10_000) });
  const summary = await preview.json();
  expect(preview.status, JSON.stringify(summary)).toBe(200);
  const imported = await fetch(`${app.url}/party-api/dashboard-state/import`, { method: 'POST', headers: { ...headers, 'X-State-Preview': summary.digest }, body: source,
    signal: AbortSignal.timeout(10_000) });
  expect(imported.status, await imported.text()).toBe(200);
}
const addonSettings: Row = ['every add-on setting saves, reaches the reply, survives a restart and travels through the export', async (app, info) => {
  type Listed = { name: string; settings: Record<string, AddonSetting & { value: unknown }> };
  // The add-on route saves the account settings. A setting placed per farming scope saves through
  // the `addonSettings` field with its character (settings/coordinator/writer.ts `addressed`), which the declared
  // rows' `addonSettings` sample and hook-registry.test.cjs cover.
  const account = (a: Listed): Listed => ({ ...a, settings: Object.fromEntries(Object.entries(a.settings).filter(([, s]) => s.scope !== 'scope')) });
  const addons = async () => ((await call(app, 'addons')).body.addons as Listed[]).map(account);
  const installed = (await addons()).filter(a => Object.keys(a.settings).length), before = (await listed(app)).addons;
  const samples = Object.fromEntries(installed.map(a => [a.name, Object.fromEntries(Object.entries(a.settings).map(([key, s]) => [key, addonSample(s)]))]));
  const importable = Object.fromEntries(installed.map(a => [a.name, Object.fromEntries(Object.entries(samples[a.name]!).filter(([key]) => a.settings[key]!.importable))])
    .filter(([, settings]) => Object.keys(settings).length).map(([name, settings]) => [name, { settings }]));
  const values = async () => Object.fromEntries((await addons()).filter(a => a.name in samples).map(a => [a.name,
    Object.fromEntries(Object.keys(samples[a.name]!).map(key => [key, a.settings[key]!.value]))]));
  const from = (await auditLines(app)).length;
  for (const a of installed) expect((await call(app, 'addons', { name: a.name, settings: samples[a.name] })).status, `${a.name}'s settings save`).toBe(200);
  const lines = (await auditLines(app)).slice(from);
  const reports = (await app.state()).characters;
  const reply = await app.deliverStatus({ ...reports.W, name: 'W' }) as { addons?: Record<string, { settings?: Record<string, unknown> }> };
  const saved = await values();
  await app.restartCoordinator();
  const afterRestart = await values(), exported = (await call(app, 'dashboard-state/export')).body.settings.addons ?? {};
  // The import brings the importable settings back after the add-ons return to their saved state.
  expect((await call(app, 'settings', { changes: [{ field: 'addons', value: before }] })).status).toBe(200);
  const importedFrom = (await auditLines(app)).length;
  if (Object.keys(importable).length) await importSettings(app, { addons: exported });
  const afterImport = await values(), importLines = (await auditLines(app)).slice(importedFrom);
  await info.attach('addon-settings', { body: JSON.stringify({ samples, lines, saved, afterRestart, exported, afterImport, importLines }, null, 2), contentType: 'application/json' });
  // One line per saved key: each posted key is one addressed change.
  expect(new Set(lines.map(l => [l.field, l.by].join(' '))), 'every add-on save line names the route').toEqual(new Set(installed.length ? ['addons dashboard:addons'] : []));
  for (const a of installed) for (const [key, value] of Object.entries(samples[a.name]!))
    expect(reply.addons?.[a.name]?.settings?.[key], `${a.name}.${key} in the next reply`).toEqual(value);
  expect(saved).toEqual(samples);
  expect(afterRestart).toEqual(samples);
  expect(exported, 'the export carries the importable add-on settings only').toEqual(importable);
  for (const [name, { settings }] of Object.entries(importable as Record<string, { settings: Record<string, unknown> }>)) for (const [key, value] of Object.entries(settings))
    expect(afterImport[name]![key], `${name}.${key} after the import`).toEqual(value);
  expect(new Set(importLines.map(l => [l.field, l.by].join(' ')))).toEqual(new Set(Object.keys(importable).length ? ['addons import'] : []));
}];

// A change made while the console is paused stays at Play, and Play writes no setting.
const whilePaused: Row = ['a change while paused stays at Play', async (app, info) => {
  const before = await listed(app), from = (await auditLines(app)).length;
  expect((await call(app, 'console-control/pause', {})).body.paused).toBe(true);
  expect((await call(app, 'dashboard-preferences', { anniversaryAutoChat: !before.anniversaryAutoChat })).status).toBe(200);
  expect((await call(app, 'console-control/play', {})).body.paused).toBe(false);
  const after = await listed(app), lines = (await auditLines(app)).slice(from);
  await info.attach('paused-change', { body: JSON.stringify({ lines }, null, 2), contentType: 'application/json' });
  expect(after).toEqual({ ...before, anniversaryAutoChat: !before.anniversaryAutoChat });
  expect(lines.map(l => [l.field, l.by])).toEqual([['anniversaryAutoChat', 'dashboard:preferences']]);
}];

// The slot fields. `modes` reads each scope's pair and
// the single mode it saves for v1.4.0 from the full state; `slotLines` the slot fields' audit
// lines since `from`.
const SETTINGS_KEY = 'party_dashboard_settings_state_v1';
const modes = async (app: App, names: string[]) => Object.fromEntries(Object.entries((await app.state()).farmingProfiles as Record<string, any>)
  .filter(([name]) => names.includes(name)).map(([name, p]) => [name, [p.combatMode, p.targetMode, p.farmingPolicy]]));
const slotLines = async (app: App, from: number) => (await auditLines(app)).slice(from)
  .filter(l => ['combatMode', 'targetMode'].includes(l.field)).map(l => [l.field, l.character ?? null, l.old, l.new, l.by]);
// The newest saved settings document in the scenario's journal.
function savedSettings(app: App): Record<string, any> {
  const line = readFileSync(app.journal, 'utf8').split('\n').filter(l => l.startsWith(`{"${SETTINGS_KEY}":`)).at(-1);
  return line ? JSON.parse(line)[SETTINGS_KEY] : {};
}
// Rewrites the newest saved settings document while the coordinator is down, as an older build
// or a rolled-back v1.4.0 run leaves it.
function rewriteSettings(app: App, edit: (doc: any) => void) {
  const doc = savedSettings(app);
  edit(doc);
  appendFileSync(app.journal, JSON.stringify({ [SETTINGS_KEY]: doc }) + '\n');
}
// Every scope's save as a build before the split left it: one single mode and no pair.
const beforeSplit = (policies: Record<string, string>) => (doc: any) => {
  for (const scope of [doc, ...Object.values(doc.farmingProfiles ?? {}) as any[]]) { delete scope.combatMode; delete scope.targetMode; }
  for (const [name, policy] of Object.entries(policies)) (doc.farmingProfiles[name] ??= {}).farmingPolicy = policy;
  doc.farmingPolicy = policies.W;
};
// The pair each old single mode loads as, and the lines its migration writes: one per field it
// changes from the defaults (Auto, Farming), so Auto and an unknown mode write none.
const migrations: [policy: string, pair: [string, string], changed: string[]][] = [
  ['scatter', ['scatter', 'farming'], ['combatMode']], ['hunt', ['auto', 'hunt'], ['targetMode']], ['bogus', ['auto', 'farming'], []],
  ['default', ['default', 'farming'], ['combatMode']], startEntry ? [startEntry.mode, ['auto', startEntry.mode], ['targetMode']] : ['unregistered', ['auto', 'farming'], []], ['auto', ['auto', 'farming'], []],
];
const derived = ([combat, target]: [string, string]) => target === 'farming' ? combat : target;

// Old saved modes load as their pair once, for the party scope (W, the leader), a solo
// scope (P with Follow off) and M's profile, with one line per changed field by
// `migration:slots`; a second start migrates nothing. The fixture add-on's entry is an add-on's
// entry, so the add-on is on for the start.
const oldModes: Row = ['old saved modes load as their pair once', async (app, info) => {
  expect((await call(app, 'settings', { changes: [{ field: 'leader', value: 'W' }, { field: 'followers', character: 'P', value: false },
    ...(startEntry ? [{ field: 'addons', value: { [startEntry.name]: { enabled: true, settings: {} } } }] : [])] })).status).toBe(200);
  const names = ['W', 'P', 'M'], runs = [];
  for (const batch of [migrations.slice(0, 3), migrations.slice(3)]) {
    const from = (await auditLines(app)).length;
    await app.restartCoordinator();
    await app.crashCoordinator(() => rewriteSettings(app, beforeSplit(Object.fromEntries(names.map((name, i) => [name, batch[i]![0]])))));
    const loaded = await modes(app, names), lines = await slotLines(app, from);
    await app.restartCoordinator();
    const again = await slotLines(app, from);
    runs.push({ batch, loaded, lines, again });
    expect(loaded, `${batch.map(b => b[0])} load as their pairs`).toEqual(Object.fromEntries(names.map((name, i) => [name, [...batch[i]![1], derived(batch[i]![1])]])));
    expect(lines.map(l => l.slice(0, 2)).sort(), 'one line per changed field').toEqual(names.flatMap((name, i) => batch[i]![2].map(field => [field, name])).sort());
    expect(lines.every(l => l[4] === 'migration:slots'), 'the lines name the migration').toBe(true);
    expect(again, 'a second start migrates nothing').toEqual(lines);
  }
  await info.attach('slot-migration', { body: JSON.stringify(runs, null, 2), contentType: 'application/json' });
}];

// A mode changed under a rolled-back v1.4.0 build wins on the roll forward. v1.4.0 saves
// only the single mode: its settings document drops the top-level pair and keeps each profile's
// stale pair beside the mode it wrote. A scope whose mode v1.4.0 left alone keeps its pair.
const rollForward: Row = ['a mode changed under v1.4.0 loads as its pair after the roll forward', async (app, info) => {
  expect((await call(app, 'settings', { changes: [{ field: 'leader', value: 'W' }, { field: 'followers', character: 'P', value: false },
    { field: 'combatMode', character: 'W', value: 'default' }, { field: 'targetMode', character: 'W', value: 'hunt' },
    { field: 'combatMode', character: 'P', value: 'scatter' }, { field: 'targetMode', character: 'P', value: 'farming' }] })).status).toBe(200);
  const from = (await auditLines(app)).length;
  await app.restartCoordinator();
  const saved = await modes(app, ['W', 'P']);
  await app.crashCoordinator(() => rewriteSettings(app, doc => { delete doc.combatMode; delete doc.targetMode; doc.farmingProfiles.P.farmingPolicy = 'default'; }));
  const loaded = await modes(app, ['W', 'P']), lines = await slotLines(app, from);
  await info.attach('roll-forward', { body: JSON.stringify({ saved, loaded, lines }, null, 2), contentType: 'application/json' });
  expect(saved).toEqual({ W: ['default', 'hunt', 'hunt'], P: ['scatter', 'farming', 'scatter'] });
  expect(loaded).toEqual({ W: ['default', 'hunt', 'hunt'], P: ['default', 'farming', 'default'] });
  expect(lines.filter(l => l[4] === 'migration:slots')).toEqual([['combatMode', 'P', 'scatter', 'default', 'migration:slots']]);
}];

// Each slot field writes alone, any pair is valid, a value of the other slot is
// refused with nothing written, and the old single `mode` keeps its meaning: a combat mode sets
// that combat mode and target Farming, an add-on's target sets that target and leaves the
// combat mode.
const slotWrites: Row = ['the two fields write alone, and the old single mode keeps its meaning', async (app, info) => {
  const mode = (body: Record<string, unknown>) => call(app, 'farming-mode', { character: 'W', ...body });
  const steps: [string, number, unknown][] = [];
  // W's own profile starts at the defaults: the table's reset writes the party scope only.
  expect((await call(app, 'settings', { changes: [{ field: 'combatMode', character: 'W', value: 'auto' }, { field: 'targetMode', character: 'W', value: 'farming' }] })).status).toBe(200);
  const step = async (label: string, reply: Promise<Reply>) => { const r = await reply; steps.push([label, r.status, (await modes(app, ['W'])).W]); };
  await step('combat Scatter alone', mode({ combatMode: 'scatter' }));
  await step('a combat mode for the target', mode({ targetMode: 'scatter' }));
  await step('a target for the combat mode', mode({ combatMode: 'hunt' }));
  await step('Default with Hunt, any pair', call(app, 'settings', { changes: [{ field: 'combatMode', character: 'W', value: 'default' }, { field: 'targetMode', character: 'W', value: 'hunt' }] }));
  await step('the old mode Scatter', mode({ mode: 'scatter' }));
  expect((await call(app, 'addons', { name: SETTINGS_KINDS_ADDON, enabled: true })).status).toBe(200);
  await step('the old mode of an add-on entry', mode({ mode: SETTINGS_KINDS_MODE }));
  await step('target Farming alone', mode({ targetMode: 'farming' }));
  await info.attach('slot-writes', { body: JSON.stringify(steps, null, 2), contentType: 'application/json' });
  expect(steps).toEqual([
    ['combat Scatter alone', 200, ['scatter', 'farming', 'scatter']],
    ['a combat mode for the target', 400, ['scatter', 'farming', 'scatter']],
    ['a target for the combat mode', 400, ['scatter', 'farming', 'scatter']],
    ['Default with Hunt, any pair', 200, ['default', 'hunt', 'hunt']],
    ['the old mode Scatter', 200, ['scatter', 'farming', 'scatter']],
    ['the old mode of an add-on entry', 200, ['scatter', SETTINGS_KINDS_MODE, SETTINGS_KINDS_MODE]],
    ['target Farming alone', 200, ['scatter', 'farming', 'scatter']],
  ]);
}];

// A monster picked by hand switches the target to Farming and leaves the combat mode,
// with one line by `console:hunts`. The pick resets the mode before it starts the party's walk
// (navigation/monster-selection.ts `select`), and the console fixture runs no game, so the walk
// does not start and the route answers 409 after the switch.
const handPick: Row = ['a monster picked by hand keeps the combat mode', async (app, info) => {
  const reports = (await app.state()).characters;
  expect((await call(app, 'settings', { changes: [{ field: 'leader', value: 'W' },
    { field: 'combatMode', character: 'W', value: 'scatter' }, { field: 'targetMode', character: 'W', value: 'hunt' }] })).status).toBe(200);
  await app.deliverStatus({ ...reports.W, name: 'W' });
  const from = (await auditLines(app)).length;
  const picked = await call(app, 'navigate-to-monster', { monsterId: 'goo' });
  const after = (await modes(app, ['W'])).W, lines = await slotLines(app, from);
  await info.attach('hand-pick', { body: JSON.stringify({ picked, after, lines }, null, 2), contentType: 'application/json' });
  expect([picked.status, picked.body], 'the walk cannot start with no game').toEqual([409, { error: 'the party convoy could not be started' }]);
  expect(after).toEqual(['scatter', 'farming', 'scatter']);
  expect(lines).toEqual([['targetMode', 'W', 'hunt', 'farming', 'console:hunts']]);
}];

export const settingsRows: Row[] = [accountPreference, survives, reachesReaders, oneBadField, auditLine, stalePage, whilePaused, settingsRoute, addonSettings,
  oldModes, rollForward, slotWrites, handPick];
