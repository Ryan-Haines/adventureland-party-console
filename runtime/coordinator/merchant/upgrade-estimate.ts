export interface UpgradeChoice {
  id: string;
  cost: number;
  upgradeable?: boolean;
  upgradeGrade?: number;
  upgradeChances?: number[];
  grades?: number[];
  scrollCosts?: number[];
}
interface Estimate {
  attempts: number;
  budget: number;
  scrolls: number[];
}
const fallbackChances = [
  1, 0.9999999, 0.98, 0.95, 0.7, 0.6, 0.4, 0.25, 0.15, 0.07, 0.024, 0.14, 0.11,
];

function seededRandom(key: string): () => number {
  let seed = 2166136261;
  for (const char of key) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  return () => {
    seed += 0x6d2b79f5;
    let value = seed;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function scrollGrade(level: number, grades: number[]): number {
  if (level >= (grades[2] ?? 11)) return 3;
  if (level >= (grades[1] ?? 10)) return 2;
  return level >= (grades[0] ?? 9) ? 1 : 0;
}

function chanceWithGrace(base: number, level: number, grace: number[], itemGrade: number): number {
  const count = Math.max(
    0,
    Math.min(level + 1, Math.min(3, (grace[level] || 0) / 4.5) + itemGrade),
  );
  let chance = (base * count) / level + count / 1000;
  chance = Math.max(0, chance / 4.8 - 0.4 / (level - 0.999) ** 2);
  return Math.min(base + chance, Math.min(base + 0.24, base * 2));
}

function failedGrace(grace: number[], level: number): void {
  grace[level - 1]! += 1;
  grace[level]! += 1;
  if (level >= 8 && level <= 15) {
    grace[level - 1]! += 1;
    grace[level - 2]! += 2;
    grace[level - 3]! += 2;
  }
}

interface SimulationPolicy {
  target: number;
  quantity: number;
  chances: number[];
  grades: number[];
  itemGrade: number;
  scrollCosts: number[];
  itemCost: number;
}

function upgradeOne(
  policy: SimulationPolicy,
  grace: number[],
  scrolls: number[],
  random: () => number,
): boolean {
  for (let level = 0; level < policy.target; level++) {
    const next = level + 1;
    scrolls[scrollGrade(level, policy.grades)]! += 1;
    if (random() <= chanceWithGrace(policy.chances[next] || 0, next, grace, policy.itemGrade))
      grace[next] = 0;
    else {
      failedGrace(grace, next);
      return false;
    }
  }
  return true;
}

function simulate(policy: SimulationPolicy, random: () => number): Estimate {
  const grace = Array<number>(20).fill(0),
    scrolls = [0, 0, 0, 0];
  let attempts = 0,
    successes = 0,
    guard = 0;
  while (successes < policy.quantity && guard++ < 2000000) {
    attempts++;
    if (upgradeOne(policy, grace, scrolls, random)) successes++;
  }
  return {
    attempts,
    budget:
      attempts * policy.itemCost +
      scrolls.reduce((sum, count, grade) => sum + count * (policy.scrollCosts[grade] || 0), 0),
    scrolls,
  };
}

/** Reproducible 90th-percentile budget from 3,000 runs, preserving personal-grace behavior. */
export function estimateUpgrade(
  choice: UpgradeChoice,
  quantity: number,
  target: number,
): Estimate | null {
  if (!target || !choice.upgradeable) return null;
  const random = seededRandom(`${choice.id}:${quantity}:${target}`);
  const policy = {
    quantity,
    target,
    chances: choice.upgradeChances || fallbackChances,
    grades: choice.grades || [9, 10, 11, 12],
    itemGrade: Math.max(0, Number(choice.upgradeGrade) || 0),
    scrollCosts: choice.scrollCosts || [1000, 40000, 1600000, 480000000],
    itemCost: choice.cost,
  };
  const runs = Array.from({ length: 3000 }, () => simulate(policy, random)).sort(
    (a, b) => a.budget - b.budget,
  );
  return runs[Math.min(runs.length - 1, Math.ceil(runs.length * 0.9) - 1)]!;
}
