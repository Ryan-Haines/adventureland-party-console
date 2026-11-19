import type { Role } from "../role-types.ts";
import type { ClassTurn } from "../api.ts";

// Energize's amount rule (b9b5c91e shared.js:13940-13945, the mage, and :13123-13124, the A/B feed,
// held the same two shares): while every candidate holds at least `COMFORTABLE_MP_SHARE` of its MP
// the cast moves 1 MP, otherwise `MISSING_MP_SHARE` of what the target misses, at least 1, and never
// more than the MP above the class reserve (`available`).
const COMFORTABLE_MP_SHARE = 0.6, MISSING_MP_SHARE = 0.2;
type Pool = { mp: number; max_mp: number };
export function energizeAmount(candidates: readonly Pool[], target: Pool, available: number): number {
  const allComfortable = candidates.every(member => member.mp / member.max_mp >= COMFORTABLE_MP_SHARE);
  const missing = Math.max(0, Math.floor(target.max_mp - target.mp));
  return Math.min(available, allComfortable ? 1 : Math.max(1, Math.ceil(missing * MISSING_MP_SHARE)));
}

// The Energize the mage sets now: the lowest-MP ally in range
// and the MP `energizeAmount` gives it. Energize is a maintenance cast that keeps the mage's class
// reserve. The cast and the status report both read it, so an ally's ranking sees the Energize coming
// before its cooldown ends (REVIEW-QUEUE TRN-Q-DPS DPS-3).
function energizeSet(turn: ClassTurn): { target: NonNullable<ReturnType<typeof get_player>>; name: string; mp: number } | null {
  if (character.max_mp <= 0) return null;
  const available = Math.floor(character.mp - turn.ready("energize").reserve);
  if (available <= 0) return null;
  const roster = turn.facts.roster();
  const candidates = turn.facts.members().filter(member => member && turn.facts.sameTeam(member) && member.name !== character.name &&
    roster.indexOf(member.name) >= 0 && !member.rip && member.map === character.map && member.max_mp > 0 && member.mp < member.max_mp)
    .sort((a, b) => a.mp / a.max_mp - b.mp / b.max_mp || a.mp - b.mp || a.name.localeCompare(b.name));
  for (const status of candidates) {
    const target = get_player(status.name);
    if (!target || !is_in_range(target, "energize")) continue;
    const amount = energizeAmount(candidates, status, available);
    if (amount > 0) return { target, name: status.name, mp: amount };
  }
  return null;
}
async function energizeLowestMana(turn: ClassTurn): Promise<boolean> {
  const set = turn.ready("energize").ready ? energizeSet(turn) : null;
  return set ? turn.casts.cast("energize", set.target as never, "maintenance", set.mp) : false;
}
export const role: Partial<Role> = {
  name: "mage",
  combat: true,
  beforeAttack: (_target, turn) => energizeLowestMana(turn),
  support: turn => { const set = energizeSet(turn); return set ? { energize: { target: set.name, mp: set.mp } } : {}; },
};
