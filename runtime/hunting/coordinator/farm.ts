// Farming: the
// monster focus and the selected farm destination, the farm area's competition evidence and
// relocation, failed farm travel and its ladder, the farming walk's combat arrival, and the empty
// spawn return's decision.
import type { ConvoyNavigationPlatform } from '../../movement/api/coordinator.ts';
import { classifyTravelDefense, farmRecovers, handsCombatOver, samePlace, walkEnds,
  type SharedConvoy, type SharedState } from '../../movement/api/coordinator.ts';
import { type EventAttendance, type ReturnLocation } from '../../events/api.ts';
import { playerMoved } from '../../events/coordinator/api.ts';
import type { LadderPort } from '../../tasks/api.ts';
import { partyHooks } from '../../hooks/index.ts';
import type { SettingsWrite, SettingsWriteResult } from '../../settings/api.ts';
import type { PassiveSettings } from '../rules.ts';
import { contains, defaultSearchRadius, id as areaId, resolve, type Catalog } from '../zones.ts';
import { farmingAreas, type FarmingArea as CatalogArea } from '../areas.ts';
import type { FarmAreaState, FarmRelocation, FarmReport, FarmSpot, FarmSpotAnswer, HuntCycle } from '../api.ts';
import { fresh, reportClockError } from '../../protocol/reports.ts';
import { navigational } from '../../status/api.ts';
import { appendCombatLog } from '../../status/coordinator/api.ts';
import { MONSTER_PRIORITY } from '../../characters/targeting/api.ts';
import { alternatives, contests, searchReach, standsAt, transientFailure } from '../rules.ts';
import { ownsHuntRoute } from './hunt.ts';
import { resetScatter, writeSpot } from './record.ts';

// ---- The members' farming destinations ----

import { endTownMembership, type NavigationIntent } from '../../movement/api/coordinator.ts';
export interface FarmingIntentState {
  navigationIntents?: Record<string, NavigationIntent | undefined> | null;
  merchantCharacter: string | null;
  leader: string | null;
  followers: Record<string, boolean>;
  characterLocations: Record<string, ReturnLocation | undefined>;
  location: ReturnLocation | null;
  commands: Record<string, { type: string } | undefined>;
  targetMode?: string;
  monsterHunt?: { participants: string[] } | null;
  huntEventTrips?: Record<string, { endedAt?: number | null }[] | undefined>;
  activeConvoy?: { id: string; location: ReturnLocation; label: string; participants: string[]; purpose?: string | null;
    requester?: { tier?: import('../../protocol/ranks.ts').Tier } | null } | null;
  townCycle?: { id: string; pending: string[] } | null;
}
export interface FarmingIntentPorts {
  now(): number;
  // The account's characters the farming walk may name.
  names(): string[];
  // The lifecycle owner's answer whether a character is online by any client (roster-projection.ts `online`).
  online(name: string): boolean;
  cancelConvoy(): unknown;
  startConvoy(destination: ReturnLocation, label: string, participants: string[], purpose?: string | null, cause?: undefined,
    tier?: import('../../protocol/ranks.ts').Tier): boolean;
  // The events owner's return travel, which keeps its owners' waypoints on the members' destinations.
  events(): { forget(names: string[], shared: boolean): void; retarget(names: string[], destination: ReturnLocation, shared: boolean): void;
    convoyRestarted(from: string, to: string | null): void };
  persist(): void;
}

/**
 * Each member's farming destination and its revision: the member's own location, or the
 * party's. A cancel bumps the revision so no older snapshot authorizes a walk, and a new
 * destination keeps it. The events owner's event returns read the destinations through these functions.
 */
export function createFarmingIntents(state: FarmingIntentState, ports: FarmingIntentPorts) {
  const intents = state.navigationIntents ||= {};
  function intent(name: string | null): NavigationIntent {
    const saved = intents[String(name)] || { revision: 0, cancelled: false };
    // A Hunt owns its participants' destination while it runs, so an emptied farming focus does
    // not cancel theirs.
    const hunted = state.targetMode === 'hunt' && !!state.monsterHunt &&
      state.monsterHunt.participants.includes(String(name));
    return saved.cancelled && saved.reason === 'monster focus cleared' && hunted ? { ...saved, cancelled: false } : saved;
  }
  // The party's fighters: the leader and its followers that are online, never the merchant. A Follow
  // mark stays on a character that is not logged in, and every reader of this list (the escape, the
  // death recovery, the farm walk) waited for that character to report (live console, 2026-11-18).
  const members = () => ports.names().filter(name => name !== state.merchantCharacter &&
    (name === state.leader || (!!state.followers[name] && ports.online(name))));
  function waypoint(name: string | null): ReturnLocation | null {
    if (intent(name).cancelled) return null;
    return state.characterLocations[String(name)] || (members().includes(String(name)) ? state.location : null) || null;
  }
  function invalidate(names: string[], reason: string, shared = false): void {
    const affected = new Set(names);
    if (shared) writeSpot(state, { location: null });
    for (const name of affected) {
      // A member that leaves its destination ends its Hunt event trip.
      const trip = reason !== 'new destination' ? state.huntEventTrips?.[name]?.at(-1) : undefined;
      if (trip && !trip.endedAt) trip.endedAt = ports.now();
      intents[name] = { revision: intent(name).revision + 1, cancelled: true, reason };
      delete state.characterLocations[name];
      // A command that walks the member to its old destination ends with it.
      const command = state.commands[name];
      if (command && navigational(command)) delete state.commands[name];
    }
    ports.events().forget(names, shared);
    // The party's walk goes on for the members it keeps, led by the leader, so a removed pace
    // member leaves no one waiting.
    const convoy = state.activeConvoy;
    if (convoy && convoy.participants.some(name => affected.has(name))) {
      const remaining = convoy.participants.filter(name => !affected.has(name));
      ports.cancelConvoy();
      if (remaining.includes(String(state.leader))) {
        ports.startConvoy(convoy.location, convoy.label, remaining, convoy.purpose, undefined, convoy.requester?.tier);
        ports.events().convoyRestarted(convoy.id, state.activeConvoy?.id ?? null);
      }
    }
    ports.persist();
  }
  function authorize(names: string[], destination: ReturnLocation, shared = false): void {
    invalidate(names, 'new destination', shared);
    for (const name of names) {
      intents[name] = { revision: intent(name).revision, cancelled: false };
      if (!shared) state.characterLocations[name] = { ...destination };
    }
    if (shared) writeSpot(state, { location: { ...destination } });
    ports.events().retarget(names, destination, shared);
    // A walk the player asks for releases those members from the manual Town wait, and their Town
    // commands go with it: a held Town command outranks the walk's write in the slot
    // (status/rules.ts writeSlot), so the walk would find each slot refused and lose its owners.
    for (const name of names) endTownMembership(state, name);
    ports.persist();
  }
  return { intent, members, waypoint, invalidate, authorize };
}

