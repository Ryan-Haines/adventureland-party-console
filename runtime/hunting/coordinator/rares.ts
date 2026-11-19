// Rares : the
// sightings the members report, the passive rules that pick a rare, the encounter from the first
// sighting to its loot, the Phoenix patrol, and the rare's state for the reply and the dashboard.
// Its waits end on report rounds and the game's respawn data, and a report's age
// reads movement's `report` reading (protocol/reports.ts). The group's grouped combat record is targeting's: the
// bridge below reads it through `targeting.groupView`, and the targeting owner's queue reads the rare's
// rejections from `farming.focus` (`rejected` below), so the rare writes nothing of the targeting owner's record,
// the walk, the Hunt, the mode or the spot. The encounter is the tasks owner's `rare` task: it suspends
// the farming or Hunt task, which walks back to its spot when 01 resumes it.
import { requestObject } from '../../lifecycle/api.ts';
import type { Fight } from '../../coordinator/targeting/api.ts';
import type { GroupView } from '../../hooks/registry.ts';
import type { LadderPort } from '../../tasks/api.ts';
import { GAME_POSITION_STEP, GAME_VISION, currentQueue, fresh, inView } from '../../protocol/reports.ts';
import type { SettingsWrite, SettingsWriteResult } from '../../settings/api.ts';
// The passive rules and switches a rare decision plays with read through `played`, so an add-on's overlay plays.
import { played } from '../../settings/api.ts';
import { applyPassivePatch, validPhoenixOrder } from '../saved-fields.ts';
import { contains, zones, type Area, type Catalog, type Point } from '../zones.ts';
import { committedPassiveRules, legacyPriorities, passiveLevelAllowed, GAME_FIELD_REACH, PATROL_WALK, RARE_PROGRESS_BOUND_MS, RARE_WALK, rareWalkKind, RARE_REJECTIONS_KEPT, instanceOf, realmOf, rareEndLabel, rareEndReadsRare, rareEndRejects, rareLabel, type RareEnd } from '../rules.ts';
import { MONSTER_PRIORITY } from '../../characters/targeting/api.ts';
import { partyHooks } from '../../hooks/index.ts';
import { appendCombatLog, boundFired } from '../../status/coordinator/api.ts';
import { writeRare } from './record.ts';
import { ARRIVAL_TOLERANCE } from '../../protocol/ladder.ts';
import { TIERS, type Tier } from '../../protocol/ranks.ts';
import type { PatrolCheckpoint, PhoenixPatrol, RareEncounter, RareOwner, RareRejected, RareRejection, RareSight,
  RareState, RareStatus } from '../api.ts';

/**
 * The rejections the record keeps: the newest RARE_REJECTIONS_KEPT by sighting time. Each one
 * dropped tells the status owner's bound record.
 */
export function keepRejections(records: Record<string, RareRejection>): Record<string, RareRejection> {
  const keys = Object.keys(records);
  if (keys.length <= RARE_REJECTIONS_KEPT) return records;
  keys.sort((a, b) => records[a]!.sight.seenAt - records[b]!.sight.seenAt);
  const dropped = keys.length - RARE_REJECTIONS_KEPT;
  for (const key of keys.slice(0, dropped))
    boundFired({ bound: 'RARE_REJECTIONS_KEPT', owner: '07', subject: key, state: { seenAt: records[key]!.sight.seenAt, kept: RARE_REJECTIONS_KEPT } });
  return Object.fromEntries(keys.slice(dropped).map(key => [key, records[key]!]));
}

/** What the rare asks of the composition. */
export interface RarePorts {
  now?: () => number;
  // The tasks owner's `runs` for the rare source: whether the rare may act now.
  runs(): boolean;
  members(): string[];
  intent(name: string): { revision: number; cancelled?: boolean };
  reconcileHuntArrival(): void;
  // The task table's rare row against the group's live task; with no type,
  // the rank alone.
  taskRefuses(mtype?: string): boolean;
  persist(): void;
  // The settings writer: the passive rules and the patrol order are the
  // player's settings.
  write(batch: SettingsWrite): SettingsWriteResult;
  cancelConvoy(): void;
  convoy(location: Point, label: string, names: string[], purpose: string): unknown;
  // Movement's planner length of a walk (rare-route-distance.ts).
  routeDistance(from: Point, to: Point): Promise<number>;
  // The party's group id in the tasks owner's table, which the hunting owner's notices name.
  group(): string | null;
  // The game's monster table (G.monsters), for the Phoenix's respawn time in seconds.
  monsters(): Readonly<Record<string, { respawn?: number } | undefined>> | null;
  // The party group's farming task ladder (01 design 4.1), which a failed patrol leg climbs.
  ladder(): LadderPort;
}

// The rares' names on the status line.
const NAMES: Record<string, string> = { tinyp: 'Fairy', phoenix: 'Phoenix', goldenbat: 'Golden Bat', cutebee: 'Cute Bee', hen: 'Hen', rooster: 'Rooster' };
const rareName = (mtype: string) => NAMES[mtype] || mtype;

const rareKey = (s: { realm: string; map?: string; in?: string | number; id: string }) => `${s.realm}|${s.map}|${s.in}|${s.id}`;
const apart = (a: Point | undefined, b: Point | undefined) => a?.map === b?.map ? Math.hypot(a!.x - b!.x, a!.y - b!.y) : Infinity;

// A rejection keeps the rare's own fields and the group's place, never the whole report it came from.
export function rareRejection(sight: RareSight, origin: Point): RareRejection {
  const { id, mtype, map, x, y, hp, target, realm, in: instance, seenAt, reporter, visible, partyEngaged, reachable } = sight;
  return { sight: { id, mtype, map, x, y, hp, target, realm, in: instance, seenAt, reporter, visible, partyEngaged, reachable },
    origin: { map: origin.map, x: origin.x, y: origin.y } };
}

// A member's report keeps the newer rare observation of the same runtime: the status owner's combat
// ingestion asks this before it merges a report.
export function preserveRare<T>(body: T, previous: T | undefined): T {
  const before = requestObject(requestObject(previous).rareObservation);
  const next = requestObject(requestObject(body).rareObservation);
  const runtime = requestObject(requestObject(body).combatSelection).runtimeId;
  return before.runtimeId === runtime && Number(before.at) > Number(next.at || 0) ? { ...body, rareObservation: before } : body;
}

// ---- The Phoenix patrol's regions ----

// The scan rows, the coverage and its samples read the game's vision box and position step
// (protocol/reports.ts): a member sees what lies inside half the box around it, and a Phoenix in the
// region stands within a step of a sample. A scan stop is reached by movement's arrival reading
//, and a leg ends on its walk's own progress end; a failed leg climbs the tasks owner's farming ladder
// (`legFailed`). The region count and the respawn wait are the game's; the settle and the
// runtime retry wait for reports.
// The server respawns a monster up to 0.9 s after its `respawn` time (node/server.js:13428).
const RESPAWN_JITTER_MS = 900;

