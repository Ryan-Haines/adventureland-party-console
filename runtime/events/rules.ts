// The events owner's rules: the event catalog, the
// selection and the limits, shared with the dashboard and bundled into the coordinator through
// runtime/events/api.ts. Moved from dashboard/lib/event-policy.ts.
import { validMix } from './october.ts';
// A decision reads the player's setting through `played`, so an add-on's overlay plays.
import { played } from '../settings/api.ts';
import type { CipherSettings } from './october.ts';

export interface EventLimits {
  deathLimit: number | null;
  timeLimitMinutes: number | null;
  monsters?: string[];
  cipher?: CipherSettings;
  // How a boss approach treats adds. `straight`,
  // the default, closes on the boss and adds never stop it; `fight-adds` takes the full step
  // check, so the party fights the adds on its way and gets credit for them.
  bossApproach?: 'straight' | 'fight-adds';
}
// EVENT_KINDS, the event kinds: one row per core event, in the catalog order the
// priority lists append. Every literal event list of the console reads a column here (the
// copy check fails a list of event names outside this file). The columns:
// - `kind`: `join` sends the game's join when its `G.events` entry has one (the character checks
//   the entry), `walk` travels through ordinary maps, `interaction` is the October runtime's
//   activity, `anniversary` the anniversary round.
// - `staged`: the schedule names its spawn ahead, so the party walks before it is live (the schedule's `due` lead).
// - `assisted`: a member that fights the boss attends without a join.
// - `boss`: the party approaches a boss, so the boss approach setting applies; it is the
//   static half of `targets`, whose game-data half the character derives from `G.monsters`.
// - `return`: the return's own row for the event: `goobrawl-wait`, `franky-exit` or
//   `abtesting-clear`.
// - `merchant`: the merchant attends when the leader picked it.
// - `priority`: a joined member takes the event's target before any other pick (the targeting owner's selection
//   `getPriorityEventTarget`); b9b5c91e shared.js:17972 named Mr. Green, Mr. Pumpkin and the Horseman.
// - `prize`: the round's end puts a prize in each player's bag, and the server skips a full bag on a
//   branch that can stop before it destroys the instance (server_functions.js:2909-2913), so a
//   character joins only with a free cell (1.5 row 4a).
// - `added`: the catalog the event joined in. An older all-events flag selects the `legacy` rows,
//   and a client built before the October events sends a priority list without the `october` rows.
// - `targets`: the static half of the event's monsters (EVT-001; the game-data half reads `G`
//   through `eventTargetTypes`): `first`, types fought ahead of the boss's own (Goo Brawl's goos
//   before the Rainbow Goo); `only`, the whole list in place of the boss's (the Graveyard's three,
//   the Horseman and its walkers); `spawnAdds`, the boss's `hp:` spawns in `G.monsters` join it.
// - `point`: the fixed destination of a walk row: a row with no boss walks to it
//   ahead of the feed, a boss row only when the feed names no position. b9b5c91e's points; the
// server's join handler names others (server.js:12673-12681), which would change the feature.
// - `targets.players`: the event's fight is against players (A/B Testing), not monsters.
// - `targets.attackers`: the boss's timed spawns, which the server creates beside a player while the
//   boss has a target (server.js:14407-14440; Franky's `nerfedmummy` every 200 ms), are fought
// while they target this character.
// - `targets.reserved`: the event's boss that farming never pulls outside the event, unless it attacks
//   the party (docs/testing-october-events.md; the Horseman and the Graveyard's `gargoyle`, b9b5c91e's
//   boss pair).
// - `targets.area`: the event's map is an event area of its own: on it the event's monsters are the
//   targets, attended or not, and no claim keeps them from the party (Goo Brawl; b9b5c91e's
//   `character.map === "goobrawl"`).
// - `view`: an interaction row's own report (character/clock.ts): `doors`, Trick or Treat's doors,
//   whose occurrence is the server's day and which is live in the Halloween season; `cipher`, the
//   Witch's Cipher board and gathering plan.
// - `lastSeen`: the feed's position is the boss's last-seen point, not its spawn, so a walk that ends
//   there with no boss in view goes on once to the boss's catalog spawn (1.5 row 5; b424e1f2
//   `eventDestination`, Mr. Green and Mr. Pumpkin).
// - `search`: the maps the search walks in one pass for a boss with no fixed spot. Slenderman
//   spawns and warps on Cave, Halloween or Spookytown (server_functions.js:2107, 2491), so the
//   search covers all three.
export type EventKindName = 'join' | 'walk' | 'interaction' | 'anniversary';
export interface EventTargets { first?: readonly string[]; only?: readonly string[]; spawnAdds?: boolean; players?: boolean; attackers?: boolean;
  reserved?: string; area?: boolean }
