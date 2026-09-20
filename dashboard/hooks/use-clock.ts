"use client";
import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
let current = 0;
let timer: ReturnType<typeof setInterval> | undefined;
function tick() {
  current = Date.now();
  listeners.forEach((listener) => listener());
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    tick();
    timer = setInterval(tick, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      clearInterval(timer);
      timer = undefined;
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
