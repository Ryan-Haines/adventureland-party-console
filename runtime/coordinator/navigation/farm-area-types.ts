import type { ReturnLocation } from "../events/return-types.ts";
import type { HuntCycle } from "../hunt/contracts.ts";
import type { Area } from "../../../dashboard/lib/farming-zones.ts";

export interface FarmingArea extends ReturnLocation, Area {}
export interface FarmReport extends ReturnLocation {
  farmCompetition?: import("./farm-competition.ts").FarmCompetitionObservation;
  combatSelection?: {runtimeId?: string};
  server?: string;
  seenAt: number;
  rip?: boolean;
  activeEvent?: string;
  joinedEvent?: string;
}
export interface FarmRelocation {
  cause?: "farming-conflict";
  source?: FarmingArea;
  actor?: string;
  destination: FarmingArea;
  revisions?: Record<string, number>;
  at: number;
  reason: string;
}
export interface FarmAreaState {
  recoveryVersion?: number;
  paused?: boolean;
  failures?: Record<string, number>;
  pending?: FarmRelocation | null;
  message?: string | null;
  active?: { id: string; map: string; x: number; y: number; monsterIds: string[] };
  lastFailure?: { reason?: string; at: number; transient: boolean; details: unknown } | null;
  lastMoveAt?: number;
  activity?: Record<string, { until: number; actor: string }>;
}
export interface FarmConvoy {
  failureCode?: string;
  participants?: string[];
  expected?: Record<string, { revision: number }>;
  cause?: "farming-conflict";
  phase: string;
  purpose?: string | null;
  location: FarmingArea;
  failure?: string;
  failureDetails?: unknown;
}
export interface FarmNavigationState {
  huntSettings?: import("../hunt/settings.ts").HuntSettings;
  farmAreaState?: FarmAreaState | null;
  farmingPolicy: string;
  monsterHunt: HuntCycle | null;
  monsterFocus: string[];
  location: FarmingArea | null;
  statuses: Record<string, FarmReport | undefined>;
  leader: string | null;
  monsterSearchRadiusByCharacter?: Record<string, number>;
  eventReturn?: unknown;
  escape?: { stage: string } | null;
  activeConvoy?: FarmConvoy | null;
}
export interface FarmNavigationPorts {
  now(): number;
  rareOwns(): boolean;
  members(): string[];
  areas(ids: string[]): FarmingArea[];
  resolve(ids: string[], location: FarmingArea | null): FarmingArea | null;
  areaId(area: FarmingArea): string;
  record(state: FarmAreaState, reports: FarmReport[], areas: FarmingArea[], now: number): void;
  intent(name: string): { revision: number; cancelled?: boolean };
  contains(area: FarmingArea, report: FarmReport, margin: number, radius: number): boolean;
  huntOwns(hunt: HuntCycle): boolean;
  eventOwns(hunt: HuntCycle): boolean;
  cancelConvoy(): void;
  alternatives(
    state: FarmAreaState,
    areas: FarmingArea[],
    active: FarmingArea,
    now: number,
    excluded?: string[],
  ): FarmingArea[];
  advanceHunt(hunt: HuntCycle): void;
  fighting(report: FarmReport, now: number): boolean;
  startHunt(hunt: HuntCycle, location: FarmingArea, label: string, stage: string): void;
  authorize(names: string[], location: FarmingArea, force: boolean): void;
  startConvoy(location: FarmingArea, label: string, names: string[], purpose: string, cause?: "farming-conflict"): void;
  persist(): void;
}
