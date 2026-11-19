// Inventory, bank and commerce's game calls on the character:
// every bank, trade, stand, production, exchange, mail,
// donation, loot and send call of the module goes out from here, so each is registered in
// runtime/items/ (P-10 at 0); its equips and unequips go out through the call budget owner's hands door, which owns
// them. owner.ts hands them to the bank, the market and the production as their game ports, and to
// the merchant jobs owner's visits and the hunting owner's rare deploy through `partyItems.game`.
//
// Each call asks the call budget's `job` band, priced by the socket
// event the game sends, and waits a call window while it answers "not now"; Ponty's list read in the
// background asks the `background` band once and is skipped when refused. The wait is the items owner's `act`
// registration, so it holds with the character.
//
// The game settles a call's promise only when its reply arrives (adventureland
// common_functions.js `push_deferred` has no timeout), so a lost reply leaves the promise pending
// forever. itemCall ends a call with no reply past two measured round trips `not_confirmed`, the one
// copy of that rule; a commerce step that waited on such a promise held its job with no end but the merchant jobs owner's
// 90 s progress bound.
import { partyHooks } from '../../hooks/index.ts';
import { scope } from '../../lifecycle/api.ts';
import { itemFailure, MAIL_MESSAGE_MAX, MAIL_POSTAGE, MAIL_SUBJECT_MAX } from '../rules.ts';
import { boundFired } from '../../status/api.ts';
import { handsSend } from '../../merchant-hands/character/api.ts';
import type { MarketGame } from './market.ts';

// The game's functions are globals of the character realm, read untyped as shared.js called them.
type Untyped = (...args: any[]) => any;
declare const parent: { push_deferred(name: string): Promise<any>; open_chest(id: string): Promise<any>; socket: { emit(event: string, data?: unknown): void; once?(event: string, listener: (data: unknown) => void): unknown };
  deferreds?: Record<string, unknown[] | undefined>; entities?: Record<string, { id?: string; slots?: Record<string, { name?: string; price?: number; rid?: string } | null> } | undefined> };
declare const buy: Untyped, sell: Untyped, exchange: Untyped, split: Untyped, swap: Untyped,
  consume: Untyped, dismantle: Untyped, trade_buy: Untyped, trade_sell: Untyped, trade: Untyped, wishlist: Untyped,
  open_stand: Untyped, close_stand: Untyped, get_secondhands: Untyped, buy_secondhand: Untyped, buy_lost_and_found: Untyped, send_mail: Untyped,
  send_item: Untyped, donate_gold: Untyped, loot: Untyped,
  bank_retrieve: Untyped, bank_store: Untyped, bank_swap: Untyped, bank_deposit: Untyped, bank_withdraw: Untyped,
  activate: Untyped, open_bank_pack: Untyped, upgrade: Untyped, compound: Untyped, use_skill: Untyped,
  auto_craft: Untyped, send_gold: Untyped, equip_cx: Untyped;
// The game's client-side reads, which send nothing to the server, so addon:check's action table
// (rules/actions.mts) leaves them out of the game call universe.
type GameRead = (...args: any[]) => any;
declare const item_value: GameRead, can_stack: GameRead, is_on_cooldown: GameRead, can_use: GameRead, item_grade: GameRead;
declare const character: { gold: number; acx?: Record<string, unknown>; items: ({ name: string; q?: number; level?: number; stat_type?: string } | null)[] };
declare const G: { items: Record<string, { g?: number; grades?: readonly number[] } | undefined>; craft?: Record<string, { items?: readonly (readonly [number, string])[]; cost?: number } | undefined> };

