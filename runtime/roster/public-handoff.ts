import type { Handoff } from "./handoff.ts";

/** Compatibility flag for older dashboards, derived from the actual outcome. */
export function publicHandoff(operation: Handoff | null) {
  if (!operation) return null;
  return {
    ...operation,
    timedOut: operation.phase === "failed" && !!operation.error?.includes("timed out"),
  };
}
