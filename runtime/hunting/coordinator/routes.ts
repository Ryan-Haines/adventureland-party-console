// Hunts and farming's routes (2.1 coordinator/routes.ts): each parses its request, asks the
// module once and replies with today's words.
import { isRequestObject, requestObject, requestText, type HttpHandler, type HttpRequest, type HttpResponse, type HttpRouter }
  from '../../lifecycle/api.ts';
import type { ReturnLocation } from '../../events/api.ts';
import type { HuntCommand } from '../api.ts';
import { partyHooks } from '../../hooks/index.ts';
import { fresh } from '../../protocol/reports.ts';
import { valueProblem, type SettingsChange, type SettingsWrite, type SettingsWriteResult } from '../../settings/api.ts';
import { createHuntMode } from '../../tasks/coordinator/api.ts';
import { validMonsterPriorities } from '../../characters/targeting/api.ts';
import { modeSlot } from '../../settings/coordinator/api.ts';
import { createHuntEntry, type HuntEntryPorts, type HuntModeState } from './modes.ts';
import { huntSpawnKey, validFarmingLocation } from '../areas.ts';
import { huntingSavedFields, validSearchRadius, type HuntFailureState } from '../saved-fields.ts';
import { SEARCH_RADIUS_RANGE, searchReach, validHuntSettings } from '../rules.ts';
import { defaultSearchRadius, zones, type Catalog } from '../zones.ts';
import { createFocusSelection, createMonsterSelection, searchRadius, type FocusState, type MonsterSelectionPorts,
  type MonsterSelectionState } from './farm.ts';
import { applyHuntThresholds, completeHuntInteraction, editHuntBlacklist, huntSettings, retryHuntReturn } from './hunt.ts';
import type { createCave } from './cave.ts';
import { writeSpot } from './record.ts';

// The mode request (the old `mode` is the status owner's app interface v1) ----

// The dashboard's one mode selector, the PWA and the APK still send a single `mode`. A combat mode
// entry sets that combat mode and target Farming; Hunt or an add-on's target entry sets that target
// and leaves the combat mode. The status owner's two controls send the two fields.
const modesOf = (slot: 'combat-mode' | 'target-mode') => partyHooks().entries(slot).map(m => m.mode);
export const farmingModeNames = () => [...modesOf('combat-mode'), ...modesOf('target-mode').filter(mode => mode !== 'farming')];
// The settings owner's modeSlot says which slot holds the name; the request's pair differs from
// the load pair.
export function slotsOfMode(mode: string): { combatMode?: string; targetMode: string } {
  return modeSlot(mode, modesOf('combat-mode'), modesOf('target-mode')) === 'combat' ? { combatMode: mode, targetMode: 'farming' } : { targetMode: mode };
}
const entryOf = (slot: 'combat-mode' | 'target-mode', value: unknown): string | undefined | null =>
  value === undefined ? undefined : partyHooks().entries(slot).some(m => m.mode === value) ? String(value) : null;
// The request's slot fields: `combatMode` and `targetMode`, either or both, or the old `mode`;
// null when a field names no entry of its slot.
export function requestedSlots(body: Record<string, unknown>): { combatMode?: string; targetMode?: string } | null {
  if (body.combatMode === undefined && body.targetMode === undefined) {
    const mode = requestText(body.mode);
    return farmingModeNames().includes(mode) ? slotsOfMode(mode) : null;
  }
  const combatMode = entryOf('combat-mode', body.combatMode), targetMode = entryOf('target-mode', body.targetMode);
  return combatMode === null || targetMode === null ? null
    : { ...(combatMode !== undefined ? { combatMode } : {}), ...(targetMode !== undefined ? { targetMode } : {}) };
}
// Why an add-on target mode cannot start for this scope, or null; the add-on answers in its own
// words, from its own values of the settings placed per scope.
function addonUnavailable(state: HuntModeState, mode: string): string | null {
  const holder = partyHooks().targetModes().find(m => m.mode === mode), settings = holder && partyHooks().targetSettings(holder.addon);
  if (!settings) return null;
  const stores = ((state as { addonFarming?: Record<string, Record<string, unknown>> }).addonFarming ||= {});
  const result = settings({ owner: state.leader, scope: state, store: stores[holder!.addon] ||= {}, now: Date.now(), body: { action: 'available' } }, state);
  return result.ok ? null : result.error;
}
// A Hunt backup: a focus of real monsters and its location.
function backupValue(value: unknown): { monsterFocus: string[]; location: unknown } | null {
  const body = requestObject(value);
  return backupFocus(body.monsterFocus) ? { monsterFocus: body.monsterFocus, location: body.location } : null;
}
// A backup focus names real monsters: a non-empty list of ids with no 'all'.
function backupFocus(focus: unknown): focus is string[] {
  return Array.isArray(focus) && focus.length > 0 && focus.every(id => typeof id === 'string' && id !== 'all');
}
// The focus a `backup_required` refusal answers, which the Hunt setup opens on: the backup focus, or none.
function refusalFocus(focus: unknown): string[] {
  return backupFocus(focus) ? focus : [];
}

