// Replays a copy of a real metrics journal through the metrics service
// (runtime/status/coordinator/metrics/service.ts) on a simulated clock: four characters send one
// frame a second, the bucket timer runs at each bucket start, and with --view the dashboard's
// Metrics view polls its routes (history, kills and both bar charts each second, gold history and
// account gold each 10 s, as dashboard/features/party/metrics-*.tsx do). Reports the load's CPU and
// memory, the CPU per simulated hour, and the bytes on disk before and after.
//
//   node --expose-gc tools/benchmark-metrics-history.mts --journal <copy> [--root <checkout>] [--hours 12] [--view 1]
//
// The journal is copied into a temporary folder first, so the source file is only read. --root
// points at another checkout, so one script measures two builds.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PerformanceObserver } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i]!.replace(/^--/, ''), process.argv[i + 1]!);
const root = path.resolve(args.get('root') || path.join(import.meta.dirname, '..'));
const source = path.resolve(args.get('journal') || '');
const hours = Number(args.get('hours') || 12), view = args.get('view') === '1';
const { createMetricsService } = await import(pathToFileURL(path.join(root, 'runtime/status/coordinator/metrics/service.ts')).href);

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'metrics-history-'));
const journal = path.join(directory, 'party.metrics.jsonl');
fs.copyFileSync(source, journal);
if (fs.existsSync(source + '.days')) fs.cpSync(source + '.days', journal + '.days', { recursive: true });
// The clock starts one bucket after the journal's newest bucket, so the history reads as it did live.
let newest = 0;
for (const line of fs.readFileSync(journal, 'utf8').split('\n')) {
  const at = /^\{"(?:bucket|part):(?:\d+:)?(\d+)/.exec(line)?.[1];
  if (at) newest = Math.max(newest, Number(at));
}
let now = newest + 10_000;
const timers = new Map<number, { due: number; run(): void }>();
let timerId = 0;
const scope = {
  // A turn with no delay runs on the real loop, so a long pass's yields go on; a delayed timer waits
  // for the simulated clock.
  setTimeout(run: () => void, ms?: number) {
    const id = ++timerId;
    if (!ms) { setImmediate(() => { if (timers.delete(id)) run(); }); timers.set(id, { due: now, run }); return id; }
    timers.set(id, { due: now + ms, run }); return id;
  },
  clearTimeout(id: number | undefined) { if (id !== undefined) timers.delete(id); },
};
const turn = () => new Promise(resolve => setImmediate(resolve));
function diskBytes() {
  let bytes = 0;
  const walk = (folder: string) => { for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) walk(file); else if (!entry.name.endsWith('.lock') && !entry.name.endsWith('.guard')) bytes += fs.statSync(file).size;
  } };
  walk(directory); return bytes;
}
const gc = (globalThis as { gc?: () => void }).gc;
function memory() { gc?.(); gc?.(); const usage = process.memoryUsage(); return { heapMB: +(usage.heapUsed / 2 ** 20).toFixed(0), rssMB: +(usage.rss / 2 ** 20).toFixed(0) }; }

const startBytes = diskBytes();
const loadCpu = process.cpuUsage(), loadWall = performance.now();
const service = createMetricsService(journal, { owned: () => true, now: () => now, warn: (error: unknown) => console.error(error), accountGold: () => 1_000_000_000, timers: scope });
type Handler = (request: { body?: unknown; query?: unknown }, response: Response) => unknown;
interface Response { status(code: number): Response; json(value: unknown): Response }
const routes = new Map<string, Handler>();
service.install({ get: (route: string, handler: Handler) => routes.set('GET ' + route, handler),
  post: (route: string, handler: Handler) => routes.set('POST ' + route, handler) });
for (let i = 0; i < 20; i++) await turn();
const loadUsed = process.cpuUsage(loadCpu);
const load = { cpuS: +((loadUsed.user + loadUsed.system) / 1e6).toFixed(2), wallS: +((performance.now() - loadWall) / 1000).toFixed(2), ...memory(), diskMB: +(diskBytes() / 2 ** 20).toFixed(1) };