// Each call's band method: the socket event the game function emits at pin 16881a27, which 09 prices
// and matches to its admission (call-budget.ts:555). `trade` and `consume` send `equip`, a bag swap
// `imove`, every bank call `bank`, activate `booster`, the stand `merchant` and a skill `skill`.
const METHOD = {
  buy: 'buy', sell: 'sell', exchange: 'exchange', exchangeBuy: 'exchange_buy', split: 'split', swap: 'imove',
  unequip: 'unequip', equip: 'equip', consume: 'equip', dismantle: 'dismantle', tradeBuy: 'trade_buy',
  tradeSell: 'trade_sell', trade: 'equip', wishlist: 'trade_wishlist', openStand: 'merchant', closeStand: 'merchant',
  getSecondhands: 'secondhands', buySecondhand: 'sbuy', buyLostAndFound: 'sbuy', sendMail: 'mail', sendItem: 'send', donateGold: 'donate',
  lostAndFoundInfo: 'lostandfound', takeMail: 'mail_take_item', loot: 'open_chest', bankRetrieve: 'bank',
  bankStore: 'bank', bankSwap: 'bank', bankDeposit: 'bank', bankWithdraw: 'bank',
  activate: 'booster', openBankPack: 'bank', upgrade: 'upgrade', compound: 'compound', useSkill: 'skill',
  craft: 'craft', sendGold: 'send', wearLook: 'cx', destroy: 'destroy', locksmith: 'locksmith', destat: 'destat',
  tradeSwap: 'trade_swap', tradeHistory: 'trade_history', lostAndFound: 'lostandfound',
} as const;
type Call = keyof typeof METHOD;
// Ron's stock as the game last sent it (`lostAndFound`), undefined before a donation's list arrives.
// A lot leaves it once the merchant buys it.
interface RonLot { rid: string; name: string; level?: number; q?: number }
let ronStock: readonly RonLot[] | undefined;
// The calls whose reply waits on more than one round trip: upgrade, compound and exchange answer
// after their queue time (`character.q`), which production's and the market's own waits read; the
// Ponty list, Ponty buy, Ron buy and mail send take their own reply bound; the mail take and Mass
// Production arm theirs; the lost-and-found request, the destroy, the locksmith, the scrollsmith and the
// trade swap emit with no deferred reply (functions.js:3424,:4013-4034,:4199). Every other call gets the two-round-trip bound.
const OWN_WAIT: ReadonlySet<Call> = new Set(['upgrade', 'compound', 'exchange', 'exchangeBuy', 'getSecondhands',
  'buySecondhand', 'buyLostAndFound', 'sendMail', 'takeMail', 'useSkill', 'lostAndFoundInfo', 'destroy', 'locksmith', 'destat', 'tradeSwap']);
// The OWN_WAIT calls that hand the game their reply bound, by the argument that carries it. The game
// rejects them `{ reason: "timeout" }` when it ends (runner_functions.js `wait_for_event`, `send_mail`).
const GAME_TIMEOUT: Partial<Record<Call, number>> = { getSecondhands: 0, buySecondhand: 1, buyLostAndFound: 1, sendMail: 4 };

/** bigcheck/bounds.md `itemReplyBound`: an item call whose reply the network lost tells the status owner's bound
 *  record. itemCall reports its own bound and the game's timeouts; production's queue wait and the
 *  mail take report theirs through their game ports. */
export function replyLost(call: Call, ms: number): void {
  boundFired({ bound: 'itemReplyBound', owner: '10', state: { call, method: METHOD[call], ms } });
}
const timedOut = (call: Call, ms: number) => (error: any) => {
  if (error?.reason === 'timeout') replyLost(call, ms);
  throw error;
};

/**
 * One game call of the module, sent once the `job` band answers. `takeMail`'s last argument arms the
 * reply's wait after the band and before the emit, and `useSkill`'s starts the reply's bound then,
 * so neither bound counts the band's wait.
 */
