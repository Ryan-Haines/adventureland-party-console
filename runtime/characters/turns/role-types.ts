import type { Entity } from "typed-adventureland";
import type { RangeDiagnostic, RangeSample } from "../targeting/api.ts";
import type { RunnerTick } from "../../movement/api/character.ts";
export type Target = Entity;
type TargetGetter = () => Target | null;
export interface Role {
  name: string;
  combat: boolean;
  // The class decisions on the target (TRN-014 to TRN-016, TRN-026, TRN-029): `turn` is the turns
  // owner's handle the role loop passes, its cast path and its stand-in reads.
  beforeAttack(target: Target, turn: import('./api.ts').ClassTurn): Promise<boolean>;
  // The support casts the class sets now, by skill: the member and the MP (mage.ts's Energize). The
  // ranking and the status report read it (TRN-Q-DPS DPS-3, DPS-4).
  support?(turn: import('./api.ts').ClassTurn): Partial<Record<string, import('./skills/types.ts').SupportSet>>;
}
export interface SharedCombat {
  // The survival owner's character half (runtime/characters/survival/install.ts), which shared.js
  // builds at load and the role runner's install line completes.
  survival: import('../survival/api.ts').SurvivalCharacter;
  // The targeting module shared.js built at load.
  targeting: import('../targeting/api.ts').TargetingMap;
  start(): void;
  stop(): void;
  // `positions` answers true when an add-on took the tick for the coordinated target approach.
  // Step 9b: an add-on mover's task walk (characters/shared.js addonWalk) and its end.
  // The follow mover (runtime/movement/character/movers.ts), bound by its moved name.
}
export interface CombatState {
  skill?: import('./api.ts').SkillDiagnostic;
  entityRefresh?: import('../targeting/api.ts').EntityRefreshDiagnostic;
  recovery?: { phase: string; attempt: number; lastError: string | null; errorAt: number | null; status: string; at: number; recoveredAt: number | null;
    // Step 7: the rung being tried and the group task answer it acts on.
    trying?: string | null; answer?: string | null; answeredAt?: number | null };
  attackTiming?: { accepted: number; cooldownRejections: number; timeouts: number; lastOffsets: number[] };
  rangeRecovery?: RangeDiagnostic | null;
  at: number;
  stage: string;
  error: string | null;
  // The survival owner's member recovery's card words while it runs (the status owner's table L1).
  label?: string | null;
  errorAt?: number;
  lastHealAt?: number;
  lastHealTarget?: string;
  targetRejection?: string | null;
  selectedTarget?: string | null;
  skippedAttack?: string | null;
}
export interface RoleRunner {
  hasStartedTarget(id:string):boolean;
  engagedTargetId():string|null;
  advanceTarget(): void;
  resetTargeting():void;
  isKnownDead(id: string): boolean;
  // targeting/retire.ts `retiring`: the leader's unreachable notice on its lock target `id` waits
  // for the queue's retire.
  retiring(id: string): boolean;
  invalidateTarget(id?: string): void;
  wake(): void;
  role(): Role;
  start(): void;
  stop(): void;
}
export interface CombatRoot {
  __partyConsoleMaintenance?: {id: string; expires: number; mode?: 'draining'} | null;
  partyPorcupineEquipment?: ReturnType<typeof import("../targeting/api.ts").createPorcupineEquipment>;
  sharedRoutine: SharedCombat;
  // Movement's character door (movement/character/install.ts): the tick the runner starts with its
  // timers and stops with them, and the combat movement reset at its stop.
  partyMovement: { startMovementTick(runner: RunnerTick): () => void; resetCombatMovement(): void };
  // The hunting owner's character door (shared.js `partyHunting`): the departure loot client's ports.
  partyHunting: Parameters<typeof import('../../hunting/api.ts').installLootClient>[1];
  // the merchant jobs owner's character door (merchant-jobs/character/visits.ts): the merchant visit's invisibility window.
  partyMerchant?: { jobs: { visibilityActive(): boolean } };
  // The tasks owner's character door (shared.js `partyTasks`): the hand hold (M2) the movement
  // tick holds behind, and the party the queue client reports.
  partyTasks: { holds: { handControl(): { by: 'manual' | 'pause'; usePotions: boolean; combat: boolean } | null }; partyList(): string[] };
  // The turns owner's character door (shared.js `partyTurns`): the stand-in facts the turns install reads
  //.
  partyTurns?: { facts(): import('./stand-ins/holds.ts').TurnsFacts; healFirstBelow?: { routine?(): unknown } };
  // The status owner's character door (shared.js `partyStatus.character`): the queue markers the runner draws.
  partyStatus: { character: { queueMarkers: Parameters<typeof import('../../status/character/api.ts').installQueueMarkers>[0] } };
  partyRoleRunner?: RoleRunner;
  partyCombatState: CombatState;
  // The movement service the runner reads: the per-tick invariant audit and the step calls
  // (runtime/movement/character/owner.ts).
  __partyMovement?: { audit?(): void; holdStep?(): void; stepAllows?(to: { x: number; y: number }, target?: string): boolean;
    step?(to: { x: number; y: number }, mode: string, options?: { target?: string; closes?: "terrain" | "attackers" }): { sent: Promise<unknown> } };
  partyCombatPosition?: Record<string, unknown> | null;
  // The items owner's loot pass and its timer (runtime/items/character/market.ts).
  partyItems: { loot: { start(report: (error: unknown) => void): void; stop(): void } };
}
declare global {
  var sharedRoutine: SharedCombat;
}
