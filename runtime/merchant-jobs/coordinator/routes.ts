// The job owner's routes: the dashboard's orders and controls, the merchant's reports of a job
// (completion, handoff, progress, idle), and the merchant's settings and routine priorities. Each
// section below opens with what it answers.
import type { HttpRequest, HttpResponse } from '../../lifecycle/api.ts';
import { requestObject, requestText, isRequestObject } from '../../lifecycle/api.ts';
import { type SettingsWrite, type SettingsWriteResult, settingsDraft, type SettingsChange } from '../../settings/api.ts';
import { scopeGroups, type LadderPort } from '../../tasks/api.ts';
import { admitMerchantInterruption, attachMerchantInterruption, finishMerchantInterruption } from '../../movement/api/coordinator.ts';
import { createMerchantRealmRoutes, type RealmRequest, type MerchantRealmOwner } from '../../merchant-realm/api.ts';
import { fresh } from '../../protocol/reports.ts';
import { partyHooks } from '../../hooks/index.ts';
import { markMatches, failureClass, ruleOwner, itemRuleConflicts, aggregateSlotTracking, BASE_INVENTORY_SIZE, validLuckySlot, type LuckySlotHistory } from '../../items/api.ts';
import { createManualMarketOrderRoutes, createBankSortRoutes, type BankSortState, goldTarget, receivePlayerSales, type PlayerSaleState,
  craftProtection, offeringStock, sharedCompoundRules, writeIntents, type BankImprovementState, type CraftReservationState,
  type OfferingRulesState, receiveDeconstruction, type DeconstructionMark, type NpcSale, createStandReconciliation,
  type StandReconciliationState, createMarketplaceProgressRoutes, createMarketplaceLocationRoute } from '../../items/coordinator/api.ts';
import type { Item, InventoryEntry } from '../../coordinator/contracts/item.ts';
import { jobReady, interruptOf, routineEnabled, GATHERING_MODES, isGatheringMode, merchantKind, JOB_ENDED, MERCHANT_PAUSE_DEADLINE_MS, type MerchantEventState, type JobReason } from '../rules.ts';
import { coordinatorReadyFacts, gatheringReady } from './dispatch.ts';
import { operationStage, pauseMerchantJob, pauseCurrentJob, manualCommandHeld, manualCommandPending, merchantSlotCommand, endMerchantJob, type EnqueueAsk, type EnqueueAnswer, type MerchantWork, type MerchantCommand, collectionPickups, type PickupState, type MerchantJob } from './owner.ts';
import { currentMerchantReport, createCompletionResults, createMerchantCompletion, type CompletionState, type CompletionPorts, type CompletionReport } from './endings.ts';
import { createMerchantClusters, type ClusterState, type ClusterPorts } from './sources.ts';
import { scopeWork } from './commands.ts';
import { merchantEventReserved } from './event-hold.ts';
import { recordMerchant } from './records.ts';
import { bareRealm, typedRealm } from '../../protocol/realm.ts';

// The dashboard's orders, controls and requests on one command sequence and dispatch pipeline.
type ActionState = Parameters<typeof createManualMarketOrderRoutes>[0] &
  Parameters<typeof createMerchantControlRoutes>[0] &
  Parameters<typeof createMerchantRequestRoutes>[0] & { nextCommandId: number };
type OrderPorts = Parameters<typeof createManualMarketOrderRoutes>[1];
interface ActionPorts {
  now: () => number;
  stamp: (job: MerchantWork) => MerchantWork;
  enqueue: (ask: EnqueueAsk) => EnqueueAnswer;
  log: (message: string, level: string, details?: unknown) => void;
  persist: () => void;
  dispatch: () => void;
  plan: (...args: Parameters<OrderPorts["plan"]>) => ReturnType<OrderPorts["plan"]>;
  automations: Record<string, unknown>;
  resolveRealm: (realm: string) => unknown;
  realmLabel: (realm: string) => string;
  write: (batch: SettingsWrite) => SettingsWriteResult;
  // The realm owner: force stand's `user:force-stand` want and the dashboard Retry (3.10).
  realm: Pick<MerchantRealmOwner, 'want' | 'release' | 'retry'>;
}

/** Manual orders and controls share the coordinator's command sequence and dispatch pipeline. */
export function createCoordinatorMerchantActions(
  state: ActionState,
  ports: ActionPorts,
) {
  const shared = {
    now: ports.now,
    nextCommand: () => state.nextCommandId++,
    stamp: ports.stamp,
    enqueue: ports.enqueue,
    log: ports.log,
    persist: ports.persist,
    dispatch: ports.dispatch,
  };
  const orders = createManualMarketOrderRoutes(state, { ...shared, plan: ports.plan });
  const controls = createMerchantControlRoutes(state, {
    ...shared,
    write: ports.write,
    automated: (reason) => reason in ports.automations,
    realm: ports.realm,
    realmLabel: ports.realmLabel,
  });
  const requests = createMerchantRequestRoutes(state, {
    ...shared,
    realmExists: (realm) => !!ports.resolveRealm(realm),
  });
  return { orders, controls, requests };
}

// The cluster routes: on arrival the merchant asks which nearby members join a leader, marked-item or
// luck itinerary.
export function createMerchantClusterRoutes(state: ClusterState, ports: ClusterPorts) {
  const clusters = createMerchantClusters(state, ports);
  function leader(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      job = state.merchantCurrent;
    if (!job || body.jobId !== job.id || !job.expandLeaderCluster)
      return res.status(409).json({ error: "leader cluster job is no longer current" });
    if (job.clusterExpanded) return res.json({ ok: true, queued: job.clusterMembers || [] });
    const anchor = state.statuses[String(job.target)],
      radius = Number(job.radius) || 200;
    if (!anchor || !fresh(anchor.seenAt, ports.now(), 'presence'))
      return res.status(409).json({ error: "party leader stopped reporting online" });
    return res.json({
      ok: true,
      leader: job.target,
      radius,
      queued: clusters.leader(job, anchor, radius),
    });
  }
  function marked(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      job = state.merchantCurrent;
    if (!job || body.jobId !== job.id || job.reason !== "marked items")
      return res.status(409).json({ error: "marked-items job is no longer current" });
    if (job.clusterExpanded) return res.json({ ok: true, queued: job.clusterMembers || [] });
    const anchor = state.statuses[String(job.target)];
    if (!anchor) return res.status(409).json({ error: "collection target stopped reporting" });
    return res.json({ ok: true, queued: clusters.marked(job, anchor) });
  }
  function luck(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      job = state.merchantCurrent;
    if (!job || body.jobId !== job.id || !merchantKind(job.reason).luck)
      return res.status(409).json({ error: "merchant luck job is no longer current" });
    const radius = Number(job.radius) || 200;
    if (job.clusterExpanded)
      return res.json({
        ok: true,
        center: job.target,
        radius,
        recipients: job.clusterMembers || [],
      });
    const center = state.statuses[String(job.target)];
    if (!center || !fresh(center.seenAt, ports.now(), 'presence'))
      return res.status(409).json({ error: "luck target stopped reporting online" });
    return res.json({
      ok: true,
      center: job.target,
      radius,
      recipients: clusters.luck(job, center, radius),
    });
  }
  return { leader, marked, luck };
}

