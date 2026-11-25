// Tank Hold's play rules (README.md here). Each function answers one hook from the view that hook
// hands it, so the rules run the same on a character and in the tests. The card's Farming settings
// line saves the tank, off tank, puller and Pull in the scope store, so each farming scope keeps its
// own picks; the danger share is a setting with one value per scope.
import { AGGRO_CELL, entersBlock, inBlock, member, position, type MemberView, type MoverAnswer, type MoverView, type Point, type ViewEntity } from '../../hooks/addon-api.ts';

export interface Picks { tank: string | null; offTank: string | null; puller: string | null; pull: boolean; dangerHp: number }
type Entities = Readonly<Record<string, ViewEntity | undefined>>;
// What the rules read of a view: the asking character, the entities in view and the party.
export interface Sight { character: ViewEntity & { name: string }; entities: Entities; party: readonly string[] }

// The scope store keys the card line saves.
export const PICK_KEYS = ['tank', 'offTank', 'puller', 'pull'] as const;
const name = (value: unknown) => typeof value === 'string' && value ? value : null;
// `scope` reads one scope store key; `settings` holds the danger share.
export function picksOf(scope: (key: string) => unknown, settings: Readonly<Record<string, unknown>>): Picks {
  return { tank: name(scope('tank')), offTank: name(scope('offTank')), puller: name(scope('puller')), pull: scope('pull') === true,
    dangerHp: Number(settings.dangerHp) };
}

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const standing = (e: ViewEntity | undefined): e is ViewEntity => !!e && !e.dead && !e.rip && e.visible !== false;
// A party member as the asking character sees it: itself, or its entity in view.
export const seen = (sight: Sight, who: string): ViewEntity | undefined => who === sight.character.name ? sight.character : sight.entities[who];
const monsters = (sight: Sight) => Object.values(sight.entities).filter((e): e is ViewEntity => standing(e) && e.type === 'monster');
// The monsters in view that attack a party member.
export const attackers = (sight: Sight) => monsters(sight).filter(m => !!m.target && sight.party.includes(m.target));
// The monsters in view that attack nobody in the party: the pack the party waits outside of.
export const pack = (sight: Sight) => monsters(sight).filter(m => !m.target || !sight.party.includes(m.target));

// A member is in danger when it is dead or below the player's "in danger" share of its HP. It takes
// an entity in view or a party member view, which carry the same HP fields.
type Vitals = Pick<ViewEntity, 'dead' | 'rip' | 'hp' | 'max_hp'> | Pick<MemberView, 'rip' | 'hp' | 'max_hp'>;
export function inDanger(e: Vitals | undefined, share: number): boolean {
  if (!e) return false;
  if (('dead' in e && e.dead) || e.rip) return true;
  return Number(e.max_hp) > 0 && Number(e.hp) * 100 < share * Number(e.max_hp);
}

// The member that holds the monsters right now: the off tank while the tank is in danger, else the
// tank. `targeting.aggroOwner` hands each member's HP in its member views.
export function holder(picks: Picks, members: readonly MemberView[]): string | undefined {
  const tank = members.find(m => m.name === picks.tank);
  if (!tank) return undefined;
  const off = picks.offTank && members.some(m => m.name === picks.offTank) ? picks.offTank : undefined;
  return off && inDanger(tank, picks.dangerHp) ? off : tank.name;
}

// Pull mode runs while the tank and the puller are in the party and the puller stands. The puller
// defaults to the tank.
export function pulling(picks: Picks, sight: Sight): { tank: string; puller: string } | undefined {
  if (!picks.pull || !picks.tank || !sight.party.includes(picks.tank)) return undefined;
  const puller = picks.puller ?? picks.tank;
  if (!sight.party.includes(puller)) return undefined;
  const e = seen(sight, puller);
  return e && (e.dead || e.rip) ? undefined : { tank: picks.tank, puller };
}
// The puller pulls only while the tank stands in view and every member in view is out of danger.
export function ready(picks: Picks, sight: Sight, tank: string): boolean {
  if (!standing(seen(sight, tank))) return false;
  return sight.party.every(who => !inDanger(seen(sight, who), picks.dangerHp));
}

