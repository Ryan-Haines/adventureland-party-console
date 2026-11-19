// POST /party-api/status: the name check, the combat fast path, the inventory
// revision, then table I's rows in order, each the owner's published function, then table R's reply
// with the inventory acknowledgement. Moved from runtime/coordinator/status/ingestion.ts and
// composition.ts, with the catalogs, their validation and the appearances (catalogs.ts,
// catalog-validation.ts, character-appearance.ts).
import { merchantAdoption } from '../../merchant-jobs/coordinator/api.ts';
import type { AttendanceReport, AnniversaryBuffStatus } from '../../events/api.ts';
import { acceptHunterLocation, type ScatterState, type ScatterStatus } from '../../hunting/coordinator/api.ts';
import type { createMerchantObservation } from '../../items/coordinator/api.ts';
import { createInventoryCarry } from '../../items/coordinator/api.ts';
import type { StoreBook } from '../../hooks/store.ts';
import type { SettingsWrite, SettingsWriteResult } from '../../settings/api.ts';
import { requestObject, type HttpRequest, type HttpResponse } from '../../lifecycle/api.ts';
import { isDeepStrictEqual } from 'node:util';
import { snapshotSaveDue } from '../../settings/coordinator/api.ts';
import { CATALOG_FIELDS, SNAPSHOT_META_FIELDS, TABLE_I, catalogValue, sectionFields, type IntakeRow } from '../rules.ts';
import { partyHooks } from '../../hooks/index.ts';
import type { AppearanceSprite as Sprite, AppearanceState, CharacterAppearance, StatusReport } from '../api.ts';
import { createCombatIntake, preserveNewerCombat } from './channel.ts';
import { measureStatusStage, transportTiming, type StatusReply } from './reply.ts';
import { boundFired, boundsReported, capReached } from './bounds.ts';

type Report = StatusReport & AttendanceReport & Record<string, unknown> & ScatterStatus & AnniversaryBuffStatus &
  Parameters<ReturnType<typeof createMerchantObservation>['observe']>[0];
interface IntakeState<R extends Report> extends AppearanceState, CatalogState, ScatterState {
  statuses: Record<string, R | undefined>;
  headlessSlots: (string | null)[];
  steamMembers: string[];
  steamSwitch: { phase?: string } | null;
  nativeOwner: string | null;
  merchantCharacter: string | null;
  leader: string | null;
  monsterHunt: unknown;
  // The shared command sequence every command id is drawn from.
  nextCommandId: number;
  // The live game client version, which the lifecycle owner's client update
  // writes.
  gameVersion: number;
  // The add-on character and party stores by store key (runtime/hooks/store.ts), persisted with the
  // settings.
  addonStores?: StoreBook;
}
interface IntakePorts<R extends Report> {
  now(): number;
  owned(name: string): unknown;
  persistRoster(): void;
  persist(): void;
  activeNames(): string[];
  // The settings owner's writer: adopting the first merchant is a console change of the
  // player's setting (08).
  write(batch: SettingsWrite): SettingsWriteResult;
  // The items owner's report answers.
  items: { lucky(name: string, report: Record<string, unknown>): void; observe(name: string, report: R, catalogsAccepted: boolean): void; marketReport(name: string): void };
  merchant(body: R, previous: R | undefined): void;
  groupedCombat(): void;
  rareReport(name: string, report: R): void;
  rareTick(): void;
  bankboi(body: R): void;
  anniversary(name: string, report: R): void;
  // The tasks owner's task tick for the report.
  taskTick(name: string): void;
  // The hunting owner's per-report rows: its one tick per report with the tasks owner's task
  // tick inside the party Hunt's save window, a report's one-shot types and its scatter observation.
  hunting: { reportTick(reporter: string, taskTick: () => void): void; oneShots(body: R): string[]; scatterReport(body: R, learned: string[]): void };
  abtesting(): void;
  events(body: R): void;
  convoyStep(): boolean;
  merchantScheduling(body: R, hadPrevious: boolean): void;
  reply: StatusReply;
}

