// The dispatch pass: the holds, the ready jobs, gathering before them, the pick and the slot
// command it writes, and the same pass on the coordinator's records with the command inputs each
// kind carries. A decision reads the player's setting through `played`, so an add-on's
// overlay plays.
import { played } from '../../settings/api.ts';
import { craftProtection, localBankUpgrades, sharedCompoundRules, upgradeOfferingReady, type BankImprovementState, type ProductionState, batchMarketplaceVisits, activeStandSales, type DeconstructionMark, readyNpcSales, items, type BankboiInventory, workingGold, visitWithdrawals, goldTarget, type NativeStandState } from '../../items/coordinator/api.ts';
import { protectedSlotsOf, freeSlots, luckySlotOf, type LuckySlots, ruleOwner, hasMarkedWithdrawals } from '../../items/api.ts';
import type { InventoryEntry, ItemMark } from '../../coordinator/contracts/item.ts';
import { ADDON_STEPS, addonStepRefusal, jsonWhole, type AddonKind, pickOrder, routineEnabled, splitLegacyWork, admitAddonKinds, addonKind, kindRow, type AddonKindRow, addonReason, merchantKind, holdOf, type HoldRow, jobReady, gatheringCandidates, type HoldFacts, type ReadyFacts, mergePickupJobs, COMMERCE_PROGRESS_VERSION, VISIBILITY_RANGE, type MerchantEventState } from '../rules.ts';
import { partyHooks } from '../../hooks/index.ts';
import type { MerchantJobAsk, MerchantJobView, MerchantKindAsk, MerchantRoutineAnswer, MerchantRoutineView } from '../../hooks/registry.ts';
import { createPartyRealmCheck, normalizedRealm, type RealmRequest } from '../../merchant-realm/api.ts';
import { addonStepsCommand, ownCommandDescription, luckMerchantCommand, ownMerchantCommand, partyMerchantCommand } from './commands.ts';
import type { CaveMemberState } from '../../hunting/api.ts';
import { recordMerchant } from './records.ts';
import { fresh } from '../../protocol/reports.ts';
import type { HeartbeatStatus } from '../../status/api.ts';
import { createCoordinatorMerchantIdle } from './stand.ts';
import { merchantEventReserved } from './event-hold.ts';
import type { LadderPort } from '../../tasks/api.ts';
import { deliveryReady, deliveryMatches } from './deliveries.ts';
import { buyUpgradeOrder } from './endings.ts';
import { merchantSlotCommand, manualCommandPending, type PauseBy, pauseMerchantJob, bookMerchantLadder, type MarketListing, type MerchantWork, type ServiceStatus, type CharacterWork, type CommandInputs, type MerchantCommand, type EnqueueAsk, type EnqueueAnswer, type CollectionState, type JobPriorityState, pruneIneligibleCollections, merchantVisitRefused } from './owner.ts';

interface DispatchState {
  queue: MerchantWork[];
  current: MerchantWork | null;
}
interface AnniversaryControl {
  featured: boolean;
  reserved: boolean;
  kissDue: boolean;
  busy: boolean;
}
// `jobs.ready`: the ready jobs in the pick's order, each with the priority the pick ranks by and
// the realm it runs on, which the items owner's realm stay compares.
export interface ReadyJob { id: string; reason: string; target: string; priority: number; realm: string | null }
export interface DispatchPorts {
  // The realm a job runs on: home, its listing's realm, the member's realm or where the merchant stands.
  realmOf?(job: MerchantWork): string | null;
  eventReserved?(): boolean;
  // The facts for one pass (coordinatorReadyFacts): the routine, the target's task and the items owner's needs,
  // the capacity and the collection, which the hygiene, the capacity bank and the pick all read.
  readyFacts(): ReadyFacts;
  travel?(realm: string): Promise<unknown>;
  headless?(): boolean;
  // The realm owner refuses an automatic want for a member's realm.
  realmRefuses?(realm: string): boolean;
  // Every enabled add-on's `merchant.jobKind` and `merchant.job` answers.
  addonKinds?(): readonly { addon: string; answer: readonly MerchantKindAsk[] }[];
  addonJobs?(view: MerchantJobView): readonly { addon: string; answer: MerchantJobAsk }[];
  // The answer of the merchant's picked merchant routine entry, named by its add-on.
  routine?(view: MerchantRoutineView): { addon: string; answer: NonNullable<MerchantRoutineAnswer> } | undefined;
  // The admitted add-on kinds as the routine priorities dialog lists them, written when they change.
  addonKindsChanged?(kinds: AddonKindRow[]): void;
  // Section 4's `jobs.enqueue`: an add-on's job joins the queue through the door.
  enqueue(ask: EnqueueAsk): EnqueueAnswer;
  now(): number;
  nextCommand(): number;
  merchant(): string | null;
  returningHome(): boolean;
  ensureHome(reason: string): boolean;
  // The tasks owner's merchant-job ladder (3.6): a retry's failure is booked on it at
  // the next claim.
  ladder?: LadderPort;
  // A console update (the lifecycle owner's `blocksMerchant` through) and the party
  // realm switch.
  consoleUpdate?(): boolean;
  partySwitch?(): boolean;
  // The silence check and the prune, run once the merchant is not held by either.
  observe?(ready: ReadyFacts): void;
  bankboi(name: string | null): boolean;
  anniversary(): AnniversaryControl;
  forcedStand(): boolean;
  manualEquipmentPending(): boolean;
  // `jobs.pause` for the pause of an assigned job not yet acknowledged.
  pause(job: MerchantWork, by: PauseBy): MerchantWork | 'never';
  gatheringModes(): string[];
  // The candidate modes (gatheringReady).
  gathering(): string[];
  routinePriority(reason: string): number;
  priority(job: MerchantWork): number;
  // The pick; `run` is the job a merchant routine named, which the pick takes when it is ready.
  pick(facts: ReadyFacts, run?: string): MerchantWork | null;
  stamp(job: MerchantWork): MerchantWork;
  status(name: string | null): ServiceStatus | undefined;
  planPonty(
    listings: MarketListing[],
    quantity: number,
    server: string | undefined,
    automatic: boolean,
  ): MarketListing[] | null;
  inputs(): CommandInputs;
  // `jobs.command` with the writer's owner (3.3).
  command(owner: string, command: MerchantCommand): void;
  idle(): void;
  persist(): void;
  log(message: string, level: "info" | "error", details?: unknown): void;
}

