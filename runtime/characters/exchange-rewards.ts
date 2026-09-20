interface Definition {
  name?: string;
  skin?: string;
}
interface Data {
  items: Record<string, Definition>;
  drops: Record<string, unknown>;
}
/** Exchange tables are weighted draws. `open` rolls another table immediately. */
export function exchangeRewards(data: Data, tableName: string) {
  const results = new Map<
    string,
    { kind: string; id: string; name: string; quantity: number; chance: number }
  >();
  function walk(name: string, probability: number, seen: Set<string>) {
    const table = data.drops[name];
    if (seen.has(name) || !Array.isArray(table)) return;
    const next = new Set(seen).add(name);
    const total = table.reduce(
      (sum: number, row: unknown[]) => sum + Math.max(0, Number(row[0]) || 0),
      0,
    );
    if (!total) return;
    for (const row of table) {
      const chance = (probability * Math.max(0, Number(row[0]) || 0)) / total;
      if (!chance) continue;
      const kind = String(row[1]);
      if (kind === "open") {
        walk(String(row[2]), chance, next);
        continue;
      }
      const cosmetic = kind === "cx" || kind === "cxbundle";
      const id = cosmetic ? String(row[2]) : kind;
      const quantity = cosmetic ? 1 : Math.max(1, Number(row[2]) || 1);
      const label =
        kind === "empty"
          ? "No reward"
          : kind === "gold"
            ? "Gold"
            : kind === "shells"
              ? "Shells"
              : cosmetic
                ? `Cosmetic: ${id}`
                : data.items[id]?.name || id;
      const key = JSON.stringify([kind, id, quantity, row[3], row[4]]);
      const existing = results.get(key);
      if (existing) existing.chance += chance;
      else results.set(key, { kind, id, name: label, quantity, chance });
    }
  }
  walk(tableName, 1, new Set());
  return [...results.values()].sort((a, b) => b.chance - a.chance || a.name.localeCompare(b.name));
}
Object.assign(globalThis, { partyExchangeRewards: exchangeRewards });
