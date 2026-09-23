/** Acknowledgements are not MP observations. Keep unobserved spending reserved. */
export function createManaSpending() {
  const entries = new Set<{ remaining: number; settled: boolean; until: number }>();
  let last: number | undefined;
  function observe(mp: number, now: number): number {
    let spent = Math.max(0, (last ?? mp) - mp);
    const changed = last !== undefined && mp !== last;
    last = mp;
    for (const entry of entries) {
      const accounted = Math.min(entry.remaining, spent);
      entry.remaining -= accounted;
      spent -= accounted;
      if (!entry.remaining || changed && entry.settled && now >= entry.until) entries.delete(entry);
    }
    return [...entries].reduce((sum, entry) => sum + entry.remaining, 0);
  }
  function acquire(mp: number, now: number, amount: number, floor: number) {
    if (mp - observe(mp, now) - amount < floor) return null;
    const entry = { remaining: amount, settled: false, until: now + 2500 };
    entries.add(entry);
    return (accepted: boolean | 'uncertain') => {
      if (accepted === false) entries.delete(entry);
      else entry.settled = true;
    };
  }
  return { observe, acquire };
}
