// The merchant job owner's core on the coordinator: the one writer of the merchant's command slot and
// the held manual command, the one pause and the one end of a job, the ladder booking, the job
// records, and the queue with the collection facts and pickups. The dispatch (dispatch.ts), the
// completion and its retry (endings.ts), the recovery and the restart (recovery.ts), the stand return
// (stand.ts) and the deliveries (deliveries.ts) read and write the queue through what this file
// exports.
import { compoundRunnable, craftProtection, offeringCollectionReady, offeringSupplyReady, pendingOfferingCollection, upgradeRecoverySignature, type BankUpgradeRule, type CompoundRule, type CraftReservationState, type createStatScrollCommands, type ExchangeLine, bankCollectionReason, type BankCollectionState } from '../../items/coordinator/api.ts';
import { availableCraftStock, markedItem, markMatches, stackQuantity, itemRuleConflicts, ruleOwner, sharedMember, inventoryPack, exchangeKey, TRACKER_ITEMS, type ConflictState, type CraftProtection } from '../../items/api.ts';
import type { InventoryEntry, ItemMark, Item } from '../../coordinator/contracts/item.ts';
import { type MerchantEventState, type PrioritizedJob, selectMerchantJob, jobReady, stampMerchantJob, coordinatorMerchantPriority, routineEnabled, merchantKind, RUN_FIELDS, ladderFrom, type ReadyFacts, pickupReason, mergePickupJobs, mergeTiming, NEARBY_RADIUS, type JobReason } from '../rules.ts';
import type { ObservedPosition } from '../../coordinator/contracts/position.ts';
import { requestObject } from '../../lifecycle/api.ts';
import { played, type SettingsWrite, type SettingsWriteResult } from '../../settings/api.ts';
import { releaseMerchantInterruption } from '../../movement/api/coordinator.ts';
import { recordMerchant } from './records.ts';
import { boundFired } from '../../status/coordinator/api.ts';
import { merchantEventRecoveryReserved } from './event-hold.ts';
import { fresh } from '../../protocol/reports.ts';
import { writeSlot } from '../../status/api.ts';
import { samePlace } from '../../protocol/place.ts';
import type { LadderPort } from '../../tasks/api.ts';
import type { DeliveryRequest } from './deliveries.ts';


// `jobs.command`: the one writer of the merchant's command slot. Every write names its owner:
// `job:<id>`, `gather`, `idle`, `manual:<type>`, `realm`, `holder:<row>`, or the owner of another
// slot writer. A job's write while another job is current and a gather route's write during a
// job are refused. A manual command you give during a job is held, one at a time, until the job's next
// checkpoint yields to it or the job ends; with no job current it goes to the slot at once.
// Another character's slot is written as asked. The other slot writers (travel, Town, events,
// convoys, storage) write under their own owner name, so the ring names each; `manual:` is the
// equipment owner only. Every write, on any character's slot, then goes through the status owner's
// table C writer, which refuses a write that ranks below the retained command the slot holds.
export type SlotAnswer = 'written' | 'held' | 'refused';
interface SlotState {
  merchantCharacter?: string | null;
  merchantCurrent?: { id: string; reason?: string } | null;
  commands: Record<string, unknown>;
}
const slotWrites = new WeakMap<object, { owner: string; command: unknown }>();
const heldManual = new WeakMap<object, { owner: string; command: MerchantCommand }>();
export function merchantSlotCommand(state: SlotState, owner: string, command: unknown,
  name: string | null = state.merchantCharacter ?? null): SlotAnswer {
  if (!name) return 'refused';
  const slot = state.commands, current = state.merchantCurrent;
  if (name === state.merchantCharacter) {
    const foreign = !!current && owner !== 'job:' + current.id;
    if (foreign && command && owner.startsWith('manual:')) {
      heldManual.set(state, { owner, command: command as MerchantCommand });
      recordMerchant({ subject: name, decision: 'slot-held', owner, code: current!.id });
      return 'held';
    }
    if (foreign && (owner === 'gather' || owner.startsWith('job:'))) {
      recordMerchant({ subject: name, decision: 'slot-refused', owner, code: current!.id });
      return 'refused';
    }
  }
  // The status owner's table C writer ranks a write over another writer's retained command.
  if (writeSlot(slot, name, command as Parameters<typeof writeSlot>[2]) === 'refused') {
    if (name === state.merchantCharacter) recordMerchant({ subject: name, decision: 'slot-refused', owner, code: String((slot[name] as { type?: unknown }).type) });
    return 'refused';
  }
  if (name === state.merchantCharacter) {
    slotWrites.set(state, { owner, command });
    recordMerchant({ subject: name, decision: command ? 'slot-written' : 'slot-cleared', owner });
  }
  return 'written';
}
// A job's end clears the slot only while the slot still holds that job's own write: the write
// the slot writer recorded under `job:<id>`, or a command that carries the job's id. A command
// of another writer (the realm move, travel, Town, an event, a convoy, a manual command) carries
// no job id and stays.
function clearJobSlot(state: SlotState, job: { id: string }): void {
  const merchant = state.merchantCharacter, command = merchant ? state.commands[merchant] as { jobId?: unknown } | undefined : undefined;
  if (!merchant || !command) return;
  const write = slotWrites.get(state);
  if (command.jobId === job.id || (write?.owner === 'job:' + job.id && write.command === command)) merchantSlotCommand(state, 'job:' + job.id, null);
}
// The slot holds a manual command the owner wrote, until its report replaces it.
export function manualCommandPending(state: SlotState): boolean {
  const write = slotWrites.get(state), merchant = state.merchantCharacter;
  return !!write && write.owner.startsWith('manual:') && !!merchant && state.commands[merchant] === write.command;
}
// A manual command waits for the running job's checkpoint.
export function manualCommandHeld(state: SlotState): boolean {
  return heldManual.has(state);
}
function releaseHeldManual(state: SlotState): void {
  const held = heldManual.get(state);
  if (!held) return;
  heldManual.delete(state);
  merchantSlotCommand(state, held.owner, held.command);
}

