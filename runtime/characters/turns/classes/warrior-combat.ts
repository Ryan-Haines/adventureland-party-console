import type { Target } from "../role-types.ts";
import type { ClassTurn } from "../api.ts";
import { partyHooks } from "../../../hooks/index.ts";

// The game client's `use_skill("dash")` sends the point 40 away in the facing (js/functions.js:1764 at
// pin 16881a27), so this predicts where that call lands (GLUE-01 G13, answered).
const DASH_DISTANCE = 40;

// The warrior's Dash toward an out-of-range target (E03-2 as corrected): Dash moves exactly 40
// units in the character's cardinal facing, takes no target, and goes only while the end point
// keeps the warrior outside its desired range and movement's step check passes it. Franky's fight
// and a grouped formation with a priest hold it.
export async function dashToward(target: Target, turn: ClassTurn): Promise<boolean> {
  if (is_in_range(target)) return false;
  const facts = turn.facts;
  if (facts.franky() || facts.groupedFarming() && facts.formationMembers().some(member => member.ctype === "priest")) return false;
  // The approach Dash is a damage cast: the class reserve bounds it, not a 50% floor.
  if (!turn.casts.ready("dash", null, "damage")) return false;
  const dx = target.x - character.x, dy = target.y - character.y;
  if (Math.sqrt(dx * dx + dy * dy) <= DASH_DISTANCE) return false;
  const endpoint = Math.abs(dx) >= Math.abs(dy)
    ? { x: character.x + Math.sign(dx || 1) * DASH_DISTANCE, y: character.y }
    : { x: character.x, y: character.y + Math.sign(dy || 1) * DASH_DISTANCE };
  const hitbox = Math.max(0, Math.hypot(dx, dy) - facts.combatDistance(target));
  if (Math.hypot(endpoint.x - target.x, endpoint.y - target.y) - hitbox < facts.desiredCombatRange() || !facts.safeCombatPoint(endpoint, target)) return false;
  character.direction = Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 1 : 2) : (dy < 0 ? 3 : 0);
  // Dash moves the character, but the turns owner makes the cast.
  return turn.casts.cast("dash", null, "damage");
}
// Taunt goes from the member that owns aggro transfers: `tauntReady` asks the engine, whose
// eligibility.ts `ownsAggro` holds that one rule.
export function mayTaunt(target: Target, turn: ClassTurn): boolean {
  if (character.level < (G.skills.taunt?.level || 0)) return false;
  target = get_entity(target.id) || target;
  return tauntTarget(target) && tauntReady(target, turn);
}
function tauntTarget(target: Target): boolean {
  if (!target || target.mtype === 'tinyp' || target.type !== 'monster') return false;
  // Porcupines must be pulled without the initial melee hit. Do not steal a
  // stranger's pull or repeatedly taunt one already attacking this warrior.
  const passivePorcupine = target.mtype === "porcupine" && !target.target;
  return target.target !== character.name && (passivePorcupine || !!partyHooks().ask('targeting.attacking', target)) &&
    !!partyHooks().ask('targeting.allowed', target);
}
function tauntReady(target: Target, turn: ClassTurn): boolean {
  return turn.casts.ready('taunt', target, 'survival');
}
