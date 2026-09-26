import { capturedCommunicationFailure } from './communication-failure.ts';
import type { PartyConvoy } from "./convoy.ts";
import type { MerchantCommand } from "../merchant/work.ts";
import { legacyCompletionFailure } from './communication-recovery.ts';

interface SavedConvoy extends Omit<PartyConvoy, "epoch"> {
  geometryRepair?: import('./shared-route-types.ts').SharedConvoy['geometryRepair'];
  [key: string]: unknown;
  epoch?: unknown;
}
interface SavedCommands {
  convoyCompletionReceipts?: Record<string, string>;
  townCycle?: { id: string; pending: string[]; startedAt: number; revisions?: Record<string, number> } | null;
  returnProgress?: Record<string, import("../http/return-progress.ts").ReturnProgress>;
  activeConvoy?: SavedConvoy | null;
  navigationEpoch?: unknown;
}

function restartRevisions(convoy: SavedConvoy): Record<string, number> {
  if (convoy.restartRecovery && convoy.restartRevisions) return { ...convoy.restartRevisions };
  return Object.fromEntries(
    Object.entries(convoy.expected || {}).map(([name, expected]) => [name, expected.revision]),
  );
}

function retainedEventFailure(saved: SavedCommands): boolean {
  const c = saved.activeConvoy;
  return retainedHuntFailure(saved) || c?.failureCode === 'geometry-mismatch' || (c?.phase === "failed" && c.purpose === "shared-walk" && c.label === "event walking leg");
}
function retainedHuntFailure(saved: SavedCommands): boolean {
  const c=saved.activeConvoy;
  if (c?.phase!=='failed' || !['route-failed','hunt-route-held'].includes(c.failureCode || '')) return false;
  return !!c.continuousReturn || c.purpose==='monster-hunt' || c.purpose==='shared-walk' && c.walkingActivity==='farm-recovery';
}
function restoredCommunication(c: SavedConvoy | null | undefined, now: () => number): Pick<PartyConvoy, 'communicationHold' | 'communicationLegacyRecovered'> {
  if (!c) return {};
  if (c.communicationHold) return { communicationHold: c.communicationHold, communicationLegacyRecovered: c.communicationLegacyRecovered };
  if (capturedCommunicationFailure(c)) {
    c.recoveryAttempts = 0; delete c.returnFirstFailure;
    return {communicationHold: {since: now(), reason:'Recovering captured coordinator communication failure', participants:c.participants, legacy:true}, communicationLegacyRecovered:true};
  }
  if (legacyCompletionFailure(c)) return {
    communicationHold: { since: now(), reason: 'Recovering failed completion acknowledgement', participants: c.participants, legacy: true },
    communicationLegacyRecovered: true,
  };
  if (restorableCommunication(c)) return {
    communicationHold: { since: now(), reason: 'Coordinator restarted; waiting for fresh party reports', participants: c.participants,
      resumeDefense: retainedDefense(c) },
  };
  return {};
}
function retainedDefense(c: SavedConvoy): boolean {
  return c.phase === 'defending' || c.observationPhase === 'defending' || !!c.loot;
}
function restoredPhase(saved: SavedConvoy, hold: PartyConvoy['communicationHold']): string {
  if (hold) return 'communication-hold';
  return saved.geometryRepair?.phase === 'waiting' ? 'shared-hold' : 'failed';
}
function restoredConvoy(saved: SavedCommands, now: () => number): PartyConvoy | null {
  migrateReturn(saved.activeConvoy);
  const communication = restoredCommunication(saved.activeConvoy, now);
  return saved.activeConvoy
    ? {
        ...saved.activeConvoy,
        ...(saved.activeConvoy.merchantInterruption ? { merchantInterruption: {
          ...(saved.activeConvoy.merchantInterruption as object), phase: "resuming",
        } } : {}),
        routeProtocol: 4,
        epoch: Number(saved.activeConvoy.epoch) || now(),
        ...communication,
        phase: restoredPhase(saved.activeConvoy, communication.communicationHold),
        departAt: null,
        failure: retainedEventFailure(saved) ? saved.activeConvoy.failure : "Coordinator restarted; waiting to recover interrupted travel",
        failureCode: retainedEventFailure(saved) ? saved.activeConvoy.failureCode : "runtime-lost",
        failedAt: retainedEventFailure(saved) ? saved.activeConvoy.failedAt : now(),
        restartRecovery: !retainedHuntFailure(saved) && saved.activeConvoy.failureCode !== 'geometry-mismatch',
        restartRevisions: restartRevisions(saved.activeConvoy),
      }
    : null;
}

/** Character runtimes survive host reloads, so command IDs must start from wall-clock time. */
export function initialCommandState(saved: SavedCommands, now: () => number) {
  return {
    convoyCompletionReceipts: saved.convoyCompletionReceipts || {},
    returnProgress: saved.returnProgress || {},
    commands: {} as Record<string, MerchantCommand | undefined>,
    activeConvoy: restoredConvoy(saved, now),
    navigationEpoch: Math.max(Number(saved.navigationEpoch) || 0, now()),
    nextCommandId: now(),
    thresholdRunActive: false,
    bankCycleMembers: {},
    bankQueue: [],
    bankCurrent: null,
    bankStartedAt: 0,
  };
}

function migrateReturn(c:SavedConvoy | null | undefined):void {
  if(!c)return;
  if(c.walkingActivity==='anniversary-staging' || c.purpose==='monster-hunt' && c.returnRouting)c.continuousReturn=1;
}

function restorableCommunication(c: SavedConvoy): boolean {
  // Ordinary travel retains restart-recovery's captured navigation checks and retry budget.
  if ([null, undefined, 'party-travel', 'party-force-travel'].includes(c.purpose)) return false;
  return (c.routeProtocol === 4 || c.purpose === 'monster-hunt' || !!c.continuousReturn) &&
    c.phase !== 'failed' && c.geometryRepair?.phase !== 'waiting';
}