async function call(route: string, input: object) {
  let status = 200;
  const response: Response = { status(code) { status = code; return response; }, json() { return response; } };
  await (routes.get(route)!(input, response) as Promise<unknown>);
  if (status !== 200) throw Error(route + ' answered ' + status);
}
const names = ['Icelocked', 'Recharged', 'Sadokunn', 'Patinder'];
const sequences = new Map(names.map(name => [name, 0]));
let eventId = 0, seed = 11;
const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
// One frame of the farming party: two damage rows, a kill about every 3 s and loot about every 20 s
// per fighter, as tools/benchmark-metrics-journal.mts sends them; the merchant sends samples only.
function frame(name: string) {
  const at = Math.floor((now - 1000) / 10_000) * 10_000, sequence = sequences.get(name)! + 1, sampleAt = Math.max(at, now - 1000);
  sequences.set(name, sequence);
  const sample = (when: number) => ({ at: when, gold: 5_000_000 + sequence * 37, luck: 1.2, ping: 40, level: 75, xp: 1_000_000 + sequence * 900, maxXp: 750_000_000, goldMovement: 0, consumableCost: 0, consumablePurchases: 0, encouragementLuck: 1 });
  const fighter = name !== 'Patinder';
  const kills = fighter && random() < 0.33 ? [{ id: 'kill-' + (++eventId), at: sampleAt, monster: 'snake', actor: name }] : [];
  const loot = fighter && random() < 0.05 ? [{ id: 'loot-' + (++eventId), at: sampleAt, item: 'seashell', variant: '{"level":0}', quantity: 1 }] : [];
  return { at, sequence, observedMs: 1000, partial: false, first: sample(sampleAt), last: sample(Math.min(at + 9999, sampleAt + 999)),
    damage: fighter ? [{ monster: 'snake', skill: 'attack', amount: 2400, hits: 2 }, { monster: 'osnake', skill: 'attack', amount: 1800, hits: 1 }] : [],
    credits: kills.length ? [{ monster: 'snake', count: 1 }] : [], kills, loot };
}
async function runTimers() {
  for (const [id, timer] of [...timers].sort((a, b) => a[1].due - b[1].due)) if (timer.due <= now && timers.delete(id)) timer.run();
  await turn();
}
async function poll(second: number) {
  // The calendar day so far, as the dashboard asks it, here in UTC; at midnight the day before.
  const midnight = Math.floor((now - 1) / 86_400_000) * 86_400_000;
  const range = { from: String(now - 3_600_000), to: String(now), dayFrom: String(midnight), dayTo: String(now) };
  await call('GET /party-api/metrics', { query: { from: range.from, to: range.to } });
  await call('GET /party-api/metrics/kills', { query: range });
  await call('GET /party-api/metrics/bars', { query: { ...range, metric: 'damage' } });
  await call('GET /party-api/metrics/bars', { query: { ...range, metric: 'loot' } });
  if (second % 10 === 0) {
    await call('GET /party-api/metrics', { query: { sinceReset: 'gold', resetAt: '0', to: String(now) } });
    await call('GET /party-api/metrics/account-gold', { query: { resetAt: '0', to: String(now) } });
  }
}
// Garbage collection time, which grows with the heap the history keeps.
let gcMs = 0;
const collections = new PerformanceObserver(list => { for (const entry of list.getEntries()) gcMs += entry.duration; });
collections.observe({ entryTypes: ['gc'] });
const runCpu = process.cpuUsage(), runWall = performance.now();
let peakRss = 0;
for (let second = 0; second < hours * 3600; second++) {
  now += 1000;
  await runTimers();
  for (const name of names) await call('POST /party-api/metrics', { body: { character: name, server: 'USII', runtime: 'bench-' + name, frames: [frame(name)] } });
  if (view) await poll(second);
  if (second % 600 === 0) peakRss = Math.max(peakRss, process.memoryUsage().rss);
}
for (let i = 0; i < 200; i++) await turn();
const used = process.cpuUsage(runCpu);
collections.disconnect();
const run = { cpuSPerHour: +((used.user + used.system) / 1e6 / hours).toFixed(2), gcSPerHour: +(gcMs / 1000 / hours).toFixed(2), wallS: +((performance.now() - runWall) / 1000).toFixed(1),
  peakRssMB: +(peakRss / 2 ** 20).toFixed(0), ...memory(), diskMB: +(diskBytes() / 2 ** 20).toFixed(1) };
await service.close();
// A restart on the history the run left: what a console holds once the journal is in its steady form.
const restartCpu = process.cpuUsage(), restartWall = performance.now(), restartBytes = diskBytes();
const again = createMetricsService(journal, { owned: () => true, now: () => now, warn: (error: unknown) => console.error(error), accountGold: () => 1_000_000_000, timers: scope });
for (let i = 0; i < 20; i++) await turn();
const restartUsed = process.cpuUsage(restartCpu);
const restart = { diskMB: +(restartBytes / 2 ** 20).toFixed(1), cpuS: +((restartUsed.user + restartUsed.system) / 1e6).toFixed(2), wallS: +((performance.now() - restartWall) / 1000).toFixed(2), ...memory() };
await again.close();
// --keep copies the history the run left, so a fresh process can load it (--hours 0).
if (args.get('keep')) fs.cpSync(directory, path.resolve(args.get('keep')!), { recursive: true, filter: file => !/\.(lock|guard)$/.test(file) });
fs.rmSync(directory, { recursive: true, force: true });
console.log(JSON.stringify({ root, journal: source, hours, view, startDiskMB: +(startBytes / 2 ** 20).toFixed(1), load, run, restart }, null, 2));
