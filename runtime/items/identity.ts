// The one identity of an item copy, a stack, a rule, a listing and a seller. Each key kind is one
// function here, with the fields the previous release's copies used, so two readers never disagree
// on which copy, pile or seller they mean. It answers on both runtimes and the dashboard, so it
// imports no node built-in.
import type { ItemInfo } from 'typed-adventureland';

/** A copy as the game reports it; partial reports can hold newer fields than the upstream types. */
export interface ItemCopy extends Partial<Pick<ItemInfo, 'q' | 'level'>> {
  name?: string;
  [key: string]: unknown;
}

// The fields that tell two copies apart. fingerprint keeps the count `q`; copyKey and sameItem
// compare without it. `expires` is compared as a time, since reports carry it as a number or a
// date text.
const COPY_FIELDS = ['name', 'level', 'q', 'p', 'stat_type', 'data', 'price', 'rid', 'b', 'm', 'l', 'v'] as const;
/** The copy's identifying fields with their values, `null` for no copy. */
export function fingerprint(item: ItemCopy | null | undefined): ItemCopy | null {
  if (!item) return null;
  const copy: Record<string, unknown> = {};
  for (const key of COPY_FIELDS) if (item[key] != null) copy[key] = item[key];
  if (item.expires != null) copy.expires = typeof item.expires === 'number' ? item.expires : new Date(String(item.expires)).getTime();
  return copy as ItemCopy;
}
/** One copy whatever its count: a production run and a mark hold their copy by this key. */
export function copyKey(item: ItemCopy | null | undefined): string {
  const copy = fingerprint(item);
  if (copy) delete copy.q;
  return JSON.stringify(copy);
}
/** A wishlist order's copy: it names the item, its level and its title, so Live WTB's "You have"
 *  counts the copies that match all three. */
export const ownedStockKey = (item: { name: string; level?: number; p?: string }): string =>
  `${item.name}@${item.level || 0}@${item.p || ''}`;
/** The bag's contents as one key: each cell's copy and count in cell order. A reader that holds the
 * key from an earlier pass learns the bag changed when the key differs, so a wait on a bag change
 * (targeting's no-bow wait) ends on the change itself. */
export function bagKey(items: readonly (ItemCopy | null | undefined)[]): string {
  return JSON.stringify(items.map(item => fingerprint(item)));
}
/** Two reads show the same copy in the same state, its count aside. */
export const sameItemState = (item: ItemCopy | null | undefined, wanted: ItemCopy | null | undefined): boolean =>
  !!item && !!wanted && copyKey(item) === copyKey(wanted);
/** A wanted copy's named fields, its count aside, all match the item (the character's partial match). */
export function sameItem(item: ItemCopy | null | undefined, wanted: ItemCopy | null | undefined): boolean {
  return !!item && !!wanted && Object.keys(wanted).filter(key => key !== 'q')
    .every(key => JSON.stringify(item[key]) === JSON.stringify(wanted[key]));
}

// A mark names a partial identity: a stack's count, its price, its stack id, its bound flag and its
// giveaway flag change while the mark still means the copy.
const MARK_TRANSIENT = new Set(['q', 'price', 'rid', 'b', 'giveaway']);
/** A mark's saved item, whether the mark saved it bare or as `{item}`, with or without its slot, as
 *  the previous release read `mark.item || mark`. */
export function markedItem<T extends ItemCopy>(entry: { item?: T; slot?: number } | T | null | undefined): T | null | undefined {
  const marked = entry as { item?: T; slot?: number } | null | undefined;
  return marked?.item ? marked.item : entry as T | null | undefined;
}
/** A copy's lasting fields as one key: two copies with the same key match as marks both ways. */
export function markKey(item: ItemCopy | null | undefined): string {
  return JSON.stringify(Object.keys(item || {}).filter(key => !MARK_TRANSIENT.has(key)).sort().map(key => [key, item![key]]));
}
/** The marked copy's lasting fields all match the item. */
export function markMatches(first: ItemCopy | null | undefined, second: ItemCopy | null | undefined): boolean {
  if (!first || !second) return false;
  return Object.keys(second).filter(key => !MARK_TRANSIENT.has(key))
    .every(key => JSON.stringify(first[key]) === JSON.stringify(second[key]));
}

const level = (item: { level?: unknown } | null | undefined): number => Math.max(0, Number(item?.level) || 0);
/** An automatic rule's key, `name@+level`. */
export const ruleKey = (item: ItemCopy | null | undefined): string =>
  typeof item?.name === 'string' ? item.name + '@+' + level(item) : '';
