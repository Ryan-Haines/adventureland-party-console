// The dashboard's display formulas over game data
// Each reads the catalog's G definitions and prices; the grade and scroll
// counts are the items owner's rules (runtime/items/rules.ts), so this file holds the sums over them. The
// item and character stat formulas the game data does not carry follow their game source
// (kaansoral/adventureland_mongodb), named at each one; report.ts's run speed reads the same lines.
import { itemGrade, statScrollsNeeded } from '../../runtime/items/api.ts';

type Definition = { upgrade?: unknown; compound?: unknown; grades?: unknown };
/** A catalog item's price by id, or undefined when the catalog lacks it. */
type CatalogPrice = (id: string) => number | undefined;
/** The one scroll price read for every menu: the item's game value `g` in the merchant catalog's
 * allItems, the price an NPC charges (the buyable list's `cost` copies it, bag.ts merchantCatalog).
 * The buyable list holds only NPC-sold items, and Lucas (G npcs.scrolls) sells no scroll3.
 * b9b5c91e's upgrade menu priced scroll0 to scroll3 at the same game values
 * (upgrade-scroll-cost.tsx:12, 1,000 to 64,000,000). */
export function catalogPrice(catalog: readonly { id: string; meta?: { definition: Record<string, unknown> } | null }[]): CatalogPrice {
  return (id) => {
    const value = catalog.find((item) => item.id === id)?.meta?.definition.g;
    return value === undefined ? undefined : Number(value);
  };
}

// Lucas (G npcs.scrolls, game version 18285) sells scroll0 to scroll2, so a scroll of this grade
// or above has no NPC seller; the upgrade menu prices it at its game value `g` and labels it.
export const NPC_SOLD_SCROLL_GRADES = 3;
/** The scroll grade of each level of an upgrade from `startLevel` over `tiers` tiers: the item's
 * grade at that level (G node/server.js "upgrade" refuses a scroll below the item's grade). The
 * catalog's definition is safeItemDefinition's copy, which drops the `upgrade` object, so the
 * grade reads the item as upgradeable, as compound-cost.ts reads a compound. */
export function upgradeScrollGrades(definition: Definition, startLevel: number, tiers: number): number[] {
  return Array.from({ length: tiers }, (_, tier) => itemGrade({ upgrade: true, grades: definition.grades }, startLevel + tier));
}
/** The upgradeScrollGrades run at the catalog's price. Null when a scroll's price is missing. */
export function upgradeScrollCost(definition: Definition, startLevel: number, tiers: number, price: CatalogPrice): number | null {
  let total = 0;
  for (const grade of upgradeScrollGrades(definition, startLevel, tiers)) {
    const cost = price('scroll' + grade);
    if (cost === undefined || !Number.isFinite(cost)) return null;
    total += cost;
  }
  return total;
}
/** The stat scrolls the item's grade needs. The grade reads the catalog definition's `grades`
 * as upgradeScrollGrades does, as b9b5c91e's stat-scroll-quantity.tsx:5-18 did. */
export function statScrollCount(definition: Definition, level: number): number {
  return statScrollsNeeded({ upgrade: true, grades: definition.grades }, level);
}
/** A stat scroll run's cost: statScrollCount at the scroll's catalog price. Null when the price is
 * missing. */
export function statScrollCost(definition: Definition, level: number, scroll: string, price: CatalogPrice): number | null {
  const cost = price(scroll);
  return cost === undefined || !Number.isFinite(cost) ? null : cost * statScrollCount(definition, level);
}
/** The four upgrade scrolls' catalog prices, scroll0 to scroll3, as the items owner's upgrade estimate reads
 * them. Null when one is missing, so the estimate shows as unavailable. */
export function upgradeScrollPrices(price: CatalogPrice): number[] | null {
  const prices = [0, 1, 2, 3].map(grade => price('scroll' + grade));
  return prices.every(value => value !== undefined && Number.isFinite(value)) ? prices as number[] : null;
}

