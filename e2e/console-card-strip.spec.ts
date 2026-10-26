import { test, expect } from './fixtures';
import { fetchFullState } from './state-route';
import path from 'node:path';
type Page = import('@playwright/test').Page;

// Failure inventory for the pinned card name strip: it never appears, it
// stays after the card top scrolls back, it sits under or over the party
// header instead of directly below it, it shows another card's name, it
// makes the header taller, its docked map pushes the card layout, covers the
// header, closes while the user works in the card below it, or loses the
// map's own expand and screenshot controls. Activity labels: a label that
// follows per-second movement or targets flickers inside a phase, or lags a
// phase change by more than a poll.

// Screenshots for review go to STRIP_SCREENSHOTS when it is set.
const shots = process.env.STRIP_SCREENSHOTS;
async function shoot(page: Page, info: import('@playwright/test').TestInfo, name: string) {
  const body = await page.screenshot({ animations: 'disabled' });
  await info.attach(name, { body, contentType: 'image/png' });
  if (shots) await page.screenshot({ animations: 'disabled', path: path.join(shots, `${name}.png`) });
}
const strip = (page: Page, name: string) => page.locator(`[data-card-name-strip="${name}"]`);
const card = (page: Page, name: string) => page.locator('article').filter({ has: page.getByRole('heading', { name, exact: true }) });
async function box(page: Page, selector: string) {
  return page.locator(selector).first().evaluate(element => {
    const { top, bottom, left, width, height } = element.getBoundingClientRect();
    return { top, bottom, left, width, height };
  });
}
async function open(page: Page) {
  await page.goto('/');
  await expect(page.locator('[data-party-header]').getByRole('heading', { name: 'Party Console' })).toBeVisible({ timeout: 60_000 });
  for (const name of ['W', 'P', 'M']) await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  // The fixture party is short; padding keeps every scroll position reachable.
  await page.evaluate(() => { const spacer = document.createElement('div'); spacer.style.height = '4000px'; document.querySelector('[data-party-console-root]')!.append(spacer); });
}
/** Scrolls until `name`'s card top sits `depth` px above the header bottom. */
async function scrollUnder(page: Page, name: string, depth = 400) {
  // The console restores each view's scroll position shortly after mount, so scroll until it holds.
  await expect(async () => {
    await card(page, name).evaluate((element, depth) => {
      const header = document.querySelector('[data-party-header]')!.getBoundingClientRect().height;
      window.scrollTo({ top: window.scrollY + element.getBoundingClientRect().top - header + depth, behavior: 'instant' });
    }, depth);
    // party-console.tsx restores a saved scroll position on timers up to 500 ms after mount; check after they fire.
    await page.waitForTimeout(600);
    const top = await card(page, name).evaluate(element => element.getBoundingClientRect().top);
    const header = (await box(page, '[data-party-header]')).height;
    expect(Math.abs(top - (header - depth))).toBeLessThan(2);
  }).toPass({ timeout: 15_000 });
}