// ---- The farm area's evidence ----

/**
 * Records other players' hits in the group's farm areas from the members' current reports. A
 * member's report carries a hit while the hitter stays in its view (character/farm.ts `hit`),
 * so the current reports' hits are the live evidence and nothing ages them; two members'
 * copies of one hit count once by its key. The contest row marks a zone busy under the last
 * hitter's name, and the zone stays busy while a member's current report lists that player, in its
 * view of the farm area or in a hit; the first pass whose reports do not, clears it. A member's
 * current report recomputes its quiet-area observation (character/farm.ts `observe`), so an
 * observation in it marks the zone quiet at the time it was seen. No event says an unwatched area
 * turned busy, so the mark holds until a member observes the area again: a contest clears it and a
 * quiet observation renews it, and the ranking prefers the newer mark. The group's own characters
 * never count.
 */
export function recordFarmEvidence(state: FarmAreaState, reports: FarmReport[], owned: string[], areas: CatalogArea[], now: number): void {
  const activity = (state.activity ||= {}), quiet = (state.quiet ||= {});
  const current = reports.filter(report => fresh(report.seenAt, now));
  const hits = [...new Map(current.flatMap(report => report.farmAreaEvidence || [])
    .filter(hit => !!hit.actor && !owned.includes(hit.actor)).map(hit => [hit.key || JSON.stringify(hit), hit])).values()];
  const listed = new Set([...current.flatMap(report => report.farmCompetition?.players || []), ...hits.map(hit => hit.actor!)]);
  for (const [id, zone] of Object.entries(activity)) if (!zone.actor || !listed.has(zone.actor)) delete activity[id];
  for (const area of areas) {
    const inside = hits.filter(hit => area.monsterIds.includes(hit.mtype) && contains(area, hit));
    if (!inside.length || !contests(inside.length, inside.some(hit => hit.kill))) continue;
    activity[area.id] = { actor: inside.at(-1)!.actor };
    delete quiet[area.id];
  }
  for (const report of current) {
    const observed = report.farmAreaObservation;
    if (observed && areas.some(area => area.id === observed.id) && !activity[observed.id])
      quiet[observed.id] = observed.at;
  }
}

// A snapshot an older build saved keeps its hit filter and last move time, which no rule reads; the
// load drops them (record.ts). Its busy zones clear at the first pass whose reports do not list
// their player.
export function pruneFarmEvidence(state: FarmAreaState & { seen?: unknown; lastMoveAt?: unknown }): void {
  delete state.seen;
  delete state.lastMoveAt;
}

// ---- The farm area: competition, relocation and failed travel ----

interface FarmConvoy {
  id?: string;
  failureCode?: string;
  participants?: string[];
  expected?: Record<string, { revision: number }>;
  cause?: 'farming-conflict';
  phase: string;
  purpose?: string | null;
  location: FarmSpot;
  failure?: string;
  failureDetails?: unknown;
}

export interface FarmState {
  farmAreaState?: FarmAreaState | null;
  targetMode: string;
  monsterHunt: HuntCycle | null;
  monsterFocus: string[];
  monsterChoices?: Catalog | null;
  location: FarmSpot | null;
  statuses: Record<string, FarmReport | undefined>;
  leader: string | null;
  monsterSearchRadiusByCharacter?: Record<string, number>;
  escape?: { stage: string } | null;
  activeConvoy?: FarmConvoy | null;
  partyFarmingMode?: string;
  merchantCharacter?: string | null;
  // The party's combat log, which holds saved lines too, so every field is optional.
  combatLogs?: Record<string, { at?: unknown; type?: string; message?: string; details?: unknown }[]>;
}

export interface FarmPorts {
  now(): number;
  // The combat group's id in the tasks owner's table, which `farm.relocated` names.
  group?(): string | null;
  // The rare encounter holds the party's travel (rares.ts `owns`).
  rareOwns(): boolean;
  members(): string[];
  intent(name: string): { revision: number; cancelled?: boolean };
  // The tasks owner's answer: the Hunt's task owns the group's travel.
  huntOwns(hunt: HuntCycle): boolean;
  cancelConvoy(): void;
  // The tasks owner's answer that the group's live task is farming (the empty spawn return reads it).
  farmingLive(): boolean;
  // An add-on's `farm.spot` answer over the alternatives the farm spot rules allow: refused ids, or one preferred.
  spot?(ask: { focus: string[]; active: FarmSpot; alternatives: CatalogArea[] }): FarmSpotAnswer | undefined;
  // The Hunt's own row for the running mission: a relocation moves its spawn, the catalog's
  // shaped area promotes it, and a mission walk with no zone left skips it. Only hunt.ts writes
  // the Hunt record.
  hunt: { relocate(location: FarmSpot, cause?: 'farming-conflict'): void; promote(location: FarmSpot): void; skipMission(reason: string): void };
  authorize(names: string[], location: FarmSpot, force: boolean): void;
  startConvoy(location: FarmSpot, label: string, names: string[], purpose: string, cause?: 'farming-conflict'): void;
  persist(): void;
  // The group's farming task ladder (01 design 4.1); without it a failed move takes the saved
  // farm point at once.
  ladder?: LadderPort;
}

