'use client';
import { useCallback, useEffect, useSyncExternalStore } from 'react';

// Each character has one live map. The card's location row and the pinned
// name strip (card-name-strip.tsx) share its open state, and the map body
// renders in the strip's dock while the strip shows, in the card otherwise.
// One copy keeps the columns' rows aligned and avoids a second map stream.
const strips = new Map<string, boolean>();
const opened = new Map<string, boolean>();
const listeners = new Set<() => void>();
const notify = () => { for (const listener of listeners) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const storageKey = (name: string) => 'party-ui:map-open:' + name;

function readOpen(name: string): boolean {
  if (!opened.has(name)) {
    let value = false;
    try { value = JSON.parse(sessionStorage.getItem(storageKey(name)) || 'false') === true; } catch { /* storage blocked */ }
    opened.set(name, value);
  }
  return opened.get(name)!;
}

/** CardNameStrip reports whether its strip shows for `name`. */
export function useReportStrip(name: string, shown: boolean): void {
  useEffect(() => {
    if (strips.get(name) === shown) return;
    strips.set(name, shown);
    notify();
  }, [name, shown]);
}

/** True while the pinned strip for `name` shows, so the map belongs in its dock. */
export function useStripShown(name: string): boolean {
  return useSyncExternalStore(subscribe, () => strips.get(name) === true, () => false);
}

/** The shared open state of `name`'s map, kept in sessionStorage. */
export function useMapOpen(name: string): readonly [boolean, (next: boolean | ((value: boolean) => boolean)) => void] {
  const open = useSyncExternalStore(subscribe, () => readOpen(name), () => false);
  const setOpen = useCallback((next: boolean | ((value: boolean) => boolean)) => {
    const value = typeof next === 'function' ? next(readOpen(name)) : next;
    opened.set(name, value);
    try { sessionStorage.setItem(storageKey(name), JSON.stringify(value)); } catch { /* storage blocked */ }
    notify();
  }, [name]);
  return [open, setOpen] as const;
}