for (const viewport of [{ name: 'desktop', width: 1460, height: 900 }, { name: 'phone', width: 390, height: 844 }])
  test(`each card pins its name strip under the party header while its top is scrolled away (${viewport.name})`, async ({ page, app }, info) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await open(page);
    const state = await app.state();
    for (const name of ['W', 'P', 'M']) await expect(strip(page, name)).toBeHidden();
    const header = await box(page, '[data-party-header]');
    await scrollUnder(page, 'W', viewport.name === 'desktop' ? 700 : 400);
    const columns = viewport.name === 'desktop' ? ['W', 'P', 'M'] : ['W'];
    for (const name of columns) {
      const character = state.characters[name];
      const pinned = strip(page, name);
      await expect(pinned).toBeVisible();
      await expect(pinned).toContainText(name);
      const kind = `${character.level} ${character.ctype.charAt(0).toUpperCase()}${character.ctype.slice(1)} ${String(character.primaryStat || '').toUpperCase()}`.trim();
      await expect(pinned).toContainText(kind);
      const line = await pinned.locator('[data-card-strip-line]').evaluate(element => element.getBoundingClientRect());
      expect(Math.abs(line.top - header.height), `${name} strip sits directly below the header`).toBeLessThan(1.5);
      // Two lines: identity and location, then the activity label on its own line.
      expect(line.height).toBeLessThanOrEqual(46);
      // The strip belongs to its own column.
      const column = await card(page, name).evaluate(element => element.getBoundingClientRect());
      expect(Math.abs(line.left - column.left)).toBeLessThan(2);
      expect(Math.abs(line.width - column.width)).toBeLessThan(3);
    }
    if (viewport.name === 'phone') {
      // P's card top is still below the viewport, so only the scrolled card pins a strip.
      await expect(strip(page, 'P')).toBeHidden();
      expect(header.height + 46, 'The header and strip stay under a quarter of the screen').toBeLessThan(viewport.height * 0.25);
    }
    expect((await box(page, '[data-party-header]')).height, 'The strip leaves the header height alone').toBe(header.height);
    await shoot(page, info, `card-strip-${viewport.name}`);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    for (const name of ['W', 'P', 'M']) await expect(strip(page, name)).toBeHidden();
  });

/**
 * Replays recorded coordinator phase objects through the dashboard's own
 * core and fast polls. The shapes come from read-only samples of the live
 * console on 2026-10-25 (a Graveyard Rising exit followed by a Monster Hunt
 * trip to winter_cave); fixture names W and P stand in for the fighters.
 * The live stream is closed so per-character vitals arrive through `fast`.
 */
async function phaseFeed(page: Page) {
  let party: Record<string, unknown> = {}, details: Record<string, Record<string, unknown>> = {},
    vitals: Record<string, Record<string, unknown>> = {};
  const feed = { served: 0,
    set(next: { party?: Record<string, unknown>; details?: typeof details; vitals?: typeof vitals }) {
      party = next.party || {}; details = next.details || {}; vitals = next.vitals || {};
    } };
  await page.route('**/party-api/dashboard-stream**', route => route.abort());
  await page.route(url => url.pathname.endsWith('/party-api/state'), async route => {
    const section = new URL(route.request().url()).searchParams.get('section');
    if (section !== 'core' && section !== 'fast') return route.continue();
    const response = await fetchFullState(route);
    const body = await response.json();
    if (section === 'core') {
      Object.assign(body, party);
      for (const [name, fields] of Object.entries(details)) Object.assign(body.characterDetails[name] ||= {}, fields);
      feed.served++;
    } else for (const [name, fields] of Object.entries(vitals)) Object.assign(body.characters[name] ||= {}, fields);
    await route.fulfill({ response, json: body });
  });
  return feed;
}
const activity = (page: Page, name: string) => strip(page, name).locator('[data-card-activity]');
type Feed = Awaited<ReturnType<typeof phaseFeed>>;
/** The label must change on the first core poll that carries the new phase. */
async function expectPhase(page: Page, feed: Feed, name: string, label: string) {
  const start = feed.served;
  await expect.poll(() => activity(page, name).textContent(), { timeout: 10_000, intervals: [50] }).toBe(label);
  expect(feed.served - start, `"${label}" appeared on the first poll after the phase started`).toBeLessThanOrEqual(2);
  // The label has its own line so it reads in full instead of truncating.
  expect(await activity(page, name).evaluate(element => element.scrollWidth <= element.clientWidth), `"${label}" fits without truncation`).toBe(true);
}
/** Each variant is a retarget, kill or short move inside one phase; the label never changes. */
async function expectStable(page: Page, feed: Feed, name: string, label: string, variants: Parameters<Feed['set']>[0][]) {
  for (const variant of variants) {
    feed.set(variant);
    const start = feed.served, seen = new Set<string>();
    while (feed.served < start + 2) { seen.add(String(await activity(page, name).textContent())); await page.waitForTimeout(50); }
    seen.add(String(await activity(page, name).textContent()));
    expect([...seen], 'The label stays put inside a phase').toEqual([label]);
  }
}

