import type { GameResponseDataUpgradeChance } from 'typed-adventureland';
import type { Item } from './coordinator/contracts/item.ts';
import type { UpgradeOffering } from './upgrade-offerings.ts';

/** Official previews omit offering without an offering, and include calculate.
 * Item/scroll IDs may be newer than typed-adventureland 0.0.57. */
export type UpgradeServerPreview = Omit<GameResponseDataUpgradeChance, 'item' | 'scroll' | 'offering' | 'response'> & {
  calculate: true;
  response?: 'upgrade_chance';
  item: Item;
  scroll: string;
  offering?: string;
};
export const previewOptions = ['none', 'offeringp', 'offering', 'offeringx'] as const;
export type PreviewOption = 'none' | UpgradeOffering;
export interface UpgradePreviewRequest {
  id: string;
  executor: string;
  session: string;
  slot: number;
  item: Item;
  expiresAt: number;
}
export type PreviewResult = { preview: UpgradeServerPreview; observedAt: number } | { reason: string };
export interface UpgradePreviewResult {
  executor: string;
  item: Item;
  options: Record<PreviewOption, PreviewResult>;
}
export function unavailablePreview(executor: string, item: Item, reason: string): UpgradePreviewResult {
  return { executor, item, options: Object.fromEntries(previewOptions.map(option => [option, { reason }])) as UpgradePreviewResult['options'] };
}
