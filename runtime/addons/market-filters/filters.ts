// The filter bar's value and its row test, kept apart from the control so the tests run them
// without React. The value is one object per Market tab, because the list-view slot hands each
// add-on one value per tab.

// The fields of addon-kit.ts AddonListRow the bar reads. The runtime build compiles this file too,
// so it names the fields here instead of importing the dashboard's kit.
export interface MarketRow { level?: number; grade?: number; price?: number; seen?: number; realm?: string }

export interface MarketFilter {
  minLevel?: number;
  maxLevel?: number;
  minPrice?: number;
  maxPrice?: number;
  // A row's realm as the Market writes it, "<region> <identifier>", such as "US I".
  server?: string;
  // The game's item grade, 0 to 4, which the Market shows as the item name's colour.
  grade?: number;
  // Newest first sorts the tab by when the Market last saw each row.
  newest?: boolean;
}

const FIELDS = ['minLevel', 'maxLevel', 'minPrice', 'maxPrice', 'server', 'grade', 'newest'] as const;

// The names the game gives grades 0 to 4.
export const GRADE_NAMES = ['Normal', 'High', 'Rare', 'Legendary', 'Exotic'] as const;

// normalize drops empty fields and an unticked Newest first, and returns undefined when none is left, so the bar hands the slot
// `set(undefined)` and the tab shows every row again.
export function normalize(value: MarketFilter | undefined): MarketFilter | undefined {
  if (!value) return undefined;
  const kept: MarketFilter = {};
  for (const field of FIELDS) {
    const entry = value[field];
    if (entry === undefined || entry === '' || entry === false || (typeof entry === 'number' && !Number.isFinite(entry))) continue;
    (kept as Record<string, unknown>)[field] = entry;
  }
  return Object.keys(kept).length ? kept : undefined;
}

// parsePrice reads the shorthand the Market's prices are written in: "250k" is 250,000 and "1.5m"
// is 1,500,000. Commas and spaces are ignored. Anything else reads as no bound.
export function parsePrice(text: string): number | undefined {
  const match = /^(\d+(?:\.\d+)?)([kmb]?)$/i.exec(text.replace(/[,\s]/g, ''));
  if (!match) return undefined;
  const scale = { '': 1, k: 1e3, m: 1e6, b: 1e9 }[match[2]!.toLowerCase() as '' | 'k' | 'm' | 'b'];
  return Math.round(Number(match[1]) * scale);
}

export function parseLevel(text: string): number | undefined {
  return /^\d+$/.test(text.trim()) ? Number(text.trim()) : undefined;
}

// keep tests one row against the bar's value. A row with no level is an item that takes no
// upgrade, so a level bound reads it as level 0. A row with no price, realm or grade fails a bound
// on that field, since the bar cannot show it meets the bound.
export function keep(row: MarketRow, raw: unknown): boolean {
  const value = normalize(raw as MarketFilter | undefined);
  if (!value) return true;
  const level = row.level ?? 0;
  if (value.minLevel !== undefined && level < value.minLevel) return false;
  if (value.maxLevel !== undefined && level > value.maxLevel) return false;
  if (value.minPrice !== undefined && (row.price === undefined || row.price < value.minPrice)) return false;
  if (value.maxPrice !== undefined && (row.price === undefined || row.price > value.maxPrice)) return false;
  if (value.server !== undefined && row.realm !== value.server) return false;
  if (value.grade !== undefined && row.grade !== value.grade) return false;
  return true;
}

// order puts the most recently seen row first while Newest first is ticked. A row with no seen
// time goes last. The list keeps its own order for ties, and the Classifieds tab stamps every row
// with the feed's one update time, so Newest first leaves that tab in its own order.
export function order(a: MarketRow, b: MarketRow, raw: unknown): number {
  if (!normalize(raw as MarketFilter | undefined)?.newest) return 0;
  return (b.seen ?? -Infinity) - (a.seen ?? -Infinity) || 0;
}

// grades lists the grades the tab's rows carry, lowest first.
export function grades(rows: readonly MarketRow[]): number[] {
  return [...new Set(rows.flatMap((row) => (row.grade === undefined ? [] : [row.grade])))].sort((a, b) => a - b);
}

// servers lists the realms the tab's rows come from, in name order. The Classifieds tab's rows
// carry no realm, so the list is empty there and the bar draws no server choice.
export function servers(rows: readonly MarketRow[]): string[] {
  return [...new Set(rows.flatMap((row) => (row.realm ? [row.realm] : [])))].sort();
}
