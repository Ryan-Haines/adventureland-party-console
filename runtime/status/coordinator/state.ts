// GET /party-api/state: table S's sections,
// their 304 revisions, item meta compaction, account gold, the giveaway directory and the merchant
// projection. Each section answers from the owners' state; the overview projects it and never
// exposes private coordinator state. Moved from runtime/coordinator/telemetry/public-state*.ts,
// public-composition.ts, section-revision.ts, item-meta-projection.ts, account-gold.ts,
// giveaway-directory.ts and merchant-projection.ts.
import { incompatibleRuleRows, ownedStockKey, standSlotUse, type ConflictState } from '../../items/api.ts';
import { partyHooks } from '../../hooks/index.ts';
import { coordinatorSettings, type DeliveredField } from "../../settings/coordinator/api.ts";
import { createHash, randomUUID } from "node:crypto";
import { requestText, requestObject, type HttpRequest, type HttpResponse } from "../../lifecycle/api.ts";
import { entryMeta } from "../../items/coordinator/api.ts";
import type { InventoryEntry } from "../../coordinator/contracts/item.ts";
import { routineFor, type MerchantWork } from "../../merchant-jobs/api.ts";
import { plannedOperationStage } from "../../merchant-jobs/coordinator/api.ts";
import { selectSnapshot } from "../../settings/coordinator/api.ts";
import { fastProjection, INTERFACE_VERSIONS, sectionFields, TABLE_S, type OwnedStock, type StateSection } from "../rules.ts";
import { fresh } from "../../protocol/reports.ts";
import { offeringStock } from "../../items/coordinator/api.ts";
import { characterConnections } from "../../lifecycle/api.ts";
import { gameLogs } from "./logs.ts";
import { projectEventSchedules } from "../../events/coordinator/api.ts";
import { normalizedRealm } from "../../merchant-realm/api.ts";
import { realmLabel } from "../../protocol/realm.ts";
import { type AccountCharacter } from "../../lifecycle/api.ts";

/**
 * These values are owned by other services; the overview only projects them. The saved ones are
 * the declarations delivered to the dashboard (runtime/settings/coordinator/table.ts);
 * this list keeps the live state the payload carries beside them.
 */
export const liveStateFields = ["gameVersion", "clientUpdate", "deconstructionCatalog", "standSearch", "bankCurrent", "bankQueue"] as const;
export function publicStateFields(): string[] {
  const { dashboardFields, dashboardCoreFields } = coordinatorSettings().lists;
  return [...liveStateFields, ...dashboardFields, ...dashboardCoreFields];
}

export interface PresentationEntry {
  item?: import("../../coordinator/contracts/item.ts").Item | null;
  [field: string]: unknown;
  meta?: Record<string, unknown> | null;
}
export interface PresentationStatus {
  [field: string]: unknown;
  seenAt: number;
  server?: string;
  realmPlayers?: string[];
  items?: (PresentationEntry | null)[];
  slots?: Record<string, PresentationEntry | null>;
  characterDollHtml?: string;
}
export interface PublicCommand {
  id: number;
  type: string;
  phase?: string | null;
  convoyId?: string | null;
}
export interface PublicState extends Partial<Record<(typeof liveStateFields)[number] | DeliveredField<'dashboard' | 'dashboard-core'>, unknown>> {
  statuses: Record<string, PresentationStatus>;
  commands: Record<string, PublicCommand | null | undefined>;
  location: unknown;
  abtestingStrategy: unknown;
  bankSnapshot: unknown;
  bankVaults?: unknown[];
  bankboiQueue: unknown;
  bankboiTransaction: unknown;
  ponty: unknown;
  autoUpgradeMarks: unknown;
  upgradeOfferingRules?: import("../../items/api.ts").UpgradeOfferingRule[];
  travelPlaces?: unknown[] | null;
  monsterChoices?: unknown[] | null;
  bestiaryCatalog?: unknown[] | null;
  skillCatalog?: unknown[] | null;
  appearanceChoices?: unknown;
  merchantCatalog?: unknown;
  merchantCharacter?: string | null;
  standListings?: { tradeSlot?: unknown }[];
  merchantQueue: MerchantWork[];
  merchantCurrent: MerchantWork | null;
  aldata: {
    merchants?: {
      id?: string;
      lastSeen?: string;
      serverRegion?: string;
      serverIdentifier?: string;
    }[];
  };
}

