import {expect} from '../../../../e2e/live-fixtures';
import type {Page,TestInfo} from '@playwright/test';
import type {App} from '../../../../e2e/fixtures';

// The add-on's switch, as the player turns it on and off (POST /party-api/addons).
const addon=(page:Page,url:string,name:string,enabled:boolean)=>page.request.post(url+'/party-api/addons',{data:{name,enabled},headers:{Origin:url}});
// The fork's console journey on the add-on. The fixture has no party leader, so W and P are
// independent farming scopes; W runs Achievement Hunt and P stays untouched. The add-on runs through the API
// because the card's mode menu that lists an add-on's target mode is the status owner's and not
// built, so the mode is chosen and the add-on's task read over the API; the menu-click checks
// moved to the status owner's failure list.
async function consoleJourney({ page, app }: { page: Page; app: App }, testInfo: TestInfo) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.stack || error.message));
  const post = (endpoint: string, data: unknown) => page.request.post(app.url + '/party-api' + endpoint, { data, headers: { Origin: app.url } });
  const store = (state: any, name: string) => state.farmingProfiles?.[name]?.addonFarming?.['achievement-hunt'];
  const tasksOf = async () => (await (await fetch(app.url + '/party-api/tasks')).json()).groups.find((g: any) => g.members.includes('W'));
  await page.goto(app.url);
  // Off, the mode does not exist.
  expect((await post('/farming-mode', { character: 'W', mode: 'achievements' })).ok()).toBe(false);
  expect((await addon(page, app.url, 'achievement-hunt', true)).ok()).toBe(true);
  // The add-on's entry joins row 2 after its switch turns on, with its declared data.
  const card = page.locator('article').filter({ has: page.getByRole('heading', { name: 'W', exact: true }) });
  const targetRow = card.getByRole('group', { name: 'Target mode' });
  // The journey's writes go through the API, as an app's do. The page refreshes the farming profile
  // (config) at once only after its own writes (query-actions.ts actionDomains); an outside write
  // shows at its next config poll (status/rules.ts dashboardPolls.config, 15 s), which equals the
  // expect bound. So the card is read from a new page load after each outside write.
  const openCard = async () => {
    await page.reload();
    await card.locator('button[aria-expanded]').filter({ hasText: 'Farming settings' }).click();
  };
  await openCard();
  await expect(targetRow.getByRole('button')).toHaveText(['Farming', 'Hunt', 'Achievements']);
  await expect(targetRow.getByRole('button', { name: 'Achievements', exact: true })).toHaveAttribute('data-color', 'rose');
  // Nothing selected: the coordinator refuses the mode with the add-on's reason.
  const refused = await post('/farming-mode', { character: 'W', mode: 'achievements' });
  expect(refused.status()).toBe(409);
  expect(JSON.stringify(await refused.json())).toContain('choose at least one monster for Achievement Hunt');
  expect((await post('/addon-farming', { name: 'achievement-hunt', character: 'W', settings: { monsters: ['goo'] } })).status()).toBe(200);
  await expect.poll(async () => store(await app.state(), 'W')?.achievementHunt?.monsters).toEqual(['goo']);
  // The boss toggle shares the minutes' line: on by default with the minutes shown; off saves to the
  // scope store and hides the minutes (user, 2026-11-09).
  const pBefore = store(await app.state(), 'P') ?? null;
  await card.getByRole('button', { name: 'Farming settings', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Settings', exact: true }).getByRole('region', { name: 'Achievement Hunt settings' });
  const leave = panel.getByRole('checkbox', { name: 'Leave the target when a boss attacks' });
  const minutes = panel.getByRole('spinbutton', { name: 'Minutes before checking a boss-held target again' });
  await expect(leave).toBeChecked();
  await expect(minutes).toHaveValue('10');
  // A number outside its range is refused in words with the range settings.ts declares, and nothing
  // is saved.
  const deaths = panel.getByRole('spinbutton', { name: 'Achievement Hunt deaths before blacklisting' });
  await deaths.fill('0');
  await deaths.blur();
  await expect(panel.getByRole('alert')).toHaveText('The death threshold must be a whole number from 1 to 100.');
  await minutes.fill('121');
  await minutes.blur();
  await expect(panel.getByRole('alert')).toHaveText('The boss recheck time must be a whole number of minutes from 1 to 120.');
  expect(store(await app.state(), 'W')?.achievementHunt).toMatchObject({ deathThreshold: 6, bossRecheckMinutes: 10 });
  await minutes.fill('10');
  // Up to here selects the regular monsters through that row and keeps the special picks.
  await panel.getByRole('button', { name: /^Monsters \(/ }).click();
  const list = page.getByRole('dialog', { name: 'Achievement Hunt monsters' });
  const specialPicks = () => list.getByRole('region', { name: 'Special monsters' }).getByRole('checkbox', { checked: true }).count();
  const specials = await specialPicks();
  await list.getByRole('region', { name: 'Regular monsters' }).getByRole('button', { name: 'Up to here' }).first().click();
  await expect.poll(async () => store(await app.state(), 'W')?.achievementHunt?.monsters?.length).toBe(1 + specials);
  expect(await specialPicks()).toBe(specials);
  await page.keyboard.press('Escape');
  expect((await post('/addon-farming', { name: 'achievement-hunt', character: 'W', settings: { monsters: ['goo'] } })).status()).toBe(200);
  await expect.poll(async () => store(await app.state(), 'W')?.achievementHunt?.monsters).toEqual(['goo']);
  // A blacklisted monster shows in the section, and Clear all empties the blacklist.
  expect((await post('/addon-farming', { name: 'achievement-hunt', character: 'W', blacklist: { action: 'add', monsterId: 'goo' } })).status()).toBe(200);
  await panel.getByRole('button', { name: 'Clear all', exact: true }).click();
  await expect.poll(async () => store(await app.state(), 'W')?.achievementBlacklist).toEqual({});
  await leave.click();
  await expect.poll(async () => store(await app.state(), 'W')?.achievementHunt?.leaveOnBossAttack).toBe(false);
  await expect(leave).not.toBeChecked();
  await expect(minutes).toHaveCount(0);
  // W's save left P's scope store as it was (the fixture has no leader, so P is its own scope).
  expect(store(await app.state(), 'P') ?? null).toEqual(pBefore);
  await page.keyboard.press('Escape');
  expect((await post('/farming-mode', { character: 'W', mode: 'achievements' })).status()).toBe(200);
  // The coordinator picks Goo's first milestone and keeps the mode; P's scope is untouched.
  await expect.poll(async () => store(await app.state(), 'W')?.achievementTarget?.id).toBe('goo');
  const farming = await app.state();
  expect(farming.farmingProfiles.W).toMatchObject({ targetMode: 'achievements', combatMode: 'auto', farmingPolicy: 'achievements', monsterFocus: ['goo'] });
  expect(farming.farmingProfiles.P.targetMode).not.toBe('achievements');
  expect(store(farming, 'P')?.achievementTarget ?? null).toBeNull();
  // The task tick and the entry's tick run once per status report (tasks/coordinator/install.ts
  // `taskTick`), so each poll below waits on the fixture's next reports, inside the suite's expect bound.
  // Achievements is a target mode entry, so its task is `farming`, named by the entry, and the
  // group's status line carries it.
  await expect.poll(async () => { const g = await tasksOf(); return g && [g.live.kind, g.live.owner]; }).toEqual(['farming', 'farm:achievements:W']);
  const status = /^Farming Goo: 0 \/ [\d,]+ kills \(step 1\)$/;
  await expect.poll(async () => store(await app.state(), 'W')?.achievementMessage).toMatch(status);
  // The status block shows the declared title and the store's field, in the entry's colour.
  await openCard();
  const block = card.locator('div').filter({ has: page.getByText('Achievement Hunt status', { exact: true }) }).last();
  await expect(block.locator('p').last()).toHaveText(status);
  await expect(block).toHaveAttribute('data-color', 'rose');
  expect((await tasksOf()).status?.phase ?? '').toMatch(/^farming/);
  await app.restartCoordinator();
  const restored = await app.state();
  expect(restored.farmingProfiles.W.targetMode).toBe('achievements');
  expect(store(restored, 'W')).toMatchObject({ achievementHunt: { monsters: ['goo'], leaveOnBossAttack: false }, achievementTarget: { id: 'goo' } });
  // A target mode change ends the old entry's task `replaced:farming`.
  expect((await post('/farming-mode', { character: 'W', mode: 'default' })).status()).toBe(200);
  // Choosing Default ends the entry's task and the add-on lets go of its target.
  await expect.poll(async () => store(await app.state(), 'W')?.achievementTarget ?? null).toBeNull();
  await expect.poll(async () => (await tasksOf())?.ring.some((e: any) => e.decision === 'ended' && e.owner === 'farm:achievements:W' && e.code === 'replaced:farming')).toBe(true);
  expect(store(await app.state(), 'W')?.achievementHunt?.monsters).toEqual(['goo']);
  // After Default no add-on mode stays pressed; row 2 presses Farming. A press of the add-on's
  // button on the card sends `targetMode` alone.
  await openCard();
  await expect.poll(() => targetRow.locator('[aria-pressed="true"]').allTextContents()).toEqual(['Farming']);
  const press = page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/party-api/farming-mode'));
  await targetRow.getByRole('button', { name: 'Achievements', exact: true }).click();
  expect((await press).postDataJSON()).toEqual({ targetMode: 'achievements', character: 'W' });
  await expect.poll(async () => (await app.state()).farmingProfiles.W.targetMode).toBe('achievements');
  await expect.poll(() => targetRow.locator('[aria-pressed="true"]').allTextContents()).toEqual(['Achievements']);
  expect((await post('/farming-mode', { character: 'W', mode: 'default' })).status()).toBe(200);
  await openCard();
  await expect.poll(() => targetRow.locator('[aria-pressed="true"]').allTextContents()).toEqual(['Farming']);
  // Achievement Hunt's end, here a monster focus changed by hand, switches the target to Farming,
  // leaves the Scatter the player chose and writes one line naming the add-on.
  expect((await post('/farming-mode', { character: 'W', combatMode: 'scatter' })).status()).toBe(200);
  expect((await post('/farming-mode', { character: 'W', mode: 'achievements' })).status()).toBe(200);
  await expect.poll(async () => store(await app.state(), 'W')?.achievementTarget?.id).toBe('goo');
  const linesBefore = (await app.state()).settingsChanges.length;
  expect((await post('/focus', { character: 'W', monsterFocus: ['bee'] })).status()).toBe(200);
  await expect.poll(async () => (await app.state()).farmingProfiles.W.targetMode, { message: 'Achievement Hunt ends to Farming' }).toBe('farming');
  const ended = await app.state();
  expect(ended.farmingProfiles.W.combatMode, 'the combat mode stays Scatter').toBe('scatter');
  expect(ended.settingsChanges.slice(linesBefore).filter((l: any) => l.field === 'targetMode' || l.field === 'combatMode').map((l: any) => [l.field, l.character, l.old, l.new, l.by]))
    .toEqual([['targetMode', 'W', 'achievements', 'farming', 'addon:achievement-hunt']]);
  // addon.off: with the entry live again, switching the add-on off ends its task.
  expect((await post('/farming-mode', { character: 'W', mode: 'achievements' })).status()).toBe(200);
  await expect.poll(async () => (await tasksOf())?.live?.owner).toBe('farm:achievements:W');
  // A follower's section gets no save: with W leading and P following, P's section is read only.
  expect((await post('/settings', { changes: [{ field: 'leader', value: 'W' }, { field: 'followers', character: 'P', value: true }] })).status()).toBe(200);
  const follower = page.locator('article').filter({ has: page.getByRole('heading', { name: 'P', exact: true }) });
  await page.reload();
  await follower.getByRole('button', { name: 'Farming settings', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true }).getByRole('region', { name: 'Achievement Hunt settings' })
    .getByRole('checkbox', { name: 'Leave the target when a boss attacks' })).toBeDisabled();
  await page.keyboard.press('Escape');
  expect((await post('/settings', { changes: [{ field: 'leader', value: null }, { field: 'followers', character: 'P', value: false }] })).status()).toBe(200);
  expect((await addon(page, app.url, 'achievement-hunt', false)).ok()).toBe(true);
  await expect.poll(async () => (await tasksOf())?.live?.owner).not.toBe('farm:achievements:W');
  // The entry leaves row 2 after the switch-off.
  await openCard();
  await expect(targetRow.getByRole('button')).toHaveText(['Farming', 'Hunt']);
  expect(errors, 'The browser must not crash during Achievement Hunt controls').toEqual([]);
  await testInfo.attach('achievement-hunt-state', { body: Buffer.from(JSON.stringify({ farming, restored }, null, 2)), contentType: 'application/json' });
}

// This add-on's rows of the shared tables its tests join: the console journey in the console
// fixture's add-on table (e2e/addon-console.case.ts). Its live play is W60's (e2e/windows/W60-addon-hunt.spec.ts).
// The generated.build/addons/tests.ts lists them by table, so the shared specs name no add-on.
export const rows={
  'add-on console journeys':[
    ['Achievement Hunt adds its farming mode, refuses it with no monster chosen, and keeps its choices in the scope store',consoleJourney]],
} as const;
