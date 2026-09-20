import type { Item } from "../contracts/item.ts";

/** Omitted preferences retain the historical minimum-level behavior. */
export function bidAcceptsLevel(bid: { minimumQuality?: number; acceptHigherLevels?: boolean }, item: Item | null | undefined): boolean {
  const level = Number(item?.level) || 0, requested = Number(bid.minimumQuality) || 0;
  return bid.acceptHigherLevels === false ? level === requested : level >= requested;
}
