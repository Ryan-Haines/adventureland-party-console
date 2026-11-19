// A job's endings: the completion's receipts, the ending row that decides the retry and its wait,
// and the report fence that admits a completion or progress report only for the current job's command.
// A decision reads the player's setting through `played`, so an add-on's overlay plays.
import { played } from '../../settings/api.ts';
import { partyHooks } from '../../hooks/index.ts';
import { writeIntents, receiveBankUpgrades, upgradeOfferingReady, upgradeRecoverySignature, type UpgradeMark, type DeconstructionMark, resolveNpcSales, items, type NpcSale, receiveBankDeconstruction, recordBankReceipts, recordClaimBanked, type ClaimBanked } from '../../items/coordinator/api.ts';
import { failureClass } from '../../items/api.ts';
import type { InventoryEntry, Item } from '../../coordinator/contracts/item.ts';
import { merchantKind, endingOf, endingWaitMs, realmRetry, type EndingFacts, type EndingRow, COMMERCE_PROGRESS_VERSION, type JobReason } from '../rules.ts';
import { boundFired } from '../../status/coordinator/api.ts';
import { watchReports } from './report-wait.ts';
import { requestObject, requestText } from '../../lifecycle/api.ts';
import { communicationReason } from '../../movement/api/coordinator.ts';
import { pruneLuckCasts } from './sources.ts';
import { recordMerchant } from './records.ts';
import type { LadderPort } from '../../tasks/api.ts';
import { type DeliveryRequest, deliveryReady, deliveryMatches, acknowledgeDelivery } from './deliveries.ts';
import { merchantSlotCommand, endMerchantJob, stripRun, type MerchantWork, type EnqueueAsk, type EnqueueAnswer, type ResourceBlock } from './owner.ts';
import type { RecoverableWork } from './recovery.ts';

// The completion: a report's receipts, then the ending row that decides the retry.
/** Commits receipts before deciding which unfinished work must survive a runtime handoff. */
export function createMerchantCompletion(state: CompletionState, ports: CompletionPorts) {
  const results = createCompletionResults(state, ports),
    retries = createCompletionRetries(state, ports);
  // `after: 'auth-check'`: the key mail went, so the account is `YES` until ALData confirms the key.
  // The items owner's publication ask runs that check, the next ask that needs a confirmed key
  // (items/coordinator/market.ts `confirmAuth`).
  function authenticate(job: CompletionJob, body: CompletionReport): void {
    if (!body.success || merchantKind(job.reason).after !== 'auth-check') return;
    state.aldata.auth = "YES";
    state.aldata.authCheckedAt = ports.now();
    ports.persistALData();
    ports.publishALData();
  }
  function upgradeRoutines(name: string): JobReason[] {
    const upgrades = (state.upgrades[name] || []).filter(mark => upgradeOfferingReady(state, mark)), reasons: JobReason[] = [];
    if (upgrades.some(mark => !(mark as {auto?: boolean}).auto) || state.statScrolls[name]?.length)
      reasons.push("manual upgrades");
    if (upgrades.some(mark => (mark as {auto?: boolean}).auto)) reasons.push("auto upgrade");
    return reasons;
  }
  function deferredAutoCompound(job: CompletionJob): boolean {
    return job.reason === "auto compound" || !!state.autoCompounds[String(job.target)]?.length;
  }
  function deferredImprovements(job: CompletionJob): void {
    const name = job.target;
    if (!name) return;
    const reasons = new Set(upgradeRoutines(name));
    if (state.compounds[name]?.length) reasons.add("manual compounds");
    if (state.purchases[name]?.length) reasons.add("manual buying");
    if (deferredAutoCompound(job)) reasons.add("auto compound");
    for (const reason of reasons) ports.queue([name], reason);
    if (reasons.size) ports.log("Queued deferred merchant work", "info", {
      character: name, routines: [...reasons],
    });
  }
  // `homeAfter` and `after: 'market-recheck'`. The recheck reads the market against the
  // merchant's next report, the first that shows the purchase's gold and bag.
  function finish(job: CompletionJob): void {
    const kind = merchantKind(job.reason);
    if (kind.homeAfter) ports.ensureHome(kind.homeAfter);
    ports.persistBank();
    ports.persist();
    ports.dispatch();
    if (kind.after === 'market-recheck') watchReports(name => {
      if (name !== state.merchantCharacter) return false;
      if (!ports.pontyMatches()) ports.aldataMatches();
      return true;
    });
  }
  function complete(job: CompletionJob, body: CompletionReport): void {
    const name = job.target;
    results.resolve(job, body);
    const ending = retries.decide(job, body);
    const repeatCleanout = merchantKind(job.reason).repeatsCleanout && job.handoff?.cleanoutRemaining;
    const deferred = body.success && body.deferredWork;
    releaseFailedRecipient(name, job, body);
    endMerchantJob(state, job, { decision: 'ended', code: ending.row?.ending ?? (body.success ? 'done' : 'failed') });
    if (body.success) ports.ladder?.progress();
    authenticate(job, body);
    retries.enqueue(job, ending);
    if (deferred) deferredImprovements(job);
    if (repeatCleanout) repeatCleanoutAfterWindow(job);
    finish(job);
  }
  function repeatCleanoutAfterWindow(job: CompletionJob): void {
    if (!job.handoff?.partial) { ports.queue([job.target], "inventory cleanout"); return; }
    if (played(state, 'merchantAutomations')?.['inventory cleanout'] === false) return;
    // Queue before dispatch with a durable eligibility time. Automatic pulses merge into this
    // pickup and keep retryAt, so the job waits until then (merge at the door).
    const now = ports.now();
    ports.enqueue({ reason: "inventory cleanout", target: job.target, fields: { id: job.id + '-cleanout-' + now, retryAt: now + endingWaitMs('cleanout-repeat') } });
  }
  function releaseFailedRecipient(name: CompletionJob['target'], job: CompletionJob, body: CompletionReport): void {
    const recipient = state.commands[String(name)];
    if (!body.success && recipient?.type === "merchant-handoff" &&
        (recipient.jobId === undefined || recipient.jobId === job.id))
      merchantSlotCommand(state, 'job:' + job.id, null, String(name));
  }
  return { complete };
}

