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
  await expect(warrior.getByText(/^Farming Goo: 0 \/ [\d,]+ kills \(step 1\)$/)).toBeVisible();
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
