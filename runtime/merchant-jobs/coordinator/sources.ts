// The job owner's sources: the reports and
// schedulers that queue jobs (Merchant's Luck, giveaways, the leader, marked-item and luck clusters,
// and the per-report scheduling of restocks, collections, cleanouts, gold and deliveries), and the
// automatic sources' composition on the coordinator's records.
// A decision reads the player's setting through `played`, so an add-on's overlay plays.
import { played } from '../../settings/api.ts';
import { merchantKind, GATHERING_MODES, MERCHANT_LUCK, MERCHANT_PAUSE_DEADLINE_MS, type JobReason } from '../rules.ts';
import { recordMerchant } from './records.ts';
import { fresh } from '../../protocol/reports.ts';
import type { ObservedPosition } from '../../coordinator/contracts/position.ts';
import { type EnqueueAsk, type EnqueueAnswer, type MerchantWork } from './owner.ts';
import { deliveryReady, reconcileDeliveries, type DeliveryRequest } from './deliveries.ts';
import { type MerchantCommandReport } from './recovery.ts';
import type { InventoryEntry, Item, ItemMark } from '../../coordinator/contracts/item.ts';
import { normalizedRealm } from '../../merchant-realm/api.ts';
import { freeSlots, luckySlotOf, protectedSlotsOf, type LuckySlots } from '../../items/api.ts';
import { bankVisitStalled, upgradeOfferingReady, items, bankCollectionReason, createImprovementScheduler, createAutomaticMerchantSales } from '../../items/coordinator/api.ts';
import type { RestockPolicy, ElixirPolicy } from '../../items/api.ts';
import { admitMerchantInterruption, attachMerchantInterruption } from '../../movement/api/coordinator.ts';
import type { ObservedInventoryEntry } from '../../status/api.ts';
import { realmParts } from '../../protocol/realm.ts';

// Merchant's Luck's remaining time and travel lead, which the luck scheduler reads.
interface LuckCondition {
  id: string;
  source?: string;
  remainingMs?: number;
  live?: { strong?: boolean };
}

export interface LuckStatus extends ObservedPosition {
  name: string;
  conditions?: readonly (LuckCondition | null)[];
}

const luckDurationMs = 3_600_000;
export const luckTravelMarginMs = 30_000;
const crossMapLeadMs = 330_000;

function luckCondition(status: LuckStatus | undefined): LuckCondition | null | undefined {
  return status?.conditions?.find((entry) => entry?.id === "mluck");
}

function ownedCondition(condition: LuckCondition, merchant: string | null): boolean {
  return String(condition.source || "") === String(merchant || "");
}

function remainingFromCast(
  status: LuckStatus | undefined,
  castAt: number | undefined,
  now: number,
): number {
  return status && castAt ? Math.max(0, luckDurationMs - (now - castAt)) : 0;
}

/**
 * A cast older than the luck duration gives the same remaining time as no
 * cast, so pruneLuckCasts drops its entry. Keys are player names, which grow
 * with every player the merchant meets.
 */
export function pruneLuckCasts(casts: Record<string, number>, now: number): void {
  for (const [name, at] of Object.entries(casts)) if (!(now - Number(at) < luckDurationMs)) delete casts[name];
}

export function mluckRemaining(
  status: LuckStatus | undefined,
  merchant: string | null,
  castAt: number | undefined,
  now: number,
): number {
  const condition = luckCondition(status);
  // A fresh absence overrides a saved cast timestamp, including after reconnect.
  if (Array.isArray(status?.conditions) && !condition) return 0;
  if (condition && !ownedCondition(condition, merchant)) return 0;
  const reported = condition && Number(condition.remainingMs);
  if (typeof reported === "number" && Number.isFinite(reported)) return Math.max(0, reported);
  return remainingFromCast(status, castAt, now);
}

// The scheduler leaves another merchant's strong luck alone. The game makes luck between characters
// of one owner strong (server.js 10896-10898), so the scheduler refreshes our own luck on its lead
// like a weak one.
export function hasStrongMluck(status: LuckStatus | undefined, merchant: string | null): boolean {
  const condition = luckCondition(status);
  return !!condition?.live?.strong && !ownedCondition(condition, merchant);
}

export function mluckTravelLead(
  merchant: ObservedPosition | undefined,
  target: ObservedPosition,
): number {
  if (!merchant || merchant.map !== target.map) return crossMapLeadMs;
  const distance = Math.hypot(
    (Number(merchant.x) || 0) - (Number(target.x) || 0),
    (Number(merchant.y) || 0) - (Number(target.y) || 0),
  );
  const speed = Number(merchant.speed) > 0 ? Number(merchant.speed) : 40;
  // Double direct travel time to retain the allowance for actual smart routes.
  return Math.max(luckTravelMarginMs, (distance / speed) * 2000 + luckTravelMarginMs);
}

