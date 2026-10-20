import { readFileSync } from 'node:fs';
import { test, expect } from './fixtures';

// Failure modes: e2e/achievement-hunt-failures.md. The fixture has no party leader,
// so W and P are independent farming scopes; W runs Achievement Hunt and P stays untouched.
test('Achievement Hunt picks a target from Farming settings, keeps its mode and survives a restart', async ({ page, app }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.stack || error.message));
  const exchanges: unknown[] = [];
  const responseFor = (endpoint: string) => page.waitForResponse(response =>
    new URL(response.url()).pathname.endsWith(endpoint) && response.request().method() === 'POST');
  const record = async (pending: ReturnType<typeof responseFor>) => {
    const response = await pending;
    exchanges.push({ endpoint: new URL(response.url()).pathname, request: response.request().postDataJSON(), status: response.status(), body: await response.json() });
    return response;
  };
  await page.goto('/');
  const warrior = page.locator('article').filter({ has: page.getByRole('heading', { name: 'W', exact: true }) });
  await expect(warrior).toBeVisible();
  const modes = warrior.getByRole('button', { name: /^Farming settings .+/ });
  await modes.click();

  // Nothing selected: the coordinator refuses the mode with a reason.
  const refusal = responseFor('/farming-mode');
  await warrior.getByRole('button', { name: 'Achievements', exact: true }).click();
  const refused = await record(refusal);
  expect(refused.status()).toBe(409);
  const failure = page.getByRole('dialog', { name: "Couldn't complete action", exact: true });
  await expect(failure).toContainText('choose at least one monster for Achievement Hunt');
  await failure.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(failure).not.toBeVisible();

  await warrior.getByRole('button', { name: 'Farming settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Farming settings · W', exact: true });
  const section = settings.getByRole('region', { name: 'Achievement Hunt settings' });
  await section.getByRole('button', { name: 'Monsters (0)', exact: true }).click();
  const chooser = page.getByRole('dialog', { name: 'Achievement Hunt monsters', exact: true });
  const regular = chooser.getByRole('region', { name: 'Regular monsters' });
  // Goo is the only monster the fixture publishes a spawn for.
  await expect(regular.getByRole('checkbox')).toHaveCount(1);
  const goo = regular.getByRole('checkbox', { name: 'Farm Goo for achievements', exact: true });
  const saved = responseFor('/achievement-hunt');
  // This controlled checkbox changes only after the real save and query refresh complete.
  await goo.click();
  const saveResponse = await record(saved);
  expect(saveResponse.status()).toBe(200);
  expect(saveResponse.request().postDataJSON()).toEqual({ settings: { monsters: ['goo'] }, character: 'W' });
  await expect(goo).toBeChecked();
  await expect.poll(async () => (await app.state()).farmingProfiles.W.achievementHunt.monsters).toEqual(['goo']);
  await testInfo.attach('achievement-monster-chooser', { body: await page.screenshot(), contentType: 'image/png' });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  const started = responseFor('/farming-mode');
  await warrior.getByRole('button', { name: 'Achievements', exact: true }).click();
  const startResponse = await record(started);
  expect(startResponse.status()).toBe(200);
  expect(startResponse.request().postDataJSON()).toMatchObject({ character: 'W', mode: 'achievements' });
  await expect(warrior.getByRole('button', { name: 'Achievements', exact: true })).toHaveAttribute('aria-pressed', 'true');

  // The coordinator picks Goo's first milestone and keeps the mode.
  await expect.poll(async () => (await app.state()).farmingProfiles.W.achievementTarget?.id).toBe('goo');
  const farming = await app.state();
  expect(farming.farmingProfiles.W).toMatchObject({ farmingPolicy: 'achievements', monsterFocus: ['goo'], achievementTarget: { id: 'goo', step: 0 } });
  expect(farming.farmingProfiles.P.farmingPolicy).not.toBe('achievements');
  expect(farming.farmingProfiles.P.achievementTarget).toBeNull();
  const status = /^Farming Goo: 0 \/ [\d,]+ kills \(step 1\)$/;
  await expect.poll(async () => (await app.state()).farmingProfiles.W.achievementMessage).toMatch(status);
  // The coordinator writes the message after /farming-mode answers, so the dashboard
  // shows it on its next 'config' poll (query-cache.tsx policies.config, every 15 s).
  await expect(warrior.getByText(status)).toBeVisible({ timeout: 20_000 });
  await testInfo.attach('achievement-hunt-status', { body: await warrior.screenshot(), contentType: 'image/png' });

  await app.restartCoordinator();
  const restored = await app.state();
  expect(restored.farmingProfiles.W).toMatchObject({ farmingPolicy: 'achievements', achievementHunt: { monsters: ['goo'] }, achievementTarget: { id: 'goo' } });

  await page.reload();
  await expect(warrior).toBeVisible();
  await modes.click();
  const stopped = responseFor('/farming-mode');
  await warrior.getByRole('button', { name: 'Default', exact: true }).click();
  expect((await record(stopped)).status()).toBe(200);
  await expect.poll(async () => (await app.state()).farmingProfiles.W.achievementTarget).toBeNull();
  const afterExit = await app.state();
  expect(afterExit.farmingProfiles.W).toMatchObject({ farmingPolicy: 'default', achievementHunt: { monsters: ['goo'] } });
  expect(errors, 'The browser must not crash during Achievement Hunt controls').toEqual([]);
  await testInfo.attach('achievement-hunt-http-and-state', { body: Buffer.from(JSON.stringify({ exchanges, farming, restored, afterExit, browserErrors: errors }, null, 2)), contentType: 'application/json' });
});