test('the strip activity follows the coordinator task and phase, not per-second movement', async ({ page, app }, info) => {
  await page.setViewportSize({ width: 1460, height: 900 });
  const feed = await phaseFeed(page);
  await open(page);
  await scrollUnder(page, 'W', 700);
  const catalog = (await app.state()).bestiaryCatalog as { id: string; name: string }[];
  const monster = (id: string) => catalog.find(entry => entry.id === id)!.name;
  const pompom = monster('bbpompom');
  const fighters = ['W', 'P'];
  const missions = [{ target: 'bbpompom', owners: ['W'], skipped: false }];
  const hunt = (stage: string, message: string) => ({ version: 2, cycleId: 'hunt-1792935590955-1792896033208', stage,
    participants: fighters, missions, currentIndex: 0, target: 'bbpompom', message, startedAt: 1792935590955 });
  const frozenCave = { map: 'winter_cave', mapName: 'Frozen Cave', x: 51, y: -164, boundary: [-234, -300, 336, -28], monsterIds: ['bbpompom'] };
  const eventLeg = (id: string, phase: string, walkingEvent: string, location: object) => ({ id, phase, label: 'event walking leg',
    purpose: 'shared-walk', participants: fighters, walkingActivity: 'event', walkingEvent, location });
  const huntConvoy = (phase: string) => ({ id: 'convoy-1792975190530-1792974068340', phase, label: 'Monster Hunt: bbpompom',
    purpose: 'monster-hunt', participants: fighters, location: frozenCave });
  const at = (map: string, x: number, y: number, target: string | null = null) => ({ W: { map, x, y, target }, P: { map, x, y, target } });
  const graveyard = { W: { activeEvent: 'graveyard', joinedEvent: 'graveyard' }, P: { activeEvent: 'graveyard', joinedEvent: 'graveyard' } };
  // The fixture's own farming profiles would override the replayed top-level phases, so each step replaces them.
  const profile = (patch: object = {}) => ({ monsterHunt: null, activeConvoy: null, farmAreaState: null, combatRecovery: null, eventReturn: null,
    rareHuntState: null, partyFarmingMode: null, partyFarmingMonsterType: null, eventSession: null, ...patch });
  const phases = (patch: object = {}) => ({ profiles: {}, attendance: {}, characters: {}, escape: null, dungeon: null, ...patch });
  const quiet = { farmAreaState: { active: null }, monsterHunt: null, activeConvoy: null, eventReturn: null, merchantCurrent: null, activityPhases: phases() };

  // 1. Fighting the event: walking legs to the event map itself every few seconds stay inside the phase.
  const spooky = { map: 'spookytown', x: 255, y: -1425 };
  feed.set({ party: { ...quiet, monsterHunt: hunt('paused-event', 'Paused for combat event'),
    activeConvoy: eventLeg('convoy-1792974877895-1792974068108', 'scheduled', 'graveyard', spooky) }, details: graveyard, vitals: at('spookytown', 255, -1425, '1167902') });
  await expectPhase(page, feed, 'W', 'Fighting event - Graveyard Rising');
  await expectStable(page, feed, 'W', 'Fighting event - Graveyard Rising', [
    { party: { ...quiet, monsterHunt: hunt('paused-event', 'Paused for combat event'), activeConvoy: eventLeg('convoy-1792974885878-1792974068112', 'shared-prepare', 'graveyard', spooky) }, details: graveyard, vitals: at('spookytown', 381, -1526, '1167906') },
    { party: { ...quiet, monsterHunt: hunt('paused-event', 'Paused for combat event'), activeConvoy: eventLeg('convoy-1792974925879-1792974068147', 'travel', 'graveyard', spooky) }, details: graveyard, vitals: at('spookytown', 274, -1473, '1167900') },
    { party: { ...quiet, monsterHunt: hunt('paused-event', 'Paused for combat event') }, details: graveyard, vitals: at('spookytown', 260, -1430, null) },
  ]);
  // 2. The event ends: Town out, then the event-return walking leg.
  feed.set({ party: { ...quiet, monsterHunt: hunt('paused-event', 'Waiting for fresh Main town arrival: W'),
    eventReturn: { phase: 'evacuating', cycleId: 'event-return-1792975143541-1792974068321', event: 'graveyard', participants: fighters, pending: fighters } },
    details: { W: { activeEvent: null, joinedEvent: 'graveyard' } }, vitals: at('spookytown', 255, -1425) });
  await expectPhase(page, feed, 'W', 'Leaving event - Graveyard Rising');
  feed.set({ party: { ...quiet, monsterHunt: hunt('paused-event', 'Waiting for fresh Main town arrival: W'),
    activeConvoy: { id: 'convoy-1792975147614-1792974068326', phase: 'shared-prepare', label: 'event-return walking leg', purpose: 'shared-walk-return',
      participants: fighters, walkingActivity: 'event-return', location: { map: 'main', x: 0, y: 0 } } }, vitals: at('spookytown', 255, -1425) });
  await expectPhase(page, feed, 'W', 'Returning from event');
  // 3. The hunt resumes: regroup, then travel, on the first poll of each convoy phase.
  feed.set({ party: { ...quiet, monsterHunt: hunt('mission-travel', 'Monster Hunt: bbpompom'), activeConvoy: huntConvoy('shared-prepare') }, vitals: at('main', 0, 0) });
  await expectPhase(page, feed, 'W', 'Regrouping for travel');
  feed.set({ party: { ...quiet, monsterHunt: hunt('mission-travel', 'Monster Hunt: bbpompom'), activeConvoy: huntConvoy('travel') }, vitals: at('main', 40, 10) });
  await expectPhase(page, feed, 'W', `Travelling to Hunt target - ${pompom}`);
  await expectStable(page, feed, 'W', `Travelling to Hunt target - ${pompom}`, [
    { party: { ...quiet, monsterHunt: hunt('mission-travel', 'Monster Hunt: bbpompom'), activeConvoy: huntConvoy('travel') }, vitals: at('winterland', 120, -400) },
    // Between legs the convoy is briefly absent while the stage stays mission-travel.
    { party: { ...quiet, monsterHunt: hunt('mission-travel', 'Monster Hunt: bbpompom') }, vitals: at('winterland', 600, -900) },
  ]);
  feed.set({ party: { ...quiet, monsterHunt: hunt('mission-travel', 'Monster Hunt: bbpompom'), activeConvoy: huntConvoy('hunt-arrival') }, vitals: at('winter_cave', 51, -164) });
  await expectPhase(page, feed, 'W', `Arriving at Hunt target - ${pompom}`);
  // 4. Arrival switches to fighting; retargets, kills and short moves keep it.
  feed.set({ party: { ...quiet, monsterHunt: hunt('farming', 'Monster Hunt: bbpompom') }, vitals: at('winter_cave', 51, -164, '1171001') });
  await expectPhase(page, feed, 'W', `Fighting Hunt target - ${pompom}`);
  await expectStable(page, feed, 'W', `Fighting Hunt target - ${pompom}`, [
    { party: { ...quiet, monsterHunt: hunt('farming', 'Monster Hunt: bbpompom') }, vitals: at('winter_cave', 140, -120, '1171007') },
    { party: { ...quiet, monsterHunt: hunt('farming', 'Monster Hunt: bbpompom') }, vitals: at('winter_cave', 20, -230, null) },
  ]);
  // 5. A combat event starts: regroup, travel to it, then fight it.
  const halloween = { map: 'halloween', x: -100, y: 600 };
  feed.set({ party: { ...quiet, monsterHunt: hunt('paused-event', 'Paused for combat event'), activeConvoy: eventLeg('convoy-e1', 'shared-prepare', 'mrpumpkin', halloween) }, vitals: at('winter_cave', 51, -164) });
  await expectPhase(page, feed, 'W', 'Regrouping for travel');
  feed.set({ party: { ...quiet, monsterHunt: hunt('paused-event', 'Paused for combat event'), activeConvoy: eventLeg('convoy-e1', 'travel', 'mrpumpkin', halloween) }, vitals: at('winterland', 300, -300) });
  await expectPhase(page, feed, 'W', 'Travelling to event - Mr. Pumpkin');
  const pumpkin = { W: { activeEvent: 'mrpumpkin', joinedEvent: 'mrpumpkin' } };
  feed.set({ party: { ...quiet, monsterHunt: hunt('paused-event', 'Paused for combat event'), activeConvoy: eventLeg('convoy-e2', 'scheduled', 'mrpumpkin', halloween) }, details: pumpkin, vitals: at('halloween', -90, 610, '1172000') });
  await expectPhase(page, feed, 'W', 'Fighting event - Mr. Pumpkin');
  // 6. The phases the coordinator publishes through activityPhases.
  feed.set({ party: { ...quiet, activityPhases: phases({ profiles: { W: profile({ eventSession: { event: 'mrpumpkin', spawnAt: Date.now() + 600000, live: false } }) } }) }, details: pumpkin, vitals: at('halloween', -90, 610) });
  await expectPhase(page, feed, 'W', 'Waiting for spawn - Mr. Pumpkin');
  feed.set({ party: { ...quiet, activityPhases: phases({ attendance: { W: { mrpumpkin: { ignored: 'death limit', dead: false } } } }) }, details: pumpkin, vitals: at('halloween', -90, 610) });
  await expectPhase(page, feed, 'W', 'Leaving event - Mr. Pumpkin (death limit)');
  feed.set({ party: { ...quiet, activityPhases: phases({ escape: { stage: 'blink' } }) }, vitals: at('main', 0, 0) });
  await expectPhase(page, feed, 'W', 'Escaping');
  feed.set({ party: { ...quiet, activityPhases: phases({ dungeon: { phase: 'active', participants: fighters, travel: 'travelling', message: null, reviving: null } }) }, vitals: at('main', 0, 0) });
  await expectPhase(page, feed, 'W', 'Cave - travelling');
  // 7. Death, then idle.
  feed.set({ party: quiet, vitals: { W: { rip: true } } });
  await expectPhase(page, feed, 'W', 'Dead');
  feed.set({ party: quiet, vitals: at('main', 0, 0) });
  await expectPhase(page, feed, 'W', 'Idle');
  // 8. The merchant: a live auto compound sample, then a fishing trip while the next job waits.
  feed.set({ party: { ...quiet, merchantCurrent: { id: 'merchant-1792974688820-1792974067962', target: 'M', reason: 'auto compound', routine: 'auto compound',
    phase: 'processing', operationStage: 'retrieving' } } });
  await expectPhase(page, feed, 'M', 'Auto compound - bank retrieval');
  feed.set({ party: { ...quiet, gatheringModes: ['fishing'], merchantCurrent: { id: 'merchant-d1', target: 'M', reason: 'deconstruction', routine: 'deconstruction', phase: 'assigned' } },
    details: { M: { gatheringPhase: 'travelling' } } });
  await expectPhase(page, feed, 'M', 'Fishing - travelling');
  await shoot(page, info, 'card-strip-activity');
});

