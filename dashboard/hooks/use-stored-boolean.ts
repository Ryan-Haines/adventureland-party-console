"use client";
import { useCallback, useRef, useSyncExternalStore, type SetStateAction } from "react";

const changed = "party-preference-changed";
function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener(changed, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(changed, listener);
  };
}
export function useStoredBoolean(key: string, fallback: boolean) {
  const read = useCallback(() => {
    try {
      const value = localStorage.getItem(key);
      return value === null ? fallback : value !== "false";
    } catch {
      return fallback;
    }
  }, [key, fallback]);
  const value = useSyncExternalStore(subscribe, read, () => fallback);
  const set = (next: SetStateAction<boolean>) =>
    write(key, String(typeof next === "function" ? next(read()) : next));
  return [value, set] as const;
}
// The JSON form of useStoredBoolean: the saved value, or `fallback` when the browser holds none or
// its text does not parse. It parses each saved text once, so a render gets the same object until
// the text changes.
export function useStoredJson<T>(key: string, fallback: T) {
  const parsed = useRef<{ key: string; text: string | null; value: T } | null>(null);
  const read = useCallback((): T => {
    let text: string | null;
    try {
      text = localStorage.getItem(key);
    } catch {
      return fallback;
    }
    if (parsed.current?.key === key && parsed.current.text === text) return parsed.current.value;
    const value = text === null ? fallback : parse(text, fallback);
    parsed.current = { key, text, value };
    return value;
  }, [key, fallback]);
  const value = useSyncExternalStore(subscribe, read, () => fallback);
  const set = (next: T) => write(key, JSON.stringify(next));
  return [value, set] as const;
}
function parse<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}
// A blocked storage keeps the shown value: the write is skipped and no listener hears a change.
function write(key: string, text: string) {
  try {
    localStorage.setItem(key, text);
  } catch {
    return;
  }
  window.dispatchEvent(new Event(changed));
}
