import { appendActivity, appendMerchantActivity, type ActivityEntry } from "./activity.ts";

interface ActivityState {
  merchantActivity: ActivityEntry[];
  anniversary: { activity: ActivityEntry[] };
}
interface ActivityPorts {
  now: () => number;
  persistHistory: () => void;
}

/** Log into the current collections; suppressed merchant notices must not trigger history writes. */
export function createCoordinatorActivity(state: ActivityState, ports: ActivityPorts) {
  function merchant(message: string, level: unknown = "info", details?: unknown): void {
    if (appendMerchantActivity(state.merchantActivity, message, level, details, ports.now))
      ports.persistHistory();
  }
  function anniversary(message: string, level: unknown = "info", details?: unknown): void {
    appendActivity(state.anniversary.activity, message, level, details, ports.now);
  }
  return { merchant, anniversary };
}