export interface EventKind {
  name: string;
  label: string;
  kind: EventKindName;
  staged: boolean;
  assisted: boolean;
  boss: boolean;
  return: 'goobrawl-wait' | 'franky-exit' | 'abtesting-clear' | null;
  merchant: boolean;
  priority?: boolean;
  prize?: boolean;
  added: 'legacy' | 'halloween' | 'october' | 'addon';
  targets: EventTargets;
  view?: 'doors' | 'cipher';
  search?: readonly string[];
  lastSeen?: boolean;
  // A member walking to it alone, outside its group's walk, stops once the occurrence ends
  // (walk-client.ts `sharedPartyWalk`, b9b5c91e's Halloween and October lone walks).
  aloneUntilOver?: boolean;
  point?: { readonly map: string; readonly x: number; readonly y: number };
  // An add-on row's own columns (`event.kind`): the map it attends on, when no `G.maps`
  // entry names the event, and the rungs that leave it.
  map?: string;
  exit?: readonly ExitRung[];
}
// An add-on's `event.kind` answer: an EVENT_KINDS row for a new event name. Only the two kinds
// with no runtime of their own are open to it: a `join` row sends the game's join, a `walk` row
// walks to its point or its boss. Its attendance ranks `event-attendance` through the tasks owner's event
// source like every EVENT_KINDS row, so the answer names no tier.
export type EventKindAnswer = Pick<EventKind, 'name' | 'label'> & { kind: 'join' | 'walk' } &
  Partial<Pick<EventKind, 'staged' | 'assisted' | 'boss' | 'targets' | 'point' | 'map' | 'exit'>>;
const row = (name: string, label: string, kind: EventKindName, added: EventKind['added'], columns: Partial<EventKind> = {}): EventKind =>
  ({ name, label, kind, staged: false, assisted: false, boss: false, return: null, merchant: false, added, targets: {}, ...columns });
