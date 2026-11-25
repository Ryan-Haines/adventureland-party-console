// npc-orders' order list, its buy rule and its merchant jobs (README.md here). The list lives in
// the `orders` records setting; the jobs' counts live in the party store. Every function here is
// pure over the values it is handed, so index.ts, the dialog and the tests share one rule.
import type { MerchantJobAsk, MerchantJobView, MerchantStepAnswer, MerchantStepView, RonListed } from '../../hooks/addon-api.ts';

export const NAME = 'npc-orders';
export type Npc = 'ponty' | 'ron';
// One standing order, one row of the `orders` setting. `count` holds X for "Buy X" and 0 for
// "Buy all". `level` is unset for an item with no level. `stopped` marks an order the player
// paused: it buys nothing and stays listed, with its bought count, until resumed or removed.
export interface Order { id: string; npc: Npc; item: string; level?: number; count: number; maxPrice: number; stopped?: boolean }
// One lot as the order rule reads it, a Ponty listing or a lot on Ron's list. A Ponty lot's realm is
// "<region><identifier>"; Ron's list is the realm the merchant stands on.
export interface StockRow { key: string; rid: string; item: string; level: number | null; quantity: number; unitPrice: number; realm?: string }
export type Plan = { buy: StockRow; quantity: number } | { wait: string };

// The fields of the `orders` records setting; the add-on manager's table edits the same rows.
export const ORDER_FIELDS = {
  id: { label: 'Id', kind: 'text' },
  npc: { label: 'NPC', kind: 'choice', choices: ['ponty', 'ron'] },
  item: { label: 'Item', kind: 'text' },
  level: { label: 'Level', kind: 'number', min: 0 },
  count: { label: 'Copies (0 buys every copy)', kind: 'number', min: 0 },
  maxPrice: { label: 'Max unit price', kind: 'number', min: 1 },
  stopped: { label: 'Stopped', kind: 'boolean' },
} as const;

const whole = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value);
// readOrders keeps each row a buy can run from. A row the manager's table left without an id gets
// its item's identity as its id, so its count still has a key.
export function readOrders(value: unknown): Order[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row): Order[] => {
    const o = (row ?? {}) as Record<string, unknown>;
    if ((o.npc !== 'ponty' && o.npc !== 'ron') || typeof o.item !== 'string' || !o.item) return [];
    if (!whole(o.count) || o.count < 0 || !whole(o.maxPrice) || o.maxPrice < 1) return [];
    if (o.level !== undefined && !(whole(o.level) && o.level >= 0)) return [];
    const level = o.level as number | undefined;
    return [{ id: typeof o.id === 'string' && o.id ? o.id : `${o.npc}:${o.item}@${level ?? ''}`, npc: o.npc, item: o.item,
      ...level === undefined ? {} : { level }, count: o.count, maxPrice: o.maxPrice, ...o.stopped === true ? { stopped: true } : {} }];
  });
}

const sameItem = (order: Pick<Order, 'item' | 'level'>, item: string, level: number | null | undefined) =>
  order.item === item && (order.level ?? null) === (level ?? null);

// placeOrder replaces the item's order, so one item holds one order and a new "Buy X" or "Buy all"
// overrides the last one. The new id starts the order's count at zero.
export function placeOrder(orders: readonly Order[], ask: Omit<Order, 'id' | 'stopped'>, id: string): Order[] {
  const kept = orders.filter(order => !(order.npc === ask.npc && sameItem(order, ask.item, ask.level)));
  return [...kept, { ...ask, id }];
}
export const stopOrder = (orders: readonly Order[], id: string): Order[] =>
  orders.map(order => order.id === id ? { ...order, stopped: true } : order);
export const resumeOrder = (orders: readonly Order[], id: string): Order[] =>
  orders.map(order => order.id === id ? { id: order.id, npc: order.npc, item: order.item, ...order.level === undefined ? {} : { level: order.level }, count: order.count, maxPrice: order.maxPrice } : order);
export const removeOrder = (orders: readonly Order[], id: string): Order[] => orders.filter(order => order.id !== id);

// Ponty's lots from the `market.ponty` read. The feed's Ponty rows carry `unitPrice`; a row
// without it prices each copy at its `price`.
export function pontyStock(listings: unknown): StockRow[] {
  if (!Array.isArray(listings)) return [];
  return listings.flatMap((entry): StockRow[] => {
    const l = (entry ?? {}) as Record<string, unknown>, item = (l.item ?? {}) as Record<string, unknown>;
    const unitPrice = Number(l.unitPrice ?? l.price), quantity = Number(l.quantity ?? 1);
    if (typeof item.name !== 'string' || typeof l.rid !== 'string' || !(unitPrice > 0) || !(quantity > 0)) return [];
    return [{ key: String(l.key ?? l.rid), rid: l.rid, item: item.name, level: whole(item.level) ? item.level : null, quantity, unitPrice,
      realm: `${String(l.serverRegion ?? '')}${String(l.serverIdentifier ?? '')}` }];
  });
}
// Ron's lots from the `npc.lostAndFoundList` read, priced per copy.
export const ronStock = (list: readonly RonListed[]): StockRow[] =>
  list.map(lot => ({ key: lot.rid, rid: lot.rid, item: lot.name, level: lot.level, quantity: lot.quantity, unitPrice: lot.price / lot.quantity }));

