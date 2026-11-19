// The items owner on the coordinator: the install, the state handle, the per-report pass, the
// timers and the published answers. application.ts installs it with one line and asks the returned
// owner where it named the items owner's closures.
import type { Registration } from '../../hooks/registry.ts';
import { partyHooks } from '../../hooks/index.ts';
import { fresh } from '../../protocol/reports.ts';
import { isBankboiPack, isInventoryPack, markMatches, stackQuantity, type ItemCopy } from '../identity.ts';
import type { JobReason } from '../../merchant-jobs/api.ts';
import { bankStagingReserved, freeSlots, luckySlotOf, protectedSlotsOf, sharedMember, standSlotUse, usableCopy, type LuckySlots } from '../rules.ts';
import { bagClaims, claimId, claimPending, itemFate, publishAddonFates, itemStock, reconcileCoordinatorCollectionMarks, refusedClaims, stageClaimWithdrawals,
  type FateState } from './fates.ts';
import { recordItems } from './records.ts';
import { itemNeeds, createRealmStay, protectedMerchantStorageStock, workingGold, type NeedsState, type StayPorts } from './needs.ts';
import { blockNpcSales, consumePontyReport, failNpcSales, merchantBlocked, recordMerchantFailure, type MerchantBlock, type MerchantIdentity, type NpcSale } from './market.ts';
import { pendingProduction, reconcileCoordinatorCompoundMarks, reconcileCoordinatorUpgradeMarks, receiveLuckySlotTracking, type LuckySlotState,
  type ProductionState } from './production.ts';
import { accountRefresh, consumeBankReport, createBankQueue, homes, servicePlan, settleSortLease, type BankSortState, type BankboiInventory } from './storage.ts';
import { publishItems, type RecoverCommand } from './api.ts';
import type { ScopeHandle } from '../../lifecycle/api.ts';
import { createMailJobs, startCoordinatorMail, type MailInbox, type MailJobPorts, type MailJobState, type MailStartupPorts } from './mail.ts';
import { createSendMailRoute } from './routes/mail.ts';

type MarkState = Parameters<typeof reconcileCoordinatorCollectionMarks>[0] & Parameters<typeof reconcileCoordinatorUpgradeMarks>[0] &
  Parameters<typeof reconcileCoordinatorCompoundMarks>[0];
type BankQueueState = Parameters<typeof createBankQueue>[0];
type MailState = Parameters<typeof startCoordinatorMail>[0];
type SnapshotState = Parameters<typeof consumeBankReport>[1];
type PontyObservation = NonNullable<ReturnType<typeof consumePontyReport>>;
type Report = NonNullable<Parameters<typeof reconcileCoordinatorCollectionMarks>[2]> & {
  seenAt?: number; rip?: unknown; combatSelection?: { runtimeId?: string }; lastCommandId?: number;
  items?: ({ slot: number; item: import('../../coordinator/contracts/item.ts').Item } | null)[] };
type PlanState = Parameters<typeof servicePlan>[0];
interface Mark { slot?: number; item?: ItemCopy | null }
/** The coordinator state the items owner reads and writes; the coordinator's party record is it. */
export type ItemsState = FateState & NeedsState & LuckySlots & LuckySlotState & MarkState & BankQueueState & BankSortState & MailState & SnapshotState & PlanState & {
  statuses: Record<string, Report | undefined>;
  merchantBlacklist: Record<string, MerchantBlock>;
  autoBlacklistMerchants?: boolean;
  nextCommandId: number;
  merchantDeliveries: Record<string, Mark[] | undefined>;
  npcSaleMarks: NpcSale[];
  standListings: Mark[];
  bankVaults?: unknown;
  bankbois: Record<string, BankboiInventory>;
  goldTargets: Record<string, number | undefined>;
  merchantCatalog?: unknown;
  production: ProductionState;
  bankboiTransaction?: unknown;
  protectedFreeSlots?: unknown;
};
/** The game account the coordinator signed in with: its roster and realm list. */
export interface ItemsAccount {
  response: { characters?: { name: string }[] | null };
  resolve_realm(realm: string): unknown;
  updateInfo(): Promise<unknown>;
}
export type ItemsPorts = StayPorts & {
  account: ItemsAccount;
  persist(): void;
  /** Whether the lifecycle owner's console update holds the merchant's work. */
  merchantHeld(): boolean;
  queue(names: (string | null)[], reason: JobReason): void;
  /** The deconstruction reconcile of a member's report: whether it changed. */
  deconstruct(name: string): boolean;
  /** The automatic sale reconcile of a member's report: whether it changed. */
  automaticSales(report: Report & { name: string }): boolean;
  /** The member's account character id, which binds its lucky slot evidence. */
  characterId(name: string): string | undefined;
  observePonty(observation: PontyObservation): void;
  adoptReservedCargo(): void;
  persistBank(): void;
  /** The market feeds' ask and the publication check. */
  marketReport(): void;
  /** Whether a reader needs Ponty's listings now (market.ts `wanted`). */
  pontyWanted(): boolean;
  /** The BankBoi transactions storage.ts's `createBankboiStorage` runs. */
  storage: { busy(): boolean; start(): Promise<void> };
  /** The items owner's handle on the coordinator run scope: the shutdown's stop releases its timers. */
  scope: Pick<ScopeHandle, 'setTimeout'>;
  log(message: string, level: 'info' | 'error', details?: unknown): void;
};
/** The manual restock route's answers the elixir check reads (F4's restock claim). */
interface RestockRoute { restockPending(item: string): boolean; restockSupply(item: string, quantity: number): void }