const EVENT_KINDS: readonly EventKind[] = [
  row('anniversary', 'Anniversary', 'anniversary', 'legacy'),
  row('abtesting', 'A/B Testing', 'join', 'legacy', { boss: true, return: 'abtesting-clear', prize: true, targets: { players: true } }),
  row('goobrawl', 'Goobrawl', 'join', 'legacy', { return: 'goobrawl-wait', targets: { first: ['rgoo', 'bgoo', 'goo'], area: true } }),
  row('crabxx', 'Crabxx', 'join', 'legacy', { boss: true }),
  row('franky', 'Franky', 'join', 'legacy', { boss: true, return: 'franky-exit', targets: { attackers: true } }),
  row('icegolem', 'Ice Golem', 'join', 'legacy', { boss: true }),
  row('snowman', 'Snowman', 'join', 'legacy', { boss: true }),
  row('slenderman', 'Slenderman', 'walk', 'halloween', { boss: true, assisted: true, search: ['halloween', 'spookytown', 'cave'], aloneUntilOver: true }),
  row('mrgreen', 'Mr. Green', 'walk', 'halloween', { boss: true, staged: true, assisted: true, lastSeen: true, priority: true, targets: { spawnAdds: true } }),
  row('mrpumpkin', 'Mr. Pumpkin', 'walk', 'halloween', { boss: true, staged: true, assisted: true, lastSeen: true, priority: true, targets: { spawnAdds: true } }),
  row('horseman', 'Headless Horseman', 'walk', 'october', { boss: true, staged: true, priority: true, targets: { only: ['jackowalker', 'horseman'], reserved: 'horseman' }, point: { map: 'halloween', x: -405, y: -1640 } }),
  row('graveyard', 'Graveyard Rising', 'walk', 'october', { staged: true, targets: { only: ['zombie', 'ghoul', 'gargoyle'], reserved: 'gargoyle' }, point: { map: 'spookytown', x: 255, y: -1425 } }),
  row('trickortreat', 'Trick or Treat', 'interaction', 'october', { view: 'doors', aloneUntilOver: true }),
  row('witchcipher', "Witch's Cipher", 'interaction', 'october', { merchant: true, view: 'cipher', aloneUntilOver: true }),
];
const KINDS_BY_NAME = new Map(EVENT_KINDS.map(entry => [entry.name, entry]));
// The enabled add-ons' rows, after the core rows. Each realm's events install adopts them at load
// and on every add-on switch (`adoptAddonKinds`), so the coordinator and the character read the
// same table.
let addonKinds: readonly EventKind[] = [];
/** `events.kinds()`: the kinds table's rows in catalog order, then the add-on rows in load order. */
export function eventKinds(): readonly EventKind[] { return addonKinds.length ? [...EVENT_KINDS, ...addonKinds] : EVENT_KINDS; }
/** `events.key(value)`: the kinds row a request's event id names, or null. */
export function eventKey(value: unknown): EventKind | null {
  return typeof value === 'string' ? KINDS_BY_NAME.get(value) ?? addonKinds.find(entry => entry.name === value) ?? null : null;
}
const EXIT_RUNGS: readonly ExitRung[] = ['transporter', 'leave', 'transport', 'town', 'reconnect'];
/** Why an add-on's `event.kind` answer is refused, or undefined. A core name is refused,
 * and so is a name an earlier add-on took (`taken`) or a row the kinds readers cannot read. */
export function addonKindProblem(answer: unknown, taken: ReadonlySet<string>): string | undefined {
  const row = answer as Partial<EventKindAnswer> | null;
  if (!row || typeof row.name !== 'string' || !row.name) return 'an event kind names no event';
  if (KINDS_BY_NAME.has(row.name)) return `the event kind "${row.name}" is a core event`;
  if (taken.has(row.name)) return `another add-on already answers the event kind "${row.name}"`;
  if (typeof row.label !== 'string' || !row.label) return `the event kind "${row.name}" has no label`;
  if (row.kind !== 'join' && row.kind !== 'walk') return `the event kind "${row.name}" is neither a join nor a walk`;
  if (row.exit !== undefined && (!Array.isArray(row.exit) || row.exit.some(rung => !EXIT_RUNGS.includes(rung))))
    return `the event kind "${row.name}" names an exit rung the exit does not have`;
  return undefined;
}
/** The add-on rows the registry's `event.kind` dispatch answered, each already checked. */
export function adoptAddonKinds(answers: readonly EventKindAnswer[]): void {
  addonKinds = answers.map(answer => row(answer.name, answer.label, answer.kind, 'addon', {
    staged: !!answer.staged, assisted: !!answer.assisted, boss: !!answer.boss, targets: { ...answer.targets },
    ...(answer.point ? { point: answer.point } : {}), ...(answer.map ? { map: answer.map } : {}), ...(answer.exit ? { exit: answer.exit } : {}) }));
}
// The `event-list` slot's data: each member's occurrence that has not ended, with its
// attendance state and whether the rejoin route takes it back. Only a player's move off the map (`left`) is
// rejoinable; a death or time limit and a refusal are not. 12 draws it from the
// `eventAttendance` record the dashboard receives.
export interface EventListRow { member: string; event: string; label: string;
  state: 'waiting' | 'attending' | 'left' | 'limit' | 'refused'; reason: string | null; rejoin: boolean }