// nextPurchase is the order's next buy from its NPC's `stock`: Ponty's lots on every realm, or Ron's
// last list. The game sells a lot whole, so a row qualifies only when its whole lot fits the copies
// the order still wants, its unit price is at or under the cap, and the gold above the reserve pays
// for the lot. The cheapest qualifying row wins. `bought` is how many copies the order has bought;
// `tried` holds the lots a job already went for. With `gold` unknown, the buy's own working gold
// bound holds the reserve.
export function nextPurchase(order: Order, stock: readonly StockRow[], gold: number | null, reserve: number,
  bought = 0, tried: readonly string[] = []): Plan {
  if (order.stopped) return { wait: 'Stopped' };
  const wanted = order.count === 0 ? Infinity : order.count - bought;
  if (wanted <= 0) return { wait: 'Done' };
  const here = stock.filter(row => sameItem(order, row.item, row.level) && !tried.includes(row.rid));
  if (!here.length) return { wait: order.npc === 'ron' ? "Not on Ron's last list" : 'None in stock' };
  const capped = here.filter(row => row.unitPrice <= order.maxPrice);
  if (!capped.length) return { wait: `Over your ${order.maxPrice.toLocaleString()}g cap` };
  const sized = capped.filter(row => row.quantity <= wanted);
  if (!sized.length) return { wait: `Every lot holds more than the ${wanted} still wanted` };
  const spendable = gold === null ? Infinity : Math.max(0, gold - reserve);
  const paid = sized.filter(row => row.quantity * row.unitPrice <= spendable).sort((a, b) => a.unitPrice - b.unitPrice);
  if (!paid.length) return { wait: `The gold reserve keeps ${reserve.toLocaleString()}g` };
  return { buy: paid[0]!, quantity: paid[0]!.quantity };
}

// The party store's keys. `bought` counts each Ponty order's copies by its id and `ronBought` each
// Ron order's, so the coordinator and the merchant each write their own key. `tried` holds the Ponty
// lots a job went for, `pending` the Ponty job in flight, `ronAsk` and `ronQueued` the player's last
// "Visit Ron" and the last Ron job queued, `ronPending` the Ron lot the merchant went for, and
// `ronStock` what Ron listed after the last donation.
export interface Pending { orderId: string; rid: string; quantity: number }
export interface RonStock { lots: RonListed[]; at: number }
export interface Store { get(key: string): unknown; set(key: string, value: unknown): void }
export const boughtOf = (store: Pick<Store, 'get'>): Record<string, number> =>
  ({ ...(store.get('bought') ?? {}) as Record<string, number>, ...(store.get('ronBought') ?? {}) as Record<string, number> });
export const triedOf = (store: Pick<Store, 'get'>): string[] => Array.isArray(store.get('tried')) ? store.get('tried') as string[] : [];
// The newest lots the add-on went for; a lot leaves the feed long before this many more.
const TRIED_KEPT = 200;
const addTried = (store: Store, rid: string) => store.set('tried', [...triedOf(store).filter(r => r !== rid), rid].slice(-TRIED_KEPT));

export const kindReason = (kind: Npc) => `addon:${NAME}:${kind}`;
const own = (reason: string) => reason.startsWith(`addon:${NAME}:`);

// Ponty's and Ron's places, from movement's `movement.npcPlace` read.
export interface Point { map: string; x: number; y: number }
export interface Places { ponty: Point | null; ron: Point | null }
// What the coordinator knows of the merchant for one pass.
export interface MerchantFacts { places: Places; gold: number | null; reserve: number; listings: unknown; ronDonate: boolean; ronDonation: number; now: number }