// The retry (rules.ts ENDINGS): the completion report's facts pick the ending row, and the row gives the
// retry's id, place in line, wait and ladder failure.
// `retry` says whether the ending queues the job again.
interface Ending { row: EndingRow | null; facts: EndingFacts; retry: boolean }
function merchantDeath(body: CompletionReport): boolean {
  return !body.success && requestText(body.error || '').startsWith('Merchant died during rendezvous with ');
}
function endingFacts(job: CompletionJob, body: CompletionReport): EndingFacts {
  const failed = !body.success, error = requestText(body.error || "");
  return {
    movementOwned: failed && body.failureKind === "hunt_movement_owned",
    movement: commerceRouteFailure(job, body) || improvementCommunicationFailure(job, body),
    anniversaryYield: failed && body.code === "merchant_anniversary_reserved",
    realm: realmFailure(body),
    rendezvous: failed && /rendezvous (?:route )?timed out/i.test(error),
    storageYield: failed && failureClass(body.code) === 'storage',
    death: merchantDeath(body),
    interrupted: failed && interruptedProduction(body),
    interruptedOrder: failed && buyUpgradeOrder(job),
    commerce: job.reason === 'merchant commerce',
    kind: merchantKind(job.reason),
  };
}
function improvementCommunicationFailure(job: CompletionJob, body: CompletionReport): boolean {
  return !body.success && !!merchantKind(job.reason).improvement && communicationReason(requestText(body.error || ''));
}
function realmFailure(body: CompletionReport): boolean {
  return !body.success && requestText(body.error || "").startsWith("merchant job failed: wrong realm");
}
// The items owner's class of the failure's code, or the merchant's death on the way to
// a rendezvous.
function interruptedProduction(body: CompletionReport): boolean {
  if (body.failureKind === 'commerce_recovery') return true;
  return failureClass(body.code) === 'interrupted' || merchantDeath(body);
}
function completionLevel(body: CompletionReport, ending: Ending): string {
  if (!body.success && failureClass(body.code) === 'uncertain') return 'error';
  return ending.row ? 'info' : body.success ? 'success' : 'error';
}