// The completion route: the merchant reports a job's end, and the ending table decides what follows.
export function createMerchantCompletionRoute(state: CompletionState, ports: CompletionPorts) {
  const completion = createMerchantCompletion(state, ports);
  function validReceipt(body: Record<string, unknown>): body is Record<string, unknown> & {target: string; deliveryId: string} {
    return body.character === state.merchantCharacter && typeof body.target === 'string' &&
      typeof body.deliveryId === 'string' && ['confirmed', 'uncertain'].includes(String(body.phase));
  }
  function receipt(body: Record<string, unknown>, res: HttpResponse): unknown {
      if (!validReceipt(body))
        return res.status(400).json({error: 'invalid delivery receipt'});
      const mark = state.merchantDeliveries[body.target]?.find(entry => entry.id === body.deliveryId);
      if (mark && !mark.awaitingEquip && body.phase !== 'confirmed') {
        mark.blocked = 'Transfer outcome uncertain';
      } else if (mark) {
        createCompletionResults(state, ports).resolve({id: 'delivery-receipt', target: body.target, reason: 'delivery'},
          {merchantDeliveriesDelivered: [{...mark}]});
      }
      ports.persist();
      return res.json({ok: true, pending: !!mark && !mark.awaitingEquip});
  }
  return function complete(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      current = state.merchantCurrent;
    if (body.deliveryReceipt === true) return receipt(body, res);
    if (!currentMerchantReport(current, body))
      return res.status(409).json({ error: "merchant job is no longer current", code: JOB_ENDED });
    completion.complete(current, body as CompletionReport);
    return res.json({ ok: true });
  };
}

// The configuration: the merchant settings, the routine priorities and the bank sort, and what a
// collection threshold change resets.
type ConfigurationSettingsPorts = Parameters<typeof createMerchantSettingsRoutes>[1];
type ConfigurationRoutinePorts = Parameters<typeof createRoutinePriorityRoute>[1];
interface ConfigurationState extends BankSortState {
  merchantCharacter: string | null;
  luckySlotLocks?: Record<string, number | null>;
  luckySlotResume?: Record<string, {slot: number; rolls: number}>;
  gatheringModes: string[];
  gatheringNoTool: Record<string, boolean>;
  merchantActivity: unknown[];
  luckySlotTracking?: import("../../items/api.ts").LuckySlotHistory;
  nextCommandId: number;
  commands: Record<string, MerchantCommand | undefined>;
  merchantCurrent: { id: string } | null;
  merchantRoutinePriorities: Record<string, number>;
  merchantAutomations: Record<string, boolean>;
  merchantQueue: Parameters<typeof createRoutinePriorityRoute>[0]["queue"];
  threshold: number;
  itemCollectionThreshold: number;
  buyUpgradeBatchSize?: number;
  transferSignatures: Record<string, unknown>;
  statuses?: Record<string, object | undefined>;
}
type ConfigurationPorts = Omit<ConfigurationSettingsPorts, "nextCommand" | "command" | "currentJob"> &
  Omit<ConfigurationRoutinePorts, "reconcile"> &
  { runtime?: (name: string) => string | undefined;
    // The items owner's automatic sales, asked again for the merchant's report when a routine or
    // a collection threshold changes.
    reconcileSales?: (status: NonNullable<ConfigurationState['statuses']>[string]) => unknown };

/** Settings views read the current collections even when reports and commands replace them; the
 *  routes write the settings through the settings writer. */
export function createCoordinatorMerchantConfiguration(
  state: ConfigurationState,
  ports: ConfigurationPorts,
) {
  const settings = createMerchantSettingsRoutes(
    {
      get merchant() {
        return state.merchantCharacter;
      },
      get luckySlotTracking() { return state.luckySlotTracking; },
      get luckySlotResume() { return state.luckySlotResume; },
      set luckySlotResume(value) { state.luckySlotResume = value; },
      get luckySlotLocks() { return state.luckySlotLocks; },
      set luckySlotLocks(value) { state.luckySlotLocks = value; },
      get modes() {
        return state.gatheringModes;
      },
      get noTool() {
        return state.gatheringNoTool;
      },
      get automations() {
        return state.merchantAutomations;
      },
      get activity() {
        return state.merchantActivity;
      },
      set activity(value) {
        state.merchantActivity = value;
      },
    },
    {
      ...ports,
      nextCommand: () => state.nextCommandId++,
      // A gather route's command goes through `jobs.command`, which refuses it during a job: the
      // pick reads the saved modes when the job ends.
      command: (name, command) => { merchantSlotCommand(state, 'gather', command, String(name)); },
      currentJob: () => state.merchantCurrent,
    },
  );
  // The routine switches for fishing and mining set the gathering modes, written in the routine
  // route's batch; after the write, a mode switched on loses its no-tool mark and the merchant gets
  // its modes.
  function gatheringChange(values: Record<string, unknown>) {
    let modes = state.gatheringModes;
    for (const mode of GATHERING_MODES) {
      const enabled = values[mode];
      if (typeof enabled !== "boolean" || modes.includes(mode) === enabled) continue;
      modes = enabled ? [...modes, mode] : modes.filter((entry) => entry !== mode);
    }
    return modes === state.gatheringModes ? null : { field: "gatheringModes", value: modes };
  }
  function gathered(values: Record<string, unknown>): void {
    for (const mode of GATHERING_MODES) if (values[mode] === true) delete state.gatheringNoTool[mode];
    merchantSlotCommand(state, 'gather', { id: state.nextCommandId++, type: "merchant-gather", modes: state.gatheringModes.slice() });
  }
  const priorities = createRoutinePriorityRoute(
    {
      get priorities() {
        return state.merchantRoutinePriorities;
      },
      get automations() {
        return state.merchantAutomations;
      },
      get queue() {
        return state.merchantQueue;
      },
      set queue(value) {
        state.merchantQueue = value;
      },
    },
    {
      ...ports,
      reconcile,
      gathering: gatheringChange,
      gathered,
    },
  );
  // A collection threshold change (the settings owner's thresholds route) forgets the transfer
  // signatures, so the next status report queues the collections the new threshold allows.
  function reconcile(): void {
    const status = state.statuses?.[String(state.merchantCharacter)];
    if (status) ports.reconcileSales?.(status);
  }
  const collectionChanged = () => {
    state.transferSignatures = {};
    reconcile();
  };
  return { settings: { ...settings, bankSort: createBankSortRoutes(state, ports) }, priorities, collectionChanged };
}