// `targeting.candidates` in pull mode. While a pulled monster attacks the party everyone fights only
// the attackers. Between pulls the puller may take the one pack monster nearest the tank, once the
// party is ready, and the others take nothing, so nobody walks into the pack.
export function pullCandidates(picks: Picks, sight: Sight, candidates: readonly ViewEntity[]): ViewEntity[] | undefined {
  const pull = pulling(picks, sight);
  if (!pull) return undefined;
  const fighting = new Set(attackers(sight).map(m => m.id));
  const allowed = candidates.filter(c => fighting.has(c.id));
  if (fighting.size || sight.character.name !== pull.puller || !ready(picks, sight, pull.tank)) return allowed;
  const tank = seen(sight, pull.tank)!, idle = candidates.filter(c => !fighting.has(c.id));
  const nearest = idle.reduce<ViewEntity | undefined>((best, c) =>
    !best || distance(position(c), position(tank)) < distance(position(best), position(tank)) ? c : best, undefined);
  return nearest ? [nearest] : [];
}

// `targeting.prefers`: an order inside one priority. The off tank takes the tank's attackers while
// the tank is in danger; the tank takes the monsters loose on the rest of the party first; every
// other member hits what the tank holds first.
export function preferred(picks: Picks, sight: Sight, candidates: readonly ViewEntity[]): ViewEntity[] | undefined {
  const tank = picks.tank, me = sight.character.name;
  if (!tank || !sight.party.includes(tank) || candidates.length < 2) return undefined;
  const tankDanger = inDanger(seen(sight, tank), picks.dangerHp);
  const onTank = (c: ViewEntity) => c.target === tank;
  const loose = (c: ViewEntity) => !!c.target && c.target !== tank && sight.party.includes(c.target);
  const first = me === tank ? loose : onTank;
  if (me === picks.offTank && !tankDanger) return undefined;
  return [...candidates.filter(first), ...candidates.filter(c => !first(c))];
}

// Whether `p` stays out of every pack monster's aggro block, and off the walk of a moving one.
export function clear(p: Point, idle: readonly ViewEntity[]): boolean {
  return idle.every(m => {
    const at = position(m);
    if (inBlock(p, at)) return false;
    return !(m.moving && Number.isFinite(m.going_x) && Number.isFinite(m.going_y) && entersBlock(at, { x: m.going_x!, y: m.going_y! }, p));
  });
}
// The nearest clear point the character can walk to. The search samples circles every half aggro
// cell along the radius and the circle, out to one aggro block past the farthest pack monster.
export function clearPoint(view: MoverView, idle: readonly ViewEntity[]): Point | undefined {
  const me = position(view.character), step = AGGRO_CELL / 2;
  const reach = Math.max(...idle.map(m => distance(me, position(m)))) + 3 * AGGRO_CELL;
  for (let r = step; r <= reach; r += step) {
    const count = Math.max(8, Math.ceil(2 * Math.PI * r / step));
    const ring: Point[] = [];
    for (let i = 0; i < count; i++) {
      const p = { x: me.x + r * Math.cos(2 * Math.PI * i / count), y: me.y + r * Math.sin(2 * Math.PI * i / count) };
      if (clear(p, idle) && view.canStand(p) && view.canMoveTo(p) && view.stepSafe(p)) ring.push(p);
    }
    // The point farthest from the nearest pack monster gives the pack the most room to wander.
    const room = (p: Point) => Math.min(...idle.map(m => distance(p, position(m))));
    if (ring.length) return ring.reduce((best, p) => room(p) > room(best) ? p : best);
  }
  return undefined;
}

// A point beside `to`, `gap` short of it on the side the character stands.
function beside(from: Point, to: Point, gap: number): Point {
  const d = distance(from, to) || 1;
  return { x: to.x + (from.x - to.x) / d * gap, y: to.y + (from.y - to.y) / d * gap };
}

