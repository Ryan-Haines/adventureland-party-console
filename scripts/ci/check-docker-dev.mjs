// Run only against a disposable source copy in an unauthenticated dev container.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from '../../dashboard/node_modules/ws/index.js';
import { gateway } from '../../tools/hosting/gateway.ts';
import { Access } from '../../tools/hosting/access.ts';
import { LocalTLS } from '../../tools/hosting/tls.ts';

assert.equal(process.env.AL_DEV_SMOKE_TEST, '1', 'Requires disposable test checkout');
const data = await mkdtemp(tmpdir() + '/party-hmr-');
const access = new Access(data + '/access.json'); await access.load();
const options = { access, configured: () => true, dashboardPort: 3030 };
const server = gateway(options);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
process.env.AL_HTTPS_PORT = '14444';
const tls = new LocalTLS(process.cwd(), data, port); options.tls = tls;
const page = 'dashboard/app/page.tsx', character = 'runtime/characters/entries/warrior.ts';
const originalPage = await readFile(page, 'utf8'), originalCharacter = await readFile(character, 'utf8');
const sockets = [];
try {
  for (let i = 0; i < 150; i++) {
    const state = await fetch('http://127.0.0.1:3030/__dashboard/state').then(r => r.json()).catch(() => ({}));
    if (state.ready) break;
    if (i === 149) throw Error('Development dashboard never became ready');
    await delay(1000);
  }
  await tls.start();
  for (let i = 0; i < 100 && !(await tls.status()).ready; i++) await delay(100);
  const ca = await tls.certificate();
  const base = 'http://127.0.0.1:' + port;
  const rendered = await (await fetch(base)).text();
  assert.ok(rendered.includes('<html') && !rendered.includes('The dashboard couldn’t render'), 'Dashboard must render without its error fallback');
  const client = await (await fetch(base + '/@vite/client')).text();
  const match = client.match(/const wsToken = "([^"]+)"/);
  assert.ok(match, 'Gateway must serve the Vite client');
  const token = match[1];
  assert.match(client, /const hmrPort = (null|undefined)/);
  for (const origin of [base, 'https://127.0.0.1:14444']) {
    const ws = new WebSocket(origin.replace('http', 'ws') + '/?token=' + token, 'vite-hmr', { origin, ca });
    sockets.push(ws);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('HMR connect timed out')), 10000);
      ws.once('error', reject);
      ws.on('message', raw => { if (JSON.parse(raw).type === 'connected') { clearTimeout(timeout); resolve(); } });
    });
  }
  await fetch(base + '/app/page.tsx');
  const updated = Promise.all(sockets.map(ws => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('HMR update timed out')), 20000);
    ws.on('message', raw => { const message = JSON.parse(raw); if (['update', 'full-reload', 'custom'].includes(message.type)) { clearTimeout(timeout); resolve(); } });
  })));
  await writeFile(page, originalPage.replace('return <Home />;', 'return <><span hidden>Docker HMR smoke</span><Home /></>;'));
  await updated;
  const manifest = async () => JSON.parse(await readFile('characters/manifest.json', 'utf8')).generation;
  const before = await manifest();
  await writeFile(character, originalCharacter + '\nconsole.debug("Docker character watcher smoke");\n');
  for (let i = 0; i < 120 && await manifest() === before; i++) await delay(500);
  assert.notEqual(await manifest(), before, 'Character edit must publish a new generation');
  console.log('PASS: HTTP/WSS HMR, trusted HTTPS, and character publication');
} finally {
  await writeFile(page, originalPage); await writeFile(character, originalCharacter);
  for (const ws of sockets) ws.terminate();
  tls.stop(); server.closeAllConnections(); server.close();
  await delay(1000); await rm(data, { recursive: true, force: true });
}
