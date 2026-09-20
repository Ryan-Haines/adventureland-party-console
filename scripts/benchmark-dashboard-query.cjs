// Read-only replay benchmark against a running coordinator. It never sends game actions.
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');
const { createPublicStateRoute } = require('../runtime/coordinator/telemetry/public-state.ts');
const { createDashboardStream } = require('../runtime/coordinator/telemetry/dashboard-stream.ts');
const { httpFixture } = require('./tests/helpers/coordinator-http.cjs');
async function main() {
  const url = process.env.PARTY_BENCHMARK_URL || 'http://127.0.0.1:924/party-api';
  const full = await fetch(url + '/state').then(response => response.json());
  const market = await fetch(url + '/aldata/market').then(response => response.json());
  const source = execFileSync('git', ['show', 'HEAD:runtime/coordinator/telemetry/public-state.ts'], { encoding: 'utf8', windowsHide: true });
  const filename = path.resolve('runtime/coordinator/telemetry/benchmark-baseline.cjs');
  const baseline = new Module(filename, module); baseline.filename = filename;
  baseline.paths = Module._nodeModulePaths(path.dirname(filename));
  baseline._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
  const state = { ...full, statuses: full.characters, commands: {}, location: full.partyLocation,
    abtestingStrategy: full.eventStrategy, bankSnapshot: full.bank, merchantQueue: full.merchantQueue || [], merchantCurrent: full.merchantCurrent || null };
  const ports = { now: Date.now, handoff: () => full.steamSwitch, aldata: () => ({ ...market }), servers: () => [],
    roster: () => full.roster, slots: () => full.activeSlots, classes: full.classChoices,
    eventSchedules: () => full.eventSchedules, anniversary: () => full.anniversary, job: value => value,
    luckSchedule: () => full.mluckSchedule, bankbois: () => full.bankbois, realmControl: () => full.realmControl };
  const oldRoute = baseline.exports.createPublicStateRoute(state, ports), newRoute = createPublicStateRoute(state, ports);
  function read(route, section, enhanced = false) {
    let value; route({ query: { section, catalog: '0', ...(enhanced ? { dashboard: '1' } : {}) } }, { json: data => { value = JSON.stringify(data); } });
    return Buffer.byteLength(value);
  }
  function replay(route, policy, enhanced) {
    const start = performance.now(), cpu = process.cpuUsage(); let bytes = 0;
    for (let round = 0; round < 10; round++) for (const [section, count] of policy)
      for (let index = 0; index < (count === 0.5 ? (round % 2 ? 0 : 1) : count); index++) bytes += read(route, section, enhanced);
    const used = process.cpuUsage(cpu);
    return { tenSecondsBytes: bytes, wallMs: performance.now() - start, cpuMs: (used.user + used.system) / 1000 };
  }
  const old = replay(oldRoute, [['fast', 4], ['core', 1], ['inventory', 0.5], ['logs', 1]], false);
  const current = replay(newRoute, [['core', 1], ['logs', 1]], true);
  const names = full.activeSlots.filter(slot => slot.character).map(slot => slot.character);
  const fixture = httpFixture(); let at = Date.now();
  const stream = createDashboardStream({ now: () => at, statuses: () => state.statuses, active: name => names.includes(name), every: () => 1, cancel() {} });
  stream.install(fixture.router);
  names.forEach(name => { state.statuses[name].dashboardRuntime = 'benchmark'; });
  const connection = fixture.invoke('GET', '/party-api/dashboard-stream');
  let wireBytes = 0; connection.response.write = data => { wireBytes += Buffer.byteLength(data); return true; };
  let telemetryBytes = 0; const start = performance.now(), cpu = process.cpuUsage();
  for (let sample = 1; sample <= 100; sample++) {
    at += 100;
    for (const name of names) {
      const body = { name, runtime: 'benchmark', ...stream.lease(name), sample, sampledAt: at,
        data: { vitals: { hp: Number(state.statuses[name].hp) - sample, conditions: state.statuses[name].conditions || [] } } };
      telemetryBytes += Buffer.byteLength(JSON.stringify(body));
      fixture.invoke('POST', '/party-api/dashboard-telemetry', body);
    }
  }
  const used = process.cpuUsage(cpu); connection.request.close();
  const result = { at: new Date().toISOString(), characters: names.length,
    caveat: 'Same four-character snapshot replay; projection CPU only. Wire estimates exclude HTTP headers, map streams, unchanged bot status traffic, and mail. Ten seconds, combat HP at 10 Hz. Not a physical browser/LAN benchmark.',
    old, current, telemetry: { clientBytes: telemetryBytes, streamBytes: wireBytes, wallMs: performance.now() - start, cpuMs: (used.user + used.system) / 1000 },
    currentCoreBytes: read(newRoute, 'core', true) };
  fs.writeFileSync('.build/query-replay-benchmark.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