// Settings as a v1.4.0 build saved them: one monolithic settings document, with
// W's Achievement Hunt choices inside its farming profile.
const gooSettings = { monsters: ['goo'], blacklistDeaths: true, deathThreshold: 6, fillIdle: true, fillSelectedOnly: true, bossRecheckMinutes: 10 };
const monolithicJournal = [{ party_dashboard_settings_state_v1: { farmingProfiles: { W: { farmingPolicy: 'achievements', achievementHunt: gooSettings } } } }];
const fastSection = async (url: string) => (await (await fetch(`${url}/party-api/state?section=fast&dashboard=1`)).json()).characters;

// Failure modes: e2e/achievement-hunt-failures.md § Field registry in enforce mode.
test.describe('Achievement Hunt under the enforced field registry', () => {
  test.use({ stateFields: 'enforce', achievementKills: { goo: 1234 }, savedRecords: monolithicJournal });
  test('shows kill progress and the status line from the whitelisted sections', async ({ page, app }, testInfo) => {
    await expect.poll(async () => (await app.state()).farmingProfiles.W.achievementTarget?.id).toBe('goo');
    const fast = await fastSection(app.url), full = (await app.state()).characters;
    expect(fast.W.monsterAchievementKills).toEqual({ goo: 1234 });
    expect(Object.hasOwn(fast.W, 'avoidSightings'), 'avoidSightings is debug data').toBe(false);
    expect(full.W.avoidSightings, 'the coordinator stores the sightings it reads').toEqual([]);
    // Without the live stream the dashboard reads characters from section=fast (query-cache.tsx).
    await page.route('**/party-api/dashboard-stream**', route => route.abort());
    await page.goto('/');
    const warrior = page.locator('article').filter({ has: page.getByRole('heading', { name: 'W', exact: true }) });
    await warrior.getByRole('button', { name: /^Farming settings .+/ }).click();
    await expect(warrior.getByText(/^Farming Goo: 1,234 \/ [\d,]+ kills \(step \d+\)$/)).toBeVisible();
    await warrior.getByRole('button', { name: 'Farming settings', exact: true }).click();
    const settings = page.getByRole('dialog', { name: 'Farming settings · W', exact: true });
    await settings.getByRole('region', { name: 'Achievement Hunt settings' }).getByRole('button', { name: 'Monsters (1)', exact: true }).click();
    const chooser = page.getByRole('dialog', { name: 'Achievement Hunt monsters', exact: true });
    await expect(chooser.getByRole('button', { name: 'Inspect Goo', exact: true })).toContainText(/1,234 \/ [\d,]+ · step \d+/);
    await testInfo.attach('enforced-achievement-progress', { body: await page.screenshot(), contentType: 'image/png' });
    await testInfo.attach('enforced-achievement-fields', { body: JSON.stringify({ fast: Object.keys(fast.W), full: Object.keys(full.W) }, null, 1), contentType: 'application/json' });
  });
});