/**
 * The group's farm area service: one per combat group. It records other players' evidence, moves
 * the group off a zone another player fights in, starts a pending relocation once its members'
 * navigation still matches, and climbs the farming ladder after a failed move.
 * `workers` names the console's own characters, whose hits never count as competition.
 */
// The root switch, read through the settings owner.
const relocationOn = () => partyHooks().read({ field: 'relocateIfCompeting' }) !== false;
export function createFarm(party: FarmState, workers: Record<string, unknown>, ports: FarmPorts) {
  const radius = (name: string | null) => searchReach(party.monsterSearchRadiusByCharacter, name);
  const targetIds = (hunt: HuntCycle | null) => hunt?.target ? [hunt.target] : party.monsterFocus || [];
  const areasOf = (ids: string[]) => farmingAreas(party.monsterChoices || [], ids);
  const revisions = (names: string[]) => Object.fromEntries(names.map(name => [name, ports.intent(name).revision]));
  const relocation = (names: string[], destination: FarmSpot, at: number, reason: string): FarmRelocation =>
    ({ destination, revisions: revisions(names), at, reason });

  // -- Competition evidence --

  // Every member's competition observation is current, from this runtime and navigation revision,
  // for this area, map, instance and server, with a valid radius, monster counts and player list.
  function observed(report: FarmReport | undefined, area: FarmSpot, revision: number, now: number): boolean {
    const o = report?.farmCompetition;
    if (!report || !o || report.rip || !fresh(report.seenAt, now) || !fresh(o.at, now, 'report', reportClockError(report))) return false;
    return Number.isFinite(o.radius) && o.radius > 0 && !!o.monsters && Array.isArray(o.players) &&
      Object.values(o.monsters).every(count => Number.isSafeInteger(count) && count >= 0) &&
      !!o.runtimeId && o.runtimeId === report.combatSelection?.runtimeId && o.revision === revision && o.areaId === area.id &&
      o.map === report.map && o.map === area.map && o.in === String(report.in ?? report.map) && o.server === report.server;
  }

  // The area the group moves to: rules.ts's best alternative, after an add-on's `farm.spot`
  // answer refused some of them or ranked one first. The answer cannot add an area.
  function best(state: FarmAreaState, areas: CatalogArea[], active: FarmSpot, excluded: string[] = []): CatalogArea | undefined {
    const listed = alternatives(state, areas, active, excluded);
    const answer = listed.length ? ports.spot?.({ focus: party.monsterFocus || [], active, alternatives: listed }) : undefined;
    const allowed = listed.filter(area => !answer?.refuse?.includes(area.id));
    return allowed.find(area => area.id === answer?.prefer) ?? allowed[0];
  }

  /** Absence is established by every active member, never by a missing report. */
  function competitionHold(names: string[], area: FarmSpot, ids: string[], actor: string, now: number): string | null {
    // The one root switch holds the move in every target mode.
    if (!relocationOn()) return 'Conflict relocation disabled in Farming settings';
    const reports = names.map(name => party.statuses[name]);
    if (!names.length || reports.some((report, i) => !observed(report, area, ports.intent(names[i]!).revision, now)))
      return 'Waiting for fresh farming radius observations';
    const seen = reports.map(report => report!.farmCompetition!);
    if (seen.some((o, i) => o.radius !== radius(names[i]!) || o.server !== seen[0]!.server || o.in !== seen[0]!.in))
      return 'Waiting for matching farming radius observations';
    if (seen.some(o => ids.some(id => (o.monsters[id] || 0) > 0))) return 'Sharing zone: hunt monsters remain within a party member’s radius';
    if (!seen.some(o => o.players.includes(actor))) return 'Competing farmer is no longer nearby';
    return null;
  }

  // The zone's competing actor while it is contested. After a move, competitionHold's current
  // observations of the new area come only once the members stand there, so a move is never
  // followed by another before the group arrived.
  const busyActor = (state: FarmAreaState, active: FarmSpot): string | null => state.activity?.[active.id!]?.actor || null;

  function relocateBusy(state: FarmAreaState, active: FarmSpot, areas: CatalogArea[], names: string[], now: number): void {
    if (!active.shapes && !active.allOf) return;
    const actor = busyActor(state, active);
    if (!actor) return;
    const hold = competitionHold(names, active, targetIds(party.targetMode === 'hunt' ? party.monsterHunt : null), actor, now);
    if (hold) {
      state.message = hold;
      return;
    }
    const next = best(state, areas, active);
    if (!next) {
      state.message = 'Sharing this zone; no uncontested alternative observed';
      return;
    }
    state.pending = { ...relocation(names, next, now, 'Relocating after ' + actor + ' fought monsters in this zone'),
      cause: 'farming-conflict', source: active, actor };
    state.message = state.pending.reason + '; finishing current fights';
    ports.persist();
  }

  // -- The pending relocation --

  function startPending(state: FarmAreaState, names: string[], hunt: HuntCycle | null): void {
    const next = state.pending!;
    state.pending = null;
    partyHooks().notify('farm.relocated', { group: ports.group?.() ?? null, from: state.active ?? null, to: next.destination,
      cause: next.cause === 'farming-conflict' ? 'contested' : next.focusChange ? 'focus' : 'failed', by: 'core:hunting' });
    if (next.focusChange) state.preferredLocation = next.destination;
    if (hunt?.target) ports.hunt.relocate(next.destination, next.cause);
    else {
      ports.authorize(names, next.destination, true);
      ports.startConvoy(next.destination, 'Moving to another farming zone', names, 'farm-relocation', next.cause);
    }
    state.message = next.reason;
    ports.persist();
  }

  // A competition move ends once its zone is no longer contested or the competition no longer holds.
  function cancelConflict(state: FarmAreaState, names: string[], hunt: HuntCycle | null, now: number): boolean {
    const next = state.pending!;
    if (next.cause !== 'farming-conflict' || !next.source) return false;
    const busy = state.activity?.[next.source.id!];
    const hold = !busy ? 'Competing activity ended'
      : competitionHold(names, next.source, targetIds(hunt), next.actor || busy.actor || '', now);
    if (!hold) return false;
    state.pending = null;
    state.message = hold;
    ports.persist();
    return true;
  }

  // A pending move whose members' navigation moved on is dropped; otherwise it starts once the
  // travel defense is clear. A failed move's retry waits for one report round after the failure,
  // the first reports that can show its cause changed, and the task ladder takes a move that keeps
  // failing. A move on the `wait` rung also waits for the next report.
  function processPending(state: FarmAreaState, names: string[], hunt: HuntCycle | null, now: number): void {
    const next = state.pending!;
    if (next.revisions && names.some(name => next.revisions![name] !== ports.intent(name).revision)) {
      state.pending = null;
      ports.persist();
      return;
    }
    if (cancelConflict(state, names, hunt, now)) return;
    const round = !next.retry || names.every(name => Number(party.statuses[name]?.seenAt) > next.at);
    if (!round || (next.afterReport && ports.ladder?.rung() === 'wait')) return;
    const defense = classifyTravelDefense(party, names, now);
    if (defense.state !== 'clear') {
      state.message = defense.message;
      return;
    }
    startPending(state, names, hunt);
  }

  // -- Failed farm travel --

  // The empty spawn return's walk no longer matches its members.
  function staleFallback(convoy: FarmConvoy, names: string[]): boolean {
    if (convoy.purpose !== 'empty-spawn-recovery') return false;
    return !convoy.participants?.length || convoy.participants.some(name =>
      !names.includes(name) || ports.intent(name).cancelled || convoy.expected?.[name]?.revision !== ports.intent(name).revision);
  }

  // A Hunt mission with no zone left skips the mission. Any other Hunt stage keeps its saved farm
  // point, as farming does on the `safe-point` rung.
  function noDestination(state: FarmAreaState, hunt: HuntCycle, saved: FarmSpot): FarmSpot | null {
    if (hunt.stage !== 'mission-travel') return saved;
    state.pending = null;
    ports.hunt.skipMission('all zone routes failed');
    return null;
  }

  // The farming task's ladder picks the next move. The `alternative` rung is another farm area,
  // `regroup` is the same area again from where the members stand, `safe-point` the saved farm point. Farming has
  // nothing to fall back to, so after `safe-point` it waits on `wait` and walks to the saved farm point on the
  // next report that shows a change. A geometry mismatch has no alternative of its own: it
  // re-plans, then takes `safe-point` and `wait`. Without a ladder the saved farm point is next.
  function climb(state: FarmAreaState, convoy: FarmConvoy, area: FarmSpot, other: FarmSpot | null, saved: FarmSpot): { destination: FarmSpot; afterReport?: boolean } {
    const rung = ports.ladder?.fail(convoy.failureCode || 'route-failed', { alternative: !!other, trying: 'the walk to the saved farm point' })?.rung;
    if (rung === undefined) return { destination: other || saved };
    if (rung === 'alternative' && other) return { destination: other };
    if (rung === 'alternative' || rung === 'regroup') return { destination: area };
    if (rung === 'wait') {
      state.message = 'Waiting for the next report, then walking to the saved farm point';
      return { destination: saved, afterReport: true };
    }
    return { destination: saved };
  }

  // A failed move counts a strike on its area unless the failure is transient. The end code is the
  // failure's cause: a non-transient one says the planner could not walk the area's route
  // (rules.ts `transientFailure`), so one strike leaves the area out of the alternatives.
  function failed(state: FarmAreaState, convoy: FarmConvoy, hunt: HuntCycle | null, ids: string[], names: string[],
    areas: CatalogArea[], now: number, saved: FarmSpot): void {
    if (staleFallback(convoy, names)) {
      ports.cancelConvoy();
      ports.persist();
      return;
    }
    const failures = (state.failures ||= {});
    const area: FarmSpot = resolve(party.monsterChoices || [], ids, convoy.location)!;
    const key = area.id || areaId(area);
    const transient = transientFailure(convoy.failureCode);
    if (!transient) failures[key] = (failures[key] || 0) + 1;
    state.lastFailure = { reason: convoy.failure, at: now, transient, details: convoy.failureDetails || null };
    state.message = 'Travel failed: ' + convoy.failure;
    const geometry = convoy.failureCode === 'geometry-mismatch';
    ports.cancelConvoy();
    if (hunt) hunt.convoyId = null;
    const other = !geometry && !transient && !(hunt && !hunt.target) ? best(state, areas, area, Object.keys(failures)) || null : null;
    let next: { destination: FarmSpot; afterReport?: boolean } | null;
    if (!hunt) next = climb(state, convoy, area, other, saved);
    else if (geometry || transient) next = { destination: area };
    else {
      const destination = other || noDestination(state, hunt, saved);
      next = destination ? { destination } : null;
    }
    if (next) {
      state.pending = { ...relocation(names, next.destination, now, state.message), retry: true };
      if (next.afterReport) state.pending.afterReport = true;
    }
    if (state.pending && convoy.cause) state.pending.cause = convoy.cause;
    ports.persist();
  }

  function recoverFailed(state: FarmAreaState, hunt: HuntCycle | null, ids: string[], names: string[], areas: CatalogArea[],
    now: number, saved: FarmSpot): boolean {
    const convoy = party.activeConvoy;
    if (convoy?.phase !== 'failed' || !farmRecovers(convoy.purpose))
      return false;
    failed(state, convoy, hunt, ids, names, areas, now, saved);
    return true;
  }

  // -- The tick --

  // A saved point without a shape takes the catalog area's shape once, the first time the catalog
  // resolves it after the load, and the running mission's spawn with it through the Hunt's row
  //. A shaped point never asks again.
  let promoted = false;
  function promoteShape(active: FarmSpot, hunt: HuntCycle | null): void {
    if (promoted || !active.shapes) return;
    promoted = true;
    if (party.location!.shapes) return;
    writeSpot(party, { location: active });
    if (hunt) ports.hunt.promote(active);
    ports.persist();
  }

  // The group stands at its farm after a failure: progress for the farming task's ladder.
  function clearArrivedFailure(state: FarmAreaState, names: string[], reports: FarmReport[], active: FarmSpot): void {
    if (party.activeConvoy || state.pending || !state.lastFailure || reports.length !== names.length) return;
    const reach = radius(party.leader);
    if (!reports.every(report => standsAt(active, report, reach))) return;
    state.lastFailure = null;
    if (state.message?.startsWith('Travel failed:')) state.message = null;
    ports.ladder?.progress();
    ports.persist();
  }

  function move(state: FarmAreaState, hunt: HuntCycle | null, ids: string[], names: string[], areas: CatalogArea[], active: FarmSpot, now: number): void {
    if (hunt && ports.huntOwns(hunt)) return;
    if (recoverFailed(state, hunt, ids, names, areas, now, active)) return;
    if (party.activeConvoy) return;
    if (state.pending) {
      processPending(state, names, hunt, now);
      return;
    }
    if (hunt && hunt.stage !== 'farming') return;
    relocateBusy(state, active, areas, names, now);
    if (state.pending) processPending(state, names, hunt, now);
  }

  function observe(state: FarmAreaState, hunt: HuntCycle | null, names: string[], ids: string[], areas: CatalogArea[], active: FarmSpot, now: number): void {
    promoteShape(active, hunt);
    state.active = { id: active.id || areaId(active), map: active.map, x: active.x, y: active.y, monsterIds: ids };
    const reports = names.map(name => party.statuses[name]).filter((status): status is FarmReport => !!status);
    recordFarmEvidence(state, reports, Object.keys(workers), areas, now);
    // A stale empty spawn return is released before the members' freshness holds the rest.
    if (party.activeConvoy?.purpose === 'empty-spawn-recovery' && recoverFailed(state, hunt, ids, names, areas, now, active)) return;
    if (names.some(name => {
      const status = party.statuses[name];
      return !status || !fresh(status.seenAt, now, 'presence') || !!status.rip || !!ports.intent(name).cancelled;
    })) return;
    clearArrivedFailure(state, names, reports, active);
    move(state, hunt, ids, names, areas, active, now);
  }

  /**
   * One pass per status report of the group's leader, while no rare and no Hunt
   * walk owns the group's travel. The leader reports at most once a second, so the pass keeps
   * b9b5c91e's rate without a throttle of its own.
   */
  function tick(reporter: string): void {
    if (reporter !== party.leader || ports.rareOwns()) return;
    const now = ports.now();
    const state = party.farmAreaState || writeSpot(party, { farmAreaState: {} }).farmAreaState, names = ports.members();
    const hunt = party.targetMode === 'hunt' ? party.monsterHunt : null;
    if (hunt && (hunt.stage === 'mission-travel' || (party.activeConvoy && ownsHuntRoute(hunt, party.activeConvoy)))) return;
    const ids = targetIds(hunt);
    const areas = areasOf(ids), active: FarmSpot | null = resolve(party.monsterChoices || [], ids, party.location);
    if (!active || !areas.length || !names.length) return;
    if (resumeAfterRare(state, names)) return;
    returnToSpawn(state, names, now);
    observe(state, hunt, names, ids, areas, active, now);
  }

  // The empty spawn return: a fresh leader outside the saved area, with no member
  // holding a target, walks the party back while farming holds the group and no walk, pending
  // move, scatter mode or user hold stands in the way. The farm tick already runs only while the tasks owner's
  // table lets farming act, which holds it during a Cave visit. It asks again only after its
  // last walk ended and a leader report sent after that still stands outside. As in b9b5c91e
  // (shared.js:17665-17683), a focus monster in the leader's view holds it, and the leader asks only
  // once its reports have stood outside for SPAWN_OUTSIDE_MS, so a step out while it fights does not
  // pull the party back.
  // The farming resume: when the rare's task ends and farming takes the group back, the
  // participants walk to the saved spot unless each already stands at it, in every combat mode, as
  // b9b5c91e's rare return walked the party back.
  let rareEnded = false;
  function resumeAfterRare(state: FarmAreaState, names: string[]): boolean {
    const location = party.location;
    if (!rareEnded || party.activeConvoy || state.pending || !location) return false;
    rareEnded = false;
    if (names.every(name => { const s = party.statuses[name]; return !!s && standsAt(location, s, radius(name)); })) return false;
    ports.startConvoy(location, 'Returning to the saved farming spot after the rare', names, 'empty-spawn-recovery');
    ports.persist();
    return true;
  }
  const SPAWN_OUTSIDE_MS = 1500;
  let spawnWalk: string | null = null, spawnEndedAt = 0, outsideSince = 0;
  function returnToSpawn(state: FarmAreaState, names: string[], now: number): void {
    const c = party.activeConvoy, lead = party.statuses[String(party.leader)], location = party.location;
    if (spawnWalk && c?.id !== spawnWalk) { spawnWalk = null; spawnEndedAt = now; }
    if (c || !lead || !location || state.pending || party.partyFarmingMode === 'scatter' || !ports.farmingLive() ||
        ports.intent(String(party.leader)).cancelled) return;
    if (!fresh(lead.seenAt, now, 'presence') || Number(lead.seenAt) <= spawnEndedAt || !Number.isFinite(lead.x) || !Number.isFinite(lead.y)) return;
    const reach = radius(party.leader);
    const inside = (location.in == null || String(lead.in ?? lead.map) === String(location.in)) && lead.map === location.map &&
      contains(location, { map: lead.map, x: lead.x, y: lead.y }, 0, reach);
    if (inside || lead.farmFocusInView || names.some(name => name !== party.merchantCharacter && (party.statuses[name] as { target?: unknown } | undefined)?.target)) {
      outsideSince = 0;
      return;
    }
    outsideSince ||= Number(lead.seenAt);
    if (Number(lead.seenAt) - outsideSince < SPAWN_OUTSIDE_MS) return;
    outsideSince = 0;
    ports.startConvoy(location, 'saved farming spawn', names, 'empty-spawn-recovery');
    spawnWalk = party.activeConvoy?.id ?? null;
    if (!spawnWalk) return;
    if (party.combatLogs?.[String(party.leader)]) appendCombatLog(party.combatLogs, String(party.leader), { at: now, type: 'navigation',
      message: 'Outside authorized farming area without a target; recovering to the saved spawn point',
      details: { location, position: { map: lead.map, x: lead.x, y: lead.y }, radius: reach } });
    ports.persist();
  }

  /**
   * A new farming focus that replaces the farmed species queues a move to its best area. It waits
   * for the members' current activity: event attendance and its return still own the same
   * revisions, so the move authorizes nothing here.
   */
  function focusChanged(): void {
    if (party.targetMode === 'hunt') return;
    const state = party.farmAreaState || writeSpot(party, { farmAreaState: {} }).farmAreaState;
    if (state.pending?.focusChange) {
      state.pending = null;
      ports.persist();
    }
    const previous = party.location, ids = party.monsterFocus || [], names = ports.members();
    // A custom waypoint has no catalog ownership. A compatible focus addition keeps its chosen area;
    // only a replaced farming species retires its pin.
    if (!previous?.monsterIds?.length || !ids.length || ids.includes('all') || previous.monsterIds.some(id => ids.includes(id)) ||
        !names.length || names.some(name => ports.intent(name).cancelled)) return;
    const now = ports.now();
    const destination = best(state, areasOf(ids), previous);
    if (!destination) return;
    state.pending = { ...relocation(names, destination, now, 'Moving to newly selected farming monsters'), focusChange: true };
    state.message = 'Farming focus changed; waiting for current activity';
    ports.persist();
  }

  // Turning the switch off ends a pending farming-conflict move; a walk already under way
  // finishes its route.
  function relocationOff(): void {
    const state = party.farmAreaState;
    if ((state?.pending as { cause?: string } | null | undefined)?.cause !== 'farming-conflict') return;
    state!.pending = null;
    ports.persist();
  }

  return { tick, focusChanged, relocationOff, rareEnded: () => { rareEnded = true; } };
}