/**
 * The `core:items` registration: the realm stay hears the merchant job owner's job notices,
 * and section 6 part 3's reads that the items owner answers on the coordinator. A read whose code is
 * not built yet has no answer.
 */
function itemsRegistration(state: ItemsState, stay: ReturnType<typeof createRealmStay>, answers: ReturnType<typeof jobAnswers>,
  claims: ReturnType<typeof claimsKeeper>): Registration {
  return { name: 'core:items', folder: 'core', author: 'adventureland-party-console',
    summary: 'Holds the merchant on a realm where its next jobs are, and answers the item reads.',
    hooks: {
      'merchant.job.ended': (notice: { kind?: string }) => stay.ended(String(notice.kind ?? '')),
      'merchant.job.queued': () => stay.changed(),
      'merchant.job.started': () => stay.changed(),
      // claimsKeeper checks an add-on's claims against their places when it loads.
      'addon.on': (notice: { name?: unknown }) => claims.load(String(notice.name)),
      'items.needs': job => itemNeeds(state, job),
      // One copy's fate, and the copies a character may use with the claims kept.
      'items.fate': (name, slot) => itemFate(state, name, slot, claims.refused),
      'items.stock': (name, item) => itemStock(state, name, item, claims.refused),
      'items.claimPending': (name, by) => claimPending(state, name, by),
      'items.freeSlots': name => freeSlots(state.statuses[name]?.items, luckySlotOf(state, name), protectedSlotsOf(state, name)),
      'items.luckySlot': name => luckySlotOf(state, name),
      'items.standSlots': () => standSlotUse(state as Parameters<typeof standSlotUse>[0]),
      'items.bank': () => state.bankSnapshot ?? null,
      // The merchant jobs owner's holds: the merchant's BankBoi storage and its production journal hold its jobs.
      'items.storagePending': answers.storagePending,
      'items.productionPending': answers.productionPending,
    } } as Registration;
}

/**
 * 3.3 and: the add-on claims refused at load, and each claim left short in play. A refusal names
 * the claim it overran in the log and sends `items.claimRefused`; a shortfall sends
 * `items.claimShort` when it changes. Core claims rank first and send neither: a restock range is
 * refilled by its min. On the merchant's report an `all` claim's stored copies are staged.
 */
function claimsKeeper(state: ItemsState, log: ItemsPorts['log']) {
  const refused = new Set<string>(), short = new Map<string, number>();
  return {
    refused: refused as ReadonlySet<string>,
    load(addon: string): void {
      for (const { claim, over } of refusedClaims(state, addon, refused)) {
        refused.add(claimId(claim));
        log(`${claim.by}'s claim of ${claim.item.name} at ${claim.place} does not fit its place` +
          (over ? ` after ${over.by}'s claim` : ''), 'error', { claim, over });
        recordItems({ decision: 'claimRefused', subject: addon, by: claim.by, item: claim.item.name, place: claim.place });
      }
    },
    // The per-report pass of one bag, while an `items.claim` answer claims (3.3); whether a staged
    // withdrawal changed.
    report(name: string): boolean {
      if (!partyHooks().itemRules.claiming()) return false;
      const seen = new Set<string>();
      for (const { claim, short: missing } of bagClaims(state, name, refused).short) {
        const id = name + '|' + claimId(claim);
        seen.add(id);
        if (short.get(id) === missing) continue;
        short.set(id, missing);
        recordItems({ decision: 'claimShort', subject: name, by: claim.by, item: claim.item.name, short: missing });
      }
      for (const id of short.keys()) if (id.startsWith(name + '|') && !seen.has(id)) short.delete(id);
      return stageClaimWithdrawals(state, name, refused);
    },
  };
}

