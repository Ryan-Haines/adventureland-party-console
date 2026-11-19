// The one report freshness rule.
// A time is fresh when it is at most its reading's age old and no further ahead of
// `now` than the clock difference the console measured between the clock that stamped it and the
// reader's. Every reader on both runtimes asks here, naming its reading; the copy check
// (tools/copy-check.mjs) fails a report age compared anywhere else in the code this rule replaced.
import { wholeFrom } from '../settings/api.ts';
import type { MemberView } from '../hooks/registry.ts';

// Each reading's age is a setting with today's value as its default (R2F4, R2F5): `report` is a
// member's last report, `presence` counts a member online, `recent` counts it reported since an
// operation began, `errand-target` is the merchant's pursuit target, and `merchant-home` is the
// call budget's home check, declared in the call budget's saved fields
// (runtime/merchant-realm/coordinator/saved-fields.ts) with this default, so the protocol imports
// no 09 module. `realm-view` is the lifecycle owner's bound on a realm-control member whose slot
// reads online while its reports stopped (roster-projection.ts `observation`), at the earlier
// console's age for it; no owner declares it as a setting.
export const MERCHANT_HOME_REPORT_MS = 15000;
export const REALM_VIEW_REPORT_MS = 15000;
const AGE_SETTINGS = { report: 'reportFreshMs', presence: 'reportPresenceMs', recent: 'reportRecentMs',
  'errand-target': 'errandTargetReportMs', 'merchant-home': 'merchantHomeReportMs', 'realm-view': 'realmViewReportMs' } as const;
export type Reading = keyof typeof AGE_SETTINGS;
type AgeSetting = (typeof AGE_SETTINGS)[Reading];
// The defaults of the four ages movement declares; its saved fields (runtime/movement/saved-fields.ts)
// take them from here, so the protocol imports no movement module.
export const REPORT_AGE_DEFAULTS = { reportFreshMs: 3000, reportPresenceMs: 10000, reportRecentMs: 5000, errandTargetReportMs: 15000 };
// Movement's saved fields and the held block declare every age with this check, a whole number from 1 ms.
const ageCheck = wholeFrom(1, Infinity);
const ages: Record<AgeSetting, number> = { ...REPORT_AGE_DEFAULTS, merchantHomeReportMs: MERCHANT_HOME_REPORT_MS,
  realmViewReportMs: REALM_VIEW_REPORT_MS };

// A walking member's report stays fresh for two of its own report intervals while
// no attacker is known on it; with an attacker known, or before its first interval is known, the
// `report` age applies. The reader passes its own attacker test, as each did before.
export interface WalkReading { reading: 'walk'; attackerKnown: boolean; intervalMs: unknown }

// Whether that rule widens the walk reading to two intervals; a reader that checks more while the
// `report` age applies (an attacker observation) asks this.
export function widens(reader: WalkReading): boolean {
  return !reader.attackerKnown && Number(reader.intervalMs) > 0;
}
// The age a reading allows; a signal the coordinator sends carries it as its validity.
export function ageOf(reader: Reading | WalkReading): number {
  if (typeof reader === 'string') return ages[AGE_SETTINGS[reader]];
  return widens(reader) ? 2 * Number(reader.intervalMs) : ages.reportFreshMs;
}

// `aheadMs` is the measured clock difference of the clock that stamped `at` (`reportClockError` for a
// member's own stamps); the reader's own clock difference (`setClockError`) is added to it. A reader
// whose site counted a time exactly at the age as stale passes `under`, so its answer stays today's
// (no reader's answer changes).
export function fresh(at: unknown, now: number, reader: Reading | WalkReading = 'report', aheadMs = 0, under = false): boolean {
  const t = typeof at === 'number' ? at : NaN, age = now - t, limit = ageOf(reader);
  return (under ? age < limit : age <= limit) && notAhead(t, now, aheadMs);
}
// The rule's ahead half alone: `at` is no further ahead of `now` than the measured clock
// differences allow, for a reader whose age is its own.
export function notAhead(at: number, now: number, aheadMs = 0): boolean {
  return at <= now + ownError + aheadMs;
}

// The settings owner's values for the ages, from the coordinator's state at the movement install
// and on each `settings.changed`, or from the character's reply. A value the declaration's check
// refuses leaves the age as it was.
export function setReadings(values: Partial<Record<string, unknown>>): void {
  for (const name of Object.values(AGE_SETTINGS))
    if (name in values && ageCheck(values[name])) ages[name] = values[name] as number;
}