// The ready facts on the coordinator's records: the dispatch, the pick, the stand return and the checkpoint read
// the same answer. A routine switched off, a target a Cave visit owns (the hunting owner's `cave.state`), a target
// or commerce source whose task refuses the visit (the tasks owner's `allows`) or a job the items owner's needs
// block (short of gold above the reserve, postage or free slots) keeps the job waiting.
interface ReadyState extends RealmState { merchantAutomations?: Record<string, boolean | undefined> }
export interface ReadyPorts {
  now(): number;
  visitAllowed?(name: string): boolean;
  capacityBlocked?(job: MerchantWork): boolean;
  collectionReady?(job: MerchantWork): boolean;
}
export function coordinatorReadyFacts(state: ReadyState, ports: ReadyPorts): ReadyFacts {
  return {
    now: ports.now(),
    enabled: job => !(job.target && (partyHooks().ask('cave.state', job.target) as CaveMemberState).owned) &&
      routineEnabled(job, played(state, 'merchantAutomations') || {}),
    waits: job => merchantVisitRefused(job, ports.visitAllowed) || !!partyHooks().ask('items.needs', { ...job }).blockedBy,
    capacityBlocked: job => ports.capacityBlocked?.(job as MerchantWork) ?? false,
    collectionReady: job => ports.collectionReady?.(job as MerchantWork) !== false,
    here: job => {
      const live = reportedRealm(state, state.merchantCharacter);
      return !!live && jobRealm(state, job as MerchantWork) === live;
    },
  };
}

// On the coordinator's records: the gathering modes that are candidates now, read by the
// dispatch, the checkpoint and the stand return. The cooldown is the later of the coordinator's and
// the report's. The room is the items owner's free slots past the lucky slot's hold and the
// protected free slots, the rule a collection and a transfer read; a merchant with no bag
// report has room.
interface GatheringState extends LuckySlots {
  merchantCharacter?: string | null; gatheringModes: string[]; gatheringCooldowns?: Record<string, number | undefined>;
  gatheringNoTool?: Record<string, boolean>; protectedFreeSlots?: unknown; statuses: Record<string, unknown>;
}
export function gatheringReady(state: GatheringState, now: number): string[] {
  const merchant = String(state.merchantCharacter), status = state.statuses[merchant] as { items?: unknown[];
    gatheringCooldowns?: Record<string, number | undefined> } | undefined;
  const room = !Array.isArray(status?.items) || freeSlots(status.items, luckySlotOf(state, merchant), protectedSlotsOf(state, merchant)) > 0;
  return gatheringCandidates(played(state, 'gatheringModes'), mode => Math.max(Number(state.gatheringCooldowns?.[mode]) || 0,
    Number(status?.gatheringCooldowns?.[mode]) || 0), room, now, state.gatheringNoTool ?? {});
}

