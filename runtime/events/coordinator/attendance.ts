// Who attends an event on the coordinator: the saved event state, the attendance limits, the hunt trips
// and the per-report observation. Moved from runtime/coordinator/events/ (initial-contracts.ts,
// attendance-limits.ts, hunt-trip.ts, observations.ts).
import type { CombatReference } from '../../hunting/api.ts';
import { eventEnabled, eventIs, searchExhausted, eventKey, eventLimits, eventPolicy, joinReply, leadFor, selectedEvents } from '../rules.ts';
import { fresh } from '../../protocol/reports.ts';
import { occurrenceLive, stagingWindow } from './occurrences.ts';
import type { OccurrenceReport } from './occurrences.ts';
import type { EventFormation } from '../rules.ts';
import type { ABStrategy } from './abtesting.ts';
import type { EventRecovery, EventReturnState, AnniversaryReturnCycle, ReturnLocation, ReturnStatus, ReturnRoute, Waypoints } from './returns.ts';
import type { MonsterEntity } from 'typed-adventureland';
import { partyHooks } from '../../hooks/index.ts';
import { occurrenceOf } from './source.ts';

/** Durable event ownership loaded before observations rebuild live event state. */
export interface SavedEventState extends HuntEventTrips {
  activeRealm?: unknown;
  // The party attendance boundary that targeting's `core:event-boundary` listener opens and closes
  // on the tasks owner's event-attendance task notices (coordinator/targeting/snapshot.ts:25-44).
  eventBoundary?: { startedAt: number; endedAt?: number } | null;
  eventReturn?: EventRecovery | null;
  eventAttendance?: EventAttendance;
  eventSessions?: Record<string, EventSession> | null;
  deferredEventReturns?: Record<string, DeferredRecovery> | null;
  abtestingStrategy?: ABStrategy | null;
}

export type LastEventReturn = EventReturnState["last"];

export interface AttendanceInstance {
  id: string | null;
  realm: string;
  lastLiveAt: number;
  ended: boolean;
  elapsedMs: number;
  lastObservedAt: number;
  attending: boolean;
  deaths: number;
  lastDeathAt: number;
  dead: boolean;
  // `event-over`: the game refused the join for good (`cant_join`, `join_too_late`).
  ignored?: 'death limit' | 'time limit' | 'manual travel' | 'travel failure' | 'event-over';
  /** Explicit navigation owns this occurrence's exit, independently of limits. */
  manualTravel?: boolean;
  // When the feed first showed this instance; a return from an earlier occurrence of the same
  // event lets its members go to it (`nextLiveEvent`).
  since?: number;
  // (3): the member died while it attended this occurrence and has not reached it again.
  rejoinPending?: boolean;
  // The member attended this occurrence at least once, which a `join_too_late` refusal reads.
  attended?: boolean;
}
export type EventAttendance = Record<string, Record<string, AttendanceInstance>>;
interface AttendanceState extends EventFormation { eventAttendance: EventAttendance }
/** Native heartbeat wire subset; incomplete reports are not game Characters. */
export interface AttendanceReport {
  name: string;
  server?: string;
  joinedEvent?: string;
  mapEvent?: string;
  rip?: boolean;
  lastDeath?: { at?: number; eventTrip?: { event?: string } | null } | null;
  serverLiveEvents?: { name: string; id?: string | null }[];
  serverStagingEvents?: { name: string; spawnAt: number; spawnId?: number }[];
  eventFeedConnected?: boolean;
  eventClockStale?: boolean;
  anniversaryServer?: { live?: boolean; active?: boolean; round?: string | number | null; id?: string | null } | null;
  anniversaryState?: { busy?: boolean };
  farmingNavigationDebug?: { event?: boolean };
  // The occurrence whose join the game refused with a final reply (shared.js eventRefusal).
  eventRefusal?: { name: string; id: string | null; reply?: string | null } | null;
}

function anniversaryEntry(report: AttendanceReport) {
  const value = report.anniversaryServer;
  if (!value?.live || value.active === false) return null;
  return { name: 'anniversary', id: String(value.round || value.id || '') || null };
}
function sameInstance(previous: AttendanceInstance | undefined, id: string | null, realm: string): previous is AttendanceInstance {
  if (!previous || previous.realm !== realm) return false;
  if (id && previous.id) return id === previous.id;
  return !previous.ended;
}
function liveEntries(report: AttendanceReport) {
  const entries = (report.serverLiveEvents ?? []).map(entry => ({ name: entry.name, id: entry.id || null }));
  for (const entry of report.serverStagingEvents ?? [])
    if (!entries.some(live => live.name === entry.name)) entries.push({ name: entry.name, id: null });
  const anniversary = anniversaryEntry(report);
  if (anniversary) entries.push(anniversary);
  return entries.filter(entry => !!eventKey(entry.name));
}

function instance(previous: AttendanceInstance | undefined, id: string | null, report: AttendanceReport, now: number): AttendanceInstance {
  if (sameInstance(previous, id, report.server ?? '')) {
    previous.ended = false;
    previous.id ||= id;
    previous.lastLiveAt = now;
    return previous;
  }
  return { id, realm: report.server ?? '', lastLiveAt: now, ended: false, since: now,
    elapsedMs: 0, lastObservedAt: now, attending: false, deaths: 0,
    lastDeathAt: Number(report.lastDeath?.at) || 0, dead: !!report.rip };
}