/**
 * And section 4: the merchant's storage and production holds the merchant job owner's job
 * owner asks, and the acting answers it calls (`startStorage`, `recover`, `failNpcSales`).
 */
export function jobAnswers(state: ItemsState, ports: Pick<ItemsPorts, 'storage' | 'log'>, nextCommand: () => number) {
  // The pending journal the merchant last heard of, and the recover command sent for it.
  const recovery = { pending: '', sent: null as number | null };
  const merchant = () => String(state.merchantCharacter);
  return {
    // Storage work waits while a BankBoi transaction runs or the service plan names a transfer.
    storagePending: (name: string) => name === state.merchantCharacter &&
      (ports.storage.busy() || !!state.bankboiTransaction || !!servicePlan(state)),
    // The merchant job owner's hold order asks this before its merchantUnfit fact, so the
    // pending list is logged here once per change, as the previous release's productionHeld logged
    // it before its alive check.
    productionPending(name: string): boolean {
      if (name !== state.merchantCharacter) return false;
      const pending = pendingProduction(state.production), identity = pending.length ? JSON.stringify(pending) : '';
      if (identity && recovery.pending !== identity)
        ports.log('Production recovery pending; merchant work held for receipt reconciliation', 'error', {pending});
      recovery.pending = identity;
      return pending.length > 0;
    },
    startStorage: () => ports.storage.start(),
    /**
     * The merchant job owner's hold: the merchant's recover command while its production
     * journal is pending. The next command goes once the merchant's report shows the last one
     * applied or replaced (`lastCommandId`); a deferred one stays in its slot, and the merchant
     * runs it again itself.
     */
    recover(): RecoverCommand | null {
      if (!pendingProduction(state.production).length) { recovery.sent = null; return null; }
      const applied = Number(state.statuses[merchant()]?.lastCommandId);
      if (recovery.sent !== null && !(applied >= recovery.sent)) return null;
      recovery.sent = nextCommand();
      return {id: recovery.sent, type: 'merchant-production-recover'};
    },
    // The `failsSales` rule: the sales a failed command attempted wait their
    // backoff.
    failNpcSales(ids: readonly string[], error: string, code?: unknown): void {
      state.npcSaleMarks = failNpcSales(state.npcSaleMarks, ids, error, Date.now(), code);
    },
    // The sales a completion reports blocked (`npcSalesBlocked`) wait until the merchant's bag
    // changes, by the one block rule market.ts's reconcile reads.
    blockNpcSales(blocked: readonly { id: string; error?: unknown; code?: unknown }[]): void {
      blockNpcSales(state.npcSaleMarks, blocked, state.statuses[String(state.merchantCharacter)]?.items || []);
    },
  };
}

// The core:items registration and the merchant jobs owner's answers, published once by installItems. The unit
// harness publishes through it too, so its tests see the production hook wiring.
export function publishItemsAnswers(state: ItemsState, ports: StayPorts & Pick<ItemsPorts, 'storage' | 'log'>,
  nextCommand: () => number) {
  const answers = jobAnswers(state, ports, nextCommand), claims = claimsKeeper(state, ports.log);
  partyHooks().publish(itemsRegistration(state, createRealmStay(ports), answers, claims));
  publishItems(answers);
  return claims;
}