function regions(catalog: Catalog | null | undefined) {
  return zones(catalog || [], ['phoenix']);
}
// The coverage samples of a region: a grid at the game's position step over its boundary.
function samples(area: Area): Point[] {
  const [x1, y1, x2, y2] = area.boundary!;
  const nx = Math.max(1, Math.ceil((x2 - x1) / GAME_POSITION_STEP)), ny = Math.max(1, Math.ceil((y2 - y1) / GAME_POSITION_STEP));
  const result: Point[] = [];
  for (let x = 0; x <= nx; x++)
    for (let y = 0; y <= ny; y++) result.push({ map: area.map, x: x1 + ((x2 - x1) * x) / nx, y: y1 + ((y2 - y1) * y) / ny });
  return result;
}
// One axis of the scan: one stop when a view spans it, else stops a view apart, so the views abut.
function axis(a: number, b: number, half: number, current: number): number[] {
  if (b - a <= half * 2) return [Math.max(Math.max(a, b - half), Math.min(Math.min(b, a + half), current))];
  const count = Math.ceil((b - a - half * 2) / (half * 2));
  return Array.from({ length: count + 1 }, (_, i) => a + half + ((b - a - half * 2) * i) / count);
}
// The serpentine scan of a region, started from the end nearer the leader.
function scanPoints(area: Area, from: Point): Point[] {
  const [x1, y1, x2, y2] = area.boundary!;
  const origin = from.map === area.map ? from : area;
  const xs = axis(x1, x2, GAME_VISION[0] / 2, origin.x), ys = axis(y1, y2, GAME_VISION[1] / 2, origin.y);
  const points = ys.flatMap((y, i) => (i % 2 ? xs.slice().reverse() : xs).map(x => ({ map: area.map, x, y })));
  if (apart(from, points.at(-1)) < apart(from, points[0])) points.reverse();
  return points;
}
/** The region to wait in after a kill: the one the leader stands in, else the shortest planned walk. */
async function waitingRegion(areas: Area[], from: Point, routeDistance: (from: Point, to: Point) => Promise<number>): Promise<Area | null> {
  const current = areas.find(a => a.map === from.map && contains(a, from, 0, 1));
  if (current) return current;
  const scored = await Promise.all(areas.map(async area => {
    try { return { area, length: await routeDistance(from, scanPoints(area, from)[0]!) }; } catch { return { area, length: Infinity }; }
  }));
  return scored.filter(s => Number.isFinite(s.length)).sort((a, b) => a.length - b.length)[0]?.area || null;
}

// ---- The bridge to grouped combat ----

type Fighting = { id: string; map: string; in?: string | number; server?: string; state?: string; external?: boolean } | null | undefined;

// The queue's facts come from the targeting owner's `targeting.groupView`. The rejections are the rare's own, and the targeting owner's
// queue drops them from its evidence, fights and queue as b9b5c91e's `release` did.
// A rejection lasts until the rare attacks a member or dies (`ended`): its next spawn is a
// new instance under a new id.
function groupedView(state: RareState, members: () => string[], view: () => GroupView | undefined, ended: (key: string) => boolean) {
  const reports = () => Object.values(state.statuses);
  // A sight's server is that of a member in its realm, else the realm's server half.
  const serverOf = (sight: RareSight) => reports().find(s => realmOf(s) === sight.realm)?.server || sight.realm.split(':').at(-1)!;
  const realmOfServer = (server?: string) => { const s = reports().find(r => r.server === server); return s ? realmOf(s) : ':' + server; };
  const same = (fight: Fighting, sight: RareSight) => !!fight && fight.id === sight.id && fight.map === sight.map &&
    String(fight.in ?? fight.map) === String(sight.in) && realmOfServer(fight.server) === sight.realm;
  const list = (value: unknown) => (Array.isArray(value) ? value : []) as Fighting[];
  const has = (value: unknown, sight: RareSight) => list(value).some(f => same(f, sight));
  const held = new Map<string, RareRejected>();
  return {
    // The group fights grouped: more than one member, one of them on the grouped protocol, no scatter.
    grouped: () => state.partyFarmingMode !== 'scatter' && members().length > 1 &&
      members().some(name => currentQueue(state.statuses[name]?.groupedCombat)),
    selected: (sight: RareSight) => same(view()?.locked as Fighting, sight),
    queued: (sight: RareSight) => has(view()?.queued, sight),
    locked: (sight: RareSight) => has(view()?.engaged, sight),
    engaged: (sight: RareSight) => list(view()?.engaged).some(f => same(f, sight) && f!.state === 'engaged'),
    busy: () => list(view()?.engaged).length > 0,
    killed: (sight: RareSight) => has(view()?.killed, sight),
    claimed: (sight: RareSight) => list(view()?.claimed).some(c => same(c, sight) && !!c!.external),
    // The targeting owner's lost list retired the rare for the party's travel at or after `since` (its travel
    // retirement, snapshot.ts `retireTravelTargets`).
    retiredForTravel: (sight: RareSight, since: number) => (view()?.lost ?? []).some(l =>
      same(l as unknown as Fighting, sight) && l.retiredAt >= since && l.reason.startsWith('released for travel')),
    // Every member's report acknowledges the queue's revision.
    acknowledged: () => { const v = view(); return !!v?.revision && members().every(name => v.acknowledgements.includes(name)); },
    rejected: (sight: RareSight) => held.get(rareKey(sight))?.until === Number.MAX_SAFE_INTEGER,
    allow: (sight: RareSight) => { held.delete(rareKey(sight)); },
    // The queue keeps the rare out until `until`; a member still attacking it keeps its fight.
    release(sight: RareSight, until: number, rejectedAt: number): void {
      // The targeting owner's queue keeps a listed rejection (`expiresAt`); this list drops it once it ended.
      held.set(rareKey(sight), { ...sight, server: serverOf(sight), until, rejectedAt, expiresAt: Number.MAX_SAFE_INTEGER });
    },
    // The rejections the targeting owner's queue still remembers.
    rejections(): RareRejected[] {
      for (const key of held.keys()) if (ended(key)) held.delete(key);
      return [...held.values()];
    },
    // The targeting owner's selected target as a sight. The view has no HP for it, so it reports 1; its sighting time
    // is the queue's last evaluation, as b9b5c91e's bridge read the grouped record's `seenAt`.
    current(): RareSight | null {
      const v = view(), t = v?.locked as (Fight & { server?: string }) | null | undefined;
      if (!t) return null;
      return { ...t, realm: realmOfServer(t.server), in: String(t.in ?? t.map), hp: 1, reporter: state.leader, seenAt: v!.seenAt };
    },
  };
}

// ---- The service ----

/**
 * The group's rare service: one per group whose task table's `groups` column runs the `rare` source. The
 * coordinator hands it the group's whole state, of which it reads the rare's fields.
 */