export function createCompletionRetries(state: CompletionState, ports: CompletionPorts) {
  function upgradeRecoveryBlock(job: CompletionJob, body: CompletionReport): boolean {
    if (!body.success && failureClass(body.code) === 'ambiguous') {
      state.merchantJobBlocks[job.target + "\n" + job.reason] = {
        error: requestText(body.error),
        upgradeRecoverySignature: upgradeRecoverySignature(state.upgrades[String(job.target)] || [],state.statuses[String(state.merchantCharacter)]?.items || []),
      };
      recordMerchant({ subject: String(job.target), decision: 'blocked', owner: 'job:' + job.id, kind: job.reason, code: requestText(body.error) });
      ports.log("Upgrade recovery paused; waiting for matching inventory or upgrade intent to change", "error", body.error);
      return true;
    }
    return false;
  }
  // A failure short of gold or space (the items owner's failure class) blocks the kind until its
  // resources change.
  function resourceBlock(job: CompletionJob, body: CompletionReport): void {
    const resource = failureClass(body.code), capacity = resource === 'space';
    if (body.success || !(capacity || resource === 'gold') || !merchantKind(job.reason).resourceHold) return;
    state.merchantJobBlocks[job.target + "\n" + job.reason] = {
      error: requestText(body.error),
      ...(capacity ? { capacitySignature: ports.capacitySignature(job.target) } : {}),
      bankGold: Number(state.bankSnapshot?.gold) || 0,
      merchantGold: Number(state.statuses[String(state.merchantCharacter)]?.gold) || 0,
    };
    recordMerchant({ subject: String(job.target), decision: 'blocked', owner: 'job:' + job.id, kind: job.reason, code: requestText(body.error) });
    ports.log(
      capacity
        ? "Improvement paused until inventory or bank contents change"
        : "Improvement paused until more gold is available",
      "error",
      { target: job.target, reason: job.reason, error: requestText(body.error) },
    );
  }
  // `failsSales`: a failed sale fails its marks through the items
  // owner's code.
  function npcSales(job: CompletionJob, body: CompletionReport): void {
    if (!body.success && merchantKind(job.reason).failsSales) {
      const attempted = state.commands[String(state.merchantCharacter)]?.npcSales || [];
      items().failNpcSales(attempted.map((mark) => mark.id), requestText(body.error || "NPC sale interrupted"), body.code);
    }
    // The sales a completion reports blocked wait under the items owner's
    // block rule.
    if (body.npcSalesBlocked?.length) items().blockNpcSales(body.npcSalesBlocked);
  }
  function decide(job: CompletionJob, body: CompletionReport): Ending {
    upgradeRecoveryBlock(job, body);
    resourceBlock(job, body);
    const facts = endingFacts(job, body), row = endingOf(facts), ending = { row, facts, retry: !!row };
    if (!body.success && buyUpgradeOrder(job)) { job.lastError = requestText(body.error); job.lastErrorCode = body.code; }
    if (facts.movement) job.lastMovementError = requestText(body.error);
    npcSales(job, body);
    ports.log(ending.row?.message ?? "Merchant job " + (body.success ? "completed" : "failed") + " for " + job.target,
      completionLevel(body, ending), body.error);
    return ending;
  }
  // The retry the ending row gives, through the one pause (3.4); its failure is booked at the next
  // claim (3.6).
  function enqueue(job: CompletionJob, ending: Ending): void {
    const row = ending.row;
    if (!row) return;
    const now = ports.now();
    const retry: CompletionJob = {
      ...stripRun(job),
      id: row.id === 'keep' ? job.id : "merchant-" + now + "-" + ports.nextCommand(),
      resumedFrom: job.id,
      retryCount: (Number(job.retryCount) || 0) + (row.counts ? 1 : 0),
      rendezvousRetryCount: (Number(job.rendezvousRetryCount) || 0) + (row.ending === 'rendezvous-timeout' ? 1 : 0),
      retryAt: 0,
      queuedAt: row.queuedAt === 'keep' ? job.queuedAt : now,
    };
    waitFor(row, job, retry, now, state.merchantCharacter);
    // An add-on may wait longer, count the retry or give the job up; core's wait stays the floor.
    const wait = Math.max(0, Number(retry.retryAt) - now), asked = partyHooks().retry.policy(
      { owner: 'merchant-jobs', subject: job.reason, failure: row.ending, attempt: Number(job.retryCount) || 0 }, { wait, giveUp: false, counts: row.counts });
    if (asked.giveUp) { ports.log('Merchant job given up after ' + row.ending, 'info', { jobId: job.id, target: job.target }); return; }
    if (asked.wait > wait) retry.retryAt = now + asked.wait;
    if (asked.counts && !row.counts) retry.retryCount = (Number(retry.retryCount) || 0) + 1;
    if (row.ladder) retry.ladderDue = row.ladder;
    if (!state.merchantQueue.some(queued => queued.id === retry.id)) {
      state.merchantQueue.unshift(ports.stamp(retry));
      logOrderRetry(retry);
      if (retry.retryOn) retryOnReport(retry.id, retry.retryOn);
    }
    logLuckRetry(job);
  }
  // The retry runs at the named member's next report: a living merchant's after a death, the
  // target's after a missed rendezvous or a realm change. Its retryAt stays as ENDING_RETRY_MS's
  // bound for a member that never reports, which the claim reports (owner.ts `bookMerchantLadder`).
  function retryOnReport(id: string, on: RetryOn): void {
    watchReports(name => {
      if (name !== on.character) return false;
      if (on.living && (state.statuses[name] as { rip?: unknown } | undefined)?.rip) return false;
      const queued = state.merchantQueue.find(entry => entry.id === id);
      if (queued?.retryOn) { queued.retryAt = 0; delete queued.retryOn; ports.dispatch(); }
      return true;
    });
  }
  function logOrderRetry(retry: CompletionJob): void {
    if (retry.reason !== 'merchant commerce') return;
    const retryAt = Number(retry.retryAt) || ports.now();
    const retryAtUTC = new Date(retryAt).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
    ports.log('Retrying order at ' + retryAtUTC, failureClass(retry.lastErrorCode) === 'uncertain' ? 'error' : 'info', {
      jobId: retry.id, resumedFrom: retry.resumedFrom, retryAt, retryAtUTC, error: retry.lastError || null,
    });
  }
  function logLuckRetry(job: CompletionJob): void {
    if (merchantKind(job.reason).luck)
      ports.log(
        "Retrying failed Merchant's Luck itinerary leg without returning to stand",
        "info",
        { target: job.target, attempt: (Number(job.retryCount) || 0) + 2 },
      );
  }
  return { decide, enqueue };
}

