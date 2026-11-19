// A fighter's 95th percentile of the server's call
// sum per 4 s may sit above its bound (call-budget-rows.ts `CB20_P95`) only while the turns
// executor's own calls in the windows above it did not rise against the before runs' figure.

// The executor's methods: `attack`, `heal`, `skill`, a potion's
// `equip`, a regeneration `use`.
export const TURNS_METHODS = ['attack', 'heal', 'skill', 'equip', 'use'];
// Each fighter's 95th percentile of its server sum per 4 s, at most the top of its
// recorded before spread. A separate check on 2026-11-04 set them
// from the runs that send these calls with no budget deciding any: the steps windows warrior 40.5
// and priest 32.5; UP-2 warrior 12 to 16 and priest 15 to 23. The steps windows and UP-2 both read
// this one table.
// The largest figure each row recorded on unchanged code (decided 2026-11-05).
// A figure above one fails only where the turns executor's own
// calls rose in the windows above it; each row prints those calls beside the rest.
export const CB20_P95={steps:{E2EWarrior:41.1,E2EPriest:32.5},up2:{E2EWarrior:24,E2EPriest:25}} as Record<'steps'|'up2',Record<string,number>>;
// The before runs' figure: the largest cost of the executor's calls in one 4 s window above the
// bound. UP-2: step 2's runtime in step 3's close, warrior 0 and priest 16. Steps windows: step 1's runtime, whose burst sent about
// 5.5 warrior attack calls in 4 s, 11 at 2 each, and 2.7 priest calls per
// accepted attack at 0.84 a second (13.2), about 9 calls, 18.
// UP-2's warrior: 4.2 since layer 6 step 3, the largest executor cost in one window above the bound
// on that runtime (the escape MP potion after the respawn, 4, and a class skill, 0.2), because the
// escape's spends are the executor's by design; the user approved it
// on 2026-11-06. The bound stays 24.
export const CB20_TURNS_BEFORE: Record<'steps' | 'up2', Record<string, number>> = {
  steps: { E2EWarrior: 11, E2EPriest: 18 },
  up2: { E2EWarrior: 4.2, E2EPriest: 16 },
};

type Sample = { at: number; server: Record<string, number | null>; calls?: Record<string, [number, string, number][] | null> };
// The windows above the bound, the executor's call cost in each, and those above the before figure.
// Each server window reaches back 4 s, so a sampler that starts mid-row sees calls from before its
// start in its first windows; `from` drops those calls from the executor's cost.
export function cb20Windows(samples: Sample[], name: string, bound: number, before: number, from = 0) {
  const over = samples.filter(s => (s.server[name] ?? 0) > bound && s.calls?.[name]);
  const turns = over.map(s => Math.round(s.calls![name]!.filter(([at, method]) => at >= from && TURNS_METHODS.includes(method)).reduce((sum, [, , cost]) => sum + cost, 0) * 10) / 10);
  return { windows: over.length, turns, rose: over.map((s, i) => ({ at: s.at, server: s.server[name], turns: turns[i]! })).filter(w => w.turns > before) };
}
