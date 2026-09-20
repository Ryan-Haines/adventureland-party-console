import type { AnniversaryCycle } from "./contracts.ts";
import type { ReturnLocation, Waypoints } from "../events/return-types.ts";
import type { DeferredRecovery } from "../events/observations.ts";

export interface AnniversaryRecoveryState {
  eventCycle?: AnniversaryCycle | null;
  abortedRounds: Record<string, unknown>;
  partyHold?: unknown;
  returnReady?: Record<string, unknown>;
}
export interface AnniversaryRecoveryPorts {
  now(): number;
  merchant(): string | null;
  participants(): string[];
  activeNames(): string[];
  intent(name: string): { cancelled?: boolean; revision: number };
  location(cycle: AnniversaryCycle, name: string): ReturnLocation | null;
  defer(name: string, recovery: DeferredRecovery): void;
  log(message: string, level: string): void;
  persist(): void;
  convoyBusy(): boolean;
  townBusy(): boolean;
  dispatch(cycle: AnniversaryCycle, names: string[]): boolean;
  capture(names: string[] | undefined): Waypoints;
  reconcile(cycle: AnniversaryCycle): unknown;
  schedule(): void;
}
export interface AnniversaryFailure {
  character?: string;
  round?: string | number;
  attempt?: number;
  failureReason?: string;
  target?: string;
  navigationRevision?: number;
}
export interface AnniversaryBuffStatus {
  conditions?: { id?: string; name?: string }[];
  anniversaryState?: { round?: string | number };
  anniversaryVisit?: unknown;
}
export type AnniversaryReturnService = {
  dispatch(force?: boolean): boolean;
  finishAbort(
    cycle: AnniversaryCycle,
    round: string,
    target: string | null | undefined,
    name: string,
    reason: string,
  ): { aborted: boolean };
};
