import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Fresh installations must reach onboarding through either advertised or internal URLs. */
export async function verifyFirstRun(base: string, internal: string) {
  const state = await fetch(base + '/setup/state');
  assert.equal(state.status, 200, 'Setup state unavailable');
  assert.equal((await state.json() as { configured: boolean }).configured, false);
  for (const entry of [base, internal]) {
    const page = await fetch(entry + '/');
    assert.equal(new URL(page.url).pathname, '/setup', 'Fresh installation skipped setup');
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Party Console/);
  }
  const redirect = await fetch(internal + '/console-update', { redirect: 'manual' });
  assert.equal(redirect.status, 302, 'Internal dashboard must redirect update requests');
  assert.equal(new URL(redirect.headers.get('location')!).pathname, '/console-update');
}

/** Render packaged assets independently; onboarding intentionally hides them until configured. */
export async function verifyDashboardBuild(root: string, output = '.build/container') {
  const moduleUrl = pathToFileURL(path.join(root, 'dashboard/node_modules/vinext/dist/server/prod-server.js'));
  const { startProdServer } = await import(moduleUrl.href);
  const { server, port } = await startProdServer({ port: 0, host: '127.0.0.1', outDir: path.join(root, 'dashboard', output), silent: true });
  try {
    const base = `http://127.0.0.1:${port}`;
    const dashboard = await fetch(base + '/');
    const html = await dashboard.text();
    assert.equal(dashboard.status, 200, 'Dashboard did not render');
    assert.match(html, /<html/);
    const asset = html.match(/src="([^" ]+\.js[^" ]*)"/);
    assert.ok(asset, 'Dashboard JavaScript asset missing');
    const script = await fetch(new URL(asset[1], base));
    assert.equal(script.status, 200, 'Dashboard JavaScript asset unavailable');
    assert.match(script.headers.get('content-type') || '', /javascript/);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error?: Error) => error ? reject(error) : resolve()));
  }
}