// ---- The monster focus ----

export interface FocusState {
  targetMode?: string;
  monsterHunt?: { participants: string[] } | null;
  leader: string | null;
  followers: Record<string, boolean>;
  monsterFocus: string[];
  monsterFocusByCharacter: Record<string, string[] | undefined>;
  monsterPrioritiesByCharacter: Record<string, Record<string, number> | undefined>;
  monsterSearchRadiusByCharacter: Record<string, number | undefined>;
  scatterMonsterTypes: string[];
  scatterEpoch: number;
  partyFarmingMode: string;
  partyFarmingMonsterType: string | null;
  scatterBreakTarget: unknown;
}

// The leader's focus is the party's: the followers' own focus entries go with it.
function takeLeaderFocus(state: Pick<FocusState, 'leader' | 'followers' | 'monsterFocusByCharacter'>): void {
  delete state.monsterFocusByCharacter[String(state.leader)];
  for (const follower of Object.keys(state.followers)) if (state.followers[follower]) delete state.monsterFocusByCharacter[follower];
}

// The radius a focus request saves for its character: the one it asks for, the default when it clears the
// focus, or the one saved before. The focus route writes it through the settings writer.
export function searchRadius(focus: string[], requested: unknown, previous: number | undefined): number {
  if (requested !== undefined) return Math.round(Number(requested));
  if (!focus.length) return defaultSearchRadius;
  return Number(previous) || defaultSearchRadius;
}