// The luck scheduler: it queues a refresh for the member whose luck runs out first, before its lead.
interface Status extends LuckStatus {
  seenAt: number;
  level: number;
  ctype?: string;
  rip?: boolean;
  server?: string;
}
interface State {
  merchantCharacter: string | null;
  merchantAutomations: Record<string, boolean>;
  statuses: Record<string, Status | undefined>;
  merchantCurrent: MerchantWork | null;
  merchantQueue: MerchantWork[];
}
interface Ports {
  now(): number;
  enqueue(ask: EnqueueAsk): EnqueueAnswer;
  names(): string[];
  strong(status: Status): boolean;
  remaining(status: Status): number;
  lead(status: Status): number;
  persist(): void;
  dispatch(): void;
  log(message: string, level: string, details: unknown): void;
}
export function createLuckScheduler(state: State, ports: Ports) {
  function luckEligible(merchant: Status): Status[] {
    return ports
      .names()
      .map((name) => state.statuses[name])
      .filter(
        (status): status is Status =>
          !!status &&
          (status.name === state.merchantCharacter || status.ctype !== "merchant") &&
          !status.rip &&
          status.server === merchant.server &&
          !ports.strong(status),
      );
  }
  function tie(a: string, b: string): number {
    return a === state.merchantCharacter ? -1 : b === state.merchantCharacter ? 1 : 0;
  }
  function schedule(): false | undefined {
    if (played(state, 'merchantAutomations')["merchant luck"] === false) return false;
    const merchant = state.statuses[String(state.merchantCharacter)];
    if (!merchant || !fresh(merchant.seenAt, ports.now(), 'presence') || merchant.level < MERCHANT_LUCK.level) return undefined;
    if (
      [state.merchantCurrent, ...state.merchantQueue].some(
        (job) => job && !!merchantKind(job.reason).luck,
      )
    )
      return undefined;
    const due = luckEligible(merchant)
      .map((status) => ({ status, remaining: ports.remaining(status), lead: ports.lead(status) }))
      .filter((entry) => entry.remaining <= entry.lead)
      .sort((a, b) => a.remaining - b.remaining || tie(a.status.name, b.status.name));
    const trigger = due.find((entry) => entry.status.name !== state.merchantCharacter) || due[0];
    if (!trigger) return undefined;
    const target = trigger.status.name;
    ports.enqueue({ reason: "merchant luck", target, fields: { radius: MERCHANT_LUCK.range, expandLuckCluster: true, castMerchantLuck: true } });
    ports.log("Merchant's Luck refresh queued for " + target, "info", {
      target,
      remainingMs: trigger.remaining,
      estimatedTravelMs: trigger.lead - luckTravelMarginMs,
      marginMs: luckTravelMarginMs,
    });
    ports.persist();
    ports.dispatch();
    return undefined;
  }
  function snapshot() {
    const merchant = state.statuses[String(state.merchantCharacter)];
    if (!merchant || merchant.level < MERCHANT_LUCK.level) return null;
    const next = luckEligible(merchant)
      .map((status) => {
        const remainingMs = ports.remaining(status),
          leadMs = ports.lead(status);
        return {
          target: status.name,
          remainingMs,
          leadMs,
          dispatchInMs: Math.max(0, remainingMs - leadMs),
        };
      })
      .sort((a, b) => a.dispatchInMs - b.dispatchInMs || tie(a.target, b.target))[0];
    if (!next) return null;
    const active = !!state.merchantCurrent && !!merchantKind(state.merchantCurrent.reason).luck,
      queued = state.merchantQueue.some((job) => !!merchantKind(job.reason).luck);
    return {
      ...next,
      status: active ? "in progress" : queued ? "queued" : "scheduled",
      marginMs: luckTravelMarginMs,
    };
  }
  return { schedule, snapshot };
}