// ---- The Hunt routes ----

interface HuntRouteState extends HuntModeState, HuntFailureState {
  monsterChoices?: Catalog | null;
  farmAreaState?: import('../api.ts').FarmAreaState | null;
  activeConvoy: { id: string; purpose?: string | null; phase: string; nativeFallback?: boolean } | null;
  escape?: { stage: string } | null;
  commands: Record<string, HuntCommand | undefined>;
}
type HuntRoutePorts = Omit<HuntEntryPorts, 'fighting' | 'cancelled'> & Pick<import('../../tasks/api.ts').HuntModePorts, 'write'> & {
  now(): number;
  fighting(state: HuntRouteState, names: string[]): boolean;
  intent(name: string): { cancelled: boolean };
  waypoint(name: string | null): ReturnLocation | null;
  write(batch: SettingsWrite): SettingsWriteResult;
  owned(name: string): unknown;
  ownsTravel: Parameters<typeof retryHuntReturn>[1]['ownsTravel'];
  fresh: Parameters<typeof retryHuntReturn>[1]['fresh'];
  cancelConvoy(): void;
  start: Parameters<typeof retryHuntReturn>[1]['start'];
  persist(): void;
  ladder?: { progress(): void };
  // The scope's combat group, which the blacklist and threshold notices name (`hunt.blacklisted`).
  group(): string | null;
};