// The member whose next report runs a retry, and whether that report must show it alive.
export interface RetryOn { character: string; living: boolean }
// The waits, whose values rules.ts holds (endingWaitMs), and the fields each one writes on the retry.
// A death or a missed rendezvous and a realm change wait for a member's report (`retryOn`); the
// commerce and movement backoffs are bounds against an outside failure, and each one booked goes to
// The status owner's bound record under COMMERCE_RETRY_MS.
function waitFor(row: EndingRow, job: CompletionJob, retry: CompletionJob, now: number, merchant: string | null): void {
  const wait = row.retryAt;
  if (wait === 'ten-seconds') {
    retry.retryAt = now + endingWaitMs(wait);
    const died = row.ending === 'died on rendezvous';
    const character = died ? merchant : job.target;
    if (character) retry.retryOn = { character, living: died };
  } else if (wait === 'movement-streak') {
    retry.movementRetryCount = Number(job.movementRetryCount || 0) + 1;
    retry.retryAt = now + endingWaitMs(wait, Number(retry.movementRetryCount));
    retry.pauseReason = 'Movement retry: ' + requestText(job.lastMovementError || 'route unavailable');
    boundFired({ bound: 'COMMERCE_RETRY_MS', owner: '08', subject: String(job.target), state: { jobId: job.id, ending: row.ending, attempt: retry.movementRetryCount } });
  } else if (wait === 'commerce') {
    retry.retryAt = now + endingWaitMs(wait, Number(job.retryCount || 0) + 1);
    retry.pauseReason = requestText(job.lastError || 'Production interrupted; progress preserved');
    boundFired({ bound: 'COMMERCE_RETRY_MS', owner: '08', subject: String(job.target), state: { jobId: job.id, ending: row.ending, attempt: Number(job.retryCount || 0) + 1 } });
  } else if (wait === 'realm') {
    Object.assign(retry, realmRetry(job.realmAttempts, now));
    if (job.target) retry.retryOn = { character: job.target, living: false };
  }
}

