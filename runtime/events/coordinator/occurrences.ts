// The event occurrences on the coordinator: the schedule reports the characters send, and each
// group's scheduled walk with its `due` lead. The schedule reports moved from
// runtime/coordinator/events/schedule-reports.ts.
import { requestObject } from '../../lifecycle/api.ts';
import { partyHooks } from '../../hooks/index.ts';
import { fresh } from '../../protocol/reports.ts';
import { boundFired } from '../../status/coordinator/api.ts';
import { gameEvents, isSafeAt, townLanding } from '../../movement/api/coordinator.ts';
import { eventIs, eventKey, eventShortWindow, leadFor, occurrenceId } from '../rules.ts';
import { cipherEntry } from '../october.ts';

export interface TrickOrTreatCounts {
  day:string;
  observedAt:number;
  characterRemaining:number;
  characterLimit:number;
  accountRemainingUpperBound:number;
  accountLimit:number;
}
interface Schedule {
  [key: string]: unknown;
}
interface Report {
  seenAt: number;
  owner?: unknown;
  server?: string;
  eventSchedules?: Schedule[];
  eventFeedAt?: unknown;
  eventClockStale?: unknown;
  eventFeedConnected?: boolean;
}

/** Prefer the latest feed among fresh reports from the leader's realm. */
export function projectEventSchedules(
  statuses: Record<string, Report | null | undefined>,
  leader: string | null,
  now: () => number,
): Schedule[] {
  const server = statuses[String(leader)]?.server;
  const reports = Object.values(statuses).filter(
    (report): report is Report & { eventSchedules: Schedule[] } =>
      !!report &&
      !!report.eventSchedules &&
      fresh(report.seenAt, now(), 'presence', 0, true) &&
      (!server || report.server === server),
  );
  reports.sort((a, b) => Number(b.eventFeedAt || 0) - Number(a.eventFeedAt || 0));
  const report = reports[0];
  return report
    ? report.eventSchedules.map((event) => ({
        ...event,
        // server_info is change-only. A fresh connected heartbeat with a synced
        // clock retains the confirmed calendar even when no event changed lately.
        stale: report.eventFeedConnected === false || !!report.eventClockStale,
        ...(event.id === 'witchcipher' ? {cipher: cipherView(event, statuses, report.server, now())} : {}),
        ...(event.id === 'trickortreat' ? {trickOrTreat: {characters: knockCounts(statuses, now())}} : {}),
      }))
    : [];
}

function knockCounts(statuses:Record<string,Report|null|undefined>, now:number):Record<string,TrickOrTreatCounts> {
  const observations=Object.entries(statuses).flatMap(([name,report])=>{
    const event=report?.eventSchedules?.find(entry=>entry.id==='trickortreat');
    const value=requestObject(event?.trickOrTreat);
    const offset=Number(event?.clockOffsetMs)||0;
    if(!report || value.day!==new Date(now+offset).toISOString().slice(0,10) || !Array.isArray(value.doors) ||
      !Number.isInteger(value.characterLimit) || Number(value.characterLimit)<=0 ||
      !Number.isInteger(value.accountLimit) || Number(value.accountLimit)<=0 ||
      !Number.isInteger(value.doorsLeft) || Number(value.doorsLeft)<0)return [];
    const characterLimit=Number(value.characterLimit),accountLimit=Number(value.accountLimit);
    const used=new Set(value.doors.filter(id=>Number.isInteger(id)&&id>=0&&id<characterLimit)).size;
    const unused=characterLimit-used;
    return [{name,report,day:String(value.day),characterLimit,accountLimit,used,unused,
      remaining:Math.min(unused,Number(value.doorsLeft)),
      account:typeof report.owner==='string'||typeof report.owner==='number'?String(report.owner):null}];
  });
  return Object.fromEntries(observations.filter(o=>fresh(o.report.seenAt,now,'presence',0,true)&&o.report.eventFeedConnected!==false&&!o.report.eventClockStale).map(o=>{
    const account=observations.filter(peer=>peer.day===o.day&&(o.account!==null?peer.account===o.account:peer.name===o.name));
    // The native feed omits the account's counter. Door histories prove a
    // minimum usage; a capped allowance can tighten the remaining upper bound.
    // Same-day older histories remain safe bounds because knocks only increase.
    let upper=Math.max(0,o.accountLimit-account.reduce((sum,peer)=>sum+peer.used,0));
    for(const peer of account)if(peer.remaining<peer.unused)upper=Math.min(upper,peer.remaining);
    return [o.name,{day:o.day,observedAt:o.report.seenAt,characterRemaining:Math.min(o.remaining,upper),characterLimit:o.characterLimit,
      accountRemainingUpperBound:upper,accountLimit:o.accountLimit}];
  }));
}

