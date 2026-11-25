// The event attendance on the character (character/attend.ts): the selection read, the character's live combat
// event in its priority order, the arena's own fight evidence, the event's destination, the Hunt's
// pending flag, event travel's admission, the poll, the join, the search, the end report, the
// respawn rejoin, the Cipher transfer and the manual walk's leave. Moved from characters/shared.js
// (and `eventTravelAllowed`). The kinds, maps, points and targets are rules.ts's; the ages are
// `reports.fresh` and picks.
import { marginCall } from './calls.ts';
import { eventAreas, eventIs, eventKey, eventKinds, joinReply } from '../rules.ts';
import { inView as pointInView } from '../../protocol/reports.ts';
import type { EventGame, EventKind } from '../rules.ts';
import { fresh } from '../../protocol/reports.ts';
import { TIERS } from '../../protocol/ranks.ts';
import type { Tier } from '../../protocol/ranks.ts';
import type { EventAdmission } from '../api.ts';
import { tierOf } from '../../movement/api/character.ts';

type FeedEntry = Record<string, unknown> & { live?: unknown; active?: unknown; id?: unknown; event_id?: unknown; end?: unknown; next?: unknown;
  map?: unknown; x?: unknown; y?: unknown };
export interface Point { map: string; in?: unknown; x: number; y: number }
interface Sighting { mtype?: string; id?: unknown; map?: string; in?: unknown; x?: number; y?: number; observedAt?: number }
interface Member { rip?: boolean; activeEvent?: string; server?: string; seenAt?: number; map?: string; in?: unknown; eventCombatSighting?: Sighting }
interface Marked { name: string; id?: unknown }
// The suppression a manual move off the event wrote and the game's final join refusal
// stay on the client's root across a reload, under the keys shared.js kept them on.
const realm = globalThis as { __partyManuallySuppressedEvent?: Marked | null; __partyEventRefusal?: (Marked & { reply: string }) | null };
const mark = <K extends keyof typeof realm>(key: K) =>
  ({ get: (): Marked | null => realm[key] ?? null, set: (value: typeof realm[K]) => { realm[key] = value; } });
interface Game extends EventGame {
  maps?: Record<string, { event?: unknown; mount?: unknown; spawns?: unknown[][]; monsters?: { type?: string; boundary?: unknown[]; boundaries?: unknown[][] }[];
    npcs?: { position?: unknown[] }[]; doors?: unknown[][] } | undefined>;
  events?: Record<string, { join?: unknown; sprite?: unknown; name?: string } | undefined>;
}