// planJob is the `merchant.job` answer: one Ponty buy on its lot's realm, else one Ron visit the
// player asked for, each with its walk and game actions as the job's first steps. The job owner
// keeps one of the add-on's jobs at a time, so with one in the view it waits. A Ponty job still
// `pending` with none in the view never reached the end notice, so its lot goes on the tried list
// and the next pass picks another.
export function planJob(view: MerchantJobView, orders: readonly Order[], facts: MerchantFacts, store: Store): MerchantJobAsk | undefined {
  if (!view.merchant) return undefined;
  if ([view.current, ...view.queued].some(job => job && own(job.reason))) return undefined;
  const pending = store.get('pending') as Pending | null | undefined;
  if (pending) { addTried(store, pending.rid); store.set('pending', null); }
  const stock = pontyStock(facts.listings), bought = boughtOf(store), tried = triedOf(store);
  const { ponty, ron } = facts.places;
  for (const order of ponty ? orders.filter(o => o.npc === 'ponty') : []) {
    const plan = nextPurchase(order, stock, facts.gold, facts.reserve, bought[order.id] ?? 0, tried);
    if (!('buy' in plan)) continue;
    store.set('pending', { orderId: order.id, rid: plan.buy.rid, quantity: plan.quantity } satisfies Pending);
    return { kind: 'ponty', target: view.merchant, realm: plan.buy.realm,
      fields: { orderId: order.id, rid: plan.buy.rid, item: order.item, quantity: plan.quantity, unitPrice: plan.buy.unitPrice },
      steps: [{ walk: { to: ponty! } },
        { action: 'market.pontyBuy', args: { rid: plan.buy.rid }, reason: `npc-orders: ${plan.quantity} ${order.item} from Ponty` }] };
  }
  const asked = Number(store.get('ronAsk') ?? 0), queued = Number(store.get('ronQueued') ?? 0);
  const wanted = orders.filter(order => order.npc === 'ron' && !order.stopped);
  if (ron && facts.ronDonate && asked > queued && wanted.length) {
    store.set('ronQueued', facts.now);
    return { kind: 'ron', target: view.merchant, fields: { orders: wanted },
      steps: [{ walk: { to: ron } },
        { action: 'gold.donate', args: { gold: facts.ronDonation }, reason: 'npc-orders: Ron shows his list after a donation' },
        { action: 'npc.lostAndFound', args: {}, reason: "npc-orders: read Ron's list" }] };
  }
  return undefined;
}

// jobEnded settles the Ponty job in flight on `merchant.job.ended`: a `done` ending counts its
// copies against the order, and a `done` or `failed` ending puts its lot on the tried list. Every
// other ending is a J4 row that queues the job again, so the job stays pending.
export function jobEnded(payload: Readonly<Record<string, unknown>>, store: Store): void {
  if (payload.kind !== kindReason('ponty') || (payload.code !== 'done' && payload.code !== 'failed')) return;
  const pending = store.get('pending') as Pending | null | undefined;
  if (!pending) return;
  if (payload.code === 'done') {
    const bought = (store.get('bought') ?? {}) as Record<string, number>;
    store.set('bought', { ...bought, [pending.orderId]: (bought[pending.orderId] ?? 0) + pending.quantity });
  }
  addTried(store, pending.rid);
  store.set('pending', null);
}

// stepAnswer is the `merchant.step` answer on the merchant, asked after the job's first steps ran.
// A Ponty job is done once its buy went out. A Ron job keeps Ron's list in the party store, counts
// the lot its last step bought, and asks for one lot at a time, the cheapest one an order wants,
// until no order wants a listed lot. `list` reads Ron's list (`npc.lostAndFoundList`), which drops
// each lot the merchant buys.
export function stepAnswer(view: MerchantStepView, store: Store, list: () => readonly RonListed[], now: number): MerchantStepAnswer {
  if (view.job.kind === 'ponty') return { end: 'done' };
  if (view.job.kind !== 'ron') return { end: 'failed', reason: `${view.job.kind} is not a kind npc-orders declares` };
  if (!view.done.length) return { end: 'failed', reason: 'a Ron job runs its first steps before it asks' };
  const last = view.done[view.done.length - 1]!, pending = store.get('ronPending') as Pending | null | undefined;
  if (pending && last.action === 'npc.lostAndFoundBuy') {
    if (last.outcome === 'sent') {
      const bought = (store.get('ronBought') ?? {}) as Record<string, number>;
      store.set('ronBought', { ...bought, [pending.orderId]: (bought[pending.orderId] ?? 0) + pending.quantity });
    }
    store.set('ronPending', null);
  }
  const lots = list(), stock = ronStock(lots), bought = boughtOf(store);
  store.set('ronStock', { lots: [...lots], at: now } satisfies RonStock);
  const next = readOrders(view.job.fields?.orders).flatMap(order => {
    const plan = nextPurchase(order, stock, null, 0, bought[order.id] ?? 0);
    return 'buy' in plan ? [{ order, plan }] : [];
  }).sort((a, b) => a.plan.buy.unitPrice - b.plan.buy.unitPrice)[0];
  if (!next) return { end: 'done' };
  store.set('ronPending', { orderId: next.order.id, rid: next.plan.buy.rid, quantity: next.plan.quantity } satisfies Pending);
  return { steps: [{ action: 'npc.lostAndFoundBuy', args: { rid: next.plan.buy.rid }, reason: `npc-orders: ${next.plan.quantity} ${next.order.item} from Ron` }] };
}