// The completion's records: a delivery receipt, the report and the state it writes.
export interface DeliveryReceipt extends DeliveryRequest {
  awaitingEquip?: boolean;
  item?: Item;
  equipOnDelivery?: boolean;
}
export interface CompletionJob extends RecoverableWork {
  // The failure code of the order's last failure, beside its text in `lastError`.
  lastErrorCode?: unknown;
  mail?: { id: string };
  handoff?: { cleanoutRemaining?: unknown; partial?: unknown } | null;
  retryCount?: number;
  rendezvousRetryCount?: number;
}
export interface CompletionReport {
  pendingImprovedDeliveries?: DeliveryReceipt[];
  jobId?: string;
  commandId?: number;
  failureKind?: string;
  success?: unknown;
  error?: unknown;
  // The items owner's code of the failure; `error` is its human message.
  code?: unknown;
  standSearchResults?: { itemId?: string; listings?: { item?: Item }[]; error?: unknown };
  cargo?: { bank?: unknown[]; gold?: unknown };
  mluckRecipients?: unknown[];
  banked?: unknown[];
  upgradesResolved?: unknown;
  upgradeMarksResolved?: UpgradeMark[];
  statScrollsResolved?: unknown[];
  statScrollsApplied?: {mark:unknown;slot:number;item:Item}[];
  statScrollsReady?: unknown;
  compoundsResolved?: unknown;
  autoCompoundsResolved?: string[];
  withdrawalsDelivered?: unknown;
  purchasesResolved?: unknown;
  kept?: unknown[];
  bankedByCharacter?: Record<string, unknown[]>;
  merchantWithdrawalsDelivered?: unknown[];
  merchantBanked?: unknown[];
  npcSalesResolved?: string[];
  merchantDeliveriesDelivered?: DeliveryReceipt[];
  activity?: unknown[];
  confirmedWithdrawals?: unknown[];
  npcSalesBlocked?: { id: string; error?: unknown; code?: unknown }[];
  deferredWork?: unknown;
}
export interface CompletionCommand {
  jobId?: unknown;
  deliveryIds?: (string | undefined)[];
  id?: number;
  type: string;
  items?: unknown[];
  equipItems?: Item[];
  npcSales?: { id: string }[];
}
export interface CompletionState {
  merchantAutomations?: Record<string, boolean>;
  merchantCharacter: string | null;
  merchantCurrent: CompletionJob | null;
  merchantQueue: CompletionJob[];
  commands: Record<string, CompletionCommand | undefined>;
  standSearch: unknown;
  standListingCache?: { item?: Item }[];
  merchantCargo: unknown;
  mluckCastAt: Record<string, number>;
  marked: Record<string, unknown[] | undefined>;
  upgrades: Record<string, unknown[] | undefined>;
  statScrolls: Record<string, unknown[] | undefined>;
  compounds: Record<string, unknown[] | undefined>;
  autoCompounds: Record<string, { name: string }[] | undefined>;
  withdrawals: Record<string, unknown[] | undefined>;
  purchases: Record<string, unknown[] | undefined>;
  merchantMarked: Record<string, unknown[] | undefined>;
  merchantDeliveries: Record<string, DeliveryReceipt[] | undefined>;
  npcSaleMarks: NpcSale[];
  deconstructionMarks?: DeconstructionMark[];
  merchantJobBlocks: Record<string, ResourceBlock>;
  bankSnapshot?: { gold?: number; packs?: Record<string, unknown[] | undefined> } | null;
  statuses: Record<string, { gold?: number; items?: (InventoryEntry | null)[] } | undefined>;
  aldata: { auth: unknown; authCheckedAt: number; key: string; error?: string | null };
  // The items owner's record of the copies the player banked out of a live
  // claim.
  claimBanked: ClaimBanked;
}
export interface CompletionPorts {
  now(): number;
  nextCommand(): number;
  enqueue(ask: EnqueueAsk): EnqueueAnswer;
  mailSent?(id:string,mail:unknown):void;
  mailComplete(id: string, success: boolean, error: unknown): void;
  clearUpgrades(name: string | null, marks: UpgradeMark[]): void;
  clearIncoming(name: string | null, item: Item | undefined): void;
  log(message: string, level: string, details?: unknown): void;
  capacitySignature(name: string | null): string;
  persistALData(): void;
  publishALData(): void;
  // The tasks owner's merchant-job ladder: a finished job is progress (3.6).
  ladder?: LadderPort;
  stamp(job: CompletionJob): CompletionJob;
  queue(names: (string | null)[], reason: JobReason): void;
  ensureHome(reason: string): void;
  persistBank(): void;
  persist(): void;
  dispatch(): void;
  pontyMatches(): boolean;
  aldataMatches(): unknown;
}

