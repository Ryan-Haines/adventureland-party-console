"use strict";
// A native task boundary drains the complete browser microtask checkpoint.
// A Promise-only yield cannot provide that ordering for arbitrary promise chains.
const nativePerformance = performance;
let host = globalThis;
try { if (globalThis.top?.scheduler) host = globalThis.top; } catch {}
const mode = "scheduler";
const stats = { mode, count: 0, waitMs: 0, maxWaitMs: 0 };
const channel = new host.MessageChannel(), queue = [];
channel.port1.onmessage = () => queue.shift()?.();
function postTask(callback) {
  const started = nativePerformance.now();
  const run = () => {
    const elapsed = nativePerformance.now() - started;
    stats.count++;
    stats.waitMs += elapsed;
    stats.maxWaitMs = Math.max(stats.maxWaitMs, elapsed);
    callback();
  };
  if (host.scheduler?.postTask)
    return host.scheduler.postTask(run, { priority: "user-blocking" });
  queue.push(run);
  channel.port2.postMessage(0);
}
module.exports = { postTask, stats };
