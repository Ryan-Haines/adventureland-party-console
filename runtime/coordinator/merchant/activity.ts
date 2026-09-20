import type { InventoryEntry } from '../contracts/item.ts';
import { requestObject } from '../http/contracts.ts';
import { sameMarkedItem } from '../inventory/item-identity.ts';
import { evaluateAutoCompounds } from './automatic-improvements.ts';
export type MerchantOperationStage = 'retrieving' | 'processing' | 'storing';
export function operationStage(value: unknown): MerchantOperationStage | undefined {
  return value === 'retrieving' || value === 'processing' || value === 'storing' ? value : undefined;
}
/** Projection fallback for queued work; active executor reports take precedence. */
export function plannedOperationStage(reason: string, inventory: readonly (Pick<InventoryEntry, "item"> | null)[], compounds: unknown, upgrades: unknown): MerchantOperationStage | undefined {
  if (reason === 'auto npc sales') return 'processing';
  if (reason === 'auto upgrade') {
    const marks = Array.isArray(upgrades) ? upgrades.map(requestObject).filter(mark => mark.auto) : [];
    return marks.some(mark => inventory.some(entry => entry?.item && sameMarkedItem(entry.item, requestObject(mark.item)))) ? 'processing' : 'retrieving';
  }
  if (reason !== 'auto compound') return undefined;
  const rules = Array.isArray(compounds) ? compounds.map(value => {
    const rule = requestObject(value); return {name: String(rule.name), targetTier: Number(rule.targetTier) || 1, quantity: Number(rule.quantity)};
  }) : [];
  return evaluateAutoCompounds(rules, inventory).runnable ? 'processing' : 'retrieving';
}
