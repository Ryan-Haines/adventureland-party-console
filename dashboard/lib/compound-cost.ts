// Minimum scroll spend to build one target item entirely from +0 copies.
export function compoundPassCost(
  grades: number[] | undefined,
  targetLevel: number,
  catalog: { id: string; cost: number }[],
): { gold: number; scrolls: number } | null {
  const thresholds = Array.isArray(grades) ? grades : [9, 10, 11, 12];
  const prices = new Map((catalog || []).map((item) => [item.id, item.cost]));
  let gold = 0,
    scrolls = 0;
  for (let level = 0; level < targetLevel; level++) {
    let grade = 0;
    for (let index = 0; index < thresholds.length; index++) {
      if (level >= thresholds[index]) grade = index + 1;
    }
    const price = prices.get('cscroll' + grade);
    if (price === undefined || !Number.isFinite(price) || price < 0)
      return null;
    const count = 3 ** (targetLevel - level - 1);
    gold += count * price;
    scrolls += count;
  }
  return { gold, scrolls };
}