// The giveaway scheduler: it queues one entry per giveaway the merchant or ALData finds.
interface Giveaway {
  seller?: string;
  slot?: string;
  rid?: string;
  candidateKey?: string;
  expiresAt?: number;
  entrants?: (string | null)[];
  map?: string;
  x?: unknown;
  y?: unknown;
  item?: { name?: string; level?: number } | null;
  minutes?: unknown;
}
// A giveaway the merchant found itself reports the minutes it has left, not its end, so its end is
// those minutes from now; an ALData offer keeps its own `expiresAt`.
export function giveawayEnd(giveaway: { expiresAt?: number; minutes?: unknown }, now: number): number | undefined {
  if (giveaway.expiresAt !== undefined) return giveaway.expiresAt;
  const minutes = Number(giveaway.minutes);
  return Number.isFinite(minutes) && minutes > 0 ? now + minutes * 60_000 : undefined;
}
interface QueueEntry {
  slot?: string;
  realm?: string | null;
  candidateKey?: string;
  reason?: string;
  seller?: string;
  rid?: string;
}
interface GiveawayState {
  giveawayAttempts?: Record<string, number>;
  merchantCharacter: string | null;
  merchantAutomations: Record<string, boolean | undefined>;
  merchantCurrent?: QueueEntry | null;
  merchantQueue: QueueEntry[];
}
interface GiveawayPorts {
  now(): number;
  // The realm owner's refusal for a job's realm (merchant-realm rules.ts realmRefusal): a PVP
  // realm, or one on the blacklist.
  realmRefuses(realm: string): boolean;
  enqueue(ask: EnqueueAsk): EnqueueAnswer;
  log(message: string, level: string, details: unknown): void;
}
type EligibleGiveaway = Giveaway & { seller: string; slot: string };
function giveawayEligible(
  giveaway: Giveaway | null,
  merchant: string | null,
): giveaway is EligibleGiveaway {
  return (
    !!giveaway &&
    !!giveaway.seller &&
    !!giveaway.slot &&
    (!!giveaway.rid || !!giveaway.candidateKey) &&
    !(giveaway.entrants || []).includes(merchant)
  );
}

/** Discovery enqueues once per seller/offer; the normal merchant dispatcher owns execution. */
export function createGiveawayScheduler(state: GiveawayState, ports: GiveawayPorts) {
  function queued(giveaway: EligibleGiveaway, realm: string | null): boolean {
    return [state.merchantCurrent, ...state.merchantQueue].some(
      (job) =>
        !!job &&
        job.reason === "join giveaway" &&
        job.seller === giveaway.seller &&
        ((!job.realm || job.realm === realm) && (job.slot === giveaway.slot || (!!giveaway.rid && job.rid === giveaway.rid))),
    );
  }
  function schedule(
    status: { server?: string; nearbyGiveaways?: (Giveaway | null)[] } | null | undefined,
  ): void {
    if (
      played(state, 'merchantAutomations')["join giveaway"] === false ||
      !status ||
      !Array.isArray(status.nearbyGiveaways)
    )
      return;
    const merchant = state.merchantCharacter;
    const realm = normalizedRealm(status.server);
    if (!merchant || realm && ports.realmRefuses(realm)) return;
    for (const giveaway of status.nearbyGiveaways) {
      if (!giveawayEligible(giveaway, merchant) || queued(giveaway, realm)) continue;
      if (!claimAttempt(giveaway, realm)) continue;
      enqueueGiveaway(giveaway, realm, merchant);
    }
  }
  function enqueueGiveaway(giveaway: EligibleGiveaway, realm: string | null, merchant: string) {
      ports.enqueue({ reason: "join giveaway", target: merchant, fields: {
        seller: giveaway.seller,
        slot: giveaway.slot,
        rid: giveaway.rid,
        realm,
        candidateKey: giveaway.candidateKey,
        expiresAt: giveawayEnd(giveaway, ports.now()),
        expectedItem: giveaway.item,
        location: { map: giveaway.map, x: Number(giveaway.x), y: Number(giveaway.y) },
      } });
      ports.log("Discovered giveaway from " + giveaway.seller + "; queued entry", "info", {
        item: giveaway.item && giveaway.item.name,
        slot: giveaway.slot,
        minutes: giveaway.minutes,
      });
  }
  function claimAttempt(giveaway: EligibleGiveaway, realm: string | null): boolean {
    const attempts = (state.giveawayAttempts ||= {});
    for (const [key, expiry] of Object.entries(attempts)) if (expiry <= ports.now()) delete attempts[key];
    const key = giveaway.candidateKey || JSON.stringify([realm, giveaway.seller, giveaway.rid]);
    if (attempts[key] > ports.now() || Number(giveaway.expiresAt || Infinity) <= ports.now()) return false;
    // The 30 min claim ends at the giveaway's end when that comes first (3.9).
    attempts[key] = Math.min(ports.now() + 30 * 60_000, giveawayEnd(giveaway, ports.now()) ?? Infinity);
    return true;
  }
  function scheduleMarket(value: unknown): void {
    if (!Array.isArray(value)) return;
    for (const merchant of value) {
      if (!validMerchant(merchant)) continue;
      marketOffers(merchant).forEach(schedule);
    }
  }
  return { schedule, scheduleMarket };
}
interface MarketMerchant {id: string; lastSeen: string; map: string; x: number; y: number; serverRegion: string; serverIdentifier: string; slots?: Record<string, MarketOffer>}
interface MarketOffer {giveaway?: number; name?: string; level?: number; list?: string[]}
// The items owner's rule: a merchant the latest ALData snapshot holds is current, so no age check runs.
function validMerchant(value: unknown): value is MarketMerchant {
  if (!value || typeof value !== 'object') return false;
  const m = value as MarketMerchant;
  return Boolean(m.id && m.map && Number.isFinite(m.x) && Number.isFinite(m.y));
}
function marketOffers(merchant: MarketMerchant) {
  const realm = merchant.serverRegion + merchant.serverIdentifier;
  if (!realmParts(realm)) return [];
  const seen = Date.parse(merchant.lastSeen);
  return Object.entries(merchant.slots || {}).filter(([slot, item]) => slot.startsWith('trade') && item?.name && Number(item.giveaway) > 0).map(([slot, item]) => ({server: realm, nearbyGiveaways: [{seller: merchant.id, slot, item, entrants: item.list, map: merchant.map, x: merchant.x, y: merchant.y,
    candidateKey: JSON.stringify([realm, merchant.id, slot, item.name, item.level || 0]), expiresAt: seen + Number(item.giveaway) * 60_000}]}));
}