// Failure modes: e2e/achievement-hunt-failures.md § Achievement Hunt save key.
const achievementKey = 'party_dashboard_achievement_state_v1', settingsKey = 'party_dashboard_settings_state_v1';
const batEntry = { monsterId: 'bat', at: Date.UTC(2026, 9, 18, 12), reason: '4 deaths while farming for achievements' };
const layout2Journal = [
  { [achievementKey]: { profiles: { W: { achievementHunt: { ...gooSettings, deathThreshold: 4 }, achievementBlacklist: { bat: batEntry }, achievementTarget: null, achievementPassive: null, achievementMessage: '' } } } },
  { [settingsKey]: { farmingProfiles: { W: { farmingPolicy: 'achievements' } }, persistenceLayout: 2 } },
];
const journalRecords = (journal: string, key: string) => readFileSync(journal, 'utf8').split('\n')
  .filter(line => line.startsWith(`{"${key}":`)).map(line => JSON.parse(line)[key]);

test.describe('Achievement Hunt state under its own save key', () => {
  // Playwright reads a two-element array whose second element is an object as [value, options].
  test.use({ savedRecords: [layout2Journal, { scope: 'test' }] });
  test('loads from the split document, saves changes there and leaves settings without it until shutdown', async ({ page, app }, testInfo) => {
    const seededSettings = journalRecords(app.journal, settingsKey).length;
    await page.goto('/');
    const warrior = page.locator('article').filter({ has: page.getByRole('heading', { name: 'W', exact: true }) });
    await warrior.getByRole('button', { name: 'Farming settings', exact: true }).click();
    const section = page.getByRole('dialog', { name: 'Farming settings · W', exact: true }).getByRole('region', { name: 'Achievement Hunt settings' });
    const deaths = section.getByRole('spinbutton', { name: 'Achievement Hunt deaths before blacklisting' });
    await expect(deaths).toHaveValue('4');
    await expect(section.getByLabel('Achievement Hunt blacklist')).toContainText(batEntry.reason);

    await expect.poll(() => journalRecords(app.journal, achievementKey).at(-1)?.profiles?.W?.achievementTarget?.id).toBe('goo');
    expect(journalRecords(app.journal, achievementKey).at(-1).profiles.W.achievementMessage).toMatch(/^Farming Goo: 0 \/ [\d,]+ kills \(step 1\)$/);
    const saved = responseFor(page, '/achievement-hunt');
    await deaths.fill('5');
    await deaths.press('Enter');
    expect((await saved).status()).toBe(200);
    await expect.poll(() => journalRecords(app.journal, achievementKey).at(-1)?.profiles?.W?.achievementHunt?.deathThreshold).toBe(5);
    const running = journalRecords(app.journal, settingsKey).slice(seededSettings);
    expect(running.length, 'the coordinator saved settings while running').toBeGreaterThan(0);
    for (const record of running) expect(keysOf(record).filter(key => key.startsWith('achievement'))).toEqual([]);

    // docs/efficiency.md (Achievement Hunt state) item 12: no record repeats the one before it.
    const achievementRecords = journalRecords(app.journal, achievementKey).map(record => JSON.stringify(record));
    expect(achievementRecords.filter((record, index) => index > 0 && record === achievementRecords[index - 1])).toEqual([]);
    await app.restartCoordinator();
    const shutdown = journalRecords(app.journal, settingsKey).at(-1);
    expect(shutdown.farmingProfiles.W).toMatchObject({ achievementHunt: { deathThreshold: 5, monsters: ['goo'] }, achievementBlacklist: { bat: batEntry }, achievementTarget: { id: 'goo' } });
    const restored = (await app.state()).farmingProfiles.W;
    expect(restored).toMatchObject({ farmingPolicy: 'achievements', achievementHunt: { deathThreshold: 5 }, achievementBlacklist: { bat: batEntry } });
    await testInfo.attach('achievement-save-key-records', { body: JSON.stringify({ achievement: journalRecords(app.journal, achievementKey), running, shutdown, restored }, null, 1), contentType: 'application/json' });
  });
});
/** Every object key in a saved record, at any depth. */
function keysOf(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, entry]) => [key, ...keysOf(entry)]);
}
function responseFor(page: import('@playwright/test').Page, endpoint: string) {
  return page.waitForResponse(response => new URL(response.url()).pathname.endsWith(endpoint) && response.request().method() === 'POST');
}
