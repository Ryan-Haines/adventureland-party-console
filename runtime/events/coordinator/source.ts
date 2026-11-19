// The events owner's answers to the groups and tasks owner:
// the `event` source, `event.presence` and the `member.presence` notice.
// Moved from the tasks owner's stand-ins (runtime/tasks/coordinator/presence.ts and stand-ins/events.ts),
// their rules unchanged.
//
// The raw status fields count only as evidence for a live occurrence on the member's own realm:
// staging alone gives null (the trip opens at admission, and the character reports `activeEvent`
// from the spawn minus the schedule's walk estimate lead, character/clock.ts `attendance`), and so does a
// restored `joinedEvent` with no live occurrence.
import type { MemberHold, Registration } from '../../hooks/registry.ts';
import { partyHooks } from '../../hooks/index.ts';
import { fresh } from '../../protocol/reports.ts';
import { publishEventAnswers } from '../api.ts';
import { eventAttendanceLine, eventDisplayNames, eventReturnLine, type EventCardLine } from '../rules.ts';
import type { AttendanceInstance, EventAttendance } from './attendance.ts';

export type PresencePhase = 'walking' | 'attending' | 'returning';
export interface EventPresence { event: string; occurrence: string; realm: string; phase: PresencePhase; since: number; ended?: boolean }
export interface PresenceState {
  eventAttendance?: EventAttendance;
  huntEventTrips?: Record<string, { event: string; startedAt: number; endedAt?: number }[]>;
  eventReturn?: { event?: string; cycleId?: string; participants: string[]; startedAt?: number } | null;
  // The last finished return; its occurrence awaits no further return.
  eventReturnLast?: { event: string; occurrence?: string | null } | null;
  deferredEventReturns?: Record<string, { event?: string; cycleId?: string; deferredAt?: number } | undefined>;
  eventSessions?: Record<string, { event: string; participants: string[]; authorizedAt?: number } | undefined>;
  statuses: Record<string, { server?: string; map?: string } | undefined>;
}

// A live occurrence the member may attend: not ended, not ignored, on its own realm.
function live(entry: AttendanceInstance | undefined, realm: string | undefined): entry is AttendanceInstance {
  return !!entry && !entry.ended && !entry.ignored && !!realm && entry.realm === realm;
}
// An attendance record's occurrence: the server's id for it, or the realm's live one for a feed without one.
export const occurrenceOf = (entry: Pick<AttendanceInstance, 'id' | 'realm'>) => entry.id ?? `live@${entry.realm}`;

// `inCave` answers true for a Cave participant, who is never at an event because events are
// refused for it (hunting/coordinator/cave.ts `eventAllowed`).
// `attends` answers whether the member still attends an event (its own or its leader's selection);
// a walk toward one it no longer attends is no presence.
export function presence(state: PresenceState, name: string, inCave = false, attends: (name: string, event: string) => boolean = () => true): EventPresence | null {
  if (inCave) return null;
  const realm = state.statuses[name]?.server, records = state.eventAttendance?.[name] ?? {};
  // A member the event return lists is returning, even while its trip to the ended or left
  // occurrence is still open; the return releases it before it joins a next event.
  if (state.eventReturn?.participants.includes(name) && state.eventReturn.event)
    return { event: state.eventReturn.event, occurrence: String(state.eventReturn.cycleId ?? 'return'), realm: realm ?? '', phase: 'returning',
      since: Number(state.eventReturn.startedAt) || 0 };
  const trip = state.huntEventTrips?.[name]?.at(-1), open = trip && !trip.endedAt ? trip : undefined;
  // The attendance admission: the member's open trip, or with none open its own admitted session, which is
  // the only record of a member the Hunt does not hold (the merchant records no trip).
  const session = state.eventSessions?.[name];
  const admitted = open ? { event: open.event, since: open.startedAt }
    : session?.participants.includes(name) ? { event: session.event, since: Number(session.authorizedAt) || 0 } : undefined;
  // The admission (attendance.ts `admit`) names the member's top live event. Once it names another
  // live event the member still attends, the record the member stood on gives way and the member
  // walks to the admitted one.
  const moved = !!admitted && live(records[admitted.event], realm) && attends(name, admitted.event);
  for (const [event, entry] of Object.entries(records)) {
    if (!live(entry, realm) || moved && event !== admitted!.event) continue;
    // A dead member keeps attending while its instance lives and it is admitted, so its group
    // still knows where it belongs (UP-1).
    if (entry.attending || entry.dead && admitted?.event === event)
      return { event, occurrence: occurrenceOf(entry), realm: entry.realm, phase: 'attending', since: admitted?.since ?? entry.lastObservedAt };
    if (admitted?.event === event && attends(name, event))
      return { event, occurrence: occurrenceOf(entry), realm: entry.realm, phase: 'walking', since: admitted.since };
  }
  // An ended occurrence whose instance map the member still stands on (the game names an
  // instanced event's map after it: `goobrawl`) has the member returning before the return's own
  // record exists: the return begins only once the survivors there are dead
  // (`return` row `goobrawl-wait`, coordinator/returns.ts `goobrawlStillFighting` through attendance.ts's
  // port), and until then no lower task may walk the
  // group off the map. `ended` marks it for the return's seat.
  // A member the return already let go (its deferred row, as when a next live event takes it) is
  // no longer awaiting that return: the return ended without it, so its ended occurrence holds
  // nothing, and its deferred row below names where it stands.
  // A return that already finished for this occurrence (`eventReturnLast`, kept across a reload)
  // awaits nothing, so a member standing on the map again, as a stale `joinedEvent` reports, is no presence.
  const last = state.eventReturnLast;
  const returned = (event: string, entry: AttendanceInstance) => last?.event === event && (last.occurrence == null || last.occurrence === entry.id);
  const deferred = state.deferredEventReturns?.[name];
  if (!deferred?.event) for (const [event, entry] of Object.entries(records))
    if (entry?.ended && !entry.ignored && !returned(event, entry) && !!realm && entry.realm === realm && state.statuses[name]?.map === event)
      return { event, occurrence: occurrenceOf(entry), realm: entry.realm, phase: 'returning', since: open?.startedAt ?? entry.lastObservedAt, ended: true };
  if (deferred?.event)
    return { event: deferred.event, occurrence: String(deferred.cycleId ?? 'return'), realm: realm ?? '', phase: 'returning', since: Number(deferred.deferredAt) || 0 };
  return null;
}