// The `pull` mover at the `farming` tier: it answers only in pull mode and leaves every fight to the
// console, except the puller's walk back to the tank with the monster it pulled. `line` is what the
// character does, for its status report.
export function pullMove(picks: Picks, view: MoverView): { answer?: MoverAnswer; line: string } {
  const pull = pulling(picks, view);
  if (!pull) {
    const named = picks.pull && picks.tank && view.party.includes(picks.tank);
    return { line: named ? `${picks.puller ?? picks.tank} is down; the party farms without pulls` : '' };
  }
  const me = view.character.name, tank = member(view, pull.tank);
  const fight = attackers(view);
  if (fight.length) {
    const chasing = fight.filter(m => m.target === me);
    if (me !== pull.puller || me === pull.tank || !chasing.length || !standing(tank)) return { line: 'Fighting the pull' };
    if (distance(position(view.character), position(tank)) <= AGGRO_CELL) return { line: 'Fighting the pull' };
    const to = beside(position(view.character), position(tank), AGGRO_CELL / 2);
    if (!view.canMoveTo(to)) return { line: `No path back to ${pull.tank}; fighting the pull here` };
    return { answer: { kind: 'step', to, target: chasing[0]!.id, reason: `brings the pull to ${pull.tank}`, phase: 'tank-hold:return' },
      line: `Bringing the pull to ${pull.tank}` };
  }
  const idle = pack(view);
  // A tank that pulls for itself goes to the pack and fights each pull where it lands.
  if (me === pull.tank && me === pull.puller && ready(picks, view, pull.tank)) return { line: 'Pulling one monster to the party' };
  if (me === pull.tank) {
    if (!idle.length) return { line: 'Looking for the pack' };
    if (clear(position(view.character), idle))
      return { answer: { kind: 'hold', reason: 'waits outside the pack for the pull', phase: 'tank-hold:wait' }, line: `Waiting outside the pack for ${pull.puller}'s pull` };
    const to = clearPoint(view, idle);
    if (!to) return { line: 'No clear spot outside the pack; fighting where it stands' };
    return { answer: { kind: 'step', to, reason: 'steps out of the pack to wait for the pull', phase: 'tank-hold:wait' }, line: 'Stepping out of the pack' };
  }
  if (me === pull.puller) {
    if (ready(picks, view, pull.tank)) return { line: 'Pulling one monster to the party' };
    if (!standing(tank)) return { line: `Waiting for ${pull.tank}` };
  }
  // Everyone else, and the puller while the party heals, waits within its own range of the tank.
  if (!standing(tank)) return { line: `Waiting for ${pull.tank}` };
  const reach = Math.max(AGGRO_CELL, Number(view.character.range) || 0), d = distance(position(view.character), position(tank));
  const waiting = me === pull.puller ? 'Waiting for the party before the next pull' : `Waiting beside ${pull.tank} for the pull`;
  if (d <= reach) return { answer: { kind: 'hold', reason: 'waits beside the tank for the pull', phase: 'tank-hold:wait' }, line: waiting };
  const to = beside(position(view.character), position(tank), reach / 2);
  if (!view.canMoveTo(to)) return { line: `No path to ${pull.tank}` };
  return { answer: { kind: 'step', to, reason: 'joins the tank for the pull', phase: 'tank-hold:wait' }, line: waiting };
}

// `step.safety` in pull mode: a member other than the puller never ends a step inside a pack
// monster's aggro block, except a step out of the block it stands in. A member a monster attacks
// is left to the console's own steps, so a step that saves it is never refused.
export function packRefusal(picks: Picks, sight: Sight, to: Point): string | undefined {
  const pull = pulling(picks, sight), me = sight.character.name;
  if (!pull || me === pull.puller || attackers(sight).some(m => m.target === me)) return undefined;
  const from = position(sight.character);
  for (const m of pack(sight)) {
    if (clear(to, [m])) continue;
    if (!clear(from, [m]) && distance(to, position(m)) > distance(from, position(m))) continue;
    return `the step ends in the pack (${m.mtype}); the party waits for the pull`;
  }
  return undefined;
}

// `formation.routine`: of the solver's points with the least danger, the one nearest the tank. The
// tank, and a character whose party has no tank in the formation, keep the solver's best.
export function aroundTank(picks: Picks, ask: { character: string; members: readonly { name: string; x: number; y: number }[];
  candidates: readonly { x: number; y: number; danger: number }[] }): Point | undefined {
  const centre = ask.members.find(m => m.name === picks.tank) ?? ask.members.find(m => m.name === picks.offTank);
  if (!centre || centre.name === ask.character || !ask.candidates.length) return undefined;
  const least = Math.min(...ask.candidates.map(c => c.danger));
  const near = ask.candidates.filter(c => c.danger <= least)
    .reduce((best, c) => distance(c, centre) < distance(best, centre) ? c : best);
  return { x: near.x, y: near.y };
}

// The role the card shows for a character.
export function role(picks: Picks, who: string): string {
  const roles = [picks.tank === who && 'Tank', picks.offTank === who && 'Off tank', picks.pull && (picks.puller ?? picks.tank) === who && 'Puller'];
  return roles.filter(Boolean).join(', ');
}