function cipherView(event: Schedule, statuses: Record<string,Report|null|undefined>, realm: string|undefined, now:number) {
  const view = event.cipher as {merchant?:string;runtime?:unknown} | undefined;
  if (!view) return view;
  const merchant = view.merchant && statuses[view.merchant];
  const observation = merchant && fresh(merchant.seenAt,now,'presence',0,true) && merchant.server===realm
    ? cipherEntry(merchant) as {runtime?:unknown}|undefined : undefined;
  return {...view,runtime:observation?.runtime};
}

// The occurrence as a member's report shows it. A report counts while fresh (`reports.fresh`
// `report`). The anniversary is live while the round's feed says so; another event is live while
// the member's feed lists it, or `due` while it is staged.
export interface OccurrenceReport {
  seenAt: number;
  anniversaryServer?: { live?: unknown } | null;
  serverLiveEvents?: { name?: string }[] | null;
  serverStagingEvents?: unknown;
  eventFeedConnected?: unknown;
  eventClockStale?: unknown;
  // The member's group's `due` leads, which the ingest writes for the reply (`createOccurrences`).
  eventLeads?: Record<string, number> | null;
}
export function occurrenceLive(report: OccurrenceReport | undefined, event: string | undefined, now: number): boolean {
  if (!report || !fresh(report.seenAt, now, 'report', 0, true)) return false;
  return event === 'anniversary' ? !!report.anniversaryServer?.live
    : !!report.serverLiveEvents?.some(entry => entry.name === event) || occurrenceDue(report, event, now);
}
// Whether a `staged` event is due: a current feed names its spawn inside the staging window
// of the member's group's lead.
export function occurrenceDue(report: OccurrenceReport, event: string | undefined, now: number): boolean {
  return eventIs(event, 'staged') && report.eventFeedConnected === true && report.eventClockStale !== true &&
    Array.isArray(report.serverStagingEvents) && report.serverStagingEvents.some((entry: unknown) =>
      !!entry && typeof entry === 'object' && 'name' in entry && entry.name === event &&
      'spawnAt' in entry && stagingWindow(entry.spawnAt, now, leadFor(report, event)));
}
// The staging window of a spawn: from the lead before it. The member's feed ends it: its staging
// report drops the spawn once the schedule names a later one (clock.ts `nextSpawn`, `missed`).
export function stagingWindow(spawnAt: unknown, now: number, lead: number): boolean {
  return typeof spawnAt === 'number' && Number.isFinite(spawnAt) && spawnAt - now <= lead;
}