// Events go first and are finished; a Hunt hand-in never holds the party
// away from one. The first event that is live on a member's realm (the report's server live list
// or a live Anniversary round, never the staging lead, so Hunt keeps farming through it) and
// that the member attends by its own selection and limits. `attends` must have no side effect.
export interface LiveEventReport { seenAt?: number; serverLiveEvents?: { name: string }[]; anniversaryServer?: { live?: boolean } | null }
export function eventFirst(statuses: Readonly<Record<string, LiveEventReport | undefined>>, names: readonly string[],
  attends: (name: string, event: string) => boolean, now: number): string | null {
  for (const name of names) {
    const report = statuses[name];
    if (!report || !fresh(report.seenAt, now, 'report', 0, true)) continue;
    const live = [...(report.serverLiveEvents ?? []).map(entry => entry.name), ...(report.anniversaryServer?.live ? ['anniversary'] : [])];
    const event = live.find(candidate => attends(name, candidate));
    if (event) return event;
  }
  return null;
}

// `event.presence`: each member's presence, computed once per full report from its own
// scope's records, after the attendance limits (01 design 3.1). The fact rides on the member's
// status, so every reader of "is this member at an event" (combat composition, convoy defence, the
// grouped snapshot) reads one answer.
export interface PresencePorts {
  record(): PresenceState & { statuses: Record<string, { presence?: EventPresence | null } | undefined> };
  scope(name: string): object;
  // A Cave participant is never at an event.
  visit(name: string): boolean;
  attends(name: string, event: string): boolean;
}
export function createEventPresence(ports: PresencePorts) {
  const presences = new Map<string, EventPresence | null>();
  function observe(name: string): void {
    const r = ports.record(), before = presences.get(name);
    const at = presence({ ...ports.scope(name), eventAttendance: r.eventAttendance, statuses: r.statuses } as PresenceState, name, ports.visit(name), ports.attends);
    const status = r.statuses[name];
    if (status) status.presence = at;
    presences.set(name, at);
    if (JSON.stringify(before) !== JSON.stringify(at)) partyHooks().notify('member.presence', { member: name, presence: at, by: 'core:events' });
  }
  function presenceOf(name: string): EventPresence | null {
    return presences.get(name) ?? null;
  }
  // Whether the member's presence was computed since the start: after a coordinator restart the
  // first task tick computes it from the saved attendance and trips.
  function observed(name: string): boolean {
    return presences.has(name);
  }
  publishEventAnswers({ presence: presenceOf });
  return { observe, presenceOf, observed, presences };
}