type AttendanceRecords = Readonly<Record<string, Readonly<Record<string, Pick<import('./coordinator/attendance.ts').AttendanceInstance, 'ended' | 'ignored' | 'attending'>>> | undefined>>;
export function eventListRows(attendance: AttendanceRecords | null | undefined): EventListRow[] {
  return Object.entries(attendance ?? {}).flatMap(([member, records]) => Object.entries(records ?? {}).filter(([, entry]) => !entry.ended).map(([event, entry]) => {
    const reason = entry.ignored ?? null;
    const state: EventListRow['state'] = reason === 'manual travel' ? 'left' : reason === 'death limit' || reason === 'time limit' ? 'limit'
      : reason ? 'refused' : entry.attending ? 'attending' : 'waiting';
    return { member, event, label: eventKey(event)?.label ?? event, state, reason, rejoin: state === 'left' };
  }));
}
/** Whether the event's kinds row holds the column; an unknown name holds none. */
/** `targets.area`: the event's own map is an event area (Goo Brawl). */
export function eventArea(name: unknown): boolean { return !!eventKey(name)?.targets.area; }
/** `search`: a searched boss whose search pass the member's report says has ended. */
export function searchExhausted(name: unknown, report: { slendermanSearchExhausted?: unknown } | null | undefined): boolean {
  return !!eventKey(name)?.search && !!report?.slendermanSearchExhausted;
}
export function eventIs(name: unknown, column: 'staged' | 'assisted' | 'boss' | 'merchant' | 'prize' | 'aloneUntilOver'): boolean { return !!eventKey(name)?.[column]; }

// JOIN_REPLIES, the join replies (game data, server.js:12641-12711). A `final` reply
// cannot change during the occurrence, and the character marks the occurrence refused:
// - `cant_join`: the server's flag for the event is off realm-wide (12709, cleared with `S`), so
//   the coordinator refuses the occurrence for every member on that realm (`refuses: 'realm'`);
// - `join_too_late`: A/B Testing past its first 120 s for a character not in the round
//   (12682-12687), which a member that attended passes, so the coordinator refuses it only for the
//   members whose record never attended (`refuses: 'unattended'`).
// `cant_when_sick` is tried again when the hop sickness ends (5616, 12649-12650), and `cant_in_bank`
// on the character's first report from a map that is not a bank (`G.maps[map].mount`).
// `no_merchants` means a merchant sent a join, which the merchant rows never do, so the character
// logs it. Any other reply is tried again at the next poll.
export interface JoinReply { final: boolean; refuses?: 'realm' | 'unattended'; retry?: 'sick' | 'bank'; bug?: boolean }
const JOIN_REPLIES: Readonly<Record<string, JoinReply>> = {
  cant_join: { final: true, refuses: 'realm' },
  join_too_late: { final: true, refuses: 'unattended' },
  cant_when_sick: { final: false, retry: 'sick' },
  cant_in_bank: { final: false, retry: 'bank' },
  no_merchants: { final: false, bug: true },
};
/** The JOIN_REPLIES row for a join reply; a reply the server does not send is tried again. */
export function joinReply(reply: unknown): JoinReply {
  return typeof reply === 'string' && JOIN_REPLIES[reply] || { final: false };
}

// EVENT_EXITS: the rungs that leave an event map,
// keyed by the map's own `G.maps[map].event`, which names `pirateship` for ship0, an event with no
// kinds row. `transporter` walks to the map's Transporter and asks it for Main, `leave` asks the
// instance's own exit, and `transport` asks the Transporter for Main from where the character
// stands (b9b5c91e's fallback when `leave` does not move it). `town` is the way to Main's Town from
// anywhere: a Town on an event map lands on that map's spawn, a Town on Main lands in Main, and any
// other map walks to Main first. A/B Testing's last rung `reconnect` logs in again on the same realm
//. The round's progress rule decides when a rung failed, so no rung has a count.
export type ExitRung = 'transporter' | 'leave' | 'transport' | 'town' | 'reconnect';
const EVENT_EXITS: Readonly<Record<string, readonly ExitRung[]>> = {
  goobrawl: ['transporter', 'town'],
  abtesting: ['leave', 'transport', 'town', 'reconnect'],
  pirateship: ['leave', 'transport', 'town'],
};
/** The exit rungs for an event map's `event`; an event map with no row has no verified exit. */
export function eventExit(mapEvent: unknown): readonly ExitRung[] | null {
  return typeof mapEvent === 'string' ? EVENT_EXITS[mapEvent] ?? eventKey(mapEvent)?.exit ?? null : null;
}