/** The dispatch pass: the holds, then the pick. */
export function createMerchantDispatcher(state: DispatchState, ports: DispatchPorts) {
  const realmCheck = createPartyRealmCheck(state, ports);
  // The marked items the last capacity bank carried; the next one runs when they change.
  let capacityBanked = '';
  const merchantStatus = () => ports.status(ports.merchant()) as (ServiceStatus & { upgradeInventoryBusy?: unknown;
    gatheringCooldowns?: Record<string, number | undefined> }) | undefined;
  function merchantAlive(): boolean {
    const merchant = ports.status(ports.merchant());
    return !!merchant && !merchant.rip && fresh(merchant.seenAt, ports.now(), 'presence');
  }
  // The storage and production holds ask the items owner whether the merchant's storage or production journal holds it.
  const merchantPending = (read: 'items.storagePending' | 'items.productionPending') => {
    const merchant = ports.merchant();
    return !!merchant && partyHooks().ask(read, merchant);
  };
  const facts: HoldFacts = {
    consoleUpdate: () => !!ports.consoleUpdate?.(),
    partySwitch: () => !!ports.partySwitch?.(),
    eventReserved: () => !!ports.eventReserved?.(),
    productionPending: () => merchantPending('items.productionPending'),
    upgradeBagBusy: () => !!merchantStatus()?.upgradeInventoryBusy,
    castInFlight: () => gatheringCastActive(merchantStatus(), ports.now()),
    partyVisitMoving: () => realmCheck.advance(),
    homeMoving: () => ports.returningHome() && !ports.ensureHome("resuming merchant work"),
    merchantUnfit: () => !merchantAlive(),
    jobRunning: () => !!state.current,
    noMerchant: () => !ports.merchant(),
    manualCommand: () => ports.manualEquipmentPending(),
    storagePending: () => merchantPending('items.storagePending'),
    standFeatured: () => ports.anniversary().featured,
    anniversaryHeld: () => { const a = ports.anniversary(); return a.reserved || a.kissDue || a.busy; },
    forceStand: () => ports.forcedStand(),
  };
  // What the pass does for the holder the hold table names.
  function act(then: HoldRow['then']): void {
    if (then === 'storage') void items().startStorage().catch(error =>
      ports.log("Bankboi scheduler failed", "error", error instanceof Error ? error.message : String(error)));
    else if (then === 'stand') ports.idle();
    else if (then === 'recover') recover();
    else if (then === 'pause') pauseUnacknowledged();
  }
  // A job assigned and not yet acknowledged yields at once and keeps its id and place.
  function pauseUnacknowledged(): void {
    const job = state.current;
    if (!job || job.phase !== 'assigned' || job.heartbeatAt) return;
    const paused = ports.pause(job, 'event');
    if (paused === 'never') return;
    state.queue.push(paused);
    ports.persist();
  }
  // An idle, live merchant reconciles its production journal through the recover command
  // the items owner answers when one is due, without travelling or taking other work.
  function recover(): void {
    if (state.current || !merchantAlive()) return;
    const command = items().recover();
    if (command) ports.command('holder:4', command);
  }
  // The queue hygiene, run once the merchant can work: pickups merge per target, legacy jobs split, and a job
  // with no work, a Bankboi target, a switched-off routine or an expired giveaway leaves the queue.
  function hygiene(facts: ReadyFacts): void {
    state.queue = mergePickupJobs(state.queue, ports.merchant(), state.current).map(job => ports.stamp(job));
    state.queue = state.queue.flatMap(job => splitLegacyWork(job)).filter(hasQueuedWork).filter((job) => !ports.bankboi(job.target) &&
      (buyUpgradeOrder(job) || facts.enabled?.(job) !== false) && !(merchantKind(job.reason).expires && Number(job.expiresAt) < facts.now));
  }
  // The add-ons' kinds join the kind table for this pass, and each add-on's one proposed job
  // joins the queue when its kind is the add-on's own and the realm owner takes its listing realm. A
  // refusal and a clamp are ring entries, written when the add-ons' kinds change; an add-on with a
  // job of its own queued or running proposes none this pass.
  let kindsRead = '', kindsShown = '';
  function addonJobs(): void {
    const merchant = String(ports.merchant()), kinds = admitAddonKinds(ports.addonKinds?.() ?? []);
    const clamped = kinds.admitted.filter(kind => kind.asked !== kind.priority), read = JSON.stringify([kinds.refused, clamped]);
    if (read !== kindsRead) {
      for (const r of kinds.refused) recordMerchant({ subject: merchant, decision: 'kind-refused', owner: r.addon, kind: r.kind, code: r.reason });
      for (const kind of clamped)
        recordMerchant({ subject: merchant, decision: 'kind-clamped', owner: kind.addon, kind: kind.label, code: `${kind.asked} runs at ${kind.priority}` });
    }
    kindsRead = read;
    const rows = kinds.admitted.map(kindRow), shown = JSON.stringify(rows);
    if (shown !== kindsShown) ports.addonKindsChanged?.(rows);
    kindsShown = shown;
    const view = { merchant: ports.merchant(), current: state.current ? { id: String(state.current.id), reason: state.current.reason } : null,
      queued: state.queue.map(job => ({ id: String(job.id), reason: job.reason, target: String(job.target) })) };
    for (const { addon, answer } of ports.addonJobs?.(view) ?? []) admitAddonJob(addon, answer);
  }
  // The add-on row for one job an add-on asks: one of its own queued at a time, of a kind it
  // declared, on a listing realm the realm owner allows.
  function admitAddonJob(addon: string, answer: MerchantJobAsk): void {
    const merchant = String(ports.merchant()), reason = addonReason(addon, answer.kind), kind = addonKind(reason);
    if ([state.current, ...state.queue].some(job => job && String(job.reason).startsWith(addonReason(addon, '')))) return;
    const refusal = !kind ? `${answer.kind} is not a kind ${addon} declared`
      : kind.realm === 'listing' && (!answer.realm || ports.realmRefuses?.(normalizedRealm(answer.realm)!)) ? `the realm owner refuses ${answer.realm ?? 'no realm'}` : '';
    if (refusal) { recordMerchant({ subject: merchant, decision: 'job-refused', owner: addon, kind: reason, code: refusal }); return; }
    const carried = kind!.command === ADDON_STEPS ? addonStepsFields(answer, kind!) : { ok: answer.fields ?? {} };
    if ('refused' in carried) { recordMerchant({ subject: merchant, decision: 'job-refused', owner: addon, kind: reason, code: carried.refused }); return; }
    // A listing kind keeps the realm its answer names on the job, where jobRealm reads it.
    const realm = kind!.realm === 'listing' ? { realm: normalizedRealm(answer.realm) } : {};
    const door = ports.enqueue({ reason, target: answer.target, fields: { ...carried.ok, ...realm, id: `addon-${ports.nextCommand()}`, priorityOverride: kind!.priority } });
    if (door.startsWith('refused:')) recordMerchant({ subject: merchant, decision: 'job-refused', owner: addon, kind: reason, code: door });
  }
  // An `addon-steps` job keeps the add-on's fields and first steps under their own keys, so no
  // field of the add-on's overwrites a job field. Both must be JSON, and each first step passes the
  // step bounds the merchant applies again to every later step.
  function addonStepsFields(answer: MerchantJobAsk, kind: AddonKind): { ok: Record<string, unknown> } | { refused: string } {
    const steps: unknown = answer.steps ?? [], fields = answer.fields ?? {};
    if (!Array.isArray(steps) || !jsonWhole(steps) || !jsonWhole(fields)) return { refused: 'SV: fields and steps must be JSON' };
    for (const step of steps) {
      const refusal = addonStepRefusal(step, { spends: !!kind.spends });
      if (refusal) return { refused: refusal };
    }
    return { ok: { addonFields: fields, addonSteps: steps, ...(kind.spends ? { addonSpends: true } : {}) } };
  }
  // The merchant routine's answer for this pass. A ready job the player queued by hand runs in
  // the built-in order, so the dispatch asks the routine only while none waits.
  function routineAnswer(ready: ReadyFacts): NonNullable<MerchantRoutineAnswer> | undefined {
    const merchant = ports.merchant();
    if (!ports.routine || !merchant || state.queue.some(job => job.manual && jobReady(job, ready))) return undefined;
    const reply = ports.routine({ merchant, current: state.current ? { id: String(state.current.id), reason: state.current.reason } : null,
      queued: state.queue.map(job => ({ id: String(job.id), reason: job.reason, target: String(job.target), priority: ports.priority(job), ready: jobReady(job, ready) })) });
    if (reply && 'queue' in reply.answer) admitAddonJob(reply.addon, reply.answer.queue);
    return reply?.answer;
  }
  // `jobs.ready` in the pick's order (rules.ts pickOrder).
  function readyJobs(): ReadyJob[] {
    const facts = ports.readyFacts();
    return state.queue.filter(job => jobReady(job, facts)).sort((a, b) => pickOrder(a, b, job => ports.priority(job as MerchantWork), facts.here))
      .map(job => ({ id: String(job.id), reason: job.reason, target: String(job.target), priority: ports.priority(job),
        realm: ports.realmOf?.(job) ?? null }));
  }
  // The signature names the capacity bank in flight: with no job blocked on capacity it clears, so the
  // same marked items carried again later get their bank.
  function clearCollectionCapacity(facts: ReadyFacts): boolean {
    if (!state.queue.some(job => facts.capacityBlocked(job))) { capacityBanked = ''; return false; }
    const merchant = ports.merchant()!, marked = ports.inputs().work(merchant).marked, signature = JSON.stringify(marked);
    if (!marked.length || signature === capacityBanked) return false;
    const existing = state.queue.find(job => job.target === merchant && job.reason === "manual bank exchange");
    if (existing && !jobReady(existing, facts)) return false;
    capacityBanked = signature;
    if (existing) state.queue = state.queue.filter(job => job !== existing);
    const job = existing || ports.stamp({ id: "capacity-" + ports.nextCommand(), target: merchant, reason: "manual bank exchange", capacityRecovery: true });
    ports.log("Freeing merchant inventory for queued party cleanouts", "info");
    dispatchJob(job);
    return true;
  }
  // A gathering mode wins over the ready jobs only on a strictly higher priority.
  function gatherBefore(readyJobs: readonly MerchantWork[]): boolean {
    const modes = ports.gathering().sort((a, b) => ports.routinePriority(b) - ports.routinePriority(a));
    const best = readyJobs.length ? Math.max(...readyJobs.map((job) => ports.priority(job))) : -1;
    if (!modes.length || ports.routinePriority(modes[0]!) <= best) return false;
    if (ports.ensureHome("gathering"))
      ports.command('gather', { id: ports.nextCommand(), type: "merchant-gather", modes: ports.gatheringModes().slice() });
    return true;
  }

  function batch(job: MerchantWork): void {
    const result = batchMarketplaceVisits(job, state.queue);
    if (!result) return;
    state.queue = result.queue;
    if (!result.batchedOrders) return;
    ports.log("Combined " + result.batchedOrders + " additional marketplace order" + (result.batchedOrders === 1 ? "" : "s") +
      " for the same merchant visit", "info", { sellers: result.sellers, listings: result.listingCount });
  }

  // The report freshness: a target or merchant report older than the `presence` age puts the
  // job back.
  function targetStatus(job: MerchantWork): ServiceStatus | null {
    const target = ports.status(job.target), merchant = ports.status(ports.merchant());
    if (!target || !fresh(target.seenAt, ports.now(), 'presence') || !merchant || !fresh(merchant.seenAt, ports.now(), 'presence') ||
      (!ports.travel && normalizedRealm(merchant.server) !== normalizedRealm(target.server))) {
      state.queue.push(ports.stamp(job));
      ports.persist();
      return null;
    }
    return target;
  }

  function planPonty(job: MerchantWork): void {
    if (!merchantKind(job.reason).plansPonty || job.pontyPlanned) return;
    const quantity = job.pontyQuantity || (job.listings || []).reduce((sum, entry) => sum + Number(entry.quantity), 0);
    job.listings = ports.planPonty(job.pontyCandidates || job.listings || [], quantity, ports.status(ports.merchant())?.server, !job.manual) || job.listings;
    job.pontyPlanned = true;
  }

  function assign(job: MerchantWork, status: ServiceStatus): void {
    planPonty(job);
    const commandId = ports.nextCommand();
    if (buyUpgradeOrder(job)) {
      job.commerceProgressVersion = COMMERCE_PROGRESS_VERSION;
      job.commerceOrderId ||= job.id;
    }
    const merchant = ports.merchant(), owner = 'job:' + job.id;
    // A job a pause or a retry put back resumes: `jobs.pause` marks it `pausedBy`, a retry names
    // its `pauseReason`.
    if (job.pauseReason || job.pausedBy) recordMerchant({ subject: String(merchant), decision: 'resumed', owner, kind: job.reason });
    delete job.pauseReason; delete job.pausedBy;
    state.current = { ...job, commandId, phase: "assigned", startedAt: ports.now(), heartbeatAt: null, handoff: null };
    recordMerchant({ subject: String(merchant), decision: 'claimed', owner, kind: job.reason });
    if (merchantKind(job.reason).command === ADDON_STEPS) {
      ports.command(owner, addonStepsCommand(commandId, job));
      ports.log(ownCommandDescription(job), "info", { target: job.target });
    } else if (merchantKind(job.reason).luck && job.target === merchant) {
      ports.command(owner, luckMerchantCommand(commandId, job, status));
      ports.log("Merchant dispatched to refresh Merchant's Luck on " + job.target, "info", { target: job.target });
    } else if (job.target === merchant) {
      ports.command(owner, ownMerchantCommand(commandId, job, ports.inputs()));
      ports.log(ownCommandDescription(job), "info");
    } else {
      ports.command(owner, partyMerchantCommand(commandId, job, status, ports.inputs()));
      ports.log("Merchant dispatched to " + job.target, "info", { reason: job.reason });
    }
    ports.persist();
  }

  // The per-kind work checks: each kind reads its own saved work (3.2's kept list).
  function hasQueuedWork(job: MerchantWork): boolean {
    if (merchantKind(job.reason).mergeGroup === 'bank') return hasMarkedWithdrawals(ports.inputs().work(job.target).withdrawals);
    const work = merchantKind(job.reason).work;
    if (work === 'deliveries') return ports.inputs().work(job.target).deliveries.length > 0;
    if (work !== 'compounds') return true;
    if (ports.inputs().work(job.target).compounds.length) return true;
    ports.log("Discarded empty manual compound job", "info", {jobId: job.id, target: job.target});
    return false;
  }

  function dispatch(): void {
    bookMerchantLadder(state.current, ports.ladder);
    const ready = ports.readyFacts();
    const hold = holdOf(facts, row => {
      if (row.passes === 'observe') ports.observe?.(ready);
      else if (row.passes === 'eligibility') state.queue.forEach(realmCheck.eligibility);
      else if (row.passes === 'hygiene') hygiene(ready);
    });
    if (hold) return act(hold.then);
    if (clearCollectionCapacity(ready)) return;
    addonJobs();
    const routine = routineAnswer(ready);
    const jobs = state.queue.filter(job => jobReady(job, ready));
    if (gatherBefore(jobs)) return;
    if (!jobs.length || routine && 'idle' in routine) return ports.idle();
    const job = ports.pick(ready, routine && 'run' in routine ? routine.run : undefined);
    if (job) dispatchJob(job);
  }
  // An own job whose kind needs home waits while the realm owner brings the merchant home.
  function dispatchJob(job: MerchantWork): void {
    if (job.target === ports.merchant() && merchantKind(job.reason).realm === 'home' && !ports.ensureHome(job.reason)) {
      state.queue.push(job);
      return;
    }
    batch(job);
    const status = targetStatus(job);
    if (status && !realmCheck.begin(job, status)) assign(job, status);
  }

  return { dispatch, ready: readyJobs };
}

