import type { InventoryEntry, Item } from "../contracts/item.ts";
import { automaticCommerceRuleKey, sameMarkedItem } from "../inventory/item-identity.ts";
import { protectedMerchantStorageStock } from "../inventory/merchant-storage-stock.ts";

export interface NpcSaleKeepState {
  merchantCharacter?: string | null;
  autoNpcSales?: Record<string, { character?: string; keep?: number } | undefined>;
  npcSaleMarks?: readonly { source?: string; slot?: number; item?: Item; quantity?: number; autoRuleKey?: string }[];
  withdrawals?: Record<string, readonly { item?: Item | null; autoNpcRuleKey?: string }[] | undefined>;
}

/** #116: the merchant-wide rule that keeps some copies, if any. */
export function keptNpcSaleRule(state: NpcSaleKeepState, key: string): { keep: number } | undefined {
  const rule = state.autoNpcSales?.[key];
  return rule && !rule.character && Number.isSafeInteger(rule.keep) && Number(rule.keep) > 0 ? { keep: rule.keep! } : undefined;
}

/**
 * #116: copies a keep rule may still sell. Stock is what the merchant's bag, bank and BankBois
 * hold outside craft reservations, less copies already marked or being withdrawn for sale.
 */
export function npcSaleSpare(state: NpcSaleKeepState, key: string, keep: number,
  stock: ReturnType<typeof protectedMerchantStorageStock> = protectedMerchantStorageStock(state)): number {
  const pending = state.withdrawals?.[String(state.merchantCharacter)] || [];
  const held = stock.filter(entry => entry.item && automaticCommerceRuleKey(entry.item) === key).reduce((sum, entry) => sum + (Number(entry.item?.q) || 1), 0);
  const marked = (state.npcSaleMarks || []).filter(mark => mark.source === "merchant" && mark.item &&
    automaticCommerceRuleKey(mark.item) === key).reduce((sum, mark) => sum + (Number(mark.quantity) || 1), 0);
  const withdrawing = pending.filter(mark => mark.autoNpcRuleKey === key).reduce((sum, mark) => sum + (Number(mark.item?.q) || 1), 0);
  return held - keep - marked - withdrawing;
}

/**
 * #116: the NPC-sale rule replaces the item's bank rule, so kept copies the merchant carries
 * need their own way back to storage. A carried copy is banked once nothing is left to sell
 * and no sale claims its slot. One predicate serves a whole inventory pass.
 */
export function keptNpcSaleCopies(state: NpcSaleKeepState): (entry: Pick<InventoryEntry, "slot" | "item">) => boolean {
  let stock: ReturnType<typeof protectedMerchantStorageStock> | undefined;
  const spare = new Map<string, number>();
  return (entry) => {
    if (!entry.item) return false;
    const key = automaticCommerceRuleKey(entry.item), rule = keptNpcSaleRule(state, key);
    if (!rule) return false;
    if (state.npcSaleMarks?.some(mark => mark.source === "merchant" && mark.slot === entry.slot && sameMarkedItem(entry.item, mark.item)))
      return false;
    if (!spare.has(key)) spare.set(key, npcSaleSpare(state, key, rule.keep, stock ||= protectedMerchantStorageStock(state)));
    return spare.get(key)! <= 0;
  };
}
