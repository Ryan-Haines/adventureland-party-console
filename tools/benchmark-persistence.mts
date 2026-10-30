// Drives the coordinator persistence writer and journal at the event rates
// measured on a live console (docs/efficiency.md, Persistence) and reports disk
// bytes and the time each persistence call takes.
//
//   node tools/benchmark-persistence.mts [--root <checkout>] [--scenario farming|production] [--seconds 600]
//
// --root points at another checkout, so one script measures two builds.
// node:test mock timers simulate the time; durations are real CPU time.
/* oxlint-disable typescript/no-explicit-any -- the synthetic state is untyped saved JSON. */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { mock } from 'node:test';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { pathToFileURL } from 'node:url';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i]!.replace(/^--/, ''), process.argv[i + 1]!);
const root = path.resolve(args.get('root') || path.join(import.meta.dirname, '..'));
const scenario = args.get('scenario') || 'farming';
const seconds = Number(args.get('seconds') || 600);
const persistence = path.join(root, 'runtime/coordinator/persistence');
const { CoordinatorJsonlStore } = await import(pathToFileURL(path.join(persistence, 'jsonl-store.ts')).href);
const { createCoordinatorPersistence } = await import(pathToFileURL(path.join(persistence, 'writer.ts')).href);
const { settingsFields } = await import(pathToFileURL(path.join(persistence, 'snapshots.ts')).href);

let seed = 7;
const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const text = (length: number) => Array.from({ length }, () => 'abcdefghijklmnopqrstuvwxyz'[Math.floor(random() * 26)]).join('');
const fighters = ['F1', 'F2', 'F3', 'N1'];
const start = 1_790_000_000_000;

// Document sizes match the live journal of 2026-10-18: history 1.08 MB,
// settings 1.23 MB (market 0.62 MB, production 0.33 MB, anniversary 0.13 MB),
// bank 4.3 MB, roster 6 KB, selections 4.6 KB.
function combatEntry(at: number) { return { at, type: 'info', message: 'killed a Tiny Crab ' + text(330), details: null }; }
const state: Record<string, any> = Object.fromEntries(settingsFields.map((field: string) => [field, null]));
Object.assign(state, {
  merchantActivity: Array.from({ length: 500 }, (_, i) => ({ at: start + i, level: 'info', message: text(400) })),
  combatLogs: Object.fromEntries(fighters.map(name => [name, Array.from({ length: 500 }, (_, i) => combatEntry(start + i))])),
  production: { attempts: Object.fromEntries(Array.from({ length: 1400 }, (_, i) => ['attempt-' + i, { id: 'attempt-' + i, item: text(60), journal: { phase: 'complete', at: start + i, receipt: text(120) } }])) },
  anniversary: { activity: Array.from({ length: 300 }, (_, i) => ({ at: start + i, message: text(400) })) },
  standPriceHistory: Object.fromEntries(Array.from({ length: 160 }, (_, i) => ['item' + i, { seenAt: start, recent: 1000 + i, recentLevel: 0, samples: [1, 2, 3] }])),
  eventAttendance: Object.fromEntries(fighters.map(name => [name, Object.fromEntries(['mrpumpkin', 'mrgreen', 'slenderman'].map(event =>
    [event, { id: event + '-1', realm: 'USIII', lastLiveAt: start, ended: false, elapsedMs: 0, lastObservedAt: start, attending: true, deaths: 0, lastDeathAt: 0, dead: false }]))])),
  eventSessions: Object.fromEntries(fighters.map(name => [name, { event: 'mrpumpkin', id: 'mrpumpkin-1', lastLiveAt: start, authorizedAt: start, participants: [name], waypoints: {}, checkpoint: null }])),
  farmingProfiles: Object.fromEntries(fighters.map(name => [name, { huntSettings: { relocateIfCompeting: true }, filler: text(2500) }])),
  farmAreaState: { recoveryVersion: 2, paused: false, failures: {}, pending: null, message: null, quiet: {}, activity: {} },
  merchantQueue: Array.from({ length: 20 }, (_, i) => ({ id: 'job-' + i, kind: 'restock', note: text(200) })),
  // Everything else in settings: rules, marks, histories that change rarely.
  merchantRules: { filler: text(85_000) },
  aldata: {
    marketListings: Array.from({ length: 1200 }, () => ({ item: text(12), price: 1000, merchant: text(10), filler: text(380) })),
    marketBuyOrders: Array.from({ length: 260 }, () => ({ item: text(12), price: 1000, merchant: text(10), filler: text(380) })),
    trades: Array.from({ length: 30 }, () => ({ item: text(12), filler: text(350) })),
    merchantsUpdatedAt: start, tradesUpdatedAt: start,
    key: 'secret', auth: 'YES', authCheckedAt: start, publishedAt: start,
  },
  characterAppearances: { filler: text(5800) }, headlessSlots: fighters.slice(0, 3), nativeOwner: 'N1', steamMembers: ['N1'], steamSwitch: null,
  bankSnapshot: { packs: { items0: Array.from({ length: 9000 }, () => ({ name: text(10), meta: text(470) })) } },
  withdrawals: [], bankbois: {}, bankboiQueue: [], bankboiTransaction: null, bankboiReservedMigrated: true,
  marked: { filler: text(4500) }, merchantMarked: {}, autoItemMarks: {}, autoUpgradeMarks: {}, monsterFocus: ['crab'],
  monsterFocusByCharacter: {}, monsterPrioritiesByCharacter: {}, monsterSearchRadiusByCharacter: {},
});

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'persistence-benchmark-'));
const counters = { appendBytes: 0, compactionBytes: 0, fsyncs: 0, compactions: 0 };
let compacting = false;
const fsModule = createRequire(import.meta.url)('node:fs');
const writeFileSync = fs.writeFileSync, fsyncSync = fs.fsyncSync;
fsModule.writeFileSync = (target: unknown, data: string | Uint8Array, ...rest: unknown[]) => {
  if (typeof target === 'number') {
    const bytes = typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength;
    if (compacting) counters.compactionBytes += bytes; else counters.appendBytes += bytes;
  }
  return (writeFileSync as any)(target, data, ...rest);
};
fsModule.fsyncSync = (fd: number) => { counters.fsyncs++; return fsyncSync(fd); };
syncBuiltinESMExports();
const compactionMs: number[] = [];
const refactor = CoordinatorJsonlStore.prototype.refactor;
CoordinatorJsonlStore.prototype.refactor = function (this: unknown, ...rest: unknown[]) {
  const before = counters.compactionBytes, began = performance.now();
  compacting = true;
  try { return refactor.apply(this, rest); }
  finally {
    compacting = false;
    if (counters.compactionBytes > before) { counters.compactions++; compactionMs.push(performance.now() - began); }
  }
};

mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'setImmediate', 'Date'], now: start });
const timerMs: number[] = [];
const scheduled = globalThis.setTimeout;
(globalThis as any).setTimeout = (callback: () => void, delay: number) => scheduled(() => {
  const began = performance.now();
  try { callback(); } finally { timerMs.push(performance.now() - began); }
}, delay);

const store = new CoordinatorJsonlStore(path.join(directory, 'garage.jsonl'), path.join(directory, 'garage.new.jsonl'));
const writer = createCoordinatorPersistence(state, store);
writer.roster(); writer.bank(); writer.settings(); writer.history(); writer.flush?.();
store.refactor();
for (const key of Object.keys(counters) as (keyof typeof counters)[]) counters[key] = 0;
compactionMs.length = 0; timerMs.length = 0;

const callMs: Record<string, number[]> = { report: [], roster: [], scheduleSettings: [], history: [], bank: [] };
function measured(name: string, call: () => void) {
  const began = performance.now(); call(); const spent = performance.now() - began;
  callMs[name]!.push(spent); return spent;
}

// Live rates (docs/efficiency.md, Measurements): 4 status reports/s, one of them
// native (roster write); 3.3 combat lines/s; merchant activity 0.25/s while
// farming and 2/s plus 2 production phase changes/s during production.
const step = 50;
const production = scenario === 'production';
let combatCredit = 0, merchantCredit = 0, productionCredit = 0;
for (let at = 0; at < seconds * 1000; at += step) {
  const now = Date.now();
  if (at % 250 === 0) {
    const name = fighters[(at / 250) % 4]!;
    let spent = 0;
    for (const entry of Object.values(state.eventAttendance[name]) as any[]) { entry.lastLiveAt = entry.lastObservedAt = now; entry.elapsedMs += 250; }
    state.eventSessions[name].lastLiveAt = now;
    state.farmAreaState.quiet['area-1'] = now;
    spent += measured('scheduleSettings', () => writer.scheduleSettings());
    if (name === 'N1') spent += measured('roster', () => writer.roster());
    callMs.report!.push(spent);
  }
  combatCredit += 3.3 * step / 1000;
  while (combatCredit >= 1) {
    combatCredit--;
    const log = state.combatLogs[fighters[Math.floor(random() * 3)]!];
    log.push(combatEntry(now)); if (log.length > 500) log.splice(0, log.length - 500);
    measured('history', () => writer.history());
  }
  merchantCredit += (production ? 2 : 0.25) * step / 1000;
  while (merchantCredit >= 1) {
    merchantCredit--;
    state.merchantActivity.push({ at: now, level: 'info', message: text(400) });
    if (state.merchantActivity.length > 500) state.merchantActivity.splice(0, state.merchantActivity.length - 500);
    measured('history', () => writer.history());
  }
  if (production) {
    productionCredit += 2 * step / 1000;
    while (productionCredit >= 1) {
      productionCredit--;
      const attempt = state.production.attempts['attempt-' + Math.floor(random() * 1400)];
      attempt.journal.phase = attempt.journal.phase === 'complete' ? 'running' : 'complete';
      measured('scheduleSettings', () => writer.scheduleSettings());
    }
  }
  if (at % 20_000 === 0) { state.merchantQueue[0].note = text(200); writer.scheduleSettings(); }
  if (at % 300_000 === 0 && at) {
    state.aldata.marketListings = state.aldata.marketListings.map((entry: any) => ({ ...entry, price: entry.price + 1 }));
    state.aldata.merchantsUpdatedAt = now; writer.scheduleSettings();
    state.bankSnapshot.packs.items0[0].name = text(10); measured('bank', () => writer.bank());
  }
  mock.timers.tick(step);
}
const appendedBeforeShutdown = counters.appendBytes, compactedBeforeShutdown = counters.compactionBytes;
const fsyncsBeforeShutdown = counters.fsyncs, compactionsBeforeShutdown = counters.compactions;
// Direct save calls, 30 each, after the timed run so their bytes stay out of
// the rates: a changed and an unchanged 4.3 MB bank save, and an immediate
// settings save with a material change (production routes call it).
const direct: Record<string, number[]> = { bankChanged: [], bankUnchanged: [], settingsChanged: [] };
for (let i = 0; i < 30; i++) {
  state.bankSnapshot.packs.items0[0].name = text(10);
  // Ticks between calls run deferred compactions outside the measured call.
  let began = performance.now(); writer.bank(); direct.bankChanged!.push(performance.now() - began);
  mock.timers.tick(1);
  began = performance.now(); writer.bank(); direct.bankUnchanged!.push(performance.now() - began);
  mock.timers.tick(1);
  state.merchantQueue[0].note = text(200);
  began = performance.now(); writer.settings(); direct.settingsChanged!.push(performance.now() - began);
  mock.timers.tick(1);
}
const shutdownBegan = performance.now();
writer.flush?.(); store.close();
const shutdownMs = performance.now() - shutdownBegan;
fs.rmSync(directory, { recursive: true, force: true });