/** The Hunt mode, blacklist, settings, retry and Daisy receipt routes over one scope. */
export function createHuntRoutes(state: HuntRouteState, ports: HuntRoutePorts) {
  const cancelled = (name: string) => ports.intent(name).cancelled;
  // The tasks owner's target mode slot writes the slot fields and asks the hunting
  // owner's Hunt entry.
  const modes = createHuntMode(state, { write: ports.write,
    entry: createHuntEntry(state, { ...ports, cancelled, fighting: () => ports.fighting(state, ports.participants()) }) });
  const validLocation = (focus: string[], location: unknown) => validFarmingLocation(state.monsterChoices || [], focus, location);
  function availableHunt(): string | null {
    const names = ports.participants();
    if (!state.leader || !names.length) return 'an online non-merchant party leader is required';
    const quest = names.some(name => { const q = state.statuses[name]?.monsterHunt; return q && q.count > 0 && q.remainingMs > 0; });
    return !state.monsterHunterLocation && !quest ? "Daisy's location is not available yet; wait for the character catalog" : null;
  }
  function mode(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body), slots = requestedSlots(body), target = slots?.targetMode;
    if (!slots) return res.status(400).json({ error: 'invalid farming mode' });
    const unavailable = target === undefined ? null : target === 'hunt' ? availableHunt() : addonUnavailable(state, target);
    if (unavailable) return res.status(409).json({ error: unavailable });
    let location = state.targetMode === 'hunt' ? state.monsterHunt?.returnLocation || null : ports.waypoint(state.leader);
    let backup: ReturnType<typeof backupValue> = null;
    if (target === 'hunt' && body.backup !== undefined) {
      backup = backupValue(body.backup);
      location = backup && validLocation(backup.monsterFocus, backup.location);
      if (!backup || !location) return res.status(400).json({ error: 'Select valid backup farming monsters and an area' });
    }
    // A Hunt with no backup spot or focus answers `backup_required` with the focus the Hunt setup
    // opens on, so the dashboard opens the setup on the code.
    const focus = backup?.monsterFocus || state.monsterFocus;
    if (target === 'hunt' && (!location || !backupFocus(focus)))
      return res.status(409).json({ error: 'Choose a backup farming location before starting Hunt', code: 'backup_required', focus: refusalFocus(focus) });
    const written = modes.select(slots, location, backup?.monsterFocus, body.backup !== undefined);
    if (!written.ok) return res.status(400).json({ error: written.error, field: written.field });
    ports.persist();
    // `farmingPolicy` is the single mode the apps read (the status owner's interface
    // v1).
    return res.json({ ok: true, combatMode: state.combatMode, targetMode: state.targetMode, farmingPolicy: state.farmingPolicy, monsterHunt: state.monsterHunt });
  }
  // Saved entries stay removable while the catalogs fill again after a restart.
  function knownMonster(id: unknown, action: unknown): id is string {
    if (typeof id !== 'string') return false;
    if ((state.monsterChoices || []).some(monster => monster.id === id)) return true;
    return action === 'remove' && (Object.hasOwn(state.huntBlacklist || {}, id) || Object.hasOwn(state.huntFailures || {}, id));
  }
  function blacklist(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body), action = requestText(body.action);
    if (action !== 'add' && action !== 'remove' && action !== 'clear') return res.status(400).json({ error: 'invalid blacklist action' });
    if (action !== 'clear' && !knownMonster(body.monsterId, action)) return res.status(400).json({ error: 'unknown monster' });
    editHuntBlacklist(state, action, requestText(body.monsterId), ports.now(), ports.group());
    ports.persist();
    return res.json({ ok: true, blacklist: state.huntBlacklist });
  }
  // The scope's Hunt settings, written through the settings writer for the request's character
  // when it names one, so the scoped route and the writer address the same farming profile.
  // The patch's relocation switch, which the PWA and APK send here, is the party's root setting
  // `relocateIfCompeting`, written in the same batch, and no Hunt settings value holds it.
  function settings(req: HttpRequest, res: HttpResponse): unknown {
    const { character, ...patch } = requestObject(req.body);
    if (!validHuntSettings(patch)) return res.status(400).json({ error: 'Invalid Hunt settings or spawn preferences' });
    const { relocateIfCompeting, ...body } = patch;
    if (body.preferredSpawns && !Object.entries(body.preferredSpawns).every(([monster, key]) =>
      !key || zones(state.monsterChoices || [], [monster]).some(location => huntSpawnKey(location) === key)))
      return res.status(400).json({ error: 'Select an available Hunt spawn from the catalog' });
    const { relocateIfCompeting: _root, ...previous } = huntSettings(state);
    const value = { ...previous, ...body, ...(body.preferredSpawns ? { preferredSpawns: { ...previous.preferredSpawns, ...body.preferredSpawns } } : {}) };
    const written = ports.write({ by: 'dashboard:hunt-settings', changes: [
      { field: 'huntSettings', ...(typeof character === 'string' ? { character } : {}), value },
      ...(relocateIfCompeting === undefined ? [] : [{ field: 'relocateIfCompeting', value: relocateIfCompeting }])] });
    if (!written.ok) return res.status(400).json({ error: written.error });
    // The thresholds rebuild the blacklist.
    applyHuntThresholds(state, ports.now(), ports.group());
    ports.persist();
    return res.json({ ok: true, huntSettings: state.huntSettings });
  }
  function retryReturn(_req: HttpRequest, res: HttpResponse): unknown {
    const answer = retryHuntReturn(state, { ...ports, cancelled });
    return res.status(answer.status).json(answer.body);
  }
  function interactionComplete(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body), name = requestText(body.character);
    if (!ports.owned(name)) return res.status(400).json({ error: 'unknown character' });
    const answer = completeHuntInteraction(state, name, { commandId: body.commandId, cycleId: body.cycleId, success: body.success,
      error: body.error ? requestText(body.error) : '' });
    if (answer.status === 200) ports.persist();
    return res.status(answer.status).json(answer.body);
  }
  return { mode, blacklist, settings, controls: { retryReturn, interactionComplete } };
}