function newEventDeath(entry: AttendanceInstance, event: string, report: AttendanceReport, deathAt: number) {
  return deathAt > entry.lastDeathAt && report.lastDeath?.eventTrip?.event === event;
}
function recordDeath(entry: AttendanceInstance, event: string, report: AttendanceReport, attending: boolean) {
  const deathAt = Number(report.lastDeath?.at) || 0;
  const newDeath = newEventDeath(entry, event, report, deathAt);
  const becameDead = !!report.rip && !entry.dead;
  const wasParticipating = attending || entry.attending;
  if (wasParticipating && (newDeath || becameDead)) { entry.deaths++; entry.rejoinPending = true; }
  entry.lastDeathAt = Math.max(entry.lastDeathAt, deathAt);
  entry.dead = !!report.rip;
}
// A refusal names its occurrence by the server's own identity, or by none for a feed without one.
function refused(entry: AttendanceInstance, event: string, report: AttendanceReport): boolean {
  const refusal = report.eventRefusal;
  return !!refusal && refusal.name === event && (!refusal.id || !entry.id || refusal.id === entry.id);
}
function applyLimits(entry: AttendanceInstance, limits: import('../rules.ts').EventLimits | undefined) {
  if (!limits || entry.ignored) return;
  if (limits.deathLimit != null && entry.deaths > limits.deathLimit) entry.ignored = 'death limit';
  else if (limits.timeLimitMinutes != null && entry.elapsedMs > limits.timeLimitMinutes * 60000) entry.ignored = 'time limit';
}
// `ended`: the server clears an event's flag and its `S` entry together
// (server_functions.js:2571-2628), so a report whose feed is current and no longer lists the event
// ends it at once. With no current feed it stays.
function retireMissing(records: Record<string, AttendanceInstance>, live: ReturnType<typeof liveEntries>, report: AttendanceReport) {
  for (const [event, entry] of Object.entries(records))
    if (!live.some(value => value.name === event) && report.eventFeedConnected === true) {
      entry.ended = true; entry.attending = false; delete entry.rejoinPending;
    }
}
// The attendance notices: a member's record that reaches `attending`, goes over a limit, is
// refused by a final join reply, or is left by a player's move.
type Seen = Pick<AttendanceInstance, 'attending' | 'ignored'> | undefined;
function announce(member: string, event: string, was: Seen, entry: AttendanceInstance, detail: Record<string, unknown> = {}): void {
  const at = { member, event, occurrence: occurrenceOf(entry), by: 'core:events' };
  if (entry.attending && !was?.attending) partyHooks().notify('event.joined', at);
  if (!entry.ignored || entry.ignored === was?.ignored) return;
  if (entry.ignored === 'death limit' || entry.ignored === 'time limit') partyHooks().notify('event.limit', { ...at, limit: entry.ignored });
  else if (entry.ignored === 'manual travel') partyHooks().notify('event.left', { ...at, ...detail });
  else if (entry.ignored === 'event-over') partyHooks().notify('event.refused', { ...at, ...detail });
}
const seen = (entry: AttendanceInstance | undefined): Seen => entry && { attending: entry.attending, ignored: entry.ignored };
function recordAttendance(entry: AttendanceInstance, event: string, report: AttendanceReport, now: number) {
  const attending = event === 'anniversary' ? !!report.anniversaryState?.busy :
    (report.joinedEvent || report.mapEvent) === event;
  if (entry.attending) entry.elapsedMs += Math.max(0, now - entry.lastObservedAt);
  recordDeath(entry, event, report, attending);
  entry.attending = attending && !report.rip && !report.farmingNavigationDebug?.event;
  if (entry.attending) { delete entry.rejoinPending; entry.attended = true; }
  entry.lastObservedAt = now;
}

/** Limits exhaust an instance permanently; changing settings does not resurrect it. */
export function observeEventAttendance(state: AttendanceState, report: AttendanceReport, now: number): boolean {
  if (report.eventFeedConnected === false || report.eventClockStale === true) return false;
  const before = JSON.stringify(state.eventAttendance[report.name]);
  const records = state.eventAttendance[report.name] ??= {};
  const live = liveEntries(report);
  retireMissing(records, live, report);
  for (const value of live) {
    const was = seen(records[value.name]);
    const entry = records[value.name] = instance(records[value.name], value.id, report, now);
    recordAttendance(entry, value.name, report, now);
    if (!entry.ignored && refused(entry, value.name, report)) entry.ignored = 'event-over';
    applyLimits(entry, eventLimits(state, report.name)[value.name]);
    announce(report.name, value.name, was, entry, { reply: report.eventRefusal?.reply ?? null });
  }
  // A final reply refuses the occurrence for the other members on the same realm as the
  // game does. `cant_join` refuses every one, since the server's flag is off for all (cant_join:
  // a member that had not asked yet kept the group's walk open); `join_too_late` refuses only
  // those that never attended, since a member of the round may join again
  // (server.js:12682-12687).
  const refusal = report.eventRefusal, own = refusal && records[refusal.name], scope = refusal && joinReply(refusal.reply).refuses;
  let shared = false;
  if (own?.ignored === 'event-over' && scope)
    for (const [name, others] of Object.entries(state.eventAttendance)) {
      const entry = name === report.name ? undefined : others?.[refusal!.name];
      if (entry && !entry.ignored && entry.realm === own.realm && (!entry.id || !own.id || entry.id === own.id) && (scope === 'realm' || !entry.attended)) {
        const was = seen(entry);
        entry.ignored = 'event-over'; shared = true;
        announce(name, refusal!.name, was, entry, { reply: refusal!.reply ?? null });
      }
    }
  return shared || before !== JSON.stringify(records);
}

export function eventInstanceAllowed(state: AttendanceState, name: string, event: string): boolean {
  const own = state.eventAttendance[name]?.[event];
  const leader = state.eventAttendance[eventPolicy(state, name).source]?.[event];
  return !(own && !own.ended && own.ignored) &&
    !(leader && !leader.ended && leader.ignored && leader.ignored !== 'manual travel');
}

