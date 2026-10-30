"use strict";

/** Anchor startup timers once, before this actor executes any virtual callback.
 * The pinned ChronAL heap is also used by the inclusive-window adapter. Fail
 * closed if its representation changes; never discard or replay startup work. */
function joinClock(clock, at) {
  const from = clock.now, entries = clock.heap?.a;
  if (!Number.isSafeInteger(at) || at < from || clock.events !== 0 || !Array.isArray(entries))
    throw Error("Pinned ChronAL startup clock adapter is unavailable");
  const timers = [...new Set(entries)];
  if (timers.some(timer => !Number.isFinite(timer.at) || !Number.isFinite(timer.due)))
    throw Error("Invalid ChronAL startup timer");
  const offset = at - from;
  for (const timer of timers) {
    timer.at += offset;
    if (timer.due) timer.due += offset;
  }
  clock.now = at;
  return { from, at, offset, rebasedTimers: timers.filter(timer => !timer.cancelled).length };
}
module.exports = { joinClock };
