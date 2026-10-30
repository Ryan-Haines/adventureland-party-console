"use strict";
// ChronAL clock for the real-network E2E stack. Native I/O is retained; the
// shared acknowledgement barrier bounds sockets, storage and rendering.
const path = require("node:path");
const vm = require("node:vm");
const realDate = Date,
  realPerformance = performance;
const realTimeout = setTimeout;
const realImmediate = setImmediate;
const realClearImmediate = clearImmediate;
const http = require("node:http");
const { randomUUID } = require("node:crypto");
const { joinClock } = require("./join-clock.cjs");
const { createNativeIo } = require('./native-io.cjs');
const chronalDirectory = () =>
  process.env.E2E_CHRONAL_DIR || path.resolve(__dirname, "../../.build/sim/chronal");
const clockScope = () => process.env.E2E_CLOCK_SCOPE || "game";
function requireBroker() {
  const broker = process.env.E2E_CLOCK_BROKER;
  if (!broker) throw Error("ChronAL network clock requires its shared broker");
  return broker;
}
function socketUrl(broker, id, scope) {
  const url = new URL("/clock", broker);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("token", process.env.E2E_CLOCK_TOKEN || "");
  url.searchParams.set("id", id);
  url.searchParams.set("scope", scope);
  url.searchParams.set("label", `${process.argv[1]}:thread-${require("node:worker_threads").threadId}`);
  return url;
}
function clockPerformance(clock, config, dateOnly) {
  if (dateOnly) return realPerformance;
  return new Proxy(realPerformance, {
    get(target, key) {
      if (key === "now") return () => clock.now - config.epoch;
      if (key === "timeOrigin") return config.epoch;
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function configuration(env = process.env) {
  const rate = Number(env.E2E_CLOCK_RATE || 1);
  const wall = Number(env.E2E_CLOCK_WALL_EPOCH);
  const epoch = Number(env.E2E_CLOCK_VIRTUAL_EPOCH);
  if (!Number.isFinite(rate) || rate < 1 || rate > 1024) throw Error("Invalid E2E clock rate");
  if (rate > 1 && (!Number.isSafeInteger(wall) || !Number.isSafeInteger(epoch)))
    throw Error("Accelerated E2E requires a shared clock epoch");
  return { rate, wall, epoch };
}

function install({ dateOnly = false } = {}) {
  const config = configuration();
  if (config.rate === 1) return { backend: "native", rate: 1, now: () => realDate.now() };
  if (globalThis.__e2eChronalClock) return globalThis.__e2eChronalClock;
  const directory = chronalDirectory();
  const { VirtualClock } = require(path.join(directory, "sim/vclock.js"));
  const broker = requireBroker();
  const id = `node-${process.pid}-${require("node:worker_threads").threadId}-${randomUUID()}`;
  const scope = clockScope();
  const request = (route, observed) =>
    new Promise((resolve, reject) => {
      const url = new URL(route, broker);
      url.searchParams.set("id", id);
      url.searchParams.set("scope", scope);
      url.searchParams.set("token", process.env.E2E_CLOCK_TOKEN || "");
      url.searchParams.set("now", String(observed));
      const req = http.get(url, (res) => {
        let body = "";
        res.on("data", (data) => (body += data));
        res.on("end", () => {
          try {
            if (res.statusCode !== 200) throw Error("Clock broker " + res.statusCode);
            resolve(JSON.parse(body));
          } catch (error) {
            reject(error);
          }
        });
      });
      req.on("error", reject);
      const timeout = realTimeout(() => req.destroy(Error("ChronAL broker unavailable")), 5000);
      req.on("close", () => clearTimeoutNative(timeout));
    });
  const clearTimeoutNative = require("node:timers").clearTimeout;
  function nativeTurn(callback){
    let complete=false,immediate,timer;
    const run=()=>{
      if(complete)return;complete=true;
      if(immediate!==undefined)realClearImmediate(immediate);
      if(timer!==undefined)clearTimeoutNative(timer);
      callback();
    };
    // Both paths enter from a native macrotask. A busy check phase must not
    // indefinitely retain a completed window's acknowledgement.
    immediate=realImmediate(run);timer=realTimeout(run,0);
  }
  const errors = [];
  const clock = new VirtualClock({
    start: config.epoch,
    seed: 1,
    onError(error) {
      errors.push(String(error.stack || error));
      console.error("[ChronAL network clock]", error);
      process.exitCode = 1;
    },
  });
  const originals = Object.fromEntries(
    ["Date", "setTimeout", "setInterval", "clearTimeout", "clearInterval", "performance"].map(
      (key) => [key, globalThis[key]],
    ),
  );
  // A private realm supplies constructors; leave the test runner's monotonic
  // performance clock and the application's native random stream intact.
  clock.installInto(globalThis, {
    vmContext: vm.createContext({ Date: realDate, Math: Object.create(Math) }),
  });
  globalThis.performance = clockPerformance(clock, config, dateOnly);
  const { createNodeTimers, installNodeTimers, installWindowTimers } = require("./network-timers.cjs");
  const timers = createNodeTimers(clock);
  if (dateOnly) {
    for (const key of ["setTimeout", "setInterval", "clearTimeout", "clearInterval"])
      globalThis[key] = originals[key];
  } else {
    installNodeTimers(clock, globalThis, true);
    // ChronAL's promise hooks must observe queued work before another timer.
    globalThis.queueMicrotask = (callback) => Promise.resolve().then(callback).catch(clock.onError);
  }
  let stopped = false,
    first = true;
  const observations = { requests: 0, consecutiveFailures: 0, retries: [] };
  const join = {};
  const transport = { phase: dateOnly ? 'observe' : 'connecting', window: null, completed: 0, startedWall: 0 };
  let notifyNativeIo=()=>{};
  const nativeIo=createNativeIo(()=>notifyNativeIo(),()=>realPerformance.now());
  let readyResolve, readyReject;
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  async function pump() {
    if (stopped) return;
    try {
      observations.requests++;
      const next = await request("/observe", clock.now);
      await clock.run({ until: next.now });
      if (observations.consecutiveFailures)
        for (const retry of observations.retries.slice(-observations.consecutiveFailures)) retry.recoveredAt = realDate.now();
      observations.consecutiveFailures = 0;
      readyResolve();
      if (!stopped) {
        realTimeout(pump, 10).unref();
      }
    } catch (error) {
      const transient = ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT"].includes(error.code) ||
        error.message === "ChronAL broker unavailable";
      if (transient && ++observations.consecutiveFailures < 3) {
        observations.retries.push({ at: realDate.now(), error: String(error), attempt: observations.consecutiveFailures });
        if (observations.retries.length > 64) observations.retries.shift();
        realTimeout(pump, 50 * observations.consecutiveFailures).unref();
        return;
      }
      errors.push(String(error.stack || error));
      readyReject(error);
      console.error("[ChronAL broker]", error);
      process.exitCode = 1;
    }
  }
  if (dateOnly) void pump();
  else {
    const WebSocket = require(
      require.resolve("ws", {
        paths: [process.cwd(), directory, path.resolve(__dirname, "../../.caracal")],
      }),
    );
    const socket = new WebSocket(socketUrl(broker, id, scope));
    notifyNativeIo=()=>{if(socket.readyState===1)socket.send(JSON.stringify({kind:'native-io',active:nativeIo.stats.active}));};
    socket.on('open',notifyNativeIo);
    const windows=[];
    let advancing=false;
    const failed=error=>{
      errors.push(String(error.stack||error));readyReject(error);
      console.error('[ChronAL clock]',error);
    };
    function advance(){
      if(advancing||!windows.length)return;
      advancing=true;
      // runSync drains native Promise microtasks without a macrotask per timer.
      // It must start outside a Promise continuation.
      nativeTurn(()=>{
        try{
          const next=windows.shift();
          transport.phase='advancing';transport.window=next.now;transport.startedWall=realDate.now();
          if(first){Object.assign(join,joinClock(clock,next.now));first=false;}
          else{
            clock.runSync({before:next.now});
            // Pinned ChronAL's public sync window excludes its end. Complete
            // the existing inclusive network boundary without a clock rewind.
            if(typeof clock.events_!=='function')throw Error('Pinned ChronAL inclusive window adapter is unavailable');
            while(clock.events_({},next.now,false,true))process._tickCallback();
          }
          // Retain a native I/O turn for socket and persistence completions.
          transport.phase='native-io';
          nativeTurn(()=>{
            readyResolve();
            if(socket.readyState===1)socket.send(JSON.stringify({now:clock.now}));
            transport.completed++;transport.phase='idle';transport.window=null;
            advancing=false;advance();
          });
        }catch(error){advancing=false;failed(error);}
      });
    }
    socket.on('message',bytes=>{
      try{windows.push(JSON.parse(bytes.toString()));advance();}
      catch(error){failed(error);}
    });
    socket.on("error", (error) => {
      errors.push(String(error.stack || error));
      readyReject(error);
      console.error("[ChronAL clock]", error);
    });
    socket.on("close", () => {
      if (!stopped) {
        const error = Error("ChronAL clock connection closed");
        errors.push(String(error));
        readyReject(error);
        process.exitCode = 1;
      }
    });
    let warnings=0,lastObserved=clock.now,lastProgressWall=realDate.now();
    const inspect=()=>{
      if(stopped)return;
      if(clock.now!==lastObserved){lastObserved=clock.now;lastProgressWall=realDate.now();}
      if((transport.window!==null&&realDate.now()-transport.startedWall>=5000||realDate.now()-lastProgressWall>=5000)&&warnings++<3)
        console.error('[ChronAL pending acknowledgement]',JSON.stringify({at:realDate.now(),id,scope,now:clock.now,events:clock.events,pending:windows.length,socketState:socket.readyState,transport}));
      realTimeout(inspect,5000).unref();
    };
    realTimeout(inspect,5000).unref();
  }
  if (!dateOnly) {
    const exit = process.exit.bind(process);
    process.exit = (code) => {
      if (stopped) return exit(code);
      stopped = true;
      const fallback = realTimeout(() => exit(code), 500);
      void request("/leave", clock.now).finally(() => {
        clearTimeoutNative(fallback);
        exit(code);
      });
    };
    const createContext = vm.createContext;
    vm.createContext = function (context, ...args) {
      const ctx = createContext.call(vm, context, ...args);
      const random = vm.runInContext("Math.random", ctx);
      clock.installInto(ctx, { profile: context?.document ? "browser" : "node" });
      if (context?.document) installWindowTimers(clock, ctx);
      else installNodeTimers(clock, ctx);
      nativeIo.install(ctx);
      vm.runInContext("Math", ctx).random = random;
      ctx.__e2eChronalClock = globalThis.__e2eChronalClock;
      return ctx;
    };
  }
  const receipt = {
    backend: "chronal-network",
    ...config,
    dateOnly,
    windowMode:dateOnly?"observe":"node-sync-inclusive",
    errors,
    observations,
    join,
    transport,
    nativeIo:nativeIo.stats,
    timers,
    ready,
    now: () => Math.floor(clock.now),
    cpuNow: () => realPerformance.now(),
    nativeTimeOrigin: realPerformance.timeOrigin,
  };
  globalThis.__e2eChronalClock = receipt;
  return receipt;
}
module.exports = { configuration, install };
if (process.env.E2E_CLOCK_PRELOAD === "1") install();