// The dispatch on the coordinator's records: the state it reads and the command inputs it builds.
interface DispatchCoordinatorState extends BankImprovementState, MerchantEventState, Pick<NativeStandState, 'autoStandBuys' | 'standListings'> {
  merchantAddonKinds?: AddonKindRow[];
  // The saved StandBid map (items/saved-fields.ts `standBids`). market.ts deletes a spent bid and never
  // stores undefined, so rules.ts PriorityState reads every entry as a bid.
  standBids: Record<string, NonNullable<NativeStandState['standBids'][string]>>;
  production: ProductionState;
  bankSnapshot?: { gold?: number; packs?: Record<string, (InventoryEntry | null)[] | undefined> } | null;
  merchantAutomations?: Record<string, boolean | undefined>;
  merchantQueue: MerchantWork[];
  merchantCurrent: MerchantWork | null;
  nextCommandId: number;
  merchantCharacter: string | null;
  merchantRealmRequests?: Record<string, RealmRequest | undefined>;
  bankbois?: Record<string, BankboiInventory>;
  merchantForceStand: unknown;
  commands: Record<string, MerchantCommand | undefined>;
  gatheringModes: string[];
  gatheringNoTool: Record<string, boolean>;
  gatheringCooldowns: Record<string, number | undefined>;
  statuses: Record<string, ServiceStatus | undefined>;
  activeRealm: string;
  aldata: { key: string };
  threshold: number;
  buyUpgradeBatchSize?: number;
  merchantCargo: unknown;
  deconstructionMarks?: DeconstructionMark[];
  npcSaleMarks?: Parameters<typeof readyNpcSales>[0];
  marked: Record<string, ItemMark[] | undefined>;
  upgrades: Record<string, NonNullable<CollectionState["upgrades"]>[string]>;
  purchases: Record<string, CharacterWork["purchases"] | undefined>;
  compounds: Record<string, CharacterWork["compounds"] | undefined>;
  autoCompounds: Record<string, CharacterWork["autoCompounds"] | undefined>;
  withdrawals: JobPriorityState["withdrawals"];
  statScrolls: CommandInputs["statScrolls"];
  merchantDeliveries: Record<string, CharacterWork["deliveries"] | undefined>;
  goldTargets: Record<string, number | undefined>;
  itemCollectionThreshold: number;
  merchantRoutinePriorities: Record<string, number>;
  transferSignatures?: Record<string, string>;
  // The settings owner's routine picks by character and slot; the merchant's `merchant-routine` pick
  // is the picked routine entry.
  routines?: Record<string, Record<string, string> | undefined>;
}
type DispatchCompositionPorts = Pick<
  DispatchPorts,
  | "now"
  | "travel"
  | "headless"
  | "ensureHome"
  | "returningHome"
  | "realmRefuses"
  | "enqueue"
  | "ladder"
  | "consoleUpdate"
  | "partySwitch"
  | "anniversary"
  | "routinePriority"
  | "priority"
  | "pick"
  | "stamp"
  | "planPonty"
  | "idle"
  | "persist"
  | "log"
