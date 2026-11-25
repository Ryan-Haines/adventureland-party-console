/** @jsxImportSource ../../../dashboard/features/party/addon-jsx */
'use client';
// npc-orders' "Ponty / Ron" button after Bank and the add-on dialog it opens: one tab per NPC with
// that NPC's stock, and the order list. The order list saves through the add-on manager's route
// (POST /party-api/addons), the one write a records setting takes, and the piece's `reload` then
// hands every reader the new list. "Visit Ron" goes through `send`, and "Retry skipped lots"
// clears the party store's tried list through `save`.
import {
  Button, Checkbox, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Input, performAction, useMemo, useQueryClient, useState,
  type AddonDashboard, type AddonDialogProps, type AddonPieceProps,
} from '../../../dashboard/features/party/addon-kit';
import { NAME, boughtOf, nextPurchase, placeOrder, pontyStock, readOrders, removeOrder, resumeOrder, ronStock, stopOrder, triedOf,
  type Npc, type Order, type RonStock, type StockRow } from './orders';

const DIALOG = 'orders';
const TABS: readonly { npc: Npc; label: string }[] = [{ npc: 'ponty', label: 'Ponty' }, { npc: 'ron', label: 'Ron' }];
// What the top bar hands the dialog when it opens it: the merchant and its realm, gold and reserve.
interface Subject { merchant: string | null; realm: string; gold: number | null; reserve: number }

const itemLabel = (item: string, level: number | null | undefined) => level === null || level === undefined ? item : `${item} +${level}`;
const gold = (value: number) => `${value.toLocaleString()}g`;

function OrderRow({ order, bought, plan, busy, onStop, onResume, onRemove }: { order: Order; bought: number; plan: ReturnType<typeof nextPurchase>; busy: boolean;
  onStop(): void; onResume(): void; onRemove(): void }) {
  const what = order.count === 0 ? 'Buy all' : `Buy ${order.count}`;
  const next = 'buy' in plan ? `Next: ${plan.quantity} at ${gold(plan.buy.unitPrice)} each${plan.buy.realm ? ` on ${plan.buy.realm}` : ''}` : plan.wait;
  return <li className="flex flex-wrap items-center gap-2 rounded border border-slate-700 px-2 py-1" data-order={order.id}>
    <span className="font-semibold">{itemLabel(order.item, order.level)}</span>
    <span className="text-slate-300">{what}, up to {gold(order.maxPrice)} each, {bought} bought</span>
    <span className="text-slate-400">{next}</span>
    {order.stopped
      ? <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onResume}>Resume</Button>
      : <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onStop}>Stop</Button>}
    <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onRemove} aria-label={`Remove ${itemLabel(order.item, order.level)}`}>Remove</Button>
  </li>;
}

// One row per item to order: Ponty's lots on every realm, or Ron's last list.
interface OfferRow { key: string; item: string; level: number | null; quantity: number; unitPrice: number; realm?: string }
function OfferList({ npc, rows, orders, busy, place }: { npc: Npc; rows: OfferRow[]; orders: Order[]; busy: boolean;
  place(ask: Omit<Order, 'id' | 'stopped'>): void }) {
  const [counts, setCounts] = useState<Record<string, string>>({}), [caps, setCaps] = useState<Record<string, string>>({});
  if (!rows.length) return <p className="text-slate-300">{npc === 'ponty' ? 'No Ponty stock seen.' : 'No Ron list yet. Visit Ron to read it.'}</p>;
  return <table className="w-full text-left text-sm">
    <thead><tr className="text-slate-400"><th>Item</th><th>Realm</th><th>Qty</th><th>Unit price</th><th>Buy X</th><th>Max each</th><th /></tr></thead>
    <tbody>{rows.map(row => {
      const held = orders.find(order => order.item === row.item && (order.level ?? null) === row.level);
      const capText = caps[row.key] ?? String(held?.maxPrice ?? Math.ceil(row.unitPrice)), cap = Number(capText), count = Number(counts[row.key] ?? 1);
      const validCap = Number.isInteger(cap) && cap > 0, validCount = Number.isInteger(count) && count > 0;
      const ask = (n: number) => place({ npc, item: row.item, ...row.level === null ? {} : { level: row.level }, count: n, maxPrice: cap });
      return <tr key={row.key} data-stock={row.key}>
        <td>{itemLabel(row.item, row.level)}</td><td>{row.realm ?? ''}</td><td>{row.quantity}</td><td>{gold(row.unitPrice)}</td>
        <td><Input type="number" min={1} className="h-7 w-16" aria-label={`Copies of ${row.item}`} value={counts[row.key] ?? '1'}
          onChange={event => setCounts({ ...counts, [row.key]: event.target.value })} /></td>
        <td><Input type="number" min={1} className="h-7 w-24" aria-label={`Max unit price for ${row.item}`} value={capText}
          onChange={event => setCaps({ ...caps, [row.key]: event.target.value })} /></td>
        <td className="space-x-1 whitespace-nowrap">
          <Button type="button" size="sm" disabled={busy || !validCap || !validCount} onClick={() => ask(count)}>Buy {validCount ? count : 'X'}</Button>
          <Button type="button" size="sm" variant="outline" disabled={busy || !validCap} onClick={() => ask(0)}>Buy all</Button>
        </td>
      </tr>;
    })}</tbody>
  </table>;
}

