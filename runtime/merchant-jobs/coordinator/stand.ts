// The stand: when the idle merchant goes back to its stand, the stand location's route, and the merchant jobs owner's load
// migrations.
import { activeStandSales } from '../../items/coordinator/api.ts';
import { jobReady, type MerchantStandLocation, legacyStandLocation, validStandLocation, AT_STAND, type MerchantEventState, type MerchantAnniversaryControl } from '../rules.ts';
import { partyHooks } from '../../hooks/index.ts';
import { requestObject, type HttpRequest, type HttpResponse, type HttpRouter } from '../../lifecycle/api.ts';
import type { SettingsWrite, SettingsWriteResult } from '../../settings/api.ts';
import { fresh } from '../../protocol/reports.ts';
import { merchantEventReserved } from './event-hold.ts';
import { coordinatorReadyFacts, gatheringReady, gatheringCastActive } from './dispatch.ts';
import { merchantSlotCommand, manualCommandPending, type MerchantWork, type ServiceStatus, type MerchantCommand } from './owner.ts';

// The stand return's coordinator half: when the idle merchant goes back to its stand.
interface IdleStatus extends ServiceStatus {
  gatheringActive?: boolean;
  gatheringCooldowns?: Record<string, number>;
  banking?: boolean;
  standOpen?: boolean;
  // The stand the merchant can open, null when its bag holds none (items/character/bag.ts `standItem`).
  standItem?: string | null;
  lastCommandId?: number;
  navigationState?: string;
  moving?: boolean;
  smartNavigation?: { moving?: boolean; searching?: boolean } | null;
}
interface StandListing {
  state?: string;
  tradeSlot?: string;
  [field: string]: unknown;
}
interface IdlePorts {
  // A console update and a party switch hold the stand return as they hold the dispatch.
  consoleUpdate?(): boolean;
  partySwitch?(): boolean;
  standLocation?(): MerchantStandLocation | null;
  eventReserved?(): boolean;
  storagePending(): boolean;
  merchant(): string | null;
  status(name: string | null): IdleStatus | undefined;
  anniversary(): MerchantAnniversaryControl;
  currentJob(): boolean;
  ensureHome(reason: string): boolean;
  forcedStand(): boolean;
  readyQueuedWork(): boolean;
  // gatheringReady: a gathering mode is a candidate now.
  gatheringReady(): boolean;
  now(): number;
  listings(): StandListing[];
  inventoryMerge(status: IdleStatus): unknown;
  command(name: string | null): MerchantCommand | undefined;
  // A manual command you gave holds the slot until its report.
  manualPending(): boolean;
  issue(name: string, command: MerchantCommand): void;
  nextCommand(): number;
  realm(): string;
}