export interface PublicStatePorts {
  now(): number;
  handoff(): unknown;
  aldata(): Record<string, unknown>;
  servers(): { key?: string }[];
  roster(): unknown;
  slots(): unknown;
  classes: readonly string[];
  eventSchedules(): unknown;
  anniversary(): unknown;
  job(job: MerchantWork | null): unknown;
  luckSchedule(): unknown;
  bankbois(): unknown;
  realmControl(): unknown;
  /** Pause, Play and clean shutdown state; runtime/lifecycle/coordinator/control.ts. */
  consoleControl(): unknown;
  /** The last ring save, which the record icon lights for; coordinator/diagnostics.ts. */
  recordSaved?(): unknown;
  /** The card line for a character (coordinator/line.ts `createCardLines`). Each projection
   * that hands a character out adds it to its own copy; the stored report holds what the character sent. */
  activity(name: string): unknown;
}

// Table S's `revision` sections answer 304 while their body is unchanged.
const revisionSections = new Set<string>(TABLE_S.filter(row => row.revision).map(row => row.section));

/**
 * The revision is a hash of the serialized section, so any field the section
 * carries changes it. It replaces the hash Express computes for its ETag.
 * A client opts in with `revision=` (browsers add `Cache-Control: no-cache`
 * to a fetch that sets If-None-Match, and Express then never answers 304) or
 * with If-None-Match; either match answers 304 without a body. A client that
 * sends neither gets the full body as before.
 */
function sendWithRevision(request: HttpRequest, response: HttpResponse, value: unknown): unknown {
  const body = JSON.stringify(value);
  const revision = createHash("sha1").update(body).digest("base64url");
  response.set("ETag", `"${revision}"`);
  if (requestText(request.query?.revision) === revision || request.get?.("If-None-Match") === `"${revision}"`)
    return response.status(304).end();
  response.set("Content-Type", "application/json; charset=utf-8");
  return response.send(body);
}

/**
 * Item meta projections for the bank section and the unsectioned debug state.
 * Reports leave per-type meta to merchantCatalog (runtime/items/coordinator/fates.ts);
 * these put it back in the shapes readers received before.
 */
function mapEntries(value: unknown, project: (entry: PresentationEntry) => unknown): unknown {
  return Array.isArray(value)
    ? value.map((entry) => (entry && typeof entry === "object" ? project(entry) : entry))
    : value;
}
function mapPacks(bank: unknown, project: (entry: PresentationEntry) => unknown): unknown {
  if (!bank || typeof bank !== "object") return bank;
  const snapshot = bank as { packs?: unknown };
  if (!snapshot.packs || typeof snapshot.packs !== "object") return bank;
  return {
    ...snapshot,
    packs: Object.fromEntries(
      Object.entries(snapshot.packs).map(([pack, entries]) => [pack, mapEntries(entries, project)]),
    ),
  };
}

// The bank snapshot changes once or twice per bank visit while the dashboard
// polls the bank section every two seconds, so compactBank compacts each
// snapshot once.
const compactBanks = new WeakMap<object, { catalog: unknown; value: unknown }>();
/** Bank packs in the shape compactEntry gives inventory cells. */
function compactBank(bank: unknown, catalog: unknown): unknown {
  if (!bank || typeof bank !== "object") return bank;
  const cached = compactBanks.get(bank);
  if (cached && cached.catalog === catalog) return cached.value;
  const value = mapPacks(bank, (entry) => compactEntry(entry, catalog));
  compactBanks.set(bank, { catalog, value });
  return value;
}

function mapBankbois(bankbois: unknown, project: (entry: PresentationEntry) => unknown): unknown {
  return mapEntries(bankbois, (bankboi) => ({ ...bankboi, items: mapEntries(bankboi.items, project) }));
}
/** Storage worker inventories, compacted like the bank they hold. */
function compactBankbois(bankbois: unknown, catalog: unknown): unknown {
  return mapBankbois(bankbois, (entry) => compactEntry(entry, catalog));
}