/**
 * A focus change resets scatter selection and asks the farm area to move; clearing the focus also
 * invalidates every affected return checkpoint. A running Hunt owns its participants' focus, so it
 * moves nothing for them. The focus is a record; the priorities and search radius the same request
 * carries are settings, which the focus route writes through the settings writer before `select`.
 */
export function createFocusSelection(state: FocusState, ports: {
  focusChanged?(): void;
  members(): string[];
  invalidate(names: string[], reason: string, shared: boolean): void;
}) {
  const huntOwnsFocus = (name: string | null) => !!(state.targetMode === 'hunt' && state.monsterHunt &&
    (!name || state.monsterHunt.participants.includes(name)));
  function select(name: string | null, focus: string[]): void {
    const before = name ? state.monsterFocusByCharacter[name] || state.monsterFocus : state.monsterFocus;
    const changed = JSON.stringify(before || []) !== JSON.stringify(focus);
    if (!name) writeSpot(state, { monsterFocus: focus });
    else {
      state.monsterFocusByCharacter[name] = focus;
      if (name === state.leader) {
        writeSpot(state, { monsterFocus: focus.slice() });
        takeLeaderFocus(state);
      }
    }
    if (changed) resetScatter(state);
    if (changed) partyHooks().notify('farming.focusChanged', { focus, member: name ?? 'party', by: 'core:hunting' });
    if (changed && !huntOwnsFocus(name)) ports.focusChanged?.();
    if (!focus.length && !huntOwnsFocus(name)) {
      const shared = !name || name === state.leader;
      ports.invalidate(shared ? ports.members() : [name], 'monster focus cleared', shared);
    }
  }
  return { select };
}