// The clock difference the console measures. A character sets its clock from the coordinator's
// reply with the least network time (characters/shared.js `acceptTravelResponse`), so its stamps
// are off by at most half that network time; its report carries the sync as
// `travelSample.transport.clock`. A coordinator stamp (`seenAt`) is the coordinator's own receive
// time, never ahead, so its readers pass no difference. With no sync measured there is none. The
// coordinator's own clock is the reference, so its difference stays 0; a character sets its own at
// each clock sync, because a coordinator stamp it reads may look ahead by that much.
let ownError = 0;
export function setClockError(transport: { clock?: { networkMs?: unknown } } | null | undefined): void { ownError = clockError(transport); }
// This runtime's own measured clock difference, for a reader that counts down to a coordinator time.
export function ownClockError(): number { return ownError; }
export function clockError(transport: { clock?: { networkMs?: unknown } } | null | undefined): number {
  const network = Number(transport?.clock?.networkMs);
  return network > 0 ? network / 2 : 0;
}

// The clock difference of a member's own stamps (`at`, `observedAt`, `*AttackersAt`), from the clock
// sync its report carries, for a reader on the coordinator.
export function reportClockError(status: unknown): number {
  return clockError((status as { travelSample?: { transport?: { clock?: { networkMs?: unknown } } } } | undefined)?.travelSample?.transport);
}
// The walk protocol a member's report names (`convoyProtocol`): the walk client writes it, and a
// Hunt return waits for every participant to report it (hunting/coordinator/hunt.ts). the
// earlier console wrote 4.
export const WALK_PROTOCOL = 4;
// Whether a member's report speaks WALK_PROTOCOL, which a Hunt return and its resume wait for.
export const speaksWalkProtocol = (status: { convoyProtocol?: unknown } | null | undefined): boolean =>
  status?.convoyProtocol === WALK_PROTOCOL;
// The grouped queue's protocol version: a member reports it on `groupedCombat` and the
// coordinator's group carries it. A group of another version is not a current queue to either
// runtime, and every owner asks currentQueue. v1.5.0 tested 4.
export const QUEUE_PROTOCOL = 4;
export const currentQueue = <T extends { protocol?: unknown }>(group: T | null | undefined): group is T => group?.protocol === QUEUE_PROTOCOL;
// A saved queue the coordinator restores from: the version before QUEUE_PROTOCOL still restores, as
// v1.5.0 accepted 3 and 4.
export const restorableQueue = <T extends { protocol?: unknown }>(group: T | null | undefined): group is T =>
  group?.protocol === QUEUE_PROTOCOL || group?.protocol === QUEUE_PROTOCOL - 1;
// One report interval of a member: the gap between its last two reports that each report carries
// (`reportIntervalMs`), never below the status timer's 1 s, which also stands in before the interval is
// measured.
export const STATUS_TIMER_MS = 1000;
// A game reach less the distance a member moves within its report's age at its reported speed, so a
// member inside it on its report stands inside the game's reach on the server (the rework pass's
// "reach less drift").
export function reachLessDrift(reach: number, speed: unknown, ageMs: number): number {
  return reach - (Number(speed) > 0 ? Number(speed) : 0) * Math.max(0, ageMs) / 1000;
}
// The area the server sends a character its entities from (node/server.js:222 `B.vision`, width and
// height around the character): a member's report lists what stands inside half of each around it,
// and a point inside half of each around another point is seen from there. The events owner's
// sighting walk and the hunting owner's rare sightings, patrol and farm area read it.
export const GAME_VISION = [700, 500] as const;
// How far another entity moves before the server sends its new place (node/server.js:220
// `B.u_boundary`): its place on the client is off by at most this much. The events owner's sends
// and the hunting owner's field generator read it.
export const GAME_POSITION_STEP = 70;
// The server's send reach (node/server.js:224 `B.dist`, checked at:8454 with the same map):
// another character this close on the client, less GAME_POSITION_STEP, stands inside it on the
// server. The events owner's sends and the items owner's handoff wait read it.
export const SEND_REACH = 400 - GAME_POSITION_STEP;
export const inView = (viewer: { x: number; y: number }, point: { x: number; y: number }): boolean =>
  Math.abs(point.x - viewer.x) <= GAME_VISION[0] / 2 && Math.abs(point.y - viewer.y) <= GAME_VISION[1] / 2;
export const reportInterval = (status: { reportIntervalMs?: unknown } | null | undefined): number =>
  Math.max(STATUS_TIMER_MS, Number(status?.reportIntervalMs) || 0);

// One member's view from its last report, which `targeting.aggroOwner`
// on the character and `group.anchor` on the coordinator hand an add-on. A member with no report
// yet has its name and class only.
export function memberView(name: string, ctype: string | undefined, report: Partial<Omit<MemberView, 'name' | 'ctype'>> | null | undefined): MemberView {
  const { hp, max_hp, mp, max_mp, rip, map, in: instance, x, y, addonReports } = report ?? {};
  return { name, ctype, hp, max_hp, mp, max_mp, rip, map, in: instance, x, y, addonReports };
}