// ---- The focus route ----

interface FocusRoutePorts {
  focusChanged?(): void;
  owned(name: string): unknown;
  members(): string[];
  invalidate(names: string[], reason: string, shared: boolean): void;
  persist(): void;
  write(batch: SettingsWrite): SettingsWriteResult;
}
// A focus is up to 256 monster ids without the Fairy, which only the passive rules hunt.
const focusRequest = (focus: unknown): focus is string[] =>
  Array.isArray(focus) && focus.length <= 256 && focus.every(entry => entry !== 'tinyp' && typeof entry === 'string' && /^[a-z0-9_]+$/i.test(entry));

// The hunting owner's half of the character command: a command that names farming monsters names a
// valid farm area for them, which the command keeps as the preferred spot, and an accepted command
// sets the character's farming focus. The items owner's character command route asks it around its
// own handlers.
export interface FarmingCommandPorts {
  // The scope `name` farms in (the hunting owner's farming record of a
  // character).
  farmingState(name: string): FocusState;
  // The farm area the monsters and the asked spot name (areas.ts validFarmingLocation).
  location: typeof validFarmingLocation;
  members(): string[];
  invalidate(names: string[], reason: string, shared: boolean): void;
  persist(): void;
}
export function createFarmingCommand(state: FocusState & { monsterChoices?: Catalog | null; farmAreaState: unknown }, ports: FarmingCommandPorts) {
  return {
    valid(body: Record<string, unknown>): boolean {
      const ids = body.farmingMonsterIds;
      if (ids === undefined) return true;
      return Array.isArray(ids) && !!ids.length && ids.every(id => typeof id === 'string' && /^[a-z0-9_]+$/i.test(id)) &&
        !ids.includes('tinyp') && !ids.includes('phoenix') && !!ports.location(state.monsterChoices || [], ids, body.location);
    },
    place(body: Record<string, unknown>): void {
      if (!body.farmingMonsterIds) return;
      body.location = ports.location(state.monsterChoices || [], body.farmingMonsterIds, body.location);
      writeSpot(state, { farmAreaState: { preferredLocation: body.location } });
    },
    focus(body: Record<string, unknown>): void {
      if (!body.farmingMonsterIds) return;
      const name = requestText(body.character);
      createFocusSelection(ports.farmingState(name), { members: ports.members, invalidate: ports.invalidate })
        .select(name, [...new Set(body.farmingMonsterIds as string[])]);
      ports.persist();
    },
  };
}

/**
 * A character's request writes its monster priorities and search radius through the settings
 * writer as one batch, and only an accepted write changes the focus (farm.ts `createFocusSelection`).
 */
export function createFocusRoute(state: FocusState, ports: FocusRoutePorts) {
  const selection = createFocusSelection(state, { focusChanged: () => ports.focusChanged?.(), members: () => ports.members(),
    invalidate: (...args) => ports.invalidate(...args) });
  return function focus(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body), focus = body.monsterFocus, priorities = body.monsterPriorities, radius = body.monsterSearchRadius;
    if (!focusRequest(focus)) return res.status(400).json({ error: 'invalid monster focus' });
    if (radius !== undefined && !validSearchRadius(radius)) return res.status(400).json({ error: `monster search radius must be between ${SEARCH_RADIUS_RANGE.min} and ${SEARCH_RADIUS_RANGE.max}` });
    const name = body.character ? requestText(body.character) : null;
    if (name && !ports.owned(name)) return res.status(400).json({ error: 'unknown character' });
    const normalized = focus.includes('all') ? ['all'] : [...new Set(focus)];
    // The request's priorities round to whole numbers; targeting's declaration checks them on the
    // write, and a value that is no object reaches it as sent. A request that names no character
    // writes none, so targeting's one-character check refuses its priorities before the focus
    // changes, as v1.5.0 did.
    const normalizedPriorities = isRequestObject(priorities)
      ? Object.fromEntries(Object.entries(priorities).map(([id, value]) => [id, Math.round(Number(value))])) : priorities;
    if (!name && priorities !== undefined && !validMonsterPriorities(normalizedPriorities))
      return res.status(400).json({ error: 'invalid monster priorities' });
    if (name) {
      const changes: SettingsChange[] = [{ field: 'monsterSearchRadiusByCharacter', character: name,
        value: searchRadius(normalized, radius, state.monsterSearchRadiusByCharacter[name]) }];
      if (priorities !== undefined) changes.unshift({ field: 'monsterPrioritiesByCharacter', character: name, value: normalizedPriorities });
      const written = ports.write({ by: 'dashboard:focus', changes });
      if (!written.ok) return res.status(400).json({ error: written.error });
    }
    selection.select(name, normalized);
    ports.persist();
    return res.json({ ok: true, character: name, monsterFocus: normalized,
      monsterPriorities: name ? state.monsterPrioritiesByCharacter[name] || {} : normalizedPriorities ?? {},
      monsterSearchRadius: name ? searchReach(state.monsterSearchRadiusByCharacter, name) : defaultSearchRadius });
  };
}