// The search points of a map: its spawns, its monster areas' centres and its NPCs, each once.
export function searchPoints(game: Game, mapName: string): Point[] {
  const map = game.maps?.[mapName], points: Point[] = [], keys = new Set<string>();
  const add = (x: unknown, y: unknown) => {
    const px = Number(x), py = Number(y);
    if (!Number.isFinite(px) || !Number.isFinite(py) || keys.has(px + ':' + py)) return;
    keys.add(px + ':' + py); points.push({ map: mapName, x: px, y: py });
  };
  for (const spawn of map?.spawns ?? []) add(spawn[0], spawn[1]);
  for (const pack of map?.monsters ?? []) for (const box of [pack.boundary, ...(pack.boundaries ?? [])].filter(Array.isArray) as unknown[][]) {
    if (typeof box[0] !== 'string' || box[0] === mapName) { const centre = boxCentre(box); add(centre.x, centre.y); }
  }
  for (const npc of map?.npcs ?? []) if (npc.position) add(npc.position[0], npc.position[1]);
  return points;
}
// The walk from `from` to `to`: straight on one map, else the shortest chain of doors, each leg
// straight from where the last door landed to the next door (G.maps doors: [x, y, w, h, map,
// spawn], landing on the target map's spawns[spawn]). A map no chain of doors reaches comes after
// every reachable point.
function walkEstimate(game: Game, from: Point, to: Point): number {
  const leg = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(b.x - a.x, b.y - a.y);
  const best = new Map<string, number>(), open: { key: string; at: Point; cost: number }[] = [{ key: 'start', at: from, cost: 0 }];
  let answer = Infinity;
  while (open.length) {
    open.sort((x, y) => x.cost - y.cost);
    const { key, at, cost } = open.shift()!;
    if (cost >= answer || (best.get(key) ?? Infinity) < cost) continue;
    if (at.map === to.map) { answer = Math.min(answer, cost + leg(at, to)); continue; }
    for (const door of game.maps?.[at.map]?.doors ?? []) {
      const map = String(door[4]), spawn = game.maps?.[map]?.spawns?.[Number(door[5])];
      if (!spawn) continue;
      const next = map + ':' + Number(door[5]), total = cost + leg(at, { x: Number(door[0]), y: Number(door[1]) });
      if (total < (best.get(next) ?? Infinity)) { best.set(next, total); open.push({ key: next, at: { map, x: Number(spawn[0]), y: Number(spawn[1]) }, cost: total }); }
    }
  }
  return answer;
}
// The search points of `maps` that stand inside the game's vision of `from` (protocol/reports.ts
// `inView`), as `map:x:y`: the boss on one of them would be in view, so the search counts them
// searched without a walk.
export function seenSearchPoints(game: Game, from: Point, maps: readonly string[]): string[] {
  return maps.includes(from.map) ? searchPoints(game, from.map).filter(point => pointInView(from, point)).map(point => point.map + ':' + point.x + ':' + point.y) : [];
}
// The next point of the search for a boss with no fixed spot (the user's decision of 2026-11-17):
// the unsearched point of `maps` with the shortest walk from `from`, on `signal`'s map while that map
// has one left. The signal is the map the game's feed names for the boss (E.slenderman carries the
// map and no position, server_functions.js:2733-2737). `searched` holds each walked point as
// `map:x:y`. `left` is a map the party watched the boss vanish from: its points come after the
// other maps' (the user's decision of 2026-11-17).
export function nextSearchPoint(game: Game, from: Point, searched: ReadonlySet<string>, maps: readonly string[], signal: string | null,
  left: string | null = null): Point | null {
  const open = maps.flatMap(map => searchPoints(game, map)).filter(point => !searched.has(point.map + ':' + point.x + ':' + point.y));
  const pool = signal && open.some(point => point.map === signal) ? open.filter(point => point.map === signal)
    : left && open.some(point => point.map !== left) ? open.filter(point => point.map !== left) : open;
  let next: Point | null = null, cost = Infinity;
  for (const point of pool) { const walk = walkEstimate(game, from, point); if (!next || walk < cost) { next = point; cost = walk; } }
  return next;
}
export interface EventAttendPorts {
  now(): number;
  game(): Game;
  // The reply's selection: the priority list (null before a client sends one) and `enabled`, the
  // per-member enabled answer (the coordinator's eventsEnabledFor), which gates every poll and the
  // Hunt's pending flag. With no list yet it also selects every event and the anniversary.
  selection(): { list: string[] | null; enabled: boolean };
  character(): { name?: string; map: string; in?: unknown; ctype?: string; x?: number; y?: number; rip?: boolean; cave?: unknown; s?: Record<string, unknown> };
  hint(): string | null;
  // The anniversary round the reply carries, and whether the round's target was skipped.
  anniversary(): { eventCycle?: { returnCompletedAt?: unknown; supersededAt?: unknown; combatHandoffAt?: unknown; endsAt?: number } } | null;
  roundAborted(event: FeedEntry): boolean;
  entities(): Record<string, { id?: unknown; type?: string; mtype?: string; visible?: boolean; dead?: boolean; hp?: number; map?: string; in?: unknown; x?: number; y?: number } | undefined>;
  // The party's member reports on the coordinator's clock, this realm, and movement's report clock offset.
  members(): Member[];
  realm(): string;
  reportOffset(): number;
  // This character's next report, or the report-freshness bound once its reports fall silent
  // (movement's `reportOrSilence`), which the search waits on between sightings.
  nextReport(): Promise<unknown>;
  // The event clock (clock.ts) and the kinds table's game-data reads (combat.ts).
  clock: { status(): Record<string, FeedEntry | undefined>; attendance(name: string, state: FeedEntry | undefined): { staging: boolean; spawnAt?: number } | null;
    feedCurrent(): boolean; epoch(input: unknown): number; due(name: string, at: number): boolean; live(): { name: string }[] };
  facts: { names(): string[]; joins(name: string): boolean; supported(name: string): boolean; walkBoss(name: string): boolean; staged(name: string): boolean;
    map(name: string): string; targets(name: string): string[] };
  // The October runtime's activity and destination for an interaction row.
  october: { activity(name: string): unknown; destination(name: string): Point | null };
  // Event travel: the answer the last reply carried, whether this runtime is current, a Cave visit,
  // and movement's rank half (`eventTravelHeld`: the Hunt hand-in or a non-preemptible group walk).
  travel: { admission(): EventAdmission | null; current(): boolean; caveOwns(): boolean; held(): boolean };
  // Who holds this character's movement (movement's `live()`): survival's death recovery holds it
  // with a `death-recovery` request from the respawn to the end of its way back.
  holder(): Parameters<typeof tierOf>[0] | null;
  // The anniversary kiss this character runs (shared.js `__partyAnniversaryKissOperation`), or null.
  kiss(): unknown;
  // The character's event actions. The member's group task the last reply stored (the tasks owner's
  // `task.assignment`), the event attendance's `rejoinPending` names for this member in that reply, and the
  // time of this character's last death, which starts a new life.
  assignment(): Assignment | null;
  rejoin(): string | null;
  life(): number;
  // The navigation revision and its cancel, the selection revision, survival's escape, the return's hold on
  // this member, a pending event exit, the items owner's Hunt errand and the movement owner's departure. The errand and the
  // departure each hold the event walk (`poll`).
  intent(): { revision: number; cancelled: boolean };
  selectionRevision(): number;
  // The game's update count (game.js `draw` counts its frames in `draws`), which `active` keys its
  // answer on.
  updates(): number;
  escaping(): boolean;
  returnHolds(): boolean;
  returnPending(): boolean;
  bagErrand(): boolean;
  departing(): boolean;
  // The game's `join` (the join replies) and the party's shared walk under `event`.
  join(name: string): Promise<unknown>;
  // The bag's free cells (the items owner's
  // `partyItems.bag.facts().freeCells`).
  freeSlots(): number;
  // A rejoin names its life in `reentry`; movement may answer with a leg of the member's own, whose
  // destination `independent` carries.
  // `search` marks one point of a boss search, whose walk ends on the planner's "no route".
  walk(point: Point, event: string, owns: () => boolean, reentry?: number, search?: boolean): Promise<{ independent: Point } | void>;
  // The nearest event target and whether it is in reach (character/combat.ts's facts, shared.js
  // until combat.ts's movers), and the event monster types the targeting reads.
  target(): unknown;
  reachable(target: unknown): boolean;
  // Whether this character's live combat approach walks to `target` (movement's approach.ts
  // `approachingTarget`).
  approaching(target: unknown): boolean;
  // The manual monster walk's leave: the exit off an event map (exit.ts `leaveEventMap`), movement's
  // leave of a joined event, and the intake's last command.
  exitMap(current: () => boolean, request: unknown): Promise<unknown>;
  leaveEvent(request: unknown): Promise<unknown>;
  lastCommand(): number;
  // The party's Slenderman sighting the reply carries.
  partySighting(): (Sighting & { server?: string }) | null;
  // The merchant's yield to an event (the merchant job owner's job owner until): true once
  // nothing of the merchant's own holds the move.
  merchantYield(): Promise<boolean>;
  // The anniversary's staging and visit on this character (anniversary.ts).
  visit: { busy(): boolean; staging(): boolean; operation(): { cancelled?: boolean; revision?: number } | null;
    yieldTo(event: string, operation: { cancelled?: boolean; revision?: number } | null): Promise<void> };
  // The October runtime's run and the Cipher transfer (on each report).
  interaction: { run(name: string, owns: () => boolean): Promise<unknown>; transfer(): Promise<unknown> };
  // The death recovery's movement for the rejoin rungs (survival's recovery request, movement's
  // hold).
  recovery: { begin(): { held: boolean; request: unknown }; release(request: unknown): void; stop(request: unknown): Promise<void>;
    walk(point: Point, owns: () => boolean): Promise<unknown>; mark(): unknown; progress(before: unknown): unknown };
  request(path: string, options: { method: string; body: Record<string, unknown> }): Promise<unknown>;
  // One poll after a wait (the join reply's sick retry), on the game client's timer.
  after(ms: number, action: () => void): void;
  log(message: string, color: string): void;
}
// The member's group task (runtime/tasks/coordinator/assignment.ts `MemberAssignment`).
interface Assignment { kind?: string; owner?: string; tier?: string; phase?: string; event?: string; goal?: { event?: unknown } }
// A rejoin rung's outcome for survival's death recovery
// (runtime/characters/survival/recovery-member.ts).
export interface RejoinOutcome { status: 'recovered' | 'retryable' | 'cancelled' | 'not-applicable'; phase?: string; reason?: string; progress?: unknown }