/** The status intake: one handler, with table I's order. */
export function createStatusIntake<R extends Report>(state: IntakeState<R>,
  workers: Record<string, { version?: unknown; clientInstance?: unknown } | undefined>, ports: IntakePorts<R>) {
  const channel = createCombatIntake(state.statuses, ports);
  const inventory = createInventoryCarry();
  const identifyMerchant = merchantAdoption(state, ports);
  // The add-on system's store book holds the account's saved add-on stores
  //.
  const book = partyHooks().stores.book;
  book.attach((state.addonStores ||= {}), () => measureStatusStage('persist', () => ports.persist()));
  const known = (name: string) => Object.prototype.hasOwnProperty.call(workers, name) || !!ports.owned(name);
  // A report's catalogs belong to the live client: a report that names no client counts, one on
  // another client does not, and a headless worker's counts only from its own current instance on
  // the default version.
  const acceptCatalogs = (body: R) => {
    if (!body.clientVersion) return true;
    if (Number(body.clientVersion) !== state.gameVersion) return false;
    const worker = workers[String(body.name)];
    return body.runtime !== "headless" || (!worker?.version && body.clientInstance === worker?.clientInstance);
  };
  interface Pass { raw: Record<string, unknown>; body: R; receivedAt: number; previous?: R; learned: string[] }
  const rows: Record<IntakeRow, (p: Pass) => void> = {
    bounds: ({ raw, body }) => { boundsReported(raw.boundsFired, body.name); delete raw.boundsFired; },
    // The report's store writes merge per key, and the outcomes and command replies it carries
    // reach the asking add-ons.
    'addon-stores': ({ raw, body }) => {
      const { skipped } = book.merge(body.name, raw.addonStores);
      for (const addon of skipped) boundFired({ bound: 'malformedAddonStore', owner: '14', subject: body.name, state: { addon } });
      partyHooks().reported(body.name, raw);
      delete raw.addonActionResults; delete raw.addonCommandReplies;
    },
    'lucky-evidence': ({ raw, body }) => ports.items.lucky(body.name, raw),
    'roster-evidence': ({ raw, body, receivedAt }) => {
      const snapshotChanged = rememberCharacterSnapshot(state, raw, receivedAt);
      if (rememberCharacterAppearance(state, body, receivedAt) || snapshotChanged) ports.persistRoster();
    },
    // A native report names the Steam window's member and its primary.
    'native-ownership': ({ body }) => {
      if (body.runtime !== 'native' || (state.steamSwitch && state.steamSwitch.phase !== 'complete') || state.headlessSlots.includes(body.name)) return;
      if (!state.steamMembers.includes(body.name)) state.steamMembers.push(body.name);
      if (body.steamPrimary !== false) state.nativeOwner = body.name;
      ports.persistRoster();
    },
    // The job owner adopts the first connected owned merchant.
    'merchant-identity': ({ body }) => identifyMerchant(body),
    catalogs: ({ body }) => { if (acceptCatalogs(body)) consumeStatusCatalogs(body, state); },
    items: ({ body }) => ports.items.observe(body.name, body, acceptCatalogs(body)),
    'one-shots': p => { p.learned = ports.hunting.oneShots(p.body); },
    'merchant-observer': ({ body, previous }) => { if (body.name === state.merchantCharacter) ports.merchant(body, previous); },
    // The one `seenAt` stamp, which movement's `reports.fresh` reads.
    store: ({ raw, body, receivedAt, previous }) => {
      state.statuses[body.name] = preserveNewerCombat({ ...body, seenAt: receivedAt,
        inventorySeenAt: Array.isArray(raw.items) ? receivedAt : undefined }, previous, receivedAt);
      partyHooks().notify('status.received', { character: body.name, seq: body.seq ?? null, seenAt: receivedAt, by: 'core:status' });
    },
    'grouped-combat': () => ports.groupedCombat(),
    'rare-report': ({ body }) => ports.rareReport(body.name, state.statuses[body.name]!),
    'rare-tick': () => ports.rareTick(),
    bankboi: ({ body }) => ports.bankboi(body),
    anniversary: ({ body }) => ports.anniversary(body.name, state.statuses[body.name]!),
    hunt: ({ body }) => measureStatusStage('huntingTick', () =>
      ports.hunting.reportTick(body.name, () => measureStatusStage('taskTick', () => ports.taskTick(body.name)))),
    abtesting: () => ports.abtesting(),
    scatter: ({ body, learned }) => ports.hunting.scatterReport(body, learned),
    events: ({ body }) => ports.events(body),
    // Parked combat polls answer with this report's state.
    'channel-flush': ({ body }) => channel.flush(body.name),
    market: ({ body }) => ports.items.marketReport(body.name),
    convoy: () => { if (ports.convoyStep()) measureStatusStage('persist', () => ports.persist()); },
    'merchant-scheduling': ({ body, previous }) => ports.merchantScheduling(body, !!previous),
  };
  function handle(req: HttpRequest, res: HttpResponse): unknown {
    const receivedAt = ports.now();
    const sendJson = res.json.bind(res);
    res.json = (value) => measureStatusStage('serialize-response', () => sendJson({ ...requestObject(value), transportTiming: transportTiming(receivedAt, ports.now()) }));
    const raw = requestObject(req.body);
    if (typeof raw.name !== 'string' || !known(raw.name)) return res.status(400).json({ error: 'unknown character' });
    // The next command id is newer than any the character holds, so a command restored after a
    // reload never reads as obsolete. Only a safe integer below MAX_SAFE_INTEGER moves it
    // (ingestion.ts), so `nextCommandId++` keeps giving new integer ids.
    const last = raw.lastCommandId;
    if (Number.isSafeInteger(last) && (last as number) >= state.nextCommandId && (last as number) < Number.MAX_SAFE_INTEGER)
      state.nextCommandId = (last as number) + 1;
    if (raw.combatWait === true || raw.combatOnly === true) return channel.handle(raw.name, raw, res);
    // The character sends the full inventory again on this reply, in the same request() call.
    if (!inventory.complete(raw.name, raw)) return res.status(409).json({ error: 'inventory revision unknown', code: 'inventory-required' });
    // Report fields are decoded by their domain consumer; unrecognized fields remain available to the dashboard.
    const pass: Pass = { raw, body: raw as unknown as R, receivedAt, learned: [] };
    // The stored report before this one, which the merchant observer, the store row and the merchant jobs owner's
    // scheduling read, so it is taken before any row runs.
    pass.previous = state.statuses[raw.name];
    for (const { row, stage } of TABLE_I) measureStatusStage(stage, () => rows[row](pass));
    return res.json(inventory.acknowledge(pass.body.name, measureStatusStage('response', () => ports.reply.send(pass.body.name))));
  }
  return { handle };
}