/** Returns to the stand only when no active work owns merchant movement. */
export function createMerchantIdle(ports: IdlePorts) {
  const travelCommands = new Set(["character-travel", "travel", "force-travel", "return-leader",
    "party-monster-travel", "event-resume-travel"]);
  let manualTravel: { id: number; until: number; observedMoving: boolean } | null = null;

  function navigating(status: IdleStatus): boolean {
    return status.navigationState === "departing" || !!status.moving ||
      !!status.smartNavigation?.moving || !!status.smartNavigation?.searching;
  }

  function manualTravelPending(): boolean {
    const command = ports.command(ports.merchant());
    if (!command || !travelCommands.has(command.type)) return false;
    if (manualTravel?.id !== command.id)
      manualTravel = { id: command.id, until: ports.now() + 10_000, observedMoving: false };
    return true;
  }

  function navigationOwnsMovement(status: IdleStatus | undefined): boolean {
    // A heartbeat can consume a one-shot command before its next report shows
    // movement. Other party heartbeats must not replace it with stand return.
    if (manualTravelPending()) return true;
    if (!status || !fresh(status.seenAt, ports.now(), 'presence')) return false;
    if (navigating(status)) {
      if (manualTravel && status.lastCommandId === manualTravel.id) manualTravel.observedMoving = true;
      return true;
    }
    return admissionPending(status);
  }

  function admissionPending(status: IdleStatus): boolean {
    if (!manualTravel) return false;
    const superseded = (status.lastCommandId || 0) > manualTravel.id;
    if (!superseded && !manualTravel.observedMoving && ports.now() < manualTravel.until) return true;
    manualTravel = null;
    return false;
  }


  function workOwnsMovement(
    anniversary: MerchantAnniversaryControl,
    status: IdleStatus | undefined,
  ): boolean {
    if (finishingCast(status, anniversary)) return true;
    if ([ports.currentJob(), anniversary.busy, anniversary.kissDue].some(Boolean)) return true;
    if (anniversary.reserved || anniversary.featured || ports.forcedStand()) return false;
    return ports.readyQueuedWork() || !!status?.gatheringActive || ports.gatheringReady();
  }

  function atMarket(status: IdleStatus): boolean {
    const location = ports.standLocation?.() || legacyStandLocation;
    return (
      status.map === location.map &&
      Math.hypot((Number(status.x) || 0) - location.x, (Number(status.y) || 0) - location.y) <= AT_STAND
    );
  }

  // The game opens a stand only from a stand item. A merchant with none open and none in its bag still
  // walks back to the market, out of the bank or a job's spot, and opens nothing there.
  function standless(status: IdleStatus, merge: unknown): boolean {
    return !status.standOpen && status.standItem === null && !merge;
  }

  function needsCommand(status: IdleStatus, merge: unknown): boolean {
    // At the market the standless merchant needs no return; a bag merge still sends the visit, whose
    // open merges first.
    if (standless(status, merge) && atMarket(status)) return false;
    const sync = ports.listings().some((listing) => listing.state !== "live" || !listing.tradeSlot);
    if (status.standOpen && atMarket(status) && !sync && !merge) return false;
    const current = ports.command(ports.merchant());
    return (
      current?.type !== "merchant-idle" ||
      (ports.standLocation && JSON.stringify(current.standLocation) !== JSON.stringify(ports.standLocation())) ||
      JSON.stringify(current.listings) !== JSON.stringify(ports.listings())
    );
  }

  function homeReady(merchant: string | null, status: IdleStatus | undefined): boolean {
    return (
      !merchant ||
      !status ||
      ports.currentJob() ||
      ports.ensureHome("stand or anniversary attendance")
    );
  }

  function available(status: IdleStatus | undefined): status is IdleStatus {
    return !!status && !status.banking && fresh(status.seenAt, ports.now(), 'presence');
  }

  // A merge 10 plans from the report sends the merchant on a stand visit, whose stand open merges
  // the bag (the items owner's).
  function inventoryMerge(status: IdleStatus, anniversary: MerchantAnniversaryControl): unknown {
    return !anniversary.reserved && !anniversary.featured ? ports.inventoryMerge(status) : null;
  }

  function finishingCast(status: IdleStatus | undefined, anniversary: MerchantAnniversaryControl): boolean {
    return gatheringCastActive(status, ports.now()) && !anniversary.busy && !anniversary.kissDue &&
      !anniversary.reserved && !ports.forcedStand();
  }

  function reserved(): boolean {
    return !!ports.consoleUpdate?.() || !!ports.partySwitch?.() || !!ports.eventReserved?.() || ports.storagePending() ||
      navigationOwnsMovement(ports.status(ports.merchant()));
  }
  function locationCommand() {
    return ports.standLocation ? {standLocation:ports.standLocation()} : {};
  }
  function idle(): void {
    if (reserved()) return;
    const merchant = ports.merchant(),
      status = ports.status(merchant);
    if (ports.manualPending()) return;
    const anniversary = ports.anniversary();
    if (!merchant || workOwnsMovement(anniversary, status)) return;
    if (!homeReady(merchant, status)) return;
    if (!available(status)) return;
    const merge = inventoryMerge(status, anniversary);
    if (!needsCommand(status, merge)) return;
    ports.issue(merchant, {
      id: ports.nextCommand(),
      type: "merchant-idle",
      ...locationCommand(),
      listings: ports.listings(),
      homeRealm: ports.realm(),
      ...(standless(status, merge) ? { noStand: true } : {}),
    });
  }

  return { idle };
}

// The stand return on the coordinator's records.
type ComposedIdlePorts = Parameters<typeof createMerchantIdle>[0];
interface IdleState extends MerchantEventState {
  merchantCharacter: string | null;
  statuses: Record<string, ReturnType<ComposedIdlePorts["status"]>>;
  merchantCurrent: { id: string } | null;
  merchantAutomations?: Record<string, boolean | undefined>;
  merchantForceStand: unknown;
  merchantStandLocation: MerchantStandLocation | null;
  merchantQueue: MerchantWork[];
  gatheringModes: string[];
  gatheringCooldowns?: Record<string, number | undefined>;
  gatheringNoTool?: Record<string, boolean>;
  protectedFreeSlots?: unknown;
  standListings?: ReturnType<ComposedIdlePorts["listings"]>;
  commands: Record<string, ReturnType<ComposedIdlePorts["command"]>>;
  nextCommandId: number;
  activeRealm: string;
}
type IdleCompositionPorts = Pick<ComposedIdlePorts, "now" | "anniversary" | "ensureHome" | "inventoryMerge" | "consoleUpdate" | "partySwitch"> & {
  visitAllowed?: (name: string) => boolean;
  capacityBlocked: (job: MerchantWork) => boolean;
  collectionReady: (job: MerchantWork) => boolean;
};