// `jobs.pause` (3.4): the one pause every caller asks. It strips `RUN_FIELDS`, keeps the resume
// state, the receipts and the counts, releases the convoy interruption and the slot, and writes the
// ring entry with `by`; the caller gives the id, `queuedAt` and `retryAt` it gives today and places
// the job in the queue. A kind with `interrupt: 'never'` (the ALData sale) is not paused for a force
// stand or a party realm switch: it runs to its end or its deadline.
export type PauseBy = 'user' | 'realm' | 'checkpoint' | 'completion' | 'recovery' | 'restart' | 'event';
// The paused copy carries `pausedBy`, so its next claim records `resumed` (dispatch.ts `assign`).
export function pauseMerchantJob<T extends { id: string; reason?: string }>(state: SlotState, job: T, by: PauseBy): T | 'never' {
  if ((by === 'user' || by === 'realm') && merchantKind(String(job.reason)).interrupt === 'never') return 'never';
  endMerchantJob(state, job, { decision: 'paused', by });
  return Object.assign(stripRun(job), { pausedBy: by });
}
// The pause's strip: the job's copy with no part of the run it left. The completion's retry and the
// restart take it with no pause of their own: the retry's job already ended, and the restart's slot
// is the one the coordinator loaded.
export function stripRun<T extends object>(job: T): T {
  const stripped = { ...job } as T & Record<string, unknown>;
  for (const field of RUN_FIELDS) delete stripped[field];
  return stripped;
}
// The one end of a job, which every ending reads (a completion, a pause, a satisfied restock, the
// clear route): the convoy interruption goes, and for the current job the slot clears while it holds
// the job's write, the merchant is free, and a manual command held for the job's next stop goes to
// the slot. The ring entry names the ending: `ended` with its code, or `paused` with its `by`.
export function endMerchantJob(state: SlotState, job: { id: string; reason?: string },
  end: { decision: 'ended'; code: string } | { decision: 'paused'; by: PauseBy }): void {
  releaseMerchantInterruption(state as Parameters<typeof releaseMerchantInterruption>[0], job.id);
  if (state.merchantCurrent?.id === job.id) {
    clearJobSlot(state, job);
    state.merchantCurrent = null;
    releaseHeldManual(state);
  }
  recordMerchant(end.decision === 'ended'
    ? { subject: String(state.merchantCharacter), decision: 'ended', owner: 'job:' + job.id, kind: job.reason, code: end.code }
    : { subject: String(state.merchantCharacter), decision: 'paused', owner: 'job:' + job.id, by: end.by });
}

// `merchant.pause` for your force stand and the realm owner's party switch: the current
// job keeps its id and its place in line and goes to the head of the queue. A kind that finishes
// first (the ALData sale) is not paused, so neither requeues a sale it could fill twice; the answer
// is false while it runs.
export function pauseCurrentJob<T extends { id: string; reason?: string; queuedAt?: unknown }>(state: SlotState &
  { merchantCurrent: T | null; merchantQueue: T[] }, by: 'user' | 'realm', now: () => number, stamp: (job: T) => T): boolean {
  const current = state.merchantCurrent;
  if (!current) return true;
  const paused = pauseMerchantJob(state, current, by);
  if (paused === 'never') return false;
  paused.queuedAt = Number(current.queuedAt) || now();
  state.merchantQueue.unshift(stamp(paused));
  return true;
}

// A retry carries the failure its ending names, and the job owner books it once on the
// tasks owner's merchant-job ladder at the first pass where that task is live, climbing from the
// job's own count. A checkpoint or a completion is progress. No count drops a job.
const LADDER_COUNTS: Readonly<Record<string, 'retryCount' | 'rendezvousRetryCount' | 'recoveryAttempts' | 'realmAttempts'>> = {
  'job-interrupted': 'retryCount', 'rendezvous-timeout': 'rendezvousRetryCount', 'job-unresponsive': 'recoveryAttempts',
  // A party visit's missed realm switch, booked at the job's next claim like the others.
  'realm-switch': 'realmAttempts',
};
export function bookMerchantLadder(job: MerchantWork | null, ladder: LadderPort | undefined): void {
  // A retry claimed with its `retryOn` still set ran at ENDING_RETRY_MS's bound: its member never
  // reported (endings.ts `retryOnReport`).
  if (job?.retryOn) {
    boundFired({ bound: 'ENDING_RETRY_MS', owner: '08', subject: job.retryOn.character, state: { jobId: job.id, reason: job.reason } });
    delete job.retryOn;
  }
  const code = job?.ladderDue;
  if (!job || !code || !ladder || ladder.rung() === null) return;
  ladder.fail(code, { from: ladderFrom(Number(job[LADDER_COUNTS[code]!]) || 1), trying: job.reason });
  delete job.ladderDue;
}

// The job records: a marketplace listing, a commerce order and the queued job's saved fields.
/** Marketplace records retain vendor metadata that the character executor consumes. */
export interface MarketListing {
  [field: string]: unknown;
  key?: string;
  seller?: string;
  serverRegion?: string;
  serverIdentifier?: string;
  price?: number;
  quantity?: number;
  bidItemId?: string | null;
}