// The catalogs (table I's `catalogs` row).
const listCatalogs = ["travelPlaces", "bestiaryCatalog", "skillCatalog"] as const;
interface CatalogState {
  validateCatalog?: ReturnType<typeof createCatalogValidation>;
  travelPlaces: unknown;
  bestiaryCatalog: unknown;
  skillCatalog: unknown;
  monsterChoices: unknown;
  monsterLocationsVersion?: number;
  monsterHunterLocation: { map: string; x: number; y: number } | null;
  appearanceChoices: unknown;
  merchantCatalog: unknown;
  merchantCatalogVersion: unknown;
  bankVaults: unknown;
}

function acceptObjectCatalogs(body: Record<string, unknown>, state: CatalogState): void {
  if (body.appearanceChoices && typeof body.appearanceChoices === "object")
    state.appearanceChoices = body.appearanceChoices;
  if (body.merchantCatalog && typeof body.merchantCatalog === "object") {
    state.merchantCatalog = body.merchantCatalog;
    state.merchantCatalogVersion =
      body.merchantCatalogVersion || requestObject(body.merchantCatalog).version || null;
  }
}

function rejectInvalidCatalogs(body: Record<string, unknown>, state: CatalogState): void {
  for (const key of ['bestiaryCatalog', 'skillCatalog', 'merchantCatalog'] as const) {
    if (body[key] !== undefined && state.validateCatalog?.(key, body[key], body.clientVersion) === false)
      delete body[key];
  }
}

/** The intake takes the large discovery catalogs once and deletes them from the stored report;
 *  table F's catalog rows name them. */
export function consumeStatusCatalogs(body: Record<string, unknown>, state: CatalogState): void {
  rejectInvalidCatalogs(body, state);
  for (const key of listCatalogs) {
    const value = body[key];
    if (Array.isArray(value) && value.length) state[key] = value;
  }
  if (Array.isArray(body.monsterChoices) && body.monsterChoices.length) {
    state.monsterChoices = body.monsterChoices;
    state.monsterLocationsVersion = Number(body.monsterLocationsVersion) || 0;
  }
  acceptHunterLocation(body, state);
  acceptObjectCatalogs(body, state);
  for (const key of CATALOG_FIELDS) delete body[key];
}

// The catalog validation against the installed game's definitions.
export type CatalogDefinitions = Record<'monsters' | 'skills' | 'items', Record<string, unknown>> & {conditions?:Record<string,unknown>};
type Kind = 'bestiaryCatalog' | 'skillCatalog' | 'merchantCatalog';
const domains = { bestiaryCatalog: 'monsters', skillCatalog: 'skills', merchantCatalog: 'items' } as const;