> & Pick<ReadyPorts, 'capacityBlocked' | 'collectionReady'> & {
  // `allows('merchant-visit', name)`: the member's group task admits a visit.
  visitAllowed?: (name: string) => boolean;
  restock: CommandInputs["restock"];
  // The silence ending (the recovery's `expire`), asked at the dispatch pass.
  expire?: () => void;
};

// A bank mark rides the errand only while the items owner sends its copy to the bank, so a
// copy a job withdraws or uses (the `job input` row) stays in the bag for that job. The items
// owner's items.fate resolves which copy the mark names.
function bankMarks(state: DispatchCoordinatorState, name: string): ItemMark[] {
  return (state.marked[name] || []).filter(mark => partyHooks().ask('items.fate', name, mark)?.fate === 'bank');
}

function characterWork(state: DispatchCoordinatorState, name: string | null): CharacterWork {
  return {
    marked: bankMarks(state, String(name)),
    upgrades: (state.upgrades[String(name)] || []).filter(mark => upgradeOfferingReady(state, mark)),
    purchases: state.purchases[String(name)] || [],
    compounds: state.compounds[String(name)] || [],
    autoCompounds: state.autoCompounds[ruleOwner(state, String(name))] || [],
    withdrawals: state.withdrawals[String(name)] || [],
    statScrolls: state.statScrolls[String(name)] || [],
    deliveries: (state.merchantDeliveries[String(name)] || []).filter(mark => deliveryReady(mark) && !(state.statScrolls[String(state.merchantCharacter)] || []).some(stat => !stat.equipped && deliveryMatches(mark.item, stat.item) && deliveryMatches(stat.item, mark.item))),
    goldTarget: goldTarget(state.goldTargets, name),
  };
}