function withFullMeta(entry: PresentationEntry, catalog: unknown): PresentationEntry {
  const meta = entryMeta(catalog, entry);
  return meta ? { ...entry, meta } : entry;
}
/**
 * The unsectioned debug state keeps every field reports carried before they
 * left per-type meta to the catalog, for tools and tests that read it.
 */
function fullMetaStatuses(
  statuses: Readonly<Record<string, PresentationStatus>>,
  catalog: unknown,
  activity: (name: string) => unknown,
): Record<string, PresentationStatus> {
  const join = (entry: PresentationEntry) => withFullMeta(entry, catalog);
  return Object.fromEntries(
    Object.entries(statuses).map(([name, status]) => [
      name,
      {
        ...status,
        activity: activity(name),
        items: mapEntries(status.items, join) as PresentationStatus["items"],
        slots: Object.fromEntries(
          Object.entries(status.slots || {}).map(([slot, entry]) => [slot, entry && join(entry)]),
        ),
        ...(status.bank ? { bank: mapPacks(status.bank, join) } : {}),
        ...(Array.isArray(status.nearbyStandListings)
          ? { nearbyStandListings: mapEntries(status.nearbyStandListings, join) }
          : {}),
      },
    ]),
  );
}
/**
 * The copies the merchant may sell to a wishlist, by `ownedStockKey`. The merchant's bag
 * counts up to the items owner's `items.stock`, so a claimed copy stays out; the bank's come from the items owner's
 * `items.bank()`. Each key carries the cells it counted, so the stand sheet offers only those.
 */
function ownedStock(merchant: string | null | undefined, bag: unknown): Record<string, OwnedStock> {
  const hooks = partyHooks(), stock: Record<string, OwnedStock> = {};
  const add = (entries: unknown, bankPack?: string, limit?: (name: string) => number) => {
    const left = new Map<string, number>();
    for (const entry of Array.isArray(entries) ? entries as (InventoryEntry | null)[] : []) {
      const item = entry?.item;
      if (!item?.name) continue;
      if (limit && !left.has(item.name)) left.set(item.name, limit(item.name));
      const count = Math.min(Number(item.q) || 1, limit ? left.get(item.name)! : Infinity);
      if (count <= 0) continue;
      if (limit) left.set(item.name, left.get(item.name)! - count);
      const owned = stock[ownedStockKey({ name: item.name, level: item.level, p: item.p })] ??= { count: 0, sources: [] };
      owned.count += count;
      owned.sources.push({ entry: { slot: entry!.slot, item }, ...(bankPack ? { bankPack } : {}) });
    }
  };
  if (merchant) add(bag, undefined, name => hooks.ask('items.stock', merchant, name));
  const bank = hooks.ask('items.bank') as { packs?: Record<string, unknown> } | null;
  for (const [pack, entries] of Object.entries(bank?.packs || {})) add(entries, pack);
  return stock;
}

/** The bank snapshot with full meta, for the unsectioned debug state. */
function fullMetaBank(bank: unknown, catalog: unknown): unknown {
  return mapPacks(bank, (entry) => withFullMeta(entry, catalog));
}
/** Storage worker inventories with full meta, for the unsectioned debug state. */
function fullMetaBankbois(bankbois: unknown, catalog: unknown): unknown {
  return mapBankbois(bankbois, (entry) => withFullMeta(entry, catalog));
}

/** The account's gold: the bank and every assigned slot's carried gold, bank storage characters
 * excluded. An offline or failed slot counts its last reported gold, and `offline` sums those, so
 * the header marks the share that may have changed in game. An unknown balance leaves the
 * totals unknown. */
export function accountGoldSnapshot(bank: unknown, slots: unknown, bankbois: unknown, statuses: Record<string, unknown>) {
  const excluded = new Set(Array.isArray(bankbois) ? bankbois.map(entry => requestObject(entry).name) : []);
  const members = new Map<string, boolean>();
  if (Array.isArray(slots)) for (const input of slots) {
    const slot = requestObject(input);
    if (typeof slot.character !== 'string' || slot.state === 'empty' || excluded.has(slot.character)) continue;
    members.set(slot.character, (members.get(slot.character) ?? false) || !['offline', 'failed'].includes(String(slot.state)));
  }
  const balances = [...members].map(([name, online]) => ({ gold: requestObject(statuses[name]).gold, online }));
  const known = balances.every(({ gold }) => typeof gold === 'number' && Number.isFinite(gold));
  const sum = (list: typeof balances) => list.reduce((total, { gold }) => total + (gold as number), 0);
  const carried = known ? sum(balances) : null;
  const bankGold = requestObject(bank).gold;
  return {
    carried,
    offline: known ? sum(balances.filter(({ online }) => !online)) : null,
    total: typeof bankGold === 'number' && Number.isFinite(bankGold) && carried !== null ? bankGold + carried : null,
  };
}