// The dashboard's controls: Retry, cancel, clear and force stand.
interface ControlState {
  merchantCharacter: string | null;
  merchantQueue: MerchantWork[];
  merchantCurrent: MerchantWork | null;
  commands: Record<string, { id?: number; type: string; mode?: null } | undefined>;
  merchantAutomations: Record<string, boolean>;
  autoExchanges: Record<string, unknown>;
  marked: Record<string, unknown[]>;
  merchantMarked: Record<string, unknown[]>;
  statScrolls: Record<string, unknown[] | undefined>;
  upgrades: Record<string, unknown[] | undefined>;
  compounds: Record<string, unknown[] | undefined>;
  autoCompounds: Record<string, unknown[] | undefined>;
  gatheringModes: unknown[];
  merchantForceStand: boolean;
  merchantRealmRequests?: Record<string, RealmRequest | undefined>;
  activeRealm: string;
}
interface ControlPorts {
  now(): number;
  nextCommand(): number;
  stamp(job: MerchantWork): MerchantWork;
  automated(reason: string): boolean;
  log(message: string, level: string, details?: unknown): void;
  persist(): void;
  dispatch(): void;
  write(batch: SettingsWrite): SettingsWriteResult;
  realm: Pick<MerchantRealmOwner, 'want' | 'release' | 'retry'>;
  realmLabel(realm: string): string;
}
// Cancelling a job switches its automation off and drops its automatic exchanges, and clearing the
// merchant's work switches gathering off: settings the request edits in its draft and writes
// through the settings writer. The queue, the marks and the commands are records, which change in
// place; the two settings come in as the draft's copies (`ControlSettings`), so no view mixes the
// two.
interface ControlSettings {
  automations: Record<string, boolean>;
  exchanges: Record<string, unknown>;
}
export function createMerchantControlRoutes(state: ControlState, ports: ControlPorts) {
  function retry(req: HttpRequest, res: HttpResponse): unknown {
    const job = state.merchantQueue.find(entry => entry.id === requestObject(req.body).id);
    if (!job) return res.status(404).json({ error: "queued merchant job not found" });
    // `realm.retry()` (3.10): the realm owner's next attempt runs now; the job runs again now.
    ports.realm.retry();
    delete job.realmBlockedReason;
    delete job.realmError;
    job.realmAttempts = 0;
    job.retryAt = 0;
    ports.persist(); ports.dispatch();
    return res.json({ ok: true });
  }
  function cancelExchange(job: MerchantWork): void {
    const deliveryId = job.exchangeDeliveryId || job.id;
    state.merchantQueue = state.merchantQueue.filter(candidate => candidate.id !== deliveryId && candidate.exchangeDeliveryId !== deliveryId);
    for (const [member, marks] of Object.entries(state.merchantMarked))
      state.merchantMarked[member] = (marks || []).filter(raw => requestObject(raw).exchangeJobId !== deliveryId);
  }
  function pendingExchange(job: MerchantWork): boolean { return !!(job.exchangeDeliveryId || job.exchangePickupId); }
  // The records a cancelled job leaves: its marks, intents and compounds, or its exchange delivery.
  function cancelRecords(state: ControlState, job: MerchantWork): void {
    const name = job.target;
    if (pendingExchange(job)) cancelExchange(job);
    else if (job.reason === "marked items") {
      state.marked[String(name)] = [];
      state.merchantMarked[String(name)] = [];
    } else if (job.reason === "manual upgrades") {
      state.statScrolls[String(name)] = [];
      writeIntents(state, String(name), marks => marks.filter(mark => (mark as {auto?: boolean})?.auto));
    } else if (job.reason === "auto upgrade") {
      writeIntents(state, String(name), marks => marks.filter(mark => !(mark as {auto?: boolean})?.auto));
    } else if (job.reason === "manual compounds") {
      state.compounds[String(name)] = [];
    } else if (["stat scrolls", "upgrades and compounds"].includes(job.reason)) {
      state.statScrolls[String(name)] = [];
      writeIntents(state, String(name), () => []);
      state.compounds[String(name)] = [];
    } else if (job.reason === "auto compound") {
      state.autoCompounds[String(name)] = [];
    }
  }
  // The settings a cancelled job switches: its automation goes off and its automatic exchanges go.
  // An exchange delivery switches none.
  function cancelAutomation(settings: ControlSettings, job: MerchantWork): void {
    if (pendingExchange(job)) return;
    if (job.reason === "exchange" && Array.isArray(job.autoExchangeKeys)) {
      for (const key of job.autoExchangeKeys) delete settings.exchanges[key];
      settings.automations['automatic exchange'] = false;
    } else if (ports.automated(job.reason)) settings.automations[job.reason] = false;
  }
  function cancel(req: HttpRequest, res: HttpResponse): unknown {
    const id = requestText(requestObject(req.body).id || ""),
      index = state.merchantQueue.findIndex((job) => job.id === id);
    if (index < 0) return res.status(404).json({ error: "queued merchant job not found" });
    // The write goes first, so a refused write leaves the job, its marks and its intents.
    const draft = settingsDraft(state), job = state.merchantQueue[index]!;
    cancelAutomation({ automations: draft.edit('merchantAutomations'), exchanges: draft.edit('autoExchanges') }, job);
    const written = ports.write({ by: "dashboard:merchant-job-cancel", changes: draft.changes() });
    if (!written.ok) return res.status(400).json({ error: written.error });
    state.merchantQueue = state.merchantQueue.filter(entry => entry !== job);
    cancelRecords(state, job);
    ports.log("Cancelled queued merchant job", "info", { reason: job.reason, target: job.target });
    ports.persist();
    return res.json({ ok: true });
  }
  function clear(_req: HttpRequest, res: HttpResponse): unknown {
    const written = ports.write({ by: "dashboard:merchant-clear", changes: [{ field: "gatheringModes", value: [] }] });
    if (!written.ok) return res.status(400).json({ error: written.error });
    if (state.merchantCurrent) endMerchantJob(state, state.merchantCurrent, { decision: 'ended', code: 'cleared' });
    // A manual command the end released keeps the slot until its report replaces it.
    if (!manualCommandPending(state)) merchantSlotCommand(state, 'gather', { id: ports.nextCommand(), type: "merchant-gather", mode: null });
    for (const [member, marks] of Object.entries(state.merchantMarked))
      state.merchantMarked[member] = (marks || []).filter(raw => !requestObject(raw).exchangeJobId);
    state.merchantQueue = [];
    ports.log("Merchant work and gathering cleared", "info");
    ports.persist();
    return res.json({ ok: true });
  }
  function force(req: HttpRequest, res: HttpResponse): unknown {
    const enabled = requestObject(req.body).enabled === true,
      merchant = state.merchantCharacter;
    if (!merchant) return res.status(409).json({ error: "configure a merchant first" });
    const written = ports.write({ by: "dashboard:force-stand", changes: [{ field: "merchantForceStand", value: enabled }] });
    if (!written.ok) return res.status(400).json({ error: written.error });
    // The force stand pause by `merchant.pause`.
    if (enabled && !pauseCurrentJob(state, 'user', ports.now, ports.stamp)) ports.log("Force stand enabled; the ALData sale finishes first", "warning");
    else if (enabled) {
      merchantSlotCommand(state, 'holder:2', null);
      ports.log("Force stand enabled; all merchant work is paused", "warning");
      // Your hold's want: the first attempt runs at once for a Steam merchant too.
      if (ports.realm.want('user:force-stand', state.activeRealm, { manual: true }) === 'moving')
        ports.log("Force stand returning " + merchant + " to " + ports.realmLabel(state.activeRealm), "info");
    } else {
      if (state.commands[merchant]?.type === "merchant-idle") merchantSlotCommand(state, 'holder:2', null);
      ports.realm.release('user:force-stand');
      ports.log("Force stand disabled; merchant work may resume", "info");
      ports.dispatch();
    }
    ports.persist();
    return res.json({ ok: true, enabled: state.merchantForceStand });
  }
  return { cancel, clear, force, retry };
}