// The kinds table's game-data reads on the character, each with the client's `G`.
export interface EventGame {
  events?: Record<string, { join?: unknown; sprite?: unknown; duration?: unknown } | undefined>;
  monsters?: Record<string, { spawns?: unknown[]; speed?: unknown } | undefined>;
  maps?: Record<string, { event?: unknown; spawns?: unknown[][] } | undefined>;
}
/** Every `G.events` key, then the kinds rows the game data does not list. */
export function eventNames(game: EventGame): string[] {
  const names = Object.keys(game.events ?? {});
  return [...names, ...eventKinds().map(entry => entry.name).filter(name => !names.includes(name))];
}
/** A `join` row sends the game's join when its `G.events` entry has one; the others travel. */
export function eventJoins(name: string, game: EventGame): boolean {
  return eventKey(name)?.kind === 'join' && !!game.events?.[name]?.join;
}
/** Every kinds row but the anniversary, which has its own round, is attended by join or travel. */
export function eventSupported(name: string): boolean {
  const kind = eventKey(name)?.kind;
  return !!kind && kind !== 'anniversary';
}
/** The walk bosses: the feed lists them live only while the character's clock is synced, and their
 * attendance is the character's own staging and sighting (a `walk` row with `boss`). */
export function eventWalkBoss(name: string): boolean {
  const entry = eventKey(name);
  return entry?.kind === 'walk' && entry.boss;
}
/** An add-on row's own map, else the game map whose `event` names the event, else the event's own name. */
export function eventMap(name: string, game: EventGame): string {
  const own = eventKey(name)?.map;
  if (own) return own;
  return Object.keys(game.maps ?? {}).find(map => game.maps?.[map]?.event === name) ?? name;
}
/** The `targets` column with its game-data half: the event's sprite and name, the static column, and a boss's
 * `hp:` spawn adds, each a monster `G.monsters` knows, once. */
export function eventTargetTypes(name: string, game: EventGame): string[] {
  const targets = eventKey(name)?.targets ?? {}, sprite = game.events?.[name]?.sprite;
  const candidates: unknown[] = targets.only ? [...targets.only] : [...(targets.first ?? []), ...(sprite ? [sprite] : []), name];
  if (targets.spawnAdds) for (const spawn of game.monsters?.[name]?.spawns ?? [])
    if (Array.isArray(spawn) && typeof spawn[0] === 'string' && spawn[0].startsWith('hp:')) candidates.push(spawn[1]);
  return candidates.filter((type, index): type is string => typeof type === 'string' && !!game.monsters?.[type] && candidates.indexOf(type) === index);
}

/** The `targets.attackers` column with its game-data half: the boss's timed spawns in `G.monsters`, which
 * `event.targets()` names beside the boss and the targeting owner's Franky row fights while they target this
 * character. A row without the column names none. */
export function eventAttackers(name: string, game: EventGame): string[] {
  if (!eventKey(name)?.targets.attackers) return [];
  const types = (game.monsters?.[name]?.spawns ?? []).filter((spawn): spawn is unknown[] => Array.isArray(spawn) && typeof spawn[0] === 'number')
    .map(spawn => spawn[1]);
  return types.filter((type, index): type is string => typeof type === 'string' && !!game.monsters?.[type] && types.indexOf(type) === index);
}

