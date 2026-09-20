import type { createCoordinatorRecoveryHooks } from "../navigation/recovery-hooks.ts";
import type { EscapeRecovery, SavedRecoveryState } from "../navigation/recovery-contracts.ts";
import type { coordinatorGroupedSnapshot } from "../navigation/grouped-snapshot.ts";
import type { WebRouter } from "./web-platform.ts";

type RecoveryHooks = ReturnType<typeof createCoordinatorRecoveryHooks>;
type RecoveryState = Parameters<typeof createCoordinatorRecoveryHooks>[0];
type GroupedState = Parameters<typeof coordinatorGroupedSnapshot>[0];
type GroupedPorts = Parameters<typeof coordinatorGroupedSnapshot>[1];

interface EscapeState {
  escape: EscapeRecovery | null;
  statuses: Record<string, unknown>;
  activeConvoy: { id: string; phase?: string; failure?: string } | null;
}

/** Escape construction also recovers an interrupted, persisted escape. */
export interface CreateEscape {
  (
    state: EscapeState,
    hooks: RecoveryHooks["escape"] & { now?: () => number },
  ): {
    start(names: string[]): EscapeRecovery;
    release(): void;
    step(): void;
    owns(name: string): boolean;
    fail(reason: string): void;
  };
}

/** Disengagement owns reset/recovery transitions and transforms grouped observations. */
export interface CreateCombatDisengagement {
  (
    state: RecoveryState & GroupedState & SavedRecoveryState,
    hooks: RecoveryHooks["disengagement"] & { now?: () => number },
  ): {
    tick(): void;
    active(): boolean;
    prepare: GroupedPorts["prepare"];
    finalize: GroupedPorts["finalize"];
    install(router: Pick<WebRouter, "post">): void;
    reset(names: string[], reason: string, group?: boolean): number;
  };
}
