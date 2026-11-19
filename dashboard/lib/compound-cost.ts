import { itemGrade } from '../../runtime/items/api.ts';

// Minimum scroll spend to build one target item entirely from +0 copies. Each pass uses the
// compound scroll of the item's grade at that level (the items owner's itemGrade).
export function compoundPassCost(
  grades: number[] | undefined,
  targetLevel: number,
  catalog: { id: string; cost: number }[],
): { gold: number; scrolls: number } | null {
  const prices = new Map((catalog || []).map((item) => [item.id, item.cost]));
  let gold = 0,
    scrolls = 0;
  for (let level = 0; level < targetLevel; level++) {
    const price = prices.get('cscroll' + itemGrade({ compound: true, grades }, level));
    if (price === undefined || !Number.isFinite(price) || price < 0)
      return null;
    const count = 3 ** (targetLevel - level - 1);
    gold += count * price;
    scrolls += count;
  }
  return { gold, scrolls };
}
