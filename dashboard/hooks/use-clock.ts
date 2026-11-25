"use client";
import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
let current = 0;
let timer: ReturnType<typeof setInterval> | undefined;
function tick() {
  current = Date.now();
  listeners.forEach((listener) => listener());
}
function start() {
  tick();
  if (!document.hidden && !timer) {
    timer = setInterval(tick, 1000);
  }
}
function stop() {
  clearInterval(timer);
  timer = undefined;
}
// A hidden page draws nothing, so the clock stops there and reads the time again when the page
// shows.
function visibility() {
  if (document.hidden) stop();
  else start();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    document.addEventListener("visibilitychange", visibility);
    start();
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      document.removeEventListener("visibilitychange", visibility);
      stop();
    }
  };
}
/** A shared, hydration-safe clock for expiry/connection displays. */
export function useClock() {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => 0,
  );
}
