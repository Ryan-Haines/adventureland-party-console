import {isLoopback} from './game/addresses.cjs';
import { test as base, expect, type Page, type TestInfo } from '@playwright/test';
import {cleanupWorkspace} from './workspace';
import { fork, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { gateway } from '../tools/hosting/gateway';
import { Access } from '../tools/hosting/access';
import { DebugInstances } from '../tools/debug/service';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
export async function unusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}
export function environment(extra: Record<string, string>) {
  // Do not inherit live console credentials, launch configuration, or gateway tokens.
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(AL_|E2E_)/.test(name)));
  return { ...env, ...extra };
}
export function child(file: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, log: string) {
  const process = fork(file, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  process.stdout!.on('data', bytes => appendFileSync(log, bytes));
  process.stderr!.on('data', bytes => appendFileSync(log, bytes));
  return process;
}
export async function stop(process: ChildProcess, graceful = false) {
  if (process.exitCode !== null || process.signalCode !== null) return;
  if (graceful && process.connected) process.send({ type: 'coordinator_shutdown' });
  else process.kill('SIGTERM');
  const deadline = Date.now() + 10_000;
  while (process.exitCode === null && process.signalCode === null && Date.now() < deadline) await delay(50);
  if (process.exitCode === null && process.signalCode === null) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Owned E2E child did not terminate')), 5000);
      process.once('exit', () => { clearTimeout(timer); resolve(); });
      process.kill('SIGKILL');
    });
  }
}
async function ready(process: ChildProcess, url: string, log: string) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (process.exitCode !== null || process.signalCode !== null) break;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
      await response.body?.cancel();
      if (response.ok) return;
    } catch { /* The owned server is still starting. */ }
    await delay(200);
  }
  throw new Error(`E2E service failed readiness at ${url}\n${existsSync(log) ? readFileSync(log, 'utf8').slice(-12000) : 'No output'}`);
}
export type App = { url: string; journal: string; restartCoordinator(): Promise<void>; crashCoordinator(whileDown?: () => unknown): Promise<void>; state(): Promise<any>; deliverStatus(report: unknown): Promise<unknown>; deliverMerchantCompletion(report: unknown): Promise<unknown> };