// The clusters: on arrival the running job's nearby members join its itinerary.
export interface ClusterStatus {
  seenAt: number;
  map: string;
  x?: number;
  y?: number;
  server?: string;
  ctype?: string;
  rip?: boolean;
}
export interface ClusterJob extends MerchantWork {
  batchId?: string;
  clusterMembers?: string[];
}
export interface ClusterState {
  merchantCharacter: string | null;
  merchantCurrent: ClusterJob | null;
  merchantQueue: ClusterJob[];
  statuses: Record<string, ClusterStatus | undefined>;
  marked: Record<string, unknown[] | undefined>;
  merchantMarked: Record<string, unknown[] | undefined>;
}
export interface ClusterPorts {
  now(): number;
  nextCommand(): number;
  active(): string[];
  stamp(job: ClusterJob): ClusterJob;
  log(message: string, level: string, details: unknown): void;
  persist(): void;
}

function distance(a: ClusterStatus, b: ClusterStatus): number {
  return Math.hypot(
    (Number(a.x) || 0) - (Number(b.x) || 0),
    (Number(a.y) || 0) - (Number(b.y) || 0),
  );
}

export function createMerchantClusters(state: ClusterState, ports: ClusterPorts) {
  function hasMarks(name: string): boolean {
    return !!(state.marked[name] || []).length || !!(state.merchantMarked[name] || []).length;
  }
  function clusterNearby(
    job: ClusterJob,
    anchor: ClusterStatus,
    radius: number,
    marked: boolean,
  ): string[] {
    return ports.active().filter((name) => {
      if (name === job.target || name === state.merchantCharacter || (marked && !hasMarks(name)))
        return false;
      const status = state.statuses[name];
      return !!status && status.map === anchor.map && distance(status, anchor) <= radius;
    });
  }
  function queued(target: string, reason: string): ClusterJob {
    return {
      id: "merchant-" + ports.now() + "-" + ports.nextCommand(),
      target,
      reason,
      queuedAt: ports.now(),
    };
  }
  // A cluster resolved on arrival is the running job's itinerary: its stops go to the head of the
  // queue in order, outside `jobs.enqueue`'s merge (part 9 correction 2), and each is a queued job.
  function ahead(jobs: ClusterJob[]): void {
    state.merchantQueue.unshift(...jobs);
    for (const job of jobs)
      recordMerchant({ subject: String(state.merchantCharacter), decision: 'queued', owner: 'job:' + job.id, kind: job.reason });
  }
  function leader(job: ClusterJob, anchor: ClusterStatus, radius: number): string[] {
    const names = clusterNearby(job, anchor, radius, false).sort(
      (a, b) => distance(state.statuses[a]!, anchor) - distance(state.statuses[b]!, anchor),
    );
    const existing = new Set(
      [state.merchantCurrent, ...state.merchantQueue]
        .filter((entry) => !!entry)
        .map((entry) => entry.target + "\n" + entry.reason),
    );
    ahead(names.filter((name) => !existing.has(name + "\nparty collection")).map((name) => queued(name, "party collection")));
    job.clusterExpanded = true;
    job.clusterMembers = names;
    ports.log("Leader cluster resolved on arrival", "info", {
      leader: job.target,
      radius,
      nearby: names,
    });
    ports.persist();
    return names;
  }
  function marked(job: ClusterJob, anchor: ClusterStatus): string[] {
    const names = clusterNearby(job, anchor, 200, true),
      batchId = job.batchId || (job.batchId = "marked-" + job.id);
    job.clusterExpanded = true;
    job.clusterMembers = names;
    const members = new Set<string | null>(names);
    state.merchantQueue = state.merchantQueue.filter(
      (entry) => !(entry.reason === "marked items" && members.has(entry.target)),
    );
    ahead(names.map((name) => ports.stamp({ ...queued(name, "marked items"), batchId, clusterExpanded: true })));
    ports.log("Marked-item collection cluster resolved on arrival", "info", {
      anchor: job.target,
      nearby: names,
    });
    ports.persist();
    return names;
  }
  function luckRecipients(job: ClusterJob, center: ClusterStatus, radius: number): string[] {
    return ports
      .active()
      .filter((name) => {
        const status = state.statuses[name];
        return (
          !!status &&
          status.ctype !== "merchant" &&
          !status.rip &&
          status.server === center.server &&
          status.map === center.map &&
          distance(status, center) <= radius
        );
      })
      .sort((a, b) => (a === job.target ? -1 : b === job.target ? 1 : 0));
  }
  function luck(job: ClusterJob, center: ClusterStatus, radius: number): string[] {
    const recipients = luckRecipients(job, center, radius);
    job.batchId ||= job.id;
    const existing = new Set(
      [state.merchantCurrent, ...state.merchantQueue]
        .filter(
          (entry) => entry && !!merchantKind(entry.reason).luck,
        )
        .map((entry) => entry!.target),
    );
    const additions = recipients
      .filter((name) => name !== job.target && !existing.has(name))
      .map((name) => ({
        ...queued(name, "merchant luck"),
        batchId: job.batchId,
        expandLuckCluster: false,
        castMerchantLuck: true,
        radius,
      }));
    ahead(additions.map((entry) => ports.stamp(entry)));
    job.clusterExpanded = true;
    job.clusterMembers = recipients;
    ports.log("Merchant's Luck party itinerary resolved on arrival", "info", {
      center: job.target,
      radius,
      recipients,
    });
    ports.persist();
    return recipients;
  }
  return { leader, marked, luck };
}

