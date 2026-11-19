"use strict";
// Bundled with the pinned ChronAL VirtualClock, without replacing browser I/O.
const { VirtualClock } = require("chronal-clock");
const { stats: taskStats } = require("./browser-task-queue.cjs");
const { joinClock, clockPerformance } = require("./join-clock.cjs");
const { createNativeIo } = require('./native-io.cjs');
const config = globalThis.__e2eClockConfiguration;
if (config && config.rate > 1) {
  const NativeDate = Date;
  const nativeTimeout = setTimeout,
    nativePerformance = performance,
    nativeRandom = Math.random,
    NativeWebSocket = WebSocket;
  const nativeFrame = requestAnimationFrame,
    nativeCancelFrame = cancelAnimationFrame;
  let socket;
  const nativeIo=createNativeIo(active=>{
    if(socket?.readyState===1)socket.send(JSON.stringify({kind:'native-io',active}));
  },()=>nativePerformance.now());
  nativeIo.install(globalThis);
  let id = "browser-" + nativeRandom().toString(36).slice(2) + "-" + nativePerformance.now();
  const url = (route) => {
    const u = new URL(route, config.broker);
    u.searchParams.set("id", id);
    u.searchParams.set("token", config.token);
    u.searchParams.set("scope", config.scope);
    u.searchParams.set("label", location.href);
    u.searchParams.set("now", String(clock.now));
    return u;
  };
  const errors = [];
  // Replacement CODE runs synchronously before its first broker handshake. Use
  // the live same-origin game clock so startup IDs and deadlines are current.
  let start = config.epoch;
  try {
    const parentClock = globalThis.parent !== globalThis && globalThis.parent.__e2eChronalClock;
    if (parentClock && parentClock.backend === 'chronal-network' &&
        parentClock.broker === config.broker && parentClock.epoch === config.epoch &&
        parentClock.rate === config.rate && parentClock.token === config.token) {
      const now = parentClock.now();
      if (Number.isSafeInteger(now) && now >= start) start = now;
    }
  } catch (_) { /* Cross-origin frames join through the authenticated broker. */ }
  const clock = new VirtualClock({
    start,
    seed: 1,
    onError(error) {
      errors.push(String(error.stack || error));
      console.error("[ChronAL browser clock]", error);
    },
  });
  clock.installInto(globalThis, { profile: "browser", vmContext: globalThis });
  Math.random = nativeRandom;
  // A long window names its timers (13.4d item 4: one CODE frame spent 70 s of wall time in its
  // own timers in one window, and the reading did not say which). Each timer callback is timed
  // against the wall clock and counted per window by its callback. A long window names its slowest
  // callbacks, and only their next registrations capture a stack, so an ordinary window pays no
  // capture and the next long window gives the reader the file and line, which owner:check's map
  // names the owner of.
  const LONG_WINDOW_MS = 10000;
  let windowTimers = new Map();
  const longCallbacks = new WeakSet();
  const timed = (kind, callback) => {
    if (typeof callback !== "function") return callback;
    const site = longCallbacks.has(callback) ? new Error() : null;
    return function () {
      const started = nativePerformance.now();
      try { return callback.apply(this, arguments); }
      finally {
        const entry = windowTimers.get(callback) || { kind, callback, site, count: 0, ms: 0 };
        entry.count++; entry.ms += nativePerformance.now() - started; windowTimers.set(callback, entry);
      }
    };
  };
  for (const kind of ["setTimeout", "setInterval"]) {
    const installed = globalThis[kind];
    globalThis[kind] = function (callback, ...rest) { return installed.call(this, timed(kind, callback), ...rest); };
  }
  // Keep actual browser rendering and Playwright observation on their native
  // cadence. Game and CODE Date/timers share the accelerated gameplay epoch.
  Object.defineProperty(globalThis, "performance", { value: clockPerformance(nativePerformance, clock, config), configurable: true });
  globalThis.requestAnimationFrame = callback => {
    if(typeof callback!=='function')throw new TypeError('Animation callback must be a function');
    return nativeFrame.call(globalThis,()=>callback.call(globalThis,clock.now-config.epoch));
  };
  globalThis.cancelAnimationFrame = nativeCancelFrame;
  let first = true;
  const state = { phase: "initial", ticks: 0, connectionAttempts: 0, connections: [] };
  // The reading names its own long-window threshold beside the windows it records.
  const timing = { windows: 0, events: 0, wallMs: 0, maxWindowMs: 0, longWindowMs: LONG_WINDOW_MS, long: [] };
  const join = {};
  let resolveReady, rejectReady;
  const ready = new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
  ready.catch(()=>{});
  function failedConnection(record,error) {
    record.error=String(error);record.phase='failed';
    if(state.connectionAttempts<3)nativeTimeout(connect,50*state.connectionAttempts);
    else {errors.push('ChronAL clock connection failed: '+record.error);rejectReady(Error(errors.at(-1)));}
  }
  async function connect() {
    state.connectionAttempts++;
    if(state.connectionAttempts>1)id='browser-'+nativeRandom().toString(36).slice(2)+'-'+nativePerformance.now();
    const record={attempt:state.connectionAttempts,at:NativeDate.now(),url:location.href,phase:'connecting'};
    state.connections.push(record);state.phase='connecting';
    try {
      if (typeof globalThis.__e2eChronalFrame === "function")
        await globalThis.__e2eChronalFrame(id);
      const advance = async(next,receivedWall) => {
        state.phase = "advance";
        const started = nativePerformance.now(), events = clock.events, from = clock.now;
        windowTimers = new Map();
        if(first){Object.assign(join,joinClock(clock,next.now));first=false;}
        else await clock.run({until:next.now});
        const elapsed=nativePerformance.now()-started;
        if(elapsed>=LONG_WINDOW_MS){
          let name=null;try{name=globalThis.character?.name??globalThis.parent?.character?.name??null;}catch(_){/* a cross-origin parent names no character */}
          const slowest=[...windowTimers.values()].sort((a,b)=>b.ms-a.ms).slice(0,5);
          for(const t of slowest)longCallbacks.add(t.callback);
          timing.long.push({at:clock.now,virtualMs:clock.now-from,wallMs:Math.round(elapsed),events:clock.events-events,label:location.pathname,name,
            timers:slowest.map(t=>({kind:t.kind,count:t.count,ms:Math.round(t.ms),name:t.callback.name||null,
              source:String(t.callback).slice(0,200),site:t.site&&String(t.site.stack||'').split(String.fromCharCode(10)).slice(3,9).map(l=>l.trim())}))});
          if(timing.long.length>10)timing.long.shift();
        }
        windowTimers = new Map();
        timing.windows++;timing.events+=clock.events-events;
        timing.wallMs+=elapsed;timing.maxWindowMs=Math.max(timing.maxWindowMs,elapsed);
        state.ticks++;state.phase="idle";
        resolveReady();
        return {now:clock.now,receivedWall,completedWall:NativeDate.now(),workMs:elapsed};
      };
      const endpoint=url('/clock');endpoint.protocol=endpoint.protocol==='https:'?'wss:':'ws:';
      socket=new NativeWebSocket(endpoint);
      let opened=false;
      socket.onopen=()=>{opened=true;record.phase='open';record.openedAt=NativeDate.now();socket.send(JSON.stringify({kind:'native-io',active:nativeIo.stats.active}));};
      let queue=Promise.resolve();
      socket.onmessage=event=>{
        const receivedWall=NativeDate.now();
        queue=queue.then(async()=>{
          const receipt=await advance(JSON.parse(event.data),receivedWall);
          if(socket.readyState===1)socket.send(JSON.stringify(receipt));
        }).catch(error=>{errors.push(String(error.stack||error));console.error('[ChronAL clock]',error);});
      };
      socket.onerror = () => {
        record.error='WebSocket handshake/transport failed';
        if(opened)errors.push('ChronAL clock connection failed after opening');
      };
      socket.onclose = () => {
        state.phase = "closed";
        if(!opened)failedConnection(record,record.error||'WebSocket closed before opening');
      };
    } catch (error) {
      failedConnection(record,error.stack||error);
      console.error("[ChronAL clock broker]", error);
    }
  }
  nativeTimeout(connect, 0);
  globalThis.__e2eChronalClock = {
    backend: "chronal-network",
    ...config,
    errors,
    state,
    timing,
    taskStats,
    join,
    ready,
    nativeIo:nativeIo.stats,
    now: () => Math.floor(clock.now),
    cpuNow: () => nativePerformance.now(),
    nativeTimeOrigin: nativePerformance.timeOrigin,
  };
}