// The handoff routes: the merchant's handoff with a member and its completion, the cleanout and an
// order's material handoff.
interface HandoffJob extends MerchantWork {
  order?: { sources: Record<string, unknown> };
  handoff?: unknown;
  orderHandoff?: unknown;
}
interface HandoffState extends PickupState {
  npcSaleMarks?: NpcSale[];
  deconstructionMarks?: DeconstructionMark[];
  merchantCharacter: string | null;
  merchantCurrent: HandoffJob | null;
  merchantQueue?: HandoffJob[];
  activeConvoy?: { nonPreemptible?: boolean; participants: string[] } | null;
  commands: Record<
    string,
    { id: number; type: string; jobId?: unknown; [field: string]: unknown } | undefined
  >;
  marked: Record<string, unknown[] | undefined>;
  merchantMarked: Record<string, unknown[] | undefined>;
  autoItemMarks: Record<string, Record<string, unknown> | undefined>;
  upgrades: Record<string, unknown[] | undefined>;
  compounds: Record<string, unknown[] | undefined>;
  statScrolls: Record<string, unknown[] | undefined>;
  autoCompounds: NonNullable<PickupState["autoCompounds"]>;
  threshold: unknown;
  goldTargets: Record<string, number | undefined>;
}
interface HandoffPorts {
  now?(): number;
  nextCommand(): number;
  persist(): void;
  owned(name: string): unknown;
  queue(names: string[], reason: JobReason): void;
  log(message: string, level: string): void;
  // The tasks owner's `allows('merchant-visit', name)`: a member a Hunt return holds admits no handoff.
  visitAllowed(name: string): boolean;
  // The lifecycle owner's roster: the member's worker is offline or failed.
  offline(name: string): boolean;
}

// A handoff member that cannot answer ends the merchant's wait with the cause: the lifecycle owner's
// roster answers it offline or failed, or its own report says it is dead. A present, living member
// whose pause is still landing keeps the wait, judged by its own answer. The member's report is read
// for its rip field only, which each state's status type may leave out.
function handoffRefusal(name: string, offline: (name: string) => boolean, status: object | null | undefined): string | null {
  if (offline(name)) return name + " is offline";
  if (status && "rip" in status && status.rip === true) return name + " is dead";
  return null;
}

export function createMerchantHandoffRoutes(state: HandoffState, ports: HandoffPorts) {
  function current(body: Record<string, unknown>, name: unknown): HandoffJob | null {
    const job = state.merchantCurrent;
    return job && body.jobId === job.id && name === job.target ? job : null;
  }
  function waiting(name: string, jobId: unknown, res: HttpResponse): unknown {
    if (admitMerchantInterruption(state, name, jobId, ports.now?.() ?? Date.now(), MERCHANT_PAUSE_DEADLINE_MS)) return null;
    ports.persist();
    // The merchant asks again on its own interval (visits.ts PAUSE_ASK_MS).
    return res.json({ ok: true, waiting: true, reason: "Waiting for convoy to pause for merchant collection" });
  }
  function alreadyIssued(name: string, jobId: unknown, type: string): boolean {
    const command = state.commands[name];
    return command?.type === type && command.jobId === jobId;
  }
  function clearCommand(name: string, body: Record<string, unknown>, type: string): void {
    const command = state.commands[name];
    if (
      command?.type === type &&
      command.jobId === body.jobId &&
      (!body.commandId || command.id === body.commandId)
    )
      {
        finishMerchantInterruption(state, name, command.id);
        merchantSlotCommand(state, 'job:' + String(body.jobId), null, name);
      }
  }
  function scopeHandoff(name: string, job: HandoffJob, command: NonNullable<HandoffState["commands"][string]>) {
    const scoped = scopeWork(job, command);
    const collection = !!merchantKind(job.reason).collects;
    if (!collection) scoped.marked = [];
    if (merchantKind(job.reason).salePickup) {
      scoped.merchantMarked = (state.npcSaleMarks || []).filter(mark => mark.character === name && mark.source === 'character' && Boolean(mark.auto) === (job.reason === 'auto npc sale pickup')).map(mark => ({slot: mark.slot, item: mark.item}));
    } else if (!collection && job.reason !== 'deconstruction pickup') scoped.merchantMarked = [];
    if (collection) {
      const pickups = collectionPickups(state, name, job.reason);
      scoped.marked = job.exchangeDeliveryId ? [] : pickups.bank;
      scoped.merchantMarked = job.exchangeDeliveryId ? pickups.keep.filter(mark => mark.exchangeJobId === job.exchangeDeliveryId) : pickups.keep;
      scoped.craftProtection = craftProtection(state);
    }
    return scoped;
  }
  function handoffCommand(name: string, body: Record<string, unknown>, job: HandoffJob) {
    const command: NonNullable<HandoffState["commands"][string]> = {
      id: ports.nextCommand(),
      type: "merchant-handoff",
      jobId: body.jobId,
      merchant: state.merchantCharacter,
      autoItemMarks: state.merchantRules ? {} : state.autoItemMarks[ruleOwner(state, name)] || {},
      cleanout: job.reason === "inventory cleanout",
      threshold: state.threshold,
      goldTarget: goldTarget(state.goldTargets, name),
      capacity:
        typeof body.capacity === "number" && Number.isSafeInteger(body.capacity)
          ? Math.max(0, body.capacity)
          : 0,
    };
    for (const key of [
      "marked",
      "merchantMarked",
      "upgrades",
      "compounds",
      "statScrolls",
      "autoCompounds",
    ] as const)
      command[key] = state[key][key === "autoCompounds" ? ruleOwner(state, name) : name] || [];
    return scopeHandoff(name, job, command);
  }

  function handoff(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      job = current(body, body.target),
      name = requestText(body.target);
    if (!job) return res.status(409).json({ error: "merchant job is no longer current", code: JOB_ENDED });
    if (!ports.visitAllowed(name))
      return res.json({ deferred: true, reason: "hunt_movement_owned" });
    const refused = handoffRefusal(name, ports.offline, state.statuses?.[name]);
    if (refused) return res.json({ refused: true, reason: refused });
    if (alreadyIssued(name, body.jobId, "merchant-handoff")) return res.json({ ok: true });
    const deferred = waiting(name, body.jobId, res);
    if (deferred) return deferred;
    job.phase = "handoff";
    job.handoff = null;
    merchantSlotCommand(state, 'job:' + job.id, handoffCommand(name, body, job), name);
    attachMerchantInterruption(state, name, state.commands[name]!);
    ports.persist();
    return res.json({ ok: true });
  }
  function exchangeReceived(delivery: HandoffJob, deliveryId: unknown, kept: unknown): boolean {
    if (!Array.isArray(kept)) return false;
    return kept.some(raw => {
      const entry = requestObject(raw);
      return entry.exchangeJobId === deliveryId && markMatches(requestObject(entry.item), requestObject(delivery.exchangePickupItem)) && Number(entry.quantity) >= Number(delivery.exchangePickupQuantity);
    });
  }
  function receiveExchange(job: HandoffJob, name: string, body: Record<string, unknown>): void {
    const delivery = state.merchantQueue?.find(candidate => candidate.id === job.exchangeDeliveryId && candidate.exchangePickupId === job.id);
    if (delivery) {
      if (exchangeReceived(delivery, job.exchangeDeliveryId, body.kept)) { delete delivery.exchangePickupId; delete delivery.pauseReason; }
      else delivery.pauseReason = 'Waiting for the complete confirmed exchange pickup';
    }
    state.merchantMarked[name] = (state.merchantMarked[name] || []).filter(raw => requestObject(raw).exchangeJobId !== job.exchangeDeliveryId);
  }
  function complete(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      job = current(body, body.character),
      name = requestText(body.character);
    if (!job) return res.json({ ok: true, stale: true });
    receiveDeconstruction({ deconstructionMarks: state.deconstructionMarks || [], merchantCharacter: state.merchantCharacter, merchantMarked: state.merchantMarked as import("../../items/coordinator/api.ts").DeconstructionState["merchantMarked"] }, name, body.kept, ports.now?.() ?? Date.now());
    receivePlayerSales({ npcSaleMarks: state.npcSaleMarks || [], merchantMarked: state.merchantMarked as PlayerSaleState["merchantMarked"] }, name, body.kept, ports.now?.() ?? Date.now());
    if (job.exchangeDeliveryId) receiveExchange(job, name, body);
    job.handoff = body;
    job.phase = "processing";
    clearCommand(name, body, "merchant-handoff");
    ports.persist();
    return res.json({ ok: true });
  }
  function cleanout(req: HttpRequest, res: HttpResponse): unknown {
    const name = requestText(requestObject(req.body).character);
    if (!ports.owned(name) || name === state.merchantCharacter)
      return res.status(400).json({ error: "unknown cleanout character" });
    if ([state.merchantCurrent, ...(state.merchantQueue || [])].some(job => job?.target === name &&
      merchantKind(job.reason).mergeGroup === 'pickup')) return res.json({ok: true, alreadyQueued: true});
    ports.queue([name], "inventory cleanout");
    ports.log("Inventory cleanout queued for " + name, "info");
    return res.json({ ok: true });
  }
  function order(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      job = state.merchantCurrent,
      name = requestText(body.target);
    if (
      !job ||
      job.id !== body.jobId ||
      job.reason !== "merchant commerce" ||
      !body.target ||
      !job.order?.sources[name]
    )
      return res.status(409).json({ error: "merchant commerce job is no longer current" });
    if (!ports.visitAllowed(name))
      return res.json({ deferred: true, reason: "hunt_movement_owned" });
    if (alreadyIssued(name, body.jobId, "merchant-order-handoff")) return res.json({ ok: true });
    const deferred = waiting(name, body.jobId, res);
    if (deferred) return deferred;
    merchantSlotCommand(state, 'job:' + job.id, { id: ports.nextCommand(), type: "merchant-order-handoff", jobId: body.jobId,
      merchant: state.merchantCharacter, items: job.order.sources[name] }, name);
    attachMerchantInterruption(state, name, state.commands[name]!);
    job.orderHandoff = null;
    job.phase = "collecting materials from " + name;
    ports.persist();
    return res.json({ ok: true });
  }
  function orderComplete(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      job = state.merchantCurrent;
    if (!job || job.id !== body.jobId)
      return res.json({ ok: true, stale: true });
    job.orderHandoff = { character: body.character, sent: body.sent || [] };
    clearCommand(requestText(body.character), body, "merchant-order-handoff");
    ports.persist();
    return res.json({ ok: true });
  }
  return { handoff, complete, cleanout, order, orderComplete };
}

