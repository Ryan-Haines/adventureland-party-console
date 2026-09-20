"use client";
import { Suspense, useState, type ReactNode } from "react";

/** Fetch a large panel on first use, then retain its draft state when closed. */
export function DeferredPanel({ active, children }: { active: boolean; children: ReactNode }) {
  const [activated, setActivated] = useState(active);
  if (active && !activated) setActivated(true);
  if (!active && !activated) return null;
  return (
    <Suspense
      fallback={
        <output className="block rounded border border-emerald-800 bg-[#0b1916] p-4 text-emerald-100">
          Loading panel…
        </output>
      }
    >
      {children}
    </Suspense>
  );
}
