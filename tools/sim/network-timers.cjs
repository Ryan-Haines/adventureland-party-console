"use strict";
// Node transports import `timers` directly and rely on refresh(); ChronAL's
// default handles deliberately implement only the narrower standalone host API.
const native = require("node:timers");
const nativeClear = native.clearTimeout;
const registries = new WeakMap();

function createNodeTimers(clock) {
  const owned = new WeakMap(),
    ids = new Map();
  function clear(value) {
    const record = value && typeof value === "object" ? owned.get(value) : ids.get(value);
    if (!record) return nativeClear(value);
    record.cleared = true;
    clock.cancel(record.id);
    ids.delete(record.id);
  }
  function create(fn, delay, args, repeat) {
    if (typeof fn !== "function") throw new TypeError("Timer callback must be a function");
    const record = { id: 0, cleared: false, ref: true };
    const handle = {
      get id() {
        return record.id;
      },
      refresh() {
        if (!record.cleared) schedule();
        return handle;
      },
      ref() {
        record.ref = true;
        return handle;
      },
      unref() {
        record.ref = false;
        return handle;
      },
      hasRef() {
        return record.ref;
      },
      close() {
        clear(handle);
        return handle;
      },
      [Symbol.toPrimitive]() {
        return record.id;
      },
      [Symbol.dispose]() {
        clear(handle);
      },
    };
    owned.set(handle, record);
    function schedule() {
      clock.cancel(record.id);
      ids.delete(record.id);
      record.id = clock.timer(
        () => {
          if (!repeat) ids.delete(record.id);
          fn.apply(handle, args);
        },
        delay,
        [],
        repeat,
        "node",
      );
      ids.set(record.id, record);
    }
    schedule();
    return handle;
  }
  const timers = {
    setTimeout: (fn, delay, ...args) => create(fn, delay, args, false),
    setInterval: (fn, delay, ...args) => create(fn, delay, args, true),
    clearTimeout: clear,
    clearInterval: clear,
  };
  return timers;
}
function installNodeTimers(clock, target, moduleExports = false) {
  if (!registries.has(clock)) registries.set(clock, createNodeTimers(clock));
  const timers = registries.get(clock);
  Object.assign(target, timers);
  if (moduleExports) Object.assign(native, timers);
}

function installWindowTimers(clock, target) {
  const owned = new Set();
  const close = target.close;
  function clear(value) {
    owned.delete(value);
    clock.cancel(value);
  }
  function create(fn, delay, args, repeat) {
    const callback = typeof fn === "function" ? fn : () => target.eval(String(fn));
    const id = clock.timer(
      () => {
        if (!repeat) owned.delete(id);
        callback.apply(target, args);
      },
      delay,
      [],
      repeat,
      "browser",
    );
    owned.add(id);
    return id;
  }
  target.setTimeout = (fn, delay, ...args) => create(fn, delay, args, false);
  target.setInterval = (fn, delay, ...args) => create(fn, delay, args, true);
  target.clearTimeout = target.clearInterval = clear;
  const requestFrame = target.requestAnimationFrame;
  target.requestAnimationFrame = (callback) => {
    const id = requestFrame((time) => {
      owned.delete(id);
      callback(time);
    });
    owned.add(id);
    return id;
  };
  target.cancelAnimationFrame = clear;
  target.close = () => {
    for (const id of owned) clock.cancel(id);
    owned.clear();
    return close.call(target);
  };
}
module.exports = { createNodeTimers, installNodeTimers, installWindowTimers };