// Admission, asked once per report in the ingest and by the answers
// The composition hands on, in the order of v1.5.0's application.ts `eventsEnabledFor`:
// 1. selected: the member's list, or its leader's for a follower, and the merchant's kinds rows;
// 2. not over a limit, not refused, not left (`eventInstanceAllowed`);
// 3. the Cave answers for its participants, called at today's moment with whether the occurrence
//  is live for the member.
// With no event named, row 1 asks whether any selected event passes row 2.
export type CaveAnswer = (name: string, event: string | undefined, live: boolean) => boolean;
export function eventAdmitted(party: AttendanceState & EventFormation & { statuses: Record<string, unknown> },
  name: string, event: string | undefined, cave: CaveAnswer, now: number): boolean {
  const selected = event ? eventEnabled(party, name, event)
    : selectedEvents(party, name).some(entry => eventInstanceAllowed(party, name, entry));
  if (!selected || event && !eventInstanceAllowed(party, name, event)) return false;
  return cave(name, event, occurrenceLive(party.statuses[name] as OccurrenceReport | undefined, event, now));
}
// The selection and limit checks for a group's heartbeat: the selected events its member may still attend.
export function attendableEvents(party: AttendanceState, eventState: EventFormation, name: string): string[] {
  return selectedEvents(eventState, name).filter(event => eventInstanceAllowed(party, name, event));
}

type ManualEventSession = Pick<EventSession, 'event' | 'participants' | 'participationRecorded'> &
  Partial<Pick<EventSession, 'id' | 'authorizedRealm' | 'authorizedAt'>>;
/** Manual command input is an incomplete wire subset, with unvalidated event hints. */
interface ManualEventStatus {
  seenAt:number; server?:string; joinedEvent?:unknown; mapEvent?:unknown; map?:unknown;
  eventFeedConnected?:boolean; eventClockStale?:boolean;
}
interface ManualEventState {
  eventAttendance?: EventAttendance;
  eventSessions?: Record<string, ManualEventSession | undefined>;
  statuses: Record<string, ManualEventStatus | undefined>;
}
function freshManualStatus(status: ManualEventStatus | undefined, now: number): status is ManualEventStatus & {server:string} {
  return !!status && fresh(status.seenAt, now, 'presence') && !!status.server;
}
function authorizedManualSession(session: ManualEventSession | undefined, name: string): session is ManualEventSession {
  return session?.participationRecorded === true && session.participants.includes(name);
}
function canSeedManualOccurrence(state: ManualEventState, name: string, status: ManualEventStatus,
  session: ManualEventSession | undefined, now: number): session is ManualEventSession {
  return authorizedManualSession(session, name) && session.authorizedRealm === status.server &&
    fresh(Number(session.authorizedAt), now, 'presence') && status.eventFeedConnected !== false && !status.eventClockStale &&
    !state.eventAttendance?.[name]?.[session.event];
}
function seedManualOccurrence(state: ManualEventState, name: string, status: ManualEventStatus & {server:string},
  session: ManualEventSession | undefined, now: number): void {
  if (!canSeedManualOccurrence(state, name, status, session, now)) return;
  const records = (state.eventAttendance ||= {})[name] ||= {};
  records[session.event] = {id: session.id || null, realm: status.server, lastLiveAt: now, ended: false,
    elapsedMs: 0, lastObservedAt: now, attending: false, deaths: 0, lastDeathAt: 0, dead: false,
    ignored: 'manual travel', manualTravel: true};
}
function manualOccurrenceParticipating(entry: AttendanceInstance, event: string, status: ManualEventStatus,
  session: ManualEventSession | undefined, name: string): boolean {
  const authorized = session?.event === event && authorizedManualSession(session, name);
  return entry.attending || status.joinedEvent === event || status.mapEvent === event || authorized;
}
function leaveOccurrences(state: ManualEventState, name: string, now: number, keep: string | null, destination: { map?: unknown } | null): void {
  const status = state.statuses[name];
  if (!freshManualStatus(status, now)) return;
  const session = state.eventSessions?.[name];
  if (session?.event !== keep) seedManualOccurrence(state, name, status, session, now);
  for (const [event, entry] of Object.entries(state.eventAttendance?.[name] || {})) {
    if (event !== keep && !entry.ended && entry.realm === status.server && manualOccurrenceParticipating(entry, event, status, session, name)) {
      const was = seen(entry);
      entry.manualTravel = true;
      entry.ignored ||= 'manual travel';
      announce(name, event, was, entry, { command: { destination } });
    }
  }
}
/** `events.playerMoved` (`left`): a player command moves the named
 * members to `destination`, or off every event map when it names none (a realm switch). Only a move
 * off an event's map leaves its occurrence: a member that stands on an event's map and is sent to a
 * point on the same map keeps that occurrence. The event's map is the map the game names for it
 * (the report's `mapEvent`, `G.maps[map].event`), else the map the member stands on while it
 * attends the event (`joinedEvent`): a boss's map, such as Halloween's for Mr. Pumpkin, names no
 * event of its own. Leaving marks only the member's own occurrences; it never creates participation or
 * overwrites a stronger limit, and the attendance observer replaces it when the native id or realm
 * changes. */
export function playerMoved(state: ManualEventState, names: string[], destination: { map?: unknown } | null, now: number): void {
  for (const name of names) {
    const status = state.statuses[name];
    const event = typeof status?.mapEvent === 'string' && status.mapEvent ? status.mapEvent
      : typeof status?.joinedEvent === 'string' && status.joinedEvent ? status.joinedEvent : null;
    const keep = destination && event && status!.map === destination.map ? event : null;
    leaveOccurrences(state, name, now, keep, destination);
  }
}

/** The rejoin route: it takes back a member's occurrence that a player's move left
 * (`left`), and nothing else, so a death or time limit or a refusal stays. The next report's
 * admission then reads the occurrence as allowed. */
export function rejoinOccurrence(state: { eventAttendance?: EventAttendance }, name: string, event: string): boolean {
  const entry = state.eventAttendance?.[name]?.[event];
  if (!entry || entry.ended || entry.ignored !== 'manual travel') return false;
  delete entry.ignored; delete entry.manualTravel;
  return true;
}

/** Acknowledging a filtered selection must not install a competing return. */
export function manualEventOccurrenceSkipped(
  state: {eventAttendance?: EventAttendance}, name: string, event: string,
): boolean {
  const entry = state.eventAttendance?.[name]?.[event];
  return !!entry && !entry.ended && (entry.manualTravel === true || entry.ignored === 'manual travel');
}

/** `left` as the return's `members` reads it: a player's move took the member off this occurrence, so its
 * return never takes the member back. The record keeps the leave after the occurrence ends
 * (`retireMissing` sets only `ended`), and an occurrence named by another id is not this one. */
