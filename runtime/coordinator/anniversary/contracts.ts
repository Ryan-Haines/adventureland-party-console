import type { InventoryEntry } from "../contracts/item.ts";
import type { ReturnRoute, Waypoints } from "../events/return-types.ts";
import type { SliceTrade } from "./trades.ts";
import type { ActivityEntry } from "../telemetry/activity.ts";

export const anniversarySlices = [
  "slice_strawberry",
  "slice_citrus",
  "slice_honey",
  "slice_mint",
  "slice_blueberry",
  "slice_nightberry",
];
export const anniversaryLabels: Readonly<Record<string, string>> = {
  slice_strawberry: "Strawberry",
  slice_citrus: "Citrus",
  slice_honey: "Honey",
  slice_mint: "Mint",
  slice_blueberry: "Blueberry",
  slice_nightberry: "Nightberry",
};

export interface AnniversarySchedule {
  active?: boolean;
  live?: boolean;
  id?: string;
  round?: string | number;
  target?: string | null;
  expires?: number;
  next?: number;
}
export interface AnniversaryStatus {
  seenAt: number;
  ctype?: string;
  rip?: boolean;
  server?: string;
  map?: string;
  x?: number;
  y?: number;
  joinedEvent?: string;
  eventFeedAt?: number;
  anniversaryServer?: AnniversarySchedule;
  items?: (InventoryEntry | null)[];
}
export interface AnniversaryRound {
  claims?: Record<
    string,
    | {
        at?: number;
        slice?: string | null;
        handedOff?: boolean;
        handedOffAt?: number;
        recovered?: boolean;
      }
    | undefined
  >;
  target?: string | null;
}
export interface AnniversaryCycle {
  id: string;
  abortedAt?: number;
  returnDispatchedAt?: number | null;
  liveRound?: string;
  target?: string | null;
  endsAt: number;
  updatedAt?: number;
  selectionLoggedRound?: string;
  startsAt?: number;
  supersededAt?: number;
  returnCompletedAt?: number;
  combatHandoffAt?: number;
  combatEvent?: string;
  combatHandoffCharacter?: string;
  combatPendingEvent?: string;
  kissOperations?: Record<string, { id: string; expiresAt: number }>;
  participants?: string[];
  waypoints?: Waypoints;
  returnRoutes?: Record<string, ReturnRoute>;
  returnReason?: string;
  abortReason?: string;
  destination?: import("../events/return-types.ts").ReturnLocation | null;
  stagedAt?: number;
}
export interface AnniversaryState {
  nativeSlice: string | null;
  eventCycle?: AnniversaryCycle | null;
  abortedRounds: Record<string, unknown>;
  partyHold?: { target: string | null | undefined; round: string; expires: number | null } | null;
  rounds: Record<string, AnniversaryRound | undefined>;
  attempts: Record<string, Record<string, number>>;
  returnDestination?: import("../events/return-types.ts").ReturnLocation | null;
  returnReady?: Record<string, unknown>;
  chatAdvertisement?: { id: string; message: string; queuedAt: number } | null;
  activity: ActivityEntry[];
  crafted: number;
  advertisedRounds: Record<string, unknown>;
  pendingReturns: Record<string, unknown>;
  reciprocal: Record<string, SliceTrade | undefined>;
}
export interface AnniversarySnapshotPorts {
  now(): number;
  counts(): Record<string, number>;
  statuses(): Readonly<Record<string, AnniversaryStatus | undefined>>;
  leader(): string | null;
  merchant(): string | null;
  follower(name: string): boolean;
  enabled(name: string): boolean;
  owned(name: string): boolean;
  realm(name: string): string | undefined;
  log(message: string, level: string): void;
  persist(): void;
}

export function sliceQuantity(
  entries: (InventoryEntry | null)[] | undefined,
  name: string,
): number {
  return (entries || []).reduce(
    (total, entry) =>
      total + (entry?.item?.name === name ? Math.max(1, Number(entry.item.q) || 1) : 0),
    0,
  );
}