// The item stat keys and stat scroll multipliers of calculate_item_properties (kaansoral/
// adventureland_mongodb js/old_common_functions.js: its `prop` and `mult` tables). A stat scroll
// turns an item's `stat` into its stat at that multiplier; mp_cost's is negative, so a mp_cost
// scroll lowers the cost.
const ITEM_PROPERTY_KEYS = new Set([
  'gold', 'luck', 'xp', 'int', 'str', 'dex', 'vit', 'for', 'charisma', 'cuteness', 'awesomeness', 'bling', 'hp', 'mp',
  'attack', 'range', 'armor', 'incdmgamp', 'resistance', 'pnresistance', 'firesistance', 'fzresistance', 'phresistance',
  'stresistance', 'stun', 'blast', 'explosion', 'breaks', 'stat', 'speed', 'evasion', 'miss', 'reflection', 'lifesteal',
  'manasteal', 'attr0', 'attr1', 'rpiercing', 'apiercing', 'crit', 'critdamage', 'dreturn', 'frequency', 'mp_cost',
  'mp_reduction', 'output', 'courage', 'mcourage', 'pcourage',
]);
const STAT_MULTIPLIER: Record<string, number> = {
  gold: 0.5, luck: 1, xp: 0.5, int: 1, str: 1, dex: 1, vit: 1, for: 1, armor: 2.25, resistance: 2.25, speed: 0.325,
  evasion: 0.325, reflection: 0.15, lifesteal: 0.15, manasteal: 0.04, rpiercing: 2.25, apiercing: 2.25, crit: 0.125,
  dreturn: 0.5, frequency: 0.325, mp_cost: -0.6, output: 0.175,
};
// calculate_item_properties keeps these keys unrounded.
const UNROUNDED = new Set(['evasion', 'miss', 'reflection', 'dreturn', 'lifesteal', 'manasteal', 'attr0', 'attr1', 'crit',
  'critdamage', 'breaks']);
// doublehand_types in js/old_common_functions.js: a shiny two-handed weapon gains 3 more attack.
const DOUBLEHAND_TYPES = new Set(['axe', 'basher', 'great_staff']);

type ItemFacts = {
  definition?: Record<string, unknown>;
  scaling?: Record<string, unknown>;
  upgradeable?: boolean;
  compoundable?: boolean;
  title?: object | null;
};
type ItemCopy = { p?: string | null; stat_type?: string | null };

/** The stats calculate_item_properties adds for a copy's title (item.p). Glitched adds a random
 * stat on each calculation, so it adds nothing here; the item card shows it as a note. */
function titleBonus(item: ItemCopy, meta: ItemFacts | null | undefined): Record<string, number> {
  const definition = meta?.definition || {};
  const has = (key: string) => !!Number(definition[key]);
  if (item.p === 'shiny') {
    if (has('attack')) return { attack: DOUBLEHAND_TYPES.has(String(definition.wtype)) ? 7 : 4 };
    if (has('stat')) return { stat: 2 };
    if (has('armor')) return { armor: 12, resistance: 10 };
    return { dex: 1, int: 1, str: 1 };
  }
  if (!item.p || item.p === 'glitched' || !meta?.title) return {};
  const bonus: Record<string, number> = {};
  for (const [key, value] of Object.entries(meta.title))
    if (ITEM_PROPERTY_KEYS.has(key) && typeof value === 'number') bonus[key] = value;
  return bonus;
}

// The per-level multiplier of calculate_item_properties (js/old_common_functions.js:1042-1060 at
// game pin 16881a27, tools/sim/pins.json): an upgrade's +7 to +12 and a compound's +5 and up scale
// the definition's `upgrade` or `compound` gain. The game names no multiplier for an upgrade's +13,
// so that step adds the plain gain; the items owner offers no +13 (items/rules.ts maximumItemLevel).
const UPGRADE_STEP: Record<number, number> = { 7: 1.25, 8: 1.5, 9: 2, 10: 3, 11: 1.25, 12: 1.25 };
const COMPOUND_STEP: Record<number, number> = { 5: 1.25, 6: 1.5, 7: 2 };
function levelMultiplier(meta: ItemFacts, step: number): number {
  if (meta.upgradeable) return UPGRADE_STEP[step] ?? 1;
  if (meta.compoundable) return step >= 8 ? 3 : COMPOUND_STEP[step] ?? 1;
  return 1;
}

/** An item copy's stats at `level`, as calculate_item_properties computes them from the catalog's
 * definition, its `upgrade` or `compound` gain (`scaling`) and the copy's title. The game applies
 * the title before the levels, so a shiny item's extra stat follows its stat scroll
 * (docs/item-titles.md). A definition's `legacy` stats are not covered: the reported definition
 * drops nested objects. */
export function itemProperties(meta: ItemFacts | undefined, item: ItemCopy, level: number): Record<string, number> {
  const definition = meta?.definition || {}, scaling = meta?.scaling || {};
  const values: Record<string, number> = {};
  ITEM_PROPERTY_KEYS.forEach(key => {
    const base = Number(definition[key]);
    if (Number.isFinite(base)) values[key] = base;
  });
  Object.entries(titleBonus(item, meta)).forEach(([key, amount]) => { values[key] = (values[key] || 0) + amount; });
  for (let step = 1; step <= level; step += 1) {
    const multiplier = meta ? levelMultiplier(meta, step) : 1;
    Object.entries(scaling).forEach(([key, raw]) => {
      const amount = Number(raw);
      if (!Number.isFinite(amount)) return;
      values[key] = (values[key] || 0) + (key === 'stat' ? Math.round(amount * multiplier) : amount * multiplier);
      if (key === 'stat' && step >= 7) values.stat = (values.stat || 0) + 1;
    });
  }
  if (level === 10 && values.stat && Number(definition.tier) >= 3) values.stat += 2;
  Object.keys(values).forEach(key => { if (!UNROUNDED.has(key)) values[key] = Math.round(values[key] || 0); });
  const multiplier = item.stat_type ? STAT_MULTIPLIER[item.stat_type] : undefined;
  if (item.stat_type && values.stat && multiplier !== undefined) {
    values[item.stat_type] = (values[item.stat_type] || 0) + values.stat * multiplier;
    delete values.stat;
  }
  return values;
}

