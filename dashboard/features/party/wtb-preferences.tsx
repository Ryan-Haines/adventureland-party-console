'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Check, Info, Package } from 'lucide-react';
import { ItemSprite } from './item-sprite';
import type { MerchantCatalogItem } from './merchant-catalog-item';
import { PartyActionError } from './query-actions';

export type WTBOptions = {
  editField?: 'price' | 'quantity' | 'priorityOverride';
  value?: number | null;
  bidRevision?: number;
  preferencesOnly?: boolean;
  useStandSlot?: boolean;
  acceptHigherLevels?: boolean;
  replaceStandEntry?: string;
};
export const standBuyExplanation =
  'Uses a merchant stand slot to advertise this buy order to other players. Automatic shopping continues whether this is enabled or disabled.';
export const higherLevelExplanation =
  'Also buy higher-level items at or below your price. Disable for exact-level purchases, such as crafting ingredients.';
export const autoStandExplanation =
  'Automatically uses an empty stand slot for a highest priority buy order. A new sell listing takes this slot when needed; your stand-slot preference stays unchecked.';

export function WTBPreference({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange(value: boolean): void;
  disabled?: boolean;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1.5 text-xs text-violet-100">
      <label className="flex items-center gap-2">
        <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
          <input type="checkbox" aria-label={label} checked={checked} disabled={disabled}
            onChange={event => onChange(event.currentTarget.checked)}
            className="h-4 w-4 cursor-pointer appearance-none rounded border border-violet-400 bg-black checked:border-violet-300 checked:bg-violet-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300 disabled:cursor-not-allowed disabled:opacity-50" />
          {checked && <Check aria-hidden="true" className="pointer-events-none absolute h-3 w-3 text-white" />}
        </span>
        {label}
      </label>
      <Popover>
        <PopoverTrigger
          openOnHover
          delay={100}
          render={
            <button
              type="button"
              aria-label={`Information: ${label}`}
              className="rounded border border-violet-700 bg-black p-1 text-violet-200 hover:bg-violet-950 hover:text-white"
            />
          }
        >
          <Info className="h-3 w-3" />
        </PopoverTrigger>
        <PopoverContent
          side="top"
          className="max-w-xs whitespace-normal border border-violet-600 bg-black text-sm text-violet-100"
        >
          {description}
        </PopoverContent>
      </Popover>
    </div>
  );
}
type Occupant = {
  id: string;
  itemId: string;
  kind: string;
  price: number;
  quantity: number;
};
export function useWTBReplacement(catalog: MerchantCatalogItem[] = []) {
  const [pending, setPending] = useState<{
    occupants: Occupant[];
    action: (replacement?: string) => Promise<void>;
  } | null>(null);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  async function save(action: (replacement?: string) => Promise<void>) {
    setError('');
    try {
      await action();
    } catch (failure) {
      if (
        failure instanceof PartyActionError &&
        Array.isArray(failure.details.occupants)
      ) {
        setSelected('');
        setError('');
        setPending({
          occupants: failure.details.occupants as Occupant[],
          action,
        });
      } else
        setError(
          failure instanceof Error ? failure.message : 'Could not save WTB',
        );
    }
  }
  const dialog = (
    <>
      {pending && (
        <Dialog
          open={!!pending}
          onOpenChange={(open) => {
            if (!open && !saving) setPending(null);
          }}
        >
          <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden border border-violet-700 bg-[#101019] text-violet-100 sm:max-w-xl">
            <DialogHeader className="shrink-0 pr-8">
              <DialogTitle className="text-xl text-white">Make room for a buy order</DialogTitle>
              <DialogDescription className="text-sm leading-relaxed text-violet-200">
                All stand slots are full. Which item would you like to remove to make room for the buy order?
              </DialogDescription>
            </DialogHeader>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1" role="radiogroup" aria-label="Stand listing to replace">
              {pending.occupants.map(entry => {
                const item = catalog.find(item => item.id === entry.itemId);
                const active = selected === entry.id;
                return <label key={entry.id} className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${active ? 'border-violet-400 bg-violet-950' : 'border-slate-700 bg-[#091310] hover:border-violet-600 hover:bg-[#16221e]'}`}>
                  <input type="radio" name="stand-replacement" value={entry.id} checked={active} disabled={saving} onChange={() => setSelected(entry.id)} className="h-4 w-4 shrink-0 accent-violet-400 [color-scheme:dark]" />
                  <span className="relative h-11 w-11 shrink-0 rounded border border-slate-600 bg-black">
                    {item?.sprite ? <ItemSprite sprite={item.sprite} /> : <Package aria-hidden="true" className="m-2 h-6 w-6 text-slate-400" />}
                  </span>
                  <span className="min-w-0 flex-1"><span className="block truncate font-medium text-white">{item?.name || entry.itemId}</span><span className="block text-xs tabular-nums text-slate-300">{entry.quantity.toLocaleString()} at {entry.price.toLocaleString()}g each</span></span>
                  <span className={`rounded border px-2 py-1 text-xs font-medium ${entry.kind === 'sale' ? 'border-amber-700 bg-amber-950 text-amber-200' : 'border-violet-600 bg-violet-950 text-violet-200'}`}>{entry.kind === 'sale' ? 'Selling' : 'Buying'}</span>
                </label>;
              })}
            </div>
            <p className="shrink-0 text-xs text-slate-300">The selected sale will be paused, or the selected buy order will keep shopping automatically without using a stand slot.</p>
            {error && (
              <p role="alert" className="text-rose-200">
                {error}
              </p>
            )}
            <DialogFooter className="shrink-0 border-slate-700 bg-[#101019]">
              <Button
                disabled={saving}
                variant="outline"
                className="border-slate-500 bg-black text-white hover:bg-slate-800 hover:text-white"
                onClick={() => setPending(null)}
              >
                Cancel
              </Button>
              <Button
                disabled={!selected || saving}
                className="border border-violet-400 bg-violet-600 text-white hover:bg-violet-500"
                onClick={async () => {
                  if (!pending) return;
                  setSaving(true);
                  try {
                    await pending.action(selected);
                    setPending(null);
                  } catch (failure) {
                    setError(
                      failure instanceof Error
                        ? failure.message
                        : 'Could not replace listing',
                    );
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                Replace listing
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {!pending && error && (
        <p role="alert" className="text-sm text-rose-200">
          {error}
        </p>
      )}
    </>
  );
  return { save, dialog };
}
