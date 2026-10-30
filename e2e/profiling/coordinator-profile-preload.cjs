// Coordinator profiling preload for live-coordinator.cjs on the disposable game
// stack only (docs/efficiency.md, Coordinator). Load it with
// NODE_OPTIONS="--require <absolute path>" and PROF_DIR set; every other process
// ignores it. SIGUSR2 starts a window and the next SIGUSR2 writes
// <PROF_DIR>/coordinator-<pid>.json and, unless PROF_LIGHT=1, a V8 CPU profile.
//
// Each status report records the handler time (request body received to
// response end, which covers JSON parse, every ingestion stage and the response
// serialization) and the per-stage times the coordinator itself put in that
// response's transportTiming.statusStages. GET /party-api/state records its
// handler time per section.
const path = require('node:path');
const fs = require('node:fs');
const script = String(process.argv[1] || '');
if (/live-coordinator\.cjs$/.test(script) && process.env.PROF_DIR) {
  const http = require('node:http');
  const inspector = require('node:inspector');
  const { performance, monitorEventLoopDelay } = require('node:perf_hooks');
  const dir = process.env.PROF_DIR;
  const light = process.env.PROF_LIGHT === '1';
  const interval = Number(process.env.PROF_INTERVAL_US || 250);
  let active = false;
  let reports = [], combat = 0, reads = [];
  const emit = http.Server.prototype.emit;
  http.Server.prototype.emit = function (event, req, res) {
    if (event === 'request' && active) {
      req.profileStartedAt = performance.now();
      req.once('end', () => { req.profileBodyAt = performance.now(); });
    }
    return emit.apply(this, arguments);
  };
  const end = http.ServerResponse.prototype.end;
  http.ServerResponse.prototype.end = function (chunk, ...rest) {
    const req = this.req;
    if (active && req && req.profileStartedAt !== undefined) {
      const at = performance.now(), url = String(req.originalUrl || req.url || '');
      try {
        if (req.method === 'POST' && url.split('?')[0] === '/party-api/status') {
          const body = req.body || {};
          if (body.combatOnly === true || body.combatWait === true) combat++;
          else {
            const text = chunk ? String(chunk) : '';
            const index = text.lastIndexOf('"transportTiming":');
            let stages = null;
            if (index >= 0) {
              const timing = JSON.parse(text.slice(index + 18, text.length - 1));
              stages = Object.fromEntries(Object.entries(timing.statusStages || {}).map(([key, value]) => [key, value.lastMs]));
            }
            reports.push({ name: body.name, at: Date.now(), handlerMs: at - (req.profileBodyAt ?? req.profileStartedAt),
              totalMs: at - req.profileStartedAt, inBytes: Number(req.headers['content-length']) || 0, outBytes: text.length, stages });
          }
        } else if (req.method === 'GET' && url.startsWith('/party-api/state')) {
          const section = new URL(url, 'http://local').searchParams.get('section') || 'full';
          reads.push({ section, ms: at - (req.profileBodyAt ?? req.profileStartedAt) });
        }
      } catch (_) {}
    }
    return end.call(this, chunk, ...rest);
  };
  let session = null, started = 0, cpu0 = null, eld = null;
  function start() {
    session = new inspector.Session(); session.connect();
    if (!light) {
      session.post('Profiler.enable');
      session.post('Profiler.setSamplingInterval', { interval });
      session.post('Profiler.start');
    }
    reports = []; reads = []; combat = 0;
    eld = monitorEventLoopDelay({ resolution: 2 }); eld.enable();
    started = performance.now(); cpu0 = process.cpuUsage(); active = true;
  }
  function stop() {
    active = false;
    const wall = performance.now() - started, cpu = process.cpuUsage(cpu0);
    eld.disable();
    const s = session; session = null;
    const finish = (error, result) => {
      const base = path.join(dir, 'coordinator-' + process.pid);
      if (!error && result) fs.writeFileSync(base + '.cpuprofile', JSON.stringify(result.profile));
      const pct = q => eld.percentile(q) / 1e6;
      fs.writeFileSync(base + '.json', JSON.stringify({
        name: 'coordinator', role: 'coordinator', pid: process.pid, wallMs: wall,
        cpuUserMs: cpu.user / 1000, cpuSystemMs: cpu.system / 1000, cpuPercent: (cpu.user + cpu.system) / 10 / wall,
        eventLoopDelay: { p50: pct(50), p90: pct(90), p99: pct(99), max: eld.max / 1e6, mean: eld.mean / 1e6 },
        rss: process.memoryUsage().rss, combatReports: combat, reports, reads,
      }));
      s.disconnect();
    };
    if (light) finish(null, null); else s.post('Profiler.stop', finish);
  }
  process.on('SIGUSR2', () => { if (session) stop(); else start(); });
}