/** Work payloads are forwarded unchanged; execution belongs to the character runtime. */
export interface MerchantWork extends MerchantJob {
  operationStage?: MerchantOperationStage;
  expiresAt?: number;
  destinationRealm?: string;
  realmStartedAt?: number;
  realmAttempts?: number;
  realmBlockedReason?: string;
  realmError?: string;
  // Your confirmation of a blacklisted listing realm, stored on a manual order when you place it; the
  // realm owner's hop reads it.
  realmConfirmed?: boolean;
  // The 01 ladder failure a retry books at its next claim.
  ladderDue?: string;
  // Who paused the job (`jobs.pause`), until its next claim records it resumed.
  pausedBy?: PauseBy;
  [field: string]: unknown;
  listings?: MarketListing[];
  pontyCandidates?: MarketListing[];
  pontyQuantity?: number;
  pontyPlanned?: boolean;
  manual?: boolean;
  amount?: number;
  itemId?: string;
  sellQuantity?: number;
  homeRealm?: string;
  completedListingKeys?: string[];
  acknowledgedPurchaseKeys?: string[];
  exchanges?: ExchangeLine[];
  exchangeRewards?: unknown[];
  exchangeResume?: boolean;
  autoExchangeKeys?: string[];
  pack?: string;
  floor?: string;
  gold?: number;
  seller?: string;
  slot?: string;
  rid?: string;
  realm?: string | null;
  expandLeaderCluster?: boolean;
  clusterExpanded?: boolean;
  expandLuckCluster?: boolean;
  castMerchantLuck?: boolean;
  radius?: number;
}

// A member's status report: the position record the character sends (`rip: !!character.rip`,
// characters/targeting/queue-client.ts) and the merchant fields beside it.
export interface ServiceStatus extends ObservedPosition {
  upgradeInventoryBusy?: boolean;
  gatheringPhase?: string;
  gatheringAttemptId?: string;
  seenAt: number;
  gold?: number;
  items?: (InventoryEntry | null)[];
}

export interface CharacterWork {
  marked: unknown[];
  upgrades: unknown[];
  purchases: unknown[];
  compounds: unknown[];
  autoCompounds: CompoundRule[];
  withdrawals: unknown[];
  statScrolls: NonNullable<Parameters<typeof createStatScrollCommands>[0]["statScrolls"][string]>;
  deliveries: DeliveryRequest[];
  goldTarget: number | null;
}

export interface CommandInputs {
  // The items owner's working gold and the bank visit's withdrawals for a job
  //.
  workingGold: number;
  visitWithdrawals(job: MerchantWork): unknown[];
  buyUpgradeBatchSize?: number;
  craftProtection?: CraftProtection;
  bankUpgradeRules?: BankUpgradeRule[];
  sharedAutoCompounds?: (CompoundRule & {existingTargetQuantity?: number})[];
  bankboiItems?: (InventoryEntry | null)[];
  merchant: string | null;
  activeRealm: string;
  aldataKey: string;
  threshold: number;
  gatheringModes: string[];
  cargo: unknown;
  npcSales: unknown[];
  deconstructionMarks?: unknown[];
  standListings: unknown[];
  statScrolls: Parameters<typeof createStatScrollCommands>[0]["statScrolls"];
  work(name: string | null): CharacterWork;
  restock(name: string | null): unknown;
}

export interface MerchantCommand {
  id: number;
  type: string;
  jobId?: string;
  purpose?: string | null;
  [field: string]: unknown;
}

// The `jobs.enqueue` shape: the reason names a job kind; `fields` is the work the job carries.
export interface EnqueueAsk { reason: JobReason; target: string | null | undefined; fields?: Partial<MerchantJob> & Record<string, unknown> }
export type EnqueueAnswer = 'queued' | `merged:${string}` | `refused:${string}`;

// The queue: `jobs.enqueue` merges, refuses or adds a job, and the queue's per-target blocks.
export interface MerchantJob extends PrioritizedJob {
  id: string;
  target: string | null;
  inPlaceStandSync?: boolean;
  priority?: number;
}

export interface ResourceBlock {
  upgradeRecoverySignature?: string;
  capacitySignature?: string;
  bankGold?: number;
  merchantGold?: number;
  error?: string;
}

interface QueueState {
  queue: MerchantJob[];
  current: MerchantJob | null;
  blocks: Record<string, ResourceBlock>;
}

interface QueuePorts {
  upgradeRecoverySignature?(name: string): string;
  collectionReady?(job: PrioritizedJob): boolean;
  enabled?(reason: string): boolean;
  merchant(): string | null;
  bankboi(name: string): boolean;
  capacitySignature(name: string): string;
  gold(): { bank: number; merchant: number };
  nextId(): string;
  now(): number;
  routinePriority(reason: string): number;
  priority(job: PrioritizedJob): number;
  stamp(job: MerchantJob): MerchantJob;
  hasPendingStandInventory(): boolean;
  standInventorySignature?(): string;
  persist(): void;
  dispatch(): void;
  log(message: string, level: "info", details?: unknown): void;
}

/**
 * The queue's one writer for another owner's removals (recommended (a), default, unconfirmed):
 * `revise` answers each queued job unchanged, as a changed copy, or null to drop it, so the items
 * owner's purchase, rule and compound removals keep their matching rule and the merchant job owner
 * writes the queue. It answers the number of jobs dropped.
 */
export function reviseQueuedJobs<Job>(state: { merchantQueue: Job[] }, revise: (job: Job) => Job | null): number {
  const before = state.merchantQueue.length;
  state.merchantQueue = state.merchantQueue.flatMap(job => { const next = revise(job); return next ? [next] : []; });
  return before - state.merchantQueue.length;
}