export const test = base.extend<{ app: App; merchantDialogs: boolean; merchantConnected: boolean; merchantManaged: boolean; playerInventory: boolean; marketStand: boolean; bankboiOfferings: boolean; mapCapture: boolean; standBuyOrders: boolean; mailbox:boolean; statusConditions:boolean; fixtureAddon: boolean; savedRecords: Record<string, unknown>[]; stateFields: string }, { dashboard: { port: number; log: string } }>({
  // Journal records a scenario saved before this start, appended after the other seeds.
  savedRecords: [[], {option:true}],
  // PARTY_STATE_FIELDS for the coordinator (docs/state-field-registry.md, Rollout).
  stateFields: ['', {option:true}],
  mailbox: [false, {option:true}],
  // W reports one condition, so the card's status icon row has an icon to show.
  statusConditions: [false, {option:true}],
  standBuyOrders: [false, {option:true}],
  mapCapture: [false, {option:true}],
  fixtureAddon: [false, {option:true}],
  bankboiOfferings: [false, {option:true}],
  merchantDialogs: [false, {option:true}],
  merchantConnected: [true, {option:true}],
  merchantManaged: [false, {option:true}],
  playerInventory: [false, {option:true}],
  marketStand: [false, {option:true}],
  dashboard: [async ({}, use) => {
    const directory = path.join(root, '.build/e2e', `dashboard-${randomUUID()}`);
    mkdirSync(directory, { recursive: true });
    const port = await unusedPort(), log = path.join(directory, 'dashboard.log');
    const candidate=JSON.parse(globalThis.process.env.E2E_DASHBOARD_CANDIDATE||'null');
    if(!candidate||!candidate.directory.startsWith(path.join(root,'.build/console/releases')+path.sep))throw Error('Verified E2E dashboard candidate required');
    const process = child(path.join(candidate.directory,'tools/dashboard/node-server.mts'),
      [String(port),path.join(candidate.directory,'dashboard/.build/container')],path.join(candidate.directory,'dashboard'),
      environment({NODE_ENV:'production',AL_DASHBOARD_PORT:String(port)}),log);
    let used=false;
    try {
      await ready(process, `http://127.0.0.1:${port}`, log);
      await use({ port, log });
      used=true;
    } finally { await stop(process);if(used)cleanupWorkspace(root,directory); }
  }, { scope: 'worker', timeout: 120_000 }],
  app: async ({ dashboard, merchantDialogs, merchantConnected, merchantManaged, playerInventory, marketStand, bankboiOfferings, mapCapture, standBuyOrders, mailbox, statusConditions, fixtureAddon, savedRecords, stateFields }, use, testInfo) => {
    const directory = path.join(root, '.build/e2e', `scenario-${randomUUID()}`);
    mkdirSync(directory, { recursive: true });
    if(mailbox){
      const records=[1,2].map(n=>({id:'sent-fixture-'+n,recipient:'Recipient',subject:n===1?'Sent fixture one':'Sent fixture two',message:'Declared historical confirmed send',sent:'2026-10-18T12:00:00Z'}));
      appendFileSync(path.join(directory,'state.jsonl'),JSON.stringify({party_dashboard_settings_state_v1:{mailbox:{settings:{autoCollect:false,autoDelete:false},seenIds:[],outbox:records}}})+'\n');
      await testInfo.attach('declared-historical-sent-mail',{body:JSON.stringify(records),contentType:'application/json'});
    }
    if(bankboiOfferings){
      // Declared historical account inventory, not a synthetic public stock map.
      const bankbois={E2EOfferingBank:{name:'E2EOfferingBank',state:'ready',items:['offeringp','offering','offeringx'].map((name,slot)=>({slot,item:{name,q:2}}))}};
      appendFileSync(path.join(directory,'state.jsonl'),JSON.stringify({party_dashboard_bank_state_v1:{bankbois}})+'\n');
      await testInfo.attach('declared-bankboi-offering-stock',{body:JSON.stringify(bankbois),contentType:'application/json'});
    }
    for (const record of savedRecords) appendFileSync(path.join(directory, 'state.jsonl'), JSON.stringify(record) + '\n');
    if (savedRecords.length) await testInfo.attach('declared-saved-records', { body: JSON.stringify(savedRecords), contentType: 'application/json' });
    const port = await unusedPort(), log = path.join(directory, 'coordinator.log');
    let coordinator: ChildProcess | undefined;
    async function start() {
      coordinator = child(path.join(root, 'e2e/coordinator.cjs'), [], root,
        environment({ E2E_MAILBOX:String(mailbox), E2E_STATUS_CONDITIONS:String(statusConditions), E2E_FIXTURE_ADDON: String(fixtureAddon), E2E_STAND_BUY_ORDERS: String(standBuyOrders), E2E_MAP_CAPTURE: String(mapCapture), E2E_MARKET_STAND: String(marketStand), E2E_COORDINATOR_PORT: String(port), E2E_DATA_DIR: directory, E2E_MERCHANT_DIALOGS: String(merchantDialogs), E2E_MERCHANT_CONNECTED: String(merchantConnected), E2E_MANAGED_MERCHANT: String(merchantManaged), E2E_PLAYER_INVENTORY: String(playerInventory), ...(stateFields ? { PARTY_STATE_FIELDS: stateFields } : {}) }), log);
      const started = coordinator;
      await new Promise<void>((resolve, reject) => {
        const output = () => existsSync(log) ? readFileSync(log, 'utf8') : 'No coordinator output';
        const cleanup = () => {
          clearTimeout(timeout);
          started.removeListener('exit', exited); started.removeListener('error', failed); started.removeListener('message', message);
        };
        const failed = (error: Error) => { cleanup(); reject(error); };
        const exited = (code: number | null) => failed(new Error(`Coordinator exited (${code})\n${output()}`));
        const message = (message: any) => {
          if (message?.type !== 'ready') return;
          cleanup(); resolve();
        };
        const timeout = setTimeout(() => failed(new Error(`Coordinator startup timed out\n${output()}`)), 30_000);
        started.once('exit', exited); started.once('error', failed); started.on('message', message);
      });
    }
    const access = new Access(path.join(directory, 'access.json'));
    await access.load();
    const debug = await new DebugInstances(root, path.join(directory, 'debug')).load();
    const server = gateway({ access, debug, configured: () => true, dashboardPort: dashboard.port, apiPort: port });
    let app: App | undefined;
    try {
      await start();
      await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
      const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      app = {
        url,
        // The scenario's own journal, read only by assertions about saved state.
        journal: path.join(directory, 'state.jsonl'),
        async restartCoordinator() { await stop(coordinator!, true); await start(); },
        // SIGKILL runs no shutdown handler, so nothing pending reaches the journal.
        async crashCoordinator(whileDown) {
          const crashed = coordinator!, exited = new Promise<void>(resolve => crashed.once('exit', () => resolve()));
          crashed.kill('SIGKILL'); await exited; await whileDown?.(); await start();
        },
        // External game observations enter the coordinator's private status
        // boundary, just like the scenario's recurring fixture heartbeats.
        async deliverStatus(report: unknown) {
          const response = await fetch(`http://127.0.0.1:${port}/party-api/status`, {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify(report), signal: AbortSignal.timeout(10_000),
          });
          const body = await response.text();
          if (!response.ok) throw new Error(`Fixture status request failed: ${response.status}: ${body}`);
          return JSON.parse(body);
        },
        async state() {
          const response = await fetch(`${url}/party-api/state`, { signal: AbortSignal.timeout(10_000) });
          if (!response.ok) throw new Error(`State request failed: ${response.status}`);
          return response.json();
        },
        async deliverMerchantCompletion(report: unknown) {
          // Declared worker outcome at the private boundary; not a fabricated
          // native game result. The console scenario tests retry presentation.
          const response=await fetch(`http://127.0.0.1:${port}/party-api/merchant/complete`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(report),signal:AbortSignal.timeout(10_000)});
          if(!response.ok) throw new Error(`Fixture merchant completion failed: ${response.status}: ${await response.text()}`);
          return response.json();
        },
      };
      await use(app);
    } finally {
      try {
        if ((await debug.status()).project) {
          await debug.stop();
          await expect.poll(async () => (await debug.status()).phase, { timeout: 120_000 }).toBe('stopped');
        }
        if (app) {
          try { await testInfo.attach('final-state', { body: JSON.stringify(await app.state(), null, 2), contentType: 'application/json' }); }
          catch (error) { await testInfo.attach('state-error', { body: String(error), contentType: 'text/plain' }); }
        }
      } finally {
        try {
          server.closeAllConnections();
          if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
        } finally { if (coordinator) await stop(coordinator, true); }
      }
      for (const file of [log, dashboard.log, path.join(directory, 'state.jsonl')]) {
        if (existsSync(file)) await testInfo.attach(path.basename(file), { path: file, contentType: 'text/plain' });
      }
      await testInfo.attach('workspace-cleanup',{body:JSON.stringify(cleanupWorkspace(root,directory)),contentType:'application/json'});
    }
  },
  baseURL: async ({ app }, use) => { await use(app.url); },
  context: async ({ context }, use, testInfo) => {
    // Test-only read recording for the field registry (docs/state-field-registry.md).
    // dashboard/features/party/field-read-audit.ts reports each first read per cache kind and field.
    if (process.env.PARTY_FIELD_AUDIT === '1') {
      const file = path.join(root, '.build/field-audit/reads.jsonl');
      mkdirSync(path.dirname(file), { recursive: true });
      await context.exposeBinding('__partyFieldAudit', (_source, record: object) =>
        appendFileSync(file, JSON.stringify({ test: testInfo.titlePath.join(' > '), ...record }) + '\n'));
    }
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      return isLoopback(url.hostname) || ['data:', 'blob:'].includes(url.protocol)
        ? route.continue() : route.abort('blockedbyclient');
    });
    await use(context);
  },
});
export { expect };