// The attribute lines of calculate_player_stats (kaansoral/adventureland_mongodb
// js/progression/stats.js): each is the share of a stat the attribute adds, so the stats dialog
// shows it and the gear comparison moves it with a changed attribute.
export const attributeStats = {
  maxHp: (str: number, vit: number, level: number) => str * 21 + vit * (48 + level / 3),
  maxMp: (int: number) => int * 15,
  armor: (str: number) => Math.min(str, 160) + Math.max(0, str - 160) * 0.25,
  resistance: (int: number) => Math.min(int, 180) + Math.max(0, int - 180) * 0.25,
  runSpeed: (str: number, dex: number) => Math.min(dex, 256) / 32 + Math.min(str, 256) / 64,
  frequency: (int: number, dex: number) => Math.min(160, dex) / 640 + Math.max(dex - 160, 0) / 925 + int / 1575,
};
/** The run speed calculate_player_stats adds for the character's level. */
export function levelRunSpeed(level: number): number {
  return Math.min(level, 40) / 10 + Math.max(0, Math.min(level - 40, 20)) / 15 + Math.max(0, Math.min(86, level) - 60) / 16;
}
/** The divisor of one attribute in weapon_stat_attack (js/progression/stats.js): a paladin's
 * attack grows with STR / 20 and INT / 40; every other class's with its main stat / 20. Zero
 * when the attribute adds no attack. */
export function attackDivisor(ctype: string, mainStat: string, stat: string): number {
  if (ctype === 'paladin') return stat === 'str' ? 20 : stat === 'int' ? 40 : 0;
  return stat === mainStat ? 20 : 0;
}
/** weapon_stat_attack: the attack the attributes add to the weapons' attack. */
export function weaponStatAttack(ctype: string, mainStat: string, stats: Record<string, unknown>, weaponAttack: number): number {
  return ['str', 'int', 'dex'].reduce((sum, stat) => {
    const divisor = attackDivisor(ctype, mainStat, stat);
    return divisor ? sum + weaponAttack * (Number(stats[stat]) || 0) / divisor : sum;
  }, 0);
}
type Equipped = [slot: string, entry: { meta?: { properties?: Record<string, unknown>; definition?: Record<string, unknown> } | null }];
/** calculate_player_stats's `item_attack`: the mainhand's attack and 0.7 of the offhand's, a third
 * of that when stars in the mainhand pair with an offhand of another kind, and at least 5. */
export function itemAttack(equipment: Equipped[]): number {
  const slot = (name: string) => equipment.find(([id]) => id === name)?.[1].meta;
  const mainhand = slot('mainhand'), offhand = slot('offhand');
  let attack = (Number(mainhand?.properties?.attack) || 0) + (Number(offhand?.properties?.attack) || 0) * 0.7;
  if (mainhand && offhand && mainhand.definition?.wtype === 'stars' && offhand.definition?.wtype !== 'stars') attack /= 3;
  return Math.max(attack, 5);
}
// The character sheet values the game derives from a reported stat (kaansoral/adventureland_mongodb).
/** A critical hit multiplies damage by 2 + critdamage / 100 (node/server.js `cmult`), so the sheet
 * shows 200 + critdamage percent (js/html.js "critical_damage"). */
export function critDamagePercent(critdamage: number): number {
  return 200 + critdamage;
}
/** The defense fortitude counts as against a player's hit (node/server.js
 * `damage_multiplier(target["for"] * 5)`). */
export function fortitudeDefense(fortitude: number): number {
  return fortitude * 5;
}
/** The luck percent with no luck bonus: calculate_player_stats starts `luckm` at 1
 * (js/progression/stats.js) and the sheet shows `luckm * 100` (js/html.js "luck"). */
export const BASE_LUCK_PERCENT = 100;
// damage_multiplier (js/old_common_functions.js): the share of a hit that passes armor or
// resistance, up to 1.32 for negative defense. The protocol's copy is the one rule.
export { damageMultiplier } from '../../runtime/protocol/hold-check.ts';