/** Owns deduplication, resource-block recovery, and priority promotion. */
export function createMerchantQueue(state: QueueState, ports: QueuePorts) {
  const migrated = mergePickupJobs(state.queue, ports.merchant(), state.current).map(job => ports.stamp(job));
  state.queue.splice(0, state.queue.length, ...migrated);
  let lastStandAttempt: string | undefined;
  let changed = false;
  function resourcesUnchanged(name: string, block: ResourceBlock): boolean {
    if (block.upgradeRecoverySignature !== undefined)
      return !ports.upgradeRecoverySignature || ports.upgradeRecoverySignature(name) === block.upgradeRecoverySignature;
    if (block.capacitySignature !== undefined)
      return ports.capacitySignature(name) === block.capacitySignature;
    const gold = ports.gold();
    return gold.bank === block.bankGold && gold.merchant === block.merchantGold;
  }

  function blocked(name: string, reason: string): boolean {
    const legacy = ["manual upgrades", "auto upgrade", "manual compounds"].includes(reason) ? name + "\nupgrades and compounds" : "";
    const key = state.blocks[name + "\n" + reason] ? name + "\n" + reason : legacy || name + "\n" + reason,
      block = state.blocks[key];
    if (!block) return false;
    if (resourcesUnchanged(name, block)) return true;
    delete state.blocks[key];
    recordMerchant({ subject: name, decision: 'unblocked', kind: reason, code: block.upgradeRecoverySignature !== undefined ? 'upgrade recovery'
      : block.capacitySignature !== undefined ? 'capacity' : 'gold', by: 'core:merchant-jobs' });
    changed = true;
    ports.log("Resources changed; retrying blocked merchant work", "info", {
      target: name,
      reason,
      previousError: block.error,
    });
    return false;
  }

  // `mergeGroup` and `separate`: the merchant's bank withdrawals are one job; a separate
  // kind merges only with itself; other work at a member is one visit.
  function sameWork(job: MerchantJob | null, name: string, reason: string): boolean {
    if (!job || job.target !== name) return false;
    if (name === ports.merchant() && bankGroup(reason) && bankGroup(job.reason)) return true;
    if (name === ports.merchant() || merchantKind(reason).separate || merchantKind(job.reason).separate) return job.reason === reason;
    return true;
  }
  const bankGroup = (reason: string) => merchantKind(reason).mergeGroup === 'bank';

  function promote(index: number, reason: string): void {
    const previous = state.queue[index];
    const higherPriority = ports.routinePriority(reason) > ports.priority(previous);
    const replacesCollection = previous.reason === "marked items" && reason !== "marked items";
    if (!higherPriority && !replacesCollection) return;
    state.queue[index] = ports.stamp({ ...previous, reason, routine: undefined });
    changed = true;
    ports.log("Raised queued merchant work for " + previous.target, "info", {
      from: previous.reason,
      to: reason,
      priority: ports.priority(state.queue[index]),
    });
  }

  // `jobs.enqueue`: the one door into the queue for every source. An ask names a job kind
  // by its reason and a target; an ask whose work the job carries (listings, an order, mail, a
  // giveaway) passes it as `fields`. A job whose work the marks hold merges by `sameWork` and is
  // refused for a switched-off routine, a threshold not met, a resource block or a Bankboi target. A
  // job that carries its work is its own job, except the pickup group, which merges per recipient
  // with the queued or running pickup. The door sends `merchant.job.queued` for each job it adds;
  // the caller persists and dispatches.
  function enqueue(ask: EnqueueAsk): EnqueueAnswer {
    const name = ask.target ? String(ask.target) : '';
    if (!name) return 'refused:no target';
    const reason = pickupReason(ask.reason, name, ports.merchant());
    return ask.fields ? carried(name, reason, ask.fields) : marked(name, reason);
  }
  function marked(name: string, reason: string): EnqueueAnswer {
    if (ports.bankboi(name)) return 'refused:bankboi';
    if (merchantKind(reason).thresholdCollection && ports.collectionReady?.({target:name,reason}) === false) return 'refused:no work';
    if (ports.enabled?.(reason) === false) return 'refused:routine off';
    if (blocked(name,reason)) return 'refused:blocked';
    if (sameWork(state.current,name,reason)) return `merged:${state.current!.id}`;
    const index = state.queue.findIndex((job) => sameWork(job, name, reason));
    if (index < 0) return add({ id: ports.nextId(), target: name, reason, queuedAt: ports.now() });
    if (name === ports.merchant() && bankGroup(reason) && state.queue[index].reason !== reason) {
      state.queue[index] = ports.stamp({...state.queue[index],reason,routine:undefined});
      changed = true;
    } else if (name !== ports.merchant()) promote(index, reason);
    return `merged:${state.queue[index].id}`;
  }
  function carried(name: string, reason: string, fields: EnqueueAsk['fields']): EnqueueAnswer {
    const job = { queuedAt: ports.now(), ...fields, id: fields?.id ?? ports.nextId(), target: name, reason } as MerchantJob;
    if (merchantKind(reason).mergeGroup !== 'pickup') return add(job);
    if (state.current?.target === name && state.current.reason === reason) return `merged:${state.current.id}`;
    const previous = state.queue.find(queued => queued.target === name && queued.reason === reason);
    if (!previous) return add(job);
    mergeTiming(previous, job);
    changed = true;
    return `merged:${previous.id}`;
  }
  function add(job: MerchantJob): EnqueueAnswer {
    const stamped = ports.stamp(job);
    state.queue.push(stamped);
    changed = true;
    recordMerchant({ subject: String(ports.merchant()), decision: 'queued', owner: 'job:' + stamped.id, kind: stamped.reason });
    return 'queued';
  }

  // A batch of marked asks of one reason, persisted and dispatched once.
  function queue(names: readonly (string | null | undefined)[], reason: JobReason = "service"): void {
    if (reason === "upgrades and compounds") { queue(names, "manual upgrades"); queue(names, "manual compounds"); return; }
    if (ports.enabled?.(reason) === false) return;
    changed = false;
    for (const name of new Set(names)) if (name) enqueue({ reason, target: name });
    if (changed) ports.persist();
    ports.dispatch();
  }

  function localStandSync(): boolean {
    const merchant = ports.merchant();
    if (!merchant || !ports.hasPendingStandInventory()) { lastStandAttempt = undefined; return false; }
    const signature = ports.standInventorySignature?.();
    if (signature !== undefined && signature === lastStandAttempt) return false;
    const duplicate = [state.current, ...state.queue].some(
      (job) =>
        job?.target === merchant && job.reason === "stand maintenance" && job.inPlaceStandSync,
    );
    if (duplicate) return false;
    lastStandAttempt = signature;
    enqueue({ reason: "stand maintenance", target: merchant, fields: { inPlaceStandSync: true, priorityOverride: 99 } });
    ports.persist();
    ports.dispatch();
    return true;
  }

  return { enqueue, queue, localStandSync };
}

