import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, rm, chown } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Updates } from './service.ts';
import { exists, readJson, atomic } from './files.ts';
import type { Release } from './contracts.ts';
import { WindowsInstallation } from './windows.ts';
import { DockerInstallation } from './docker.ts';
import { updateRoute } from './hosting.ts';
import { failure, json } from '../hosting/http.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const container = process.env.AL_CONTAINER_UPDATER === '1';
const home = path.resolve(process.env.AL_INSTALL_HOME || path.join(root, '..'));
const data = path.resolve(process.env.AL_DATA_DIR || path.join(home, 'data'));
await mkdir(path.join(data, 'updates'), { recursive: true });
if (container) { await chown(data, 1000, 1000); await chown(path.join(data, 'updates'), 1000, 1000); }
const tokenFile = path.join(data, 'updates/token');
if (!(await exists(tokenFile))) await writeFile(tokenFile, randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' });
if (container) await chown(tokenFile, 1000, 1000);
const token = (await readFile(tokenFile, 'utf8')).trim();
const adapter = container ? new DockerInstallation(data, token) : new WindowsInstallation(home, data);
const initial = container ? root : path.join(home, await adapter.current());
const installed = await readJson<Release>(path.join(initial, 'release.json'));
const updates = new Updates(installed, path.join(data, 'updates/preferences.json'), adapter);
await updates.load();
let booting = false;
async function boot() {
  if (booting || updates.state.phase === 'restarting') return;
  booting = true;
  try {
    await atomic(path.join(data, 'updates/hold.json'), { startup: true });
    const current = container ? await (adapter as DockerInstallation).installedVersion() :
      (await readJson<Release>(path.join(home, await adapter.current(), 'release.json'))).version;
    if (current) updates.state.current = current;
    await updates.poll(true);
  } finally { await rm(path.join(data, 'updates/hold.json'), { force: true }); booting = false; }
}
const server = createServer(async (req, res) => {
  try {
    const credential = Buffer.from(req.headers.authorization || ''), expected = Buffer.from(`Bearer ${token}`);
    if (credential.length !== expected.length || !timingSafeEqual(credential, expected)) { json(res, 401, { error: 'Updater authentication required' }); return; }
    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname === '/boot' && req.method === 'POST') {
      if (!booting && updates.state.phase !== 'restarting') {
        await atomic(path.join(data, 'updates/hold.json'), { startup: true });
        void boot().catch(error => console.error('Startup update check:', error.message));
      }
      json(res, 202, { accepted: true }); return;
    }
    await updateRoute(updates, req, res, url.pathname);
  } catch (error) { failure(res, error); }
});
// Binding is also the inter-process installation lock: a second controller cannot run.
await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(925, container ? '0.0.0.0' : '127.0.0.1', resolve); });
if (container) await (adapter as DockerInstallation).recover();
else {
  await adapter.stop();
  await adapter.transaction.recover();
  await boot();
  // Startup installation may already have launched the application.
  if (!(await adapter.healthy())) await adapter.start(await adapter.current());
}
setInterval(() => void updates.poll(), 6 * 3600000).unref();
console.log('Adventureland Party Console update controller ready');
async function stop() { server.close(); if (!container) await adapter.stop(); process.exit(0); }
process.once('SIGINT', () => void stop()); process.once('SIGTERM', () => void stop());