function addCharacters(
  players: Record<string, string[]>,
  state: Readonly<PublicState>,
  ports: PublicStatePorts,
): void {
  for (const status of Object.values(state.statuses)) {
    if (
      !status ||
      !online(status, ports.now()) ||
      !status.server ||
      !Array.isArray(status.realmPlayers)
    )
      continue;
    const key = normalizedRealm(status.server)!;
    players[key] = [...new Set([...(players[key] || []), ...status.realmPlayers])].sort();
  }
}

// The items owner's rule: a merchant the latest ALData snapshot holds is current.
function addMerchants(players: Record<string, string[]>, state: Readonly<PublicState>): void {
  for (const merchant of state.aldata.merchants || []) {
    if (!merchant?.id) continue;
    const key = normalizedRealm(String(merchant.serverRegion || "") + String(merchant.serverIdentifier || ""));
    if (!key) continue;
    players[key] = [...new Set([...(players[key] || []), merchant.id])].sort();
  }
}

/** Combines fresh character observations with the merchants of the latest ALData snapshot. */
function giveawayDirectory(state: Readonly<PublicState>, ports: PublicStatePorts) {
  const players: Record<string, string[]> = {};
  addCharacters(players, state, ports);
  addMerchants(players, state);
  return players;
}

interface MerchantJob {
  [key: string]: unknown;
  reason?: string;
  routine?: string;
  manual?: boolean;
  bidItemId?: string;
  target?: string | null;
  aldataKey?: unknown;
}
interface JobProjectionPorts<T extends MerchantJob> {
  stamp(job: T): T;
  slots(name: string | null | undefined): number;
  threshold(): number;
  nearby(name: string | null | undefined): boolean;
}

/** Publish queue metadata without exposing the ALData credential carried by a job. */
export function projectMerchantJob<T extends MerchantJob>(
  job: T | null | undefined,
  ports: JobProjectionPorts<T>,
) {
  if (!job) return null;
  const safe: MerchantJob = { ...ports.stamp(job) };
  safe.routine = routineFor({ ...safe, reason: safe.reason || '' });
  if (job.reason === "marked items") {
    const slots = ports.slots(job.target),
      threshold = ports.threshold() || 1;
    safe.collectionSlots = slots;
    safe.collectionThreshold = threshold;
    safe.collectionNearby = ports.nearby(job.target);
    safe.collectionLabel = slots < threshold ? "nearby collection" : "marked items";
  }
  delete safe.aldataKey;
  return safe;
}

