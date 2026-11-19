// The character's farming (character/farm.ts): the spawn catalog's global for the role code (areas.ts
// `spawnCatalog`, shared.js `monsterChoices`), and the farm client install.ts installs: the farm part of
// the reply, the farming monster type, the grouped answer, farm area membership and candidates, the entry
// point, the competition evidence and learned one-shot types each report carries, the game's `hit` listener
// (P-05), the saved farm destination, and the farming walk's hand-off. The empty spawn return is the
// coordinator's.
import type { Area, Point } from '../zones.ts';
import { contains, candidates, searchPoints, bounds } from '../zones.ts';
import { inView } from '../../protocol/reports.ts';
import { defaultSearchRadius } from '../zones.ts';
import { answerOf, handoffHeld, type HandoffHolds } from '../rules.ts';
import { spawnCatalog } from '../areas.ts';

// The evidence key's time bucket: two members' copies of one hit share a key. A burn tick carries
// no `pid` (game node/server.js:14145-14151), and the server deals one each
// `G.conditions.burned.interval` ms (server.js:14121, 210 in game data), so a bucket of that length
// keeps two equal burn ticks apart. Without game data, as in a unit run, each millisecond is its own
// bucket.
const burnTick = () => Number((typeof G === 'undefined' ? undefined : G)?.conditions?.burned?.interval) || 1;

// The farm spot and the targeting scope carry the instance the status delivers.
type Spot = Area & { in?: string | number | null };
interface FarmEntity extends Point { id?: string; type?: string; mtype?: string; name?: string; npc?: unknown; visible?: boolean;
  dead?: unknown; rip?: unknown; hp?: number; max_hp?: number; in?: string }
interface Hit { id?: string; target?: string; hid?: string; actor?: string; mtype?: string; damage?: number; kill?: unknown; dead?: unknown }
interface Evidence { key: string; actor: string; id?: string; mtype?: string; map: string; x: number; y: number; at: number; kill: boolean }
type Mode = 'default' | 'scatter';
// The farm part of the coordinator's reply (coordinator/modes.ts `farmingReply`).
export interface FarmReply { monsterFocus?: unknown; monsterSearchRadius?: unknown; scatterEpoch?: unknown;
  huntCombatTarget?: string | null; partyFarmingMode?: unknown; partyFarmingMonsterType?: unknown }
export interface FarmClientPorts extends HandoffHolds {
  character(): FarmEntity & { name: string; map: string; ctype?: string; cave?: unknown };
  frame(): { entities?: Record<string, FarmEntity>; socket?: { connected?: boolean }; server_region?: string; server_identifier?: string };
  entity(id: unknown): FarmEntity | null | undefined;
  members(): string[];
  // movement's walk state: the clock offset, the runtime id and the navigation
  // revision.
  walk(): { clockOffset: number; runtimeId: unknown; intent: { revision?: unknown } };
  // The saved farm spot as the status delivers it, and the tasks owner's targeting scope.
  spot(): Spot | null;
  scope(): Spot | null;
  // The game's walkability check for a point, true where the client has none.
  walkable(point: Point): boolean;
  // The game's monster definitions, for a type's full health.
  monsters(): Record<string, { hp?: number } | undefined>;
  // The client's global, which keeps the learned one-shot types and the last farmed type across a
  // code reload.
  kept(): { __partyObservedOneShotTypes?: Record<string, boolean>; __partyLastFarmingMonsterType?: string | null };
  // Whether a hit's actor is this character.
  own(actor: unknown): boolean;
  // The other owners' readers of the game's `hit` packet, which run ahead of the farm's own with the
  // hit's one target (install.ts names them in v1.5.0's order).
  hitReaders(data: Hit | null | undefined, target: FarmEntity | null | undefined): void;
  // targeting's grouped queue target, the hit's target once the game drops a dead monster's
  // entity.
  queueTarget(): FarmEntity | null | undefined;
  // The combat metrics' own-hit and own-kill record, which the kill credit listener reads.
  ownHit(data: Hit, entity: FarmEntity | null | undefined): void;
  // The other owners' resets when the focus changes: targeting's selection and the role runner's
  // target.
  focusChanged(): void;
  // targeting's selected target, its monster priority and the fight it has not
  // finished.
  selected(): FarmEntity | null | undefined;
  priority(target: { mtype?: string; level?: number }): number;
  fighting(): boolean;
  // Facts of other owners that the farming type and the grouped answer read: movement's convoy
  // defense, the survival owner's recovery hold, the rare client, the Cave client, the leader and whether this
  // character follows it, and the events owner's event facts.
  convoyDefense(): boolean;
  recoveryHolds(): boolean;
  rareActive(): boolean;
  caveOwned(): boolean;
  leader(): string | null | undefined;
  followLeader(): boolean;
  eventTypes(): string[];
  eventActive(): boolean;
  eventJoined(): boolean;
  eventTravelling(): boolean;
  onEventMap(): boolean;
  // movement's walk: whether the character follows a walk and whether its navigation was
  // cancelled. The hand-off's holds are HandoffHolds (rules.ts `handoffHeld`).
  following(): boolean;
  cancelled(): boolean;
  // targeting's farm target for a location and whether the character can attack or reach it;
  // taking it ends the walk and selects it.
  farmTarget(location: Spot | null): FarmEntity | null | undefined;
  reachable(target: FarmEntity): boolean;
  takeTarget(target: FarmEntity): void;
}

