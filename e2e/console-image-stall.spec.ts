import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures';
import { fetchFullState } from './state-route';

// TW-D1: in final-gate-closing12 a stalled adventure.land held the dashboard's image proxy, the
// picker's sprite loads took the browser's six connections to the console over plain HTTP, and W09's
// blacklist add reached the coordinator only when the page closed. This file's dashboard server
// imports stall-adventure-land.mjs, so every image fetch it makes stalls. W09 and W12 load their
// images from the window's game server, so a live window cannot stall them.
test.use({ dashboardImport: path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/stall-adventure-land.mjs') });

test('TW-D1: a blacklist add sent during stalled sprite loads reaches the coordinator', async ({ page, app }, info) => {
  const sprites: { url: string; status?: number | string }[] = [];
  page.on('request', request => { if (request.url().includes('/api/monster-sprite?')) sprites.push({ url: request.url() }); });
  const answered = (url: string, status: number | string) => { const entry = sprites.find(sprite => sprite.url === url && sprite.status === undefined); if (entry) entry.status = status; };
  page.on('response', response => answered(response.url(), response.status()));
  page.on('requestfailed', request => answered(request.url(), request.failure()?.errorText || 'failed'));
  // The fixture's monster choices are goo and phoenix with no sprites, so the row adds the game's
  // other monsters from the bestiary and gives each its own sheet: the picker then loads one sheet
  // per monster, as the game's catalog makes it do.
  await page.route('**/party-api/state*', async route => {
    const response = await fetchFullState(route), state = await response.json();
    const choices: { id: string; name: string }[] = state.monsterChoices || [];
    const others = (state.bestiaryCatalog || []).filter((monster: { id: string }) => !choices.some(choice => choice.id === monster.id))
      .map((monster: { id: string; name: string }) => ({ id: monster.id, name: monster.name, locations: [], spawnRecords: [] }));
    const monsterChoices = [...choices, ...others].map(monster =>
      ({ ...monster, sprite: { url: `https://adventure.land/images/tiles/monsters/${monster.id}.png`, tileSize: 1, columns: 1, rows: 1, x: 0, y: 0 } }));
    await route.fulfill({ response, json: { ...state, monsterChoices } });
  });
  await page.goto('/');
  const warrior = page.locator('article').filter({ has: page.getByRole('heading', { name: 'W', exact: true }) });
  await warrior.getByRole('button', { name: 'Farming settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  await settings.getByRole('button', { name: 'Add', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Add to Hunt blacklist', exact: true });
  // The picker's sheet loads outnumber Chrome's six connections per host, so on the proxy that
  // waits on adventure.land they hold every connection the page has to the console.
  await expect.poll(() => new Set(sprites.map(sprite => sprite.url)).size, { message: 'the picker loads more sprite sheets than the browser has connections' }).toBeGreaterThan(6);
  await picker.getByRole('textbox', { name: 'Search blacklist monsters' }).fill('goo');
  const before = sprites.slice();
  const added = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/party-api/hunt-blacklist'));
  const clicked = Date.now();
  await picker.getByRole('button', { name: 'Add Goo to blacklist', exact: true }).click();
  const answer = await added, addMs = Date.now() - clicked;
  await info.attach('tw-d1-sprite-requests', { body: JSON.stringify({ addMs, sprites }, null, 2), contentType: 'application/json' });
  expect(answer.ok()).toBe(true);
  expect((await app.state()).farmingProfiles.W.huntBlacklist.goo?.reason).toBe('Manually blacklisted');
  // The proxy answered every sheet asked before the add as a miss, since adventure.land never answered
  // it. On the proxy that waits, those sheets hold their connections until the gateway's
  // gatewayUpstreamMs ends them, and the add answers only after that.
  await expect.poll(() => before.filter(sprite => sprite.status === undefined).length).toBe(0);
  expect(before.filter(sprite => sprite.status !== 503)).toEqual([]);
});
