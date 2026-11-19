// The grouped queue's types: the shapes every other owner imports for a member
// report, a target, a fight, a kill and the group.
import type { FormationRecovery, FormationRecoveryReport, IndependentConfirmation, IndependentReady } from '../../movement/api/character.ts';
import type { CurrentAttacker } from '../../movement/api/coordinator.ts';
import type { ApproachReport, Candidate, ClaimObservation, ClaimState, Evidence, HandoffReport, PassingAcknowledgement, Pursuit, PursuitExclusion, Retention, SuccessorGrant } from './queue.ts';
import type { PassingEncounter } from '../../characters/targeting/api.ts';
import type { LostTarget, SearchState } from './unseen.ts';
import type { Tier } from '../../protocol/ranks.ts';
// Table R's grouped combat and party sections (the status owner's reply.ts) ask these
// reads.
export { createPassingStatus, uniqueReferences } from './status.ts';

export interface Member {
  name: string; ctype: string; revision: number; cancelled?: boolean;
  status?: {
    monsterHunt?: {id:string;count:number;remainingMs:number} | null;
    seenAt: number; lastDeath?: {at: number}; hp: number; rip?: boolean; map: string; in?: string | number; server?: string;
    /** Native moving bit is optional in older partial status reports. */
    moving?:import('typed-adventureland').CharacterEntity['moving'];
    x: number; y: number; range?: number; max_hp?: number; mp?: number; max_mp?: number;
    // Each enabled add-on's own report (the status owner's table F `addonReports`), which
    // `group.anchor` hands on.
    addonReports?: Readonly<Record<string, unknown>>;
    // The gap between the member's last two reports, which the report interval reads.
    reportIntervalMs?: number;
    // The one event fact: set while the member walks to, attends or returns from an event,
    // null otherwise.
    presence?: unknown;
    // The character's combat position report (characters/shared.js `partyCombatPosition`).
    combat?: { positioning?: { movementOwner?: string | null; phase?: string } | null };
    combatSelection?: { id: string | null; map: string | null; revision: number; runtimeId: string; target?: Target | null };
    groupedCombat?: { independentReady?:IndependentReady; independentApproach?:boolean; handoff?:HandoffReport; travelCommitted?: Fight[]; travelCandidates?: Target[]; huntDefense?: boolean; passingAcknowledgement?: PassingAcknowledgement; returnDefense?: boolean; passingEncounters?: PassingEncounter[]; formationRecovery?: FormationRecoveryReport; approach?: ApproachReport; pursuitAck?: string | null; currentAttackers?: CurrentAttacker[];
      currentAttackersAt?: number; travelCommand?: {id:number;revision:number} | null; retentions?:Retention[];unreachable?:{id:string;map:string;in?:string|number;at:number;until?:number}[];retentionPaused?:boolean; observationAt?:number; lootPending?: boolean; epoch?: number; claims?: ClaimObservation[]; candidates?: Candidate[]; evidence?: Evidence[]; queueAck?: string | null; protocol?: number; ack?: string | null; anchorVisible?: boolean; deaths?: Death[]; threats?: Target[]; sightings?: Target[]; state?: Group | null };
  };
}
// A kill's tombstone; `mtype` is the type its target had (queue.ts).
export interface Death { id: string; map: string; in?: string | number; server: string; at: number; mtype?: string }
export interface Fight extends Target { state?: 'planned' | 'pending' | 'engaged'; score?: number; server: string | undefined; fighter: string; startedAt: number }
export interface Target { level?: import('typed-adventureland').MonsterEntity['level']; target?: string | null; id: string; mtype: string; map: string; in?: string | number; x: number; y: number; hp?:number; max_hp?:number;
  /** The Cave side the game gives the actor (`entity.cave.side`), on a sighting. */
  caveSide?: string }
export interface Group {
  /** Every current actor can own its same-target approach independently. */
  independentApproach?:boolean;
  independentReadiness?:Record<string,IndependentReady>;
  independentConfirmation?:IndependentConfirmation;
  independentConfirmationRevision?:number;
  caveScope?: string;
  pairRevision?:string | null; successorGrant?:SuccessorGrant;
  handoffTiming?: {selectedAt: number; committedAt: number | null};
  passingEncounters?: PassingEncounter[];
  formationRecovery?:FormationRecovery;
  pursuit?: Pursuit; pursuitExclusions?: PursuitExclusion[];
  lostTargets?:LostTarget[]; searches?:Record<string,SearchState>; transitionTrace?:{at:number;target:string|null;reason:string}[];
  rareRejections?: (Target & {server:string;until:number;rejectedAt:number;expiresAt?:number})[];
  resetAt?:number;
  claims?: ClaimState[];
  observers: {name:string;map:string;in?:string|number;server:string|undefined;x:number;y:number;seenAt:number}[];
  queue: Fight[]; queueRevision: string; deaths: Death[]; evidence: Evidence[];
  key: string; phase: string; leader: string; members: string[]; priest: string | null;
  anchor: {name: string; map: string; in?: string | number; server: string | undefined; x: number; y: number} | null;
  range: number; ready: boolean; readySince: number | null; seenAt: number;
  target: Target | null; selection: string | null; committed: boolean;
  blockers: string[]; fights: Fight[]; threats: Fight[]; fighter: Group["anchor"];
  protocol: number; targetLeader: string; participating: string[]; recovering: string[]; recoverySince: Record<string, number>;
}

// Hunt travel's convoy state and the control a reply carries, which movement's walk and
// targeting's queue both read.
export interface HuntTravelConvoy {
  huntArrival?: unknown;
  id?: string; epoch?: number; purpose?: string | null; huntTarget?: string;
  continuousReturn?: number; phase?: string; observationPhase?: string;
  requester?: {tier?: Tier};
  huntTravel?: {primary: Fight | null; searches: Record<string, SearchState>; retired?: string[]; released?: Record<string, number>; committed?: Fight[]; reason?: "passive-setting" | "extra-aggro"};
}
export interface HuntTravelControl {
  id?: string; epoch?: number; primary: Fight | null; defending: boolean; committed?: Fight[]; reason?: "passive-setting" | "extra-aggro";
}
// The door movement's travel defense asks: one walk's Hunt travel encounter reconcile.
export { updateHuntTravel } from './hunt-travel.ts';
export type { RareRejections } from './queue.ts';
// The grouped queue's evaluation, which the lifecycle owner's start loads from the built bundle (start.ts
// `loadCoordinatorDependencies`).
export { evaluateGroup } from './queue.ts';
// A target's one identity, which survival's recovery keys its foes by.
export { targetIdentity } from '../../characters/targeting/rules.ts';
export type { ApproachReport, ClaimObservation } from './queue.ts';

// What the lifecycle owner's composition root (runtime/coordinator/application.ts) and
// its contract check (initialization.contract-check.ts) compose of this owner.
export { coordinatorGroupedSnapshot, installEventBoundary } from './snapshot.ts';
export { installCoordinatorTargeting } from './install.ts';
