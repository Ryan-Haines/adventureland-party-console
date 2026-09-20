'use client';
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { PackageOpen } from 'lucide-react';
import { BrokenStickIcon } from './broken-stick-icon';
import { ItemSprite } from './item-sprite';
import { deconstructionRewards, type DeconstructionCatalog } from './deconstruction';
import type { InventoryEntry } from './inventory-entry';
import type { MerchantCatalogItem } from './merchant-catalog-item';

export type DeconstructionSelection = { entry: InventoryEntry; auto: boolean; pack?: string; all?: boolean };
export function DeconstructionConfirmation({ selection, catalog, items, onClose, onConfirm }: {
  selection: DeconstructionSelection | null; catalog: DeconstructionCatalog; items: MerchantCatalogItem[];
  onClose: () => void; onConfirm: (selection: DeconstructionSelection) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const item = selection?.entry.item;
  const rewards = item ? deconstructionRewards(item, catalog) : null;
  async function confirm() {
    if (!selection || busy) return;
    setBusy(true); setError(null);
    try { await onConfirm(selection); onClose(); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not mark for deconstruction'); }
    finally { setBusy(false); }
  }
  return <Dialog open={!!selection} onOpenChange={open => { if (!open && !busy) { setError(null); onClose(); } }}>
    <DialogContent className="border-orange-800 bg-slate-950 text-slate-100">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2"><BrokenStickIcon className="h-5 w-5 text-orange-300" />{selection?.auto ? 'Enable auto deconstruction?' : selection?.all ? 'Mark all for deconstruction?' : 'Mark for deconstruction?'}</DialogTitle>
        <DialogDescription className="text-slate-300">{selection?.auto
          ? 'The merchant will deconstruct matching items at this level, stat type, and special property until you remove the rule.'
          : `The merchant will deconstruct ${selection?.all ? 'all eligible bank copies of' : `${item?.q || 1} ×`} ${items.find(entry => entry.id === item?.name)?.name || item?.name || ''}${item?.level ? ` +${item.level}` : ''}. This consumes the original items.`}</DialogDescription>
      </DialogHeader>
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-orange-200">Possible rewards per item</h3>
        {rewards?.map((reward, index) => {
          const definition = items.find(item => item.id === reward.name);
          return <div key={`${reward.name}:${index}`} className="flex items-center gap-3 rounded border border-slate-700 bg-black p-3">
            <span className="relative h-10 w-10 shrink-0 border border-slate-600 bg-slate-950">
              {definition?.sprite ? <ItemSprite sprite={definition.sprite} /> : <PackageOpen className="m-2 h-5 w-5 text-slate-300" />}
              {reward.level ? <span className="absolute bottom-0 right-0 bg-black px-1 text-xs text-amber-200">+{reward.level}</span> : null}
            </span>
            <span className="min-w-0 flex-1 text-sm">{reward.quantity} × {definition?.name || reward.name}{reward.level ? ` +${reward.level}` : ''}</span>
            <span className="font-mono text-sm font-semibold text-orange-200">{Number((reward.chance * 100).toFixed(4))}%</span>
          </div>;
        })}
        {!rewards ? <p className="text-sm text-amber-200">Reward data is unavailable. Refresh after the coordinator updates.</p> : null}
        {rewards && rewards.length > 1 ? <p className="text-xs text-slate-400">Each reward row is a separate roll. Percentages are per item deconstructed.</p> : null}
        {item && catalog[item.name]?.cost !== undefined ? <p className="text-sm text-amber-200">Cost per item: {catalog[item.name].cost!.toLocaleString()}g</p> : null}
        {error ? <p role="alert" className="text-sm text-rose-300">{error}</p> : null}
      </div>
      <DialogFooter>
        <Button disabled={busy} onClick={() => { setError(null); onClose(); }} variant="outline" className="border-slate-600 bg-black text-slate-100 hover:bg-slate-800 hover:text-white">Cancel</Button>
        <Button disabled={busy || !rewards} onClick={() => void confirm()} className="border border-orange-400 bg-orange-600 text-white hover:bg-orange-500">{busy ? 'Saving…' : selection?.auto ? 'Enable auto deconstruction' : selection?.all ? 'Mark all for deconstruction' : 'Mark for deconstruction'}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