// The per-report scheduling: each status report queues the work it shows.
type GiveawayReport = NonNullable<
  Parameters<ReturnType<typeof createGiveawayScheduler>["schedule"]>[0]
>;

interface SchedulingReport extends GiveawayReport {
  name: string;
  merchantCommand?: MerchantCommandReport;
  items?: (ObservedInventoryEntry | null)[];
  gatheringCooldowns?: Record<string, number>;
  nearbyStandListings?: unknown;
  gold?: number;
  // The equipment slots the report carries, which the delivery equip's signature reads.
  slots?: Record<string, { item: Item } | null>;
}

// The lucky slot fields (the items owner's LuckySlots) and the protected free slots are what bagFull asks 10 for.
interface SchedulingState extends LuckySlots {
  protectedFreeSlots?: unknown;
  nextCommandId?: number;
  commands?: Record<string, {id?: number; type: string; items?: unknown[]; deliveryIds?: (string | undefined)[]} | undefined>;
  merchantDeliveries?: Record<string, DeliveryRequest[] | undefined>;
  withdrawals?: Record<string, unknown[] | undefined>;
  merchantCharacter: string | null;
  merchantCurrent: MerchantWork | null;
  merchantQueue: MerchantWork[];
  merchantAutomations: Record<string, boolean | undefined>;
  gatheringModes: string[];
  gatheringCooldowns: Record<string, number | undefined>;
  merchantCapacityBlocked: boolean;
  transferSignatures: Record<string, string>;
  itemCollectionThreshold: number;
  upgrades: Record<string, unknown[] | undefined>;
  compounds: Record<string, unknown[] | undefined>;
  purchases?: Record<string, unknown[] | undefined>;
  statScrolls: Record<string, unknown[] | undefined>;
  marked: Record<string, ItemMark[] | undefined>;
  merchantMarked: Record<string, ItemMark[] | undefined>;
  statuses: Record<string, SchedulingReport | undefined>;
  // The items owner's bank queue holds the visit's command type, `bank` or `upgrade` (items/coordinator/storage.ts).
  bankCurrent: { name: string; type: string } | null;
  bankQueue: { name: string; type: string }[];
  bankStartedAt: number;
  threshold: number;
  thresholdRunActive: boolean;
  bankCycleMembers: Record<string, boolean>;
}

