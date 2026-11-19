'use client';
// Each character has one live map. The card's location row and the pinned name strip
// (card-name-strip.tsx) share its open and large state, and the map body renders in the strip's dock
// while the strip shows, in the card otherwise (with "Pin top bar" off no strip mounts). One copy
// keeps the columns' rows aligned and avoids a second map stream. Each flag is a session preference
// (session-state.ts) under map-open:<name> and map-large:<name>, read once and kept here so every
// copy sees one value.
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { readSession, writeSession } from './session-state';

const strips = new Map<string, boolean>();
const flags = new Map<string, boolean>();
const listeners = new Set<() => void>();
const notify = () => { for (const listener of listeners) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

function readFlag(key: string): boolean {
  if (!flags.has(key)) flags.set(key, readSession<boolean>(key) === true);
  return flags.get(key)!;
}
function useFlag(key: string) {
  const value = useSyncExternalStore(subscribe, () => readFlag(key), () => false);
  const set = useCallback((next: boolean | ((value: boolean) => boolean)) => {
    const resolved = typeof next === 'function' ? next(readFlag(key)) : next;
    flags.set(key, resolved);
    writeSession(key, resolved);
    notify();
  }, [key]);
  return [value, set] as const;
}

/**
 * CardNameStrip reports whether its strip shows for `name`. Its unmount, when "Pin top bar" turns
 * off, reports it hidden, so the map moves back into the card.
 */
export function useReportStrip(name: string, shown: boolean): void {
  useEffect(() => {
    if (strips.get(name) !== shown) { strips.set(name, shown); notify(); }
    return () => { if (strips.get(name)) { strips.set(name, false); notify(); } };
  }, [name, shown]);
}

/** True while the pinned strip for `name` shows, so the map belongs in its dock. */
export function useStripShown(name: string): boolean {
  return useSyncExternalStore(subscribe, () => strips.get(name) === true, () => false);
}

/** The shared open state of `name`'s map, kept in sessionStorage. */
export function useMapOpen(name: string): readonly [boolean, (next: boolean | ((value: boolean) => boolean)) => void] {
  return useFlag('map-open:' + name);
}
/** The shared large state of `name`'s map: the map keeps its size as it moves between the card
 * and the strip. */
export function useMapLarge(name: string): readonly [boolean, (next: boolean | ((value: boolean) => boolean)) => void] {
  return useFlag('map-large:' + name);
}