/** `targets.reserved`: the event whose reserved boss the monster type is, or null. */
export function eventReservedBy(type: unknown): string | null {
  return eventKinds().find(entry => entry.targets.reserved === type)?.name ?? null;
}
/** The `targets.area` column with its game-data half: each area event's map, keyed by the map. */
export function eventAreas(game: EventGame): Map<string, string> {
  return new Map(eventKinds().filter(entry => entry.targets.area).map(entry => [eventMap(entry.name, game), entry.name]));
}

// The schedule's `due` lead a member's group has for `event`, which the reply carries (`eventLeads`): the walk
// estimate's lead. With no estimate yet the lead is 0, so nothing is due before the spawn until a
// member's reported position gives `walks.estimate` a route. The coordinator's staging
// admission and the character's staging and Cipher walk read it.
export function leadFor(leads: { eventLeads?: Record<string, number> | null } | undefined, event: string | undefined): number {
  const lead = event ? leads?.eventLeads?.[event] : undefined;
  return typeof lead === 'number' && Number.isFinite(lead) ? lead : 0;
}
// The occurrence id: one occurrence per group per event, which `event.schedule` is asked by.
export const occurrenceId = (group: string, event: string) => `${group}|${event}`;
/** `shortWindow`: the game runs the event for a fixed `duration` (seconds;
 * server_functions.js:2620, 2920 set its timers from it). Read on the coordinator by movement's
 * walk facts and the tasks owner's wind-down. */
export function eventShortWindow(name: string, game: EventGame): boolean {
  return Number(game.events?.[name]?.duration) > 0;
}
/** A walk follows an event boss that moves, a `boss` row whose boss has a `speed`
 * above 0 in `G.monsters` (every event boss at game version 17175). Without game data no boss moves. */
export function eventBossMoves(name: string, game: EventGame): boolean {
  return eventIs(name, 'boss') && Number(game.monsters?.[name]?.speed) > 0;
}

// How long a return's pending member may go without a report before the return defers it. A
// restarted coordinator holds no reports until each member reports again, so a return younger
// than this defers nobody for a missing one.
export const STALE_MEMBER_GRACE_MS = 30_000;
// The anniversary round's game data (logic/anniversary_event.js): each 30 minute round opens a
// 5 minute visit window (lines 13-14), and a kiss gives one of these six slices (G.items).
export const ANNIVERSARY_WINDOW_MS = 5 * 60 * 1000;
// The anniversary's round id (logic/anniversary_event.js:13, 123-135): each 30 minute slot of server
// time is one round, and `round.id` is the slot's number. The live feed names it. The scheduled
// feed's `next` is the next slot's start, so its round is `next` over the interval.
export const ANNIVERSARY_INTERVAL_MS = 30 * 60 * 1000;
export function anniversaryRoundId(feed: { round?: unknown; next?: unknown }): string | null {
  if (feed.round != null && feed.round !== '') return String(feed.round);
  const next = Number(feed.next);
  return Number.isFinite(next) && next > 0 ? String(Math.round(next / ANNIVERSARY_INTERVAL_MS)) : null;
}
// The order of two anniversary round ids: below 0 when `a` is the earlier round, 0 for the same one,
// above 0 for a later one. The game's round ids are slot numbers that grow; any other id the
// character sends (character/anniversary.ts `roundId`, from the ticket or the target, map and
// expiry) orders only against itself, so two different ones answer null.
export function roundOrder(a: unknown, b: unknown): number | null {
  if (String(a) === String(b)) return 0;
  const x = Number(a), y = Number(b);
  return Number.isFinite(x) && Number.isFinite(y) ? x - y : null;
}
/// The merchant's jobs yield while any part of the anniversary round holds it (the merchant jobs owner's
// merchantAnniversaryControl answer), on the coordinator and on the merchant's own client.
export function merchantAnniversaryReserved(control: { featured?: unknown; reserved?: unknown; kissDue?: unknown; busy?: unknown }): boolean {
  return !!(control.featured || control.reserved || control.kissDue || control.busy);
}
// The anniversary state before any round: the saved field's default (saved-fields.ts) and the
// coordinator's restore (coordinator/anniversary.ts `initialAnniversaryState`) both start from it,
// so the declaration file loads no coordinator module.
export function anniversaryDefaults() {
  const activity: never[] = [];
  return { nativeSlice: null, rounds: {}, advertisedRounds: {}, reciprocal: {}, pendingReturns: {}, activity, crafted: 0, abortedRounds: {}, attempts: {} };
}
// The Witch's Cipher's game data (G.events.witchcipher, game data 18285): `gathering` is 1200
// seconds, so the gathering window is 20 minutes, and `mixes` caps each account at five brews per
// UTC day. The legacy gatherMinutes setting accepts no more than the window.
export const CIPHER_GATHERING_MINUTES = 20;
export const CIPHER_DAILY_MIXES = 5;
export const anniversarySlices: readonly string[] = ["slice_strawberry", "slice_citrus", "slice_honey", "slice_mint", "slice_blueberry", "slice_nightberry"];