interface SupplyRule {
  item: string;
  min: number;
  max: number;
}
interface SchedulingPorts {
  log?(message: string, level: string, details?: unknown): void;
  /** The items owner's per-report pass: whether the report changed a mark, intent, sale or lease. */
  reconcileReport(report: SchedulingReport): boolean;
  luck(): void;
  recovery(name: string, items: SchedulingReport["items"], command?: MerchantCommandReport): void;
  standMarket(listings: unknown): boolean;
  giveaways(report: SchedulingReport): void;
  compounds(name: string, report: SchedulingReport | undefined): void;
  exchanges(report: SchedulingReport | undefined): void;
  policy(name: string): RestockPolicy;
  elixirReady?(name:string, rule:ElixirPolicy, have:number):boolean;
  queue(names: string[], reason: JobReason): void;
  markedItem(mark: ItemMark): Item | null | undefined;
  sameItem(left: Item | null | undefined, right: Item | null | undefined): boolean;
  collectionSlots(name: string): number;
  standSync(): void;
  dispatch(): void;
  idle(): void;
  // Whether an add-on declares a merchant job kind or proposes a job (the merchant jobs owner's merchantJobs.proposes).
  addonProposes(): boolean;
  // The job recovery's offline read (recovery.ts `expire`) behind the dispatch pass's first two holds.
  expire(): void;
  // The lifecycle owner's command slots: the slot's command goes only when `matches` names it.
  clearOwnedCommand(name: string, matches: (command: { type: string }) => boolean): unknown;
  dispatchBank(): void;
  // The members the party runs now (the lifecycle owner's roster).
  activeNames(): string[];
  persist(): void;
  now(): number;
}

// The items owner's free slots: the bag's empty cells past the lucky slot's hold; a bag at or under its
// protected free slots blocks collections and asks for a cleanout.
function bagFull(state: SchedulingState, name: string | null, items: SchedulingReport["items"]): boolean {
  return freeSlots(items, luckySlotOf(state, String(name)), 0) <= protectedSlotsOf(state, String(name));
}

function countItem(items: (InventoryEntry | null)[], name: string): number {
  return items.reduce(
    (total, entry) => total + (entry?.item?.name === name ? Number(entry.item.q) || 1 : 0),
    0,
  );
}

function needsSupply(rule: SupplyRule, items: (InventoryEntry | null)[]): boolean {
  return rule.max > 0 && countItem(items, rule.item) <= rule.min;
}

