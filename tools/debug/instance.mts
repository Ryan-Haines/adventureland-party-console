import { chromium } from '@playwright/test';
import { fork, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { debugGateway } from './gateway.ts';
import { Access } from '../hosting/access.ts';
import { internalPorts, servicesHealthy } from '../hosting/health.ts';
import { configureDashboardGateway } from '../dashboard/api.ts';
import { DEFAULT_PUBLIC_PORT } from '../hosting/defaults.ts';
import { seedLoadout } from '../../e2e/game/loadouts.ts';
import { launchGameClient } from '../../e2e/live-game-client.ts';
import { startDesktop } from './desktop.ts';

if (process.env.AL_DEBUG_INSTANCE !== '1') throw Error('Disposable debug container only');
const token = process.env.AL_DEBUG_TOKEN || '';
if (!/^[a-f0-9]{64}$/.test(token)) throw Error('Debug access token required');
const root = process.cwd(), directory = path.join(root, '.build/e2e/debug');
await mkdir(directory, { recursive: true });
await mkdir('/data/localStorage', { recursive: true });
await mkdir('/data/game_files', { recursive: true });
await mkdir('/data/logs', { recursive: true });
configureDashboardGateway();
const require = createRequire(import.meta.url), game = require('../../e2e/game/bootstrap.cjs');
const children: ChildProcess[] = [];
let ready = false;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const access = new Access(path.join(directory, 'access.json')); await access.load();
// The instance is healthy once its party connected and while the console's own readiness answers
// yes, as the main host reads it (tools/hosting/health.ts); a quiet character shows in the console.
// The instance's two ports, from the host's one port rule (tools/hosting/health.ts internalPorts): the
// gateway proxies to them and the children start on them, so the two cannot disagree.
const ports = internalPorts();
const coordinator = `http://127.0.0.1:${ports.api}`;
const server = debugGateway(access, token, async () => ready && await servicesHealthy(true, ports.dashboard, ports.api),
  { dashboardPort: ports.dashboard, apiPort: ports.api });
server.listen(DEFAULT_PUBLIC_PORT, '0.0.0.0');
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function wait(check: () => Promise<boolean>, timeout = 180000) {
  const until = Date.now() + timeout; let error;
  while (Date.now() < until) { try { if (await check()) return; } catch (e) { error = e; } await delay(1000); }
  throw Error('Debug runtime startup timed out: ' + String(error));
}
function child(file: string, env: NodeJS.ProcessEnv, args: string[] = []) {
  const process = fork(path.join(root, file), args, { env, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
  own(process); return process;
}
function own(process: ChildProcess) {
  children.push(process);
  process.on('error', error => { console.error(error); void stop(1); });
  process.on('exit', code => { if (!stopping) void stop(code || 1); });
}
let stopping = false;
async function stop(code: number) {
  if (stopping) return; stopping = true; ready = false;
  const timeout = setTimeout(() => process.exit(code), 8000); timeout.unref();
  await browser?.close().catch(() => {});
  for (const process of children) process.kill('SIGTERM');
  server.close(); process.exit(code);
}
process.on('SIGTERM', () => void stop(0)); process.on('SIGINT', () => void stop(0));
try {
  await wait(async () => !!await game.admin('output=!!(server.live && G.maps.main)'));
  // Native upstream dev admission explicitly skips daily reservations. Production
  // credentials/endpoints are unavailable inside this disposable network.
  await game.admin("Dev=true; Prod=false; G.events.dreams.disabled=false; output={dev:Dev,prod:Prod}");
  const manifest = await game.bootstrap();
  await seedLoadout(game.admin, 'god');
  await game.admin("output=db.collection('character').updateMany({owner:data.owner},{$set:{'info.x':816,'info.y':1180}})", { owner: manifest.auth.split('-')[0] });
  child('e2e/live-coordinator.cjs', { ...process.env, E2E_DATA_DIR: directory, E2E_GAME_WEB_URL: manifest.webUrl,
    E2E_GAME_AUTH: manifest.auth, E2E_COORDINATOR_PORT: String(ports.api) });
  await wait(async () => (await fetch(coordinator + '/party-api/state')).ok);
  child('tools/dashboard/supervisor.mts', { ...process.env, AL_DASHBOARD_PUBLIC_PORT: String(ports.dashboard), AL_DASHBOARD_PREBUILT: '.build/container', NODE_ENV: 'production' }, ['--production']);
  const post = async (route: string, value: unknown) => {
    const response = await fetch(coordinator + '/party-api' + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
    if (!response.ok) throw Error(route + ': ' + await response.text()); return response.json();
  };
  const current = await (await fetch(coordinator + '/party-api/state')).json();
  await post('/merchant/routine-priorities', { priorities: {}, enabled: Object.fromEntries(Object.keys(current.merchantAutomations).map(name => [name, false])) });
  await post('/formation', { leader: null });
  for (const name of ['E2EWarrior', 'E2EPriest', 'E2EMerchant']) await post('/formation', { character: name, follow: false, eventSelections: [] });
  await post('/formation', { leader: 'E2EWarrior' });
  await post('/formation', { character: 'E2EPriest', follow: true });
  await startDesktop(own);
  browser = await chromium.launch({ headless: false, env: { ...process.env, DISPLAY: ':99' }, args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-position=0,0', '--window-size=1440,1000'] });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await context.addCookies([{ name: 'auth', value: manifest.auth, url: manifest.webUrl }]);
  const primary = await launchGameClient(context, { webUrl: manifest.webUrl, coordinatorUrl: coordinator, name: 'E2EWarrior', region: 'US', server: 'I' });
  for (const name of ['E2EPriest', 'E2EMerchant']) {
    await wait(async () => (await (await fetch(coordinator + '/party-api/steam/connection')).json()).ready);
    const login = await post('/steam/action', { character: name, action: 'login' });
    if (login.operation?.phase === 'awaiting-realm-choice') await post('/steam/realm-choice', { operationId: login.operation.id, choice: 'stay' });
    await launchGameClient(context, { webUrl: manifest.webUrl, coordinatorUrl: coordinator, name, region: 'US', server: 'I', primary });
    await wait(async () => (await (await fetch(coordinator + '/party-api/state')).json()).steamSwitch?.phase === 'complete');
  }
  await wait(async () => (await (await fetch(`http://127.0.0.1:${ports.dashboard}/__dashboard/state`)).json()).ready);
  await writeFile('/data/debug-ready.json', JSON.stringify({ god: true, unlimited: true, characters: manifest.characters.map((c: {name: string}) => c.name) }));
  ready = true; console.log('Debug god party connected; unlimited native Cave visits enabled.');
} catch (error) { console.error(error); await stop(1); }