// ---- The selected farm destination ----

interface Position { map: string; x: unknown; y: unknown }

interface DestinationState<Location> {
  leader: string | null;
  followers: Record<string, unknown>;
  statuses: Record<string, Position>;
  monsterFocus?: string[] | null;
  monsterFocusByCharacter: Record<string, string[]>;
  monsterPrioritiesByCharacter: Record<string, Record<string, unknown>>;
  monsterChoices?: { id: string; locations?: Location[] | null }[] | null;
}

/**
 * A character's farm destination: of its focus's spawns, the highest priority (default 50), then
 * the nearest. The party's members follow the shared focus; an independent character may select
 * no monsters.
 */
export function selectCoordinatorMonsterDestination<Location extends Position>(state: DestinationState<Location>,
  name: string | null): { id: string; location: Location } | null {
  const status = state.statuses[String(name)];
  const own = name !== state.leader && !state.followers[String(name)] &&
    Object.prototype.hasOwnProperty.call(state.monsterFocusByCharacter, String(name));
  const focus = own ? state.monsterFocusByCharacter[String(name)] : state.monsterFocus || [];
  const priorities = state.monsterPrioritiesByCharacter[String(name)] || {};
  if (!status || !Array.isArray(state.monsterChoices)) return null;
  const selected = new Set(focus.filter(id => id !== 'all'));
  const candidates = state.monsterChoices.flatMap(monster =>
    selected.has(monster.id) && Array.isArray(monster.locations) ? monster.locations.map(location => ({ id: monster.id, location })) : []);
  if (!candidates.length) return null;
  const away = (location: Position) => location.map === status.map
    ? Math.hypot(Number(location.x) - Number(status.x), Number(location.y) - Number(status.y)) : Number.MAX_SAFE_INTEGER;
  // The destination pick ranks a saved 0 as unset; targeting's selection.ts keeps a saved 0 as written.
  const priority = (id: string) => Number(priorities[id]) || MONSTER_PRIORITY.unset;
  candidates.sort((a, b) => priority(b.id) - priority(a.id) || away(a.location) - away(b.location));
  return candidates[0]!;
}