// The idle route: the merchant reports its stand return.
interface IdleState extends StandReconciliationState {
  commands: Record<string, { id?: unknown; type: string } | undefined>;
}
interface IdlePorts {
  sameItem(first: Item, second: Item | null | undefined): boolean;
  log(message: string, level: string, details?: unknown): void;
  persist(): void;
  queue(names: (string | null)[], reason: JobReason): void;
}
function failureMessage(body: Record<string, unknown>, interrupted: boolean): string {
  if (interrupted) return "Stand return interrupted; retrying";
  return body.stage === "stand" ? "Could not update stand" : "Could not return to stand";
}
export function createMerchantIdleRoute(state: IdleState, ports: IdlePorts) {
  const stand = createStandReconciliation(state, ports);
  function clearIdle(commandId?: unknown): void {
    const command = state.commands[String(state.merchantCharacter)];
    if (command?.type === "merchant-idle" && (!commandId || command.id === commandId))
      merchantSlotCommand(state, 'idle', null);
  }
  function complete(body: Record<string, unknown>): void {
    const live = new Map<string, unknown>();
    for (const raw of Array.isArray(body.liveListings) ? body.liveListings : []) {
      const entry = requestObject(raw);
      if (typeof entry.id === "string") live.set(entry.id, entry.tradeSlot);
    }
    stand.reconcile(
      live,
      (Array.isArray(body.inventory) ? body.inventory : []) as (InventoryEntry | null)[],
    );
    const needsWithdrawal = stand.withdrawals();
    clearIdle(body.commandId);
    if (needsWithdrawal) ports.queue([state.merchantCharacter], "manual bank exchange");
  }
  function phase(body: Record<string, unknown>): boolean {
    if (body.phase === "returning") ports.log("Returning to stand", "info");
    else if (body.phase === "arrived") ports.log("At stand", "info");
    else if (body.phase === "no-stand") {
      ports.log("At the market with no stand to open", "info");
      clearIdle(body.commandId);
    }
    else if (body.phase === "inventory-recovery") {
      ports.log("Inventory recovery required", "error", body.error);
      clearIdle(body.commandId);
    }
    else if (body.phase === "failed") {
      const interrupted = failureClass(body.code) === "interrupted";
      ports.log(
        failureMessage(body, interrupted),
        interrupted ? "info" : "error",
        body.error,
      );
      clearIdle();
      if (body.code === "inventory_full") ports.queue([state.merchantCharacter], "manual bank exchange");
    } else if (body.phase === "complete") complete(body);
    else return false;
    return true;
  }
  return function idle(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      merchant = state.merchantCharacter;
    if (!merchant || body.character !== merchant)
      return res.status(409).json({ error: "merchant is no longer configured" });
    const command = state.commands[merchant];
    if (body.commandId && command && command.id !== body.commandId)
      return res.status(409).json({ error: "merchant idle command is no longer current" });
    if (!phase(body)) return res.status(400).json({ error: "invalid idle phase" });
    ports.persist();
    return res.json({ ok: true });
  };
}

// The progress routes: the running job's progress report, its heartbeat and its checkpoint.
interface ProgressState extends CraftReservationState, PickupState, OfferingRulesState, MerchantEventState {
  autoCompounds?: BankImprovementState['autoCompounds'];
  merchantRules?: BankImprovementState['merchantRules'];
  merchantAutomations?: Record<string, boolean | undefined>;
  merchantCharacter: string | null;
  merchantCurrent: MerchantWork | null;
  merchantQueue: MerchantWork[];
  statuses: NonNullable<PickupState['statuses']> & MerchantEventState['statuses'];
  gatheringModes: string[];
  gatheringNoTool: Record<string, boolean>;
  gatheringCooldowns: Record<string, number | undefined>;
  commands: Record<string, unknown>;
}
interface ProgressPorts {
  now(): number;
  // The lifecycle owner's roster: the member's worker is offline or failed.
  offline(name: string): boolean;
  visitAllowed?(name: string): boolean;
  // The tasks owner's merchant-job ladder: a checkpoint is progress (3.6).
  ladder?: LadderPort;
  anniversaryReserved?(): boolean;
  capacityBlocked?(job: MerchantWork): boolean;
  collectionReady?(job: MerchantWork): boolean;
  priority(job: MerchantWork): number;
  routinePriority(mode: string): number;
  persist(): void;
  stamp(job: MerchantWork): MerchantWork;
  log(message: string, level: string, details: unknown): void;
  dispatch(): void;
}