/**
 * The character's farm client: the farm part of the reply (focus, radius, scatter, combat mode,
 * the Hunt's type), the farming monster type and the grouped answer, whether a monster stands in
 * the farm area, the candidates it may take there, the walkable entry point of a shaped area, the
 * competition evidence and learned one-shot types its report carries, the game's `hit` listener
 * (P-05), and the farming walk's hand-off and spawn return.
 */
export function installFarmClient(ports: FarmClientPorts) {
  let evidence: Evidence[] = [], seen: Record<string, FarmEntity> = {}, observed: { id: string; at: number } | null = null;
  let focus: string[] = ['goo'], radius = defaultSearchRadius, huntTarget: string | null = null, mode: Mode = 'default';
  let epoch = 0;
  let oneShot: Record<string, boolean> = ports.kept().__partyObservedOneShotTypes || {};
  let type: string | null = null, partyType: string | null = null, lastType: string | null = ports.kept().__partyLastFarmingMonsterType || null;
  let deviation: { id?: string; mtype?: string; at: number; reason: string } | null = null;
  const me = () => ports.character();
  // The farm part of the reply. A new focus resets the other owners' selection and the farmed type.
  // The reply's mode is the combat mode answer: the coordinator resets scatter learning on a focus change, so
  // the reply that carries the new focus already answers grouped.
  function receive(state: FarmReply): void {
    const next = Array.isArray(state.monsterFocus) ? state.monsterFocus as string[] :
      typeof state.monsterFocus === 'string' ? [state.monsterFocus] : ['goo'];
    if (JSON.stringify(next) !== JSON.stringify(focus)) {
      focus = next;
      ports.focusChanged();
      lastType = null;
      ports.kept().__partyLastFarmingMonsterType = null;
    }
    radius = Number.isFinite(Number(state.monsterSearchRadius)) ? Math.max(1, Number(state.monsterSearchRadius)) : defaultSearchRadius;
    const nextEpoch = Number(state.scatterEpoch) || 0;
    if (nextEpoch !== epoch) {
      epoch = nextEpoch;
      oneShot = {};
      ports.kept().__partyObservedOneShotTypes = oneShot;
    }
    huntTarget = state.huntCombatTarget || null;
    mode = me().ctype !== 'merchant' ? answerOf(state.partyFarmingMode) : 'default';
    partyType = typeof state.partyFarmingMonsterType === 'string' ? state.partyFarmingMonsterType : null;
  }
  // The farming monster type each report carries: the selected target's, else the best focus monster
  // in the area, else the only focus type or the last farmed one. A convoy defense, a recovery hold
  // and a rare keep the last type, as v1.5.0 did; the reply alone answers the mode.
  function observeType(): void {
    if (ports.convoyDefense() || ports.recoveryHolds() || ports.rareActive()) return;
    const c = me();
    if (c.ctype === 'merchant' || ports.eventTypes().length || ports.eventJoined() || focus.indexOf('all') >= 0 || !focus.length) {
      type = null;
      return;
    }
    const current = ports.selected();
    let active = current && !current.dead ? current.mtype || null : null;
    if (!active) {
      const visible = Object.values(ports.frame().entities || {}).filter(t => t && t.type === 'monster' && t.visible && !t.dead &&
        focus.indexOf(t.mtype!) >= 0 && inArea(t, ports.spot()))
        .sort((a, b) => ports.priority(b) - ports.priority(a) || Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y));
      active = visible[0] && visible[0].mtype || (focus.length === 1 ? focus[0]! : lastType);
    }
    if (active) {
      lastType = active;
      ports.kept().__partyLastFarmingMonsterType = active;
    }
    type = active || null;
  }
  // Whether the character fights in the grouped queue: always inside the Cave, never while it owns
  // a Cave visit outside, and otherwise in the default mode (or a convoy defense) with a leader it
  // follows, away from an event.
  function grouped(): boolean {
    const c = me();
    if (c.cave) return c.ctype !== 'merchant';
    if (ports.caveOwned()) return false;
    const leader = ports.leader();
    return c.ctype !== 'merchant' && (mode !== 'scatter' || ports.convoyDefense()) && !!leader &&
      (leader === c.name || ports.followLeader()) && !ports.eventTravelling() && !ports.eventJoined() &&
      !ports.eventTypes().length && !ports.onEventMap();
  }
  // A monster inside the area (its instance first), or anywhere when there is no scope.
  function inArea(target: FarmEntity, location?: Spot | null, margin?: number): boolean {
    const area = location || ports.scope();
    if (!area) return true;
    if (area.in != null && String(target.in == null ? target.map : target.in) !== String(area.in)) return false;
    return contains(area, target, margin || 0, radius);
  }
  function inRadius(target: FarmEntity): boolean {
    const scope = ports.scope();
    return !scope || (!target.map || target.map === scope.map) && Math.hypot(target.x - scope.x, target.y - scope.y) <= radius;
  }
  // The Hunt's type within the search radius, else the area's monsters before the radius's.
  function select<T extends FarmEntity>(targets: T[]): T[] {
    const c = me();
    if (huntTarget) return targets.filter(t => t.mtype === huntTarget && (!t.map || t.map === c.map) &&
      (t.in === undefined || t.in === c.in) && Math.hypot(t.x - c.x, t.y - c.y) <= radius);
    return candidates(ports.scope(), targets, radius);
  }
  // Another player's damage or kill on a monster in the farm area is competition evidence. It stays
  // in the report while the hitter stays in the character's view: `observe` drops it once the game's
  // entities no longer list the hitter. Each hitter keeps its latest two entries, all that the
  // contest row reads (two hits or a kill, rules.ts `contests`).
  function hit(data: Hit | null | undefined): void {
    if (!data || !(Number(data.damage) > 0 || data.kill || data.dead)) return;
    const c = me(), actorId = data.hid || data.actor, actor = actorId ? ports.entity(actorId) : null;
    if (!actor || actor.type === 'monster' || actor.npc || actorId === c.name || ports.members().indexOf(actorId!) >= 0) return;
    const id = data.id || data.target, target = ports.entity(id) || (id ? seen[id] : undefined);
    if (!target || target.type !== 'monster' || !inArea(target, ports.spot())) return;
    const at = Date.now() + ports.walk().clockOffset, kill = !!(data.kill || data.dead);
    const name = actor.name || actorId!;
    evidence = [...evidence.filter(h => h.actor !== name), ...evidence.filter(h => h.actor === name).slice(-1),
      { key: JSON.stringify([actorId, id, data.damage, kill, Math.floor(at / burnTick())]), actor: name, id,
        mtype: target.mtype, map: c.map, x: target.x, y: target.y, at, kill }];
  }
  // A scatter deviation is reported while its monster lives in the character's view; the first
  // report after that ends it.
  function deviationLive() {
    const e = deviation?.id ? ports.entity(deviation.id) : null;
    if (!e || e.dead || !(Number(e.hp) > 0)) deviation = null;
    return deviation;
  }
  // The game's `hit` packet: the other owners' readers with the hit's target (the live entity, else
  // the queue target the hit names), the competition evidence, then the character's own hit. In
  // scatter mode a hit on another type than the party's is a deviation, and a lethal single hit on a
  // focus monster teaches its scatter type. The coordinator keeps the learned types in the farming
  // profile across a restart for the same roster.
  function onHit(data: Hit): void {
    const queued = ports.queueTarget();
    ports.hitReaders(data, data ? ports.entity(data.id) || (queued && queued.id === String(data.id) ? queued : null) : null);
    hit(data);
    if (!data || !ports.own(data.hid)) return;
    const entity = data.id ? ports.entity(data.id) : null;
    if (mode === 'scatter' && entity && entity.type === 'monster' && partyType && entity.mtype !== partyType)
      deviation = { id: entity.id, mtype: entity.mtype, at: Date.now(), reason: 'party attack' };
    ports.ownHit(data, entity);
    const killed = data.kill || data.dead ? entity?.mtype || data.mtype : undefined;
    if (!killed) return;
    const full = Number(entity && entity.max_hp) || Number(ports.monsters()[killed]?.hp) || 0;
    if (focus.indexOf(killed) >= 0 && full > 0 && Number(data.damage) >= full) {
      oneShot[killed] = true;
      ports.kept().__partyObservedOneShotTypes = oneShot;
    }
  }
  // The monsters and other players within the search radius of the character in the farm area.
  function competition() {
    const spot = ports.spot(), frame = ports.frame(), c = me(), w = ports.walk();
    if (!spot || !spot.id || !frame.socket || !frame.socket.connected) return null;
    const counts: Record<string, number> = {}, players: string[] = [], party = ports.members();
    for (const [id, e] of Object.entries(frame.entities || {})) {
      if (!e || !e.visible || e.dead || e.rip || (e.map && e.map !== c.map) ||
          (e.in !== undefined && String(e.in) !== String(c.in)) || Math.hypot(e.x - c.x, e.y - c.y) > radius) continue;
      if (e.type === 'monster' && Number(e.hp) > 0) counts[e.mtype!] = (counts[e.mtype!] || 0) + 1;
      else if (e.type === 'character' && !e.npc && e.name !== c.name && party.indexOf(e.name!) < 0) players.push(e.name || id);
    }
    return { at: Date.now() + w.clockOffset, runtimeId: w.runtimeId, revision: w.intent.revision, areaId: spot.id, map: c.map,
      in: String(c.in == null ? c.map : c.in), server: String(frame.server_region || '') + String(frame.server_identifier || ''),
      radius, monsters: counts, players };
  }
  // On each status report: the monsters in view (a hit on one that walked out of view still counts), the
  // evidence of hitters still in view, and whether the character sees the whole farm area.
  function observe(): void {
    const c = me(), spot = ports.spot();
    seen = {};
    evidence = evidence.filter(h => !!ports.entity(h.actor));
    for (const [id, e] of Object.entries(ports.frame().entities || {}))
      if (e && e.visible && !e.dead && e.type === 'monster') seen[id] = { id, type: 'monster', mtype: e.mtype, map: c.map, x: e.x, y: e.y };
    observed = null;
    if (spot && spot.id && spot.map === c.map) {
      const box = bounds(spot);
      const corners = [[box[0]!, box[1]!], [box[2]!, box[3]!], [box[0]!, box[3]!], [box[2]!, box[1]!]];
      // The area is observed when its corners lie inside the character's view.
      if (corners.every(([x, y]) => inView(c, { x: x!, y: y! }))) observed = { id: spot.id, at: Date.now() + ports.walk().clockOffset };
    }
  }
  // A visible live focus monster the farm's selection would take (v1.5.0's
  // shared.js:14962 visibleFocusedMonsterWithinRadius): the empty spawn return holds while
  // one is in view.
  function focusInView(): boolean {
    const all = focus.includes('all');
    return select(Object.values(ports.frame().entities || {}).filter(e => !!e && e.type === 'monster' && !!e.visible && !e.dead &&
      (all || focus.includes(String(e.mtype))))).length > 0;
  }
  // A shaped area's walkable search point nearest the character (or the area, from another map);
  // a plain point is its own entry.
  function entryPoint(location: Spot | null | undefined) {
    if (!location || !location.shapes && !location.allOf) return location;
    const c = me(), origin = c.map === location.map ? c : location;
    const points = searchPoints(location).filter(p => ports.walkable(p))
      .sort((a, b) => Math.hypot(a.x - origin.x, a.y - origin.y) - Math.hypot(b.x - origin.x, b.y - origin.y));
    if (!points.length) throw new Error('No walkable entry point in selected farming zone');
    return points[0];
  }
  // The farming walk's hand-off: a follower whose walk meets a farm target it can attack or reach
  // ends the walk and takes it.
  function handoff(): void {
    if (ports.fighting() || ports.rareActive()) return;
    if (!ports.following() || ports.cancelled() || ports.eventActive() || handoffHeld(ports)) return;
    const target = ports.farmTarget(ports.spot());
    if (target && ports.reachable(target)) ports.takeTarget(target);
  }
  return {
    receive, observeType, grouped, inArea, inRadius, select, observe, entryPoint, handoff,
    // P-05: the game's `hit` handler, which shared.js registers through the hunting owner's run
    // scope handle, `act`.
    onHit,
    focus: () => focus, radius: () => radius, mode: () => mode, type: () => type, partyType: () => partyType,
    huntTarget: () => huntTarget, scatter: () => mode === 'scatter',
    // A point on the character's own map and instance inside the area, for movement's walk.
    inAreaAt(point: Point) { const c = me(); return inArea({ map: c.map, in: c.in, x: point.x, y: point.y }); },
    // movement's walk client sets the Hunt's type when a Hunt walk starts.
    setHuntTarget(name: string | null) { huntTarget = name; },
    // targeting's selection records the type it took.
    lastType: () => lastType,
    noteType(value: string | null) { lastType = value; },
    // The farmed type's name for the events owner's anniversary label.
    label: () => partyType || type || focus[0] || 'monster',
    // The saved farm spot's point.
    spot() { const s = ports.spot(); return s && s.map ? { map: s.map, x: s.x, y: s.y } : null; },
    report: () => ({ farmingMode: mode, farmingMonsterType: type,
      combatDeviation: deviationLive(),
      oneShotMonsterTypes: Object.keys(oneShot), oneShotEpoch: epoch,
      farmAreaEvidence: evidence, farmAreaObservation: observed, farmFocusInView: focusInView(), farmCompetition: competition() }),
  };
}
// The role code's spawn catalog (shared.js `root.partySpawnCatalog`).
Object.assign(globalThis, { partySpawnCatalog: spawnCatalog });