/** Schedules work in heartbeat order, including dispatch before the reporting fighter's supplies. */
export function createMerchantScheduling(state: SchedulingState, ports: SchedulingPorts) {
  function reconcile(report: SchedulingReport, hadPreviousStatus: boolean): void {
    // Partial reconnect snapshots must not erase durable inventory intent.
    if (!hadPreviousStatus) return;
    if (ports.reconcileReport(report)) ports.persist();
  }

  function cooldowns(report: SchedulingReport): void {
    if (!report.gatheringCooldowns) return;
    let changed = false;
    for (const mode of GATHERING_MODES) {
      const reported = Number(report.gatheringCooldowns[mode]) || 0;
      if (reported <= (Number(state.gatheringCooldowns[mode]) || 0)) continue;
      state.gatheringCooldowns[mode] = reported;
      changed = true;
    }
    if (changed) ports.persist();
  }

  function supplies(report: SchedulingReport): void {
    if (played(state, 'merchantAutomations').restock === false || !Array.isArray(report.items)) return;
    const policy = ports.policy(report.name);
    if (needsSupply(policy.hp, report.items) || needsSupply(policy.mp, report.items) ||
        policy.elixir && needsSupply(policy.elixir, report.items) && ports.elixirReady?.(report.name,policy.elixir,countItem(report.items,policy.elixir.item)))
      ports.queue([report.name], "restock");
  }

  function merchantInventory(report: SchedulingReport): void {
    ports.exchanges(state.statuses[report.name]);
    supplies(report);
    const blocked = bagFull(state, report.name, report.items);
    if (blocked && !state.merchantCapacityBlocked) state.transferSignatures = {};
    state.merchantCapacityBlocked = blocked;
    const collection = bankCollectionReason(state);
    if (collection) ports.queue([report.name], collection);
  }

  function upgradeWork(report: SchedulingReport) {
    const upgrades = (state.upgrades[report.name] || []).filter(mark => upgradeOfferingReady(state, mark));
    if (upgrades.some(mark => !(mark as {auto?: boolean})?.auto) || state.statScrolls[report.name]?.length) ports.queue([report.name], "manual upgrades");
    else clearEmptyManualUpgrade(report.name);
    if (played(state, 'merchantAutomations')["auto upgrade"] !== false && upgrades.some(mark => (mark as {auto?: boolean})?.auto))
      ports.queue([report.name], report.name === state.merchantCharacter ? "auto upgrade" : "marked items");
  }
  function clearEmptyManualUpgrade(name: string) {
    state.merchantQueue = state.merchantQueue.filter(value => {
      const job = value as {target?: string; reason?: string};
      return job.target !== name || job.reason !== 'manual upgrades';
    });
  }
  function manualImprovements(report: SchedulingReport) {
    upgradeWork(report);
    if (state.compounds[report.name]?.length) ports.queue([report.name], "manual compounds");
    if (state.purchases?.[report.name]?.length) ports.queue([report.name], "manual buying");
    if (played(state, 'merchantAutomations').deliveries !== false &&
        (state.merchantDeliveries?.[report.name] || []).some(deliveryReady))
      ports.queue([report.name], "deliveries");
  }
  function collectionSignature(report: SchedulingReport): string {
    const marks = [
      ...(state.marked[report.name] || []).map((mark) => ({ mode: "bank", mark })),
      ...(state.merchantMarked[report.name] || []).map((mark) => ({ mode: "merchant", mark })),
    ].filter(({ mark }) =>
      (report.items || []).some(
        (entry) => entry && ports.sameItem(entry.item, ports.markedItem(mark)),
      ),
    );
    return JSON.stringify(
      marks.map(({ mode, mark }) => ({ mode, slot: mark.slot, item: ports.markedItem(mark) })),
    );
  }

  function collection(report: SchedulingReport): void {
    if (played(state, 'merchantAutomations')["party collection"] === false) return;
    if (bagFull(state, state.merchantCharacter, state.statuses[String(state.merchantCharacter)]?.items)) return;
    const signature = collectionSignature(report);
    if (
      ports.collectionSlots(report.name) >= state.itemCollectionThreshold &&
      state.transferSignatures[report.name] !== signature
    )
      ports.queue([report.name], "marked items");
    if (ports.collectionSlots(report.name) >= state.itemCollectionThreshold)
      state.transferSignatures[report.name] = signature;
    else delete state.transferSignatures[report.name];
  }

  function observeMerchant(report: SchedulingReport): void {
    cooldowns(report);
    ports.recovery(report.name, report.items, report.merchantCommand);
    if (ports.standMarket(report.nearbyStandListings)) ports.persist();
    ports.giveaways(report);
  }

  function fighterInventory(report: SchedulingReport): void {
    if (!Array.isArray(report.items)) return;
    supplies(report);
    if (bagFull(state, report.name, report.items) && played(state, 'merchantAutomations')["inventory cleanout"] !== false)
      ports.queue([report.name], "inventory cleanout");
  }

  // The items owner's rule: the bank slot frees when its holder stops reporting present and alive, or when a
  // higher-ranked command took the holder's slot, whose visit then waits at the queue's head. With
  // no visit running, each report asks the queue for its next visit, which a refused write left.
  function recoverBank(): void {
    const stall = bankVisitStalled(state, ports.now());
    if (state.bankCurrent && !stall) return;
    const visit = state.bankCurrent;
    if (visit) {
      // Only the visit's own command goes, of the type the bank queue sent; a newer command stays.
      ports.clearOwnedCommand(visit.name, command => command.type === visit.type);
      if (stall === 'slot-taken') state.bankQueue.unshift(visit);
      state.bankCurrent = null;
    }
    ports.dispatchBank();
  }

  function goldThreshold(): void {
    const names = ports.activeNames()
      .filter((name) => name !== state.merchantCharacter && Number(state.statuses[name]?.gold) > state.threshold);
    if (!names.length) {
      state.thresholdRunActive = false;
      state.bankCycleMembers = {};
      return;
    }
    if (!state.thresholdRunActive) {
      state.thresholdRunActive = true;
      state.bankCycleMembers = {};
    }
    const newcomers = names.filter((name) => !state.bankCycleMembers[name]);
    for (const name of newcomers) state.bankCycleMembers[name] = true;
    if (played(state, 'merchantAutomations')["gold threshold"] !== false)
      ports.queue(newcomers, "gold threshold");
  }

  function pendingEquipment(name: string): DeliveryRequest[] {
    return (state.merchantDeliveries?.[name] || []).filter(mark => mark.awaitingEquip && mark.item && mark.equipFailedAt === undefined);
  }
  // The items owner's rule: resumeDeliveryEquip sends a delivery equip again only when the recipient's bag or
  // equipment changed since the last send. It builds that signature only for a member with a
  // delivery waiting on its equip, so other reports do no extra work.
  const equipSent = new Map<string, string>();
  function equipmentSignature(name: string): string {
    const report = state.statuses[name];
    return JSON.stringify([report?.items ?? null, report?.slots ?? null]);
  }
  function resumeDeliveryEquip(name: string): void {
    if (!state.commands || state.nextCommandId === undefined) return;
    const marks = pendingEquipment(name);
    const items = marks.map(mark => mark.item!);
    if (!items.length) return;
    if (equipSent.get(name) === equipmentSignature(name)) return;
    if (!equipmentOwnsSlot(name)) return;
    const command = {id: state.nextCommandId++, type:'equip-deliveries', items, deliveryIds: marks.map(mark => mark.id)};
    attachMerchantInterruption(state, name, command);
    state.commands[name] = command;
    equipSent.set(name, equipmentSignature(name));
    ports.persist();
  }
  function equipmentOwnsSlot(name: string): boolean {
    const command = state.commands?.[name];
    if (command && command.type !== 'party-monster-travel') return false;
    const admitted = admitMerchantInterruption(state, name, 'delivery-equipment:' + name, ports.now(), MERCHANT_PAUSE_DEADLINE_MS, 'equipment');
    if (!admitted) ports.persist();
    return admitted;
  }
  function reconcileDeliveryState(): void {
    const deliveryChanges = reconcileDeliveries(state.merchantDeliveries || {},
      state.statuses[String(state.merchantCharacter)], state.statuses, ports.now());
    if (deliveryChanges.length) {
      ports.persist();
      for (const message of deliveryChanges) ports.log?.(message, 'info');
    }
  }
  function observe(report: SchedulingReport, hadPreviousStatus: boolean): void {
    reconcileDeliveryState();
    resumeDeliveryEquip(report.name);
    const merchant = report.name === state.merchantCharacter;
    reconcile(report, hadPreviousStatus);
    ports.luck();
    if (merchant) observeMerchant(report);
    ports.compounds(report.name, state.statuses[report.name]);
    manualImprovements(report);
    if (merchant) merchantInventory(report);
    else collection(report);
    if (merchant) ports.standSync();
    // An add-on's kinds and its proposed job join only in the dispatch pass (dispatch.ts
    // `addonJobs`), so an idle merchant with an empty queue dispatches while an add-on proposes.
    if (state.merchantCurrent?.phase === 'switching party realm' ||
        !state.merchantCurrent && (state.merchantQueue.length || played(state, 'gatheringModes').length || ports.addonProposes()))
      ports.dispatch();
    else {
      // The dispatch pass reads the offline merchant's job, but no report dispatches while that
      // job is current, and a merchant that stopped reporting sends none of its own, so each party
      // report asks here.
      if (state.merchantCurrent) ports.expire();
      ports.idle();
    }
    // The items owner's BankBoi storage starts when it has work; a failed start is logged and the next
    // report asks again.
    items().startStorage().catch((error: Error) =>
      ports.log?.("Bankboi scheduler failed", "error", String(error.message || error)));
    if (!merchant) fighterInventory(report);
    recoverBank();
    goldThreshold();
  }
  return { observe };
}

