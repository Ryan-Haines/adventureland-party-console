// The search for a Hunt target the game places anywhere on its map or lets roam (areas.ts
// `roamArea`): which sightings the party can walk to, the points the search walks, the release of
// a target the party cannot reach, and the release's end. hunt.ts asks it from the mission's farm
// step and acts on its answer; a box target gets no answer, so its Hunt plays as before.
import type { HuntCycle, HuntSearch, HuntSighting, HuntStatus } from '../api.ts';
import type { ReturnLocation } from '../../events/api.ts';
import { zones, type Catalog, type Point } from '../zones.ts';
import { fresh as freshReport } from '../../protocol/reports.ts';
import { scanPoints } from './rares.ts';
import { huntNote } from './record.ts';

export interface SearchState {
  leader: string | null;
  statuses: Record<string, HuntStatus | undefined>;
  monsterChoices?: Catalog | null;
}
type Place = { map: string; x: number; y: number };
export interface SearchPorts {
  now(): number;
  // Movement's planner: resolves when it finds a walking route from `from` to `to` and rejects when
  // it finds none (planner-service.ts `createRareRouteDistance`).
  route(from: Place, to: Place): Promise<unknown>;
  persist(): void;
  // A member's search radius (rules.ts `searchReach`).
  radius(name: string): number;
}
// The step's answer at the mission's point: no search (a box target), hold the party where it is,
// walk to a point, or release the target.
export type SearchAnswer = { kind: 'none' } | { kind: 'hold'; text: string } | { kind: 'walk'; to: ReturnLocation; text: string } |
  { kind: 'release' };

/** The target's roam area on the catalog, as an area the scan reads, or null for a box spawn. */
export function roamArea(catalog: Catalog | null | undefined, target: string) {
  const spawn = zones(catalog || [], [target]).find(zone => zone.roamArea);
  return spawn ? { map: spawn.map, x: spawn.x, y: spawn.y, boundary: spawn.roamArea! } : null;
}

