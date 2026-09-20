import { ContextMenuItem, ContextMenuSeparator } from '@/components/ui/context-menu';
import { BrokenStickIcon } from './broken-stick-icon';
import { canDeconstruct, type DeconstructionCatalog } from './deconstruction';
import type { InventoryEntry } from './inventory-entry';
export function BankDeconstructionActions({ entry, pack, merchant, catalog, onMark }: {
  entry: InventoryEntry; pack: string; merchant?: string | null; catalog: DeconstructionCatalog;
  onMark: (pack: string, entry: InventoryEntry, all: boolean) => void;
}) {
  if (!canDeconstruct(entry.item, catalog)) return null;
  return <>
    <ContextMenuSeparator className="my-1 h-px bg-slate-600" />
    {[false, true].map(all => <ContextMenuItem className="text-orange-300" key={String(all)} disabled={!merchant} onClick={() => onMark(pack, entry, all)}>
      <BrokenStickIcon className="mr-2 h-4 w-4" />
      {all ? 'Mark all for deconstruction' : 'Mark for deconstruction'}
    </ContextMenuItem>)}
  </>;
}
