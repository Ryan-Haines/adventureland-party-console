import { previewOptions, unavailablePreview, type PreviewOption, type PreviewResult, type UpgradePreviewRequest, type UpgradePreviewResult, type UpgradeServerPreview } from '../upgrade-preview.ts';
import type { Item } from '../coordinator/contracts/item.ts';

interface Ports {
  items(): (Item | null)[];
  grade(item: Item): number;
  current(): boolean;
  now(): number;
  preview(slot: number, scroll: number, offering: number | null, calculate: true): Promise<UpgradeServerPreview>;
}
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
export function matchesPreviewItem(live: Item | null | undefined, wanted: Item): boolean {
  return !!live && Object.entries(wanted).every(([key, value]) => same(live[key], value));
}
/** Caller holds the character's inventory/upgrade guard until the official deferred settles. */
export async function previewUpgrade(request: UpgradePreviewRequest, ports: Ports): Promise<UpgradePreviewResult> {
  const live = ports.items()[request.slot];
  if (!matchesPreviewItem(live, request.item)) return unavailablePreview(request.executor, request.item, 'Item changed; reopen the menu');
  const original = JSON.stringify(live);
  const result = unavailablePreview(request.executor, request.item, 'Preview expired; refresh');
  for (const option of previewOptions) {
    if (!ports.current() || ports.now() >= request.expiresAt) break;
    if (JSON.stringify(ports.items()[request.slot]) !== original)
      return unavailablePreview(request.executor, request.item, 'Item changed; reopen the menu');
    result.options[option] = await previewOption(request, ports, live!, option);
    if (!ports.current() || JSON.stringify(ports.items()[request.slot]) !== original)
      return unavailablePreview(request.executor, request.item, 'Item or session changed; reopen the menu');
  }
  return result;
}
async function previewOption(request: UpgradePreviewRequest, ports: Ports, live: Item, option: PreviewOption): Promise<PreviewResult> {
  const scrollName = 'scroll' + ports.grade(live);
  const scroll = ports.items().findIndex(item => item?.name === scrollName);
  const offering = option === 'none' ? null : ports.items().findIndex(item => item?.name === option && !item.l);
  if (scroll < 0) return { reason: 'Missing ' + scrollName + ' in merchant inventory' };
  if (offering === -1) return { reason: 'Offering not in merchant inventory' };
  try {
    const preview = await ports.preview(request.slot, scroll, offering, true);
    if (!validPreview(preview, request.item, scrollName, option)) throw Error('Mismatched server preview');
    return { preview, observedAt: ports.now() };
  } catch (error) { return { reason: previewError(error) }; }
}
function validPreview(preview: UpgradeServerPreview, item: Item, scroll: string, option: PreviewOption): boolean {
  return preview.calculate === true && Number.isFinite(preview.chance) && preview.chance >= 0 &&
    preview.scroll === scroll && (preview.offering || undefined) === (option === 'none' ? undefined : option) &&
    matchesPreviewItem(preview.item, item);
}
function previewError(error: unknown): string {
  if (error instanceof Error) return error.message;
  const data = error as { reason?: string; response?: string } | null;
  const reason = data?.reason || data?.response || 'Server preview unavailable';
  return ({ cant_in_bank: 'Merchant is in the bank', distance: 'Merchant must be near the upgrader or have a computer', upgrade_in_progress: 'Merchant busy', item_locked: 'Item is locked' } as Record<string, string>)[reason] || reason;
}
(globalThis as unknown as { previewPartyUpgrade: typeof previewUpgrade }).previewPartyUpgrade = previewUpgrade;