// The row loop of a scenario table: rows that share
// one run are steps of one test. `reset` runs between rows and puts the world back to the table's
// start. A failed row is recorded and the next rows still run after the reset; the loop fails at
// the end and names every failed row. `evidence` runs after a failed row or reset, before the
// next reset clears the world. E2E_ROWS (a substring of row names, `|` between several) runs only
// those rows, so a failed row runs once more without the rows that passed.
export type TableRow<World> = [name: string, run: (world: World, info: TestInfo, page: Page) => Promise<void>];
export function onlyRows<R extends [string, ...unknown[]]>(title: string, rows: R[]): R[] {
  const names = new Set<string>();
  for (const [name] of rows) { if (names.has(name)) throw Error(`Scenario table "${title}" repeats the row "${name}"`); names.add(name); }
  const only = globalThis.process.env.E2E_ROWS?.split('|').filter(Boolean);
  return only?.length ? rows.filter(([name]) => only.some(part => name.includes(part))) : rows;
}
export async function runRows<World>(world: World, info: TestInfo, page: Page, rows: TableRow<World>[],
  reset: (world: World, info: TestInfo) => Promise<void>, evidence?: (world: World, info: TestInfo, label: string) => Promise<void>) {
  const failed: {name: string; error: unknown}[] = [];
  const keep = async (label: string) => {
    if (evidence) await evidence(world, info, label).catch(error => info.attach(`${label}-evidence-failed`, {body: String(error), contentType: 'text/plain'}));
  };
  for (const [index, [name, run]] of rows.entries()) {
    if (index) await base.step(`reset before ${name}`, () => reset(world, info).catch(async error => { await keep(`reset-failed-${index}`); throw error; }));
    try { await base.step(name, () => run(world, info, page)); }
    catch (error) { failed.push({name, error}); console.log(`ROW-FAILED ${index} ${name}: ${String((error as Error)?.message ?? error).slice(0, 600)}`);
      await info.attach(`row-failed-${index}`, {body: String((error as Error)?.stack ?? error), contentType: 'text/plain'}); await keep(`row-failed-${index}`); }
  }
  if (failed.length === 1) throw failed[0].error;
  if (failed.length) throw new AggregateError(failed.map(f => f.error), `Rows failed: ${failed.map(f => f.name).join('; ')}`);
}
// A scenario table on the console fixture: the real coordinator and dashboard, no game server.
// `start` reads the table's start once, before the first row, and returns the reset to it.
export function consoleScenarioTable(title: string, timeoutMs: number,
  start: (app: App) => Promise<(app: App, info: TestInfo) => Promise<void>>, rows: TableRow<App>[]) {
  rows = onlyRows(title, rows);
  test(title, async ({app, page}, info) => {
    test.setTimeout(timeoutMs);
    await runRows(app, info, page, rows, await start(app));
  });
}

// The settings table's start and reset. The
// start is every declared setting's value as the fixture loads it, read from GET
// /party-api/settings; the reset plays a Pause a row left on and writes those values back through
// the settings route, which leaves an unchanged one alone. A secret setting's value stays on the
// coordinator, so the reset leaves it.
export async function settingsRowsReset(app: App) {
  const read = async () => (await (await fetch(`${app.url}/party-api/settings`, { signal: AbortSignal.timeout(10_000) })).json()) as
    { settings: { field: string; value?: unknown; secret?: boolean }[] };
  const values = (await read()).settings.filter(s => !s.secret).map(s => ({ field: s.field, value: s.value }));
  return async (app: App) => {
    const post = (route: string, body: unknown) => fetch(`${app.url}/party-api/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: app.url },
      body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
    const control = await (await fetch(`${app.url}/party-api/console-control`, { signal: AbortSignal.timeout(10_000) })).json() as { paused?: boolean };
    if (control.paused) expect((await post('console-control/play', {})).ok, 'the reset plays the Pause a row left on').toBe(true);
    const written = await post('settings', { changes: values });
    expect(written.status, await written.text()).toBe(200);
  };
}