// The collection facts and the pick: whether a collection is ready, the prune of a collection
// that is not, and the take of the pick's job.
export interface CollectionState extends PickupState, BankCollectionState {
  merchantCharacter: string | null;
  statuses: Record<string, (ObservedPosition & { items?: (InventoryEntry | null)[] }) | undefined>;
  marked?: Record<string, ItemMark[] | undefined>;
  merchantMarked?: Record<string, ItemMark[] | undefined>;
  itemCollectionThreshold: number;
  upgrades?: Record<string, { slot?: number | string; item?: Item; auto?: boolean; equipped?: boolean }[] | undefined>;
  autoCompounds?: Record<string, {name:string;targetTier?:number;quantity?:number}[] | undefined>;
}
export type JobPriorityState = Parameters<typeof coordinatorMerchantPriority>[0];
interface SelectionQueueState<Job extends PrioritizedJob> extends Omit<CollectionState, 'withdrawals'>, JobPriorityState {
  merchantQueue: Job[];
}

export function coordinatorCollectionSlots(
  state: CollectionState,
  name: string | null | undefined,
  reason = 'marked items',
): number {
  const {bank, keep} = collectionPickups(state, String(name), reason);
  return collectionSlotCount(state.statuses[String(name)]?.items || [], bank.concat(keep));
}

export function coordinatorCollectionNearby(
  state: CollectionState,
  name: string | null | undefined,
  now: () => number,
): boolean {
  return merchantCollectionNearby(
    state.statuses[String(state.merchantCharacter)],
    state.statuses[String(name)],
    now(),
  );
}

function exchangeCollectionReady(state: CollectionState, job: PrioritizedJob, reason: string, now: number): boolean {
  const target = state.statuses[String(job.target)];
  const picks = collectionPickups(state, String(job.target), reason).keep.filter(mark => mark.exchangeJobId === job.exchangeDeliveryId);
  return freshCollectionStatus(target, now) && collectionSlotCount(target?.items || [], picks) > 0;
}

/** A small collection may proceed only when current nearby status makes another trip unnecessary. */
export function coordinatorCollectionReady(
  state: CollectionState,
  job: PrioritizedJob,
  now: () => number,
): boolean {
  if (job.exchangePickupId) return false; // Released only by the matching confirmed handoff.
  if (!offeringCollectionReady(state, job)) return false;
  if (!offeringSupplyReady(state, job)) return false;
  if (merchantKind(job.reason).mergeGroup === 'bank') return bankCollectionReason(state) === job.reason;
  const reason = pickupReason(job.reason, job.target, state.merchantCharacter);
  if (!merchantKind(reason).thresholdCollection) return true;
  if (job.exchangeDeliveryId) return exchangeCollectionReady(state, job, reason, now());
  return markedCollectionReady(
    reason,
    state.statuses[job.target!],
    coordinatorCollectionSlots(state, job.target, reason),
    state.itemCollectionThreshold,
    coordinatorCollectionNearby(state, job.target!, now),
    now(),
  );
}

/** Item marks retain collection intent; an ineligible pickup is not a queued job. A job the pass's
 * ready facts hold waiting (a task that refuses the visit) stays queued until the hold lifts. */
export function pruneIneligibleCollections<Job extends PrioritizedJob>(
  state: SelectionQueueState<Job> & {transferSignatures?: Record<string,string>}, now: () => number, ready: Pick<ReadyFacts, 'waits'>,
): boolean {
  const retained = state.merchantQueue.filter(job => {
    if (job.exchangePickupId || job.exchangeDeliveryId || job.offeringSupply || pendingOfferingCollection(state,job)) return true; // A supply wait is durable work, not an ineligible pickup.
    if (ready.waits?.(job) || coordinatorCollectionReady(state,job,now)) return true;
    if (state.transferSignatures && job.target) delete state.transferSignatures[job.target];
    return false;
  });
  if (retained.length === state.merchantQueue.length) return false;
  state.merchantQueue = retained;
  return true;
}

/** Remove and stamp only the selected eligible job; retain other blocked work. The pick reads the
 * dispatch pass's ready facts (coordinatorReadyFacts), so it takes no job the dispatch refuses.
 * `run` is the job the merchant routine named; the ready facts still have to pass it, else the built-in
 * pick runs. */
export function takeCoordinatorMerchantJob<Job extends PrioritizedJob>(state: SelectionQueueState<Job>, facts: ReadyFacts, run?: string) {
  const priority = (job: PrioritizedJob) => coordinatorMerchantPriority(state, job);
  const named = run === undefined ? -1 : state.merchantQueue.findIndex(job => String((job as { id?: unknown }).id) === run && jobReady(job, facts));
  const index = named >= 0 ? named : selectMerchantJob(state.merchantQueue, { ...facts, priority });
  return index === null
    ? null
    : stampMerchantJob(state.merchantQueue.splice(index, 1)[0]!, priority, facts.now);
}