function commandInputs(state: DispatchCoordinatorState, ports: DispatchCompositionPorts): CommandInputs {
  return {
    buyUpgradeBatchSize: state.buyUpgradeBatchSize ?? 1,
    craftProtection: craftProtection(state),
    bankUpgradeRules: played(state, 'merchantAutomations')?.["auto upgrade"] === false ? [] : localBankUpgrades(state),
    sharedAutoCompounds: played(state, 'merchantAutomations')?.["auto compound"] === false ? [] : sharedCompoundRules(state).filter(rule => rule.quantity !== 0),
    bankboiItems: Object.values(state.bankbois || {}).flatMap((worker) => worker.items || []),
    merchant: state.merchantCharacter,
    activeRealm: state.activeRealm,
    aldataKey: state.aldata.key,
    threshold: state.threshold,
    gatheringModes: played(state, 'gatheringModes'),
    cargo: state.merchantCargo,
    deconstructionMarks: (state.deconstructionMarks || []).filter(mark => mark.owner === state.merchantCharacter && mark.state === "ready"),
    npcSales: readyNpcSales(state.npcSaleMarks || [], ports.now()),
    standListings: activeStandSales(state.standListings || []),
    workingGold: workingGold(state),
    visitWithdrawals: job => visitWithdrawals(state, job),
    statScrolls: state.statScrolls,
    work: (name) => characterWork(state, name),
    restock: (name) => ports.restock(name),
  };
}

