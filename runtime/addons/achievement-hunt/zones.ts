// Achievement Hunt's character side (README.md here; the fork's characters/shared.js 3760-3923,
// 972c9fce): the bosses on the target's ground keep a zone, no combat step ends inside one, a
// character walks out of one before the boss reaches it, and each character reports the bosses
// it sees and whom they attack. The fork's zone was the aggro reach rounded up plus 1.5 s of
// walk, 40 units for a certain aggro and a 2 s lead; here the zone is the server's own aggro
// block, and a walking boss's zone covers every cell its walk to its going point crosses.
import { AGGRO_CELL, inBlock, entersBlock, member, position, type MoverAnswer, type MoverView, type Point, type ViewEntity } from '../../hooks/addon-api.ts';

export interface ZoneView { character: ViewEntity & { name: string; map: string }; entities: Record<string, ViewEntity | undefined>;
  // The event the character joined; a boss of a joined event is that event's to fight.
  joinedEvent?: string | null }
export interface Sighting { id: string; mtype: string; x: number; y: number; target: string | null }

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
// The visible living bosses from the hunt's avoid list. A joined event's boss is not avoided.
export function avoidedBosses(view: ZoneView, avoid: readonly string[]): ViewEntity[] {
  if (!avoid.length || view.joinedEvent) return [];
  return Object.values(view.entities).filter((e): e is ViewEntity => !!e && e.type === 'monster' && !e.dead && e.visible !== false && avoid.includes(String(e.mtype)));
}
// Whether `p` is inside a boss's zone: its aggro block, or a cell its walk to its going point crosses.
export function inZone(p: Point, boss: ViewEntity): boolean {
  const at = position(boss);
  if (inBlock(p, at)) return true;
  if (!boss.moving || !Number.isFinite(boss.going_x) || !Number.isFinite(boss.going_y)) return false;
  // `entersBlock(a, b, m)` asks whether the segment a-b enters m's block, which is the same as
  // whether m's walk from a to b passes a cell next to the point.
  return entersBlock(at, { x: boss.going_x!, y: boss.going_y! }, p);
}
// Step safety (`step.safety`): a combat step never ends inside a zone, except a step that moves
// away from the boss whose zone holds the character now.
export function zoneRefusal(view: ZoneView, avoid: readonly string[], to: Point): string | undefined {
  const me = position(view.character);
  for (const boss of avoidedBosses(view, avoid)) {
    if (!inZone(to, boss)) continue;
    if (inZone(me, boss) && distance(to, position(boss)) > distance(me, position(boss))) continue;
    return `the step ends in ${boss.mtype}'s zone`;
  }
  return undefined;
}
// The retreat (`movement.request`): walk out of every zone before a boss reaches the character,
// to the nearest point outside all of them, one aggro cell further per ring. It prefers a point
// inside the farm area and, when a priest is in the party, within the priest's healing range of
// the priest (or, for the priest, of every member); it keeps its target, so attacks go on.
export function retreatAnswer(view: MoverView & ZoneView, avoid: readonly string[]): MoverAnswer | undefined {
  const bosses = avoidedBosses(view, avoid), me = position(view.character);
  const threat = bosses.find(b => inZone(me, b));
  if (!threat) return undefined;
  const members = view.party.map(n => member(view, n)).filter((m): m is ViewEntity => !!m && m.map === view.character.map && !m.rip);
  const priest = members.find(m => m.ctype === 'priest'), heal = Number(priest?.range) || 0;
  const healed = (p: Point) => !priest ? true : priest.name === view.character.name
    ? members.every(m => m === priest || distance(p, position(m)) <= Math.max(heal, distance(me, position(m))))
    : distance(p, position(priest)) <= Math.max(heal, distance(me, position(priest)));
  // Past the farthest boss's block and walk every point is clear, so the search ends there.
  const far = Math.max(...bosses.map(b => distance(me, position(b)) + (b.moving ? distance(position(b), { x: Number(b.going_x), y: Number(b.going_y) }) : 0))) + 3 * AGGRO_CELL;
  const options: { p: Point; healed: boolean; farm: boolean; d: number }[] = [];
  for (let radius = AGGRO_CELL / 2; radius <= far && !options.length; radius += AGGRO_CELL / 2)
    // Each circle's samples sit half an aggro cell apart along it, as the circles do along the
    // radius, so a wider circle samples more.
    for (let i = 0, count = Math.ceil(2 * Math.PI * radius / (AGGRO_CELL / 2)); i < count; i++) {
      const p = { x: me.x + Math.cos(i * 2 * Math.PI / count) * radius, y: me.y + Math.sin(i * 2 * Math.PI / count) * radius };
      if (bosses.some(b => inZone(p, b)) || !view.stepSafe(p, view.target?.id ? String(view.target.id) : undefined)) continue;
      options.push({ p, healed: healed(p), farm: view.inFarmArea(p), d: radius });
    }
  options.sort((a, b) => Number(b.healed) - Number(a.healed) || Number(b.farm) - Number(a.farm) || a.d - b.d);
  const best = options[0];
  return best ? { kind: 'step', to: best.p, target: view.target?.id ? String(view.target.id) : undefined,
    reason: `${threat.mtype}'s zone reaches us`, phase: 'boss-retreat' }
    : { kind: 'hold', reason: `${threat.mtype}'s zone reaches us; no walkable spot outside every zone`, phase: 'boss-retreat-blocked' };
}
// The status report (`status.report`): the avoided bosses this character sees and whom each
// attacks, which the hunt reads to leave a target a boss holds.
export function sightings(view: ZoneView, avoid: readonly string[]): Sighting[] {
  return avoidedBosses(view, avoid).map(e => ({ id: String(e.id), mtype: String(e.mtype), ...position(e), target: e.target ?? null }));
}
// Targeting's question: the two waiting rules of the README, as the fork's `isAllowedTarget` ran
// them (fork shared.js 15598-15612). A boss on the avoid list is never a target outside its joined
// event, even one attacking the party. A new pull is refused while its target or the character's
// attack spot lies inside a zone. A monster attacking the party and the character's current target
// are no new pull. The attack spot is where the character stands to hit: its own point in range,
// else the point at its range on the line to the target.
export function pullRefusal(view: ZoneView & { character: { target?: string | null; range?: number } }, avoid: readonly string[], target: ViewEntity, party: readonly string[]): string | undefined {
  if (!avoid.length || view.joinedEvent) return undefined;
  if (avoid.includes(String(target.mtype))) return 'avoided boss';
  const bosses = avoidedBosses(view, avoid);
  if (!bosses.length || target.target && party.includes(String(target.target)) || String(target.id) === String(view.character.target)) return undefined;
  const me = position(view.character), at = position(target), range = Number(view.character.range) || 0, d = distance(me, at);
  const spot = d <= range ? me : { x: at.x + (me.x - at.x) * range / d, y: at.y + (me.y - at.y) * range / d };
  return bosses.some(b => inZone(at, b) || inZone(spot, b)) ? 'boss keep-out zone' : undefined;
}