function itemDefinition(value: unknown) {
  return Object.fromEntries(Object.entries(requestObject(value)).filter(([, entry]) =>
    ['string', 'number', 'boolean'].includes(typeof entry) || Array.isArray(entry)));
}
function entries(kind: Kind, value: unknown): unknown[] {
  if (kind === 'merchantCatalog') return array(requestObject(value).allItems);
  if (kind === 'skillCatalog') return array(value).filter(group=>requestObject(group).id!=='conditions').flatMap(group => array(requestObject(group).skills));
  return array(value);
}
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function matchesDefinition(kind: Kind, entry: Record<string, unknown>, expected: unknown): boolean {
  const actual = kind === 'merchantCatalog' ? requestObject(entry.meta).definition : entry.definition;
  const wanted = kind === 'merchantCatalog' ? itemDefinition(expected) : catalogValue(expected, capReached);
  // The game adds derived top-level fields (e.g. max_hp and item id) after
  // loading G. Validate every installed field while allowing those additions.
  const reported = requestObject(actual);
  const projected = Object.fromEntries(Object.keys(requestObject(wanted)).map(key => [key, reported[key]]));
  return isDeepStrictEqual(JSON.parse(JSON.stringify(projected)), JSON.parse(JSON.stringify(wanted)));
}

/** Compare complete client projections against the installed version's definitions. */
export function validateCatalog(kind: Kind, value: unknown, definitions: CatalogDefinitions): string | null {
  if(kind==='skillCatalog' && definitions.conditions){
    const group=array(value).find(entry=>requestObject(entry).id==='conditions');
    const conditions=array(requestObject(group).skills);
    const result=validateCatalog('bestiaryCatalog',conditions,{...definitions,monsters:definitions.conditions});
    if(result)return 'conditions: '+result;
  }
  const expected = definitions[domains[kind]], found = new Set<string>();
  if (!expected || !Object.keys(expected).length) return 'installed definitions unavailable';
  for (const raw of entries(kind, value)) {
    const entry = requestObject(raw), id = typeof entry.id === 'string' ? entry.id : '';
    if (!Object.hasOwn(expected, id)) return 'unknown entry: ' + id;
    if (found.has(id) && kind !== 'skillCatalog') return 'duplicate entry: ' + id;
    found.add(id);
    // JSON normalization removes VM prototypes and matches the wire representation.
    if (!matchesDefinition(kind, entry, expected[id]))
      return 'definition mismatch: ' + id;
  }
  const missing = Object.keys(expected).find(id => !found.has(id));
  return missing ? 'missing entry: ' + missing : null;
}

export function createCatalogValidation(version: number, definitions: CatalogDefinitions, report: (message: string) => void) {
  const previous = new Map<Kind, string>();
  return (kind: Kind, value: unknown, clientVersion: unknown) => {
    const error = Number(clientVersion) !== version ? 'game version mismatch' : validateCatalog(kind, value, definitions);
    const result = error || 'validated';
    if (previous.get(kind) !== result) report(`${kind}: ${result} (game ${version})`);
    previous.set(kind, result);
    return !error;
  };
}

/** The catalogs the characters report. A new game client invalidates every one reported on the old
 * client, and the characters send them again on their next reports. */
export interface ReportedCatalogs {
  merchantCatalog?: unknown; merchantCatalogVersion?: unknown; bestiaryCatalog?: unknown; skillCatalog?: unknown;
  monsterChoices?: unknown; travelPlaces?: unknown; appearanceChoices?: unknown;
}
export function resetCatalogs(state: ReportedCatalogs): void {
  state.merchantCatalog = null;
  state.merchantCatalogVersion = null;
  state.bestiaryCatalog = null;
  state.skillCatalog = null;
  state.monsterChoices = null;
  state.travelPlaces = null;
  state.appearanceChoices = null;
}

/** Missing local data blocks catalog acceptance, not the rest of the coordinator. */
export function createInstalledCatalogValidation(version: number, load: () => CatalogDefinitions, report: (message: string) => void) {
  let validate: ReturnType<typeof createCatalogValidation> | undefined, warned = false;
  function prepare() {
    if (validate) return;
    try {
      const definitions = load();
      if (!definitions) throw new Error('missing game data');
      validate = createCatalogValidation(version, definitions, report);
    } catch {
      if (!warned) report(`Catalog validation waiting for installed game ${version} definitions`);
      warned = true;
    }
  }
  prepare();
  return (...args: Parameters<ReturnType<typeof createCatalogValidation>>) => {
    prepare();
    return validate ? validate(...args) : false;
  };
}