export function leftOccurrence(state: { eventAttendance?: EventAttendance }, name: string, event: string,
  occurrence: string | null | undefined): boolean {
  const entry = state.eventAttendance?.[name]?.[event];
  return !!entry && (entry.manualTravel === true || entry.ignored === 'manual travel') &&
    (occurrence == null || !entry.id || entry.id === occurrence);
}

/** Death attribution follows authorized participation, not globally visible bosses. */
export interface HuntEventTrip {
  event: string;
  startedAt: number;
  endedAt?: number;
}
export interface HuntEventTrips {
  huntEventTrips?: Record<string, HuntEventTrip[]>;
}

// Attendance opens a trip for every admitted fighter, as and (hunt-trip.ts:12-28); the merchant
// records none.
export function beginHuntEventTrip(
  state: HuntEventTrips,
  name: string,
  event: string,
  now: number,
): HuntEventTrip {
  const trips = ((state.huntEventTrips ||= {})[name] ||= []);
  const current = trips.at(-1);
  if (current && !current.endedAt && current.event === event) return current;
  if (current && !current.endedAt) current.endedAt = now;
  // A trip ends with its occurrence, and every reader
  // reads only the member's last entry, so the ended trips go when a new one opens.
  const trip = { event, startedAt: now };
  trips.splice(0, trips.length, ...trips.filter(entry => !entry.endedAt), trip);
  return trip;
}

export function endHuntEventTrip(
  state: HuntEventTrips,
  name: string,
  event: string | null | undefined,
  now: number,
): void {
  const trip = state.huntEventTrips?.[name]?.at(-1);
  if (trip && !trip.endedAt && (!event || trip.event === event)) trip.endedAt = now;
}

export interface EventSession {
  /** Exact native realm at an actual coordinator admission, before the first joined report. */
  authorizedRealm?: string;
  authorizedAt?: number;
  event: string;
  id: string | null;
  lastLiveAt: number;
  checkpoint: ReturnLocation | null;
  waypoints: Waypoints;
  participants: string[];
  participationRecorded?: boolean;
  returnRoutes?: Record<string, ReturnRoute> | null;
  stagingSpawnAt?: number;
  stagingSpawnId?: number;
  wasLive?: boolean;
}

// The one row of the saved `deferredEventReturns`. The return travel's own deferral writes event null
// for the anniversary cycle, which names no event.
export interface DeferredRecovery {
  event: string | null;
  cycleId: string;
  checkpoint: ReturnLocation | null;
  navigationRevision?: number;
  deferredAt: number;
  phase: string;
  // The start of the return the row left, after which a new occurrence of its event keeps the
  // member (`nextLiveEvent`).
  returnStartedAt?: number;
}

// The admission answer for the event a member's report names: the ingest asks it once per report
// and it rides the member's status to the reply, which the character's event travel reads.
export interface EventAdmission { event: string; allowed: boolean; reason?: string }

interface EventObservationState extends HuntEventTrips {
  eventAttendance?: EventAttendance;
  sessions: Record<string, EventSession>;
  current: EventRecovery | null;
  deferred: Record<string, DeferredRecovery>;
  anniversary: {
    eventCycle?: AnniversaryReturnCycle | null;
    returnReady?: Record<string, unknown>;
    returnDestination?: unknown;
    partyHold?: unknown;
  };
}

export interface EventReport extends ReturnStatus {
  /** Native target wire inherits its report context when coordinates omit it.
   * IDs/types may describe newer game entities than the upstream catalog. */
  target?: (CombatReference & Partial<Pick<MonsterEntity, "hp">> &
    {type?: string; map?: string; in?: string | number; server?: string}) | null;
  in?: string | number;
  server?: string;
  name: string;
  x?: number;
  y?: number;
  joinedEvent?: string;
  serverLiveEvents?: { name: string; id?: string | null }[];
  // The combat event the character's attendance picked as its live one (attend.ts `active`).
  activeEvent?: string | null;
  anniversaryServer?: unknown;
  // The anniversary activity, and the kiss it runs (the kiss's id), which holds a departure.
  anniversaryState?: { busy?: boolean; kiss?: string | null };
  huntEventPending?: unknown;
}

interface EventObservationPorts {
  now(): number;
  activeNames(): string[];
  // The lifecycle owner's answer whether a member is online by any client (roster-projection.ts
  // `online`): a held kiss and a pending return member leave only once it answers offline.
  online(name: string): boolean;
  merchant(): string | null;
  enabled(name: string, event?: string): boolean;
  // The tasks owner's `allows('event-attendance', name)`, no task above attendance holds the
  // member's group.
  admits(name: string): boolean;
  // The selection order: the member's selected events, its leader's for a follower.
  selected(name: string): string[];
  checkpoint(): ReturnLocation | null;
  capture(names?: string[]): Waypoints;
  persist(): void;
  log(message: string, level: string): void;
  statuses(): Readonly<Record<string, (ReturnStatus & { eventAdmission?: EventAdmission | null; eventRejoin?: string | null; eventLeads?: Record<string, number> | null }) | undefined>>;
  goobrawlStillFighting(): boolean;
  begin(event: string, session: EventSession): unknown;
  finishIfReady(): unknown;
  location(recovery: EventRecovery, name: string): ReturnLocation | null;
  intent(name: string): { revision: number; cancelled?: boolean };
  hasCommand(name: string): boolean;
  retireDeferredCommand?(name: string, cycleId: string): void;
  retireDeferredWalk?(name: string, cycleId: string): void;
  finishDeferred?(name: string, cycleId: string, event: string | null): void;
  command(name: string, command: Record<string, unknown>): void;
  nextCommand(): number;
  releaseAnniversary?(cycle: AnniversaryReturnCycle): unknown;
}