export function createMerchantProgressRoutes(state: ProgressState, ports: ProgressPorts) {
  function nextTarget(job: MerchantWork): string | null {
    const next = job.batchId
      ? state.merchantQueue.find((candidate) => candidate.batchId === job.batchId) || null
      : state.merchantQueue[0] || null;
    return next && (job.batchId ? next.batchId === job.batchId : next.reason === job.reason)
      ? next.target
      : null;
  }
  function job(req: HttpRequest, res: HttpResponse): unknown {
    const current = state.merchantCurrent;
    if (!current || req.params.id !== current.id)
      return res.status(404).json({ error: "merchant job not found" });
    const target = typeof req.query?.target === "string" ? req.query.target : current.target;
    // (#43): a handoff's pre-send recheck names its copy's slot and reads that copy's fate.
    const slot = Number(req.query?.slot);
    // The items owner's: a material handoff is pending while its source holds this job's handoff
    // command and its report is current; the merchant waits on that, with no deadline.
    const command = requestObject(state.commands[String(target)]), status = state.statuses[String(target)];
    const handoffPending = command.type === "merchant-order-handoff" && command.jobId === current.id &&
      !!status && fresh(Number(status.seenAt), ports.now(), "presence");
    return res.json({
      ...current,
      handoffPending,
      targetStatus: status || null,
      handoffRefused: current.handoff ? null : handoffRefusal(String(target), ports.offline, status),
      nextCollectionTarget: nextTarget(current),
      craftProtection: craftProtection(state),
      ...(Number.isSafeInteger(slot) ? {fates: {[slot]: partyHooks().ask('items.fate', String(target), slot)}} : {}),
      ...(merchantKind(current.reason).collects ? {collectionPickups: collectionPickups(state, String(target), current.reason)} : {}),
    });
  }
  function heartbeat(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      current = state.merchantCurrent;
    if (!currentMerchantReport(current, body))
      return res.status(409).json({ error: "merchant job is no longer current", code: JOB_ENDED });
    current.heartbeatAt = ports.now();
    const stage = operationStage(body.operationStage);
    if (stage && current.target === state.merchantCharacter) current.operationStage = stage;
    if (current.phase === "assigned") current.phase = "processing";
    return res.json({ ok: true });
  }
  // The interrupts read the pick: the waiting work is what the dispatch would run next.
  function priorities(current: MerchantWork) {
    const currentPriority = ports.priority(current), facts = coordinatorReadyFacts(state, ports),
      queuedPriority = state.merchantQueue.filter(job => jobReady(job, facts)).reduce(
        (highest, job) => Math.max(highest, ports.priority(job)),
        -1,
      );
    const gatheringPriority = gatheringReady(state, ports.now()).reduce(
      (highest, mode) => Math.max(highest, ports.routinePriority(mode)),
      -1,
    );
    return {
      currentPriority,
      waitingPriority: Math.max(queuedPriority, gatheringPriority),
      waitingType: gatheringPriority > queuedPriority ? "gathering" : "queue",
    };
  }
  // The checkpoint pause (3.4): the job keeps its id and place in line.
  function pause(current: MerchantWork, currentPriority: number, waitingPriority: number): void {
    const paused = pauseMerchantJob(state, current, 'checkpoint') as MerchantWork;
    paused.queuedAt = Number(current.queuedAt) || ports.now();
    paused.pauseReason = 'Waiting for higher-priority work or event';
    state.merchantQueue.push(ports.stamp(paused));
    ports.log("Paused " + paused.reason + " for a higher-priority routine", "info", {
      priority: currentPriority,
      waitingPriority,
    });
    ports.persist();
    ports.dispatch();
  }
  function checkpoint(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      current = state.merchantCurrent;
    if (!currentMerchantReport(current, body))
      return res.status(409).json({ error: "merchant job is no longer current", code: JOB_ENDED });
    if (body.protectionOnly === true) {
      if (current.itemMarksCleared) return res.status(409).json({ error: "Item marks cleared; refresh merchant work" });
      return res.json(protectionReply(state));
    }
    return checkpointWork(current, body, res);
  }
  function reserved(): boolean {
    return merchantEventReserved(state, ports.now()) || ports.anniversaryReserved?.() === true;
  }
  function saveProgress(current: MerchantWork, body: Record<string, unknown>): void {
    if (body.eventOnly !== true)
      current.resumeState = body.state && typeof body.state === "object" ? body.state : {};
    if (body.movementSucceeded === true) current.movementRetryCount = 0;
  }
  function checkpointWork(current: MerchantWork, body: Record<string, unknown>, res: HttpResponse): unknown {
    const eventReserved = reserved();
    if (body.eventOnly === true && !eventReserved) return res.json({ yield: false });
    saveProgress(current, body);
    // The checkpoint is answered in this request: the job goes on as `processing` or yields to the
    // queue, so no job is left waiting on a checkpoint.
    ports.ladder?.progress();
    const { currentPriority, waitingPriority, waitingType } = priorities(current);
    const interrupt = interruptOf({ cycleBoundary: body.cycleBoundary !== false, reserved: eventReserved, kind: merchantKind(current.reason),
      manualHeld: manualCommandHeld(state), currentPriority, waitingPriority });
    if (!interrupt?.yields) {
      current.phase = "processing";
      ports.persist();
      return res.json({ yield: false, currentPriority, waitingPriority, waitingType });
    }
    pause(current, currentPriority, waitingPriority);
    return res.json({ yield: true, currentPriority, waitingPriority });
  }
  return { job, heartbeat, checkpoint };
}

function protectionReply(state: ProgressState) {
  const compoundState = {...state, autoCompounds: state.autoCompounds || {}};
  const compoundRules = state.merchantAutomations?.['auto compound'] === false ? [] : sharedCompoundRules(compoundState)
    .filter(rule => Number(rule.quantity) !== 0);
  const compoundBlocked = compoundRules.flatMap(rule => Array.from({length: rule.targetTier || 1}, (_, level) => ({name:rule.name,level})))
    .filter(item => itemRuleConflicts(compoundState,item).length);
  return {craftProtection: craftProtection(state), compoundRules, compoundBlocked,
    upgradeOfferingRules: state.upgradeOfferingRules || [], upgradeOfferingStock: offeringStock(state)};
}

// The dashboard's requests that queue a job: a donation, a giveaway search and a stand search.
interface RequestState {
  merchantCharacter: string | null;
  merchantQueue: MerchantWork[];
  statuses: Record<string, { donationXpPerGold?: unknown } | undefined>;
  merchantCatalog?: { allItems?: { id: string }[] } | null;
  standSearch: unknown;
}
interface RequestPorts {
  now(): number;
  nextCommand(): number;
  enqueue(ask: EnqueueAsk): EnqueueAnswer;
  realmExists(realm: string): boolean;
  log(message: string, level: string): void;
  persist(): void;
  dispatch(): void;
}