// ---- A farm spot picked by hand or by a target mode entry ----

export interface MonsterSelectionState extends Pick<FocusState, 'leader' | 'followers' | 'targetMode' | 'monsterFocus' |
  'monsterFocusByCharacter' | 'scatterMonsterTypes' | 'scatterEpoch' | 'partyFarmingMode' | 'partyFarmingMonsterType' | 'scatterBreakTarget'> {
  eventAttendance?: EventAttendance;
  monsterChoices?: Catalog | null;
  statuses: Record<string, { seenAt: number; server?: string; joinedEvent?: unknown; mapEvent?: unknown; eventFeedConnected?: boolean; eventClockStale?: boolean } | undefined>;
  farmAreaState: unknown;
  eventReturn: unknown;
  deferredEventReturns: Record<string, unknown>;
  eventSessions: Record<string, { event: string; id?: string | null; lastLiveAt?: number; authorizedRealm?: string; authorizedAt?: number;
    participants: string[]; participationRecorded?: boolean } | undefined>;
  commands: Record<string, { type: string; manualMonsterOverride?: boolean } | undefined>;
  passiveHunting?: PassiveSettings;
  passiveRareHunts: unknown;
}

export interface MonsterSelectionPorts {
  now(): number;
  destination(id: string): ReturnLocation | null | undefined;
  release(): void;
  clearHunt(): void;
  members(): string[];
  authorize(names: string[], location: ReturnLocation, shared: boolean): void;
  start(location: ReturnLocation, label: string, names: string[], purpose: string): boolean;
  startPhoenix(): void;
  stopPhoenix(reason: string): void;
  persist(): void;
  validPassive(settings: Record<string, unknown>): boolean;
  // Writes the passive rules through the settings writer; a refusal names the field.
  setPassive(settings: Record<string, unknown>): SettingsWriteResult;
  // The settings writer, which takes the pick's switch to Farming.
  write(batch: SettingsWrite): SettingsWriteResult;
  invalidate(names: string[], reason: string, shared: boolean): void;
}

/**
 * A monster picked by hand switches its scope's target mode to Farming as console:hunts and
 * leaves the combat mode. The scope's leader names the scope (the party's leader, or a solo
 * group's one member). A refusal is logged, so the switch is never dropped silently.
 */