async function itemCall(name: Call, ...a: any[]): Promise<any> {
  return bandCall('job', name, ...a);
}
// The `job` band waits a call window while it answers "not now". The `background` band asks once,
// and a refusal throws `BUDGET_REFUSED` before anything is sent.
const BUDGET_REFUSED = 'call budget refused the background band';
async function bandCall(band: 'job' | 'background', name: Call, ...a: any[]): Promise<any> {
  const calls = partyHooks().calls, act = scope('10', 'act');
  // 09 owns equip and unequip: its hands door asks the band for them (the `hands` case below).
  const hands = name === 'equip' || name === 'unequip';
  if (!hands && band === 'background' && calls.band({ band, method: METHOD[name] }) !== 'send') throw Error(BUDGET_REFUSED);
  if (!hands && band === 'job') while (calls.band({ band: 'job', method: METHOD[name] }) !== 'send') await act.sleep(calls.window());
  let sent: any;
  if (hands) while (!(sent = name === 'equip' ? handsSend(band, 'equip', a[0], a[1]) : handsSend(band, 'unequip', a[0]))) {
    if (band === 'background') throw Error(BUDGET_REFUSED);
    await act.sleep(calls.window());
  }
  switch (name) {
    case 'buy': sent = buy(a[0], a[1]); break;
    case 'sell': sent = sell(a[0], a[1]); break;
    case 'exchange': sent = exchange(a[0]); break;
    case 'exchangeBuy': {
      sent = parent.push_deferred('exchange_buy');
      parent.socket.emit('exchange_buy', { num: a[0], name: a[1], q: a[2] });
      break;
    }
    case 'split': sent = split(a[0], a[1]); break;
    case 'swap': sent = swap(a[0], a[1]); break;
    case 'consume': sent = consume(a[0]); break;
    case 'dismantle': sent = dismantle(a[0]); break;
    case 'tradeBuy': sent = trade_buy(a[0], a[1], a[2]); break;
    case 'tradeSell': sent = trade_sell(a[0], a[1], a[2]); break;
    case 'trade': sent = trade(a[0], a[1], a[2], a[3]); break;
    case 'wishlist': sent = wishlist(a[0], a[1], a[2], a[3], a[4]); break;
    case 'openStand': sent = open_stand(); break;
    case 'closeStand': sent = close_stand(); break;
    case 'getSecondhands': sent = get_secondhands(a[0]); break;
    case 'buySecondhand': sent = buy_secondhand(a[0], a[1]); break;
    case 'buyLostAndFound': sent = buy_lost_and_found(a[0], a[1]).then((reply: unknown) => {
      ronStock = ronStock?.filter(lot => lot.rid !== a[0]);
      return reply;
    }); break;
    case 'sendMail': sent = send_mail(a[0], a[1], a[2], a[3], a[4]); break;
    case 'sendItem': sent = send_item(a[0], a[1], a[2]); break;
    case 'donateGold': sent = donate_gold(a[0]); break;
    case 'lostAndFoundInfo': parent.socket.emit('lostandfound', 'info'); break;
    case 'takeMail': {
      sent = a[2]();
      parent.socket.emit('mail_take_item', { id: a[0], request_id: a[1] });
      break;
    }
    // The game's loot(id) opens the chest through parent.parent, which for a character in a
    // commander's frame is the commander's game: the emit went out on the commander's socket while
    // this character's call budget held the admission.
    case 'loot': sent = parent.open_chest(a[0]); break;
    case 'bankRetrieve': sent = bank_retrieve(a[0], a[1], a[2]); break;
    case 'bankStore': sent = bank_store(a[0], a[1], a[2]); break;
    case 'bankSwap': sent = bank_swap(a[0], a[1], a[2]); break;
    case 'bankDeposit': sent = bank_deposit(a[0]); break;
    case 'bankWithdraw': sent = bank_withdraw(a[0]); break;
    case 'activate': sent = activate(a[0]); break;
    case 'openBankPack': sent = open_bank_pack(a[0], 'gold'); break;
    case 'upgrade': sent = upgrade(a[0], a[1], a[2], a[3]); break;
    case 'compound': sent = compound(a[0], a[1], a[2], a[3], a[4], a[5]); break;
    case 'useSkill': sent = Promise.race([Promise.resolve(use_skill(a[0])), a[1]()]); break;
    case 'craft': sent = auto_craft(a[0]); break;
    case 'sendGold': sent = send_gold(a[0], a[1]); break;
    case 'wearLook': sent = equip_cx(a[0], a[1]); break;
    case 'destroy': parent.socket.emit('destroy', { num: a[0], q: a[1], statue: false }); break;
    case 'locksmith': parent.socket.emit('locksmith', { num: a[0], operation: a[1] }); break;
    case 'destat': parent.socket.emit('destat', { num: a[0] }); break;
    case 'tradeSwap': parent.socket.emit('trade_swap', { slot: a[0], id: a[1], rid: a[2], num: a[3] }); break;
    case 'tradeHistory': {
      sent = new Promise(resolve => act.once(parent.socket, 'trade_history', resolve));
      parent.socket.emit('trade_history');
      break;
    }
    // After a donation the game answers Ron's stock on the `lostandfound` event (server.js
    // `lostandfound`); npc.stock reads the last list.
    case 'lostAndFound': {
      sent = new Promise(resolve => act.once(parent.socket, 'lostandfound', resolve)).then(list => {
        if (Array.isArray(list)) ronStock = list.filter(item => typeof item?.name === 'string' && typeof item?.rid === 'string');
        return list;
      });
      parent.socket.emit('lostandfound');
      break;
    }
  }
  if (OWN_WAIT.has(name)) {
    const timeout = GAME_TIMEOUT[name];
    return timeout === undefined ? sent : sent.catch(timedOut(name, a[timeout]));
  }
  // A reply lost on the network tells the status owner's bound record as it ends the call.
  let timer: ReturnType<typeof act.setTimeout> | undefined;
  const bound = 2 * calls.margin();
  const late = new Promise<never>((_resolve, reject) => {
    timer = act.setTimeout(() => {
      replyLost(name, bound);
      reject(itemFailure('not_confirmed', name + ' was not confirmed'));
    }, bound);
  });
  return Promise.race([sent, late]).finally(() => act.clearTimeout(timer));
}
/** Ponty's list read in the background: skipped, and false, when the `background` band refuses. */
function backgroundSecondhands(timeout: number, reply: (list: Promise<any>) => void): boolean {
  if (partyHooks().calls.band({ band: 'background', method: 'secondhands' }) !== 'send') return false;
  reply(get_secondhands(timeout).catch(timedOut('getSecondhands', timeout)));
  return true;
}