// The scheduled walks: one record per group per event, from the walks a member's report names
// (character/clock.ts `walks`): each selected staged event's next spawn and destination, and the
// Cipher merchant's walk to the Witch by `gather_end`. The group's walk estimate times it. The lead
// is the planned walk plus one report interval (the member's measured `reportIntervalMs`), so the
// walk leaves one report early, and `due` holds from the spawn minus the lead. The estimate is asked
// when the occurrence is scheduled, and once more when `due` is one report interval away, from where
// the group then stands, else from the reporting member (`walks.estimate`). With no answer nothing is
// due before the spawn (`leadFor`).
// `spawnId` is the server's id for the spawn (events/character/clock.ts `walks`).
export interface ScheduledWalk { event: string; spawnAt: number; spawnId?: unknown; destination: { map: string; x: number; y: number; in?: string | number } }
// Whether a member's walk names the record's spawn. Each member's report clock moves `spawnAt` by its
// own clock offset, so two members name one spawn with spawnAt values apart by their offsets; the
// server's id decides when both carry it.
function sameSpawn(o: ScheduledWalk, walk: ScheduledWalk): boolean {
  return o.spawnId != null && walk.spawnId != null ? String(o.spawnId) === String(walk.spawnId) : o.spawnAt === walk.spawnAt;
}
// The fields of a member's report that the ingest's walk step reads. The raw report carries no
// `seenAt`: the intake stamps it on the stored status.
export interface WalkReport extends Pick<OccurrenceReport, 'serverLiveEvents' | 'eventFeedConnected' | 'eventClockStale'> { name?: string; server?: string; reportIntervalMs?: unknown; eventWalks?: ScheduledWalk[] | null }
export type OccurrencePhase = 'scheduled' | 'due' | 'live';
// `asking` is an estimate in flight; `refined` is the second ask, made once `due` is one report away.
// `unscheduled` is a record no walk named: an event with no staged walk (a join event such as Goo
// Brawl), or a spawn no member's walk named. It opens live, and its spawnAt is the report that
// listed it.
interface Occurrence extends ScheduledWalk { id: string; group: string; realm: string; phase: OccurrencePhase; walkMs?: number; asked: number; interval: number;
  member?: string; asking: boolean; refined: boolean; unscheduled?: boolean }
// `event.schedule(occurrence)`'s answer: the occurrence's spawn on the coordinator's
// clock, its planned walk and lead, its phase and whether game data gives the event a window.
export interface EventSchedule { event: string; occurrence: string; group: string; realm: string; spawnAt: number; walkMs?: number; leadMs: number;
  phase: OccurrencePhase; shortWindow: boolean }
