import { eventLimits, eventPolicy, supportedEvents, type EventFormation } from '../../../dashboard/lib/event-policy.ts';

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
  ignored?: 'death limit' | 'time limit';
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
  return entries.filter(entry => supportedEvents.includes(entry.name));
}

function instance(previous: AttendanceInstance | undefined, id: string | null, report: AttendanceReport, now: number): AttendanceInstance {
  if (sameInstance(previous, id, report.server ?? '')) {
    previous.ended = false;
    previous.id ||= id;
    previous.lastLiveAt = now;
    return previous;
  }
  return { id, realm: report.server ?? '', lastLiveAt: now, ended: false,
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
  if (wasParticipating && (newDeath || becameDead)) entry.deaths++;
  entry.lastDeathAt = Math.max(entry.lastDeathAt, deathAt);
  entry.dead = !!report.rip;
}
function applyLimits(entry: AttendanceInstance, limits: import('../../../dashboard/lib/event-policy.ts').EventLimits | undefined) {
  if (!limits || entry.ignored) return;
  if (limits.deathLimit != null && entry.deaths > limits.deathLimit) entry.ignored = 'death limit';
  else if (limits.timeLimitMinutes != null && entry.elapsedMs > limits.timeLimitMinutes * 60000) entry.ignored = 'time limit';
}
function retireMissing(records: Record<string, AttendanceInstance>, live: ReturnType<typeof liveEntries>, now: number) {
  for (const [event, entry] of Object.entries(records))
    if (!live.some(value => value.name === event) && now - entry.lastLiveAt >= 10000) {
      entry.ended = true; entry.attending = false;
    }
}
function recordAttendance(entry: AttendanceInstance, event: string, report: AttendanceReport, now: number) {
  const attending = event === 'anniversary' ? !!report.anniversaryState?.busy :
    (report.joinedEvent || report.mapEvent) === event;
  if (entry.attending) entry.elapsedMs += Math.max(0, now - entry.lastObservedAt);
  recordDeath(entry, event, report, attending);
  entry.attending = attending && !report.rip && !report.farmingNavigationDebug?.event;
  entry.lastObservedAt = now;
}

/** Limits exhaust an instance permanently; changing settings does not resurrect it. */
export function observeEventAttendance(state: AttendanceState, report: AttendanceReport, now: number): boolean {
  if (report.eventFeedConnected === false || report.eventClockStale === true) return false;
  const before = JSON.stringify(state.eventAttendance[report.name]);
  const records = state.eventAttendance[report.name] ??= {};
  const live = liveEntries(report);
  retireMissing(records, live, now);
  for (const value of live) {
    const entry = records[value.name] = instance(records[value.name], value.id, report, now);
    recordAttendance(entry, value.name, report, now);
    applyLimits(entry, eventLimits(state, report.name)[value.name]);
  }
  return before !== JSON.stringify(records);
}

export function eventInstanceAllowed(state: AttendanceState, name: string, event: string): boolean {
  const own = state.eventAttendance[name]?.[event];
  const leader = state.eventAttendance[eventPolicy(state, name).source]?.[event];
  return ![own, leader].some(entry => entry && !entry.ended && !!entry.ignored);
}