// The completion's receipts: what each report resolves in the marks, withdrawals and deliveries.
// A withdrawal receipt can name the bag cell its copy landed in (`inventorySlot`), which the
// pending request never holds.
function removeWithdrawals(pending: unknown[] | undefined, resolved: unknown[] | undefined): void {
  removeMatching(pending, (resolved || []).map(receipt => {
    if (!receipt || typeof receipt !== "object") return receipt;
    const { inventorySlot: _landed, ...request } = receipt as Record<string, unknown>;
    return request;
  }));
}
function removeMatching(pending: unknown[] | undefined, resolved: unknown[] | undefined): void {
  const list = pending || [];
  for (const item of resolved || []) {
    const encoded = JSON.stringify(item),
      index = list.findIndex((entry) => JSON.stringify(entry) === encoded);
    if (index >= 0) list.splice(index, 1);
  }
}

export function createCompletionResults(state: CompletionState, ports: CompletionPorts) {
  function search(body: CompletionReport): void {
    const report = body.standSearchResults;
    if (!report) return;
    const listings = Array.isArray(report.listings) ? report.listings : [];
    state.standSearch = {
      status: body.success ? "complete" : "error",
      itemId: report.itemId || null,
      listings,
      error: report.error || null,
      searchedAt: ports.now(),
    };
    state.standListingCache = (state.standListingCache || [])
      .filter((entry) => entry.item && entry.item.name !== report.itemId)
      .concat(listings)
      .slice(-500);
  }
  function cargo(body: CompletionReport): void {
    if (body.cargo && Array.isArray(body.cargo.bank) && Number.isFinite(Number(body.cargo.gold)))
      state.merchantCargo = { bank: body.cargo.bank, gold: Number(body.cargo.gold) };
  }
  function luck(body: CompletionReport): void {
    for (const recipient of body.mluckRecipients || [])
      if (typeof recipient === "string") state.mluckCastAt[recipient] = ports.now();
    pruneLuckCasts(state.mluckCastAt, ports.now());
  }
  function upgrades(name: string | null, body: CompletionReport): void {
    if (body.upgradesResolved) {
      if (Array.isArray(body.upgradeMarksResolved))
        ports.clearUpgrades(name, body.upgradeMarksResolved);
      else writeIntents(state, String(name), () => []);
    }
  }
  function appliedStatReceipts(name: string | null, body: CompletionReport): void {
    if (name !== state.merchantCharacter) return;
    const readyRecipients=new Set<string>();
    for (const receipt of body.statScrollsApplied || []) {
      const mark=requestObject(receipt.mark), original=requestObject(mark.item), actual=receipt.item;
      if (mark.equipped || !Number.isSafeInteger(receipt.slot) || typeof mark.statType!=='string' || actual.stat_type!==mark.statType) continue;
      const previous:Item={...actual};
      if(typeof original.stat_type==='string') previous.stat_type=original.stat_type;
      else delete previous.stat_type;
      if (!deliveryMatches(previous,original) || !deliveryMatches(original,previous)) continue;
      // Cleanup of stale marks is not a native outcome. Only this explicit,
      // observed mutation can advance an item's reserved delivery identity.
      for(const [recipient,deliveries] of Object.entries(state.merchantDeliveries)) for(const delivery of deliveries || []) {
        if ((delivery.slot===mark.slot || delivery.slot===receipt.slot) && deliveryMatches(delivery.item,original) && deliveryMatches(original,delivery.item)) {
          delivery.item={...actual};delivery.slot=receipt.slot;
          if(delivery.blocked==='Reserved delivery item missing') delete delivery.blocked;
          if(deliveryReady(delivery)) readyRecipients.add(recipient);
        }
      }
      removeMatching(state.statScrolls[String(name)],[receipt.mark]);
    }
    // The dependency gate may have retired an empty delivery job. Native stat
    // completion is the wakeup: an idle recipient need not publish a full new bag.
    if(played(state, 'merchantAutomations')?.deliveries!==false && readyRecipients.size)
      ports.queue([...readyRecipients], 'deliveries');
  }
  function successfulImprovements(name: string | null, body: CompletionReport, owner: string): void {
    upgrades(name, body);
    removeMatching(state.statScrolls[String(name)], body.statScrollsResolved);
    if (
      body.statScrollsReady &&
      name !== state.merchantCharacter &&
      (state.statScrolls[String(name)] || []).length
    )
      merchantSlotCommand(state, owner, { id: ports.nextCommand(), type: "apply-stat-scrolls", items: state.statScrolls[String(name)] || [] },
        String(name));
    if (body.compoundsResolved) state.compounds[String(name)] = [];
  }
  function success(name: string | null, body: CompletionReport, owner: string): void {
    luck(body);
    removeMatching(state.marked[String(name)], body.banked);
    successfulImprovements(name, body, owner);
    // Release withdrawals only through explicit item receipts.
    if (body.purchasesResolved) state.purchases[String(name)] = [];
    removeMatching(state.merchantMarked[String(name)], body.kept);
    for (const [owner, banked] of Object.entries(body.bankedByCharacter || {}))
      removeMatching(state.marked[owner], banked);
  }
  function deliveries(name: string | null, body: CompletionReport, owner: string): void {
    const equip: Item[] = [];
    const deliveryIds: (string | undefined)[] = [];
    for (const entry of body.merchantDeliveriesDelivered || []) {
      const resolved = acknowledgeDelivery(state.merchantDeliveries[String(name)] || [], entry);
      if (!resolved) continue;
      ports.clearIncoming(name, entry.item);
      if (entry.equipOnDelivery === true && entry.item) {
        equip.push(entry.item);
        deliveryIds.push(resolved.id);
      }
    }
    queueEquipment(name, equip, deliveryIds, owner);
  }
  function queueEquipment(name: string | null, equip: Item[], deliveryIds: (string | undefined)[], owner: string): void {
    if (!equip.length) return;
    const identity = deliveryIds.some(Boolean) ? {deliveryIds} : {};
    const command = state.commands[String(name)];
    if (command?.type === 'apply-stat-scrolls') Object.assign(command, {equipItems: equip}, identity);
    // awaitingEquip persists the receipt until scheduling can safely own the slot.
    else if (!command) merchantSlotCommand(state, owner, {id: ports.nextCommand(), type: 'equip-deliveries', items: equip, ...identity}, String(name));
  }
  function commerce(current: CompletionJob, body: CompletionReport): void {
    if (current.reason === "collect mail")
      ports.mailComplete(current.mail!.id, !!body.success, body.error);
    if (current.reason === "send mail" && body.success === true) ports.mailSent?.(current.id, current.mail);
    search(body);
  }
  function activity(body: CompletionReport): void {
    for (const raw of body.activity || []) {
      const entry = requestObject(raw);
      ports.log(
        requestText(entry.message || raw),
        requestText(entry.level || "info"),
        entry.details,
      );
    }
  }
  function resolve(current: CompletionJob, body: CompletionReport): void {
    const name = current.target;
    deconstructionReceipts(name, body);
    appliedStatReceipts(name, body);
    commerce(current, body);
    cargo(body);
    const owner = 'job:' + current.id;
    if (body.success || realmFailure(body)) success(name, body, owner);
    // These receipts are final even if a later stage of this job failed.
    removeWithdrawals(
      state.withdrawals[String(state.merchantCharacter)],
      body.merchantWithdrawalsDelivered,
    );
    recordClaimBanked(state, String(state.merchantCharacter), body.merchantBanked);
    removeMatching(state.marked[String(state.merchantCharacter)], body.merchantBanked);
    recordBankReceipts(String(state.merchantCharacter), owner, { banked: body.merchantBanked, withdrawn: body.merchantWithdrawalsDelivered });
    if (body.npcSalesResolved?.length) state.npcSaleMarks = resolveNpcSales(state.npcSaleMarks, body.npcSalesResolved);
    deliveries(name, body, owner);
    if (realmFailure(body) && body.pendingImprovedDeliveries?.length) {
      (state.merchantDeliveries[String(name)] ||= []).push(...body.pendingImprovedDeliveries);
    }
    activity(body);
    removeMatching(state.withdrawals[String(name)], body.confirmedWithdrawals);
    if (!body.success) luck(body);
  }
  function deconstructionReceipts(name: string | null, body: CompletionReport) {
    receiveBankDeconstruction(state, state.merchantCharacter, body.merchantWithdrawalsDelivered, ports.now());
    receiveBankDeconstruction(state, name, body.confirmedWithdrawals, ports.now());
    receiveBankUpgrades(state, state.merchantCharacter, body.merchantWithdrawalsDelivered);
    receiveBankUpgrades(state, name, body.confirmedWithdrawals);
    const receipts = Array.isArray(body.merchantWithdrawalsDelivered) ? body.merchantWithdrawalsDelivered : [];
    for (const raw of state.compounds[String(state.merchantCharacter)] || []) {
      const group=requestObject(raw);
      for(const value of Array.isArray(group.items)?group.items:[]) {
        const mark=requestObject(value),source=requestObject(mark.storage);
        const received=receipts.map(value=>requestObject(value)).find(receipt=>receipt.pack===source.pack && receipt.slot===source.slot && deliveryMatches(requestObject(receipt.item),requestObject(mark.item)) && deliveryMatches(requestObject(mark.item),requestObject(receipt.item)));
        if(mark.storage && received && Number.isSafeInteger(received.inventorySlot)) {mark.storageReceived=true;mark.slot=received.inventorySlot;}
      }
    }
  }
  return { resolve };
}

// The report fence: a completion or progress report counts only for the current job's command.
/** Dispatch fencing is opt-in for durable commerce; legacy routines retain their wire contract. */
export function currentMerchantReport(job: MerchantWork | null, body: Record<string, unknown>): job is MerchantWork {
  if (!job || body.jobId !== job.id) return false;
  if (body.commandId !== undefined || body.failureKind === "hunt_movement_owned") return body.commandId === job.commandId;
  if (job.commerceProgressVersion !== COMMERCE_PROGRESS_VERSION) return true;
  return body.commandId === job.commandId;
}

export function buyUpgradeOrder(job: MerchantWork): boolean {
  const order = job.order as { buys?: {level?: number}[] } | undefined;
  return job.reason === 'merchant commerce' && !!order?.buys?.some(line => Number(line.level) > 0);
}

export function commerceRouteFailure(job: MerchantWork, body: {success?: unknown; failureKind?: unknown}): boolean {
  return !body.success && buyUpgradeOrder(job) && body.failureKind === 'commerce_movement';
}
