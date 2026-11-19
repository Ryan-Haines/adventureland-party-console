// Step safety for combat steps,
// with the user's answers under queue AV: standing still is the right step when moving
// would pull more monsters, and stuck is never an answer.

// The game server files every idle aggressive monster into a grid of this cell size
// (set_ghash(aggressives, monster, 32), node/server.js), and step safety models its aggro
// check on that grid (design section 3.1).
export const AGGRO_CELL = 32;

export interface SafetyPoint { x: number; y: number }
export interface SafetyMonster extends SafetyPoint {
  id: string;
  // The name of the character it attacks; the server keeps a monster with a target out of the aggro grid.
  target?: string | null;
  // G.monsters[mtype].aggro: the server's grid holds only monsters with a value above 0.
  aggro?: number;
  range?: number;
  dead?: boolean; visible?: boolean;
}
export interface StepSafetyInput {
  // The character that steps.
  name: string;
  from: SafetyPoint; to: SafetyPoint;
  // The selected target, or the boss the step approaches on purpose (queue A23).
  target?: string;
  // The monster the character attacks now (`character.target`). A step can name another
  // target, such as a formation step's reference, so the fight test reads both.
  attacking?: string;
  // The character's own attack range, for the fight test.
  range?: number;
  monsters: SafetyMonster[];
  walkable(from: SafetyPoint, to: SafetyPoint): boolean;
  // Step 9b: the zones the add-ons keep (runtime/hooks/registry.ts `step.safety`), such as a
  // boss's aggro reach; the refusal names the add-on and why.
  zones?(to: SafetyPoint): string | undefined;
}
export type StepRefusal = 'terrain' | 'attacker' | 'idle-aggro' | 'zone';
export interface StepSafety { safe: boolean; refusal?: StepRefusal; attackers: string[]; idle: string[]; zone?: string }

// Design section 3.1 and 02 W10: every check reads a missing monster range as 20.
export const DEFAULT_MONSTER_RANGE = 20;

const seen = (m: SafetyMonster) => !m.dead && m.visible !== false;
const cell = (value: number) => Math.floor(value / AGGRO_CELL);

// The square of the 3x3 cells around the monster's own cell, the places where the server's
// get_nearby_ghash (node/server_functions.js) finds it for a player.
export function aggroBlock(m: SafetyPoint) {
  const cx = cell(m.x), cy = cell(m.y);
  return { x0: (cx - 1) * AGGRO_CELL, y0: (cy - 1) * AGGRO_CELL, x1: (cx + 2) * AGGRO_CELL, y1: (cy + 2) * AGGRO_CELL };
}
export function inBlock(p: SafetyPoint, m: SafetyPoint): boolean {
  return Math.abs(cell(p.x) - cell(m.x)) <= 1 && Math.abs(cell(p.y) - cell(m.y)) <= 1;
}
// Liang-Barsky clipping of the segment against the block. The block's far edges belong to
// the next cell, so a segment that only touches them stays outside.
export function entersBlock(a: SafetyPoint, b: SafetyPoint, m: SafetyPoint): boolean {
  if (inBlock(b, m)) return true;
  const box = aggroBlock(m), dx = b.x - a.x, dy = b.y - a.y;
  let low = 0, high = 1;
  for (const [p, q] of [[-dx, a.x - box.x0], [dx, box.x1 - a.x], [-dy, a.y - box.y0], [dy, box.y1 - a.y]] as const) {
    if (p === 0) { if (q <= 0) return false; continue; }
    const t = q / p;
    if (p < 0) low = Math.max(low, t); else high = Math.min(high, t);
    if (low >= high) return false;
  }
  return low < high;
}

// One step from `from` to `to`, checked in this order: terrain, the add-ons' zones, then
// attackers, then idle monsters' aggro blocks.
export function stepSafety(input: StepSafetyInput): StepSafety {
  const { name, from, to, target } = input;
  if (!input.walkable(from, to)) return { safe: false, refusal: 'terrain', attackers: [], idle: [] };
  const zone = input.zones?.(to);
  if (zone) return { safe: false, refusal: 'zone', attackers: [], idle: [], zone };
  const attackers: string[] = [], idle: string[] = [];
  for (const m of input.monsters) {
    if (!seen(m) || m.id === target) continue;
    if (m.target === name) {
      // Today's safeCombatPoint rule: no closer than min(distance now, range) - 1.
      const range = Number(m.range) || DEFAULT_MONSTER_RANGE;
      if (Math.hypot(to.x - m.x, to.y - m.y) < Math.min(Math.hypot(from.x - m.x, from.y - m.y), range) - 1) attackers.push(m.id);
      continue;
    }
    if (m.target || !(Number(m.aggro) > 0)) continue;
    // A block that already holds the start lets the character step out of it.
    if (!inBlock(from, m) && entersBlock(from, to, m)) idle.push(m.id);
  }
  const refusal: StepRefusal | undefined = attackers.length ? 'attacker' : idle.length ? 'idle-aggro' : undefined;
  return { safe: !refusal, refusal, attackers, idle };
}

// Standing still fights while a monster attacks the character, or while the step's target or the
// monster the character attacks stands in its range.
export function fighting(input: Pick<StepSafetyInput, 'name' | 'from' | 'target' | 'attacking' | 'range' | 'monsters'>): boolean {
  return input.monsters.some(m => seen(m) && (m.target === input.name ||
    (m.id === input.target || m.id === input.attacking) && Math.hypot(m.x - input.from.x, m.y - input.from.y) <= Number(input.range)));
}

// The first candidate that passes. With none, a character that fights stands (null), and
// one whose standing fights nothing takes the candidate entering the fewest idle blocks
// that still passes terrain and the attacker rule (AV: stuck is never an answer).
export function chooseStep(candidates: SafetyPoint[], input: Omit<StepSafetyInput, 'to'>) {
  let best: { point: SafetyPoint; verdict: StepSafety; risky: boolean } | null = null;
  for (const point of candidates) {
    const verdict = stepSafety({ ...input, to: point });
    if (verdict.safe) return { point, verdict, risky: false };
    if (verdict.refusal === 'idle-aggro' && (!best || verdict.idle.length < best.verdict.idle.length)) best = { point, verdict, risky: true };
  }
  return best && !fighting(input) ? best : null;
}
