"use strict";
// A native task boundary drains the complete browser microtask checkpoint.
// A Promise-only yield cannot provide that ordering for arbitrary promise chains.
const nativePerformance = performance;
let host = globalThis;
try { if (globalThis.top?.scheduler) host = globalThis.top; } catch {}
// The queue the tasks take: the browser's scheduler, or the MessageChannel when it has none.
const stats = { mode: host.scheduler?.postTask ? "scheduler" : "channel", count: 0, waitMs: 0, maxWaitMs: 0 };
// The first channel task opens the channel. A listening port holds Node's event loop open, so a
// loader that only reads `stats`, as browser-clock.cjs does under node --test, opens none.
let channel = null;
const queue = [];
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
  if (!channel) {
    channel = new host.MessageChannel();
    channel.port1.onmessage = () => queue.shift()?.();
  }
  queue.push(run);
  channel.port2.postMessage(0);
}
module.exports = { postTask, stats };
