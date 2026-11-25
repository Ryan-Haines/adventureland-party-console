// The merchant job owner's public file: what the rest of the console and the other owners
// may import of runtime/merchant-jobs/. Nothing else under the folder is importable from another owner
// (owner:check); an add-on imports these types only through runtime/hooks/addon-api.ts. The coordinator
// values are in runtime/merchant-jobs/coordinator/api.ts, so the character bundles and the dashboard load
// this file. Section 4's `jobs.enqueue`: the ask and its answer, for the sources outside the owner.
export type { EnqueueAsk, EnqueueAnswer } from './coordinator/owner.ts';
export type { ReadyJob } from './coordinator/dispatch.ts';
export type { CharacterWork, MarketListing, MerchantCommand, MerchantWork, PickupState, ResourceBlock, ServiceStatus } from './coordinator/owner.ts';
export type { CompletionPorts, CompletionState } from './coordinator/endings.ts';
export type { DeliveryRequest } from './coordinator/deliveries.ts';
export type { recoverMerchantQueue } from './coordinator/recovery.ts';
export type { createMerchantControlRoutes } from './coordinator/routes.ts';
// The job kind table (`merchant.kind`).
export { merchantKind, jobCommandRetained, merchantLine, realmRetry, routineEnabled, manualVisitReason, type JobKind, type JobReason, type EndingRow } from './rules.ts';
// The merchant job owner's routine priority, which the merchant card and the
// priorities dialog read.
export { merchantRoutinePriority } from './rules.ts';
export { autoUpgradeEnabled, defaultMerchantAutomations, defaultMerchantRoutinePriorities, migrateExchangeAutomations, migrateRoutinePriorities, routineFor, validStandLocation } from './rules.ts';
export type { MerchantStandLocation, PriorityState, coordinatorPrioritizedBids } from './rules.ts';
// The stand location rule's fallback point and reach, which the items owner's native stand reads.
export { legacyStandLocation, AT_STAND } from './rules.ts';
// The routine priority range, the collection radius and the commerce fence's version, which the
// status owner's dialog and card and the items owner's production read.
export { ROUTINE_PRIORITY, NEARBY_RADIUS, COMMERCE_PROGRESS_VERSION, typedRoutinePriority, movedRoutinePriorities } from './rules.ts';
// A job's priority, which the items owner's native stand reads to order its buy
// orders.
export { coordinatorMerchantPriority } from './rules.ts';
export { merchantAnniversaryControl } from './rules.ts';
export type { AnniversaryMerchantStatus, MerchantEventState } from './rules.ts';
export { automaticRoutine, coordinatorMerchantTransferBlocked, pickupReason, routineLabel, ROUTINE_DIALOG_LABELS } from './rules.ts';
// An add-on job kind as the routine priorities dialog's merchant-routines slot lists it.
export type { AddonKindRow } from './rules.ts';
// A job's whole label, which the merchant card reads.
export { merchantJobLabel } from './rules.ts';
// The gathering, which targeting's ports read for its active fact.
export type { MerchantGathering } from './character/gathering.ts';

// The merchant doors. The character's runner
// and visits install them; the dispatcher calls one with the add-on's args, the band and, in the
// job band, the job that holds the merchant.
import type { MerchantDoor, MerchantDoors } from './rules.ts';
import type { Door } from '../hooks/registry.ts';
export type { MerchantDoor, MerchantDoorAnswer, MerchantDoorBand } from './rules.ts';
function merchantDoor(name: keyof MerchantDoors): MerchantDoor {
  const door = (globalThis as { __partyMerchantDoors?: MerchantDoors }).__partyMerchantDoors?.[name];
  if (!door) throw Error('The merchant job owner is not installed on this character');
  return door;
}
export const standOpen: Door = (args, ask) => merchantDoor('standOpen')(args, ask.band, ask.holder);
export const standClose: Door = (args, ask) => merchantDoor('standClose')(args, ask.band, ask.holder);
export const joinGiveaway: Door = (args, ask) => merchantDoor('joinGiveaway')(args, ask.band);
