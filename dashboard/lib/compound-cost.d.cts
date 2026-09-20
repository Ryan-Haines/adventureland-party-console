export function compoundPassCost(
  grades: number[] | undefined,
  targetLevel: number,
  catalog: { id: string; cost: number }[],
): { gold: number; scrolls: number } | null;
