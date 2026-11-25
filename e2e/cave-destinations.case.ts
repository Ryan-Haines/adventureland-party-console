import { test, expect } from './fixtures';

// The user asked to pick the next Cave destination while looking at the whole floor (fork
// commit 34092356, 2026-10-24) and made it core on 2026-11-15 (questions/decisions.md).
// Failure modes: the list shows twice or in neither place, the list sits off to the wrong side
// at wide or phone width, a list or pin pick posts something other than the panel's move, the
// map closes on a pick, and a click on open floor picks a room.
test('the Cave map shows the travel destinations beside it and either one picks the destination', async ({ page }, info) => {
  // Declared read-boundary fixture: the coordinator receives each move as posted.
  const run = 'dest-fixture', name = 'M', map = 'zone_' + run + '_0';
  const point = (id: string, label: string, x: number, y: number, extra: Record<string, unknown> = {}) =>
    ({ id: run + ':0:' + id, label, map, x, y, ...extra });
  const points = [
    point('door:0', 'Stairs down', 180, 20, { down: true, locked: true, to: 'zone_' + run + '_1' }),
    point('room:0', 'Guard camp', 40, 160, { room: '0:fight', required: true }),
    point('room:1', 'Practice with Wooden Swords', 160, 160, { room: '0:e40' }),
  ];
  const moves: unknown[] = [];
  const view = () => ({
    state: { phase: 'active', run, participants: [name], protectFromEvents: true, commands: {}, operations: [], progress: { enabled: false, serial: 0 } },
    members: [{ name, fresh: true, observation: { protocol: 1, at: Date.now(), supported: true, alive: true, ready: true, members: [name],
      cave: { run, floor: 0, expires: Date.now() + 600000, remainingMs: 600000, paused: false, gold: 0, amber: 0, points } } }],
    entryRefusal: null, travelling: false, actionsReady: true, reopenable: [],
  });
  await page.route('**/party-api/daily-dungeons', (route) => {
    if (route.request().method() === 'POST') moves.push(route.request().postDataJSON());
    return route.fulfill({ json: view() });
  });
  const definition = { name: map, min_x: 0, min_y: 0, max_x: 200, max_y: 200, tiles: [], placements: [], groups: [], tilesets: {} };
  await page.route('**/party-api/map-stream/*', (route) => route.fulfill({ contentType: 'text/event-stream',
    body: 'data: ' + JSON.stringify({ name, map, at: Date.now(), x: 100, y: 100, entities: [], definition }) + '\n\n' }));
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto('/');
  const controls = page.getByRole('region', { name: 'Cave of Many Dreams controls' });
  await expect(controls.getByRole('button', { name: 'Guard camp', exact: true })).toBeVisible();
  await controls.getByRole('button', { name: 'View full map', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Cave of Many Dreams — Floor 1', exact: true });
  const canvas = dialog.locator('canvas');
  const list = dialog.getByRole('region', { name: 'Cave destinations' });
  await expect(canvas).toBeVisible();
  // One list on the page: it moved into the map view.
  await expect(page.getByRole('button', { name: 'Guard camp', exact: true })).toHaveCount(1);
  await expect(list.getByRole('button', { name: 'Guard camp', exact: true })).toBeVisible();
  await expect(list.getByRole('button', { name: 'Stairs down — locked', exact: true })).toBeDisabled();
  const wide = { map: (await canvas.boundingBox())!, list: (await list.boundingBox())! };
  expect(wide.list.x, 'Wide screens put the list beside the map').toBeGreaterThanOrEqual(wide.map.x + wide.map.width - 1);
  await info.attach('cave-map-destinations-wide', { body: await dialog.screenshot(), contentType: 'image/png' });
  await list.getByRole('button', { name: 'Guard camp', exact: true }).click();
  await expect.poll(() => moves.at(-1)).toMatchObject({ action: 'move', run, target: run + ':0:room:0' });
  await expect(dialog, 'The map stays open to watch the party travel').toBeVisible();
  // A click on a room pin selects that room too.
  const box = (await canvas.boundingBox())!, fit = Math.min(box.width / 300, box.height / 300);
  await canvas.click({ position: { x: box.width / 2 + (160 - 100) * fit, y: box.height / 2 + (160 - 100) * fit } });
  await expect.poll(() => moves.at(-1)).toMatchObject({ action: 'move', run, target: run + ':0:room:1' });
  // A click on the empty middle of the floor selects nothing: the next post is the list pick after it.
  const before = moves.length;
  await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await list.getByRole('button', { name: 'Guard camp', exact: true }).click();
  await expect.poll(() => moves.length).toBe(before + 1);
  expect(moves.at(-1)).toMatchObject({ action: 'move', run, target: run + ':0:room:0' });
  // Phones stack the list under the map.
  await page.setViewportSize({ width: 390, height: 844 });
  const narrow = { map: (await canvas.boundingBox())!, list: (await list.boundingBox())! };
  expect(narrow.list.y, 'Phones put the list under the map').toBeGreaterThanOrEqual(narrow.map.y + narrow.map.height - 1);
  await info.attach('cave-map-destinations-phone', { body: await dialog.screenshot(), contentType: 'image/png' });
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(controls.getByRole('button', { name: 'Guard camp', exact: true })).toBeVisible();
});
