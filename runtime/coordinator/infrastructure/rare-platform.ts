import type { createCoordinatorRecoveryHooks } from "../navigation/recovery-hooks.ts";
import type { zones } from "../../../dashboard/lib/farming-zones.ts";

type Catalog = Parameters<typeof zones>[0];
type RecoveryState = Parameters<typeof createCoordinatorRecoveryHooks>[0];
type RareHooks = ReturnType<typeof createCoordinatorRecoveryHooks>["rare"];

interface RareState extends RecoveryState {
  leader: string | null;
  statuses: Record<string, unknown>;
  monsterChoices: Catalog | null;
  passiveHunting?: import("../navigation/passive-settings.ts").PassiveSettings;
  passiveRareHunts: Record<string, boolean>;
}

/** Rare sightings and return controls remain owned by the installed rare service. */
export interface RareHuntingPlatform {
  validateOrder(catalog: Catalog | null | undefined, order: unknown): boolean;
  validPassiveSettings(settings: unknown): boolean;
  createRareHunting(
    state: RareState,
    hooks: RareHooks & { now?: () => number },
  ): {
    report(name: string, status: { seenAt?: number }): void;
    tick(): void;
    start(order: unknown): void;
    stop(reason?: string): void;
    control(name: string): unknown;
    owns(): boolean;
    abandon(): void;
    blocksPulls(): boolean;
    encounter(): boolean;
    setSettings(settings: Record<string, unknown>): void;
  };
}
