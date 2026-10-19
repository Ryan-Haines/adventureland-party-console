'use client';
import { Button } from '@/components/ui/button';
import { usePartyAction } from './query-actions';
import type { PartyState } from './party-state';

type Purchases = NonNullable<NonNullable<PartyState['nativeStand']>['purchases']>;

/**
 * A purchase whose merchant job ended without confirming it blocks this WTB. The player
 * decides: bought counts it toward the order, not bought just releases it.
 */
export function WTBUnconfirmedPurchase({ itemId, name, purchases }: { itemId: string; name: string; purchases?: Purchases }) {
  const action = usePartyAction();
  const entry = Object.entries(purchases || {}).find(([, purchase]) => purchase.item.name === itemId);
  if (!entry) return null;
  const [id, purchase] = entry;
  const seller = id.split(':')[1];
  const resolve = (bought: boolean) => { action.reset(); void action.mutateAsync({ path: '/merchant/native-stand', body: { action: 'resolve-purchase', id, bought } }).catch(() => {}); };
  return (
    <fieldset aria-label={`Unconfirmed purchase of ${name}`} className="m-0 grid min-w-0 gap-2 rounded border border-amber-700 bg-black/40 p-2 text-xs text-amber-100">
      <p>
        Purchase outcome unconfirmed: {purchase.quantity.toLocaleString()} × {name} at {Number(purchase.item.price || 0).toLocaleString()}
        {seller ? ` from ${seller}` : ''}. The merchant job ended before reporting it, so this WTB is paused.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={action.isPending} onClick={() => resolve(true)}
          className="border-amber-500 bg-slate-950 text-amber-100 hover:bg-slate-800 hover:text-white">It was bought</Button>
        <Button size="sm" variant="outline" disabled={action.isPending} onClick={() => resolve(false)}
          className="border-slate-500 bg-slate-950 text-slate-100 hover:bg-slate-800 hover:text-white">It wasn&apos;t bought</Button>
      </div>
      {action.error && <p role="alert" className="text-rose-300">{action.error.message}</p>}
    </fieldset>
  );
}
