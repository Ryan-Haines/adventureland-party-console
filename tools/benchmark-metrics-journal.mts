// Drives #87's metrics service (runtime/coordinator/metrics/service.ts) the way
// four farming characters do: one frame per character per second, each POSTed
// at its own phase, as runtime/characters/metrics.ts sends them. Reports bytes
// appended to and compacted in the metrics journal, the live set, and how long
// each POST waits for its acknowledgement. Real time, so the commit window and
// the asynchronous journal writes run as they do on a console.
//
//   node tools/benchmark-metrics-journal.mts [--root <checkout>] [--seconds 120] [--characters 4]
//
// --root points at another checkout, so one script measures two builds.
// Frame contents follow the 1.5 impact review: two damage rows, one credit, a
// kill about every 3 s and loot about every 20 s per character.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { pathToFileURL } from 'node:url';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i]!.replace(/^--/, ''), process.argv[i + 1]!);
const root = path.resolve(args.get('root') || path.join(import.meta.dirname, '..'));
const seconds = Number(args.get('seconds') || 120);
const characterCount = Number(args.get('characters') || 4);
const { createMetricsService } = await import(pathToFileURL(path.join(root, 'runtime/coordinator/metrics/service.ts')).href);

const counters = { appendBytes: 0, appends: 0, compactionBytes: 0, compactions: 0 };
const fsModule = createRequire(import.meta.url)('node:fs');
const writeFile = fs.writeFile;
fsModule.writeFile = (target: unknown, data: string, ...rest: unknown[]) => {
  if (typeof target === 'number') { counters.appendBytes += Buffer.byteLength(data); counters.appends++; }
  return (writeFile as (...values: unknown[]) => void)(target, data, ...rest);
};
syncBuiltinESMExports();
const open = fs.promises.open;
fs.promises.open = (async (...values: Parameters<typeof open>) => {
  const handle = await open(...values);
  if (String(values[0]).endsWith('.compact')) {
    counters.compactions++;
    const write = handle.writeFile.bind(handle);
    handle.writeFile = ((data: string, ...rest: unknown[]) => {
      counters.compactionBytes += Buffer.byteLength(data);
      return (write as (...values: unknown[]) => Promise<void>)(data, ...rest);
    }) as typeof handle.writeFile;
  }
  return handle;
}) as typeof open;

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'metrics-benchmark-'));
const journal = path.join(directory, 'party.metrics.jsonl');
const service = createMetricsService(journal, { owned: () => true, now: () => Date.now(), warn: (error: unknown) => console.error(error), accountGold: () => 1_000_000_000 });
type Handler = (request: { body?: unknown; query?: unknown }, response: Response) => unknown;
interface Response { status(code: number): Response; json(value: unknown): Response }
const routes = new Map<string, Handler>();
service.install({ get: (route: string, handler: Handler) => routes.set('GET ' + route, handler),
  post: (route: string, handler: Handler) => routes.set('POST ' + route, handler) });
const post = routes.get('POST /party-api/metrics')!;

let seed = 11;
const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const names = Array.from({ length: characterCount }, (_, index) => 'Fighter' + (index + 1));
const sequences = new Map(names.map(name => [name, 0]));
let eventId = 0;
function frame(name: string, now: number) {
  const at = Math.floor((now - 1000) / 10_000) * 10_000, sequence = sequences.get(name)! + 1;
  sequences.set(name, sequence);
  const sampleAt = Math.max(at, now - 1000);
  const sample = (when: number) => ({ at: when, gold: 5_000_000 + sequence * 37, luck: 120, ping: 40, level: 80, xp: 1_000_000 + sequence * 900, maxXp: 90_000_000, goldMovement: 0 });
  const kills = random() < 0.33 ? [{ id: 'kill-' + (++eventId), at: sampleAt, monster: 'crabx', actor: name }] : [];
  const loot = random() < 0.05 ? [{ id: 'loot-' + (++eventId), at: sampleAt, item: 'seashell', variant: '{"level":0}', quantity: 1 }] : [];
  return { at, sequence, observedMs: 1000, partial: false, first: sample(sampleAt), last: sample(Math.min(at + 9999, sampleAt + 999)),
    damage: [{ monster: 'crabx', skill: 'attack', amount: 2400, hits: 2 }, { monster: 'crabx', skill: 'supershot', amount: 1800, hits: 1 }],
    credits: kills.length ? [{ monster: 'crabx', count: 1 }] : [], kills, loot };
}
const ackMs: number[] = [];
async function send(name: string) {
  const began = performance.now();
  let status = 200;
  const response: Response = { status(code) { status = code; return response; }, json() { return response; } };
  await (post({ body: { character: name, server: 'USIII', runtime: 'bench-' + name, frames: [frame(name, Date.now())] } }, response) as Promise<unknown>);
  if (status !== 200) throw Error('metrics POST answered ' + status);
  ackMs.push(performance.now() - began);
}

const startedAt = Date.now(), until = startedAt + seconds * 1000;
await Promise.all(names.map(async (name, index) => {
  // Each collector pulses on its own 1 s phase and skips a pulse while busy.
  await new Promise(resolve => setTimeout(resolve, Math.floor(1000 * (index + random()) / names.length)));
  let next = Date.now();
  while (Date.now() < until) {
    await send(name);
    next += 1000;
    while (next < Date.now()) next += 1000;
    await new Promise(resolve => setTimeout(resolve, next - Date.now()));
  }
}));
const elapsed = (Date.now() - startedAt) / 1000;
await service.close();
const fileBytes = fs.statSync(journal).size;
const liveBytes = fs.readFileSync(journal, 'utf8').split('\n').filter(Boolean).reduce((live, line) => {
  const key = line.slice(0, line.indexOf('":') + 1);
  live.set(key, Buffer.byteLength(line) + 1); return live;
}, new Map<string, number>());
fs.rmSync(directory, { recursive: true, force: true });

function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b), at = (share: number) => sorted[Math.min(sorted.length - 1, Math.ceil(share * sorted.length) - 1)]!;
  return { count: sorted.length, medianMs: +at(0.5).toFixed(1), p95Ms: +at(0.95).toFixed(1), maxMs: +sorted[sorted.length - 1]!.toFixed(1) };
}
const kb = (bytes: number) => +(bytes / 1024).toFixed(2);
console.log(JSON.stringify({
  root, seconds: +elapsed.toFixed(1), characters: characterCount,
  appendKBps: kb(counters.appendBytes / elapsed), appendsPerSecond: +(counters.appends / elapsed).toFixed(2),
  compactionKBps: kb(counters.compactionBytes / elapsed), compactions: counters.compactions,
  journalKB: kb(fileBytes), liveSetKB: kb([...liveBytes.values()].reduce((sum, bytes) => sum + bytes, 0)),
  projectedMBPerDay: +((counters.appendBytes / elapsed) * 86_400 / 1024 / 1024).toFixed(0),
  ack: stats(ackMs),
}, null, 2));