function OrdersDialog({ subject, close, settings, stores, send, save, reload, read }: AddonDialogProps) {
  const client = useQueryClient(), [tab, setTab] = useState<Npc>('ponty'), [busy, setBusy] = useState(false), [note, setNote] = useState('');
  const { merchant, realm, gold: merchantGold, reserve } = (subject ?? { merchant: null, realm: '', gold: null, reserve: 0 }) as Subject;
  const orders = readOrders(settings.orders), consent = settings.ronDonate === true;
  const party = { get: (key: string) => stores.party[key] }, bought = boughtOf(party), tried = triedOf(party);
  const ron = stores.party.ronStock as RonStock | undefined;
  const listings = read('market.ponty');
  const stock: Record<Npc, StockRow[]> = useMemo(() => ({ ponty: pontyStock(listings), ron: ronStock(ron?.lots ?? []) }), [listings, ron]);
  const offers: Record<Npc, OfferRow[]> = {
    ponty: stock.ponty.map(row => ({ key: row.key, item: row.item, level: row.level, quantity: row.quantity, unitPrice: row.unitPrice, realm: row.realm })),
    ron: stock.ron.map(row => ({ key: row.key, item: row.item, level: row.level, quantity: row.quantity, unitPrice: row.unitPrice })),
  };

  async function run(work: () => Promise<unknown>, done?: string) {
    setBusy(true); setNote('');
    try { await work(); if (done) setNote(done); } catch (e) { setNote((e as Error).message); } finally { setBusy(false); }
  }
  // A settings write, then the piece's reload so every reader gets the saved value.
  const write = (values: Record<string, unknown>) => run(async () => { await performAction(client, '/addons', { name: NAME, settings: values }); reload(); });
  const id = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const shown = orders.filter(order => order.npc === tab);

  return <Dialog open onOpenChange={open => { if (!open) close(); }}>
    <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden border-emerald-700 bg-[#081713] text-emerald-50 sm:max-w-3xl" data-area="npc-orders">
      <DialogHeader>
        <DialogTitle>Ponty / Ron</DialogTitle>
        <DialogDescription>Standing buy orders for {merchant ?? 'the merchant'}, now on {realm || 'an unknown realm'}:
          {merchantGold === null ? ' gold unknown' : ` ${gold(merchantGold)} carried`}, reserve {gold(reserve)}.</DialogDescription>
      </DialogHeader>
      <div role="tablist" className="flex gap-2">
        {TABS.map(t => <Button key={t.npc} type="button" size="sm" role="tab" aria-selected={tab === t.npc} variant={tab === t.npc ? 'default' : 'outline'}
          onClick={() => setTab(t.npc)}>{t.label}</Button>)}
      </div>
      <div className="space-y-3 overflow-y-auto" role="tabpanel">
        {tab === 'ron' ? <>
          <label className="flex items-center gap-2">
            <Checkbox checked={consent} disabled={busy} aria-label="Donate to Ron to see his list" onCheckedChange={value => void write({ ronDonate: value === true })} />
            Donate {gold(Number(settings.ronDonation) || 0)} to Ron on each visit to see his list
          </label>
          {consent ? <p className="text-slate-300">The merchant visits only while its "Ron orders" routine is switched on.</p>
            : <p className="text-amber-200">Ron shows his list only after a donation. Tick the box to let the merchant donate.</p>}
          <Button type="button" size="sm" disabled={busy || !consent} onClick={() => void run(() => send({ visitRon: true }), 'The merchant visits Ron on its next free pass.')}>Visit Ron</Button>
          {ron ? <p className="text-slate-400">Ron's list read {new Date(ron.at).toLocaleString()}.</p> : null}
        </> : tried.length
          ? <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void run(() => save('party', { tried: [] }))}>Retry {tried.length} skipped lots</Button>
          : null}
        <OfferList npc={tab} rows={offers[tab]} orders={shown} busy={busy} place={ask => void write({ orders: placeOrder(orders, ask, id()) })} />
        <h3 className="font-semibold">Orders</h3>
        {shown.length ? <ul className="space-y-1">{shown.map(order => <OrderRow key={order.id} order={order} busy={busy} bought={bought[order.id] ?? 0}
          plan={nextPurchase(order, stock[order.npc], merchantGold, reserve, bought[order.id] ?? 0, order.npc === 'ponty' ? tried : [])}
          onStop={() => void write({ orders: stopOrder(orders, order.id) })} onResume={() => void write({ orders: resumeOrder(orders, order.id) })} onRemove={() => void write({ orders: removeOrder(orders, order.id) })} />)}</ul>
          : <p className="text-slate-400">No orders.</p>}
        {note ? <p role="status" className="text-slate-300">{note}</p> : null}
      </div>
    </DialogContent>
  </Dialog>;
}

function NpcOrdersButton({ state, open }: AddonPieceProps<'top-bar'>) {
  const merchant = state.merchantCharacter ?? null, realm = state.realmControl?.merchantRealm ?? state.realmControl?.activeRealm ?? '';
  const carried = merchant ? Number(state.characterSnapshots?.[merchant]?.gold) : NaN;
  const subject: Subject = { merchant, realm, gold: Number.isFinite(carried) ? carried : null, reserve: Number(state.goldReserve ?? 0) };
  return <Button variant="outline" className="border-emerald-700 bg-transparent text-emerald-300" onClick={() => open(DIALOG, subject)}>Ponty / Ron</Button>;
}

export const dashboard: AddonDashboard = { pieces: { 'top-bar': { actions: NpcOrdersButton } }, dialogs: { [DIALOG]: OrdersDialog } };