/** A `name@+level` rule key's item and level; `null` for a name-only key from before levels. */
export function ruleKeyParts(key: string): { name: string; level: number } | null {
  const match = /^(.*)@\+(\d+)$/.exec(key);
  return match ? { name: match[1]!, level: Number(match[2]) } : null;
}
/** The item's automatic rule; a name-only rule from before levels applies to +0 only. */
export function ruleMode<T>(rules: Readonly<Record<string, T>>, item: ItemCopy | null | undefined): T | undefined {
  if (!item) return undefined;
  const explicit = rules[ruleKey(item)];
  if (explicit) return explicit;
  return level(item) === 0 ? rules[String(item.name)] : undefined;
}
/** An automatic commerce rule's key: the item, its level, its title and its stat. */
export function commerceRuleKey(item: ItemCopy | null | undefined): string {
  return JSON.stringify({ name: item?.name || '', level: level(item), p: item?.p || null, stat_type: item?.stat_type || null });
}
/** An exchange rule's, an order material's and a craft need's key, `name@level`. */
export const exchangeKey = (name: unknown, itemLevel: unknown): string => String(name) + '@' + (Number(itemLevel) || 0);

// A pile's identity is the game's `can_stack` (game: 407-419): the name, the title `p`, a cxjar's
// `data` and whether the copy is a PvP copy (`v`). The game stacks no locked (`l`) or bound (`b`)
// copy, so the key carries both and moves no locked copy. The game also stacks a title its G.titles
// marks `stackable` with an untitled copy; identity.ts reads no game data, so stackKey keeps that
// pile apart and the plans skip its merge.
/** A pile's identity: two partial stacks with one key share a home. */
export function stackKey(item: ItemCopy | null | undefined): string {
  return JSON.stringify([item?.name ?? null, item?.p ?? null, item?.name === 'cxjar' ? item.data ?? null : null,
    !!item?.v, item?.l ?? null, item?.b ?? null]);
}
/** A stack's count; a copy with no `q` is one. */
export const stackQuantity = (item: ItemCopy | null | undefined): number => item ? Number(item.q) || 1 : 0;
// A storage cell's pack: a bank vault by its game name (G `bank_packs`), a BankBoi's
// bag and a character's bag. Withdrawal requests and the storage stock carry these names.
const BANKBOI_PACK = 'bankboi:', INVENTORY_PACK = 'inventory:';
export const bankboiPack = (name: unknown): string => BANKBOI_PACK + String(name);
export const inventoryPack = (name: unknown): string => INVENTORY_PACK + String(name);
export const isBankboiPack = (pack: unknown): pack is `bankboi:${string}` => typeof pack === 'string' && pack.startsWith(BANKBOI_PACK);
/** The BankBoi a pack names, `null` for a vault or a bag. */
export const bankboiName = (pack: unknown): string | null => isBankboiPack(pack) ? pack.slice(BANKBOI_PACK.length) : null;
export const isInventoryPack = (pack: unknown): boolean => typeof pack === 'string' && pack.startsWith(INVENTORY_PACK);
/** A bank vault's name, as G `bank_packs` names them: `items` and its number. */
export const isVaultPack = (pack: unknown): boolean => typeof pack === 'string' && /^items\d+$/.test(pack);
/** A pack name a request may carry: a vault name or a BankBoi's bag, `null` for anything else. */
export function storagePack(value: unknown): string | null {
  return typeof value === 'string' && /^(?:[a-z0-9_]+|bankboi:[A-Za-z0-9_]+)$/i.test(value) ? value : null;
}
/** A mail or exchange request's storage identity: name, level and stat, nothing else. */
export function storageKey(input?: unknown): string {
  // Mail requests are untrusted: the read keeps JS property access and copies nothing.
  const item = input as { name?: unknown; level?: unknown; stat_type?: unknown } | null | undefined;
  return JSON.stringify([(item && item.name) || '', Number(item && item.level) || 0, (item && item.stat_type) || null]);
}

/** A public listing's key: seller, realm, slot, item, level and price. */
export function listingKey(listing: { seller?: unknown; serverRegion?: unknown; serverIdentifier?: unknown; slot?: unknown;
  item?: { name?: unknown; level?: unknown } | null; price?: unknown }): string {
  return [listing.seller, listing.serverRegion, listing.serverIdentifier, listing.slot, listing.item?.name,
    Number(listing.item?.level) || 0, Number(listing.price) || 0].join(':');
}
/** A seller on a realm; a merchant record names it `seller` or `name`. */
export function sellerKey(entry: { seller?: unknown; name?: unknown; serverRegion?: unknown; serverIdentifier?: unknown } | null | undefined): string {
  return [entry && (entry.seller || entry.name), entry?.serverRegion, entry?.serverIdentifier].map(value => String(value || '')).join('|');
}
/** A market lot's item group: every field but its stack id, count and price, keys sorted. */
export function pontyGroupKey(item: ItemCopy): string {
  const clean: Record<string, unknown> = { ...item, level: Number(item.level) || 0 };
  for (const key of ['rid', 'q', 'price']) delete clean[key];
  return JSON.stringify(Object.fromEntries(Object.keys(clean).sort().filter(key => clean[key] != null).map(key => [key, clean[key]])));
}
/** One Ponty or ALData lot: its realm and stack id. */
export const pontyKey = (serverRegion: string | undefined, serverIdentifier: string, rid: unknown): string =>
  serverRegion + ':' + serverIdentifier + ':' + rid;
/** An ignored market item's key, `name|level`. */
export const marketItemKey = (item: { name: string; level?: number }): string => `${item.name}|${item.level ?? 0}`;