/** Keep idle decisions attached to current queues and commands, sharing dispatch's readiness rules. */
export function createCoordinatorMerchantIdle(state: IdleState, ports: IdleCompositionPorts) {
  return createMerchantIdle({
    consoleUpdate: ports.consoleUpdate,
    partySwitch: ports.partySwitch,
    eventReserved: () => merchantEventReserved(state, ports.now()),
    storagePending: () => !!state.merchantCharacter && partyHooks().ask('items.storagePending', state.merchantCharacter),
    merchant: () => state.merchantCharacter,
    status: (name) => state.statuses[String(name)],
    anniversary: () => ports.anniversary(),
    currentJob: () => !!state.merchantCurrent,
    ensureHome: (reason) => ports.ensureHome(reason),
    forcedStand: () => !!state.merchantForceStand,
    standLocation: () => state.merchantStandLocation,
    readyQueuedWork: () => state.merchantQueue.some(job => jobReady(job, coordinatorReadyFacts(state, ports))),
    gatheringReady: () => gatheringReady(state, ports.now()).length > 0,
    now: () => ports.now(),
    listings: () => activeStandSales(state.standListings || []),
    inventoryMerge: (status) => ports.inventoryMerge(status),
    command: (name) => state.commands[String(name)],
    manualPending: () => manualCommandPending(state),
    issue: (_name, command) => { merchantSlotCommand(state, 'idle', command); },
    nextCommand: () => state.nextCommandId++,
    realm: () => state.activeRealm,
  });
}

// The stand location: its route and the merchant jobs owner's load migrations.
interface State { merchantStandLocation: MerchantStandLocation | null }
type CanStand = (x: number, y: number) => boolean;

// The merchant job owner's load migrations: the stand location's first pick and the retired "merchant
// luck exchange" priority, the legacy pseudo-routine folded into the one Merchant's Luck itinerary.
// Each writes through the settings writer as `migration:merchant`, as the settings owner's slot
// migration writes as `migration:slots`, and answers whether it wrote, so the start saves once.
export function migrateMerchantSettings(state: State & { merchantRoutinePriorities: Record<string, number> }, firstSetup: boolean, canStand: CanStand,
  write: (batch: SettingsWrite) => SettingsWriteResult): boolean {
  const changes: SettingsWrite["changes"][number][] = [];
  if (!state.merchantStandLocation) changes.push({ field: "merchantStandLocation", value: firstSetup ? firstStandLocation(canStand) : {...legacyStandLocation} });
  if ("merchant luck exchange" in state.merchantRoutinePriorities) {
    const { ["merchant luck exchange"]: _retired, ...kept } = state.merchantRoutinePriorities;
    changes.push({ field: "merchantRoutinePriorities", value: kept });
  }
  if (!changes.length) return false;
  const written = write({ by: "migration:merchant", changes });
  if (!written.ok) throw Error(`The merchant settings were not migrated: ${written.error}`);
  return true;
}
// Retry rejected points, then inspect the randomized grid once so setup is bounded even if the
// native map only has a small valid patch in this area.
function firstStandLocation(canStand: CanStand): MerchantStandLocation {
  const start = Math.floor(Math.random() * 40401);
  for (let attempt = 0; attempt < 256; attempt++) {
    const x = Math.floor(Math.random()*201)-100, y = Math.floor(Math.random()*201)-100;
    if (canStand(x,y)) return {map:"main",x,y};
  }
  for (let offset = 0; offset < 40401; offset++) {
    const cell = (start + offset) % 40401;
    const x = cell%201-100, y = Math.floor(cell/201)-100;
    if (canStand(x,y)) return {map:"main",x,y};
  }
  throw Error("No valid merchant stand location in Main setup area");
}

// 08 registers its stand location route, as the other owners' installs do.
export function installStandLocationRoute(router: HttpRouter, state: State, canStand: CanStand, write: (batch: SettingsWrite) => SettingsWriteResult): void {
  router.post('/party-api/merchant/stand-location', standLocationRoute(state, canStand, write));
}
// The player's stand location is a setting, written through the settings writer.
function standLocationRoute(state: State, canStand: CanStand, write: (batch: SettingsWrite) => SettingsWriteResult) {
  return (req: HttpRequest, res: HttpResponse) => {
    const point = requestObject(req.body);
    if (!validStandLocation(point) || !canStand(point.x,point.y))
      return res.status(400).json({error:'Choose a valid, clear merchant stand location on Main'});
    const written = write({ by: 'dashboard:stand-location', changes: [{ field: 'merchantStandLocation', value: {map:'main',x:point.x,y:point.y} }] });
    if (!written.ok) return res.status(400).json({ error: written.error });
    return res.json({ok:true,merchantStandLocation:state.merchantStandLocation});
  };
}
