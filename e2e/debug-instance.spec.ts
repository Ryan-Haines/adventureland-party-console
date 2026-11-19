import { test, expect } from './fixtures';
import { untilRunning } from './debug-running';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);

test('Settings launches a disposable god party, repeats Cave entry and destroys its stack', async ({ page, app, context }, info) => {
  test.setTimeout(1_800_000);
  page.setDefaultTimeout(30000);
  const settings = page.getByRole('dialog', { name: 'Interface settings' });
  const openSettings = async () => {
    await expect(async () => {
      if (!await settings.isVisible()) await page.getByRole('button', { name: 'Interface settings', exact: true }).click();
      await expect(settings).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 30000 });
  };
  await page.goto(app.url);
  await expect(page.getByRole('heading', { name: 'W', exact: true })).toBeVisible();
  await openSettings();
  const start = page.getByRole('button', { name: 'Start debug instance', exact: true });
  await start.scrollIntoViewIfNeeded();
  const stop = page.getByRole('button', { name: 'Stop running', exact: true });
  const state = async () => (await context.request.get(app.url + '/console-debug')).json();
  let project = '';
  try {
    await start.click();
    await expect(page.getByRole('status', { name: 'Debug instance status' })).toContainText(/Starting|Building|Checking/);
    const starting = await state();
    await context.request.post(app.url + '/console-debug/start', { headers: { Origin: app.url }, data: {} });
    expect((await state()).project).toBe(starting.project);
    await untilRunning(state);
    const running = await state(); project = running.project;
    const link = page.getByRole('link', { name: 'Open debug console' });
    const url = await link.getAttribute('href');
    expect(new URL(url!).port).not.toBe('3010');
    const debug = await context.newPage(); await debug.goto(url!);
    await expect(debug.getByRole('heading', { name: 'E2EWarrior', exact: true })).toBeVisible();
    // A copied Vinext cache can embed another machine's file:// font URLs.
    // Require the actual packaged fonts, not just the CSS font-family name.
    const fonts = await debug.evaluate(async () => {
      const faces = await Promise.all(['Geist', 'Geist Mono'].map(family => document.fonts.load(`16px "${family}"`)));
      return faces.map(group => group.map(face => ({ family: face.family, status: face.status })));
    });
    for (const faces of fonts) {
      expect(faces.length).toBeGreaterThan(0);
      expect(faces.every(face => face.status === 'loaded')).toBe(true);
    }
    await info.attach('debug-loaded-fonts', { body: JSON.stringify(fonts), contentType: 'application/json' });
    const origin = new URL(url!).origin;
    const unauthorized = await fetch(origin + '/party-api/state');
    expect(unauthorized.status).toBe(401);
    const nested = await debug.request.post(origin + '/console-debug/start', { headers: { Origin: origin }, data: {} });
    expect(nested.status()).toBe(403);
    const native = await (await debug.request.get(origin + '/party-api/state')).json();
    for (const name of ['E2EWarrior', 'E2EPriest', 'E2EMerchant']) {
      expect(native.characters[name].slots.mainhand.item.level).toBe(100);
      expect(native.characters[name].dungeon.supported).toBe(true);
    }
    await info.attach('debug-god-party', { body: JSON.stringify(native.characters), contentType: 'application/json' });
    const gameLink = debug.getByRole('link', { name: 'Open game client', exact: true });
    await expect(gameLink).toBeVisible();
    expect((await fetch(origin + '/debug-game/vnc.html')).status).toBe(401);
    expect(await page.evaluate(url => new Promise(resolve => {
      const socket = new WebSocket(url.replace('http:', 'ws:') + '/debug-game/websockify');
      const timer = setTimeout(() => { socket.close(); resolve('timeout'); }, 5000);
      socket.onopen = () => { clearTimeout(timer); socket.close(); resolve('opened'); };
      socket.onerror = () => { clearTimeout(timer); resolve('rejected'); };
    }), origin)).toBe('rejected');
    const viewer = await context.newPage();
    await viewer.goto(origin + await gameLink.getAttribute('href'));
    await expect.poll(async () => viewer.locator('#noVNC_status').textContent(), { timeout: 30000 }).toMatch(/Connected/i);
    await expect(viewer.locator('#noVNC_container canvas')).toBeVisible();
    await info.attach('actual-debug-game-client', { body: await viewer.screenshot(), contentType: 'image/png' });
    await viewer.close();
    expect((await (await debug.request.get(origin + '/party-api/state')).json()).characters.E2EWarrior.seenAt).toBeGreaterThan(Date.now() - 15000);
    await expect(debug.getByRole('link', { name: 'E2EWarrior · Debug browser primary' })).toBeVisible();
    const warriorCard = debug.getByRole('article').filter({ has: debug.getByRole('heading', { name: 'E2EWarrior', exact: true }) });
    await warriorCard.getByRole('button', { name: 'Expand live map', exact: true }).click();
    await warriorCard.getByRole('button', { name: 'Open native-size map' }).click();
    const mapDialog = debug.getByRole('dialog', { name: /E2EWarrior/ });
    await expect(mapDialog.locator('canvas')).toBeVisible();
    await debug.waitForTimeout(1500);
    await info.attach('dorr-and-starry-entrance', { body: await mapDialog.screenshot(), contentType: 'image/png' });
    await debug.keyboard.press('Escape');
    const dungeon = async () => (await debug.request.get(origin + '/party-api/daily-dungeons')).json();
    const post = async (action: string) => {
      const response = await debug.request.post(origin + '/party-api/daily-dungeons', {
        headers: { Origin: origin }, data: { action, operationId: 'debug-e2e-' + Date.now() },
      });
      expect(response.ok(), await response.text()).toBe(true);
    };
    const visits: unknown[] = [];
    for (let visit = 0; visit < 2; visit++) {
      await expect.poll(async () => (await dungeon()).members.every((m: any) => m.fresh && m.observation?.visit?.available),
        { timeout: 90_000 }).toBe(true);
      await post('enter');
      await expect.poll(async () => (await dungeon()).state.phase, { timeout: 120_000 }).toBe('active');
      visits.push(await dungeon());
      await post('exit');
      await expect.poll(async () => (await dungeon()).state.phase, { timeout: 120_000 }).toBe('held');
      await post('release');
    }
    await info.attach('debug-cave-visits', { body: JSON.stringify(visits, null, 2), contentType: 'application/json' });
    await info.attach('debug-console', { body: await debug.screenshot(), contentType: 'image/png' });
    await page.reload(); await openSettings();
    await expect(stop).toBeEnabled();
    await stop.scrollIntoViewIfNeeded();
    await info.attach('debug-settings-running', { body: await page.screenshot(), contentType: 'image/png' });
    await stop.click();
    await expect.poll(async () => (await state()).phase, { timeout: 120_000 }).toBe('stopped');
    for (const resource of ['container', 'volume', 'network']) {
      const { stdout } = await execute('docker', [resource, 'ls', ...(resource === 'container' ? ['-a'] : []), '-q', '--filter', `label=party-console.debug=${project}`]);
      expect(stdout.trim(), resource + ' must be destroyed').toBe('');
    }
    await info.attach('debug-destroyed', { body: JSON.stringify({ project, state: await state(), resources: [] }), contentType: 'application/json' });
    await start.click();
    await expect(stop).toBeEnabled();
    const cancelled = await state();
    expect(cancelled.project).not.toBe(project);
    await stop.click();
    await expect.poll(async () => (await state()).phase, { timeout: 120_000 }).toBe('stopped');
    for (const resource of ['container', 'volume', 'network']) {
      const { stdout } = await execute('docker', [resource, 'ls', ...(resource === 'container' ? ['-a'] : []), '-q', '--filter', `label=party-console.debug=${cancelled.project}`]);
      expect(stdout.trim(), 'Cancelled ' + resource).toBe('');
    }
    await info.attach('debug-cancelled', { body: JSON.stringify({ project: cancelled.project, state: await state() }), contentType: 'application/json' });
  } finally {
    await context.request.post(app.url + '/console-debug/stop', { headers: { Origin: app.url }, data: {} });
    await expect.poll(async () => (await state()).phase, { timeout: 120_000 }).toBe('stopped');
  }
});