/** The market's calls (market.ts `MarketGame`). */
export const marketGame: MarketGame = {
  buy: (name, quantity) => itemCall('buy', name, quantity),
  sell: (slot, quantity) => itemCall('sell', slot, quantity),
  exchange: (slot) => itemCall('exchange', slot),
  exchangeBuy: (slot, reward, quantity) => itemCall('exchangeBuy', slot, reward, quantity),
  split: (slot, quantity) => itemCall('split', slot, quantity),
  swap: (from, to) => itemCall('swap', from, to),
  unequip: (slot) => itemCall('unequip', slot),
  equip: (slot, slotName) => itemCall('equip', slot, slotName),
  consume: (slot) => itemCall('consume', slot),
  dismantle: (slot) => itemCall('dismantle', slot),
  tradeBuy: (seller, slot, count) => itemCall('tradeBuy', seller, slot, count),
  tradeSell: (buyer, slot, count) => itemCall('tradeSell', buyer, slot, count),
  trade: (slot, tradeSlot, price, quantity) => itemCall('trade', slot, tradeSlot, price, quantity),
  wishlist: (slot, itemId, price, level, quantity) => itemCall('wishlist', slot, itemId, price, level, quantity),
  openStand: () => itemCall('openStand'),
  closeStand: () => itemCall('closeStand'),
  getSecondhands: (timeout) => itemCall('getSecondhands', timeout),
  backgroundSecondhands,
  buySecondhand: (rid, timeout) => itemCall('buySecondhand', rid, timeout),
  sendMail: (to, subject, message, item, timeout) => itemCall('sendMail', to, subject, message, item, timeout),
  sendItem: (to, slot, quantity) => itemCall('sendItem', to, slot, quantity),
  donateGold: (amount) => itemCall('donateGold', amount),
  lostAndFoundInfo: () => itemCall('lostAndFoundInfo'),
  takeMail: (id, requestId, arm) => itemCall('takeMail', id, requestId, arm),
  loot: (chest) => itemCall('loot', chest),
  itemValue: (item) => item_value(item),
  replyLost,
};