export function createOccurrences(now: () => number) {
  const records = new Map<string, Occurrence>();
  const lead = (o: Occurrence) => o.walkMs === undefined ? leadFor(undefined, o.event) : o.walkMs + o.interval;
  const notify = (name: 'event.scheduled' | 'event.due' | 'event.started' | 'event.ended', payload: Record<string, unknown>) =>
    partyHooks().notify(name, { ...payload, by: 'core:events' });
  // A newer ask's answer replaces an older one's, and an answer for a replaced record is dropped. An
  // ask that fails or answers nothing leaves the record unanswered, and the next report asks again.
  function estimate(o: Occurrence): void {
    const asked = ++o.asked;
    o.asking = true;
    const settle = (ms: number | undefined) => {
      if (o.asked !== asked) return;
      o.asking = false;
      if (records.get(o.id) === o && ms !== undefined) o.walkMs = ms;
    };
    partyHooks().walks.estimate(o.group, o.destination, o.member).then(settle, () => settle(undefined));
  }
  function end(o: Occurrence, reason: 'ended' | 'missed'): void {
    records.delete(o.id);
    notify('event.ended', { occurrence: o.id, event: o.event, reason });
  }
  // The ingest's step for one member's report: its group's walks and their phases. It returns the
  // group's estimated leads, which the reply carries back (`eventLeads`).
  function observe(group: string, report: WalkReport): Record<string, number> {
    const at = now(), current = report.eventFeedConnected === true && report.eventClockStale !== true;
    for (const walk of current ? report.eventWalks ?? [] : []) {
      if (!walk || typeof walk.event !== 'string' || !Number.isFinite(walk.spawnAt) || !walk.destination?.map) continue;
      const id = occurrenceId(group, walk.event);
      let o = records.get(id);
      // A live occurrence stays until it ends; the next spawn's record starts at the first report after.
      if (o?.phase === 'live' && !sameSpawn(o, walk)) continue;
      if (!o || !sameSpawn(o, walk)) {
        if (o) end(o, 'missed');
        o = { ...walk, id, group, realm: String(report.server ?? ''), phase: 'scheduled', asked: 0, interval: 0, member: report.name, asking: false, refined: false };
        records.set(id, o);
        notify('event.scheduled', { event: o.event, occurrence: id, realm: o.realm, spawnAt: o.spawnAt });
        estimate(o);
      }
      o.destination = walk.destination;
      o.member = report.name;
      o.interval = Number(report.reportIntervalMs) > 0 ? Number(report.reportIntervalMs) : 0;
      if (o.walkMs === undefined) { if (!o.asking) estimate(o); }
      else if (!o.refined && at >= o.spawnAt - lead(o) - o.interval) { o.refined = true; estimate(o); }
      if (o.phase === 'scheduled' && at >= o.spawnAt - lead(o)) {
        o.phase = 'due';
        notify('event.due', { occurrence: id, event: o.event, group, leadMs: lead(o) });
      }
    }
    // An event with no staged walk is due and live at once: the first current report that lists a
    // known event live opens its record when no walk did.
    for (const entry of current ? report.serverLiveEvents ?? [] : []) {
      const event = entry?.name;
      if (typeof event !== 'string' || !eventKey(event) || records.has(occurrenceId(group, event))) continue;
      records.set(occurrenceId(group, event), { event, spawnAt: at, destination: { map: '', x: 0, y: 0 }, id: occurrenceId(group, event), group,
        realm: String(report.server ?? ''), phase: 'due', asked: 0, interval: 0, member: report.name, asking: false, refined: true, unscheduled: true });
    }
    for (const o of [...records.values()]) {
      if (o.group !== group) continue;
      const listed = !!report.serverLiveEvents?.some(entry => entry.name === o.event);
      if (o.phase !== 'live' && listed) { o.phase = 'live'; notify('event.started', { occurrence: o.id, event: o.event }); }
      else if (o.phase === 'live' && current && !listed) end(o, 'ended');
      // `missed`: the member that named the walk reports a current feed that no longer names
      // it; a later spawn of the event replaces the record above.
      else if (o.phase !== 'live' && current && report.name === o.member &&
        !report.eventWalks?.some(walk => walk?.event === o.event)) end(o, 'missed');
    }
    return Object.fromEntries([...records.values()].filter(o => o.group === group && o.walkMs !== undefined).map(o => [o.event, lead(o)]));
  }
  // The tasks owner's `group.changed` with no members: the group is gone, so no member reports
  // its occurrences again, and each record ends with `event.ended`.
  function groupGone(group: string): void {
    for (const o of [...records.values()]) if (o.group === group) end(o, 'ended');
  }
  // `event.schedule(occurrence)`: the group's occurrence of an event, or null.
  function schedule(id: string): EventSchedule | null {
    const o = records.get(id);
    return o && !o.unscheduled ? { event: o.event, occurrence: o.id, group: o.group, realm: o.realm, spawnAt: o.spawnAt, walkMs: o.walkMs, leadMs: lead(o),
      phase: o.phase, shortWindow: eventShortWindow(o.event, { events: gameEvents() ?? undefined }) } : null;
  }
  return { observe, schedule, groupGone };
}
// "In Main Town" (the return's Town row): a place inside the landing spread of Main's town transport,
// `G.maps.main.spawns[0]` and its scatter (server.js `transport_player_to`), the same reading the
// character's walk home takes. It sits in this leaf file because the attendance, return and route
// files all ask it. The coordinator starts after movement's load of the game data (application.ts
// awaits `prepareMovement`), so the landing is missing only when that load failed. MAIN_TOWN_RADIUS
// is the bound for that failure: Main within it of (0,0), v1.5.0's reading
// (runtime/coordinator/events/observations.ts:517), and each answer it gives reports.
const MAIN_TOWN_RADIUS = 90;
export function inMainTown(place: { map?: unknown; in?: unknown; x?: unknown; y?: unknown }): boolean {
  const goal = townLanding('main'), x = Number(place.x), y = Number(place.y);
  if (typeof place.map !== 'string' || !Number.isFinite(x) || !Number.isFinite(y)) return false;
  if (!goal) {
    boundFired({ bound: 'MAIN_TOWN_RADIUS', owner: '06', subject: 'main', state: { map: place.map, x, y } });
    return place.map === 'main' && Math.hypot(x, y) <= MAIN_TOWN_RADIUS;
  }
  return isSafeAt(goal, { map: place.map, in: place.in == null ? undefined : String(place.in), x, y });
}