interface Bankboi {
  name: string;
  items?: unknown;
  [key: string]: unknown;
}
interface Transaction {
  bankboi?: string;
  phase?: unknown;
  mode?: unknown;
}
export function projectBankbois(
  bankbois: Record<string, Bankboi>,
  transaction: Transaction | null | undefined,
  accountCharacter?: (name: string) => Pick<AccountCharacter, "type" | "level"> | undefined,
) {
  return Object.values(bankbois)
    .map((entry) => {
      const character = accountCharacter?.(entry.name);
      return {
        ...entry,
        ...(character ? { ctype: character.type, level: character.level } : {}),
        items: Array.isArray(entry.items) ? entry.items : [],
        transaction:
          transaction && transaction.bankboi === entry.name
            ? { phase: transaction.phase, mode: transaction.mode }
            : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

// `online` is the one presence rule's answer, so the dashboard keeps no window of its own.
// The one presence rule: a character is online while its last report is younger than the presence
// age. The card, the header, the giveaway list, the connection list and `status.connected` read it.
export const online = (status: { seenAt?: unknown } | undefined, now: number): boolean => fresh(status?.seenAt, now, "presence", 0, true);
export function diagnosticCharacters(statuses: Readonly<Record<string, PresentationStatus>>, now: number,
  activity: (name: string) => unknown) {
  const allowed = new Set<string>(sectionFields.diagnostics);
  return Object.fromEntries(
    Object.entries(statuses).map(([name, status]) => [
      name,
      {
        ...Object.fromEntries(Object.entries(status).filter(([key]) => allowed.has(key))),
        activity: activity(name),
        online: online(status, now),
        combat: {
          positioning: (status.combat as { positioning?: unknown } | undefined)?.positioning,
        },
      },
    ]),
  );
}

const metadataFields = [
  "definition",
  "upgradeable",
  "compoundable",
  "buyable",
  "properties",
  "scaling",
  "maxLevel",
  "sprite",
  "title",
] as const;

function fastCharacters(statuses: Readonly<Record<string, PresentationStatus>>, activity: (name: string) => unknown) {
  return Object.fromEntries(
    Object.entries(statuses).map(([name, status]) => [
      name,
      { ...fastProjection(status || {}), activity: activity(name) },
    ]),
  );
}

// One compact copy per joined meta object, which lives until the next report.
const compactMetas = new WeakMap<object, Record<string, unknown>>();
/**
 * Joins the catalog's per-type meta onto a report entry, then keeps the fields
 * the dashboard, the mobile apps and the stream have always received here.
 */
export function compactEntry(entry: PresentationEntry | null, catalog: unknown): PresentationEntry | null {
  if (!entry) return entry;
  const meta = entryMeta(catalog, entry);
  // After a coordinator restart the first reports carry per-copy meta
  // (characters/shared.js itemDefinition, always with `properties`) before the
  // catalog arrives again. Dashboard readers such as inventory-panel.tsx read
  // meta.definition whenever meta is set, so per-copy meta stays out until the
  // catalog joins it. Other meta passes through as before.
  if (!meta || (!meta.definition && "properties" in meta)) return { ...entry, meta: null };
  let compact = compactMetas.get(meta);
  if (!compact) compactMetas.set(meta, (compact = selectSnapshot(meta, metadataFields)));
  return { ...entry, meta: compact };
}

function inventoryCharacters(
  statuses: Readonly<Record<string, PresentationStatus>>,
  catalog: unknown,
) {
  return Object.fromEntries(
    Object.entries(statuses).map(([name, status]) => [
      name,
      {
        items: (status.items || []).map((entry) => compactEntry(entry, catalog)),
        slots: Object.fromEntries(
          Object.entries(status.slots || {}).map(([slot, entry]) => [
            slot,
            compactEntry(entry, catalog),
          ]),
        ),
        characterDollHtml: status.characterDollHtml || null,
      },
    ]),
  );
}

export function pendingCommands(
  commands: Readonly<Record<string, PublicCommand | null | undefined>>,
) {
  return Object.fromEntries(
    Object.entries(commands).map(([name, command]) => [
      name,
      command && {
        id: command.id,
        type: command.type,
        phase: command.phase || null,
        convoyId: command.convoyId || null,
      },
    ]),
  );
}

function catalogs(state: Readonly<PublicState>): Record<string, unknown> {
  return {
    travelPlaces: state.travelPlaces || [],
    monsterChoices: state.monsterChoices || [],
    bestiaryCatalog: state.bestiaryCatalog || [],
    skillCatalog: state.skillCatalog || [],
    appearanceChoices: state.appearanceChoices || {},
    merchantCatalog: state.merchantCatalog || {
      allItems: [],
      buyable: [],
      craftable: [],
      exchangeable: [],
    },
    bankVaults: state.bankVaults || [],
  };
}

function giveawayPayload(
  state: Readonly<PublicState>,
  ports: PublicStatePorts,
): Record<string, unknown> {
  return {
    giveawayRealms: ports.servers().map((realm) => ({
      key: realm.key,
      label: realmLabel(realm.key),
    })),
    giveawayPlayers: giveawayDirectory(state, ports),
  };
}

/**
 * Configuration, rules and marks the dashboard rarely needs fresher than a few
 * seconds old, as opposed to 'core', which is live operational state (active
 * convoy/combat/hunt/bank-job progress) polled roughly every second. Splitting
 * these out means the dashboard's slow-changing majority no longer forces a
 * full structural diff of the fast tier on every poll, and vice versa.
 *
 * The saved fields are the declarations delivered to `dashboard`, and the same
 * declarations say whether a field is saved; the config row names the rest.
 */
const configRow = TABLE_S.find(row => row.section === "config")!;
function configFields(): string[] {
  return [...coordinatorSettings().lists.dashboardFields, ...configRow.fields];
}
// The fields a core read leaves to the other sections (table S): the apps' core leaves the `legacy`
// rows' fields and the debug characters; the dashboard's core leaves every row's fields and config's
// declared settings.
function sectionLeaves(dashboard: boolean): Set<string> {
  return new Set(["characters", ...TABLE_S.flatMap(row => dashboard || row.legacy ? row.fields : []),
    ...(dashboard ? coordinatorSettings().lists.dashboardFields : [])]);
}
function leaveOut(payload: Record<string, unknown>, leaves: Set<string>): Record<string, unknown> {
  for (const key of leaves) delete payload[key];
  return payload;
}
// The interface v1 config rows keep these scope fields in config's farmingProfiles while an app reads them there.
const appProfileFields = new Set<string>(INTERFACE_VERSIONS.filter(row => row.at === "GET /party-api/state?sections=config")
  .map(row => row.field.split(".").at(-1)!));
function configPayload(
  state: Readonly<PublicState>,
  ports: PublicStatePorts,
): Record<string, unknown> {
  return {
    ...selectSnapshot(state as Record<string, unknown>, configFields()),
    farmingProfiles: scopeFields(state.farmingProfiles, false),
    roster: ports.roster(),
    classChoices: ports.classes,
    eventStrategy: state.abtestingStrategy,
    giveawayRealms: giveawayPayload(state, ports).giveawayRealms,
  };
}
// Each farming scope's live controller state, its fields delivered to `dashboard-core` (the
// Hunt, the convoy, the farm area, combat recovery, the event return, grouped combat), rides in
// core's `farmingLive`, so the Hunt line moves with the 1 s poll; config's `farmingProfiles` keeps
// the scope's settings and the live fields an interface v1 row keeps for the apps.
function scopeFields(profiles: unknown, live: boolean): Record<string, Record<string, unknown>> {
  const core = new Set(coordinatorSettings().lists.dashboardCoreFields);
  const kept = (field: string) => live ? core.has(field) : !core.has(field) || appProfileFields.has(field);
  return Object.fromEntries(Object.entries(requestObject(profiles)).map(([name, profile]) =>
    [name, Object.fromEntries(Object.entries(requestObject(profile)).filter(([field]) => kept(field)))]));
}

// The full payload less `leaves`, the fields table S gives another section. The debug state leaves
// none; a field it leaves is never built.
function fullPayload(
  state: Readonly<PublicState>,
  ports: PublicStatePorts,
  omitCatalog: boolean,
  leaves = new Set<string>(),
  dashboardCore = false,
): Record<string, unknown> {
  const catalog = omitCatalog ? {} : catalogs(state);
  Object.assign(catalog, offeringPayload(state));
  const steamSwitch = ports.handoff(),
    aldata = ports.aldata();
  if (omitCatalog) {
    delete aldata.listings;
    delete aldata.trades;
    delete aldata.buyOrders;
  }
  Object.assign(catalog, giveawayPayload(state, ports));
  return leaveOut({
    ...selectSnapshot(state as Record<string, unknown>, publicStateFields().filter(field => !leaves.has(field))),
    ...(leaves.has("characters") ? {} : { characters: fullMetaStatuses(state.statuses, state.merchantCatalog, ports.activity) }),
    roster: ports.roster(),
    activeSlots: ports.slots(),
    // One connection state per character, online by the one presence rule.
    characterConnections: characterConnections(state, ports.now(),
      (name) =>
      (state.statuses[name]?.runtime === 'native' || state.statuses[name]?.runtime === 'headless') &&
      online(state.statuses[name], ports.now())),
    classChoices: ports.classes,
    steamSwitch,
    partyLocation: state.location,
    eventSchedules: ports.eventSchedules(),
    eventStrategy: state.abtestingStrategy,
    anniversary: ports.anniversary(),
    merchantQueue: state.merchantQueue.map((job) => ports.job(job)),
    merchantCurrent: ports.job(state.merchantCurrent),
    mluckSchedule: ports.luckSchedule(),
    aldata,
    ...(leaves.has("bank") ? {} : { bank: fullMetaBank(state.bankSnapshot, state.merchantCatalog), bankVaults: state.bankVaults || [] }),
    ...catalog,
    ponty: state.ponty,
    bankbois: dashboardCore
      ? bankboiSummaries(ports.bankbois())
      : fullMetaBankbois(ports.bankbois(), state.merchantCatalog),
    bankboiQueue: state.bankboiQueue,
    bankboiTransaction: state.bankboiTransaction,
    // The items owner's incompatible-rule rows over the coordinator's own rule records and its BankBois by name;
    // PublicState types those records as unknown.
    incompatibleRules: incompatibleRuleRows(state as ConflictState),
    bankboiCreateSingleFlight: true,
    realmControl: ports.realmControl(),
    consoleControl: ports.consoleControl(),
  }, leaves);
}

const coreRow = TABLE_S.find(row => row.section === "core")!;
function bankboiSummaries(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => selectSnapshot(requestObject(entry), coreRow.bankboiFields));
}
function accountId(state: Readonly<PublicState>) {
  const owner = Object.values(state.statuses).find(
    (status) => typeof status.owner === "string" || typeof status.owner === "number",
  )?.owner;
  return typeof owner === "string" || typeof owner === "number" ? String(owner) : null;
}
function dashboardCharacters(state: Readonly<PublicState>, ports: PublicStatePorts) {
  const slots = ports.slots();
  const names = new Set(
    Array.isArray(slots) ? slots.map((slot) => requestObject(slot).character) : [],
  );
  return Object.fromEntries(Object.entries(state.statuses).filter(([name]) => names.has(name)));
}

function fastPayload(state: Readonly<PublicState>, ports: PublicStatePorts) {
  return {
    characters: fastCharacters(state.statuses, ports.activity),
    partyFarmingMode: state.partyFarmingMode,
    partyFarmingMonsterType: state.partyFarmingMonsterType,
    activeConvoy: state.activeConvoy,
    partyLocation: state.location,
    realmControl: ports.realmControl(),
    consoleControl: ports.consoleControl(),
    pendingCommands: pendingCommands(state.commands),
  };
}

/** Overview sections share one public projection and never expose private coordinator state. */
export function createPublicStateRoute(state: Readonly<PublicState>, ports: PublicStatePorts) {
  let revision = 0;
  const epoch = randomUUID();
  let previousCatalog = "";
  let previousReferences: unknown[] = [];
  function referenceRevision() {
    const references = [
      state.travelPlaces,
      state.monsterChoices,
      state.bestiaryCatalog,
      state.skillCatalog,
      state.appearanceChoices,
      state.merchantCatalog,
    ];
    if (
      references.every((value, index) => value === previousReferences[index]) &&
      previousReferences.length
    )
      return epoch + ":" + revision;
    previousReferences = references;
    const value = JSON.stringify(catalogs(state));
    if (value !== previousCatalog) {
      previousCatalog = value;
      revision++;
    }
    return epoch + ":" + revision;
  }
  return function publicState(request: HttpRequest, response: HttpResponse): unknown {
    const section = requestText(request.query?.section || "");
    const sections: Record<StateSection, () => unknown> = {
      fast: () => fastPayload(state, ports),
      inventory: () => ({ characters: inventoryCharacters(state.statuses, state.merchantCatalog) }),
      // The settings history (the settings owner's audit lines) is the logs' settings source (11 14.3's audit view).
      logs: () => ({ gameLogs, combatLogs: state.combatLogs, merchantActivity: state.merchantActivity,
        settingsChanges: (state as { settingsChanges?: unknown }).settingsChanges ?? [] }),
      bank: () => ({
        bank: compactBank(state.bankSnapshot, state.merchantCatalog),
        bankVaults: state.bankVaults || [],
        bankCurrent: state.bankCurrent,
        bankQueue: state.bankQueue,
        ownedStock: ownedStock(state.merchantCharacter, state.merchantCharacter ? state.statuses[state.merchantCharacter]?.items : null),
        ...(request.query?.dashboard === "1"
          ? { bankbois: compactBankbois(ports.bankbois(), state.merchantCatalog) }
          : {}),
      }),
      market: () => ({
        aldata: ports.aldata(),
        ponty: state.ponty,
        standPriceHistory: state.standPriceHistory,
      }),
      catalog: () => ({ ...catalogs(state), referenceRevision: referenceRevision() }),
      config: () => configPayload(state, ports),
      core: () =>
        request.query?.dashboard !== "1"
          ? fullPayload(state, ports, true, sectionLeaves(false))
          : {
              ...fullPayload(state, ports, true, sectionLeaves(true), true),
              farmingLive: scopeFields(state.farmingProfiles, true),
              accountId: accountId(state),
              bankGold: requestObject(state.bankSnapshot).gold ?? null,
              accountGold: accountGoldSnapshot(state.bankSnapshot, ports.slots(), ports.bankbois(), state.statuses),
              recordSaved: ports.recordSaved?.() ?? null,
              // The items owner's stand count: the merchant's cells and the listings that use them.
              standSlots: standSlotUse(state),
              // the merchant jobs owner's ready jobs: the merchant card shows the gathering the console plans.
              merchantReady: state.merchantCharacter ? partyHooks().ask('jobs.ready', state.merchantCharacter) ?? [] : [],
              characterDetails: diagnosticCharacters(dashboardCharacters(state, ports), ports.now(), ports.activity),
              characters: Object.fromEntries(
                Object.entries(dashboardCharacters(state, ports)).map(([name, status]) => [
                  name,
                  {
                    name,
                    ctype: status.ctype,
                    level: status.level,
                    server: status.server,
                  },
                ]),
              ),
              referenceRevision: referenceRevision(),
            },
    };
    if (!section) return response.json(fullPayload(state, ports, request.query?.catalog === "0"));
    // An unknown section answers 400, so a typo never turns a small poll
    // into the multi-megabyte full payload.
    if (!Object.hasOwn(sections, section))
      return response.status(400).json({ error: "Unknown state section", sections: Object.keys(sections) });
    const read = sections[section as StateSection]();
    return revisionSections.has(section) ? sendWithRevision(request, response, read) : response.json(read);
  };
}

function offeringPayload(state: Readonly<PublicState>) {
  return {upgradeOfferingRules:state.upgradeOfferingRules || [], upgradeOfferingStock:offeringStock(state)};
}

type OverviewState<Handoff> = PublicState & {
  leader: string | null;
  steamSwitch: Handoff;
  itemCollectionThreshold: number;
  statuses: Parameters<typeof projectEventSchedules>[0];
  bankbois: Parameters<typeof projectBankbois>[0];
  bankboiTransaction: Parameters<typeof projectBankbois>[1];
};
type OverviewPorts<Handoff> = Omit<
  PublicStatePorts,
  "handoff" | "eventSchedules" | "bankbois" | "job"
> & {
  accountCharacter?: Parameters<typeof projectBankbois>[2];
  handoff: (value: Handoff) => unknown;
  stamp: (job: MerchantWork) => MerchantWork;
  collectionSlots: (name: string | null | undefined) => number;
  collectionNearby: (name: string | null | undefined) => boolean;
};

/** Present current event feeds, storage workers and queue metadata through one overview boundary. */
export function createCoordinatorPublicOverview<Handoff>(
  state: OverviewState<Handoff>,
  ports: OverviewPorts<Handoff>,
) {
  const job = (value: MerchantWork | null | undefined) =>
    projectMerchantJob(value && value.target === state.merchantCharacter ? {...value, operationStage: value.operationStage || plannedOperationStage(value.reason,
      state.statuses[String(value.target)]?.items || [], requestObject(state.autoCompounds)[String(value.target)], requestObject(state.upgrades)[String(value.target)])} : value, {
      stamp: ports.stamp,
      slots: ports.collectionSlots,
      threshold: () => state.itemCollectionThreshold,
      nearby: ports.collectionNearby,
    });
  const route = createPublicStateRoute(state, {
    ...ports,
    job,
    handoff: () => ports.handoff(state.steamSwitch),
    eventSchedules: () => projectEventSchedules(state.statuses, state.leader, () => ports.now()),
    bankbois: () => projectBankbois(state.bankbois, state.bankboiTransaction, ports.accountCharacter),
  });
  return { route, job };
}
