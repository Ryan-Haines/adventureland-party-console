// The steps windows' opening: the
// windows measure farming, so the first one opens at the first kill after both fighters stand inside
// the farm area, a progress rule with the farm fact's own zone test (`inFarmArea`), not at the walk's
// end. The builder reads a recorded log, so a run's log is read again with the same opening and the
// recorded spread stays comparable. It imports nothing, so a unit row loads it without the harness.

export interface PositionSample { at: number; name: string; map: string; in?: string | number; x: number; y: number }

// The time both fighters first stand inside the farm area, each at its newest sample, or null.
export function standingAt(positions: readonly PositionSample[], fighters: readonly string[], inFarm: (p: PositionSample) => boolean): number | null {
  const last = new Map<string, PositionSample>();
  for (const p of [...positions].sort((a, b) => a.at - b.at)) {
    last.set(p.name, p);
    if (fighters.every(name => { const q = last.get(name); return !!q && inFarm(q); })) return p.at;
  }
  return null;
}
// The first window's opening: the first kill at or after both fighters stand at the farm, or null
// while either has not reached it or no kill has come since.
export function windowsOpen(positions: readonly PositionSample[], kills: readonly number[], fighters: readonly string[], inFarm: (p: PositionSample) => boolean): number | null {
  const standing = standingAt(positions, fighters, inFarm);
  if (standing === null) return null;
  return [...kills].sort((a, b) => a - b).find(at => at >= standing) ?? null;
}