// The appearances and the offline snapshot (table I's `roster-evidence` row).
interface AppearanceReport { name: string; skin?: unknown; characterSprite?: unknown; characterDollHtml?: unknown }
function sprite(value: unknown): Sprite | null {
  if (!value || typeof value !== 'object') return null;
  const v=value as Sprite;
  return typeof v.url === 'string' && ['tileSize','columns','rows','x','y'].every((k) =>Number.isFinite(v[k as keyof Sprite]))
    ? {url:v.url,tileSize:v.tileSize,columns:v.columns,rows:v.rows,x:v.x,y:v.y} : null;
}

const emptyAppearance: CharacterAppearance={characterSprite:null,characterDollHtml:null,updatedAt:0};
function mergeAppearance(report: AppearanceReport, before=emptyAppearance, image: Sprite | null, html: string | null) {
  const skin=typeof report.skin === 'string' ? report.skin : before.skin;
  const previous=skin === before.skin ? before : emptyAppearance;
  return {skin,characterSprite:image || previous.characterSprite,
    characterDollHtml:html || previous.characterDollHtml};
}
function sameAppearance(before: CharacterAppearance, next: Omit<CharacterAppearance,'updatedAt'>): boolean {
  return (
    before.skin===next.skin && before.characterDollHtml===next.characterDollHtml &&
    JSON.stringify(before.characterSprite)===JSON.stringify(next.characterSprite)
  );
}

/** Keep appearance separate from live status: a saved doll never makes a character online. */
export function rememberCharacterAppearance(state: AppearanceState, report: AppearanceReport, now: number): boolean {
  const image=sprite(report.characterSprite);
  const html=typeof report.characterDollHtml === 'string' && report.characterDollHtml.trim() ? report.characterDollHtml : null;
  if (!image && !html) return false;
  const before=state.characterAppearances?.[report.name];
  const next=mergeAppearance(report,before,image,html);
  if (before && sameAppearance(before,next)) return false;
  state.characterAppearances={...state.characterAppearances,[report.name]:{...next,updatedAt:now}};
  return true;
}

function inspectionEntry(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const entry = raw as Record<string, unknown>,
    meta =
      entry.meta && typeof entry.meta === "object" ? (entry.meta as Record<string, unknown>) : null;
  return {
    slot: entry.slot,
    item: entry.item,
    ...(meta
      ? {
          meta: Object.fromEntries(
            SNAPSHOT_META_FIELDS.filter((key) => key in meta).map((key) => [key, meta[key]]),
          ),
        }
      : {}),
  };
}
function physicalInventory(items: unknown, slots: unknown): string {
  const physical = (entry: unknown) => {
    if (!entry || typeof entry !== "object") return null;
    const raw = entry as Record<string, unknown>;
    return [raw.slot, raw.item];
  };
  return JSON.stringify([
    Array.isArray(items) ? items.map(physical) : [],
    slots && typeof slots === "object"
      ? Object.entries(slots).map(([slot, entry]) => [slot, physical(entry)])
      : [],
  ]);
}
/**
 * Refreshes the offline-inspection snapshot when the settings owner's roster save is due for it: the
 * physical inventory changed, or the last saved snapshot is rosterSnapshotSaveMs old
 * (persistence/roster-snapshots.ts). The dashboard reads the saved snapshot for every roster
 * character outside the active slots (party-item-details.tsx, account-settings.tsx), a character that
 * reported this run and left its slot included, so it sees a snapshot up to rosterSnapshotSaveMs old
 * where v1.5.0 refreshed it within 30 s. Returns true when the caller should
 * save the roster.
 */
function rememberCharacterSnapshot(
  state: AppearanceState,
  report: Record<string, unknown> & { name?: unknown },
  now: number,
): boolean {
  if (
    typeof report.name !== "string" ||
    !Array.isArray(report.items) ||
    !report.slots ||
    typeof report.level !== "number"
  )
    return false;
  const { name, items, slots } = report;
  const previous = state.characterSnapshots?.[name];
  // Compare only physical identities. meta.world carries the complete catalog
  // and must never be serialized on this heartbeat path or persisted per item.
  const inventoryChanged =
    !previous ||
    physicalInventory(previous.items, previous.slots) !==
      physicalInventory(items, slots);
  return snapshotSaveDue(state, name, inventoryChanged, now, () => {
    const snapshot = Object.fromEntries(
      sectionFields.snapshot.filter((key) => key in report).map((key) => [key, report[key]]),
    );
    snapshot.items = items.map(inspectionEntry);
    snapshot.slots = Object.fromEntries(
      Object.entries(slots).map(([slot, entry]) => [slot, inspectionEntry(entry)]),
    );
    state.characterSnapshots = {
      ...state.characterSnapshots,
      [name]: JSON.parse(JSON.stringify({ ...snapshot, updatedAt: now, seenAt: now })),
    };
  });
}