// The events with a boss the party approaches, where the boss approach setting applies.
export const bossEvents = EVENT_KINDS.filter(entry => entry.boss).map(entry => entry.name);
export function validEventLimits(value: unknown): value is EventLimits {
  if (!value || typeof value !== "object") return false;
  const { deathLimit, timeLimitMinutes, monsters, cipher, bossApproach } = value as EventLimits;
  if (bossApproach !== undefined && bossApproach !== 'straight' && bossApproach !== 'fight-adds') return false;
  if (monsters !== undefined && (!Array.isArray(monsters) || new Set(monsters).size !== monsters.length || monsters.some(id => !eventKey('graveyard')?.targets.only?.includes(id)))) return false;
  if (cipher !== undefined && (!cipher || typeof cipher.automatic !== 'boolean' ||
    cipher.gatherMinutes !== undefined && (!Number.isFinite(cipher.gatherMinutes) || cipher.gatherMinutes < 0 || cipher.gatherMinutes > CIPHER_GATHERING_MINUTES) ||
    !Number.isSafeInteger(cipher.minClues) || cipher.minClues < 0 || cipher.minClues > 1024 ||
    cipher.gatherMonsters !== undefined && (!Array.isArray(cipher.gatherMonsters) || cipher.gatherMonsters.length !== 4 || cipher.gatherMonsters.some(id => typeof id !== 'string' || !id)) ||
    cipher.manual !== undefined && (!cipher.manual || typeof cipher.manual.id !== 'string' || !cipher.manual.id || typeof cipher.manual.round !== 'string' || !cipher.manual.round || !Number.isSafeInteger(cipher.manual.cracks) || cipher.manual.cracks < 0 || !validMix(cipher.manual.mix)))) return false;
  return (deathLimit === null || Number.isSafeInteger(deathLimit) && deathLimit >= 0) &&
    (timeLimitMinutes === null || typeof timeLimitMinutes === "number" && Number.isFinite(timeLimitMinutes) && timeLimitMinutes > 0);
}
export interface EventFormation {
  leader?: string | null;
  merchantCharacter?: string | null;
  followers?: Record<string, boolean>;
  eventsByCharacter?: Record<string, boolean>;
  eventLimitsByCharacter?: Record<string, Record<string, EventLimits>>;
  eventPrioritiesByCharacter?: Record<string, string[]>;
  eventSelectionsByCharacter?: Record<string, string[]>;
}

// Persisted legacy all-events flags cover the catalog available when saved (`added`).
// Newly supported fights need an explicit selection and are not opted in on upgrade.
const legacyDefaultEvents = EVENT_KINDS.filter(entry => entry.added === 'legacy').map(entry => entry.name);
// A client built before the October events sends a priority list without them.
export const octoberEvents = EVENT_KINDS.filter(entry => entry.added === 'october').map(entry => entry.name);
export const supportedEvents = EVENT_KINDS.map(entry => entry.name);
export const eventDisplayNames: Record<string, string> = Object.fromEntries(EVENT_KINDS.map(entry => [entry.name, entry.label]));
/** The selection the load migration gives an older all-events flag: every event but the anniversary
 * and the Halloween fights, which were added after the flag and need an explicit selection. */