// The queue on the coordinator's records: its ports read the live state.
type ComposedQueueState = Parameters<typeof createMerchantQueue>[0];
type ComposedQueuePorts = Parameters<typeof createMerchantQueue>[1];
interface CoordinatorQueueState {
  upgrades?: Record<string, unknown[] | undefined>;
  merchantQueue: ComposedQueueState["queue"];
  merchantCurrent: ComposedQueueState["current"];
  merchantJobBlocks: ComposedQueueState["blocks"];
  merchantAutomations?: Record<string, boolean | undefined>;
  merchantCharacter: string | null;
  bankbois?: Record<string, unknown>;
  bankSnapshot?: { gold?: unknown } | null;
  statuses: Record<string, { gold?: unknown; items?: (InventoryEntry | null)[] }>;
  nextCommandId: number;
  standListings?: ({ state?: string; bankPack?: unknown } | null)[] | null;
}
type QueueCompositionPorts = Pick<
  ComposedQueuePorts,
  | "now"
  | "collectionReady"
  | "capacitySignature"
  | "routinePriority"
  | "priority"
  | "stamp"
  | "persist"
  | "dispatch"
  | "log"
>;

/** Compose queue policy against live coordinator collections, balances and command sequencing. */
export function createCoordinatorMerchantQueue(
  state: CoordinatorQueueState,
  ports: QueueCompositionPorts,
) {
  return createMerchantQueue(
    {
      get queue() {
        return state.merchantQueue;
      },
      get current() {
        return state.merchantCurrent;
      },
      get blocks() {
        return state.merchantJobBlocks;
      },
    },
    {
      merchant: () => state.merchantCharacter,
      collectionReady: ports.collectionReady,
      enabled: reason => routineEnabled({reason}, played(state, 'merchantAutomations') || {}),
      bankboi: (name) => !!state.bankbois?.[name],
      capacitySignature: (name) => ports.capacitySignature(name),
      upgradeRecoverySignature: (name) => upgradeRecoverySignature(state.upgrades?.[name] || [],state.statuses[String(state.merchantCharacter)]?.items || []),
      gold: () => ({
        bank: Number(state.bankSnapshot?.gold) || 0,
        merchant: Number(state.statuses[String(state.merchantCharacter)]?.gold) || 0,
      }),
      nextId: () => "merchant-" + ports.now() + "-" + state.nextCommandId++,
      now: () => ports.now(),
      routinePriority: (reason) => ports.routinePriority(reason),
      priority: (job) => ports.priority(job),
      stamp: (job) => ports.stamp(job),
      hasPendingStandInventory: () =>
        (state.standListings || []).some(
          (listing) => listing && listing.state !== "paused" && listing.state !== "live" && !listing.bankPack,
        ),
      standInventorySignature: () => standSyncSignature(state.merchantCharacter, state.standListings || [],
        state.statuses[String(state.merchantCharacter)]?.items || []),
      persist: () => ports.persist(),
      dispatch: () => ports.dispatch(),
      log: (message, level, details) => ports.log(message, level, details),
    },
  );
}

// The collection threshold: the slots a member's marks fill and whether the merchant is near.

function matchesSlot(mark: ItemMark, entry: InventoryEntry, slot: number): boolean {
  if (Number.isInteger(mark.slot) && mark.slot !== slot) return false;
  return markMatches(entry.item, markedItem(mark));
}

export function collectionSlotCount(
  entries: readonly (InventoryEntry | null)[],
  marks: readonly ItemMark[],
): number {
  const slots = new Set<number>();
  entries.forEach((entry, index) => {
    if (!entry?.item) return;
    const slot = Number.isInteger(entry.slot) ? Number(entry.slot) : index;
    if (marks.some((mark) => matchesSlot(mark, entry, slot))) slots.add(slot);
  });
  return slots.size;
}

export function freshCollectionStatus(status: ObservedPosition | undefined, now: number): boolean {
  return !!status && fresh(Number(status.seenAt || 0), now, 'presence');
}

function sameLocation(first: ObservedPosition, second: ObservedPosition): boolean {
  return (
    !!first.map &&
    !!first.server &&
    first.server === second.server &&
    samePlace(first, second)
  );
}

export function merchantCollectionNearby(
  merchant: ObservedPosition | undefined,
  target: ObservedPosition | undefined,
  now: number,
): boolean {
  if (!merchant || !target) return false;
  if (!freshCollectionStatus(merchant, now) || !freshCollectionStatus(target, now)) return false;
  if (merchant.rip || target.rip || !sameLocation(merchant, target)) return false;
  if (![merchant.x, merchant.y, target.x, target.y].every(Number.isFinite)) return false;
  return (
    Math.hypot(Number(merchant.x) - Number(target.x), Number(merchant.y) - Number(target.y)) <=
    NEARBY_RADIUS
  );
}

export function markedCollectionReady(
  reason: string,
  target: ObservedPosition | undefined,
  count: number,
  threshold: number,
  nearby: boolean,
  now: number,
): boolean {
  if (!merchantKind(reason).thresholdCollection) return true;
  if (!freshCollectionStatus(target, now)) return false;
  return count > 0 && (count >= (threshold || 1) || nearby);
}