function stats(values: number[]) {
  if (!values.length) return { count: 0 };
  const sorted = [...values].sort((a, b) => a - b), at = (share: number) => sorted[Math.min(sorted.length - 1, Math.ceil(share * sorted.length) - 1)]!;
  return { count: sorted.length, medianMs: +at(0.5).toFixed(3), p95Ms: +at(0.95).toFixed(3), maxMs: +sorted[sorted.length - 1]!.toFixed(3) };
}
const mb = (bytes: number) => +(bytes / 1024 / 1024).toFixed(3);
console.log(JSON.stringify({
  root, scenario, seconds,
  appendMBps: mb(appendedBeforeShutdown / seconds),
  compactionMBps: mb(compactedBeforeShutdown / seconds),
  totalMBps: mb((appendedBeforeShutdown + compactedBeforeShutdown) / seconds),
  fsyncs: fsyncsBeforeShutdown, compactions: compactionsBeforeShutdown,
  compaction: stats(compactionMs), timerSaves: stats(timerMs),
  calls: Object.fromEntries(Object.entries(callMs).map(([name, values]) => [name, stats(values)])),
  direct: Object.fromEntries(Object.entries(direct).map(([name, values]) => [name, stats(values)])),
  shutdownMs: +shutdownMs.toFixed(1),
}, null, 2));
