// The MP income the ranking counts as regeneration (ranking.ts, "Sustainable MP"): the MP a second
// the character's own reports showed it gaining over the last regeneration cycle. Only positive
// observed deltas count, never a predicted refund: a cast acknowledgement can precede the MP update.
// The game regenerates MP only in that cycle: G.classes carries no regeneration and the server runs
// no passive MP tick; its `use` handler restores G.skills.regen_mp.output and holds the potion group
// for 4 s (node/server.js `player.last.potion = future_ms(4000)`), the cooldown G.skills gives
// regen_mp (use_mp's cooldown times regen_mp's cooldown_multiplier). The caller passes that cycle
// (`cycleMs`, turns/api.ts `cooldownOf`), so one regeneration and the other gains of one cycle make
// the income; a cycle of 0 (no regen_mp in the game data) counts no income.
export function createManaIncome() {
  let last: { at: number; mp: number } | null = null;
  const recovery: { at: number; amount: number }[] = [];
  return {
    observe(now: number, mp: number, cycleMs: number): number {
      if (last) {
        const recovered = Math.max(0, mp - last.mp);
        if (recovered) recovery.push({ at: now, amount: recovered });
      }
      while (recovery.length && recovery[0].at <= now - cycleMs) recovery.shift();
      last = { at: now, mp };
      return cycleMs > 0 ? recovery.reduce((sum, r) => sum + r.amount, 0) / (cycleMs / 1000) : 0;
    },
    reset() { last = null; recovery.length = 0; },
  };
}