// The centre of a monster area's box: `[x1, y1, x2, y2]`, or with the map's name first in a
// `boundaries` entry.
function boxCentre(box: readonly unknown[]): { x: number; y: number } {
  const at = typeof box[0] === 'string' ? 1 : 0;
  return { x: (Number(box[at]) + Number(box[at + 2])) / 2, y: (Number(box[at + 1]) + Number(box[at + 3])) / 2 };
}

export function installEventAttendance(ports: EventAttendPorts) {
  const suppressed = mark('__partyManuallySuppressedEvent'), refusal = mark('__partyEventRefusal');
  // The event monster types the targeting reads (`targetTypes`): the live event's, or none.
  let eventTypes: string[] = [];
  const targets = (next: string[]) => { eventTypes = next; };
  // The selection on the character: the reply's priority list, or with none yet the enabled answer, which
  // selects every event and the anniversary.
  function selected(name: string): boolean {
    const { list, enabled } = ports.selection();
    return list === null ? eventKey(name)?.kind === 'anniversary' || enabled : list.includes(name);
  }
  // The freshest sighting a party member on this realm reports of the event's boss, on that member's
  // own map and instance.
  function sighting(name: string): Point | null {
    const now = ports.now() + ports.reportOffset();
    const seen = ports.members().filter(member => {
      const s = member.eventCombatSighting;
      return !member.rip && member.activeEvent === name && member.server === ports.realm() && fresh(member.seenAt, now, 'report') &&
        !!s && s.mtype === name && typeof s.id === 'string' && !!s.id && s.map === member.map &&
        String(s.in || s.map) === String(member.in || member.map) && Number.isFinite(s.x) && Number.isFinite(s.y) && fresh(s.observedAt, now, 'report');
    }).sort((a, b) => Number(b.eventCombatSighting!.observedAt) - Number(a.eventCombatSighting!.observedAt));
    const s = seen[0]?.eventCombatSighting;
    return s ? { map: String(s.map), in: s.in, x: Number(s.x), y: Number(s.y) } : null;
  }
  // An arena's fight shows by its own monsters: the character stands on the event's map and a
  // living `targets.first` monster is in view. The client changes its entities only in its socket
  // and draw handlers, each its own task, so one read stands until the running code yields.
  let evidence: { map: string; name: string; live: boolean } | null = null;
  function arenaFight(name: string): boolean {
    const first = eventKey(name)?.targets.first, map = ports.character().map;
    if (!first || (ports.game().maps?.[map]?.event ?? map) !== name) return false;
    if (evidence && evidence.map === map && evidence.name === name) return evidence.live;
    const live = Object.values(ports.entities()).some(e => !!e && e.type === 'monster' && e.visible !== false && !e.dead && Number(e.hp) > 0 && first.includes(String(e.mtype)));
    evidence = { map, name, live };
    void Promise.resolve().then(() => { evidence = null; });
    return live;
  }
  // A live boss of the event in this character's view, on its map and instance.
  function inView(name: string) {
    const character = ports.character();
    return Object.values(ports.entities()).find(e => !!e && e.type === 'monster' && e.mtype === name && e.visible !== false && !e.dead && Number(e.hp) > 0 &&
      (!e.map || e.map === character.map) && (e.in == null || String(e.in) === String(character.in || character.map)) && Number.isFinite(e.x) && Number.isFinite(e.y)) ?? null;
  }
  // The feed's own position for the event, the last-seen point of a `lastSeen` boss.
  function feedPoint(state: FeedEntry | undefined): Point | null {
    return state && state.map && Number.isFinite(Number(state.x)) && Number.isFinite(Number(state.y)) ? { map: String(state.map), x: Number(state.x), y: Number(state.y) } : null;
  }
  // The hint's identity is its event, realm, round, point and the navigation and selection
  // revisions, so each hint sends the walk to the spawn once.
  let spawnSearch: { event: string; hint: string; spawn: Point } | null = null;
  function hintKey(name: string, state: FeedEntry, hint: Point): string {
    return JSON.stringify([name, ports.realm(), state.id || state.event_id || state.round || state.start || state.end || state.expires || null,
      hint.map, hint.x, hint.y, ports.intent().revision, ports.selectionRevision()]);
  }
  // The destination: an interaction row goes where its October activity is; a `point` row with
  // no boss walks to its point; a walk boss that is live goes to the boss in view, then to the
  // party's freshest sighting; then the feed's own position, or a `lastSeen` boss's catalog spawn
  // once its walk found no boss there; then the catalog's point.
  function destination(name: string, state: FeedEntry | undefined): Point | null {
    const row = eventKey(name), character = ports.character(), live = state?.live === true;
    if (row?.kind === 'interaction') return ports.october.destination(name);
    if (row?.point && !row.boss) return { ...row.point };
    if (spawnSearch?.event === name && !live) spawnSearch = null;
    if (ports.facts.walkBoss(name) && live) {
      const boss = inView(name);
      if (boss) return { map: character.map, in: character.in, x: Number(boss.x), y: Number(boss.y) };
      const seen = sighting(name);
      if (seen) return seen;
    }
    const hint = feedPoint(state);
    if (!hint) return catalog(name);
    return live && spawnSearch?.event === name && spawnSearch.hint === hintKey(name, state!, hint) ? { ...spawnSearch.spawn } : hint;
  }
  // The catalog's place for the event: a boss row's point; then the event map's first spawn; then
  // the map whose spawns hold the boss, else one of its monsters (Giga Crab happens on an ordinary
  // map); else the character stays where it is.
  function catalog(name: string): Point {
    const row = eventKey(name), game = ports.game(), character = ports.character();
    if (row?.point) return { ...row.point };
    const mapName = ports.facts.map(name), map = game.maps?.[mapName];
    if (map) { const spawn = Array.isArray(map.spawns) && map.spawns[0] || [0, 0]; return { map: mapName, x: Number(spawn[0]) || 0, y: Number(spawn[1]) || 0 }; }
    const types = ports.facts.targets(name);
    const spawnOf = (exactBoss: boolean): Point | null => {
      for (const [candidate, entry] of Object.entries(game.maps || {})) {
        const spawn = (entry?.monsters || []).find(m => !!m && (exactBoss ? m.type === name : types.includes(String(m.type))));
        const bounds = spawn && (spawn.boundary || Array.isArray(spawn.boundaries) && spawn.boundaries[0]);
        if (!Array.isArray(bounds)) continue;
        return { map: candidate, ...boxCentre(bounds) };
      }
      return null;
    };
    return spawnOf(true) || spawnOf(false) || { map: character.map, x: Number(character.x) || 0, y: Number(character.y) || 0 };
  }
  // The walk to a `lastSeen` boss's hint ended on the hint's map with no boss in view or in reach,
  // so the next destination for that hint is the boss's catalog spawn. The walk's own end replaces
  // v1.5.0's 100-unit radius.
  function hintEmpty(event: { name: string; state: FeedEntry }, to: Point): void {
    const hint = feedPoint(event.state);
    if (!eventKey(event.name)?.lastSeen || event.state.live !== true || !hint || hint.map !== to.map || hint.x !== to.x || hint.y !== to.y) return;
    if (ports.character().map !== hint.map || inView(event.name) || ports.reachable(ports.target())) return;
    const key = hintKey(event.name, event.state, hint), spawn = catalog(event.name);
    if (spawnSearch?.hint === key || spawn.map === hint.map && spawn.x === hint.x && spawn.y === hint.y) return;
    spawnSearch = { event: event.name, hint: key, spawn };
    ports.log('No ' + (eventKey(event.name)?.label ?? event.name) + ' at the last-seen waypoint; checking its native spawn', '#c084fc');
  }
  // A marker for an occurrence that has ended, or that the feed names by another id, goes.
  function clearEnded(mark: { get(): Marked | null; set(value: null): void }, feed: Record<string, FeedEntry | undefined>): void {
    const marked = mark.get();
    if (!marked) return;
    const state = feed[marked.name], id = state && (state.id || state.event_id) || null;
    if (!state || state.live === false || marked.id && id && marked.id !== id) mark.set(null);
  }
  // A walk row with a `point`, no boss and no target column attends its point, as `destination`
  // walks there. The fixture add-on's Dreams row (e2e/fixtures/events-hooks-addon.ts) is one: the
  // game knows no monster by its name or sprite. Any other monster row needs a target type.
  const pointOnly = (row: EventKind | null) => !!row?.point && !row.boss && !Object.keys(row.targets).length;
  // A walk-boss or staged row attends by its staging; the others by the feed, the party's hint or
  // the arena's own fight.
  function candidate(name: string, feed: Record<string, FeedEntry | undefined>, anniversaryFirst: boolean, list: string[] | null) {
    const refused = refusal.get(), moved = suppressed.get(), row = eventKey(name);
    if (refused?.name === name) return null;
    if (row?.kind === 'interaction') return selected(name) && ports.clock.feedCurrent() && moved?.name !== name ? ports.october.activity(name) : null;
    const state = feed[name], types = ports.facts.targets(name);
    const corroborated = ports.hint() === name || arenaFight(name);
    const kind = row?.targets.players ? 'pvp' : 'monster';
    const timed = ports.facts.walkBoss(name) || ports.facts.staged(name);
    const attendance = timed ? ports.clock.attendance(name, state) : null;
    if (moved?.name === name) return null;
    if (anniversaryFirst && list && list.indexOf('anniversary') < list.indexOf(name)) return null;
    if (!selected(name) || !ports.facts.supported(name) || kind === 'monster' && !types.length && !pointOnly(row) ||
      (timed ? !attendance : !corroborated && (!state || state.live === false))) return null;
    return { name, state: state || {}, types, kind, staging: !!attendance?.staging, spawnAt: attendance?.spawnAt };
  }
  // The anniversary is ahead of a combat event while its round is selected, live and not skipped,
  // and this character still has its visit to make, or its next round is due: the group's walk
  // estimate to Main plus one report interval reaches it (the priority list orders them).
  function anniversaryAhead(feed: Record<string, FeedEntry | undefined>): boolean {
    const round = feed.anniversary, cycle = ports.anniversary()?.eventCycle, now = ports.now(), conditions = ports.character().s;
    if (!selected('anniversary') || !round || round.active === false || ports.roundAborted(round)) return false;
    if (cycle && (cycle.returnCompletedAt || cycle.supersededAt || cycle.combatHandoffAt) && now <= Number(cycle.endsAt)) return false;
    if (round.live !== false) return !!conditions?.anniversary_visit || !conditions?.anniversary_kiss;
    return ports.clock.due('anniversary', ports.clock.epoch(round.next));
  }
  // `active`'s inputs besides the game state: the feed, the reply's selection, hint, assignment and
  // anniversary plan, this owner's marks and join, and the life.
  const activeKey = () => {
    const selection = ports.selection();
    return [ports.updates(), ports.clock.status(), selection.list, selection.enabled, ports.hint(), ports.assignment(), ports.anniversary(),
      refusal.get(), suppressed.get(), acted, ports.life()];
  };
  let answered: { key: unknown[]; value: ReturnType<typeof activeNow> } | null = null;
  // The character's live combat event. Targeting and the skill gates ask it many times in one pass,
  // and the character, the entities and the feed it reads change only when the game applies an
  // update (the run scope's cadence, run.ts) or a new feed arrives, so one answer stands until an
  // input changes. With no update count, as on a stand-in game, it reads each time.
  function active() {
    if (answered && activeKey().every((value, i) => value === answered!.key[i])) return answered.value;
    const value = activeNow(), key = activeKey();
    answered = Number.isFinite(key[0]) ? { key, value } : null;
    return value;
  }
  // The first by the priority list, then the one whose map it stands on or that it joined, then the
  // one ending first.
  function activeNow() {
    const feed = ports.clock.status() || {}, list = ports.selection().list;
    clearEnded(suppressed, feed);
    clearEnded(refusal, feed);
    const ahead = anniversaryAhead(feed), here = ports.game().maps?.[ports.character().map]?.event, marked = joined();
    // A candidate, or an interaction row's October activity, which carries the same fields.
    type Found = { name: string; state: FeedEntry; types: string[]; kind: string; staging: boolean; spawnAt?: number };
    const found = ports.facts.names().map(name => candidate(name, feed, ahead, list)).filter(Boolean) as Found[];
    const rank = (entry: Found) => list ? list.indexOf(entry.name) : -1;
    const current = (entry: Found) => Number(entry.name === here || entry.name === marked);
    return found.sort((a, b) => (rank(a) >= 0 && rank(b) >= 0 ? rank(a) - rank(b) : 0) || current(b) - current(a) ||
      (Number(a.state.end) || Infinity) - (Number(b.state.end) || Infinity))[0] || null;
  }
  // The report's `huntEventPending`: a fighter's Hunt waits while events are on and a combat event is
  // its live one, or while the anniversary goes ahead of a combat event. The merchant's own group
  // runs no Hunt (row 36 (c)).
  function huntPending(): boolean {
    if (ports.character().ctype === 'merchant') return false;
    return ports.selection().enabled && !!active() || anniversaryAhead(ports.clock.status() || {});
  }
  // Whether the character may travel for `event` now: the admission check admitted it on the coordinator,
  // once per report, and the reply carries the answer for the event the report named. A Cave visit
  // and movement's rank half hold event travel first. The merchant's own group asks no admission
  // (row 36 (c)), so it travels while its runtime is current.
  let admissionReason: string | null = null;
  function allowed(event: string): boolean {
    if (ports.travel.caveOwns()) return false;
    if (ports.character().ctype === 'merchant') return ports.travel.current();
    if (ports.travel.held()) return false;
    const admission = ports.travel.admission();
    // The coordinator's refusal reason goes to the game log once per change, as the
    // earlier console's `eventTravelAllowed` logged the permission reply's reason.
    const reason = admission?.reason || null;
    if (reason && reason !== admissionReason) ports.log(reason, '#f0b429');
    admissionReason = reason;
    return ports.travel.current() && admission?.event === event && admission.allowed;
  }
  // The character half of the travel check: a kiss holds an event departure while it
  // runs. The coordinator learns of the kiss from the next report, so an event attendance walk that
  // another member's admission started can reach this character first. The intake leaves that
  // command untaken, the heartbeat carries it again, and it runs at the first delivery after the
  // kiss's reply or the round's end. The report's `anniversaryState.kiss` names the kiss meanwhile.
  // Every other command is a newer command, which ends the visit.
  function defers(command: { requester?: { tier?: string } } | null | undefined): string | null {
    return command?.requester?.tier === 'event-attendance' && ports.kiss() ? 'anniversary kiss' : null;
  }
  // The derived event marker (`joinedEvent`): the event of this member's
  // attendance assignment while the character stands on the map whose game data names it, or while
  // the character's own action for that assignment stands in this life: its join's reply, or the start of its
  // walk or interaction. A task above event attendance suspends the attendance (the
  // tasks owner's `suspend`), so the action stands under one; a new life, another assignment or
  // none ends it.
  let acted: { owner: string; event: string; life: number } | null = null;
  function attendance(): (Assignment & { owner: string; event: string }) | null {
    const task = ports.assignment();
    return task?.kind === 'event-attendance' && typeof task.event === 'string' && typeof task.owner === 'string' ? task as Assignment & { owner: string; event: string } : null;
  }
  function suspends(task: Assignment | null): boolean {
    const tier = TIERS[task?.tier as Tier];
    return !!tier && tier.rank > TIERS['event-attendance'].rank;
  }
  // (1): a request ranked above event attendance holds the character's movement, such as survival's
  // death recovery from the respawn on. The recovery owns the way back through `rejoin`, so the poll
  // takes no step meanwhile, and a step that started before it acts on nothing.
  function outranked(): boolean {
    const live = ports.holder();
    return !!live && TIERS[tierOf(live).tier].rank > TIERS['event-attendance'].rank;
  }
  // Franky's fight: this member's assignment is the event's attendance and no request
  // above event attendance holds the character, so the tasks owner's and movement's rank tables
  // decide the holds v1.5.0's `frankyCombatActive` listed one by one.
  function owns(event: string): boolean {
    return attendance()?.event === event && !outranked();
  }
  function joined(): string | null {
    const task = ports.assignment(), own = attendance();
    if (acted && (acted.life !== ports.life() || (own ? own.owner !== acted.owner : !suspends(task)))) acted = null;
    if (own && ports.game().maps?.[ports.character().map]?.event === own.event) return own.event;
    return acted?.event ?? null;
  }
  function attend(event: string): void {
    const own = attendance();
    if (own?.event === event) acted = { owner: own.owner, event, life: ports.life() };
  }
  // The event this character joined, else its live event's name (shared.js `joinedEventName`):
  // movement's walk request and the add-on reports read it.
  function eventName(): string | null { return joined() ?? active()?.name ?? null; }
  // A player command off the event and its deselection end the character's action for it.
  function leave(): void { acted = null; }
  // Attendance marks the member's record when it dies in an occurrence and clears it when the member
  // reaches the map, joins, or the occurrence ends (attendance.ts `recordDeath`); the reply carries
  // the mark, so a reload after a native revival still finds it.
  function rejoinPending(): string | null {
    const mark = ports.rejoin();
    return mark && attendance()?.event === mark ? mark : null;
  }

  // A `prize` row: the join waits for a free cell, and the member stays admitted until a
  // poll finds one. prizeSpace logs the wait once, when it starts (rework pass).
  let prizeWaiting: string | null = null;
  function prizeSpace(name: string): boolean {
    if (!eventIs(name, 'prize') || ports.freeSlots() > 0) { if (prizeWaiting === name) prizeWaiting = null; return true; }
    if (prizeWaiting !== name) {
      prizeWaiting = name;
      ports.log('Waiting for an empty inventory slot before ' + (eventKey(name)?.label ?? name), '#f0b429');
    }
    return false;
  }
  // The `join` row: the game's join, whose reply arrives after the server has transported the
  // character (server.js:12641-12711; `transport_player_to` emits `new_map` first). The server sends
  // that reply from inside its handler, so a lost reply ends at the call margin (calls.ts
  // `marginCall`), as the kiss's does, and the next poll joins again. A `cant_in_bank` reply holds
  // the join until the character reports from a map that is not a bank.
  let bankRefused = false;
  const inBank = () => !!ports.game().maps?.[ports.character().map]?.mount;
  async function joinCombat(event: Live, to: Point, current: () => boolean): Promise<boolean> {
    if (!current()) return false;
    if (joined() !== event.name || ports.character().map !== to.map) {
      if (!prizeSpace(event.name)) return false;
      if (bankRefused && inBank()) return false;
      bankRefused = false;
      try { await marginCall('join', () => ports.join(event.name), 'Event join'); }
      catch (error) {
        const failed = error as { reason?: unknown; response?: unknown } | null, reply = String(failed?.reason || failed?.response || '');
        const row = joinReply(reply);
        if (row.final) {
          refusal.set({ name: event.name, id: event.state.id || event.state.event_id || null, reply });
          acted = null;
          ports.log('The game refused ' + event.name + ' (' + reply + '); skipping this round', '#c084fc');
          throw Object.assign(new Error('event-over'), { reason: 'event-over' });
        }
        if (row.bug) ports.log('The game answered ' + reply + ' to a join of ' + event.name + ', which this character never sends', 'red');
        // The game's hop sickness ends after its `ms`, and the join goes again then.
        const sickness = Number((ports.character().s?.hopsickness as { ms?: unknown } | undefined)?.ms);
        if (row.retry === 'sick' && sickness > 0) ports.after(sickness, () => { void poll(); });
        if (row.retry === 'bank') bankRefused = true;
        throw error;
      }
      if (!current()) return false;
      if (ports.character().map !== to.map) throw new Error('Event join has no observed arrival: ' + event.name);
      ports.log('Joined ' + event.name, '#c084fc');
    }
    attend(event.name);
    return true;
  }
  // A walk onto a map whose game data names an event joins that event first (the leader follow and
  // the return to the leader).
  async function joinDestination(to: Point | null): Promise<boolean> {
    if (ports.travel.caveOwns() || ports.escaping() || !to || ports.character().map === to.map) return false;
    const name = ports.game().maps?.[to.map]?.event;
    if (typeof name !== 'string' || !selected(name) || !ports.facts.joins(name) || !prizeSpace(name)) return false;
    // The join's reply comes after the server moved the character (`transport_player_to` emits
    // `new_map` first), so the next walk reads the leader's map with the character already there
    // (rework pass).
    await marginCall('join', () => ports.join(name), 'Event join');
    attend(name);
    targets(ports.facts.targets(name));
    return true;
  }

  // The `search` row's boss: its sighting on this character's own map and instance while the
  // feed is current, else the party's freshest one on this realm.
  const searched = () => eventKinds().find(row => !!row.search)?.name ?? null;
  function seenHere(): (Sighting & { server: string }) | null {
    const name = searched();
    if (!name || !ports.clock.feedCurrent()) return null;
    const character = ports.character(), boss = inView(name);
    const here = boss ? { id: String(boss.id), map: character.map, in: character.in, x: Number(boss.x), y: Number(boss.y), server: ports.realm(),
      observedAt: ports.now() + ports.reportOffset() } : null;
    return here;
  }
  // A party sighting on the map the boss vanished from, taken at or before the vanish, is where the
  // boss stood before its warp, so seen() drops it. A sighting after the vanish ends the vanish.
  function seen(): Sighting | null {
    const here = seenHere(), party = ports.partySighting();
    const found = here || (party && party.server === ports.realm() && !!party.map && !!ports.game().maps?.[party.map] && Number.isFinite(party.x) &&
      Number.isFinite(party.y) && fresh(party.observedAt, ports.now() + ports.reportOffset(), 'report') &&
      !(vanished && party.map === vanished.map && !(Number(party.observedAt) > vanished.at)) ? party : null);
    if (found && vanished && Number(found.observedAt) > vanished.at) vanished = null;
    return found;
  }
  // The clock's staging for the search row (clock.ts `attendance`): the search attends while the
  // feed lists the boss live and the character's pass has not ended. A sighting starts the pass again.
  function searching(name: string, state: FeedEntry | undefined): boolean {
    if (!state || state.live !== true) vanished = null;
    if (!state || state.live !== true || search?.event === name && seen()) { if (search?.event === name) search = null; return state?.live === true; }
    return !(search?.event === name && search.exhausted);
  }
  // The search for a boss with no fixed spot: a sighting, this character's own or the party's, is
  // walked to. With none, one pass over the points of the boss's search maps, nearest first
  // (`nextSearchPoint`), the feed's map ahead, ends at a sighting. The pass keeps the points it walked across polls, as v1.5.0's
  // `slenderSearch` did. A sighting's walk goes on while the boss's latest sighting stays inside the
  // game's vision around the walked point, so the character sees it on arrival, and the search goes
  // on to a sighting outside it; a pass with no sighting ends the occurrence's search for this
  // character. The next walk starts when the last one ends, and a sighting walk that ended short of
  // the boss waits for this character's next report, which carries the next sighting (rework pass),
  // or for the report-freshness bound when the reports stop.
  let search: { event: string; occurrence: unknown; exhausted: boolean; maps: string[]; signal: string | null; left: string | null; searched: Set<string> } | null = null;
  // The map the search boss last vanished from in this character's view, which the next search
  // point reads. The game warps Slenderman with a bare `disappear` (server_functions.js 2489: no
  // reason, place or `outside` flag), sent only to the characters in view of it. The game's own
  // handler runs first and keeps the boss as `DEAD<id>` until its next frame, so its type and map
  // still read here. The live rerun fought the boss for under two seconds before the warp, with no
  // read of it in between. `at` is on the report clock the sightings' `observedAt` use.
  let vanished: { map: string; at: number } | null = null;
  function disappeared(data: { id?: unknown; outside?: unknown; place?: unknown; reason?: unknown; death?: unknown } | null | undefined): void {
    const name = searched();
    if (!name || !data || data.id == null || data.outside || data.place || data.reason || data.death) return;
    const all = ports.entities(), boss = all[String(data.id)] || all['DEAD' + String(data.id)], character = ports.character();
    if (boss && boss.type === 'monster' && boss.mtype === name && (!boss.map || boss.map === character.map))
      vanished = { map: character.map, at: ports.now() + ports.reportOffset() };
  }
  const watchSighting = seenHere;
  // The vanished map stops counting as the feed's signal, which the game does not update on a warp.
  // The vanish holds for every pass of the occurrence until a later sighting, because a sighting
  // ends a pass (`searching`) and the next poll starts a new one.
  function noteVanish(pass: NonNullable<typeof search>): void {
    if (!vanished) return;
    pass.left = vanished.map;
    if (pass.signal === vanished.map) pass.signal = null;
  }
  async function searchFor(event: Live, current: () => boolean): Promise<void> {
    const occurrence = event.state.id || event.state.event_id || null;
    if (search?.event !== event.name || search.occurrence !== occurrence) {
      const maps = (eventKey(event.name)?.search ?? []).filter(map => !!ports.game().maps?.[map]), feed = String(event.state.map);
      search = { event: event.name, occurrence, exhausted: false, maps, signal: maps.includes(feed) ? feed : null, left: null, searched: new Set() };
    }
    const pass = search;
    noteVanish(pass);
    if (pass.exhausted) return;
    const revision = ports.intent().revision, owns = () => current() && ports.intent().revision === revision;
    while (owns()) {
      if (ports.reachable(ports.target())) return;
      const boss = seen();
      if (boss) {
        const id = boss.id, at = boss.map;
        await ports.walk({ map: String(boss.map), in: boss.in, x: Number(boss.x), y: Number(boss.y) }, event.name, () => {
          const latest = seen();
          return owns() && !!latest && latest.id === id && latest.map === at &&
            pointInView({ x: Number(boss.x), y: Number(boss.y) }, { x: Number(latest.x), y: Number(latest.y) });
        });
        if (ports.reachable(ports.target())) return;
        await ports.nextReport(); continue;
      }
      const character = ports.character(), here = { map: character.map, x: Number(character.x), y: Number(character.y) };
      // The live rerun walked Halloween (201, -160) and then (201, -180), 20 apart, and ran out of
      // time before Spookytown, where the boss stood.
      for (const seenKey of seenSearchPoints(ports.game(), here, pass.maps)) pass.searched.add(seenKey);
      noteVanish(pass);
      const point = nextSearchPoint(ports.game(), { map: character.map, x: Number(character.x), y: Number(character.y) }, pass.searched, pass.maps, pass.signal, pass.left);
      if (!point) break;
      pass.searched.add(point.map + ':' + point.x + ':' + point.y);
      try { await ports.walk(point, event.name, () => owns() && !seen(), undefined, true); }
      catch (error) {
        if (!owns()) return;
        if (seen()) continue;
        // The search logs a blocked catalog centre and goes on to the next candidate.
        ports.log(event.name + ' search candidate: ' + String((error as { reason?: unknown })?.reason || (error as Error)?.message || error), '#f0b429');
      }
      if (ports.reachable(ports.target())) return;
    }
    if (!owns()) return;
    pass.exhausted = true;
    ports.log(event.name + ' search exhausted; returning to the saved activity', '#f0b429');
  }

  // The poll: what the character does for its attendance assignment. The tasks owner's rank
  // table gives the assignment only while no higher task holds the group, and one
  // run at a time is the character's one event travel, which the respawn rejoin shares.
  type Live = NonNullable<ReturnType<typeof active>>;
  type TravelStart = { revision: number; selection: number; life: number; types: string };
  const travelStart = (event: Live): TravelStart =>
    ({ revision: ports.intent().revision, selection: ports.selectionRevision(), life: ports.life(), types: event.types.join(',') });
  // Whether an event travel still holds for its event (row 6 (1), (2)): each step re-reads the
  // assignment and the life, so a reply after a death, and a walk asked in an earlier life, act on
  // nothing. The poll's travel also holds only while no higher task outranks it, no return holds the
  // member, its attendance names the event and a Cipher's types stand. The respawn rejoin runs under
  // survival's recovery, which outranks those, so it reads the shared part alone (`poll` false).
  function holds(event: Live, start: TravelStart, poll: boolean): boolean {
    const live = active();
    if (!ports.travel.current() || ports.character().rip || ports.escaping() || ports.intent().cancelled || start.revision !== ports.intent().revision ||
      start.selection !== ports.selectionRevision() || start.life !== ports.life() || !selected(event.name) || !live || live.name !== event.name) return false;
    return !poll || !outranked() && !ports.returnPending() && !ports.returnHolds() && attendance()?.event === event.name &&
      (eventKey(event.name)?.view !== 'cipher' || live.types.join(',') === start.types);
  }
  let running: Promise<void> | null = null, travel: string | null = null;
  function poll(): Promise<void> { return running ||= step().catch(failed).finally(() => { running = null; }); }
  // The poll's one error record: a step that throws, in its reads or its travel, logs one game log
  // line, so every caller may drop the poll's promise.
  function failed(error: unknown): void {
    const reason = (error as { reason?: unknown })?.reason || (error as Error)?.message || error;
    if (reason !== 'interrupted' && reason !== 'event_not_live') ports.log('Event travel failed: ' + reason, 'red');
  }
  async function step(): Promise<void> {
    if (ports.character().ctype === 'merchant' && attendance() && !await ports.merchantYield()) return;
    if (!ports.selection().enabled) { targets([]); return; }
    if (outranked()) return;
    // Only a kiss holds the event; the anniversary's staging and visit yield to a live event the
    // list puts ahead of them.
    const priority = active(), staging = ports.visit.operation();
    if (ports.kiss()) return;
    if (ports.visit.busy() && !staging) return;
    if (priority && (ports.visit.busy() || ports.visit.staging() || staging)) {
      const revision = ports.intent().revision, selection = ports.selectionRevision();
      if (!allowed(priority.name)) return;
      if (!ports.travel.current() || ports.escaping() || !selected(priority.name) || revision !== ports.intent().revision || selection !== ports.selectionRevision()) return;
      await ports.visit.yieldTo(priority.name, staging);
    } else if (ports.visit.busy() || ports.visit.staging()) return;
    // The Hunt hand-in and a non-preemptible group walk hold back every event work, the end report
    // included (pollEvents, shared.js:13280-13285).
    if (ports.travel.held()) return;
    const event = active();
    if (!event) { targets([]); await reportEnded(); return; }
    ended = null;
    targets(event.staging ? [] : event.types);
    if (travel || ports.bagErrand() || ports.departing() || !allowed(event.name) || attendance()?.event !== event.name) return;
    // A target in reach, or one the character's combat approach already walks to, is the way to the
    // event: a walk ask would take the journey from the approach, which then starts again. An
    // interaction (the Cipher's trip to the Witch) has no target, so the gathering monster a fighter
    // still has in reach after `gather_end` does not hold it.
    if (!event.staging && event.kind !== 'interaction' && joined() === event.name &&
      (ports.reachable(ports.target()) || ports.approaching(ports.target()))) return;
    travel = event.name;
    const start = travelStart(event), current = () => holds(event, start, true);
    try {
      const to = destination(event.name, event.state);
      if (ports.facts.joins(event.name)) { if (allowed(event.name)) await joinCombat(event, to!, current); return; }
      if (joined() !== event.name) { attend(event.name); ports.log('Traveling to ' + (ports.game().events?.[event.name]?.name || event.name), '#c084fc'); }
      const row = eventKey(event.name);
      // The activity's own kind, as v1.5.0's poll: a Cipher fighter's gathering is a
      // walk to its monster's spawn, and only its trip to the Witch runs the October runtime.
      if (event.kind === 'interaction') { await ports.interaction.run(event.name, current); return; }
      if (row?.search) { await searchFor(event, current); return; }
      if (event.kind !== 'pvp' && !ports.reachable(ports.target()) && !ports.approaching(ports.target()) && allowed(event.name) && current()) {
        await ports.walk(to!, event.name, current);
        if (current()) hintEmpty(event, to!);
      }
    } finally { travel = null; }
  }
  // The last row: a member still on an ended occurrence holds as its return before the return's
  // record exists (source.ts's `awaiting-return`), and asks for the return with `/event-ended` at its
  // first current feed that no longer lists the event (the schedule's `ended`), unless the party still names it
  // and the character's search for it has not ended. A failed post goes again at the next poll.
  let ended: { owner: string; sent: boolean } | null = null;
  async function reportEnded(): Promise<void> {
    const task = ports.assignment(), name = task?.phase === 'awaiting-return' && typeof task.goal?.event === 'string' ? task.goal.event : null;
    if (!name || !task?.owner || ports.returnPending() || ports.hint() === name && !(search?.event === name && search.exhausted)) { ended = null; return; }
    if (ended?.owner !== task.owner) ended = { owner: task.owner, sent: false };
    if (ended.sent || !ports.clock.feedCurrent() || ports.clock.live().some(entry => entry.name === name)) return;
    ended.sent = true;
    try { await ports.request('/event-ended', { method: 'POST', body: { character: ports.character().name, event: name } }); }
    catch { ended.sent = false; }
  }

  // survival's rejoin rung (runner.ts): `rejoin` is the party's shared walk or the
  // join, `lone-walk` walks to the event alone and `relocate` walks to the event map's spawn
  // first. The death recovery holds the character, which outranks the poll's walk.
  async function rejoin(rung: string): Promise<RejoinOutcome> {
    if (ports.escaping() || ports.intent().cancelled) return { status: 'cancelled' };
    if (!ports.selection().enabled) return { status: 'not-applicable' };
    const event = active();
    if (!event) return { status: rejoinPending() ? 'cancelled' : 'not-applicable' };
    // The poll and the rejoin share the character's one event travel (v1.5.0
    // shared.js:13732).
    if (travel) return { status: 'retryable', reason: 'Event travel already in progress' };
    const start = travelStart(event), current = () => holds(event, start, false);
    const waiting = (): RejoinOutcome => ({ status: current() ? 'retryable' : 'cancelled', reason: 'Waiting for event travel permission' });
    if (!allowed(event.name)) return waiting();
    // The `rejoin` rung asks the party's walk and the lone rungs walk as the recovery, as.
    const alone = rung === 'lone-walk' || rung === 'relocate', recovery = ports.recovery.begin();
    if (!recovery.held) return { status: 'retryable', reason: 'A higher request holds movement' };
    targets(event.staging ? [] : event.types);
    travel = event.name;
    let phase = 'event-reentry';
    const before = ports.recovery.mark(), release = () => ports.recovery.release(recovery.request);
    try {
      await ports.recovery.stop(recovery.request);
      if (!current()) return { status: 'cancelled' };
      const to = destination(event.name, event.state)!;
      if (ports.facts.joins(event.name) && !await joinCombat(event, to, current)) return { status: 'cancelled' };
      if (!current()) return { status: 'cancelled' };
      if (!allowed(event.name)) return waiting();
      attend(event.name);
      // The search and the party's shared walk run as their own requests, which the recovery's
      // hold would outrank; the lone rungs walk as the recovery itself.
      if (eventKey(event.name)?.search && !ports.target()) { phase = 'event-search'; release(); await searchFor(event, current); }
      else if (!ports.facts.joins(event.name) && !ports.target()) {
        phase = 'event-travel';
        if (rung === 'relocate') {
          const spawn = ports.game().maps?.[to.map]?.spawns?.[0];
          if (spawn) await ports.recovery.walk({ map: to.map, x: Number(spawn[0]), y: Number(spawn[1]) }, current);
          if (!current()) return { status: 'cancelled' };
          return { status: 'retryable', phase, reason: 'Relocated to the ' + to.map + ' spawn', progress: ports.recovery.progress(before) };
        }
        if (alone) await ports.recovery.walk(to, current);
        else {
          release();
          // (4): the rejoin asks as this life's re-entry, and movement answers with a leg of the
          // member's own while the party's walk to the event travels without it.
          const leg = await ports.walk(to, event.name, current, start.life);
          if (leg && current()) await catchUp(leg.independent, current);
        }
      }
      if (!current()) return { status: 'cancelled' };
      ports.log('Recovered ' + event.name + ' participation after respawning', '#c084fc');
      return { status: 'recovered', phase };
    } catch (error) {
      const reason = String((error as { reason?: unknown })?.reason || (error as Error)?.message || error);
      if (!current() || reason === 'event_not_live' || reason === 'event-over') return { status: 'cancelled', phase, reason };
      return { status: 'retryable', phase, reason, progress: ports.recovery.progress(before) };
    } finally { travel = null; }
  }
  // The member's own leg to its event (shared.js:15332-15354) walks as the death recovery
  // and ends once an event target is in combat reach.
  async function catchUp(point: Point, current: () => boolean): Promise<void> {
    if (!ports.recovery.begin().held) throw new Error('A higher request holds movement');
    const inReach = () => ports.reachable(ports.target());
    await ports.recovery.walk(point, () => current() && !inReach()).catch(error => { if (!inReach()) throw error; });
  }
  // The event this character's poll or rejoin travels to, and its search for the report.
  const traveling = () => travel;
  // Each report of this character hands its Cipher ingredients over while it attends the Cipher and
  // nothing above the event holds its work (character/install.ts listens to `report.sent`).
  function reported(): void {
    if (bankRefused && !inBank()) void poll();
    const event = active();
    if (event && eventKey(event.name)?.view === 'cipher' && attendance()?.event === event.name && !ports.travel.held())
      ports.interaction.transfer().catch(error => ports.log('Cipher ingredient transfer failed: ' + String((error as Error)?.message || error), '#f0b429'));
  }
  const searchReport = () => ({ sighting: watchSighting(), exhausted: !!search?.exhausted });
  // A monster walk the player picked by hand (`manualMonsterOverride`) leaves the live event first:
  // leaveForManualWalk suppresses the event and clears its targets. On an event area's map it climbs
  // off while the walk's command and revision hold. A joined event that needs a join it leaves.
  async function leaveForManualWalk(command: { id: number; manualMonsterOverride?: boolean }, request: unknown): Promise<void> {
    const live = command.manualMonsterOverride ? active() : null;
    if (!live) return;
    const state = live.state as { id?: unknown; event_id?: unknown } | undefined;
    suppressed.set({ name: live.name, id: state && (state.id || state.event_id) || null } as Marked);
    targets([]);
    if (eventAreas(ports.game()).has(ports.character().map)) {
      const revision = Number(ports.intent().revision) || 0;
      await ports.exitMap(() => ports.travel.current() && !ports.escaping() && !ports.intent().cancelled &&
        (Number(ports.intent().revision) || 0) === revision && ports.lastCommand() <= command.id, request);
    } else if (joined() && ports.facts.joins(joined()!)) {
      try { await ports.leaveEvent(request); } catch { /* The walk goes on. */ }
    }
    leave();
  }
  // The combat context's event (turns' skill context): a Cave counts as the event `cave` with no
  // event types, else the live combat event.
  const combatEvent = () => ports.character().cave ? { name: 'cave', types: [] as string[] } : active();
  return { targets, targetTypes: () => eventTypes, refused: refusal.get, selected, sighting, arenaFight, destination, active, combatEvent, leaveForManualWalk, huntPending, allowed, defers, owns, joined, eventName, leave, rejoinPending, joinDestination, seen, searching, poll, rejoin, traveling, searchReport, reported, disappeared };
}
Object.assign(globalThis, { installEventAttendance });