// The party's farming spot (the dashboard's checkpoint button): the spot is where the leader stands
// now, so it needs the leader's present report; every member's farming walk is authorized to it.
export function createPartyCheckpointRoute(
  state: { leader: string | null; location: ReturnLocation | null; statuses: Record<string, { seenAt: number; map: string; x: number; y: number } | undefined> },
  ports: { now(): number; members(): string[]; authorize(names: string[], location: ReturnLocation, shared: boolean): void; persist(): void },
) {
  return function checkpoint(_req: HttpRequest, res: HttpResponse): unknown {
    const status = state.statuses[String(state.leader)];
    if (!state.leader || !status || !fresh(status.seenAt, ports.now(), 'presence'))
      return res.status(409).json({ error: "an online party leader is required" });
    ports.authorize(ports.members(), { map: status.map, x: Number(status.x), y: Number(status.y) }, true);
    ports.persist();
    return res.json({ ok: true, leader: state.leader, partyLocation: state.location });
  };
}

// ---- The monster and rare routes ----

/** Navigate to a monster, the passive rare rules, and an add-on target mode's target switch. */
export function createMonsterSelectionRoutes(state: MonsterSelectionState, ports: MonsterSelectionPorts & { dungeon?: { release(): Error | null } }) {
  const selection = createMonsterSelection(state, ports);
  const known = (id: unknown): id is string => typeof id === 'string' && /^[a-z0-9_]+$/i.test(id) && (state.monsterChoices || []).some(entry => entry.id === id);
  // The leader counts online by the `presence` age.
  const onlineLeader = () => {
    const status = state.statuses[String(state.leader)];
    return !!state.leader && !!status && fresh(status.seenAt, ports.now(), 'presence');
  };
  function navigate(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body), id = body.monsterId;
    if (id === 'tinyp') return res.status(400).json({ error: 'Fairy has no regular route; enable passive Fairy hunting' });
    // The order's own declaration refuses a bad Phoenix order first, as the earlier
    // console did (monster-selection.ts:35), with the writer's game data.
    // The saved field takes the empty default, and a patrol start needs a whole order.
    const order = huntingSavedFields.settings.phoenixRouteOrder;
    const orderProblem = id === 'phoenix' && (Array.isArray(body.phoenixRouteOrder) && !body.phoenixRouteOrder.length ? order.refusal
      : valueProblem(order, body.phoenixRouteOrder, undefined, { spawns: state.monsterChoices ?? null }));
    if (orderProblem) return res.status(400).json({ error: orderProblem });
    if (!known(id)) return res.status(400).json({ error: 'unknown monster' });
    if (!onlineLeader()) return res.status(409).json({ error: 'an online party leader is required' });
    const location = body.location !== undefined ? validFarmingLocation(state.monsterChoices || [], [id], body.location) : ports.destination(id);
    if (!location) return res.status(409).json({ error: 'this monster has no known spawn location' });
    // The Phoenix order saves before anything moves.
    if (id === 'phoenix') {
      const written = ports.write({ by: 'dashboard:navigate-to-monster', changes: [{ field: 'phoenixRouteOrder', value: body.phoenixRouteOrder }] });
      if (!written.ok) return res.status(400).json({ error: written.error });
    }
    const refusal = ports.dungeon?.release();
    if (refusal) return res.status(409).json({ error: String(refusal) });
    const participants = selection.select(id, location);
    if (!participants) return res.status(409).json({ error: 'the party convoy could not be started' });
    return res.json({ ok: true, monsterId: id, location, leader: state.leader, participants });
  }
  function passive(req: HttpRequest, res: HttpResponse): unknown {
    const settings = requestObject(req.body);
    if (!isRequestObject(req.body) || !ports.validPassive(settings)) return res.status(400).json({ error: 'Invalid passive hunting settings' });
    if (Object.keys(requestObject(settings.rules)).some(id => id === 'fieldgen0' || !known(id))) return res.status(400).json({ error: 'Unknown passive hunting monster' });
    const written = ports.setPassive(settings);
    if (!written.ok) return res.status(400).json({ error: written.error });
    return res.json({ ok: true, passiveRareHunts: state.passiveRareHunts, passiveHunting: state.passiveHunting });
  }
  // A target mode add-on's target switch: the same walk as a pick by hand, keeping the mode.
  function modeTarget(id: string, location: ReturnLocation): string[] | null {
    if (!known(id) || !onlineLeader()) return null;
    if (ports.dungeon?.release()) return null;
    return selection.select(id, location, true);
  }
  return { navigate, passive, modeTarget, select: selection.select };
}