// The realm a ready job runs on: a party visit on its member's realm, a listing job on its first
// unfinished listing's realm, `here` where the merchant stands, and every other kind home. A
// listing job with no listings, a giveaway or an add-on's job, runs on the realm it was queued for.
// The records the job's realm reads: the merchant, the members' reported servers and the party realm.
interface RealmState {
  merchantCharacter?: string | null;
  statuses?: Record<string, unknown>;
  activeRealm?: string | null;
}
const reportedRealm = (state: RealmState, name: unknown) => normalizedRealm((state.statuses?.[String(name)] as { server?: string } | undefined)?.server);
function jobRealm(state: RealmState, job: MerchantWork): string | null {
  const merchant = String(state.merchantCharacter), kind = merchantKind(job.reason);
  if (job.target !== merchant) return reportedRealm(state, job.target);
  if (kind.realm === 'here') return reportedRealm(state, merchant);
  if (kind.realm === 'listing') {
    const listing = (job.listings || []).find(entry => !job.completedListingKeys?.includes(String(entry.key)));
    if (listing?.serverRegion && listing.serverIdentifier) return normalizedRealm(listing.serverRegion + listing.serverIdentifier);
    if (!job.listings?.length && job.realm) return normalizedRealm(job.realm);
  }
  return normalizedRealm(state.activeRealm);
}

/** Dispatch policy receives live coordinator state; command payload arrays retain their original identity. */
export function createCoordinatorMerchantDispatcher(
  state: DispatchCoordinatorState,
  ports: DispatchCompositionPorts,
) {
  return createMerchantDispatcher(
    {
      get queue() {
        return state.merchantQueue;
      },
      set queue(value) {
        state.merchantQueue = value;
      },
      get current() {
        return state.merchantCurrent;
      },
      set current(value) {
        state.merchantCurrent = value;
      },
    },
    {
      ...ports,
      eventReserved: () => merchantEventReserved(state, ports.now()),
      readyFacts: () => coordinatorReadyFacts(state, ports),
      nextCommand: () => state.nextCommandId++,
      merchant: () => state.merchantCharacter,
      bankboi: (name) => !!state.bankbois?.[String(name)],
      forcedStand: () => !!state.merchantForceStand,
      manualEquipmentPending: () => manualCommandPending(state),
      pause: (job, by) => pauseMerchantJob(state, job, by),
      addonKinds: () => partyHooks().merchantJobs.kinds(),
      addonJobs: view => partyHooks().merchantJobs.jobs(view),
      routine: view => partyHooks().merchantJobs.routine(state.routines?.[String(state.merchantCharacter)]?.['merchant-routine'], view),
      addonKindsChanged: kinds => { state.merchantAddonKinds = kinds; ports.persist(); },
      observe: ready => {
        ports.expire?.();
        if (pruneIneligibleCollections(state, ports.now, ready)) ports.persist();
      },
      gatheringModes: () => played(state, 'gatheringModes'),
      gathering: () => gatheringReady(state, ports.now()),
      status: (name) => state.statuses[String(name)],
      realmOf: job => jobRealm(state, job),
      inputs: () => commandInputs(state, ports),
      command: (owner, command) => { merchantSlotCommand(state, owner, command); },
    },
  );
}

