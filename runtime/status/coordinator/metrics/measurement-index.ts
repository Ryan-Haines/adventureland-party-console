import type { MetricTotals, MetricResetKind } from '../../api.ts';

type Context = Pick<MetricTotals, 'character' | 'server'>;
export type IndexedDamage = Context & MetricTotals['damage'][number];
export type IndexedLoot = Context & MetricTotals['loot'][number];

/** Totals follow accepted measurements, not append records or rollup copies. */
export function createMeasurementIndex() {
  const damage = new Map<string, IndexedDamage>(), loot = new Map<string, IndexedLoot>();
  /** Adds totals already keyed by character and server: a day file's sums (service.ts) or a bucket's rows. */
  function addIndexed(hits: Iterable<IndexedDamage>, items: Iterable<IndexedLoot>, direction: 1 | -1 = 1) {
    for (const hit of hits) {
      const key = JSON.stringify([hit.character, hit.server, hit.monster, hit.skill]);
      const previous = damage.get(key), amount = (previous?.amount || 0) + direction * hit.amount, count = (previous?.hits || 0) + direction * hit.hits;
      if (amount > 0) damage.set(key, { ...hit, amount, hits: count }); else damage.delete(key);
    }
    for (const item of items) {
      const key = JSON.stringify([item.character, item.server, item.item, item.variant]);
      const quantity = (loot.get(key)?.quantity || 0) + direction * item.quantity;
      if (quantity > 0) loot.set(key, { ...item, quantity }); else loot.delete(key);
    }
  }
  function add(rows: MetricTotals[], direction: 1 | -1 = 1) {
    for (const row of rows) {
      const context = { character: row.character, server: row.server };
      addIndexed(row.damage.map(hit => ({ ...context, ...hit })), row.loot.map(item => ({ ...context, ...item })), direction);
    }
  }
  return { add, addIndexed, damage: () => damage.values(), loot: () => loot.values(),
    clear(kinds: MetricResetKind[]) { if (kinds.includes('damage')) damage.clear(); if (kinds.includes('loot')) loot.clear(); },
  };
}