export function farmTarget(owner: string | null, write: (batch: SettingsWrite) => SettingsWriteResult) {
  const written = write({ by: 'console:hunts', changes: [{ field: 'targetMode', value: 'farming', ...(owner ? { character: owner } : {}) }] });
  if (!written.ok) console.error(`The target mode stays: ${written.error}`);
  return written;
}

/**
 * Walks the members to the picked spawn. The pick ends the escape's hold, the Hunt and the farm
 * area's record, sets the party focus to the one monster and restarts scatter learning. A pick by
 * hand also switches the target to Farming and leaves the members' event occurrences (the events owner's
 * `left`); a target mode add-on's own switch (`keepMode`, runtime/hooks/registry.ts
 * `target.mode`) keeps both.
 */
export function createMonsterSelection(state: MonsterSelectionState, ports: MonsterSelectionPorts) {
  function select(id: string, location: ReturnLocation, keepMode = false): string[] | null {
    const names = ports.members(), sessions = state.eventSessions;
    ports.release();
    writeSpot(state, { farmAreaState: { preferredLocation: location } });
    ports.clearHunt();
    if (!keepMode) farmTarget(state.leader, ports.write);
    writeSpot(state, { monsterFocus: [id] });
    takeLeaderFocus(state);
    resetScatter(state);
    partyHooks().notify('farming.focusChanged', { focus: [id], member: 'party', by: 'core:hunting' });
    // The event return keeps its members and the exit commands it issued: a focus change ends only
    // commands of its own tier, and the return's policy row re-targets its checkpoint walk
    // (the events owner's `owned commands`).
    if (!keepMode) state.eventSessions = {};
    ports.authorize(names, location, true);
    if (!ports.start(location, 'the ' + id + ' spawn', names, 'manual-monster-override')) return null;
    playerMoved({ ...state, eventSessions: sessions, eventAttendance: state.eventAttendance ||= {} }, names, location, ports.now());
    for (const name of names) {
      const command = state.commands[name];
      if (command?.type === 'party-monster-travel') command.manualMonsterOverride = true;
    }
    if (id === 'phoenix') ports.startPhoenix();
    else ports.stopPhoenix('New farming selection');
    ports.persist();
    return names;
  }
  return { select };
}

// ---- The farming walk's combat arrival (3.8) ----

type Engage = Parameters<ConvoyNavigationPlatform['engage']>[2];
type EngageTarget = NonNullable<SharedConvoy['farmingEngagement']>['target'];

// The walk can hand off to a fight: a farming walk in preparation or travel that allows a hand-off,
// is not forced, has no engagement yet and is not a competition move.
function acquiring(c: SharedConvoy): boolean {
  return c.cause !== 'farming-conflict' && handsCombatOver(c.purpose, c.combatHandoffAllowed) &&
    !!c.combatHandoffAllowed && !c.force && !c.farmingEngagement && ['shared-prepare', 'travel'].includes(c.phase);
}

// Every member's navigation and command still carry the walk's revisions.
function authorized(state: SharedState, c: SharedConvoy, options: Engage, body: Record<string, unknown>): boolean {
  if (Number(body.navigationRevision) !== options.revisions[String(body.character)]) return false;
  return c.participants.every(name => {
    const intent = state.navigationIntents?.[name], command = state.commands[name];
    return !intent?.cancelled && intent?.revision === options.revisions[name] &&
      command?.convoyId === c.id && command.navigationRevision === options.revisions[name];
  });
}

// The leader reports a focus target inside the walk's area, within its radius, from a current report.
function leaderTarget(state: SharedState, c: SharedConvoy, body: Record<string, unknown>, target: EngageTarget, options: Engage, now: number): boolean {
  const lead = state.statuses[c.leader];
  return body.character === c.leader && !!lead && contains(c.location, target, 0, options.radius) &&
    fresh(lead.seenAt, now) && !!target?.id && Number.isFinite(target.x) && Number.isFinite(target.y) && samePlace(target, lead) &&
    Math.hypot(target.x - lead.x, target.y - lead.y) <= options.radius && (options.focus.includes('all') || options.focus.includes(target.mtype));
}

// Every member reports current, at the target's place and inside the area; the empty spawn return
// needs only the place.
function arrivedForCombat(state: SharedState, c: SharedConvoy, target: EngageTarget, reach: number, now: number): boolean {
  return contains(c.location, target, 0, reach) && c.participants.every(name => {
    const member = state.statuses[name];
    return !!member && fresh(member.seenAt, now) && samePlace(member, target) &&
      (c.purpose === 'empty-spawn-recovery' || standsAt(c.location, member, reach));
  });
}

/**
 * The leader's fight on the way ends the farming walk `arrived` once every member stands inside the
 * area plus the arrival margin; otherwise the walk goes on (3.8).
 */
export function engageFarming(state: SharedState, body: Record<string, unknown>, options: Engage,
  walk: Pick<ConvoyNavigationPlatform, 'validReport'>, now = Date.now()): boolean {
  const c = state.activeConvoy;
  if (!c || !acquiring(c) || !walk.validReport(state, body) || !authorized(state, c, options, body)) return false;
  const target = body.target as EngageTarget;
  if (!leaderTarget(state, c, body, target, options, now)) return false;
  // The leader's target ends the walk early only with every member inside the area plus the
  // arrival margin. Otherwise the walk goes on into the area, and the movement owner's travel defense fights what
  // attacks a member on the way.
  if (!arrivedForCombat(state, c, target, options.radius, now)) return false;
  c.farmingEngagement = { target: { ...target, server: state.statuses[c.leader]!.server }, at: now };
  for (const name of c.participants) delete state.commands[name];
  walkEnds(state, 'arrived');
  return true;
}