// The pickups a collection visit takes from a member: its bank and keep marks.
export interface PickupState extends ConflictState, CraftReservationState {
  statuses?: Record<string, {items?: (InventoryEntry | null)[]} | undefined>;
  autoExchanges?: Record<string, unknown>;
  merchantAutomations?: Record<string, boolean | undefined>;
  marked?: Record<string, unknown[] | undefined>;
  merchantMarked?: Record<string, unknown[] | undefined>;
  upgrades?: Record<string, unknown[] | undefined>;
  compounds?: Record<string, unknown[] | undefined>;
  statScrolls?: Record<string, unknown[] | undefined>;
  npcSaleMarks?: {id: string; auto?: boolean; source?: string; character?: string; state?: string}[];
}
function mark(value: unknown): ItemMark {
  const record = requestObject(value);
  const item = requestObject(record.item || record) as Item;
  return {...record, ...(record.item ? {item} : {}), slot: typeof record.slot === 'number' ? record.slot : undefined};
}
function enabled(state: PickupState, routine: string) { return played(state, 'merchantAutomations')?.[routine] !== false; }
function automaticSale(state: PickupState, value: ItemMark): boolean {
  if (!value.npcSaleId) return true;
  return enabled(state, 'auto npc sales') && !itemRuleConflicts(state, markedItem(value) || {}).length && !!state.npcSaleMarks?.some(sale => sale.id === value.npcSaleId && sale.auto && sale.source === 'character' && sale.state !== 'blocked');
}
function exchangeReserved(state: PickupState, name: string, entry: InventoryEntry): boolean {
  return (state.merchantMarked?.[name] || []).some(value => { const saved = mark(value); return !!saved.exchangeJobId && saved.slot === entry.slot; });
}
function compoundReservations(state: PickupState, name: string): unknown[] {
  return (state.compounds?.[name] || []).flatMap(group => { const items = requestObject(group).items; return Array.isArray(items) ? items : []; });
}
function manuallyReserved(state: PickupState, name: string, entry: InventoryEntry): boolean {
  if (exchangeReserved(state, name, entry)) return true;
  const marks = [...(state.upgrades?.[name] || []).filter(value => !requestObject(value).auto), ...(state.statScrolls?.[name] || [])];
  marks.push(...compoundReservations(state, name));
  return marks.some(value => { const wanted = mark(value); return wanted.slot === entry.slot || markMatches(wanted.item, entry.item); });
}
function upgradeMarks(state: PickupState, name: string): ItemMark[] {
  if (!enabled(state, 'auto upgrade')) return [];
  return (state.upgrades?.[name] || []).filter(value => {
    const m = requestObject(value); return m.auto && !m.equipped && typeof m.slot === 'number';
  }).map(mark);
}
function protectedEntry(state: PickupState, name: string, entry: InventoryEntry | null): boolean {
  return !entry?.item || personalTracker(entry.item) || !!entry.item.l || !!entry.item.b || manuallyReserved(state, name, entry) || itemRuleConflicts(state, entry.item).length > 0;
}
function personalTracker(item: Item | null | undefined): boolean { return TRACKER_ITEMS.includes(String(item?.name)); }
function collectable(value: ItemMark): boolean { return !personalTracker(markedItem(value)); }
function processing(state: PickupState, name: string): ItemMark[] {
  if (name === state.merchantCharacter || !sharedMember(state, name)) return [];
  const rules = enabled(state, 'auto compound') ? state.autoCompounds?.[ruleOwner(state, name)] || [] : [];
  const upgrades = upgradeMarks(state, name);
  const stock = availableCraftStock((state.statuses?.[name]?.items || []).map((entry, index) => entry && {...entry, slot: entry.slot ?? index, craftLocation: inventoryPack(name)}), craftProtection(state));
  return stock.flatMap(entry => {
    if (protectedEntry(state, name, entry)) return [];
    const item = entry!.item!, slot = entry!.slot;
    const upgrade = upgrades.some(m => m.slot === slot && markMatches(m.item, item));
    const compound = rules.some(rule => rule.name === item.name && Number(rule.quantity) !== 0 && Number(item.level || 0) < Number(rule.targetTier || 1));
    const exchange = enabled(state, 'automatic exchange') && !!state.autoExchanges?.[exchangeKey(item.name, item.level)];
    return upgrade || compound || exchange ? [{slot, item, quantity: Number(item.q) || 1, automaticPickup: true}] : [];
  });
}
function manualSalePickups(state: PickupState, name: string) {
  const ids = new Set((state.npcSaleMarks || []).filter(sale => !sale.auto && sale.source === 'character' && sale.character === name && sale.state !== 'blocked').map(sale => sale.id));
  return {bank: [], keep: (state.merchantMarked?.[name] || []).map(mark).filter(value => collectable(value) && ids.has(String(value.npcSaleId)))};
}
/** Same selection drives counts, admission and the kept-item handoff. No processing payloads. */
export function collectionPickups(state: PickupState, name: string, reason = 'marked items') {
  if (reason === 'npc sale pickup') return manualSalePickups(state, name);
  const bank = (state.marked?.[name] || []).map(mark).filter(collectable);
  const keep = (state.merchantMarked?.[name] || []).map(mark).filter(value => collectable(value) && automaticSale(state, value) && (!value.exchangeJobId || reason === 'exchange pickup'));
  const occupied = bank.concat(keep);
  for (const pickup of processing(state, name)) {
    if (!occupied.some(value => value.slot === pickup.slot && markMatches(markedItem(value), pickup.item))) keep.push(pickup);
  }
  return {bank, keep};
}

/** A one-time exchange must own the whole selected stack, including craft stock. */
export function exchangePickup(state: PickupState, name: string, entry: InventoryEntry): ItemMark | null {
  if (protectedEntry(state, name, entry)) return null;
  const stock = availableCraftStock([{...entry, craftLocation: inventoryPack(name)}], craftProtection(state));
  const available = stock[0];
  if (!available?.item || stackQuantity(available.item) !== stackQuantity(entry.item)) return null;
  return {slot: entry.slot, item: entry.item || undefined, quantity: stackQuantity(entry.item), automaticPickup: true};
}

