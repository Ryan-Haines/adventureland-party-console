import type { InventoryEntry } from "../contracts/item.ts";

export interface CompoundRule {
  name: string;
  targetTier?: number;
  quantity?: number;
}
export interface ExchangeRule {
  name: string;
  level?: number;
}
export interface ExchangeChoice {
  id: string;
  level?: number;
  reward?: unknown;
  required?: number;
}
export interface ExchangeLine {
  id: string;
  level: number;
  quantity: number;
}
type Entries = readonly (InventoryEntry | null | undefined)[];

function itemLevel(entry: InventoryEntry): number {
  return Number(entry.item?.level) || 0;
}

function hasCompoundTriplet(entries: readonly InventoryEntry[], target: number): boolean {
  const counts = new Map<number, number>();
  for (const entry of entries) {
    const level = itemLevel(entry);
    if (entry.item?.l || level >= target) continue;
    counts.set(level, (counts.get(level) || 0) + 1);
  }
  return [...counts.values()].some((count) => count >= 3);
}

/** Counts completed items, rather than stack quantity, as the existing compound contract requires. */
export function evaluateAutoCompounds(rules: readonly CompoundRule[], entries: Entries) {
  const completed: { rule: CompoundRule; target: number; quantity: number }[] = [];
  let runnable = false;
  const remaining = rules.filter((rule) => {
    const target = Math.max(1, Number(rule.targetTier) || 1);
    const quantity = Number.isSafeInteger(Number(rule.quantity)) ? Number(rule.quantity) : -1;
    const matching = entries.filter(
      (entry): entry is InventoryEntry => !!entry?.item && entry.item.name === rule.name,
    );
    if (quantity === 0) return true;
    if (hasCompoundTriplet(matching, target)) runnable = true;
    return true;
  });
  return { remaining, completed, runnable };
}

function exchangeQuantity(entry: Entries[number], rule: ExchangeRule, level: number): number {
  if (entry?.item?.name !== rule.name || itemLevel(entry) !== level || entry.item.l || entry.item.b) return 0;
  return Number(entry.item.q) || 1;
}

/** Plans only available complete exchanges; queue ownership stays with the scheduler. */
export function planAutoExchanges(
  rules: Readonly<Record<string, ExchangeRule>>,
  catalog: readonly ExchangeChoice[],
  entries: Entries,
  remote: Entries = [],
) {
  const lines: ExchangeLine[] = [],
    keys: string[] = [];
  for (const [key, rule] of Object.entries(rules)) {
    const level = Number(rule.level) || 0;
    const choice = catalog.find(
      (entry) => !entry.reward && entry.id === rule.name && (Number(entry.level) || 0) === level,
    );
    if (!choice) continue;
    const required = Math.max(1, Number(choice.required) || 1);
    let available = entries.reduce((sum, entry) => sum + exchangeQuantity(entry, rule, level), 0);
    // Retrieve only through the first whole stack that completes a batch.
    for (const entry of remote) {
      if (available >= required) break;
      available += exchangeQuantity(entry, rule, level);
    }
    const quantity = Math.floor(available / required);
    if (quantity <= 0) continue;
    lines.push({ id: rule.name, level, quantity });
    keys.push(key);
    if (remote.length) break; // Finish this storage handoff before requesting another item.
  }
  return { lines, keys };
}