/**
 * A follower's saved preferences, with no controller run: the two slot fields are settings of the
 * follower's own farming profile, written through the settings writer; the Hunt backup focus and
 * location are the hunting owner's records, set only once the writer accepted the fields.
 */
export function createSavedFarmingModeRoute(state: { monsterChoices?: Catalog | null }, ports: {
  profile(name: string): Record<string, unknown>;
  persist(): void;
  write(batch: SettingsWrite): SettingsWriteResult;
}): HttpHandler {
  return (req, res) => {
    const body = requestObject(req.body), slots = requestedSlots(body);
    if (!slots) return res.status(400).json({ error: 'invalid farming mode' });
    const character = String(body.character), profile = ports.profile(character), backup = requestObject(body.backup);
    const focus = body.backup === undefined ? profile.monsterFocus : backup.monsterFocus;
    const location = body.backup === undefined ? profile.location : backup.location;
    const destination = slots.targetMode === 'hunt' && backupFocus(focus) ? validFarmingLocation(state.monsterChoices || [], focus, location) : null;
    // As the party route, the refusal carries the focus the Hunt setup opens on.
    if (slots.targetMode === 'hunt' && !destination) return res.status(body.backup === undefined ? 409 : 400).json({
      code: 'backup_required', error: 'Choose valid backup farming monsters and a location before saving Hunt',
      focus: refusalFocus(focus) });
    const written = ports.write({ by: 'dashboard:farming-mode', changes: (['combatMode', 'targetMode'] as const)
      .flatMap(field => slots[field] === undefined ? [] : [{ field, character, value: slots[field] }]) });
    if (!written.ok) return res.status(400).json({ error: written.error });
    if (destination) {
      writeSpot(profile, { location: destination, monsterFocus: [...new Set(focus as string[])] });
      ports.persist();
    }
    // The single mode the apps read, derived from the saved pair (the status owner's interface
    // v1).
    return res.json({ ok: true, combatMode: profile.combatMode, targetMode: profile.targetMode, farmingPolicy: profile.farmingPolicy, savedOnly: true });
  };
}

/** The Cave visit's GET and its actions (coordinator/cave.ts); a refused action answers 409 with its words. */
export function installCaveRoutes(router: HttpRouter, cave: Pick<ReturnType<typeof createCave>, 'snapshot' | 'action'>): void {
  router.get('/party-api/daily-dungeons', (_req, res) => res.json(cave.snapshot()));
  router.post('/party-api/daily-dungeons', (req, res) => {
    try {
      cave.action(requestObject(req.body));
      return res.json(cave.snapshot());
    } catch (error) {
      return res.status(409).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}