export function createRares(input: unknown, ports: RarePorts) {
  const state = input as RareState;
  const now = ports.now || Date.now;
  const members = () => ports.members();
  const leader = () => state.statuses[state.leader]!;
  // A cooldown holds the rare as its encounter ended (`endedAt`) until a newer sighting shows what
  // the end read changed, or any newer sighting for an end that read nothing of it (`read`).
  const sightings = new Map<string, RareSight>(), cooldowns = new Map<string, RareSight & { endedAt: number; read: boolean }>();
  const kills = new Map<string, number>();
  const diagnostics = new Set<string>();
  // One report round (the rework pass's common reading): every member has sent a rare observation
  // stamped after `at`.
  const observedAfter = (name: string, at: number) => Number(state.statuses[name]?.rareObservation?.at) > at;
  const reportRound = (at: number) => members().every(name => observedAfter(name, at));
  let encounter: RareEncounter | null = null, patrol: PhoenixPatrol | null = null, serial = 0, lastMessage: string | null = null;
  const combat = groupedView(state, members, () => {
    const group = ports.group();
    return group ? partyHooks().targeting.groupView({ group }) : undefined;
  }, key => kills.has(key) || members().includes(String(sightings.get(key)?.target)));

  // ---- Records and logs ----

  // The rejections of failed pursuits (2.3 `rare`): a rejected rare is tried again only on new
  // evidence that its pursuit can go further. Each change is a new record value.
  function reject(sight: RareSight, origin: Point): void {
    writeRare(state, { rareRetryEvidence: keepRejections({ ...state.rareRetryEvidence, [rareKey(sight)]: rareRejection(sight, origin) }) });
  }
  function unreject(key: string): void {
    if (!state.rareRetryEvidence?.[key]) return;
    const { [key]: _ended, ...rest } = state.rareRetryEvidence;
    writeRare(state, { rareRetryEvidence: rest });
  }
  // New evidence: a newer sighting with less HP, newly engaged by the party, or newly in a member's
  // reach, on the group's map. It lifts the rejection.
  function renewed(sight: RareSight, origin: Point, reachable: boolean): boolean {
    const id = rareKey(sight), old = state.rareRetryEvidence?.[id];
    if (!old) return true;
    const changed = sight.seenAt > old.sight.seenAt && origin.map === sight.map &&
      (sight.hp < old.sight.hp || !!sight.partyEngaged && !old.sight.partyEngaged || reachable && !old.sight.reachable);
    if (changed) unreject(id);
    return changed;
  }
  // The diagnostics and log entries of the current encounter, or of the patrol between encounters
  //: a new one clears the written marks and the earlier one's entries from the leader's log.
  // Each entry names its encounter (`details.rare`); the log's other entries stay. A line is written
  // once per message and rare within it.
  let logged: string | null = null;
  function diagnostic(message: string, detail: { id?: string; [key: string]: unknown }) {
    const scope = encounter?.id || (patrol ? 'patrol' : 'idle'), entries = (state.combatLogs ||= {})[state.leader] ||= [];
    if (scope !== logged) {
      diagnostics.clear();
      const earlier = (entry: { details?: unknown }) => typeof (entry.details as { rare?: unknown } | null)?.rare === 'string';
      entries.splice(0, entries.length, ...entries.filter(entry => !earlier(entry)));
      logged = scope;
    }
    const id = message + ':' + (detail.id || '');
    if (diagnostics.has(id)) return;
    diagnostics.add(id);
    appendCombatLog(state.combatLogs, state.leader, { at: now(), type: 'navigation', message, details: { ...detail, rare: scope } });
  }
  const priorityOf = (mtype: string) => played(state, 'passiveHunting')?.rules[mtype]?.priority ?? legacyPriorities[mtype] ?? 100;
  const known = (mtype: string) => mtype !== 'fieldgen0' && (Object.hasOwn(legacyPriorities, mtype) || !!played(state, 'passiveHunting')?.rules[mtype]?.enabled);

  // ---- What holds the rare back ----

  /**
   * The rare yields while the tasks owner's task table refuses it against the party's live task: the
   * escape, the death recovery, a trip the player started, an errand, event attendance and return,
   * and the Hunt hand-in. It also yields to its owners' answers where no 01 task runs:
   * - the survival owner's `survival.escaping`: an escape at `home` or `complete` holds its members until the
   *   player's release, after its task has ended;
   * - the events owner's `event.cycle`: the anniversary's staging and the cycle's own return;
   * - a member's movement holder above `rare` in the rank table (its report's `movementLive`,
   *   movement's `live()`): a player's command, the party Town's walk, the member's own death
   *   recovery or escape walk;
   * - the hunting owner's own intents: a member whose navigation a command cancelled, which the party Town does
   *   for every member before any of them reports its Town walk.
   * The rest are reads of their owners: the leader's presence (02), a member's own report and
   * survival's low line (05, `survival.low`), and the Hunt's loot, which is the hunting owner's own record.
   */
  function protectedActivity(): boolean {
    const lead = leader();
    if (!lead || !fresh(lead.seenAt, now()) || lead.rip) return true;
    if (ports.taskRefuses() || partyHooks().ask('event.cycle') === true) return true;
    if (state.monsterHunt?.loot && !state.monsterHunt.loot.complete) return true;
    return members().some(memberHeld);
  }
  function memberHeld(name: string): boolean {
    const s = state.statuses[name], holder = s?.movementLive?.tier;
    return !!s?.rip || partyHooks().survival.low(name) || !!partyHooks().survival.escaping(name) || !!ports.intent(name).cancelled ||
      !!holder && Object.hasOwn(TIERS, holder) && TIERS[holder as Tier].rank > TIERS.rare.rank;
  }

  // ---- Who started the walk ----

  function capture(): RareOwner {
    return {
      leader: state.leader,
      realm: realmOf(leader()),
      focus: JSON.stringify(state.monsterFocus),
      // The target mode, so a target change ends the rare's walk and a combat mode change does not
      //.
      policy: state.targetMode,
      revisions: Object.fromEntries(members().map(n => [n, ports.intent(n).revision])),
    };
  }
  function validIntent(owner: RareOwner): boolean {
    const lead = leader();
    return owner.leader === state.leader && (!lead || !fresh(lead.seenAt, now()) || owner.realm === realmOf(lead)) &&
      owner.focus === JSON.stringify(state.monsterFocus) && owner.policy === state.targetMode &&
      Object.entries(owner.revisions).every(([n, revision]) => !ports.intent(n).cancelled && ports.intent(n).revision === revision);
  }
  function cancelTravel(): void {
    if (rareWalkKind(state.activeConvoy?.purpose)) ports.cancelConvoy();
  }

  // ---- The rare's state for the reply and the dashboard ----

  function publish(message?: string): void {
    if (message) lastMessage = message;
    const next = {
      encounter: encounter && { id: encounter.id, revisions: encounter.revisions, mtype: encounter.target.mtype, stage: encounter.stage,
        generator: encounter.generator, message: encounter.message },
      patrol: patrol && { active: true, paused: !!patrol.paused, index: patrol.index, total: state.phoenixRouteOrder.length, stage: patrol.stage,
        message: patrol.message, incomplete: patrol.incomplete, regionId: state.phoenixRouteOrder[patrol.index],
        waypoint: patrol.points[patrol.point], readyAt: patrol.readyAt, retryReason: patrol.retryReason },
      message: message || encounter?.message || patrol?.message || lastMessage,
    };
    // The state is written only when it changed.
    if (JSON.stringify(next) !== JSON.stringify(state.rareHuntState)) writeRare(state, { rareHuntState: next });
  }

  // ---- Sightings and kills ----

  function report(name: string, input: unknown): void {
    const status = input as RareStatus;
    if (!members().includes(name) || status.ctype === 'merchant' || !fresh(status.seenAt, now())) return;
    reportObservations(name, status);
    // The character bounds its kills and sightings (character/rares.ts).
    for (const kill of Array.isArray(status.rareKills) ? status.rareKills : []) reportKill(status, kill);
  }
  function reportObservations(name: string, status: RareStatus): void {
    const observation = status.rareObservation;
    if (!observation) {
      for (const r of status.rareSightings || []) reportSight(name, status, r, now());
      return;
    }
    // An observation counts from the runtime the member reports now, stamped within the `report`
    // age and at most 1 s ahead (3.7 `report-wide`).
    if (observation.runtimeId !== status.combatSelection?.runtimeId || !fresh(observation.at, now(), 'report', 1000)) return;
    if (!Array.isArray(observation.sightings)) return;
    const observed = { ...status, ...observation };
    for (const r of observation.sightings) reportSight(name, observed, r, Math.min(now(), observation.at));
    // A sighting inside this member's view that its observation does not list is gone.
    const listed = new Set(observation.sightings.map(r => r.id));
    for (const [k, s] of sightings)
      if (s.realm === realmOf(observed) && s.map === observed.map && s.in === instanceOf(observed) && !listed.has(s.id) && inView(observation, s))
        forget(k);
  }
  // A sighting goes with its cooldown, which then no longer holds the targeting owner's queue unless a rejection does.
  function forget(key: string): void {
    const ended = cooldowns.get(key);
    sightings.delete(key);
    cooldowns.delete(key);
    if (ended && !state.rareRetryEvidence?.[key]) combat.allow(ended);
  }
  function reportSight(name: string, status: RareStatus, r: RareSight, observedAt: number): void {
    if (!known(r.mtype) || typeof r.id !== 'string' || !r.visible) return;
    if (!Number.isFinite(r.x) || !Number.isFinite(r.y) || !Number.isFinite(r.hp) || r.hp <= 0) return;
    const sight: RareSight = { id: r.id, mtype: r.mtype, x: r.x, y: r.y, hp: r.hp, level: r.level, target: r.target,
      reachable: r.reachable === true, partyEngaged: r.partyEngaged === true, map: status.map, in: instanceOf(status),
      realm: realmOf(status), seenAt: observedAt, reporter: name, visible: true };
    sightings.set(rareKey(sight), sight);
    if (patrol && sight.mtype === 'phoenix')
      diagnostic('Phoenix sighting received', { id: sight.id, reporter: sight.reporter, map: sight.map, x: sight.x, y: sight.y, observedAt: sight.seenAt });
    if (r.partyEngaged && encounter && rareKey(sight) === rareKey(encounter.target)) encounter.engaged = true;
  }
  function reportKill(status: RareStatus, r: NonNullable<RareStatus['rareKills']>[number]): void {
    if (!known(r.mtype) || r.map !== status.map || String(r.in) !== instanceOf(status)) return;
    // A kill counts until the monster's respawn time (G.monsters[mtype].respawn, seconds)
    // has passed since it; a monster with none respawns under a new id, so its kill counts once.
    const respawnMs = Math.max(0, Number(ports.monsters()?.[r.mtype]?.respawn) || 0) * 1000;
    if (!Number.isFinite(r.at) || r.at + respawnMs < now() && respawnMs > 0) return;
    const id = rareKey({ ...r, realm: realmOf(status) });
    kills.set(id, r.at + respawnMs);
    sightings.delete(id);
    cooldowns.delete(id);
    // The retry evidence and the pursuit progress are kept for an instance not seen dead, so they
    // end with it.
    unreject(id);
    if (state.rarePursuitProgress?.[id]) writeRare(state, { rarePursuitProgress: {} });
    if (!encounter || id !== rareKey(encounter.target) || r.at < encounter.start) return;
    encounter.deathAt = Math.min(encounter.deathAt ?? r.at, r.at);
    if (r.partyEngaged) encounter.engaged = true;
  }
  // The view rule for the places the party left: a sighting or cooldown goes once no member's
  // fresh report stands on its realm, map and instance.
  const placeOf = (s: { realm: string; map?: string; in?: string }) => `${s.realm}|${s.map}|${s.in}`;
  function expireObservations(): void {
    for (const [k, t] of kills) if (t <= now()) kills.delete(k);
    const here = new Set(members().flatMap(name => {
      const s = state.statuses[name];
      return s && fresh(s.seenAt, now()) ? [placeOf({ realm: realmOf(s), map: s.map, in: instanceOf(s) })] : [];
    }));
    for (const [key, s] of [...sightings, ...cooldowns]) if (!here.has(placeOf(s))) forget(key);
  }
  // A sighting from a member on the leader's map, instance and realm, within the `report` age.
  function localFresh(s: RareSight): boolean {
    const lead = leader();
    return members().includes(s.reporter) && s.map === lead.map && s.in === instanceOf(lead) && s.realm === realmOf(lead) && fresh(s.seenAt, now());
  }

  // ---- Which rare the group takes ----

  // The patrol assists a Phoenix kill, so no claim or rule holds it back.
  const assist = (target: RareSight) => !!patrol && !patrol.paused && target.mtype === 'phoenix';
  const claimed = (target: RareSight) => !assist(target) && combat.claimed(target);
  const outsideClaim = (s: RareSight) => !assist(s) && !!s.target && !members().includes(s.target);
  function enabled(s: RareSight): boolean {
    return played(state, 'passiveRareHunts')[s.mtype] && passiveLevelAllowed(played(state, 'passiveHunting')?.rules[s.mtype], s.level) || assist(s) || combat.locked(s);
  }
  // A rejected rare is taken again only on new evidence; then the targeting owner's queue lets it go too.
  function retryEligible(s: RareSight): boolean {
    const rejected = !!state.rareRetryEvidence?.[rareKey(s)];
    const reachable = s.reachable === true && members().some(n => {
      const m = state.statuses[n];
      return !!m && fresh(m.seenAt, now()) && realmOf(m) === s.realm && instanceOf(m) === s.in && Number(m.range) > 0 && apart(m, s) <= Number(m.range);
    });
    if (!renewed(s, leader(), reachable)) return false;
    if (rejected) { combat.allow(s); ports.persist(); }
    return true;
  }
  // A keep-moving rule passes the rare by, except a Phoenix the patrol looks for.
  const committedCandidate = (s: RareSight) => !(played(state, 'passiveHunting')?.rules[s.mtype]?.keepMoving && !(s.mtype === 'phoenix' && patrol));
  function eligible(s: RareSight): boolean {
    return known(s.mtype) && retryEligible(s) && committedCandidate(s) && !cooling(s) && !kills.has(rareKey(s)) && !claimed(s) && !!enabled(s);
  }
  // An ended encounter's rare cools until a sighting after the end shows what the end read changed
  // (rules.ts `rareEndReadsRare`); then the targeting owner's queue lets it go too, unless a rejection still holds it
  // (retryEligible).
  function cool(target: RareSight, code: RareEnd): void {
    cooldowns.set(rareKey(target), { ...target, endedAt: now(), read: rareEndReadsRare(code) });
    combat.release(target, Number.MAX_SAFE_INTEGER, now());
  }
  function cooling(s: RareSight): boolean {
    const key = rareKey(s), ended = cooldowns.get(key);
    if (!ended) return false;
    const changed = s.seenAt > ended.endedAt && (!ended.read || s.target !== ended.target || s.hp !== ended.hp ||
      s.reachable !== ended.reachable || s.partyEngaged !== ended.partyEngaged);
    if (!changed) return true;
    cooldowns.delete(key);
    if (!state.rareRetryEvidence?.[key]) combat.allow(s);
    return false;
  }
  // A new rare outranks the encounter under way, or the leader's own target by its priority.
  function priorityAllowed(s: RareSight): boolean {
    if (encounter)
      return encounter.stage !== 'loot' && !kills.has(rareKey(encounter.target)) && priorityOf(s.mtype) > priorityOf(encounter.target.mtype);
    const current = leader()?.target, priorities = state.monsterPrioritiesByCharacter?.[state.leader] || {};
    const saved = current ? Number(priorities[current.mtype]) : NaN;
    const held = current ? played(state, 'passiveRareHunts')[current.mtype] ? priorityOf(current.mtype) : Number.isFinite(saved) ? saved : MONSTER_PRIORITY.unset : 0;
    return priorityOf(s.mtype) >= held;
  }
  // During grouped combat a passing rare interrupts only the live task's walk, as its task row
  // allows.
  const travelAllows = (mtype: string) => !!state.activeConvoy && !ports.taskRefuses(mtype);
  function acquirePassive(): void {
    if (combat.busy()) return;
    const grouped = combat.grouped();
    const candidate = [...sightings.values()]
      .filter(s => localFresh(s) && eligible(s) && !outsideClaim(s) && priorityAllowed(s) && !ports.taskRefuses(s.mtype) && (!grouped || travelAllows(s.mtype)))
      .sort((a, b) => priorityOf(b.mtype) - priorityOf(a.mtype) || apart(leader(), a) - apart(leader(), b))[0];
    if (candidate) begin(candidate);
  }
  function acquirePatrolSighting(): void {
    if (!patrol || patrol.paused || encounter || combat.busy()) return;
    if (state.activeConvoy && state.activeConvoy.purpose !== PATROL_WALK) return;
    const candidate = [...sightings.values()].filter(s => s.mtype === 'phoenix' && s.visible && localFresh(s) && eligible(s))
      .sort((a, b) => apart(leader(), a) - apart(leader(), b))[0];
    if (candidate) begin(candidate);
  }
  function acquireGrouped(): void {
    const current = combat.current();
    // The bridge's HP is a placeholder, so the members' own sighting stands in where there is one.
    const sight = current && (sightings.get(rareKey(current)) || current);
    if (!encounter && sight && eligible(sight)) begin(sight);
  }

  // ---- The encounter (HNT-069 to HNT-076) ----

  function deployer(target: RareSight): string | null {
    if (played(state, 'passiveHunting')?.useFieldGenerators === false) return null;
    return members().filter(n => (state.statuses[n]?.items || []).some(i => i?.item?.name === 'fieldgen0'))
      .sort((a, b) => apart(state.statuses[a], target) - apart(state.statuses[b], target))[0] || null;
  }
  function begin(target: RareSight): void {
    // A task above rare holds the group (01 design 2.1), so this sighting waits for the next one.
    if (ports.taskRefuses()) return;
    ports.reconcileHuntArrival();
    diagnostic('Rare sighting handed to combat', { id: target.id, mtype: target.mtype, reporter: target.reporter });
    if (encounter) end('cancelled');
    // The encounter is the tasks owner's `rare` task, which suspends the farming or Hunt task, so the walk
    // under way ends here as the tasks owner's takeover would end it, and the rare commits nothing into it.
    if (state.activeConvoy) ports.cancelConvoy();
    // The combat mode answer's rare row answers grouped from the next reply on (modes.ts reads `rareOwns`), so the
    // encounter writes nothing of the mode or the scatter break.
    encounter = { ...capture(), id: `rare-${now()}-${++serial}`, target, start: now(), lastSeen: now(),
      stage: 'approach', awaitingSelection: combat.grouped(), generator: 'none', message: rareLabel('approach', rareName(target.mtype)) };
    // The live encounter's start, the one pursuit the record keeps, survives a restart under the
    // rare's key and no total limit keeps older ones.
    const saved = state.rarePursuitProgress?.[rareKey(target)];
    if (saved) encounter.start = saved.start;
    writeRare(state, { rarePursuitProgress: { [rareKey(target)]: { start: encounter.start } } });
    partyHooks().notify('rare.encounter', { group: ports.group(), target: { id: target.id, mtype: target.mtype, map: target.map },
      change: 'started', by: patrol && target.mtype === 'phoenix' ? 'core:hunting' : 'passive rule' });
    ports.persist();
    if (target.mtype === 'tinyp') {
      encounter.deployer = deployer(target);
      encounter.generator = encounter.deployer ? 'approaching' : 'unavailable; ordinary attacks';
    }
  }
  // The rare is unseen once the members whose view covers its last spot have each sent one
  // observation after its last sighting without it, and lost once every member has.
  const lost = (e: RareEncounter) => reportRound(e.lastSeen);
  function unseen(e: RareEncounter): boolean {
    const near = members().filter(name => {
      const o = state.statuses[name]?.rareObservation;
      return !!o && o.map === e.target.map && String(o.in) === e.target.in && inView(o, e.target);
    });
    return near.length > 0 && near.every(name => observedAfter(name, e.lastSeen)) || lost(e);
  }
  // The walk toward the rare ended with no progress, by movement's verdicts: the rare's own
  // walk failed, or every member approaching it reports its approach blocked. In combat the rare's
  // HP is the progress: no new low within RARE_PROGRESS_BOUND_MS of the fight's start, of its last
  // low or of the party's last fight against other attackers trips the kept bound.
  function stalled(e: RareEncounter): boolean {
    if (e.stage === 'combat') {
      // b9b5c91e rare-hunting.ts:485-496: while 04 has not selected the rare and other monsters attack
      // the party, the party is not idle, so the wait starts again (`combatAt`).
      if (!combat.selected(e.target) && members().some(name => fightingOthers(name, e))) e.combatAt = now();
      const since = Math.max(e.lowHpAt ?? 0, e.combatAt ?? e.start), waited = now() - since;
      if (waited < RARE_PROGRESS_BOUND_MS) return false;
      boundFired({ bound: 'RARE_PROGRESS_BOUND_MS', owner: '07', subject: e.target.id,
        state: { id: e.id, mtype: e.target.mtype, map: e.target.map, hp: e.target.hp, lowHp: e.lowHp ?? null, waited } });
      return true;
    }
    const walk = state.activeConvoy;
    if (walk?.purpose === RARE_WALK && walk.phase === 'failed') return true;
    const approaching = members().map(name => approachOf(name, e)).filter(a => !!a);
    return approaching.length > 0 && approaching.every(a => !!a!.blocked);
  }
  // A member's fresh report of its own approach to the rare (the targeting owner's grouped combat), or null.
  function approachOf(name: string, e: RareEncounter) {
    const s = state.statuses[name], approach = s?.groupedCombat?.approach;
    return s && fresh(s.seenAt, now()) && approach?.active &&
      approach.target === JSON.stringify([s.server, e.target.map, e.target.in, e.target.id]) ? approach : null;
  }
  // A member's fresh attackers report names a monster other than the rare on a member.
  function fightingOthers(name: string, e: RareEncounter): boolean {
    const s = state.statuses[name], g = s?.groupedCombat;
    return !!s && fresh(s.seenAt, now()) && fresh(g?.currentAttackersAt, now()) &&
      (g?.currentAttackers || []).some(t => t.id !== e.target.id && t.map === s.map && members().includes(t.target));
  }
  // The end an encounter reached, or null while it goes on. A lost sight counts as no progress,
  // as b9b5c91e's shared message rejected it; the encounter has no total limit.
  function encounterExpired(e: RareEncounter): RareEnd | null {
    if (!unseen(e) && e.target.target && members().includes(e.target.target)) return null;
    if (!e.engaged && (claimed(e.target) || outsideClaim(e.target) || unseen(e))) return 'claimed';
    return lost(e) || stalled(e) ? 'no-progress' : null;
  }
  function refreshEncounter(e: RareEncounter): void {
    const sight = sightings.get(rareKey(e.target));
    if (!sight || sight.seenAt <= e.lastSeen) return;
    e.target = sight;
    e.lastSeen = sight.seenAt;
    if (e.lowHp === undefined || sight.hp < e.lowHp) { e.lowHp = sight.hp; e.lowHpAt = sight.seenAt; }
  }
  // Grouped combat walks for itself; otherwise the group fights a rare the leader sees and walks
  // to one it does not.
  function encounterMovement(e: RareEncounter): void {
    const lead = leader();
    const visible = lead.map === e.target.map && instanceOf(lead) === e.target.in && (lead.rareSightings || []).some(s => s.id === e.target.id && s.visible);
    if (combat.grouped()) {
      cancelTravel();
      e.stage = combat.locked(e.target) ? 'combat' : 'approach';
    } else if (visible) {
      cancelTravel();
      e.stage = 'combat';
    } else {
      e.stage = 'approach';
      // The walk goes again once no walk runs and the leader has reported since the last
      // issue, a report that shows it not walking it.
      if (!state.activeConvoy && (!e.travelAt || Number(lead.seenAt) > e.travelAt)) {
        e.travelAt = now();
        ports.convoy(e.target, 'Pursuing rare sighting', members(), RARE_WALK);
      }
    }
    if (e.stage === 'combat' && !e.combatAt) e.combatAt = now();
  }
  // The Fairy's field: a member reports a field within its reach of the Fairy, or the
  // deployer's receipt, or the encounter falls back to ordinary attacks.
  function fieldAt(target: RareSight): boolean {
    return Object.values(state.statuses).some(s => fresh(s.seenAt, now()) && realmOf(s) === target.realm && s.map === target.map &&
      instanceOf(s) === target.in && (s.rareFields || []).some(f => Number.isFinite(f.x) && Number.isFinite(f.y) &&
        Math.hypot(f.x - target.x, f.y - target.y) < GAME_FIELD_REACH));
  }
  function tickGenerator(e: RareEncounter): void {
    if (e.target.mtype !== 'tinyp') return;
    if (fieldAt(e.target)) { e.generator = 'field active'; e.deployer = null; return; }
    if (!e.deployer) {
      if (e.generator === 'field active') e.generator = 'outside field; ordinary attacks';
      return;
    }
    // The report that carries the deployment stamps it; the deployer's next report confirms
    // the field (fieldAt above), so a next report without it shows the generator spent or refused,
    // and the encounter falls back to ordinary attacks.
    const status = state.statuses[e.deployer], result = status?.rareDeployment;
    // The deployer's turn also ends on movement's verdict for its own approach, as b9b5c91e fell back
    // to ordinary attacks when the deployer could not reach the Fairy.
    if (result?.encounterId !== e.id && approachOf(e.deployer, e)?.blocked) {
      e.generator = 'deployer blocked; ordinary attacks';
      e.deployer = null;
      return;
    }
    if (result?.encounterId === e.id) {
      e.deployedAt ||= Number(status!.seenAt);
      e.generator = 'confirming deployment';
      if (result.failed || Number(status!.seenAt) > e.deployedAt) {
        e.generator = 'deployment unconfirmed; ordinary attacks';
        e.deployer = null;
      }
    }
  }
  const dead = (e: RareEncounter) => e.stage === 'loot' || kills.has(rareKey(e.target)) || combat.killed(e.target);
  function finishDead(e: RareEncounter): void {
    e.deathAt ||= now();
    if (!e.engaged) {
      if (assist(e.target)) prepareWait(e);
      finish('died');
      return;
    }
    if (combat.busy()) {
      cancelTravel();
      e.stage = 'loot';
      e.deployer = null;
      e.message = rareLabel('finishing', rareName(e.target.mtype));
      return;
    }
    if (!e.killedAt) {
      e.killedAt = now();
      e.stage = 'loot';
      e.deployer = null;
      cancelTravel();
    }
    e.message = rareLabel('loot', rareName(e.target.mtype));
    if (collected(e)) finish('killed');
  }
  // The loot receipt: the leader's rare loot pass for this encounter after the kill.
  function collected(e: RareEncounter): boolean {
    const lead = leader();
    if (!lead || !fresh(lead.seenAt, now())) return false;
    const result = lead.rareLoot;
    return !!result?.complete && result.id === e.id && result.observedAt > e.killedAt! && lootPlace(e, result);
  }
  const lootPlace = (e: RareEncounter, r: { realm: string; map: string; in: string }) =>
    r.realm === e.target.realm && r.map === e.target.map && String(r.in) === e.target.in;
  function tickEncounter(): void {
    const e = encounter!;
    if (!validIntent(e)) { stop('Rare pursuit cancelled by new navigation'); return; }
    if (combat.engaged(e.target)) e.engaged = true;
    if (dead(e)) { finishDead(e); return; }
    if (!enabled(e.target)) { finish('disabled'); return; }
    refreshEncounter(e);
    const expired = encounterExpired(e);
    if (expired) { finish(expired); return; }
    encounterMovement(e);
    tickGenerator(e);
    e.message = rareLabel(e.stage === 'combat' ? 'combat' : 'approach', rareName(e.target.mtype), e.target.mtype === 'tinyp' ? e.generator : undefined);
  }
  // The encounter's one end, with its code: a rejecting end records its rejection, add-ons hear the
  // end, the rare cools down and the targeting owner's queue releases it. 01 then resumes the task the encounter
  // suspended, which walks the group back to its spot. It answers the end's status line.
  function end(code: RareEnd): string {
    const e = encounter!, killed = code === 'killed', reason = rareEndLabel(code, rareName(e.target.mtype));
    // An end that lets the rare be asked again rejects it when an add-on's `retry.policy` gives up.
    if (rareEndRejects(code) || !killed && partyHooks().retry.policy({ owner: '07', subject: e.target.mtype, failure: code, attempt: 1 },
      { wait: 0, giveUp: false, counts: false }).giveUp) reject(e.target, leader());
    partyHooks().notify('rare.encounter', { group: ports.group(), target: { id: e.target.id, mtype: e.target.mtype, map: e.target.map },
      change: 'ended', code, by: 'core:hunting' });
    writeRare(state, { rarePursuitProgress: {} });
    encounter = null;
    cancelTravel();
    if (!killed) cool(e.target, code);
    else combat.release(e.target, Number.MAX_SAFE_INTEGER, now());
    diagnostic('Rare pursuit ended', { id: e.target.id, code, reason });
    if (patrol && e.target.mtype === 'phoenix' && killed) prepareWait(e);
    return reason;
  }
  function finish(code: RareEnd): void {
    if (!encounter) return;
    publish(end(code));
    ports.persist();
  }
  function stop(reason = 'Rare hunting cancelled'): void {
    if (encounter) end('cancelled');
    patrol = null;
    writeRare(state, { phoenixPatrolActive: false, phoenixPatrolCheckpoint: null });
    cancelTravel();
    publish(reason);
    ports.persist();
  }

  // ---- Grouped combat ----

  // Before the targeting owner's clients switch out of scatter, their old reports read as no selection, so a
  // nomination counts as released only after one report round since it with no member taking it, or
  // once every member acknowledged the queue.
  function released(e: RareEncounter): boolean {
    if (e.awaitingSelection) {
      if (!combat.locked(e.target) && !(combat.selected(e.target) && combat.acknowledged()))
        return reportRound(e.start);
      e.awaitingSelection = false;
      diagnostic('Rare target selected', { id: e.target.id, mtype: e.target.mtype });
    }
    // A pending fight of the group goes first; a rare still queued behind it is not released.
    const queued = combat.queued(e.target) && !claimed(e.target);
    return !combat.selected(e.target) && !queued && !combat.locked(e.target) && !dead(e);
  }
  function groupedTick(): boolean {
    if (!combat.grouped()) return false;
    if (encounter && !encounter.engaged && !combat.locked(encounter.target) && claimed(encounter.target))
      finish('claimed');
    if (encounter && released(encounter)) finish(combat.retiredForTravel(encounter.target, encounter.start) ? 'yielded' : 'released');
    acquireGrouped();
    if (encounter) { tickEncounter(); publish(); return true; }
    if (!combat.busy()) return false;
    cancelTravel();
    publish('Finishing party combat');
    return true;
  }

  // ---- The Phoenix patrol ----

  function savePatrol(): void {
    writeRare(state, { phoenixPatrolCheckpoint: patrol ? { leader: patrol.leader, realm: patrol.realm, focus: patrol.focus, policy: patrol.policy,
      revisions: { ...patrol.revisions }, regionId: state.phoenixRouteOrder[patrol.index]!, readyAt: patrol.readyAt,
      ...patrol.diedAt === undefined ? {} : { diedAt: patrol.diedAt } } satisfies PatrolCheckpoint : null });
    ports.persist();
  }
  function newPatrol(): PhoenixPatrol {
    return { ...capture(), id: `patrol-${now()}-${++serial}`, index: 0, area: null, readyAt: 0, incomplete: [], stage: 'travel',
      points: [], remaining: [], point: 0, arrivedAt: 0 };
  }
  // A restart resumes a saved patrol at its region and respawn wait.
  function restorePatrol(): void {
    if (patrol || !state.phoenixPatrolActive || state.monsterFocus.join(',') !== 'phoenix') return;
    if (!validPhoenixOrder(state.monsterChoices, state.phoenixRouteOrder)) return;
    patrol = newPatrol();
    const saved = state.phoenixPatrolCheckpoint;
    if (saved && validIntent(saved) && state.phoenixRouteOrder.includes(saved.regionId)) {
      patrol.index = state.phoenixRouteOrder.indexOf(saved.regionId);
      patrol.readyAt = Number.isFinite(saved.readyAt) ? saved.readyAt : 0;
      if (Number.isFinite(saved.diedAt)) patrol.diedAt = saved.diedAt;
    }
  }
  const patrolControlId = (p: PhoenixPatrol) => `${p.id}-${p.index}-${p.point}-${p.retry || 0}`;
  const patrolWalk = () => state.activeConvoy?.purpose === PATROL_WALK ? state.activeConvoy : null;
  // The region's scan starts on entry: its stops, its coverage samples and a fresh progress clock.
  function enterRegion(p: PhoenixPatrol): boolean {
    if (p.area) return true;
    p.area = regions(state.monsterChoices).find(a => a.id === state.phoenixRouteOrder[p.index]) || null;
    if (!p.area?.boundary) { stop('Phoenix spawn catalog changed; choose the route again'); return false; }
    Object.assign(p, { points: scanPoints(p.area, leader()), remaining: samples(p.area), point: 0, arrivedAt: 0, climbing: false,
      retryReason: undefined });
    return true;
  }
  // The next region in the order; a patrol with every region left incomplete pauses.
  function nextRegion(p: PhoenixPatrol, incomplete: boolean): void {
    cancelTravel();
    const id = p.area!.id!;
    if (incomplete && !p.incomplete.includes(id)) p.incomplete.push(id);
    if (!incomplete) p.incomplete = p.incomplete.filter(value => value !== id);
    const group = ports.group();
    if (p.incomplete.length === state.phoenixRouteOrder.length) {
      p.paused = true;
      p.message = 'All Phoenix regions unreachable; restart the route to retry';
      partyHooks().notify('rare.patrol', { group, region: id, change: 'paused', by: 'core:hunting' });
      savePatrol();
      return;
    }
    if (!incomplete) partyHooks().notify('rare.patrol', { group, region: id, change: 'region-done', by: 'core:hunting' });
    // `rare.search` (6.1): an add-on may order the same regions; the patrol takes the region after
    // this one in that order, else in the player's.
    const order = partyHooks().hunting.search({ group: String(group ?? ''), regions: state.phoenixRouteOrder, current: id });
    p.index = order ? state.phoenixRouteOrder.indexOf(order[(order.indexOf(id) + 1) % order.length]!) : (p.index + 1) % state.phoenixRouteOrder.length;
    p.area = null;
    p.readyAt = 0;
    p.waitingRegion = false;
    savePatrol();
  }
  // A live member's fresh observation after the respawn wait covers the samples in its view.
  function cover(p: PhoenixPatrol): void {
    if (now() < p.readyAt) return;
    for (const name of members()) {
      const s = state.statuses[name], o = s?.rareObservation;
      if (!s || !fresh(s.seenAt, now()) || s.rip || s.hp === 0 || !o) continue;
      if (o.runtimeId !== s.combatSelection?.runtimeId || o.at < p.readyAt || !fresh(o.at, now(), 'report', 1000)) continue;
      if (o.map !== p.area!.map || o.in !== p.area!.map || `${s.region || ''}:${o.server}` !== p.realm) continue;
      p.remaining = p.remaining.filter(point => !inView(o, point));
    }
  }
  // A coverage sample left that no stop of the region has walked to yet.
  const unwalked = (p: PhoenixPatrol) => p.remaining.find(s => !p.points.some(stop => apart(stop, s) <= ARRIVAL_TOLERANCE));
  // A failed leg climbs the party's farming ladder. The alternative is a
  // coverage sample no stop has walked to, in place of the failed stop. Regroup walks the same stop
  // again, and the safe point starts the region's scan over from its first stop. On the wait rung
  // the region counts incomplete and the patrol goes on to the next region; 01 returns the ladder
  // to its first rung on the next report that shows a change, or on the next stop reached. With no
  // farming task live the region also counts incomplete.
  function legFailed(p: PhoenixPatrol, code: string, reason: string): void {
    cancelTravel();
    p.retryReason = reason;
    p.arrivedAt = 0;
    p.retry = (p.retry || 0) + 1;
    p.climbing = true;
    const other = unwalked(p);
    const rung = ports.ladder().fail(code, { alternative: !!other, trying: `the Phoenix scan stop in region ${p.index + 1}` })?.rung;
    if (rung === 'alternative' && other) p.points[p.point] = { ...other };
    else if (rung === 'safe-point') p.point = 0;
    else if (rung !== 'alternative' && rung !== 'regroup') nextRegion(p, true);
  }
  // At a stop, once every member acknowledged the leg and the leader reported after the walk ended
  // (the settle is the next fresh report): the region is done when no sample is left, else the
  // next stop. After the last stop a sample no stop has walked to is one more stop; a sample left
  // after the party walked to it leaves the region incomplete.
  function arrivedAtStop(p: PhoenixPatrol): void {
    if (patrolWalk()) return;
    cancelTravel();
    // An observation before the respawn wait ends cannot finish the scan after it.
    if (now() < p.readyAt) { p.arrivedAt = 0; return; }
    if (!p.arrivedAt && p.climbing) { p.climbing = false; ports.ladder().progress(); }
    p.arrivedAt ||= now();
    const lead = leader();
    if (!lead || !fresh(lead.seenAt, now()) || Number(lead.seenAt) <= p.arrivedAt) return;
    if (!p.remaining.length) { nextRegion(p, false); return; }
    p.point++;
    p.arrivedAt = 0;
    const other = p.point === p.points.length ? unwalked(p) : undefined;
    if (other) p.points.push({ ...other });
  }
  // A leg lost to a runtime reload waits until every member reported after the loss (the
  // reloaded runtime's next report) and retries the same stop.
  function reconnecting(p: PhoenixPatrol): boolean {
    const walk = patrolWalk();
    if (walk?.phase === 'failed' && ['runtime-lost', 'unavailable'].includes(walk.failureCode || '')) {
      cancelTravel();
      p.retryAt = now();
      p.retry = (p.retry || 0) + 1;
      p.retryReason = 'Party runtime reloaded; retrying the same scan point';
    }
    if (!p.retryAt || members().every(name => { const s = state.statuses[name]; return !!s && fresh(s.seenAt, now()) && Number(s.seenAt) > p.retryAt!; })) {
      p.retryAt = 0;
      return false;
    }
    p.message = 'Waiting for party runtimes before resuming the scan';
    return true;
  }
  function tickPatrol(): void {
    const p = patrol!;
    if (!validIntent(p) || state.targetMode === 'hunt' || state.monsterFocus.join(',') !== 'phoenix') {
      stop('Phoenix patrol cancelled by farming change');
      return;
    }
    if (p.paused || p.choosing || !enterRegion(p) || reconnecting(p)) return;
    const destination = p.points[p.point];
    if (!destination) { nextRegion(p, p.remaining.length > 0); return; }
    if (!respawnKnown(p)) return;
    p.stage = now() < p.readyAt ? 'respawn' : 'scanning';
    const activity = p.stage === 'respawn' ? `Waiting for respawn (${Math.ceil((p.readyAt - now()) / 1000)}s)` : 'Scanning';
    p.message = `${activity} · region ${p.index + 1}/${state.phoenixRouteOrder.length} · ${p.area!.map}`;
    cover(p);
    // The leg's walk ends on its own progress end; a failed walk fails the leg.
    const walk = patrolWalk();
    if (walk?.phase === 'failed') { legFailed(p, walk.failureCode || 'route-failed', 'Scan convoy failed'); return; }
    if (apart(leader(), destination) <= ARRIVAL_TOLERANCE) { arrivedAtStop(p); return; }
    p.arrivedAt = 0;
    // Every scan leg has one walk, the final short approach included.
    if (!state.activeConvoy) {
      ports.convoy(destination, `Phoenix region ${p.index + 1}/${state.phoenixRouteOrder.length}`, members(), PATROL_WALK);
      partyHooks().notify('rare.patrol', { group: ports.group(), region: p.area?.id ?? null, change: 'leg', by: 'core:hunting' });
    }
  }
  // The Phoenix is back the game's respawn time plus the server's jitter after its death (32 s
  // and 0.9 s today, game design/monsters.js:450-451). The respawn time is required game data: with
  // no G.monsters.phoenix.respawn the wait is null.
  function respawnWait(): number | null {
    const respawn = ports.monsters()?.phoenix?.respawn;
    return typeof respawn === 'number' && Number.isFinite(respawn) && respawn >= 0 ? respawn * 1000 + RESPAWN_JITTER_MS : null;
  }
  // A patrol whose kill came before the game's respawn data holds its respawn stage until the data
  // loads, then waits from the death time.
  function respawnKnown(p: PhoenixPatrol): boolean {
    if (p.diedAt === undefined) return true;
    const wait = respawnWait();
    if (wait === null) {
      Object.assign(p, { stage: 'respawn', message: 'Phoenix defeated; waiting for the Phoenix respawn time in game data' });
      return false;
    }
    p.readyAt = p.diedAt + wait;
    delete p.diedAt;
    savePatrol();
    return true;
  }
  // After a Phoenix kill the patrol waits for the respawn in the region the leader stands in, else
  // in the one with the shortest planned walk.
  function prepareWait(e: RareEncounter): void {
    const p = patrol!;
    const areas = state.phoenixRouteOrder.map(id => regions(state.monsterChoices).find(a => a.id === id)!);
    const diedAt = e.deathAt || e.killedAt || now(), wait = respawnWait();
    if (wait === null) boundFired({ bound: 'G.monsters.phoenix.respawn', owner: '07', subject: 'phoenix', state: { patrol: p.id, diedAt } });
    Object.assign(p, wait === null ? { diedAt, message: 'Phoenix defeated; waiting for the Phoenix respawn time in game data' }
      : { readyAt: diedAt + wait, message: `Phoenix defeated; waiting until ${Math.ceil(wait / 1000)} seconds after death` },
    { area: null, stage: 'respawn', points: [], waitingRegion: true });
    const lead = leader();
    const current = areas.find(a => a.map === lead.map && contains(a, lead, 0, 1));
    if (current) {
      p.index = state.phoenixRouteOrder.indexOf(current.id!);
      savePatrol();
      return;
    }
    p.choosing = true;
    void waitingRegion(areas, { map: lead.map, x: lead.x, y: lead.y }, ports.routeDistance.bind(ports)).then(area => {
      if (patrol !== p || !validIntent(p)) return;
      p.choosing = false;
      if (area) p.index = state.phoenixRouteOrder.indexOf(area.id!);
      else {
        p.paused = true;
        p.message = 'Unable to plan a reachable Phoenix waiting region; restart the patrol to retry';
      }
      savePatrol();
      publish();
    });
  }
  // The patrol walks the saved order, which the navigate route wrote through the settings writer
  // before the walk started (saved-fields.ts `phoenixRouteOrder`).
  function start(): void {
    stop();
    writeRare(state, { phoenixPatrolActive: true });
    patrol = newPatrol();
    publish();
    savePatrol();
  }

  // ---- The tick ----

  // A held group pauses the patrol's progress clock and ends an encounter not yet in a fight.
  function pauseProtected(): void {
    if (patrol && sightings.size) diagnostic('Phoenix acquisition waiting for protected activity', {});
    if (encounter && !combat.locked(encounter.target)) finish('interrupted');
    cancelTravel();
    publish(patrol ? 'Phoenix patrol waiting for protected activity' : undefined);
  }
  // The saved rejections stand in the list the targeting owner's queue reads, after a restart too.
  function restoreRejections(): void {
    for (const failed of Object.values(state.rareRetryEvidence || {}))
      if (!combat.rejected(failed.sight)) combat.release(failed.sight, Number.MAX_SAFE_INTEGER, now());
  }
  function tick(): void {
    restoreRejections();
    expireObservations();
    if ((encounter && !validIntent(encounter)) || (patrol && !validIntent(patrol))) { stop('Rare route superseded'); return; }
    if (protectedActivity()) { pauseProtected(); return; }
    restorePatrol();
    acquirePatrolSighting();
    if (groupedTick()) return;
    acquirePassive();
    if (encounter) tickEncounter();
    else if (patrol) tickPatrol();
    publish();
  }

  // ---- The character's rare control ----

  function control(name: string) {
    if (!members().includes(name)) return null;
    if (protectedActivity() && !(encounter && combat.locked(encounter.target))) return null;
    if (encounter)
      return { id: encounter.id, kind: encounter.stage === 'loot' ? 'loot' : 'encounter', target: encounter.target, destination: encounter.target,
        deployer: encounter.deployer, generator: encounter.generator, killedAt: encounter.killedAt, allowPhoenixAssist: !!patrol && !patrol.paused,
        revision: encounter.revisions[name] };
    // A leg lost to a reload hands out no stop until every member reported again (`reconnecting`).
    if (patrol && !patrol.paused && !patrol.retryAt && patrol.points[patrol.point])
      return { id: patrolControlId(patrol), kind: 'patrol', allowPhoenixAssist: true, destination: patrol.points[patrol.point], revision: patrol.revisions[name] };
    return null;
  }

  publish();
  return {
    report,
    tick,
    start,
    stop,
    control,
    owns: () => !!(encounter || patrol),
    // The rejections the targeting owner's grouped queue reads through `farming.focus`.
    rejected: () => combat.rejections(),
    patrolAcquisitionAllowed: () => !!patrol && !patrol.paused && !protectedActivity(),
    // Survival's death recovery ends the encounter.
    abandon: () => {
      if (encounter) end('interrupted');
      cancelTravel();
      publish('Rare encounter abandoned after party death');
      ports.persist();
    },
    // A dead rare's loot holds new pulls.
    blocksPulls: () => !!encounter && (encounter.stage === 'loot' || combat.killed(encounter.target) || kills.has(rareKey(encounter.target))),
    encounter: () => !!encounter,
    // The rare task this encounter describes (01 design 2.1, rank 64), for the group's seat; its
    // "May interrupt Hunt" switch narrows it while off.
    task: () => encounter ? { owner: 'rare:' + encounter.id, members: members(), phase: encounter.stage,
      label: encounter.message || 'Rare ' + encounter.target.mtype, rare: encounter.target.mtype,
      interruptsHunt: played(state, 'passiveHunting')?.rules[encounter.target.mtype]?.interruptsHunt !== false } : null,
    // A passive rules change, written with the switches it commits as one batch through the
    // settings writer; the tick after an accepted write ends an encounter the new rules refuse. The
    // tick runs only while the tasks owner's table lets the rare act, as every other tick.
    setSettings(settings: Record<string, unknown>, by: string): SettingsWriteResult {
      const passiveHunting = applyPassivePatch(state.passiveHunting!, settings);
      const written = ports.write({ by, changes: [{ field: 'passiveHunting', value: passiveHunting },
        { field: 'passiveRareHunts', value: committedPassiveRules(passiveHunting) }] });
      if (written.ok && ports.runs()) tick();
      return written;
    },
  };
}