export function createMerchantRequestRoutes(state: RequestState, ports: RequestPorts) {
  function job(reason: JobReason, fields: Omit<Partial<MerchantWork>, "reason">): MerchantWork & { reason: JobReason } {
    return {
      id: "merchant-" + ports.now() + "-" + ports.nextCommand(),
      target: state.merchantCharacter,
      reason,
      ...fields,
      queuedAt: ports.now(),
    };
  }
  function queue(work: MerchantWork & { reason: JobReason }, message: string): void {
    ports.enqueue({ reason: work.reason, target: work.target, fields: work });
    ports.log(message, "info");
    ports.persist();
    ports.dispatch();
  }
  function donate(req: HttpRequest, res: HttpResponse): unknown {
    const amount = Number(requestObject(req.body).amount),
      merchant = state.merchantCharacter;
    if (!merchant) return res.status(409).json({ error: "configure a merchant first" });
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1000000000000)
      return res.status(400).json({ error: "enter a positive whole-number donation" });
    const work = job("merchant donation", { amount });
    queue(work, "Queued " + amount.toLocaleString() + " gold donation");
    // The XP answer reads only the merchant's reported rate (the items owner's
    // donationXpPerGold), as the dashboard's preview does (the status owner's play change 2,
    // part 10).
    const rate = Number(state.statuses[merchant]?.donationXpPerGold);
    return res.json({ ok: true, jobId: work.id, amount, ...(rate > 0 ? { xp: Math.floor(amount * rate), rate } : {}) });
  }
  function giveaway(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body);
    if (!state.merchantCharacter)
      return res.status(409).json({ error: "configure a merchant first" });
    const seller = typeof body.seller === "string" ? body.seller.trim() : "",
      realm = typedRealm(body.realm);
    if (!seller || seller.length > 40)
      return res.status(400).json({ error: "enter a merchant name" });
    if (!realm || !ports.realmExists(realm))
      return res.status(400).json({ error: "enter a valid realm, such as US I or EU II" });
    const work = job("join giveaway", { seller, realm });
    queue(
      work,
      "Queued giveaway search for " + seller + " on " + bareRealm(realm),
    );
    return res.json({ ok: true, jobId: work.id });
  }
  function search(req: HttpRequest, res: HttpResponse): unknown {
    const itemId = requestObject(req.body).itemId;
    if (!state.merchantCharacter)
      return res.status(409).json({ error: "configure a merchant first" });
    if (
      typeof itemId !== "string" ||
      !(state.merchantCatalog?.allItems || []).some((item) => item.id === itemId)
    )
      return res.status(400).json({ error: "select a valid item" });
    const work = job("stand search", { itemId });
    state.standSearch = { status: "searching", itemId, listings: [], error: null };
    queue(work, "Queued player-stand search for " + itemId);
    return res.json({ ok: true, jobId: work.id });
  }
  return { donate, giveaway, search };
}

// The merchant settings routes: the merchant, the lucky slot lock, the gathering switches, the
// no-tool record and the activity log.
interface SettingsState {
  merchant: string | null;
  luckySlotLocks?: Record<string, number | null>;
  luckySlotResume?: Record<string, {slot: number; rolls: number}>;
  modes: string[];
  noTool: Record<string, boolean>;
  automations?: Record<string, boolean>;
  activity: unknown[];
  luckySlotTracking?: LuckySlotHistory;
}
interface SettingsPorts {
  ownedType(name: string): string | undefined;
  persist(): void;
  dispatch(): void;
  nextCommand(): number;
  command(name: string | null, command: MerchantCommand): void;
  currentJob(): { id: string } | null;
  log(message: string, level: unknown, details: unknown): void;
  write(batch: SettingsWrite): SettingsWriteResult;
}

// The merchant and the gathering modes are settings, written through the settings writer. The
// merchant's report of a missing tool sets the mode's no-tool record and the mode stays on; the
// no-tool marks, the lucky slot locks and the activity log are records.
export function createMerchantSettingsRoutes(state: SettingsState, ports: SettingsPorts) {
  function unlockLuckySlot(name: string, response: HttpResponse): boolean {
    const locks = state.luckySlotLocks ??= {};
    const locked = locks[name];
    if (!validLuckySlot(locked)) {
      response.status(409).json({error: "lucky slot is not locked"});
      return false;
    }
    const slot = (locked + 1) % BASE_INVENTORY_SIZE;
    const rolls = aggregateSlotTracking(state.luckySlotTracking?.[name]).slots[slot]?.totalRolls ?? 0;
    (state.luckySlotResume ??= {})[name] = {slot, rolls};
    delete locks[name];
    return true;
  }
  function luckySlotAction(name: string, body: Record<string, unknown>, response: HttpResponse): unknown {
    if (name !== state.merchant) return response.status(409).json({error: "merchant is no longer configured"});
    if (body.action === "unlock-lucky-slot") {
      if (!unlockLuckySlot(name, response)) return;
    } else {
      if (!validLuckySlot(body.slot)) return response.status(400).json({error: "invalid lucky slot"});
      (state.luckySlotLocks ??= {})[name] = body.slot;
      delete state.luckySlotResume?.[name];
    }
    ports.persist();
    return response.json({ok: true});
  }
  function configure(request: HttpRequest, response: HttpResponse): unknown {
    const body = requestObject(request.body);
    const name = body.character;
    if (typeof name !== "string" || ports.ownedType(name) !== "merchant")
      return response.status(400).json({ error: "select an owned merchant character" });
    if (body.action === "lock-lucky-slot" || body.action === "unlock-lucky-slot")
      return luckySlotAction(name, body, response);
    const written = ports.write({ by: "dashboard:merchant-config", changes: [{ field: "merchantCharacter", value: name }] });
    if (!written.ok) return response.status(400).json({ error: written.error });
    ports.dispatch();
    return response.json({ ok: true, merchantCharacter: name });
  }

  function gather(request: HttpRequest, response: HttpResponse): unknown {
    const { mode, enabled } = requestObject(request.body);
    if (typeof mode !== "string" || typeof enabled !== "boolean")
      return response.status(400).json({ error: "invalid gathering toggle" });
    const written = ports.write({ by: "dashboard:merchant-gather", changes: [{ field: "gatheringModes",
      value: enabled ? [...new Set(state.modes.concat(mode))] : state.modes.filter((entry) => entry !== mode) }] });
    if (!written.ok) return response.status(400).json({ error: written.error });
    if (enabled) noTool(mode, false);
    if (state.merchant)
      ports.command(state.merchant, {
        id: ports.nextCommand(),
        type: "merchant-gather",
        modes: state.modes,
      });
    ports.persist();
    return response.json({ ok: true, gatheringModes: state.modes });
  }

  function currentMerchant(body: Record<string, unknown>, response: HttpResponse): boolean {
    if (state.merchant && body.character === state.merchant) return true;
    response.status(409).json({ error: "merchant is no longer configured" });
    return false;
  }

  function recordMessage(body: Record<string, unknown>): void {
    if (body.message) ports.log(requestText(body.message), body.level || "info", body.details);
  }

  // The no-tool record for one mode; a change tells `merchant.gathering.noTool`.
  function noTool(mode: string, set: boolean): void {
    if (!!state.noTool[mode] === set) return;
    if (set) state.noTool[mode] = true;
    else delete state.noTool[mode];
    recordMerchant({ subject: String(state.merchant), decision: 'no-tool', owner: 'gather', kind: mode, code: set ? 'set' : 'cleared' });
  }
  function gatherStatus(request: HttpRequest, response: HttpResponse): unknown {
    const body = requestObject(request.body);
    if (!currentMerchant(body, response)) return;
    // A missing tool leaves the mode on: the record shows it on the card and keeps the mode from
    // the pick until the hands owner reports the tool found in the bag or the bank.
    if (body.noTool === true && isGatheringMode(body.mode)) {
      // A report started before you opted in to replacement crafting can arrive later; the setting
      // decides, so the old observation records nothing.
      if (state.automations?.[`craft ${body.mode} tools`] === true)
        return response.json({ok: true, noTool: false});
      noTool(body.mode, true);
    }
    if (body.toolFound === true && isGatheringMode(body.mode)) noTool(body.mode, false);
    recordMessage(body);
    ports.persist();
    return response.json({ ok: true });
  }

  function activity(request: HttpRequest, response: HttpResponse): unknown {
    const body = requestObject(request.body);
    if (!currentMerchant(body, response)) return;
    const job = ports.currentJob();
    if (!job || body.jobId !== job.id)
      return response.status(409).json({ error: "merchant job is no longer current", code: JOB_ENDED });
    recordMessage(body);
    ports.persist();
    return response.json({ ok: true });
  }

  function clearActivity(_request: HttpRequest, response: HttpResponse): unknown {
    state.activity = [];
    ports.persist();
    return response.json({ ok: true });
  }

  return { configure, gather, gatherStatus, activity, clearActivity };
}

