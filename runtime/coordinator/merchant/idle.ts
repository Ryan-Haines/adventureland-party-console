import type { MerchantCommand, ServiceStatus } from "./work.ts";
import { gatheringCastActive } from "./gathering.ts";
import type { MerchantAnniversaryControl } from "./anniversary-control.ts";

interface IdleStatus extends ServiceStatus {
  gatheringActive?: boolean;
  gatheringCooldowns?: Record<string, number>;
  banking?: boolean;
  standOpen?: boolean;
}
interface StandListing {
  state?: string;
  tradeSlot?: string;
  [field: string]: unknown;
}
interface IdlePorts {
  eventReserved?(): boolean;
  storagePending(): boolean;
  merchant(): string | null;
  status(name: string | null): IdleStatus | undefined;
  anniversary(): MerchantAnniversaryControl;
  currentJob(): boolean;
  ensureHome(reason: string): boolean;
  forcedStand(): boolean;
  readyQueuedWork(): boolean;
  modes(): string[];
  cooldown(mode: string): number | undefined;
  now(): number;
  listings(): StandListing[];
  inventoryMerge(status: IdleStatus): unknown;
  command(name: string | null): MerchantCommand | undefined;
  issue(name: string, command: MerchantCommand): void;
  nextCommand(): number;
  realm(): string;
}

/** Returns to the stand only when no active work owns merchant movement. */
export function createMerchantIdle(ports: IdlePorts) {
  function gatheringReady(status: IdleStatus | undefined): boolean {
    return ports
      .modes()
      .some(
        (mode) =>
          Math.max(
            Number(ports.cooldown(mode)) || 0,
            Number(status?.gatheringCooldowns?.[mode]) || 0,
          ) <= ports.now(),
      );
  }

  function workOwnsMovement(
    anniversary: MerchantAnniversaryControl,
    status: IdleStatus | undefined,
  ): boolean {
    if (finishingCast(status, anniversary)) return true;
    if ([ports.currentJob(), anniversary.busy, anniversary.kissDue].some(Boolean)) return true;
    if (anniversary.reserved || anniversary.featured || ports.forcedStand()) return false;
    return ports.readyQueuedWork() || !!status?.gatheringActive || gatheringReady(status);
  }

  function atMarket(status: IdleStatus): boolean {
    return (
      status.map === "main" &&
      Math.hypot((Number(status.x) || 0) + 63, (Number(status.y) || 0) - 100) <= 35
    );
  }

  function needsCommand(status: IdleStatus, merge: unknown): boolean {
    const sync = ports.listings().some((listing) => listing.state !== "live" || !listing.tradeSlot);
    if (status.standOpen && atMarket(status) && !sync && !merge) return false;
    const current = ports.command(ports.merchant());
    return (
      current?.type !== "merchant-idle" ||
      JSON.stringify(current.listings) !== JSON.stringify(ports.listings())
    );
  }

  function homeReady(merchant: string | null, status: IdleStatus | undefined): boolean {
    return (
      !merchant ||
      !status ||
      ports.currentJob() ||
      ports.ensureHome("stand or anniversary attendance")
    );
  }

  function available(status: IdleStatus | undefined): status is IdleStatus {
    return !!status && !status.banking && !(status.seenAt < ports.now() - 10_000);
  }

  function inventoryMerge(status: IdleStatus, anniversary: MerchantAnniversaryControl): unknown {
    return !anniversary.reserved && !anniversary.featured ? ports.inventoryMerge(status) : null;
  }

  function finishingCast(status: IdleStatus | undefined, anniversary: MerchantAnniversaryControl): boolean {
    return gatheringCastActive(status, ports.now()) && !anniversary.busy && !anniversary.kissDue &&
      !anniversary.reserved && !ports.forcedStand();
  }

  function reserved(): boolean {
    return !!ports.eventReserved?.() || ports.storagePending();
  }
  function idle(): void {
    if (reserved()) return;
    const merchant = ports.merchant(),
      status = ports.status(merchant);
    if (["equip", "unequip", "use-item"].includes(ports.command(merchant)?.type || "")) return;
    const anniversary = ports.anniversary();
    if (!merchant || workOwnsMovement(anniversary, status)) return;
    if (!homeReady(merchant, status)) return;
    if (!available(status)) return;
    const merge = inventoryMerge(status, anniversary);
    if (!needsCommand(status, merge)) return;
    ports.issue(merchant, {
      id: ports.nextCommand(),
      type: "merchant-idle",
      listings: ports.listings(),
      homeRealm: ports.realm(),
      inventoryMerge: merge,
    });
  }

  return { idle };
}