/** The bank's calls (bank.ts `BankPorts`): the bank packs, the bag's moves, gold and the NPC trades. */
export const bankGame = {
  bankRetrieve: (pack: string, slot: number, inv?: number): Promise<unknown> => itemCall('bankRetrieve', pack, slot, inv),
  bankStore: (inv: number, pack: string, slot?: number): Promise<unknown> => itemCall('bankStore', inv, pack, slot),
  swap: (from: number, to: number): Promise<unknown> => itemCall('swap', from, to),
  bankSwap: (pack: string, from: number, to: number): Promise<unknown> => itemCall('bankSwap', pack, from, to),
  split: (slot: number, quantity: number): Promise<unknown> => itemCall('split', slot, quantity),
  bankDeposit: (amount: number): Promise<unknown> => itemCall('bankDeposit', amount),
  bankWithdraw: (amount: number): Promise<unknown> => itemCall('bankWithdraw', amount),
  buy: (name: string, quantity: number): Promise<unknown> => itemCall('buy', name, quantity),
  unequip: (slot: string): Promise<unknown> => itemCall('unequip', slot),
  sell: (slot: number, quantity: number): Promise<unknown> => itemCall('sell', slot, quantity),
  consume: (slot: number): Promise<unknown> => itemCall('consume', slot),
  activate: (slot: number): Promise<unknown> => itemCall('activate', slot),
  openBankPack: (pack: string): Promise<any> => itemCall('openBankPack', pack),
  canStack: (target: unknown, source: unknown): boolean => can_stack(target, source),
};

/** The production's calls (production.ts `ProductionPorts`). Mass Production is the items owner's cast. */
export const productionGame = {
  upgrade: (item: number, scroll: number, offering?: number | null, calculate?: boolean): Promise<any> =>
    itemCall('upgrade', item, scroll, offering, calculate),
  compound: (a: number, b: number, c: number, scroll: number, offering?: number | null, calculate?: boolean): Promise<any> =>
    itemCall('compound', a, b, c, scroll, offering, calculate),
  useSkill: (name: string, bound: () => Promise<unknown>): Promise<unknown> => itemCall('useSkill', name, bound),
  skillReady: (name: string): boolean => !is_on_cooldown(name) && can_use(name),
  grade: (item: unknown): number => item_grade(item),
  craft: (name: string): Promise<unknown> => itemCall('craft', name),
  equip: (slot: number, slotName?: string): Promise<unknown> => itemCall('equip', slot, slotName),
  // The game's upgrade replies still pending (`push_deferred('upgrade')`), which b9b5c91e's preview
  // read before it started (shared.js:2555).
  upgradeSettling: (): boolean => !!parent.deferreds?.upgrade?.length,
  replyLost,
};

/** The gold a fighter hands the merchant on a visit (the merchant jobs owner's visits.ts, through `partyItems.game`). */
export const sendGold = (name: string, gold: number): Promise<unknown> => itemCall('sendGold', name, gold);

// The items owner's add-on action doors (rows/10-items.ts `ACTIONS`): one door per game
// function. Each keeps the game's bound, asks the band the dispatcher names and answers sent or
// refused; a game error rejects. items/api.ts reaches them through `__partyItemDoors`.
export type DoorBand = 'job' | 'background';
export type DoorAnswer = { outcome: 'sent'; reply?: unknown } | { outcome: 'refused'; by: string; reason: string };
// The coordinator's facts for one ask (items/coordinator/api.ts `itemAskFacts`), which the dispatcher
// hands the door beside the add-on's args, so an add-on cannot write them: the items owner's working gold, the bag
// cells another fate holds and Ponty's prices by listing id. A character-side ask carries none, so a
// door that spends gold or names a filled bag cell refuses it.
export interface ItemDoorFacts { floor?: number; held?: readonly number[]; ponty?: Readonly<Record<string, number>> }
type Args = Readonly<Record<string, unknown>>;
const refused = (reason: string): DoorAnswer => ({ outcome: 'refused', by: '10', reason });
const whole = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) > 0;
const cell = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0 && (n as number) < character.items.length;
const text = (s: unknown): s is string => typeof s === 'string' && s.length > 0;
// The locksmith's fee for a lock, a seal or an unlock.
const LOCKSMITH_FEE = 250_000; // server.js:6735-6800
// The scrollsmith's fee is the stat scroll's value times 10 times this count at the item's grade.
const DESTAT_COUNTS = [1, 10, 100, 1000, 9999, 9999, 9999]; // server.js:6710-6712