// The mail jobs read the merchant queue as 08 types it (MailJobState), so the install takes both views of the state.
export function installItems(state: ItemsState & MailJobState, ports: ItemsPorts) {
  const nextCommand = () => state.nextCommandId++;
  const claims = publishItemsAnswers(state, ports, nextCommand);
  const bankQueue = createBankQueue(state, { now: () => Date.now(), nextCommand });
  let inbox: MailInbox | undefined;
  // The member's current runner while its report counts it online (`presence`); a dead member
  // has none, so its sort checkpoints answer as interrupted.
  function runtime(name: string): string | undefined {
    const status = state.statuses[name];
    return status && !status.rip && fresh(status.seenAt, Date.now(), 'presence', 0, true) ? status.combatSelection?.runtimeId : undefined;
  }
  function reconcileIntents(name: string, status?: Report): boolean {
    if (!sharedMember(state, name)) return false;
    const compounds = reconcileCoordinatorCompoundMarks(state, name, status);
    return reconcileCoordinatorUpgradeMarks(state, name, status) || compounds;
  }
  return {
    nextCommand,
    runtime,
    // A rule member's upgrade and compound intents after a command changes them.
    reconcileIntents,
    // A member's automatic marks after a mark command changes them.
    reconcileMarks: (name: string, status?: Report) => reconcileCoordinatorCollectionMarks(state, name, status, claims.refused),
    // A seller is skipped while its backoff runs; automatic purchases read the blacklist
    // only while the player's "Block failed merchants automatically" is on.
    blacklistingEnabled: () => state.autoBlacklistMerchants !== false,
    blacklisted: (entry?: MerchantIdentity | null) =>
      merchantBlocked(state.merchantBlacklist, entry, Date.now(), state.autoBlacklistMerchants !== false),
    blacklist: (listing: MerchantIdentity, reason: string) => recordMerchantFailure(state.merchantBlacklist, listing, reason, Date.now()),
    // A Ponty or ALData lot counts only on a realm the account lists.
    realmExists: (realm: string) => !!ports.account.resolve_realm(realm),
    /**
     * The per-report pass: a member's report reconciles its automatic marks, a rule member's intents,
     * the automatic sales and deconstruction, and the merchant's sort lease, once. The report
     * carries the merchant's runtime, so a lease settles on the report that shows a new one.
     */
    reconcileReport(report: Report & { name: string }): boolean {
      const marks = reconcileCoordinatorCollectionMarks(state, report.name, report, claims.refused);
      const intents = reconcileIntents(report.name, report);
      // The deconstruction reconciles before the automatic sales, and either change counts.
      const deconstructed = ports.deconstruct(report.name), sales = ports.automaticSales(report) || deconstructed;
      const lease = report.name === state.merchantCharacter && settleSortLease(state, report.rip ? undefined : report.combatSelection?.runtimeId);
      const fetches = claims.report(report.name), fates = publishAddonFates(state, report.name, claims.refused);
      return marks || intents || sales || lease || fetches || fates;
    },
    // The bank queue starts its next character's visit unless the console update holds the merchant.
    dispatchBank(): void {
      if (!ports.merchantHeld()) bankQueue.dispatch();
    },
    // An exchange that needs bank copies queues the merchant's bank visit for them; a BankBoi
    // withdrawal is the BankBoi's own transaction.
    collectOfferings(): void {
      const requests = state.withdrawals[String(state.merchantCharacter)] || [];
      if (requests.some(request => !isBankboiPack(request.pack))) ports.queue([state.merchantCharacter], 'manual bank exchange');
    },
    // A copy that a mark, intent, delivery, NPC sale or stand listing names is not dismantled.
    reserved(name: string, slot: number, item: ItemCopy | null | undefined): boolean {
      const merchant = name === state.merchantCharacter;
      const lists = [state.marked[name], state.upgrades[name], state.statScrolls[name], state.merchantDeliveries[name],
        merchant ? state.npcSaleMarks : [], merchant ? state.standListings : []] as (Mark[] | undefined)[];
      if (lists.some(list => (list || []).some(mark => mark.slot === slot && markMatches(item, mark.item)))) return true;
      return ((state.compounds[name] || []) as { items: Mark[] }[]).some(group => group.items.some(mark => mark.slot === slot));
    },
    /**
     * F4's elixir claim: a member's elixir restock is ready when stock outside the BankBois, and
     * outside the merchant's bag for the merchant, holds a usable copy; otherwise an automatic rule
     * orders the shortfall from the market.
     */
    elixirReady(name: string, rule: { item: string; max: number; autoAcquire?: boolean }, have: number, restock: RestockRoute): boolean {
      const merchant = state.merchantCharacter;
      if (!merchant || !state.statuses[merchant] || restock.restockPending(rule.item)) return false;
      const stock = protectedMerchantStorageStock(state).filter(entry => entry.item?.name === rule.item && usableCopy(entry.item) &&
        !isBankboiPack(entry.craftLocation) && (name !== merchant || !isInventoryPack(entry.craftLocation)))
        .reduce((sum, entry) => sum + stackQuantity(entry.item), 0);
      if (stock > 0) return true;
      if (rule.autoAcquire) restock.restockSupply(rule.item, Math.max(1, rule.max - have));
      return false;
    },
    /** Table I's lucky-evidence row: a member's lucky slot evidence, read ahead of the roster evidence. */
    lucky(name: string, report: Record<string, unknown>): void {
      if (receiveLuckySlotTracking(state, name, report.luckySlotTracking, ports.characterId(name), report.luckySlotCharacterId)) ports.persist();
    },
    /**
     * 4 and `items.observe`: a member's report before the ingestion stores it. It reads Ponty's lots,
     * the bank vault catalog (when the ingestion accepts the report's catalogs) and the bank snapshot
     * through the one snapshot writer.
     */
    observe(name: string, report: Record<string, unknown> & { name: string }, catalogsAccepted: boolean): void {
      const ponty = consumePontyReport(report, state.merchantCharacter);
      if (ponty) ports.observePonty(ponty);
      if (catalogsAccepted) {
        if (Array.isArray(report.bankVaults)) state.bankVaults = report.bankVaults;
        delete report.bankVaults;
      }
      consumeBankReport(report, state, { now: () => Date.now(), adoptReservedCargo: ports.adoptReservedCargo, persist: ports.persistBank });
    },
    // The merchant's stored report asks the market feeds and runs the publication check.
    marketReport(name: string): void {
      if (name === state.merchantCharacter) ports.marketReport();
    },
    /**
     * 4 and `items.reply`: the items owner's fields of a member's reply, and the lucky slot on
     * the merchant's command, which the merchant reads from the command it runs.
     */
    reply(name: string, command: { luckyUpgradeSlot?: unknown; [field: string]: unknown } | null): Record<string, unknown> {
      if (command && name === state.merchantCharacter) command.luckyUpgradeSlot = luckySlotOf(state, name);
      return {
        bankQueued: (state.bankCurrent && state.bankCurrent.name === name) || state.bankQueue.some(job => job.name === name),
        bankStackHomes: homes(state.bankSnapshot, state.bankbois, state.merchantCatalog),
        // The merchant keeps its working gold, the target its commands carry too; no other
        // character reads the field.
        merchantGoldTarget: name === state.merchantCharacter ? workingGold(state) : 0,
        bankboiStorage: !!state.bankbois[name],
        bankStaging: bankStagingReserved(state),
        // The free cells this character's bag keeps, bounded by the bag its report gives.
        protectedSlots: protectedSlotsOf(state, name),
        // The merchant reads Ponty in the background only while a reader needs the listings.
        pontyWanted: name === state.merchantCharacter && ports.pontyWanted(),
      };
    },
    // The account's roster after a BankBoi creation or deletion.
    adoptAccount: (snapshot: ItemsAccount['response']) => { ports.account.response = snapshot; },
    refreshAccount: () => accountRefresh(() => ports.account.updateInfo(), (action, ms) => ports.scope.setTimeout(action, ms)),
    /**
     * The inbox starts once the dashboard signs in with the account session. Its first cycle runs
     * at once and the next one "Check mail every" seconds later, the player's setting read again for
     * each wait. The timer sits on the items owner's run scope, so the shutdown's stop ends the cycle
     * before storage closes. A failed cycle shows as the inbox list's error (mail.ts `pull`).
     */
    startMail(mail: Omit<MailStartupPorts, 'persist'>): MailInbox {
      const started = startCoordinatorMail(state, ports.account, { ...mail, persist: ports.persist });
      inbox = started;
      const every = () => Number(partyHooks().read({ field: 'mailCheckSeconds' })) * 1000;
      const cycle = () => { void started.refresh(true).catch(() => {}); ports.scope.setTimeout(cycle, every()); };
      cycle();
      return started;
    },
    inbox: () => inbox,
    /**
     * The mail jobs and the send route run on the items owner's state, command ids, saves and
     * log. The merchant job owner's completion route answers through `mailSent` and
     * `mailComplete`, which reach the inbox once it starts.
     */
    mail(mail: Pick<MailJobPorts, 'now' | 'enqueue' | 'dispatch' | 'bankboi'> & { identity(item: unknown): string }) {
      const shared = { ...mail, nextCommand, persist: ports.persist, persistBank: ports.persistBank, log: ports.log };
      return { jobs: createMailJobs(state, shared), send: createSendMailRoute(state, shared) };
    },
    mailSent: (id: string, sent: unknown) => inbox?.sent?.(id, sent),
    mailComplete: (...args: Parameters<MailInbox['complete']>) => inbox?.complete(...args),
  };
}
