import { test, expect } from './fixtures';
import { fetchFullState } from './state-route';

// Failure inventory: docs/testing-october-events.md § Event-only monsters in the Bestiary.
// The console fixture's game files predate 18183, so the catalog boundary
// declares the five entries a 18183 client reports.
test('Bestiary labels event-only Halloween monsters with their source event', async ({ page, app }, info) => {
  const entry = (id: string, name: string, eventSources: any[]) => ({ id, name, sprite: null, hp: 1000, attack: 10, xp: 10, range: 30, threat: 1,
    definition: { achievements: [[1, 'stat', 'hp', 10]] }, drops: [], homeRewards: [], spawnRecords: [], eventSources });
  const declared = [
    entry('horseman', 'Headless Horseman', [{ id: 'horseman', name: 'Headless Horseman', role: 'boss' }]),
    entry('jackowalker', 'Jack-o Walker', [{ id: 'horseman', name: 'Headless Horseman', role: 'add', at: [0.75, 0.25] }]),
    entry('zombie', 'Zombie', [{ id: 'graveyard', name: 'Graveyard Rising', role: 'wave' }]),
    entry('gargoyle', 'Gargoyle', [{ id: 'graveyard', name: 'Graveyard Rising', role: 'boss' }]),
  ];
  await page.route('**/party-api/dashboard-stream', route => route.abort());
  await page.route('**/party-api/state*', async route => {
    const response = await fetchFullState(route), state = await response.json();
    if (state.bestiaryCatalog) state.bestiaryCatalog = [...state.bestiaryCatalog.filter((monster: any) => !declared.some(d => d.id === monster.id)), ...declared];
    await route.fulfill({ response, json: state });
  });
  await page.goto(app.url);
  await page.getByRole('button', { name: 'Bestiary', exact: true }).click();
  const bestiary = page.getByRole('dialog');
  await expect(bestiary.getByRole('button', { name: /^Headless Horseman / })).toContainText('Event only: Headless Horseman');
  await expect(bestiary.getByRole('button', { name: /^Zombie / })).toContainText('Event only: Graveyard Rising');
  await bestiary.getByRole('button', { name: /^Jack-o Walker / }).click();
  const details = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Jack-o Walker', exact: true }) });
  await expect(details).toContainText('Spawns only during Headless Horseman: raised by the boss at 75% and 25% HP.');
  await expect(details).not.toContainText('No static spawn recorded');
  await info.attach('bestiary-event-only-monster', { body: await page.screenshot(), contentType: 'image/png' });
});
