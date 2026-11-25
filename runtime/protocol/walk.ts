// The walk's wire shapes both runtimes share. Protocol imports no owner module, so the point and the
// map part of the game data that the ladder reads live here, and movement's geometry contracts
// import them.
import type { GEvent, GMap, ICoord } from 'typed-adventureland';
import type { RouteRecoveryCommand } from '../hunting/api.ts';
import type { MovementKind } from './records.ts';
import type { Tier } from './ranks.ts';

/** Shared wire contract. Instances and geometry identities are never inferred from map names. */
export interface Point extends ICoord { map: string; in?: string | number }
// Wire data can contain new IDs and partial arrays, unlike the complete game catalog.
export interface NavigationMap extends Pick<GMap, 'instance'> {
  spawns: number[][];
  doors?: unknown[][];
  npcs?: { id: string; position?: number[] }[];
  event?: string;
  monsters?: { type: string; boundary?: number[]; boundaries?: (string | number)[][] }[];
}
// The map part of the game data, the only part the ladder's rounds read (ladder.ts taskRound).
export interface WalkMaps { maps: Record<string, NavigationMap> }
export interface Step extends Point { town?: boolean; transport?: boolean; s?: number; method?: string; key?: string }
// Processed movement geometry requires a numeric v; the game also permits null.
export type Geometry = Omit<(typeof character)['base'], 'v'> & { v: NonNullable<(typeof character)['base']['v']> };
// The game data the walk reads: the maps, the geometry, the transporter's places and each event's join.
export interface GameData extends WalkMaps {
  geometry: unknown;
  npcs: { transporter?: { places: Record<string, number> } };
  events?: Record<string, Pick<GEvent, 'join'>>;
}

// The row and tier a member's request ranks the walk with. `by` names the app key whose command
// started the walk; a walk the player or a task started names none.
export interface WalkRequester { kind: MovementKind; tier: Tier; by?: string }
// A member's Town cast on a return walk, as its navigation report carries it (arrivals.ts
// recordTownAttempt reads it).
export interface ReturnTownAttempt {
  round: string;
  map: string;
  state: 'casting' | 'interrupted' | 'complete' | 'unavailable';
  destination: Point;
}
// The member's navigation report on its walk, which the coordinator's route store reads.
export interface SharedReport {
  failureDetails?: unknown;
  communication?: { operation: string; kind: string; since: number } | null;
  transitionMap?: string;
  townAttempt?: ReturnTownAttempt;
  id: string; epoch: number; commandId: number; navigationRevision: number;
  runtimeId: string; phase: string; routeReady?: boolean; routeVersion?: number;
  failure?: string; waypointCount?: number; departedAt?: number;
  // The point a member's journey could not re-aim to on a straight line (walk.ts `reaimDeclined`).
  reaimDeclined?: Point | null;
  // The game's answer to a refused cruise cap (walk-client.ts setConvoyCruise).
  cruiseRefused?: string | null;
  // The member's eligible chest count and its attack period from the game, which the `ready` check reads
  // (rules.ts `departureStep`).
  departureChests?: number; attackPeriodMs?: number;
}
// The walk command the coordinator writes to the party's command slot and each member's walk client
// reads.
export interface SharedCommand {
  /** Origin of an independent farming continuation after a convoy combat handoff. */
  convoyHandoff?: string;
  /** Workflow parent retained by a shared event-return walking child. */
  cycleId?: string;
  jobId?: unknown;
  routeRecovery?: RouteRecoveryCommand;
  returnWalking?: boolean;
  continuousReturn?: number;
  disableTown?: boolean;
  avoidLeave?: boolean;
  nativeFallback?: boolean;
  cause?: "farming-conflict";
  huntTarget?: string;
  id: number; type: string; phase: string; convoyId: string; epoch: number;
  navigationRevision: number; routeVersion?: number;
  returnRouting?: boolean; label?: string; townFirst?: boolean;
  location: Point; rally: Point; leader: string; participants: string[];
  slowestSpeed: number; purpose: string | null; navigationExempt: boolean;
  // The row and tier each member's request ranks the walk with.
  requester: WalkRequester;
  // The coordinator service that owns the walk, named in each member's walk identity.
  group?: string;
  // The members walk to the rally without Town (the walk's safe-point rung, protocol/ladder.ts `walkRound`).
  rallyWalking?: boolean;
  combatHandoffAllowed: boolean; nonPreemptible: boolean;
  // `walk.flags`: the add-ons' departure and defence answer for this walk (movement/rules.ts).
  addonFlags?: { depart?: 'hold' | 'go'; defence?: 'pause' | 'walk-on' } | null;
  reason?: string;
  failureCode?: string;
  failureContext?: unknown;
  force?: boolean;
  deferRendezvous?: boolean;
}
