"use client";
import type { ReactNode } from "react";
import { useSettingsReady } from "./settings-write";

// The settings controls inside stay locked, showing loading, until the console's settings
// arrive (settings-write.ts).
export function SettingsLock({ children }: { children: ReactNode }) {
  const ready = useSettingsReady();
  return <fieldset disabled={!ready} aria-busy={!ready} className="contents">{children}</fieldset>;
}