/** Raw server reports own event liveness; derived event hints must never refresh it. */
export function createEventObservations(
  state: EventObservationState,
  ports: EventObservationPorts,
) {
  // Attendance captures a member's checkpoint once: a record that moves to another occurrence carries it.
  function sessionSnapshot(previous: EventSession | undefined) {
    return {
      checkpoint: previous?.checkpoint || ports.checkpoint(),
      waypoints: previous?.waypoints || ports.capture(),
    };
  }

  function liveSession(
    report: { name: string; id?: string | null },
    previous?: EventSession,
    carried?: EventSession,
  ): EventSession {
    return {
      event: report.name,
      id: report.id || previous?.id || null,
      lastLiveAt: ports.now(),
      ...sessionSnapshot(previous || carried),
      participants: previous?.participants || [],
      participationRecorded: previous?.participationRecorded ?? true,
      wasLive: true,
    };
  }

  // Admission records departure before a join/route can fail. Seeing a boss
  // globally does not make every enabled character a participant. The realm and time of the
  // admission are its first report's, so presence's `since` holds while the reports go on.
  function participate(name: string, event: string): void {
    const previous = state.sessions[name];
    const session =
      previous?.event === event
        ? previous
        : {
            event,
            id: null,
            lastLiveAt: ports.now(),
            ...sessionSnapshot(undefined),
            participants: [],
          };
    const realm = ports.statuses()[name]?.server;
    const changed = !session.participants.includes(name) || session.participationRecorded !== true || session.authorizedRealm !== realm;
    if (!session.waypoints[name]) Object.assign(session.waypoints, ports.capture([name]));
    if (changed) {
      session.participationRecorded = true;
      session.authorizedRealm = realm;
    }
    // Each admitted report renews the stamp, as v1.5.0's permission poll did
    // (observations.ts:131-133), so the manual-travel seed (`canSeedManualOccurrence`) holds for the
    // whole prejoin walk.
    session.authorizedAt = ports.now();
    if (!session.participants.includes(name)) session.participants.push(name);
    state.sessions[name] = session;
    if (changed || previous !== session) ports.persist();
  }
  // One record per member per occurrence. The record of an occurrence the member was admitted
  // to stays while another event goes live. Otherwise the record follows the member's top live
  // event in its selection order, so two live events no longer rebuild it on each
  // report.
  function admittedElsewhere(name: string, session: EventSession | undefined, event: string): boolean {
    return !!session && session.event !== event && session.participants.includes(name);
  }
  function topLive(body: EventReport, reports: { name: string; id?: string | null }[]) {
    const name = body.name;
    const live = reports.filter(report => ports.enabled(name, report.name) &&
      !searchExhausted(report.name, body));
    return ports.selected(name).map(event => live.find(report => report.name === event)).find(report => report) ?? null;
  }
  function reportLive(name: string, report: { name: string; id?: string | null }): void {
    const existing = state.sessions[name];
    if (admittedElsewhere(name, existing, report.name)) return;
    const previous = existing?.event === report.name ? existing : undefined;
    state.sessions[name] = liveSession(report, previous, existing);
    if (!previous) ports.persist();
  }

  type StagingReport = NonNullable<EventReport["serverStagingEvents"]>[number];
  function ownsPrejoinStaging(name: string, event: string): boolean {
    const session=state.sessions[name];
    return !!session && session.event===event && !session.wasLive && session.participationRecorded===true &&
      session.participants.includes(name);
  }
  function authorizedPrejoinStaging(body: EventReport, event: string): boolean {
    const status=ports.statuses()[body.name];
    return ownsPrejoinStaging(body.name,event) && !body.rip && !ports.intent(body.name).cancelled &&
      freshDeferredFighter(status) && liveFeedReady(status) && typeof body.server==='string' &&
      body.server.length>0 && body.server===status.server;
  }
  function validStaging(body: EventReport, report: StagingReport): boolean {
    return (body.joinedEvent === report.name || authorizedPrejoinStaging(body,report.name)) && eventIs(report.name, 'staged') &&
      ports.enabled(body.name, report.name) && stagingWindow(report.spawnAt, ports.now(), leadFor(ports.statuses()[body.name], report.name));
  }
  function sameStagingRound(previous: EventSession | undefined, report: StagingReport): boolean {
    if (!previous) return true;
    if (previous.wasLive) return false;
    if (previous.stagingSpawnId === undefined) return true;
    return previous.stagingSpawnId === (report.spawnId ?? report.spawnAt);
  }
  function stagingSession(previous: EventSession | undefined, report: StagingReport): EventSession {
    const prior: EventSession = previous || { event: report.name, id: null,
      lastLiveAt: ports.now(), ...sessionSnapshot(undefined), participants: [], participationRecorded: false };
    return { ...prior, stagingSpawnAt: prior.stagingSpawnAt ?? report.spawnAt,
      stagingSpawnId: prior.stagingSpawnId ?? report.spawnId ?? report.spawnAt };
  }
  function applyStaging(name: string, report: StagingReport): void {
    const existing = state.sessions[name];
    const previous = existing?.event === report.name ? existing : undefined;
    if (!sameStagingRound(previous, report)) return;
    state.sessions[name] = stagingSession(previous, report);
    if (!previous || previous.stagingSpawnAt === undefined) ports.persist();
  }
  function reportStaging(body: EventReport): void {
    if (body.eventFeedConnected === false || body.eventClockStale) return;
    for (const report of body.serverStagingEvents || []) {
      if (!validStaging(body, report)) continue;
      applyStaging(body.name, report);
    }
  }

  function combatDeparturePending(cycle: AnniversaryReturnCycle): boolean {
    return ports.now() <= cycle.endsAt && !!(cycle.combatHandoffAt || cycle.combatPendingEvent);
  }
  // Admission for the anniversary: selected and under its limits; a fighter waits while a combat event's
  // departure is pending in the round.
  function anniversaryPermission(name: string) {
    if (!ports.enabled(name, "anniversary")) return { allowed: false, reason: "anniversary disabled or instance exhausted" };
    const cycle = state.anniversary.eventCycle;
    if (name === ports.merchant() || !cycle) return { allowed: true };
    if (combatDeparturePending(cycle))
      return { allowed: false, reason: "combat event departure pending" };
    return { allowed: true };
  }
  // The kiss hold: the member's report names the kiss it runs, which holds a combat
  // departure while it runs. A kiss that starts while a departure is pending holds nothing, as the
  // refused begin did in v1.5.0, and a report that no longer names the kiss, the round's
  // end, or the lifecycle owner's answer that the member is offline ends it (rework pass).
  function reportKiss(body: EventReport): void {
    const cycle = state.anniversary.eventCycle, kiss = body.anniversaryState?.kiss, held = cycle?.kissOperations?.[body.name];
    if (!cycle || body.name === ports.merchant() || (kiss || null) === (held?.id ?? null)) return;
    if (held) delete cycle.kissOperations![body.name];
    if (kiss && !combatDeparturePending(cycle))
      (cycle.kissOperations ||= {})[body.name] = { id: kiss, expiresAt: Number(cycle.endsAt) };
    ports.persist();
  }
  function pendingKisses(cycle: AnniversaryReturnCycle): string[] {
    for (const [member, kiss] of Object.entries(cycle.kissOperations || {}))
      if (kiss.expiresAt <= ports.now() || !ports.online(member)) {
        delete cycle.kissOperations![member];
        ports.persist();
      }
    return Object.keys(cycle.kissOperations || {});
  }
  function handoffCombat(cycle: AnniversaryReturnCycle, name: string, event: string) {
    if (cycle.combatPendingEvent !== event) {
      cycle.combatPendingEvent = event;
      ports.log("Anniversary waiting interrupted by " + event, "info");
      ports.persist();
    }
    const kissing = pendingKisses(cycle);
    if (kissing.length)
      return { allowed: false, reason: "Finishing anniversary kiss: " + kissing.join(", ") };
    handOff(cycle, name, event, "Anniversary handed off to " + event + "; combat recovery owns the return");
    return { allowed: true };
  }
  // The anniversary round hands its party to a combat event, whose recovery owns the return.
  function handOff(cycle: AnniversaryReturnCycle, name: string, event: string, message: string): void {
    ports.releaseAnniversary?.(cycle);
    cycle.combatEvent = event;
    cycle.combatHandoffAt = ports.now();
    cycle.combatHandoffCharacter = name;
    state.anniversary.returnReady = {};
    state.anniversary.returnDestination = null;
    state.anniversary.partyHold = null;
    ports.log(message, "info");
    ports.persist();
  }
  function needsCombatHandoff(
    cycle: AnniversaryReturnCycle | null | undefined,
  ): cycle is AnniversaryReturnCycle {
    return !!cycle && !cycle.returnCompletedAt && !cycle.supersededAt && !cycle.combatHandoffAt;
  }
  // The selection, limit and tasks checks for a combat event, then its admission: the anniversary round hands its party to
  // combat, the member joins the occurrence's record with its checkpoint and waypoints, and the
  // deferred party it returned with moves with it.
  // `event.attend`: an add-on may refuse a member those checks admit, before its session and
  // checkpoint are captured. A refusal is announced once while its reason stays the same.
  const addonRefusals = new Map<string, string>();
  function addonRefusal(name: string, event: string): string | undefined {
    const entry = state.eventAttendance?.[name]?.[event], occurrence = entry ? occurrenceOf(entry) : event;
    const reason = partyHooks().events.attendRefuses({ member: name, event, occurrence, allowed: true }), key = name + '|' + event;
    if (reason && addonRefusals.get(key) !== reason) partyHooks().notify('event.refused', { member: name, event, occurrence, hook: reason, by: reason.split(':')[0] });
    if (reason) addonRefusals.set(key, reason); else addonRefusals.delete(key);
    return reason;
  }
  function authorize(name: string, event: string) {
    if (event === "anniversary") return anniversaryPermission(name);
    if (!ports.enabled(name, event)) return { allowed: false, reason: "event disabled or movement cancelled" };
    const refusal = addonRefusal(name, event);
    if (refusal) return { allowed: false, reason: refusal };
    const cycle = state.anniversary.eventCycle;
    if (needsCombatHandoff(cycle)) {
      const result = handoffCombat(cycle, name, event);
      if (!result.allowed) return result;
    }
    participate(name, event);
    if (cycle?.combatEvent === event && cycle.waypoints && state.sessions[name]!.waypoints !== cycle.waypoints) {
      state.sessions[name]!.waypoints = cycle.waypoints;
      ports.persist();
    }
    transferDeferredParty(name, event);
    return { allowed: true };
  }
  // Trips: an admitted fighter opens its trip; the anniversary's trip opens once its activity runs. A trip with no event name, or an
  // anniversary trip whose return finished while the anniversary is no longer ahead, ends.
  function reconcileTrip(body: EventReport, admitted: string | null): void {
    const name = body.name, open = state.huntEventTrips?.[name]?.at(-1), cycle = state.anniversary.eventCycle;
    if (open && !open.endedAt && (["null", "undefined"].includes(open.event) || open.event === "anniversary" &&
        !!(cycle?.returnCompletedAt || cycle?.supersededAt) && !body.huntEventPending)) {
      endHuntEventTrip(state, name, open.event, ports.now());
      ports.persist();
    }
    if (!admitted || admitted === "anniversary" && !body.anniversaryState?.busy) return;
    const before = state.huntEventTrips?.[name]?.at(-1);
    beginHuntEventTrip(state, name, admitted, ports.now());
    if (state.huntEventTrips?.[name]?.at(-1) !== before) ports.persist();
  }
  // The merchant's admission (correction 40): its own group (row 36 (c)) asks rows 1 to 3 like a
  // fighter, and the admission is its session alone. It hands no anniversary round to combat and
  // moves no deferred party, as on an earlier build, where its joined report alone recorded it.
  // Its anniversary visit is the merchant control's (anniversary.ts), not an occurrence.
  function admitMerchant(name: string, event: string): EventAdmission {
    if (!ports.admits(name) || ports.intent(name).cancelled) return { event, allowed: false };
    if (!ports.enabled(name, event)) return { event, allowed: false, reason: "event disabled or movement cancelled" };
    const refusal = addonRefusal(name, event);
    if (refusal) return { event, allowed: false, reason: refusal };
    participate(name, event);
    return { event, allowed: true };
  }
  const admissions = new Map<string, string>();
  // Admission in the ingest, once per report and ahead of presence, for the event the report
  // names as its live one: the combat event the character's attendance picked, else the anniversary round it
  // reports. The event return holds a member, and the tasks owner's answer covers its
  // group. The answer rides the member's status for the reply.
  function admit(body: EventReport): EventAdmission | null {
    const name = body.name, merchant = name === ports.merchant();
    const event = body.activeEvent || (!merchant && body.anniversaryServer ? "anniversary" : null);
    reportKiss(body);
    // `ended`: the member's record of an ended occurrence (`retireMissing`) admits nobody, though
    // the character's report names the event for a while after the end. A new occurrence opens a new
    // record (`instance`), which admits again.
    const ended = !!event && state.eventAttendance?.[name]?.[event]?.ended === true;
    const answer: EventAdmission | null = !event ? null : ended ? { event, allowed: false, reason: 'occurrence ended' }
      : merchant ? admitMerchant(name, event)
      : state.current?.participants.includes(name) || !ports.admits(name) || ports.intent(name).cancelled ? { event, allowed: false }
      : { event, ...authorize(name, event) };
    reconcileTrip(body, answer?.allowed && !merchant ? answer.event : null);
    const status = ports.statuses()[name];
    // `event.admitted`: once per admission, with the checkpoint the session captured. The
    // observer remembers the event it announced, since the status intake replaces the member's
    // status on each full report and drops the last answer (status/coordinator/intake.ts `store`).
    if (answer?.allowed && admissions.get(name) !== answer.event) {
      const entry = state.eventAttendance?.[name]?.[answer.event];
      partyHooks().notify('event.admitted', { member: name, event: answer.event, occurrence: entry ? occurrenceOf(entry) : answer.event,
        checkpoint: state.sessions[name]?.checkpoint ?? null, by: 'core:events' });
    }
    if (answer?.allowed) admissions.set(name, answer.event); else admissions.delete(name);
    if (status) {
      status.eventAdmission = answer;
      // The occurrence the member died in and has not reached again, which the reply carries for
      // the character's rejoin.
      status.eventRejoin = Object.entries(state.eventAttendance?.[name] ?? {}).find(([, entry]) => entry.rejoinPending && !entry.ended)?.[0] ?? null;
    }
    return answer;
  }
  function transferDeferredCheckpoint(name: string): void {
    const recovery = state.deferred[name];
    if (!recovery) return;
    ports.retireDeferredWalk?.(name, recovery.cycleId);
    const intent = ports.intent(name), session = state.sessions[name]!;
    if (recovery.checkpoint && recovery.navigationRevision === intent.revision && !intent.cancelled)
      session.waypoints = {...session.waypoints, [name]: {revision:intent.revision, location:{...recovery.checkpoint}}};
    ports.retireDeferredCommand?.(name, recovery.cycleId);
    delete state.deferred[name];
    ports.persist();
  }
  function transferDeferredParty(name: string, event: string): void {
    const cycleId = state.deferred[name]?.cycleId;
    const followers = cycleId ? ports.activeNames().filter(member =>
      member !== name && canTransferDeferredFighter(member, cycleId, event)) : [];
    // Admission, not a global boss sighting, hands the original return party
    // to combat. Blocked followers cannot independently request permission.
    transferDeferredCheckpoint(name);
    for (const member of followers) {
      participate(member, event);
      transferDeferredCheckpoint(member);
    }
  }
  function canTransferDeferredFighter(name: string, cycleId: string, event: string): boolean {
    const deferred = state.deferred[name], intent = ports.intent(name);
    if (!deferred || deferred.cycleId !== cycleId || name === ports.merchant() ||
        !ports.enabled(name, event) || intent.cancelled || deferred.navigationRevision !== intent.revision) return false;
    return freshDeferredFighter(ports.statuses()[name]);
  }
  function freshDeferredFighter(report: ReturnStatus | undefined): boolean {
    const at = Number(report?.seenAt);
    return !!report && !report.rip && fresh(at, ports.now(), 'report');
  }

  function reportAnniversaryHandoff(body: EventReport): void {
    const cycle = state.anniversary.eventCycle;
    if (
      !ports.enabled(body.name, body.joinedEvent) ||
      !body.joinedEvent ||
      !cycle ||
      cycle.returnDispatchedAt ||
      cycle.combatHandoffAt ||
      ports.now() > Number(cycle.endsAt || 0)
    )
      return;
    handOff(cycle, body.name, String(body.joinedEvent),
      "Anniversary visits handed off to " + body.joinedEvent + "; combat-event recovery now owns the party return");
  }

  function rawLive(event: string): boolean {
    return ports
      .activeNames()
      .some(
        (name) =>
          ports.enabled(name, event) &&
          !searchExhausted(event, ports.statuses()[name]) &&
          ports.statuses()[name]?.serverLiveEvents?.some((entry) => entry && entry.name === event),
      );
  }

  function liveFeedReady(report: ReturnStatus | undefined): report is ReturnStatus {
    const at = Number(report?.seenAt);
    return !!report && fresh(at, ports.now(), 'presence') &&
      report.eventFeedConnected !== false && !report.eventClockStale;
  }

  // The live event that takes `name` from its return from `returningFrom`: another event, or a new
  // occurrence of the same one whose instance the feed first showed after `since`, the return's
  // start. The occurrence the return left stays out.
  function nextLiveEvent(name: string, returningFrom: string | null, since?: number): string | null {
    const report = ports.statuses()[name];
    if (!liveFeedReady(report) || ports.intent(name).cancelled) return null;
    const newer = (event: string) => {
      const entry = state.eventAttendance?.[name]?.[event];
      return since !== undefined && !!entry && !entry.ended && Number(entry.since) > since;
    };
    return report.serverLiveEvents?.find(entry => (entry.name !== returningFrom || newer(entry.name)) &&
      ports.enabled(name, entry.name) && rawLive(entry.name) &&
      !searchExhausted(entry.name, report))?.name || null;
  }

  function carryCheckpoint(name: string, event: string, previous: EventSession): void {
    const waypoint = previous.waypoints[name];
    const intent = ports.intent(name);
    if (!waypoint || waypoint.revision !== intent.revision || intent.cancelled) return;
    const target = state.sessions[name]?.event === event ? state.sessions[name] : liveSession({name: event});
    target.waypoints[name] = {
      revision: waypoint.revision,
      location: waypoint.location && {...waypoint.location},
    };
    state.sessions[name] = target;
  }

  function ended(name: string, session: EventSession): boolean {
    if (!session || !ports.enabled(name, session.event)) return false;
    const latest = Math.max(
      ...Object.values(state.sessions)
        .filter((entry) => entry?.event === session.event)
        .map((entry) => Number(entry.lastLiveAt) || 0),
    );
    // Persisted staging owns its immutable deadline across restarts/report
    // gaps. A fresh connected feed can explicitly withdraw that announcement.
    const staging = Object.entries(state.sessions).some(([member, entry]) =>
      entry.event === session.event && !entry.wasLive && ports.enabled(member, entry.event) &&
      Number.isFinite(entry.stagingSpawnAt) && stagingStillAnnounced(member, entry));
    return (
      !staging &&
      !rawLive(session.event) &&
      !(eventKey(session.event)?.return === 'goobrawl-wait' && ports.goobrawlStillFighting()) &&
      feedDropped(session.event, latest)
    );
  }
  // `ended` from game data (as `retireMissing`): a member of the occurrence whose current
  // feed reports after the last live sighting without listing the event.
  function feedDropped(event: string, latest: number): boolean {
    return Object.entries(state.sessions).some(([member, entry]) => {
      if (entry?.event !== event) return false;
      const report = ports.statuses()[member];
      return liveFeedReady(report) && report.eventFeedConnected === true && Number(report.seenAt) > latest &&
        !report.serverLiveEvents?.some(live => live?.name === event);
    });
  }

  function stagingStillAnnounced(member: string, session: EventSession): boolean {
    // A member no longer present holds no staging; a present one's gap in its feed keeps it.
    const report = ports.statuses()[member];
    if (!report || !fresh(Number(report.seenAt), ports.now(), 'presence')) return false;
    if (!liveFeedReady(report) || !Array.isArray(report.serverStagingEvents)) return true;
    return report.serverStagingEvents.some(entry => entry.name === session.event &&
      (entry.spawnId ?? entry.spawnAt) === session.stagingSpawnId);
  }

  function beginEndedReturn(): void {
    const session = Object.entries(state.sessions).find(([name, value]) => ended(name, value))?.[1];
    if (!session || state.current) return;
    const sessions = Object.values(state.sessions).filter(
      (entry) => entry?.event === session.event,
    );
    const participants = [...new Set(sessions.flatMap((entry) => entry.participants))].filter(name => {
      const event = nextLiveEvent(name, session.event);
      if (!event) return true;
      const previous = sessions.find(entry => entry.participants.includes(name))!;
      carryCheckpoint(name, event, previous);
      return false;
    });
    if (participants.length) ports.begin(session.event, { ...session, participants });
    clearEndedSessions(session.event);
    ports.persist();
  }
  function clearEndedSessions(event: string): void {
    const cycle = state.anniversary.eventCycle;
    if (cycle?.combatPendingEvent === event && !cycle.combatHandoffAt)
      delete cycle.combatPendingEvent;
    for (const [name, entry] of Object.entries(state.sessions))
      if (entry?.event === event) delete state.sessions[name];
  }

  function nativeHalloweenTarget(body: EventReport): string | undefined {
    const target = body.target;
    if (!target || target.type !== "monster" || !target.id || !(Number(target.hp) > 0)) return;
    if (!localTarget(body)) return;
    return eventIs(target.mtype, 'assisted') ? target.mtype : undefined;
  }

  function localTarget(body: EventReport): boolean {
    const target = body.target!;
    return (target.map === undefined || target.map === body.map) &&
      (target.in === undefined || String(target.in) === String(body.in ?? body.map)) &&
      (target.server === undefined || target.server === body.server);
  }

  function matchingNativeContext(body: EventReport, status: ReturnStatus): boolean {
    return typeof body.map === "string" && body.map === status.map &&
      typeof body.server === "string" && body.server === status.server &&
      String(body.in ?? body.map) === String(status.in ?? status.map);
  }

  function assistedReportReady(body: EventReport): boolean {
    const status = ports.statuses()[body.name];
    return liveFeedReady(status) && !ports.intent(body.name).cancelled && !body.rip &&
      !body.eventClockStale && body.eventFeedConnected !== false && matchingNativeContext(body, status);
  }

  function observedParticipation(body: EventReport, reports: {name: string}[]): string | undefined {
    if (body.joinedEvent || body.mapEvent) return body.joinedEvent || body.mapEvent;
    if (!assistedReportReady(body)) return;
    const event = nativeHalloweenTarget(body);
    // A following fighter can assist a real boss without the join flag. Its
    // actual living target establishes attendance; a global sighting cannot.
    return event && reports.some(report => report.name === event) ? event : undefined;
  }

  function observe(body: EventReport): void {
    const reports = Array.isArray(body.serverLiveEvents)
      ? body.serverLiveEvents.filter((entry) => entry && typeof entry.name === "string")
      : [];
    const top = ports.enabled(body.name) ? topLive(body, reports) : null;
    if (top) reportLive(body.name, top);
    reportStaging(body);
    const participating = observedParticipation(body, reports);
    if (participating && ports.enabled(body.name, participating))
      participate(body.name, participating);
    reportAnniversaryHandoff(body);
  }
  // The return's member rows (returns.ts createReturnMemberRows) run after `observe` and read these.
  return { admit, observe, beginEndedReturn, nextLiveEvent, freshDeferredFighter, liveFeedReady };
}