// The automatic sources on the coordinator's records: giveaways, improvements, NPC sales and luck.
type AutomationState = Parameters<typeof createGiveawayScheduler>[0] &
  Parameters<typeof createImprovementScheduler>[0] &
  Parameters<typeof createAutomaticMerchantSales>[0] &
  Parameters<typeof createLuckScheduler>[0] & { nextCommandId: number };
// The cast times the luck scheduler falls back on when a report names no remaining time.
type LuckCastState = { mluckCastAt?: Record<string, number | undefined> };
type LuckPorts = Parameters<typeof createLuckScheduler>[1];
interface AutomationPorts {
  now: () => number;
  realmRefuses: (realm: string) => boolean;
  enqueue: (ask: EnqueueAsk) => EnqueueAnswer;
  log: (message: string, level: string, details?: unknown) => void;
  persist: () => void;
  queue: (names: string[], reason: JobReason) => void;
  publish: () => void;
  syncStand: () => boolean;
  idle: () => void;
  dispatch: () => void;
  names: () => string[];
  strong: (...args: Parameters<LuckPorts["strong"]>) => boolean;
  lead: (...args: Parameters<LuckPorts["lead"]>) => number;
}

/** Automatic merchant work shares a live command sequence and the same durable dispatch pipeline. */
export function createCoordinatorMerchantAutomation(
  state: AutomationState & LuckCastState,
  ports: AutomationPorts,
) {
  const shared = {
    now: ports.now,
    nextCommand: () => state.nextCommandId++,
    enqueue: ports.enqueue,
    log: ports.log,
    persist: ports.persist,
    queue: ports.queue,
  };
  const giveaways = createGiveawayScheduler(state, { ...shared, realmRefuses: ports.realmRefuses });
  const improvements = createImprovementScheduler(state, shared);
  const sales = createAutomaticMerchantSales(state, {
    ...shared,
    publish: ports.publish,
    syncStand: ports.syncStand,
    idle: ports.idle,
  });
  const luck = createLuckScheduler(state, {
    ...shared,
    names: ports.names,
    strong: ports.strong,
    // A luck's remaining time: the report's own figure, else the last cast we saw.
    remaining: status => mluckRemaining(status, state.merchantCharacter, status && Number(state.mluckCastAt?.[String(status.name)]), ports.now()),
    lead: ports.lead,
    dispatch: ports.dispatch,
  });
  return { giveaways, improvements, sales, luck };
}