test("the coordinator publishes each character's task phases in the core section", async ({ page, app }) => {
  const core = async () => (await (await fetch(`${app.url}/party-api/state?section=core&dashboard=1`)).json()).activityPhases;
  const published = await core();
  expect(published).toMatchObject({ escape: null, dungeon: null, attendance: {} });
  // Each fighter gets its owning profile, copied down to the fields the label reads.
  const fields = ['monsterHunt', 'activeConvoy', 'farmAreaState', 'combatRecovery', 'eventReturn', 'rareHuntState',
    'partyFarmingMode', 'partyFarmingMonsterType', 'eventSession'];
  for (const name of ['W', 'P']) expect(Object.keys(published.profiles[name]).sort(), name).toEqual([...fields].sort());
  const state = await app.state();
  expect(published.profiles.W.partyFarmingMode).toBe(state.farmingProfiles.W.partyFarmingMode ?? null);
  await page.setViewportSize({ width: 1460, height: 900 });
  await open(page);
  await scrollUnder(page, 'W', 700);
  await expect(activity(page, 'W')).not.toBeEmpty();
});

test.describe('the docked strip map', () => {
  test.use({ mapCapture: true });
  test('opens under the strip, stays open while the card below is used, and keeps its own controls', async ({ page, app }, info) => {
    await page.setViewportSize({ width: 1460, height: 900 });
    const map = 'zone_abc123_0', x = 31, y = 47;
    await expect.poll(async () => { const s = await app.state(); return s.characters.W.map; }).toBe(map);
    const definition = { name: map, min_x: -100, min_y: -200, max_x: 500, max_y: 400, default: 0, tiles: [], placements: [], groups: [], tilesets: {} };
    await page.route('**/party-api/map-stream/*', route => route.fulfill({ contentType: 'text/event-stream',
      body: 'data: ' + JSON.stringify({ name: 'W', map, x, y, at: Date.now(), entities: [], definition }) + '\n\n' }));
    await open(page);
    // Just past the name line: W's name is under the header and its Inventory toggle sits below the docked map.
    const nameDepth = await card(page, 'W').evaluate(article => {
      const name = article.querySelector('h2')!.closest('.flex.items-start')!;
      return Math.ceil(name.getBoundingClientRect().bottom - article.getBoundingClientRect().top) + 16;
    });
    await scrollUnder(page, 'W', nameDepth);
    const pinned = strip(page, 'W');
    await expect(pinned).toBeVisible();
    await expect(pinned.locator('[data-card-strip-location]')).toContainText('Cave of Many Dreams [31, 47]');
    const header = await box(page, '[data-party-header]');
    const line = await box(page, '[data-card-name-strip="W"] [data-card-strip-line]');
    await pinned.getByRole('button', { name: 'Expand live map', exact: true }).click();
    const dock = pinned.locator('[data-card-strip-map]');
    await expect(dock.locator('canvas')).toBeVisible();
    expect((await box(page, '[data-party-header]')).height, 'Opening the map leaves the header height alone').toBe(header.height);
    expect((await box(page, '[data-card-name-strip="W"] [data-card-strip-line]')).height, 'and the strip line height').toBe(line.height);
    const docked = await dock.evaluate(element => element.getBoundingClientRect());
    const column = await card(page, 'W').evaluate(element => element.getBoundingClientRect());
    expect(Math.abs(docked.top - (line.top + line.height))).toBeLessThan(1.5);
    expect(Math.abs(docked.left - column.left)).toBeLessThan(2);
    expect(Math.abs(docked.width - column.width)).toBeLessThan(3);
    expect(docked.height / 900).toBeGreaterThan(0.3);
    // Other columns keep their own strip and no map.
    await expect(strip(page, 'P').locator('[data-card-strip-map] canvas')).toHaveCount(0);
    // A card control below the docked map still works and the map stays open.
    const inventory = card(page, 'W').getByRole('button', { name: /^Inventory/ });
    expect((await inventory.boundingBox())!.y, 'The Inventory toggle sits below the docked map').toBeGreaterThan(docked.bottom);
    const expanded = await inventory.getAttribute('aria-expanded');
    await inventory.click();
    await expect(inventory).toHaveAttribute('aria-expanded', expanded === 'true' ? 'false' : 'true');
    await inventory.click();
    await expect(inventory).toHaveAttribute('aria-expanded', String(expanded));
    await expect(dock.locator('canvas')).toBeVisible();
    // Scrolling within the card keeps the map docked under the strip.
    await page.mouse.wheel(0, 300);
    await expect.poll(async () => Math.abs((await box(page, '[data-card-name-strip="W"] [data-card-strip-line]')).top - header.height)).toBeLessThan(1.5);
    await expect(dock.locator('canvas')).toBeVisible();
    await shoot(page, info, 'strip-map-open');
    // The bottom handle resizes the map and remembers the height.
    const handle = pinned.getByRole('button', { name: 'Resize W docked map' });
    const before = (await dock.evaluate(element => element.getBoundingClientRect())).height;
    const grip = (await handle.boundingBox())!;
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2 + 80, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => Math.round((await dock.evaluate(element => element.getBoundingClientRect())).height - before)).toBe(80);
    expect(await page.evaluate(() => localStorage.getItem('party-ui:map-dock-height:W'))).toBe(String(Math.round(before + 80)));
    // Expand opens the native-size dialog above the header; its screenshot control opens the capture tab.
    await dock.getByRole('button', { name: 'Open native-size map', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('canvas')).toBeVisible();
    const covering = await page.evaluate(() => {
      const box = document.querySelector('[data-party-header]')!.getBoundingClientRect();
      const top = document.elementFromPoint(box.left + box.width / 2, box.top + 10);
      return !!top && !top.closest('[data-party-header]');
    });
    expect(covering, 'The expanded map sits above the pinned header').toBe(true);
    const popup = page.waitForEvent('popup');
    await dialog.getByRole('button', { name: 'Capture map screenshot', exact: true }).click();
    await expect((await popup).locator('img')).toHaveAttribute('alt', `Map: ${map}. Center: 31.00, 47.00`);
    await page.bringToFront();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(dock.locator('canvas')).toBeVisible();
    // Scrolling the card top back hides the strip and its map; returning restores the open map.
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await expect(pinned).toBeHidden();
    // The card top and the strip share one open state, and only one copy of the map renders.
    await expect(card(page, 'W').locator('canvas')).toHaveCount(1);
    await expect(card(page, 'W').locator('canvas')).toBeVisible();
    await scrollUnder(page, 'W', nameDepth);
    await expect(dock.locator('canvas')).toBeVisible();
    await expect(card(page, 'W').locator('canvas')).toHaveCount(1);
    // Escape with focus inside the map closes it, and so does the strip arrow.
    await dock.getByRole('button', { name: 'Open native-size map', exact: true }).focus();
    await page.keyboard.press('Escape');
    await expect(dock.locator('canvas')).toHaveCount(0);
    await pinned.getByRole('button', { name: 'Expand live map', exact: true }).click();
    await expect(dock.locator('canvas')).toBeVisible();
    await pinned.getByRole('button', { name: 'Collapse live map', exact: true }).click();
    await expect(dock.locator('canvas')).toHaveCount(0);
    // Closing it from the strip closes it at the card top too; opening it at the top opens it in the strip.
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await expect(pinned).toBeHidden();
    await expect(card(page, 'W').locator('canvas')).toHaveCount(0);
    await card(page, 'W').getByRole('button', { name: 'Expand live map', exact: true }).first().click();
    await expect(card(page, 'W').locator('canvas')).toHaveCount(1);
    await scrollUnder(page, 'W', nameDepth);
    await expect(dock.locator('canvas')).toBeVisible();
    await expect(card(page, 'W').locator('canvas')).toHaveCount(1);
  });
});