// One door: the call it makes with the args it reads, the bag cells the call takes a copy from and
// the gold it spends. `read` answers the call's arguments, or the refusal's reason.
interface Door {
  call: Call;
  read(a: Args, facts: ItemDoorFacts): readonly unknown[] | string;
  cells?(a: Args): readonly unknown[];
  spends?(a: Args, facts: ItemDoorFacts): number | string;
}
const nearby = (id: unknown) => typeof id === 'string' ? parent.entities?.[id] : undefined;
const listing = (a: Args) => typeof a.slot === 'string' ? nearby(a.seller ?? a.buyer)?.slots?.[a.slot] ?? undefined : undefined;
const quantity = (a: Args) => a.quantity === undefined ? 1 : a.quantity;
// The game picks the bag copies of these calls itself, so no held copy may carry a name it takes.
function heldName(facts: ItemDoorFacts, names: ReadonlySet<string>): string | undefined {
  if (!facts.held) return "10's fates are not known for this ask";
  return facts.held.some(at => names.has(character.items[at]?.name ?? '')) ? 'another fate holds a copy this call takes' : undefined;
}
function statFee(a: Args): number | string {
  const item = cell(a.slot) ? character.items[a.slot] : null;
  const scroll = item?.stat_type ? G.items[item.stat_type === 'mp_cost' ? 'mpcostscroll' : item.stat_type + 'scroll'] : undefined;
  const grades = item ? G.items[item.name]?.grades : undefined;
  if (!scroll || !grades) return 'destat needs a copy with a stat';
  return DESTAT_COUNTS[grades.filter(level => level <= 0).length]! * (scroll.g ?? 0) * 10;
}
// One lot on Ron's last list with the price the game charges for it: four times the item's value
// for each copy, as the game's own lost-and-found dialog prices it (html.js `args.lostandfound`).
export interface RonListed { rid: string; name: string; level: number | null; quantity: number; price: number }
function ronList(): RonListed[] {
  return (ronStock ?? []).map(lot => ({ rid: lot.rid, name: lot.name, level: Number.isInteger(lot.level) ? lot.level! : null,
    quantity: lot.q || 1, price: item_value(lot) * 4 * (lot.q || 1) }));
}
const DOORS = {
  // The game's cx check (server.js:5331): a look in `character.acx`; an empty name takes the slot's look off.
  wearLook: { call: 'wearLook', read: a => !text(a.slot) ? 'wearLook needs a slot'
    : a.name !== undefined && a.name !== '' && (typeof a.name !== 'string' || !character.acx?.[a.name]) ? `${String(a.name)} is not a look this character owns`
      : [a.slot, a.name || undefined] },
  donate: { call: 'donateGold', spends: a => a.gold as number, read: a => whole(a.gold) ? [a.gold] : 'donate needs a whole gold amount' },
  sendGold: { call: 'sendGold', spends: a => a.gold as number,
    read: a => !text(a.to) ? 'sendGold needs a recipient' : whole(a.gold) ? [a.to, a.gold] : 'sendGold needs a whole gold amount' },
  sendItem: { call: 'sendItem', cells: a => [a.slot], read: a => text(a.to) && whole(quantity(a)) ? [a.to, a.slot, quantity(a)] : 'sendItem needs a recipient and a quantity' },
  // `item` attaches the bag's first cell, as the game's send_mail does; the postage is the game's
  // (rules.ts MAIL_POSTAGE), and the game cuts the subject and the message (MAIL_SUBJECT_MAX).
  sendMail: { call: 'sendMail', cells: a => a.item === true ? [0] : [], spends: a => a.item === true ? MAIL_POSTAGE.item : MAIL_POSTAGE.letter,
    read: a => !text(a.to) || !text(a.subject) ? 'mail.send needs a recipient and a subject'
      : [a.to, a.subject.slice(0, MAIL_SUBJECT_MAX), typeof a.message === 'string' ? a.message.slice(0, MAIL_MESSAGE_MAX) : '', a.item === true, 2 * partyHooks().calls.margin()] },
  takeMail: { call: 'takeMail', read: a => text(a.id) ? [a.id, `addon-${a.id}`, () => Promise.resolve()] : 'mail.take needs a mail id' },
  buy: { call: 'buy', spends: a => (G.items[String(a.name)]?.g ?? 0) * (quantity(a) as number),
    read: a => G.items[String(a.name)] && whole(quantity(a)) ? [a.name, quantity(a)] : 'buy needs an item the game knows and a quantity' },
  sell: { call: 'sell', cells: a => [a.slot], read: a => whole(quantity(a)) ? [a.slot, quantity(a)] : 'sell needs a quantity' },
  exchange: { call: 'exchange', cells: a => [a.slot], read: a => [a.slot] },
  exchangeBuy: { call: 'exchangeBuy', cells: a => [a.slot], read: a => text(a.name) && whole(quantity(a)) ? [a.slot, a.name, quantity(a)] : 'exchangeBuy needs a reward name' },
  split: { call: 'split', cells: a => [a.slot], read: a => whole(a.quantity) ? [a.slot, a.quantity] : 'split needs a quantity' },
  move: { call: 'swap', cells: a => [a.from, a.to], read: a => [a.from, a.to] },
  equip: { call: 'equip', cells: a => [a.slot], read: a => [a.slot, typeof a.slotName === 'string' ? a.slotName : undefined] },
  unequip: { call: 'unequip', read: a => text(a.slot) ? [a.slot] : 'unequip needs a worn slot' },
  consume: { call: 'consume', cells: a => [a.slot], read: a => [a.slot] },
  dismantle: { call: 'dismantle', cells: a => [a.slot], read: a => [a.slot] },
  destroy: { call: 'destroy', cells: a => [a.slot], read: a => whole(quantity(a)) ? [a.slot, quantity(a)] : 'destroy needs a quantity' },
  boost: { call: 'activate', cells: a => [a.slot], read: a => [a.slot] },
  upgrade: { call: 'upgrade', cells: a => a.offering === undefined ? [a.slot, a.scroll] : [a.slot, a.scroll, a.offering],
    read: a => [a.slot, a.scroll, a.offering ?? null] },
  compound: { call: 'compound', cells: a => [...(Array.isArray(a.slots) ? a.slots : [undefined]), a.scroll, ...(a.offering === undefined ? [] : [a.offering])],
    read: a => Array.isArray(a.slots) && a.slots.length === 3 ? [...a.slots, a.scroll, a.offering ?? null] : 'compound needs three slots' },
  craft: { call: 'craft', spends: a => G.craft?.[String(a.name)]?.cost ?? 0,
    read: (a, facts) => {
      const recipe = G.craft?.[String(a.name)];
      if (!recipe) return 'craft needs a recipe the game knows';
      return heldName(facts, new Set((recipe.items ?? []).map(([, name]) => name))) ?? [a.name];
    } },
  locksmith: { call: 'locksmith', cells: a => [a.slot], spends: () => LOCKSMITH_FEE,
    read: a => a.operation === 'lock' || a.operation === 'seal' || a.operation === 'unlock' ? [a.slot, a.operation] : 'locksmith needs lock, seal or unlock' },
  destat: { call: 'destat', cells: a => [a.slot], spends: statFee, read: a => [a.slot] },
  list: { call: 'trade', cells: a => [a.slot], read: a => text(a.tradeSlot) && whole(a.price) && whole(quantity(a)) ? [a.slot, a.tradeSlot, a.price, quantity(a)] : 'list needs a trade slot and a price' },
  wishlist: { call: 'wishlist', spends: a => (a.price as number) * (quantity(a) as number),
    read: a => text(a.tradeSlot) && text(a.name) && whole(a.price) && whole(quantity(a)) ? [a.tradeSlot, a.name, a.price, Number(a.level) || 0, quantity(a)] : 'wishlist needs a trade slot, an item, a price and a quantity' },
  tradeBuy: { call: 'tradeBuy', spends: a => (listing(a)?.price ?? 0) * (quantity(a) as number),
    read: a => listing(a) && whole(quantity(a)) ? [nearby(a.seller), a.slot, quantity(a)] : "tradeBuy needs a nearby seller's listed slot" },
  tradeSell: { call: 'tradeSell',
    read: (a, facts) => {
      const wanted = listing(a)?.name;
      if (!wanted || !whole(quantity(a))) return "tradeSell needs a nearby buyer's listed slot";
      return heldName(facts, new Set([wanted])) ?? [nearby(a.buyer), a.slot, quantity(a)];
    } },
  tradeSwap: { call: 'tradeSwap', cells: a => [a.num],
    read: a => listing(a)?.rid ? [a.slot, nearby(a.buyer)?.id ?? a.buyer, listing(a)!.rid, a.num] : "tradeSwap needs a nearby buyer's listed slot" },
  tradeHistory: { call: 'tradeHistory', read: () => [] },
  buySecondhand: { call: 'buySecondhand', read: a => [a.rid, 2 * partyHooks().calls.margin()],
    spends: (a, facts) => typeof a.rid === 'string' && facts.ponty?.[a.rid] !== undefined ? facts.ponty[a.rid]! : 'Ponty has no listing with that id' },
  lostAndFoundInfo: { call: 'lostAndFoundInfo', read: () => [] },
  lostAndFound: { call: 'lostAndFound', read: () => [] },
  // Ron's buy spends the price his last list shows for the lot, so a rid off that list buys nothing.
  buyLostAndFound: { call: 'buyLostAndFound', read: a => [a.rid, 2 * partyHooks().calls.margin()],
    spends: a => ronList().find(lot => lot.rid === a.rid)?.price ?? "Ron's last list has no lot with that id" },
  openChest: { call: 'loot', read: a => text(a.chest) ? [a.chest] : 'openChest needs a chest id' },
  bankRetrieve: { call: 'bankRetrieve', read: a => text(a.pack) && Number.isSafeInteger(a.slot) ? [a.pack, a.slot, a.to] : 'bankRetrieve needs a pack and its slot' },
  bankStore: { call: 'bankStore', cells: a => [a.slot], read: a => text(a.pack) ? [a.slot, a.pack, a.to] : 'bankStore needs a pack' },
  bankSwap: { call: 'bankSwap', read: a => text(a.pack) && Number.isSafeInteger(a.from) && Number.isSafeInteger(a.to) ? [a.pack, a.from, a.to] : 'bankSwap needs a pack and two slots' },
  bankDeposit: { call: 'bankDeposit', spends: a => a.gold as number, read: a => whole(a.gold) ? [a.gold] : 'bankDeposit needs a whole gold amount' },
  bankWithdraw: { call: 'bankWithdraw', read: a => whole(a.gold) ? [a.gold] : 'bankWithdraw needs a whole gold amount' },
} as const satisfies Record<string, Door>;
export type ItemDoor = keyof typeof DOORS;

