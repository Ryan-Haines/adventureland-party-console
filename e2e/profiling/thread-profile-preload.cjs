// Profiling preload for CharacterThread.js and live-coordinator.cjs, on the disposable
// game stack only. Load it with NODE_OPTIONS="--require <absolute path>" and PROF_DIR set;
// every other process ignores it. SIGUSR2 starts a window and the next SIGUSR2 writes
// <PROF_DIR>/<name>-<pid>.cpuprofile and <name>-<pid>.json. PROF_LIGHT=1 records only
// CPU time, event-loop delay, request counts and the reaction samples, with no profiler
// or timer wrappers.
const path = require('node:path');
const fs = require('node:fs');
const script = String(process.argv[1] || '');
const role = /CharacterThread\.js$/.test(script) ? 'thread' : /live-coordinator\.cjs$/.test(script) ? 'coordinator' : null;
if (role && process.env.PROF_DIR) {
  const inspector = require('node:inspector');
  const { performance, monitorEventLoopDelay } = require('node:perf_hooks');
  const vm = require('node:vm');
  const dir = process.env.PROF_DIR;
  const interval = Number(process.env.PROF_INTERVAL_US || 250);
  let name = role === 'coordinator' ? 'coordinator' : 'thread';
  process.on('message', m => { if (m && m.type === 'process_args' && m.arguments && m.arguments.cname) name = m.arguments.cname; });
  const timers = new Map(), events = new Map();
  // attacks: ms from the attack cooldown expiry to an attack or heal emit. The preload
  // keeps a sample only when the character sent no move since the cooldown expired, so
  // it measures how fast the loops react to a ready attack and not how long a walk took.
  const speed = { attacks: [], moves: 0, attacksTotal: 0, heals: 0, deathToAction: [], kills: 0 };
  let lastMoveAt = 0;
  let active = false;
  const rec = (map, key, ms) => { let r = map.get(key); if (!r) map.set(key, r = { calls: 0, ms: 0, max: 0 }); r.calls++; r.ms += ms; if (ms > r.max) r.max = ms; };
  const contexts = [];
  const light = process.env.PROF_LIGHT === '1';
  if (role === 'thread') {
    const original = vm.createContext;
    vm.createContext = function (object, ...rest) {
      const result = original.call(this, object, ...rest);
      try { if (!light) wrapTimers(object, contexts.length ? 'code' : 'game'); contexts.push(object); } catch (_) {}
      return result;
    };
  }
  // setInterval keys carry a source excerpt (registrations are rare); setTimeout keys
  // carry only the name, because fn.toString on every timeout costs more than the work.
  function label(fn, ms, kind) {
    if (kind === 'setTimeout') return ms + 'ms ' + (fn.name || '(anonymous)');
    const text = Function.prototype.toString.call(fn).replace(/\s+/g, ' ');
    return ms + 'ms ' + (fn.name ? fn.name + ' ' : '') + text.slice(0, 90);
  }
  function wrapTimers(win, tag) {
    for (const kind of ['setInterval', 'setTimeout']) {
      const native = win[kind];
      if (typeof native !== 'function') continue;
      win[kind] = function (fn, ms, ...args) {
        if (typeof fn !== 'function') return native.call(this, fn, ms, ...args);
        const key = tag + ' ' + kind + ' ' + label(fn, ms | 0, kind);
        return native.call(this, function (...a) {
          const t = performance.now();
          try { return fn.apply(this, a); } finally { if (active) rec(timers, key, performance.now() - t); }
        }, ms, ...args);
      };
    }
  }
  // Wrap the game socket once per socket object: per-event handler time and action reactions.
  const wrapped = new WeakSet();
  let lastTarget = null, deathAt = 0;
  function wrapSocket() {
    const game = contexts[0];
    const socket = game && game.socket;
    if (!socket || wrapped.has(socket)) return;
    wrapped.add(socket);
    const onevent = socket.onevent;
    if (typeof onevent === 'function') socket.onevent = function (packet) {
      const t = performance.now();
      const event = packet && packet.data && packet.data[0];
      if (active && event === 'death' && lastTarget && packet.data[1] && String(packet.data[1].id) === String(lastTarget)) { deathAt = performance.now(); speed.kills++; }
      try { return onevent.call(this, packet); } finally { if (active) rec(events, String(event), performance.now() - t); }
    };
    const emit = socket.emit;
    socket.emit = function (event, data, ...rest) {
      if (active) {
        if (event === 'attack' || event === 'heal') {
          const next = game.next_skill && game.next_skill.attack;
          const lag = next ? Date.now() - Number(next) : NaN;
          if (Number.isFinite(lag) && lag >= 0 && lag < 2000 && lastMoveAt < Number(next)) speed.attacks.push(lag);
          if (event === 'attack') speed.attacksTotal++; else speed.heals++;
          if (event === 'attack' && data && data.id) lastTarget = data.id;
        } else if (event === 'move') { speed.moves++; lastMoveAt = Date.now(); }
        if (deathAt && (event === 'attack' || event === 'move' || event === 'heal')) { speed.deathToAction.push(performance.now() - deathAt); deathAt = 0; }
      }
      return emit.call(this, event, data, ...rest);
    };
  }
  if (role === 'thread') setInterval(wrapSocket, 200).unref();
  // Outgoing HTTP requests per method and path; jsdom's XMLHttpRequest and the native
  // transport both end in http.request.
  const requests = new Map();
  if (role === 'thread') {
    const http = require('node:http');
    const request = http.request;
    http.request = function (...args) {
      if (active) {
        const first = args[0], options = args[1] && typeof args[1] === 'object' ? args[1] : {};
        const url = typeof first === 'string' || first instanceof URL ? new URL(String(first)) : null;
        const method = String(options.method || (first && first.method) || 'GET').toUpperCase();
        const pathname = url ? url.pathname : String((first && first.path) || '').split('?')[0];
        const key = method + ' ' + pathname;
        requests.set(key, (requests.get(key) || 0) + 1);
      }
      return request.apply(this, args);
    };
  }
  let session = null, started = 0, cpu0 = null, eld = null;
  function start() {
    session = new inspector.Session(); session.connect();
    if (!light) {
      session.post('Profiler.enable');
      session.post('Profiler.setSamplingInterval', { interval });
      session.post('Profiler.start');
    }
    timers.clear(); events.clear(); requests.clear();
    Object.assign(speed, { attacks: [], moves: 0, attacksTotal: 0, heals: 0, deathToAction: [], kills: 0 });
    eld = monitorEventLoopDelay({ resolution: 2 }); eld.enable();
    started = performance.now(); cpu0 = process.cpuUsage(); active = true;
  }
  function stop() {
    active = false;
    const wall = performance.now() - started, cpu = process.cpuUsage(cpu0);
    eld.disable();
    const s = session; session = null;
    const finish = (error, result) => {
      const base = path.join(dir, name + '-' + process.pid);
      if (!error && result) fs.writeFileSync(base + '.cpuprofile', JSON.stringify(result.profile));
      const pct = q => eld.percentile(q) / 1e6;
      const table = map => [...map].map(([key, r]) => ({ key, ...r })).sort((a, b) => b.ms - a.ms);
      fs.writeFileSync(base + '.json', JSON.stringify({
        name, role, pid: process.pid, wallMs: wall, cpuUserMs: cpu.user / 1000, cpuSystemMs: cpu.system / 1000,
        cpuPercent: (cpu.user + cpu.system) / 10 / wall,
        eventLoopDelay: { p50: pct(50), p90: pct(90), p99: pct(99), max: eld.max / 1e6, mean: eld.mean / 1e6 },
        timers: table(timers), events: table(events), speed, requests: Object.fromEntries(requests),
        rss: process.memoryUsage().rss,
      }, null, 1));
      s.disconnect();
    };
    if (light) finish(null, null); else s.post('Profiler.stop', finish);
  }
  process.on('SIGUSR2', () => { if (session) stop(); else start(); });
  // PROF_MEMORY=1: memory every 30 s for the life of the process (leak checks).
  if (process.env.PROF_MEMORY === '1') setInterval(() => {
    const m = process.memoryUsage();
    const line = JSON.stringify({ at: Date.now(), rss: m.rss, heapUsed: m.heapUsed, heapTotal: m.heapTotal, external: m.external, arrayBuffers: m.arrayBuffers });
    try { fs.appendFileSync(path.join(dir, name + '-' + process.pid + '.memory.jsonl'), line + '\n'); } catch (_) {}
  }, 30000).unref();
}