// The tasks owner's `allows('merchant-visit', name)` (a Hunt turn-in's return convoy refuses it)
// decides whether a member admits the merchant. A job waits while it refuses the job's target. A
// commerce order also waits while it refuses a source, until the order reaches its leveling or
// crafting phase, where the sources are already in the merchant's bag.
export function merchantVisitRefused(job: {
  target?: string | null; reason: string; order?: unknown; resumeState?: unknown;
}, allowed: ((name: string) => boolean) | undefined): boolean {
  const refused = (name: string) => allowed?.(name) === false;
  if (job.target && refused(job.target)) return true;
  if (job.reason !== 'merchant commerce') return false;
  const progress = job.resumeState as {phase?: string} | undefined;
  if (['leveling', 'crafting'].includes(progress?.phase || '')) return false;
  const order = job.order as {sources?: Record<string, unknown>} | undefined;
  return Object.keys(order?.sources || {}).some(refused);
}

// The stand sync's signature: which bag changes retrigger blocked stand work.
interface Listing { id?: string; item?: Item | null; state?: string; bankPack?: unknown; tradeSlot?: unknown; price?: number; quantity?: number }

/** Crafting, healing, and unrelated bag changes must not retrigger blocked stand work. */
export function standSyncSignature(merchant: string | null, listings: (Listing | null)[], inventory: (InventoryEntry | null)[]) {
  return JSON.stringify([merchant, listings.map(listing => {
    if (!listing) return null;
    const owned = inventory.filter(entry => markMatches(entry?.item, listing.item))
      .reduce((total, entry) => total + (Number(entry?.item?.q) || 1), 0);
    return [listing.id, listing.item, listing.state, listing.bankPack, listing.tradeSlot, listing.price, listing.quantity, owned];
  })]);
}

// A job's operation stage, as the merchant reports it or as queued work plans it.
export type MerchantOperationStage = 'retrieving' | 'processing' | 'storing';
export function operationStage(value: unknown): MerchantOperationStage | undefined {
  return value === 'retrieving' || value === 'processing' || value === 'storing' ? value : undefined;
}
/** Projection fallback for queued work; active executor reports take precedence. */
export function plannedOperationStage(reason: string, inventory: readonly (Pick<InventoryEntry, "item"> | null)[], compounds: unknown, upgrades: unknown): MerchantOperationStage | undefined {
  if (reason === 'auto npc sales') return 'processing';
  if (reason === 'auto upgrade') {
    const marks = Array.isArray(upgrades) ? upgrades.map(requestObject).filter(mark => mark.auto) : [];
    return marks.some(mark => inventory.some(entry => entry?.item && markMatches(entry.item, requestObject(mark.item)))) ? 'processing' : 'retrieving';
  }
  if (reason !== 'auto compound') return undefined;
  const rules = Array.isArray(compounds) ? compounds.map(value => {
    const rule = requestObject(value); return {name: String(rule.name), targetTier: Number(rule.targetTier) || 1, quantity: Number(rule.quantity)};
  }) : [];
  return compoundRunnable(rules, inventory) ? 'processing' : 'retrieving';
}

// The first connected, managed merchant owns logistics until you change it. Roster discovery alone
// never picks an offline merchant or a storage worker.
interface AdoptionState { merchantCharacter: string | null; bankbois?: Record<string, unknown>; headlessSlots: (string | null)[]; steamMembers: (string | null)[] }
interface AdoptionPorts { owned(name: string): unknown; write(batch: SettingsWrite): SettingsWriteResult }
export function merchantAdoption(state: AdoptionState, ports: AdoptionPorts) {
  return (body: { name: string; ctype?: string }): void => {
    if (state.merchantCharacter || body.ctype !== "merchant" || state.bankbois?.[body.name] ||
        !state.headlessSlots.includes(body.name) && !state.steamMembers.includes(body.name)) return;
    const owned = ports.owned(body.name);
    if (!owned || typeof owned !== "object" || !("type" in owned) || owned.type !== "merchant") return;
    const written = ports.write({ by: "console:merchant", changes: [{ field: "merchantCharacter", value: body.name }] });
    if (!written.ok) console.error("Adopting merchant " + body.name + " was refused: " + written.error);
  };
}

// The merchant's part of each heartbeat reply (table R's merchant section, runtime/status/coordinator/reply.ts): its bank queue place,
// gold target, gathering modes and tool crafting, Bankboi storage and the bank's staging hold.
interface HeartbeatMerchantState {
  bankbois: Record<string, unknown>; gatheringModes: string[]; merchantCharacter: MerchantEventState['merchantCharacter'];
  merchantAutomations?: Record<string, boolean | undefined>;
  merchantCurrent?: { id?: string; reason?: string } | null; merchantQueue?: readonly { id?: string; reason?: string }[];
}
// The service itinerary the merchant's reply names: the running or queued job of a visit kind (a
// collecting visit or a Merchant's Luck leg, kinds `collects` and `luck`), the next leg or a retry of
// this one. The merchant's runner keeps its between-legs hold while the reply names one and drops it
// on the first reply that names none (character/runner.ts `standReply`).
export function openItinerary(state: Pick<HeartbeatMerchantState, 'merchantCurrent' | 'merchantQueue'>): string | null {
  const leg = [state.merchantCurrent, ...(state.merchantQueue || [])].find(job => {
    const kind = job?.reason ? merchantKind(job.reason) : null;
    return !!kind && (kind.collects === true || kind.luck === true);
  });
  return leg?.id ?? null;
}
// The merchant reply's gathering fields, and the merchant's event recovery hold on its own reply; its
// bank and gold fields are the items owner's `items.reply`.
export function merchantHeartbeat(state: HeartbeatMerchantState, name: string) {
  return {
    gatheringModes: state.bankbois[name] ? [] : played(state, 'gatheringModes'),
    gatheringAutoCraft: {fishing: played(state, 'merchantAutomations')?.['craft fishing tools'] === true,
      mining: played(state, 'merchantAutomations')?.['craft mining tools'] === true},
    ...(name === state.merchantCharacter ? { merchantEventRecoveryReserved: merchantEventRecoveryReserved(state), merchantItinerary: openItinerary(state) } : {}),
  };
}