export function createSearch(state: SearchState, ports: SearchPorts) {
  // The planner's answer for each sighting of a target, by `target|id`: pending, open (a route) or
  // refused (none). A new pass and a release's end forget the target's answers.
  const answers = new Map<string, 'pending' | 'open' | 'refused'>();
  const key = (target: string, id: string) => target + '|' + id;
  const forget = (target: string) => { for (const k of [...answers.keys()]) if (k.startsWith(target + '|')) answers.delete(k); };
  const routed = (from: Place, to: Place) => ports.route(from, to).then(() => true, () => false);
  const lead = () => state.leader ? state.statuses[state.leader] : undefined;
  // The pass whose search points the planner is answering.
  let planning: string | null = null;
  // The sighting the current walk goes to, by `target|id`, which a failed walk refuses (`missed`).
  let walking: string | null = null;

  // The participants' sightings of `target` from their reports under the presence age.
  function sightings(names: string[], target: string): (HuntSighting & { reporter: string })[] {
    return names.flatMap(name => {
      const s = state.statuses[name];
      if (!s || !freshReport(s.seenAt, ports.now(), 'presence')) return [];
      return (s.huntSightings || []).filter(seen => seen.mtype === target).map(seen => ({ ...seen, reporter: name }));
    });
  }
  // Asks the planner once for a route from the leader to a sighting not yet answered.
  function ask(target: string, seen: HuntSighting): void {
    const from = lead(), k = key(target, seen.id);
    if (!from || answers.has(k)) return;
    answers.set(k, 'pending');
    void routed({ map: from.map, x: from.x, y: from.y }, { map: seen.map, x: seen.x, y: seen.y }).then(ok => {
      if (answers.get(k) === 'pending') answers.set(k, ok ? 'open' : 'refused');
    });
  }
  const answer = (target: string, seen: HuntSighting) => answers.get(key(target, seen.id));
  const distance = (a: Point | undefined, b: Point) => a && a.map === b.map ? Math.hypot(a.x - b.x, a.y - b.y) : Infinity;

  // The routed scan points of the target's roam area, from the leader, in scan order; the planner
  // answers them one at a time, so the pass never fills its queue.
  function plan(hunt: HuntCycle, pass: HuntSearch, area: NonNullable<ReturnType<typeof roamArea>>): void {
    const from = lead();
    if (planning === pass.id || !from) return;
    planning = pass.id;
    const origin = { map: from.map, x: from.x, y: from.y };
    void (async () => {
      const points: ReturnLocation[] = [];
      for (const point of scanPoints(area, origin)) {
        const place = { map: area.map, x: point.x, y: point.y };
        if (await routed(origin, place)) points.push(place);
      }
      if (planning === pass.id) planning = null;
      if (hunt.search?.id !== pass.id) return;
      huntNote(hunt, { search: { ...hunt.search, points } });
      ports.persist();
    })();
  }

  /**
   * The farm step's answer for the mission's target at its point. A kill starts a new pass. An open
   * sighting in a reporter's radius holds the step for targeting, and one farther away is the next
   * walk. With none, the point is searched once every participant reported after `arrivedAt`, and
   * the walk goes to the next routed scan point; a pass with no point left releases the target.
   * Each hold waits for a progress event: a planner answer, a report, a kill.
   */
  function step(hunt: HuntCycle, target: string, count: number, arrivedAt: number): SearchAnswer {
    const area = roamArea(state.monsterChoices, target);
    if (!area) return { kind: 'none' };
    let pass = hunt.search;
    if (!pass || pass.target !== target || pass.count !== count) {
      forget(target);
      pass = huntNote(hunt, { search: { id: target + ':' + count + ':' + ports.now(), target, count, next: 0 } }).search!;
      ports.persist();
    }
    const seen = sightings(hunt.participants, target);
    for (const sight of seen) ask(target, sight);
    if (seen.some(sight => answer(target, sight) === 'pending')) return { kind: 'hold', text: 'checking routes to ' + target };
    const open = seen.filter(sight => answer(target, sight) === 'open');
    if (open.some(sight => distance(state.statuses[sight.reporter], sight) <= ports.radius(sight.reporter)))
      return { kind: 'hold', text: target + ' in reach' };
    const leader = lead();
    const nearest = open.sort((a, b) => distance(leader, a) - distance(leader, b))[0];
    walking = nearest ? key(target, nearest.id) : null;
    if (nearest) return { kind: 'walk', to: { map: nearest.map, x: nearest.x, y: nearest.y }, text: 'walking to a sighted ' + target };
    if (!hunt.participants.every(name => Number(state.statuses[name]?.seenAt) > arrivedAt)) return { kind: 'hold', text: 'looking here' };
    if (!pass.points) {
      plan(hunt, pass, area);
      return { kind: 'hold', text: 'checking routes across ' + area.map };
    }
    const to = pass.points[pass.next];
    if (!to) return { kind: 'release' };
    huntNote(hunt, { search: { ...pass, next: pass.next + 1 } });
    return { kind: 'walk', to, text: 'point ' + (pass.next + 1) + ' of ' + pass.points.length };
  }

  /**
   * The walk to the search's last answer failed. A sighting it went to counts as refused; a search
   * point is already passed, since `step` moved `next` on when it sent the walk.
   */
  function missed(): void {
    if (walking && answers.has(walking)) answers.set(walking, 'refused');
    walking = null;
  }

  /** The pass ends and the selection skips `target` for `owner`'s quest. */
  function release(hunt: HuntCycle, target: string, owner: string): void {
    forget(target);
    huntNote(hunt, { search: undefined, released: { ...hunt.released, [target]: owner } });
  }

  /**
   * A release ends once no participant holds a live quest of its target with kills left (the
   * quest's deadline or its turn-in), or once a report sights the target and the planner finds a
   * route to it. Answers whether a release ended.
   */
  function observe(hunt: HuntCycle): boolean {
    let ended = false;
    for (const target of Object.keys(hunt.released || {})) {
      const held = hunt.participants.some(name => {
        const quest = state.statuses[name]?.monsterHunt;
        return quest?.id === target && quest.count > 0 && quest.remainingMs > 0;
      });
      const seen = held ? sightings(hunt.participants, target) : [];
      for (const sight of seen) ask(target, sight);
      if (held && !seen.some(sight => answer(target, sight) === 'open')) continue;
      forget(target);
      const { [target]: _ended, ...rest } = hunt.released!;
      huntNote(hunt, { released: Object.keys(rest).length ? rest : undefined });
      ended = true;
    }
    return ended;
  }

  return { step, missed, release, observe };
}