// A reported cast holds the merchant.
/** A cast the merchant reported in the last 10 s holds it; `cast` is the gathering holder's phase (gathering.ts). */
export function gatheringCastActive(status: {
  seenAt: number;
  gatheringPhase?: string;
} | null | undefined, now: number): boolean {
  return !!status && fresh(status.seenAt, now, 'presence') && status.gatheringPhase === "cast";
}

// The visit visibility lease: a visited member near the merchant drops its invisibility.
interface VisibilityState {
  merchantCharacter: string | null;
  merchantCurrent: { id: string; target: string | null } | null;
  commands: Record<string, MerchantCommand | undefined>;
  statuses: Record<string, HeartbeatStatus | undefined>;
}

function heartbeatLive(status: HeartbeatStatus | undefined, now: number): status is HeartbeatStatus {
  return !!status && !!status.seenAt && fresh(status.seenAt, now, 'recent') && !status.rip;
}

function visibleNearby(recipient: HeartbeatStatus, visitor: HeartbeatStatus): boolean {
  if (!recipient.server || recipient.server !== visitor.server || !recipient.map || recipient.map !== visitor.map || recipient.in !== visitor.in) return false;
  return Math.hypot(Number(recipient.x) - Number(visitor.x), Number(recipient.y) - Number(visitor.y)) <= VISIBILITY_RANGE;
}

function participant(state: VisibilityState, name: string, command: MerchantCommand | undefined): boolean {
  if (!state.merchantCurrent || command?.jobId !== state.merchantCurrent.id) return false;
  if (state.merchantCurrent.target === name) return true;
  // Commerce visits collect materials from source characters before delivery.
  const order = command.order;
  if (!order || typeof order !== 'object' || !('sources' in order)) return false;
  return !!order.sources && typeof order.sources === 'object' && Object.hasOwn(order.sources, name);
}

/** A short heartbeat lease for any active merchant visit, independent of its reason. */
export function merchantVisibility(state: VisibilityState, name: string, now: number): string | null {
  const merchant = state.merchantCharacter;
  if (!merchant || merchant === name || !participant(state, name, state.commands[merchant])) return null;
  const recipient = state.statuses[name], visitor = state.statuses[merchant];
  if (!heartbeatLive(recipient, now) || !heartbeatLive(visitor, now)) return null;
  return visibleNearby(recipient, visitor) ? merchant : null;
}

// The dispatcher and idle composition on one set of ports.
type ServiceDispatchPorts = Parameters<typeof createCoordinatorMerchantDispatcher>[1];
type ServiceIdlePorts = Parameters<typeof createCoordinatorMerchantIdle>[1];
type ServiceState = Parameters<typeof createCoordinatorMerchantDispatcher>[0] &
  Parameters<typeof createCoordinatorMerchantIdle>[0] & { steamMembers?: (string | null)[] };
type ServicePorts<State extends ServiceState> = Omit<
  ServiceDispatchPorts & ServiceIdlePorts,
  "idle" | "inventoryMerge"
> & {
  inventoryMerge: (
    state: State,
    status: Parameters<ServiceIdlePorts["inventoryMerge"]>[0],
  ) => ReturnType<ServiceIdlePorts["inventoryMerge"]>;
};

/** Dispatch and idle share storage, collection and anniversary gates and the same live command sequence. */
export function createCoordinatorMerchantServices<State extends ServiceState>(
  state: State,
  ports: ServicePorts<State>,
) {
  // A merchant outside the Steam window runs headless.
  const common = { ...ports,
    headless: () => !state.steamMembers?.includes(String(state.merchantCharacter)) };
  const dispatcher = createCoordinatorMerchantDispatcher(state, {
    ...common,
    idle: () => {
      idle.idle();
    },
  });
  const idle = createCoordinatorMerchantIdle(state, {
    ...common,
    inventoryMerge: (status) => ports.inventoryMerge(state, status),
  });
  return { dispatcher, idle };
}