// The routine priorities route: the priorities, the automation switches and the gathering modes one
// request sets.
interface RoutineState {
  priorities: Record<string, number>;
  automations: Record<string, boolean>;
  queue: MerchantJob[];
}
interface RoutinePorts {
  reconcile?(): void;
  // The gathering modes the request's switches give, as a change, or none when they stay.
  gathering?(values: Record<string, unknown>): SettingsChange | null;
  // Clears a switched-on mode's no-tool mark and sends the merchant its modes after an accepted write.
  gathered?(values: Record<string, unknown>): void;
  write(batch: SettingsWrite): SettingsWriteResult;
  priorities: Readonly<Record<string, number>>;
  automations: Readonly<Record<string, boolean>>;
  stamp(job: MerchantJob): MerchantJob;
  persist(): void;
  dispatch(): void;
}

/** The routine priorities, the automation switches and the gathering modes a request sets are
 *  settings, written as one batch through the settings writer
 * ). The queue then drops the jobs of switched-off routines and restamps
 * the rest, the merchant jobs owner's reaction to the write. */
export function createRoutinePriorityRoute(state: RoutineState, ports: RoutinePorts) {
  // The whole 0 to 100 rule is the saved field's check, which the writer runs on the batch.
  function nextPriorities(values: Record<string, unknown>): Record<string, number> {
    const next = { ...state.priorities };
    for (const [reason, raw] of Object.entries(values)) if (reason in ports.priorities) next[reason] = Number(raw);
    return next;
  }

  function nextAutomations(values: Record<string, unknown>): Record<string, boolean> {
    const next = { ...state.automations };
    for (const reason of Object.keys(ports.automations)) {
      const enabled = values[reason];
      if (typeof enabled === "boolean") next[reason] = enabled;
    }
    return next;
  }

  return function routinePriorities(request: HttpRequest, response: HttpResponse): unknown {
    const body = requestObject(request.body);
    if (!isRequestObject(body.priorities))
      return response.status(400).json({ error: "provide routine priorities" });
    const priorities = nextPriorities(body.priorities);
    const changes: SettingsChange[] = [{ field: "merchantRoutinePriorities", value: priorities }];
    const gathering = isRequestObject(body.enabled) ? ports.gathering?.(body.enabled) ?? null : null;
    if (isRequestObject(body.enabled)) changes.push({ field: "merchantAutomations", value: nextAutomations(body.enabled) });
    if (gathering) changes.push(gathering);
    const written = ports.write({ by: "dashboard:routine-priorities", changes });
    if (!written.ok) return response.status(400).json({ error: written.error });
    if (isRequestObject(body.enabled)) state.queue = state.queue.filter(job => routineEnabled(job, state.automations));
    if (gathering) ports.gathered?.(body.enabled as Record<string, unknown>);
    state.queue = state.queue.map((job) => ports.stamp(job));
    ports.persist();
    ports.reconcile?.();
    ports.dispatch();
    return response.json({ ok: true, priorities: state.priorities, enabled: state.automations });
  };
}

// The job action routes: the progress, marketplace, cluster and realm routes on one composition.
type JobState = Parameters<typeof createMerchantProgressRoutes>[0] &
  Parameters<typeof createMarketplaceProgressRoutes>[0] &
  Parameters<typeof createMerchantClusterRoutes>[0] &
  Parameters<typeof createMerchantRealmRoutes>[0] &
  Parameters<typeof createMarketplaceLocationRoute>[0] & { nextCommandId: number };
type LocationPorts = Parameters<typeof createMarketplaceLocationRoute>[1];
type JobPorts = Parameters<typeof createMerchantProgressRoutes>[1] &
  Parameters<typeof createMarketplaceProgressRoutes>[1] &
  Omit<Parameters<typeof createMerchantClusterRoutes>[1], "nextCommand"> &
  Parameters<typeof createMerchantRealmRoutes>[1] & {
    fetchMarket: (path: string) => Promise<unknown>;
    normalizePurchases: (
      records: Parameters<LocationPorts["normalize"]>[0],
    ) => ReturnType<LocationPorts["normalize"]>;
    normalizeSales: (
      records: Parameters<LocationPorts["normalize"]>[0],
    ) => ReturnType<LocationPorts["normalize"]>;
  };

/** Bind job reports to the current merchant state, command sequence and deferred worker restart. */
export function createCoordinatorMerchantJobActions(
  state: JobState,
  ports: JobPorts,
) {
  const progress = createMerchantProgressRoutes(state, ports);
  const marketplace = createMarketplaceProgressRoutes(state, ports);
  const clusters = createMerchantClusterRoutes(state, {
    ...ports,
    nextCommand: () => state.nextCommandId++,
  });
  const realms = createMerchantRealmRoutes(state, ports);
  const location = createMarketplaceLocationRoute(state, {
    fetch: () => ports.fetchMarket("/merchants"),
    normalize: (records, sale) =>
      sale ? ports.normalizeSales(records) : ports.normalizePurchases(records),
    persist: () => ports.persist(),
    log: (message, level, details) => ports.log(message, level, details),
  });
  return { progress, marketplace, clusters, realms, location };
}

// The party's merchant buttons (moved from http/party-actions.ts): a manual party collection queues
// one job per member of the chosen group, and the improvement visit queues every member with
// improvement work.
interface PartyMerchantState {
  merchantCurrent: MerchantWork | null;
  merchantQueue: MerchantWork[];
  upgrades: Record<string, unknown[] | undefined>;
  purchases: Record<string, unknown[] | undefined>;
  compounds: Record<string, { items: unknown[] }[] | undefined>;
  autoCompounds: Record<string, unknown[] | undefined>;
}
interface PartyMerchantPorts { now(): number; active(): string[]; persist(): void; dispatch(): void; enqueue(ask: EnqueueAsk): EnqueueAnswer; queue(names: string[], reason: JobReason): void }
export function createMerchantPartyRoutes(state: PartyMerchantState & Parameters<typeof scopeGroups>[0], ports: PartyMerchantPorts) {
  function bank(req: HttpRequest, res: HttpResponse): unknown {
    const groups = scopeGroups(state, ports.active());
    const requested = requestObject(req.body).group;
    const group = requested === undefined && groups.length === 1
      ? groups[0] : groups.find(entry => entry.id === requested);
    if (!group) return res.status(409).json({ error: groups.length ? "Select a party group to visit" : "No party members are online", groups });
    let added = false;
    for (const name of group.members) {
      const existing = [state.merchantCurrent, ...state.merchantQueue].find(job => job?.target === name && job.reason === 'party collection');
      if (existing) { added = existing.manual !== true || added; existing.manual = true; continue; }
      // Queue each member explicitly: positions and arrival-time radius never select recipients.
      ports.enqueue({ reason: "party collection", target: name, fields: { manual: true } });
      added = true;
    }
    if (added) { ports.persist(); ports.dispatch(); }
    return res.json({ ok: true, group: group.id, queued: group.members });
  }
  function upgrades(_req: HttpRequest, res: HttpResponse): unknown {
    const names = ports
      .active()
      .filter(
        (name) =>
          (state.upgrades[name] || []).length ||
          (state.purchases[name] || []).length ||
          (state.compounds[name] || []).some((group) => group.items.length === 3) ||
          (state.autoCompounds[name] || []).length,
      );
    ports.queue(names, "upgrades and compounds");
    return res.json({ ok: true, queued: names });
  }
  return { bank, upgrades };
}
