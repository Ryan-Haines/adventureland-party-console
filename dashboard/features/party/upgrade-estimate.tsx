"use client";
import { MerchantBuyItem } from "./merchant-buy-item";
import { upgradeEstimateCache } from "./upgrade-estimate-cache";

export function upgradeEstimate(item: MerchantBuyItem, quantity: number, target: number) {
  if (!target || !item.upgradeable)
    return {
      attempts: quantity,
      gold: item.cost * quantity,
      scrolls: [] as number[],
    };
  const cacheKey = `${item.id}:${item.cost}:${item.upgradeGrade || 0}:${quantity}:${target}`;
  const cached = upgradeEstimateCache.get(cacheKey);
  if (cached) return cached;
  const chances = item.upgradeChances || [],
    grades = item.grades || [9, 10, 11, 12];
  const itemGrade = Math.max(0, Number(item.upgradeGrade) || 0);
  let seed = 2166136261;
  for (const char of `${item.id}:${quantity}:${target}`)
    seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  const random = () => {
    seed += 0x6d2b79f5;
    let value = seed;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  const runs: { attempts: number; gold: number; scrolls: number[] }[] = [];
  for (let simulation = 0; simulation < 3000; simulation += 1) {
    const personalGrace = Array(20).fill(0) as number[];
    const scrolls = [0, 0, 0, 0];
    let attempts = 0,
      successes = 0,
      guard = 0;
    while (successes < quantity && guard++ < 2_000_000) {
      attempts += 1;
      let level = 0,
        survived = true;
      while (level < target && survived) {
        const newLevel = level + 1;
        const scrollGrade =
          level >= (grades[2] ?? 11)
            ? 3
            : level >= (grades[1] ?? 10)
              ? 2
              : level >= (grades[0] ?? 9)
                ? 1
                : 0;
        scrolls[scrollGrade] += 1;
        const base = chances[newLevel] || 0;
        const graceNumber = Math.max(
          0,
          Math.min(newLevel + 1, Math.min(3, (personalGrace[newLevel] || 0) / 4.5) + itemGrade),
        );
        let graceChance = (base * graceNumber) / newLevel + graceNumber / 1000;
        graceChance = Math.max(0, graceChance / 4.8 - 0.4 / (newLevel - 0.999) ** 2);
        const chance = Math.min(base + graceChance, Math.min(base + 0.24, base * 2));
        if (random() <= chance) {
          personalGrace[newLevel] = 0;
          level = newLevel;
        } else {
          personalGrace[newLevel - 1] += 1;
          personalGrace[newLevel] += 1;
          if (newLevel >= 8 && newLevel <= 15) {
            personalGrace[newLevel - 1] += 1;
            personalGrace[newLevel - 2] += 2;
            personalGrace[newLevel - 3] += 2;
          }
          survived = false;
        }
      }
      if (survived) successes += 1;
    }
    const scrollGold = scrolls.reduce(
      (sum, count, grade) => sum + count * (item.scrollCosts?.[grade] || 0),
      0,
    );
    runs.push({ attempts, gold: attempts * item.cost + scrollGold, scrolls });
  }
  runs.sort((a, b) => a.gold - b.gold);
  const result = runs[Math.min(runs.length - 1, Math.ceil(runs.length * 0.9) - 1)];
  upgradeEstimateCache.set(cacheKey, result);
  return result;
}