export function legacyFlagEvents(): string[] {
  return EVENT_KINDS.filter(entry => entry.name !== 'anniversary' && entry.added !== 'halloween').map(entry => entry.name);
}

// The events the merchant attends because the leader picked them, with the leader's limits.
function merchantEvents(party: EventFormation, name: string): string[] {
  if (name !== party.merchantCharacter || !party.leader) return [];
  return EVENT_KINDS.filter(entry => entry.merchant && party.eventSelectionsByCharacter?.[party.leader!]?.includes(entry.name)).map(entry => entry.name);
}

export function selectedEvents(party: EventFormation, name: string): string[] {
  const source = eventPolicy(party, name).source;
  const saved = party.eventSelectionsByCharacter?.[source];
  const selections = saved ?? ["anniversary", ...(party.eventsByCharacter?.[source] ? legacyDefaultEvents.filter(id => id !== "anniversary") : [])];
  const merchant = merchantEvents(party, name);
  return eventPriorityOrder(party, name).filter(id => selections.includes(id) || merchant.includes(id));
}

export function eventEnabled(party: EventFormation, name: string, event: string) {
  return selectedEvents(party, name).includes(event);
}

export function eventPolicy(party: EventFormation, name: string) {
  const inherited = Boolean(
    party.leader &&
    name !== party.leader &&
    name !== party.merchantCharacter &&
    party.followers?.[name],
  );
  const source = inherited ? party.leader! : name;
  return {
    inherited,
    source,
    enabled: merchantEvents(party, name).length > 0 || (party.eventSelectionsByCharacter?.[source]
      ? party.eventSelectionsByCharacter[source].some(id => id !== "anniversary" && !!eventKey(id))
      : Boolean(party.eventsByCharacter?.[source])),
  };
}

// Order is independent of attendance checkboxes; new supported events append.
export function eventPriorityOrder(party: EventFormation, name: string): string[] {
  const source = eventPolicy(party, name).source;
  return [...new Set([...(played(party, 'eventPrioritiesByCharacter', name)?.[source] ?? []), ...eventKinds().map(entry => entry.name)])]
    .filter(id => !!eventKey(id));
}

export function eventLimits(party: EventFormation, name: string): Record<string, EventLimits> {
  const byCharacter = played(party, 'eventLimitsByCharacter', name);
  const limits = byCharacter?.[eventPolicy(party, name).source] ?? {};
  const merchant = merchantEvents(party, name);
  return merchant.length ? {...limits, ...Object.fromEntries(merchant.map(event =>
    [event, byCharacter?.[party.leader!]?.[event] ?? {deathLimit:null,timeLimitMinutes:null}]))} : limits;
}

// The card line's words for the events owner's tasks.
// Moved unchanged from runtime/coordinator/status/activity.ts. A line with `walk` is a walk's
// line, which the movement owner's walk words finish (`walkLabel`).
export type EventCardLine = { phase: string; label: string } | { walk: { purpose: string; travelling: string } };
export function eventReturnLine(event: string, walking: boolean): EventCardLine {
  return walking ? { walk: { purpose: `returning from ${event}`, travelling: `Returning from event - ${event}` } }
    : { phase: 'waiting', label: `Returning from event - ${event}` };
}
export function eventAttendanceLine(event: string, attending: boolean, travelling: boolean, apart?: { kind: string; away: string }): EventCardLine {
  if (apart) return { phase: 'apart', label: apart.kind === 'farm' ? `Farming alone while the party is at ${apart.away}` : `Waiting in Main while the party is at ${apart.away}` };
  if (!attending && travelling) return { walk: { purpose: `to event - ${event}`, travelling: `Travelling to event - ${event}` } };
  return attending ? { phase: 'attending', label: `Fighting ${event}` } : { phase: 'joining', label: `Joining event - ${event}` };
}