// The door's bounds in order: its args, the bag copies it names (a filled cell needs the fates, and a
// cell another fate holds refuses), then the gold it spends against the items owner's working gold.
function door(name: ItemDoor, a: Args, band: DoorBand, facts: ItemDoorFacts): DoorAnswer | Promise<DoorAnswer> {
  const row: Door = DOORS[name], call = row.read(a, facts);
  if (typeof call === 'string') return refused(call);
  const cells = row.cells?.(a) ?? [];
  if (cells.some(at => !cell(at))) return refused(`${name} needs bag slots`);
  if (cells.some(at => character.items[at as number]) && !facts.held) return refused("10's fates are not known for this ask");
  if (cells.some(at => facts.held?.includes(at as number))) return refused('another fate holds that copy');
  const spent = row.spends?.(a, facts) ?? 0;
  if (typeof spent === 'string') return refused(spent);
  if (spent > 0) {
    const { floor } = facts;
    if (!Number.isSafeInteger(floor) || (floor as number) < 0) return refused("10's working gold is not known for this ask");
    if (character.gold - spent < (floor as number)) return refused(`${name} would leave less than the working gold ${String(floor)}`);
  }
  return sent(band, row.call, ...call);
}
async function sent(band: DoorBand, name: Call, ...a: any[]): Promise<DoorAnswer> {
  try { return { outcome: 'sent', reply: await bandCall(band, name, ...a) }; } catch (error) {
    if (error instanceof Error && error.message === BUDGET_REFUSED) return refused(BUDGET_REFUSED);
    throw error;
  }
}
export const itemDoors = {
  door: (name: ItemDoor, a: Args, band: DoorBand, facts: ItemDoorFacts = {}): Promise<DoorAnswer> => Promise.resolve(door(name, a, band, facts)),
  lostAndFound: (): readonly RonListed[] => ronList(),
};
Object.assign(globalThis, { __partyItemDoors: itemDoors });