// The `event` source. It reads each member's presence, the scope's event return and
// the merchant's own return and decides nothing; the tasks owner's table does.
interface EventReturn { cycleId?: string; event?: string; phase?: string; participants: string[] }
export interface EventSourcePorts {
  presence(name: string): EventPresence | null | undefined;
  // The member's scope's event return (a solo character's lives in its own profile).
  eventReturn(name: string): EventReturn | null | undefined;
  // The merchant's own return: never the party's.
  merchantReturn(name: string): { cycleId?: string; event?: string | null; phase?: string } | undefined;
  // What the member's own report names as holding it from a walk's command (walk-client.ts
  // `commandHold`).
  commandHold(name: string): { owner?: string; reason?: string } | null | undefined;
}
// `member.holder` for the members the events owner holds, read
// from attendance and the return through the member's presence. A walk to the member's own event, or its own event
// return's cycle, is not held. A member attending another occurrence is not coming, so the walk
// goes on without it; a returning member is coming once its return releases it. A walking member
// whose report names an event tier's request as its hold is coming (S-06k).
export function eventHolds(at: EventPresence | null | undefined, ask: { activity?: string; key?: string },
  named: { owner?: string; reason?: string } | null | undefined): MemberHold[] {
  // The player's own trip (`manual`) is not held either: `playerMoved` decides what the move does to the
  // attendance (attendance.ts).
  const own = !!at && (ask.activity === 'event' && ask.key === at.event || ask.activity === 'event-return' && ask.key === at.occurrence ||
    ask.activity === 'manual');
  if (at && !own && at.phase === 'attending') return [{ owner: '06', reason: 'attending ' + at.event, coming: false, endsOn: 'event.ended' }];
  if (at && !own && at.phase === 'returning') return [{ owner: '06', reason: 'returning from ' + at.event, coming: true, endsOn: 'event.returned' }];
  if (named?.owner === '06') return [{ owner: '06', reason: String(named.reason), coming: true, endsOn: 'event.left' }];
  return [];
}
// The tasks carry the events owner's card words (rules.ts) as their label, with the
// event's display name.
const shown = (event: string | null | undefined) => event ? eventDisplayNames[event] ?? event : 'event';
const words = (line: EventCardLine) => 'walk' in line ? line.walk.travelling : line.label;
const returning = (event: string | null | undefined) => words(eventReturnLine(shown(event), false));
export function eventSource(ports: EventSourcePorts): Registration {
  return { name: 'core:event', folder: 'core', author: 'adventureland-party-console', holder: '06',
    summary: "Asks for a group's event attendance while a member walks to or attends a live event, and its return after.",
    hooks: { 'member.holder': ask => eventHolds(ports.presence(ask.member), ask, ports.commandHold(ask.member)),
      'task.request': view => {
      const g = view as { groupKind: string; members: string[] }, at = g.members.map(name => ports.presence(name)).find(p => p && p.phase !== 'returning');
      const attend = { slot: 'attend', end: 'event-over', ask: at ? { kind: 'event-attendance', owner: `attend:${at.event}:${at.occurrence}`, members: [...g.members],
        phase: at.phase, label: words(eventAttendanceLine(shown(at.event), at.phase === 'attending', at.phase === 'walking')), goal: { event: at.event, occurrence: at.occurrence } } : null };
      const back = ports.eventReturn(g.members[0]!);
      const own = g.groupKind === 'merchant' ? ports.merchantReturn(g.members[0]!) : undefined;
      // A member still on an ended occurrence's map is returning before the return's record exists
      // (presence `ended`): the group holds as that return, with no walk, until the record names it.
      const awaiting = g.groupKind !== 'merchant' ? g.members.map(name => ports.presence(name)).find(p => p?.ended) : undefined;
      const ask = own?.cycleId ? { kind: 'event-return' as const, owner: `event-return:${own.cycleId}`, members: [...g.members], phase: own.phase ?? 'merchant-return', label: returning(own.event) }
        : g.groupKind !== 'merchant' && back && g.members.some(name => back.participants.includes(name)) ? { kind: 'event-return' as const, owner: `event-return:${back.cycleId}`,
          members: [...g.members], phase: back.phase ?? 'evacuating', label: returning(back.event) }
        : awaiting ? { kind: 'event-return' as const, owner: `event-return:ended:${awaiting.event}:${awaiting.occurrence}`, members: [...g.members],
          phase: 'awaiting-return', label: returning(awaiting.event), goal: { event: awaiting.event, occurrence: awaiting.occurrence } } : null;
      // The awaiting hold hands over to the return's record (`replaced`); the return ends `returned`.
      return [attend, { slot: 'back', ask, end: ask ? 'replaced:event-return' : 'returned' }];
    } } };
}
