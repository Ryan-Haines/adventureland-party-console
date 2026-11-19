// The character's market (3.1 `character/market.ts`): the exchange, Ponty, ALData's mail, buys and
// sells, the stand search and buy, the native stand and its holder, the NPC purchase and sale,
// deconstruction, the donation, mail, the restock, the dashboard's use, equip and give and the loot
// pass with its timer. shared.js builds it once at load over `MarketPorts`.
import { ALDATA_AUTH_MAIL, ALDATA_RATE_WINDOW_MS, DISMANTLE_FREE_SLOTS, LOOT_RADIUS, MAIL_POSTAGE, PONTY_RANGE, SEND_MEET_MS, donationXpPerGold, freeSlots, itemFailure, pontyPrice as lotPrice } from '../rules.ts';
import { sameItem, type ItemCopy } from '../identity.ts';
import { SEND_REACH } from '../../protocol/reports.ts';
import { settles, type BagAnswers, type BagPorts } from './bag.ts';
import type { BankAnswers } from './bank.ts';
import type { createBag } from './owner.ts';
import { gameRealm } from '../../protocol/realm.ts';
import { boundFired } from '../../status/api.ts';

/* eslint-disable @typescript-eslint/no-explicit-any -- the game's character and G are read as the client gives them */
type Command = any;
type Activity = { level: string; message: string; details?: unknown }[];
type Spot = { map: string; x: number; y: number };

// The game's calls the market makes. Each goes out through `call` (`job` band).
export interface MarketGame {
  buy(name: string, quantity: number): Promise<unknown>;
  sell(slot: number, quantity: number): Promise<unknown>;
  exchange(slot: number): Promise<any>;
  // The token exchange of one named stack: the game's `exchange_buy` takes the first stack it finds,
  // which may be locked or too small, so the market names the verified one.
  exchangeBuy(slot: number, reward: string, quantity: number): Promise<any>;
  split(slot: number, quantity: number): Promise<unknown>;
  swap(from: number, to: number): Promise<unknown>;
  unequip(slot: number | string): Promise<unknown>;
  equip(slot: number, slotName?: string): Promise<unknown>;
  consume(slot: number): Promise<unknown>;
  dismantle(slot: number): Promise<any>;
  tradeBuy(seller: any, slot: string, quantity: number): Promise<unknown>;
  tradeSell(buyer: any, slot: string, quantity: number): Promise<unknown>;
  trade(slot: number, tradeSlot: string, price: number, quantity: number): Promise<unknown>;
  wishlist(slot: string, itemId: string, price: number, level: number, quantity: number): Promise<unknown>;
  openStand(): Promise<unknown>;
  closeStand(): Promise<unknown>;
  getSecondhands(timeout: number): Promise<any>;
  // Ponty's list read in the background: false, and no read, when the background band refuses.
  backgroundSecondhands(timeout: number, reply: (list: Promise<any>) => void): boolean;
  buySecondhand(rid: string, timeout: number): Promise<unknown>;
  sendMail(to: string, subject: string, message: string, item: boolean, timeout: number): Promise<any>;
  sendItem(to: string, slot: number, quantity: number): Promise<unknown>;
  donateGold(amount: number): Promise<unknown>;
  // Ron's info, whose `lostandfound_info` reply sets the donation rate.
  lostAndFoundInfo(): Promise<void>;
  // The attachment take, answered on `game_response` by its request id: `arm` starts the reply's
  // wait once the call may go, and the take answers its promise.
  takeMail(id: string, requestId: string, arm: () => Promise<void>): Promise<void>;
  // calls.ts `replyLost`: the mail take's reply bound reports itemReplyBound.
  replyLost(call: 'takeMail', ms: number): void;
  loot(chest: string): Promise<any>;
  // `item_value` (the dismantle cost).
  itemValue(item: unknown): number;
}
export interface MarketPorts extends Pick<BagPorts, 'character' | 'G' | 'bankPacks' | 'getPlayer' | 'margin' | 'sleep' | 'now'> {
  reads: BagAnswers;
  bank: BankAnswers;
  // The items owner's bag holder, whose tidy and lucky swap hold the stand
  // sync.
  bag: Pick<ReturnType<typeof createBag>, 'facts' | 'pontyWanted'>;
  // The game's calls; each asks the call budget's band before it goes (calls.ts).
  game: MarketGame;
  // The game's socket, for the replies the client's wrappers do not hand back, and its entities and
  // chests.
  on(event: string, listener: (data: any) => void): void;
  off(event: string, listener: (data: any) => void): void;
  // The items owner's run scope handle, `act`: the loot timer and the reply bounds wait while
  // table P holds the character and end with the generation.
  scope: { setTimeout(callback: () => void, ms: number): number; clearTimeout(id: number | undefined): void; setInterval(callback: () => void, ms: number): number; clearInterval(id: number | undefined): void };
  entities(): Record<string, any>;
  chests(): Record<string, any>;
  request(path: string, options?: any): Promise<any>;
  log(message: string, color?: string): void;
  // Movement's errand journey, its follow step and its stop (02).
  walk(destination: unknown): Promise<unknown>;
  follow(x: number, y: number): void;
  stopWalk(kind?: string): Promise<unknown>;
  findNpc(name: string): any;
  // The player's protected free slots from the coordinator's last reply.
  protectedSlots(): number;
  marketSpot(): Spot;
  realm(): { region: string; identifier: string };
  // The events owner's A/B mode, the loot tick's gate; the hunting owner's Cave loot while a
  // Cave owns the character.
  abtesting(): string | undefined;
  cave(): { loot(): Promise<boolean> } | null;
  // Production's reads (character/production.ts).
  production: {
    luckySlot(): number | null;
    massBuff(skill: string): Promise<unknown>;
    verifyMarks(): Promise<unknown>;
    verifyProtection(slots: number[]): Promise<unknown>;
    checkpoint(command: Command): Promise<any>;
    entries(checkpoint: any): { pack?: string; slot: number; item: ItemCopy }[];
  };
  // The merchant job owner's and the call budget owner's reads: the hop, the runner's job and stand, the job's
  // continuation, the cleanout request; the hands' equipment and manual hands; porcupine's manual
  // hold.
  merchant: {
    liveRealm(): string;
    jobHop(command: Command, realm: string): Promise<string>;
    realmOf(region: unknown, identifier: unknown): string;
    job(): { jobId?: string } | null;
    leaveStand(): Promise<unknown>;
    // Whether the runner holds the merchant, and whether its stand return runs.
    holder(): unknown;
    standReturning(): boolean;
    continues(command: Command): void;
    cleanout(): Promise<unknown>;
    isEquipment(item: unknown): boolean;
    hands(): unknown;
    manualHands(previous: unknown): void;
    porcupineManual(): Promise<unknown>;
  };
}

// Catalog side: the rewards of one exchange table (from runtime/characters/exchange-rewards.ts). The game's
// exchange tables are weighted draws, and an `open` row rolls another table at once.
export function exchangeRewards(data: { items: Record<string, { name?: string }>; drops: Record<string, unknown> }, tableName: string) {
  const results = new Map<string, { kind: string; id: string; name: string; quantity: number; chance: number }>();
  function walk(name: string, probability: number, seen: Set<string>) {
    const table = data.drops[name];
    if (seen.has(name) || !Array.isArray(table)) return;
    const next = new Set(seen).add(name);
    const total = table.reduce((sum: number, row: unknown[]) => sum + Math.max(0, Number(row[0]) || 0), 0);
    if (!total) return;
    for (const row of table) {
      const chance = (probability * Math.max(0, Number(row[0]) || 0)) / total;
      if (!chance) continue;
      const kind = String(row[1]);
      if (kind === 'open') { walk(String(row[2]), chance, next); continue; }
      const cosmetic = kind === 'cx' || kind === 'cxbundle';
      const id = cosmetic ? String(row[2]) : kind;
      const quantity = cosmetic ? 1 : Math.max(1, Number(row[2]) || 1);
      const label = kind === 'empty' ? 'No reward' : kind === 'gold' ? 'Gold' : kind === 'shells' ? 'Shells'
        : cosmetic ? `Cosmetic: ${id}` : data.items[id]?.name || id;
      const key = JSON.stringify([kind, id, quantity, row[3], row[4]]);
      const existing = results.get(key);
      if (existing) existing.chance += chance;
      else results.set(key, { kind, id, name: label, quantity, chance });
    }
  }
  walk(tableName, 1, new Set());
  return [...results.values()].sort((a, b) => b.chance - a.chance || a.name.localeCompare(b.name));
}

const message = (error: any) => String(error?.reason || error?.message || error);
const quantityOf = (item: any) => Math.max(1, Number(item?.q) || 1);
const level = (value: unknown) => Number(value) || 0;
const spotKey = (spot: Spot) => JSON.stringify([spot.map, Math.round(Number(spot.x)), Math.round(Number(spot.y))]);
// Game timing: the next packet of a stand opening or a mail's attachment move
// waits 250 ms for the server's answer to the last, as the hands' 250 ms does.
const PACKET_GAP_MS = 250;
// Ron's info answers before the donation's packet goes; 350 ms is that answer's game timing.
const RON_INFO_MS = 350;
// The refusals a loot pass reads. `loot_failed` (another owner's chest, woffice, a mount,
// invisibility; G node/server.js:11320-11339) and a full bag are lasting: the chest is tried again
// once what refused it changes. The rest pass to the next tick.
const LOOT_REASONS = ['cooldown', 'openning', 'loot_no_space', 'loot_failed', 'safety', 'chest_not_found'];
const LASTING_LOOT = ['loot_failed', 'loot_no_space'];
// The role runner's loot tick, unchanged.
const LOOT_TICK_MS = 250;
// The window's fields the market keeps. The previous release kept the stand journal and the
// purchase receipts there (shared.js:9320-9322), so the socket's receipt counters survive a
// routine reload; the status owner's report and the hunting owner's loot read partyLootStatus.
interface MarketWindow {
  __nativeStandJournal?: { offers: Record<string, any>; receipts: Record<string, number> };
  __nativePurchaseReceipts?: Record<string, any>;
  partyLootStatus?: Record<string, any>;
}

export function createMarket(p: MarketPorts) {
  const me = () => p.character();
  const G = () => p.G();
  const reads = p.reads;
  // Two measured round trips, the reply bound of the calls that take their own (calls.ts
  // `itemCall` bounds every other call the same way).
  const replyMs = () => 2 * p.margin();
  const complete = (command: Command, body: Record<string, unknown>) =>
    p.request('/merchant/complete', { method: 'POST', body: { jobId: command.jobId, ...body } });
  const delivered = (command: Command) => ({ merchantWithdrawalsDelivered: command._merchantWithdrawalsCompleted || [],
    merchantBanked: command._merchantBankedCompleted || [] });
  // A failed job reports its failure once. A report the coordinator refuses is logged; the
  // merchant job owner's runner posts the job's end again on the rethrow
  // (merchant-jobs/character/runner.ts:210).
  async function failed(command: Command, error: any, body: Record<string, unknown>): Promise<never> {
    try { await complete(command, { success: false, error: message(error), code: error?.code, ...body }); }
    catch (report) { p.log('Merchant job failure report failed: ' + message(report), 'red'); }
    throw error;
  }
  const bankGold = () => Number(me().bank?.gold) || 0;
  // A job short of gold visits the bank and takes the shortfall; a bank short of it ends the job
  // `short_gold`.
  async function fund(command: Command, activity: Activity, cost: number, words: string): Promise<void> {
    if (me().gold >= cost) return;
    await p.bank.merchantVisitBank(command, activity);
    const shortage = cost - me().gold;
    if (bankGold() < shortage) throw itemFailure('short_gold', words);
    await p.bank.withdrawMerchantCash(shortage, command);
  }
  const walk = (destination: unknown) => p.walk(destination);

  // An NPC purchase counts once the bag holds it. The game's reply comes first; past it, the bag
  // shows the purchase within two measured round trips. The game sells equipment one copy
  // per request, so a non-stackable quantity buys one at a time.
  async function buyConfirmed(name: string, amount: number): Promise<void> {
    amount = Math.max(1, Number(amount) || 1);
    if (!G().items[name]?.s && amount > 1) {
      for (let unit = 0; unit < amount; unit += 1) await buyConfirmed(name, 1);
      return;
    }
    const before = reads.inventoryQuantity(name), arrived = () => reads.inventoryQuantity(name) >= before + amount;
    let settled = false, failure: unknown = null;
    p.game.buy(name, amount).then(() => { settled = true; }, error => { settled = true; failure = error; });
    while (!settled && !arrived()) await p.sleep(p.margin());
    if (arrived()) return;
    if (failure) throw failure;
    if (await settles(p, arrived)) return;
    throw Error('Purchase did not arrive: ' + amount + ' × ' + name);
  }
  // A purchase leaves the player's protected free slots and the lucky slot's hold after the
  // cells its copies need past the carried stacks they top up.
  function purchasePreservesLogisticsReserve(item: ItemCopy | null | undefined, quantity: number): boolean {
    let remaining = Math.max(1, Number(quantity) || 1);
    const stackLimit = Number(item?.name && G().items[item.name]?.s) || 1;
    if (stackLimit > 1) for (const owned of me().items as (ItemCopy | null)[]) {
      if (!owned || !sameItem(owned, item) || remaining <= 0) continue;
      remaining -= Math.max(0, stackLimit - (Number(owned.q) || 1));
    }
    const requiredSlots = remaining > 0 ? Math.ceil(remaining / stackLimit) : 0;
    return freeSlots(me().items, p.production.luckySlot(), p.protectedSlots()) >= requiredSlots;
  }
  const reserved = () => itemFailure('inventory_full', 'purchase deferred: the protected free slots are reserved');

  // A split's new stack, confirmed by the bag within two measured round trips.
  async function splitExact(slot: number, quantity: number, words: string): Promise<number> {
    const item = me().items[slot];
    if (reads.itemQuantity(item) <= quantity) return slot;
    const before = me().items.map((entry: any) => JSON.stringify(reads.fingerprint(entry)));
    const found = () => me().items.findIndex((entry: any, index: number) => index !== slot &&
      before[index] !== JSON.stringify(reads.fingerprint(entry)) && sameItem(entry, item) && reads.itemQuantity(entry) === quantity);
    await p.game.split(slot, quantity);
    if (found() < 0 && !await settles(p, () => found() >= 0)) throw itemFailure('not_confirmed', words);
    return found();
  }

  // The exchange. `findExchangeBankItem` names an exact level's bank copy.
  function findExchangeBankItem(name: string, wanted: number): { pack: string; slot: number } | null {
    for (const pack of Object.keys(me().bank || {})) {
      const entries = me().bank[pack];
      if (!Array.isArray(entries)) continue;
      const slot = entries.findIndex((item: any) => item && item.name === name && level(item.level) === level(wanted));
      if (slot >= 0) return { pack, slot };
    }
    return null;
  }
  // The server clears the exchange placeholder before add_item, so a stackable reward merges into a
  // carried stack and exchange() reports no slot (#28). Rewards are the cells that are new or grew.
  function exchangeGains(held: unknown[]): ItemCopy[] {
    return me().items.map((item: any, slot: number) => {
      const before = held[slot] as any;
      return item && !item.l && item.name !== 'placeholder' &&
        (!reads.sameItemState(item, before) || reads.itemQuantity(item) > reads.itemQuantity(before)) ? reads.fingerprint(item) : null;
    }).filter(Boolean);
  }
  async function merchantExchange(command: Command): Promise<void> {
    const activity: Activity = [], lines: { id: string; level: number; quantity: number; reward?: string }[] = [];
    const rewards: ItemCopy[] = (command.exchangeRewards || []).slice();
    for (const line of command.exchanges || []) {
      const existing = lines.find(entry => entry.id === line.id && entry.reward === line.reward && entry.level === level(line.level));
      const quantity = quantityOf({ q: line.quantity });
      if (existing) existing.quantity += quantity;
      else lines.push({ id: line.id, level: level(line.level), quantity, ...(line.reward ? { reward: line.reward } : {}) });
    }
    const exchangeNpc = (itemId: string) => {
      const quest = G().items[itemId]?.quest;
      return (quest && Object.keys(G().npcs || {}).find(npc => G().npcs[npc]?.quest === quest)) || 'exchange';
    };
    const carried = (itemId: string, wanted: number) => me().items.reduce((sum: number, item: any) =>
      sum + (item && item.name === itemId && level(item.level) === wanted ? reads.itemQuantity(item) : 0), 0);
    const cost = (line: typeof lines[number]) => {
      if (!line.reward) return Math.max(1, Number(G().items[line.id]?.e) || 1);
      const price = Number(G().tokens?.[line.id]?.[line.reward]);
      if (!(price > 0)) throw Error('Token reward is no longer available: ' + line.reward);
      return price;
    };
    const supplies = (pending: typeof lines) => {
      const result: { id: string; level: number; quantity: number }[] = [];
      for (const line of pending) {
        let entry = result.find(item => item.id === line.id && item.level === line.level);
        if (!entry) result.push(entry = { id: line.id, level: line.level, quantity: 0 });
        entry.quantity += cost(line) * line.quantity;
      }
      return result;
    };
    try {
      if (!lines.length && !command.exchangeResume) throw Error('Exchange order is empty');
      await p.bank.merchantVisitBank(command, activity);
      for (const supply of supplies(lines)) {
        // Each withdrawal is one confirmed call while the bank holds the exact level.
        while (carried(supply.id, supply.level) < supply.quantity) {
          const found = findExchangeBankItem(supply.id, supply.level);
          if (!found) break;
          await p.bank.bankRetrieveConfirmed(found.pack, found.slot);
        }
        const missing = supply.quantity - carried(supply.id, supply.level);
        if (missing > 0) {
          const answer = await p.request('/merchant/exchange-supply', { method: 'POST', body: {
            jobId: command.jobId, shortages: [{ id: supply.id, level: supply.level, quantity: missing }] } });
          if (answer?.pending) throw itemFailure('bankboi_pending');
          throw Error('Not enough ' + (G().items[supply.id]?.name || supply.id) + ' to exchange');
        }
      }
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const line = lines[lineIndex], definition = G().items[line.id] || {}, required = cost(line);
        // Every remaining line is checked again before another NPC walk.
        for (const pending of supplies(lines.slice(lineIndex)))
          if (carried(pending.id, pending.level) < pending.quantity) throw Error('Exchange inventory changed before travel: ' + pending.id);
        await walk(p.findNpc(line.reward ? definition.npc || line.id + 's' : exchangeNpc(line.id)));
        for (let count = 0; count < line.quantity; count += 1) {
          // Each exchange step starts with the bag merge.
          await p.bank.mergeBag();
          let slot = me().items.findIndex((item: any) => item && item.name === line.id && level(item.level) === line.level &&
            !item.l && reads.itemQuantity(item) >= required);
          if (slot < 0) throw Error('Exchange stack changed for ' + line.id);
          const held = me().items.map(reads.fingerprint);
          let result: any;
          if (line.reward) result = await p.game.exchangeBuy(slot, line.reward!, me().items[slot].q);
          else {
            slot = await splitExact(slot, required, 'Could not split exchange quantity for ' + line.id);
            await p.production.massBuff('massexchange');
            await p.production.verifyMarks();
            result = await p.game.exchange(slot);
          }
          for (const gain of exchangeGains(held)) if (!rewards.some(reward => sameItem(gain, reward))) rewards.push(gain);
          const remaining = lines.slice(lineIndex).map((pending, index) => ({ id: pending.id, level: pending.level,
            ...(pending.reward ? { reward: pending.reward } : {}), quantity: pending.quantity - (index === 0 ? count + 1 : 0) }))
            .filter(pending => pending.quantity > 0);
          await p.request('/merchant/exchange-progress', { method: 'POST', body: { jobId: command.jobId, remaining, rewards } });
          activity.push({ level: 'success', message: 'Exchanged ' + required + ' × ' + (definition.name || line.id) +
            (line.reward ? ' for ' + line.reward : result?.reward ? ' and received ' + result.reward : '') });
        }
      }
      await p.bank.merchantVisitBank(command, activity);
      // The shared rules are read again after the exchange and bank walk; a reward with a
      // processing or sale rule stays carried for the merchant's queue.
      const routing = await p.request('/merchant/exchange-progress', { method: 'POST', body: { jobId: command.jobId, remaining: [], rewards } });
      const rewardActions = routing.rewardActions || [];
      let banked = 0;
      for (let index = 0; index < rewards.length; index += 1) {
        const slot = reads.findItem(rewards[index]);
        if (slot < 0 || rewardActions[index]?.action !== 'bank') continue;
        await p.production.verifyMarks();
        await p.bank.bankStoreFully(slot);
        banked += 1;
      }
      activity.push({ level: 'success', message: 'Exchange rewards routed through merchant rules', details: { banked, actions: rewardActions } });
      await complete(command, { success: true, autoExchangesResolved: command.autoExchangeKeys || [], ...delivered(command), activity });
    } catch (error: any) {
      const waiting = error?.code === 'bankboi_pending';
      await failed(command, error, { ...delivered(command), activity: activity.concat([{ level: waiting ? 'info' : 'error',
        message: waiting ? 'Exchange waiting for BankBoi materials' : 'Exchange failed', details: message(error) }]) });
    }
  }

  // The stand listings in sight, cheapest first. A listing names its seller's spot.
  function standListings(itemId?: string) {
    const listings: any[] = [];
    for (const seller of Object.values<any>(p.entities() || {})) {
      if (!seller || seller.type !== 'character' || seller.name === me().name || !seller.stand) continue;
      for (const [slot, item] of Object.entries<any>(seller.slots || {})) {
        if (!slot.startsWith('trade') || !item || item.b || item.giveaway || (itemId && item.name !== itemId) ||
          !Number.isFinite(Number(item.price)) || Number(item.price) < 1) continue;
        listings.push({ seller: seller.name, slot, rid: item.rid, item: reads.fingerprint(item),
          ...(itemId ? {} : { meta: reads.itemDefinition(item) }), price: Number(item.price), quantity: Number(item.q) || 1,
          map: seller.map, x: Math.round(seller.x), y: Math.round(seller.y) });
      }
    }
    return listings.sort((a, b) => a.price - b.price || a.seller.localeCompare(b.seller));
  }
  // The status report's nearby listings, read while the merchant stands on the market's map.
  function nearbyStandListings() {
    return me().ctype === 'merchant' && me().map === p.marketSpot().map ? standListings() : [];
  }
  async function merchantStandSearch(command: Command): Promise<void> {
    try {
      await walk(p.marketSpot());
      // The stands near the market show within two measured round trips of the arrival.
      await p.sleep(replyMs());
      const listings = standListings(command.itemId);
      await complete(command, { success: true, standSearchResults: { itemId: command.itemId, listings },
        activity: [{ level: 'info', message: 'Found ' + listings.length + ' stand listing' + (listings.length === 1 ? '' : 's') + ' for ' + command.itemId }] });
    } catch (error) {
      await failed(command, error, { standSearchResults: { itemId: command.itemId, listings: [], error: message(error) },
        activity: [{ level: 'error', message: 'Stand search failed', details: message(error) }] });
    }
  }
  async function merchantStandBuy(command: Command): Promise<void> {
    const activity: Activity = [], purchases = command.listings || [];
    try {
      const requiredGold = purchases.reduce((sum: number, listing: any) => sum + Number(listing.price) * Number(listing.buyQuantity), 0);
      await fund(command, activity, requiredGold, 'Insufficient bank gold for stand purchases');
      for (const listing of purchases) {
        await walk({ map: listing.map, x: listing.x, y: listing.y });
        const seller = p.getPlayer(listing.seller) as any, live = seller?.slots?.[listing.slot];
        if (!seller || !live || live.rid !== listing.rid || live.name !== listing.item.name || Number(live.price) !== Number(listing.price))
          throw Error('Listing changed or disappeared: ' + listing.seller + ' / ' + listing.item.name);
        let amount = Math.min(Number(listing.buyQuantity) || 1, Number(live.q) || 1);
        if (!purchasePreservesLogisticsReserve(live, amount)) throw reserved();
        amount = await guardedMarketPurchase(command, listing, live, Number(live.price), amount,
          count => p.game.tradeBuy(seller, listing.slot, count));
        if (!amount) continue;
        activity.push({ level: 'success', message: 'Bought ' + amount + ' × ' + listing.item.name + ' from ' + listing.seller +
          ' for ' + (amount * listing.price).toLocaleString() + ' gold' });
      }
      await complete(command, { success: true, activity });
    } catch (error) {
      await failed(command, error, { activity: activity.concat([{ level: 'error', message: 'Stand purchase failed', details: message(error) }]) });
    }
  }

  // Ponty. The merchant reads Ponty in the background only within its range and while the background
  // band sends; a refused or distant read keeps the last listings.
  const ponty = { listings: [] as any[], updatedAt: 0, readAt: -Infinity, error: null as string | null, busy: false };
  // rules.ts prices a lot as the server does, with the game's scroll prices. A lot of an item the
  // game data does not price is left out, as the coordinator's Ponty lots leave it out.
  const pontyPrice = (item: any) => lotPrice(item, { definition: G().items[item.name] }, Object.fromEntries(
    ['scroll0', 'scroll1', 'scroll2', 'cscroll0', 'cscroll1', 'cscroll2'].map(name => [name, Number(G().items[name].g)])));
  const secondhands = (response: any): any[] => Array.isArray(response) ? response : Array.isArray(response?.items) ? response.items :
    Array.isArray(response?.secondhands) ? response.secondhands : [];
  function nearPonty(): boolean {
    const npc = p.findNpc('secondhands');
    return !!npc && npc.map === me().map && Math.hypot(Number(npc.x) - me().x, Number(npc.y) - me().y) <= PONTY_RANGE;
  }
  async function refreshPontyListings(): Promise<void> {
    if (me().ctype !== 'merchant' || ponty.busy || !nearPonty()) return;
    let reply: Promise<any> = Promise.resolve([]);
    if (!p.game.backgroundSecondhands(replyMs(), list => { reply = list; })) return;
    ponty.busy = true;
    ponty.readAt = p.now();
    try {
      const realm = p.realm();
      ponty.listings = secondhands(await reply).filter(item => item?.name && item.rid).flatMap(item => {
        const quantity = quantityOf(item), unitPrice = pontyPrice(item);
        if (!unitPrice) return [];
        return { key: String(item.rid), rid: String(item.rid), item: { ...item }, serverRegion: realm.region,
          serverIdentifier: realm.identifier, quantity, unitPrice, price: unitPrice * quantity };
      });
      ponty.updatedAt = p.now();
      ponty.error = null;
    } catch (error) {
      ponty.error = message(error);
    } finally {
      ponty.busy = false;
    }
  }
  const exactProperties = (item: any) => {
    const clean: any = { ...item, level: level(item.level) };
    for (const key of ['rid', 'q', 'price']) delete clean[key];
    return JSON.stringify(Object.keys(clean).sort().filter(key => clean[key] != null).map(key => [key, clean[key]]));
  };
  async function merchantPontyBuy(command: Command): Promise<void> {
    const activity: Activity = [], done = new Set(command.completedListingKeys || []);
    try {
      await closeStand();
      for (const requested of command.listings || []) {
        if (done.has(requested.key)) continue;
        const realm = requested.serverRegion && requested.serverIdentifier
          ? gameRealm(requested.serverRegion, requested.serverIdentifier) : p.merchant.liveRealm();
        if (realm !== p.merchant.liveRealm() && await p.merchant.jobHop(command, realm) === 'yielded') return;
        let failure: string | null = null;
        await fund(command, activity, Number(requested.price), 'Insufficient bank gold for Ponty purchase: need ' +
          (Number(requested.price) - me().gold).toLocaleString() + 'g, bank reports ' + bankGold().toLocaleString() + 'g');
        try {
          await walk(p.findNpc('secondhands'));
          const live = secondhands(await p.game.getSecondhands(replyMs()))
            .find(item => item && String(item.rid) === String(requested.rid));
          if (!live) throw Error('Ponty listing is no longer available: ' + requested.item.name);
          if (exactProperties(live) !== exactProperties(requested.item) || quantityOf(live) !== requested.quantity)
            throw Error('Ponty listing properties or quantity changed');
          const quantity = quantityOf(live), unitPrice = pontyPrice(live) ?? Infinity, totalPrice = unitPrice * quantity;
          if (unitPrice > Number(requested.unitPrice) || totalPrice > Number(requested.price)) throw Error("Ponty's price changed for " + requested.item.name);
          if (me().gold < totalPrice) {
            await fund(command, activity, totalPrice, "Insufficient bank gold for Ponty's " + requested.item.name);
            await walk(p.findNpc('secondhands'));
          }
          if (!purchasePreservesLogisticsReserve(live, quantity)) throw reserved();
          const bought = await guardedMarketPurchase(command, requested, live, unitPrice, quantity,
            () => p.game.buySecondhand(String(live.rid), replyMs()), true);
          if (!bought) throw Error('WTB no longer needs this Ponty stack');
          activity.push({ level: 'success', message: 'Bought ' + quantity + ' × ' + live.name + ' from Ponty for ' + totalPrice.toLocaleString() + ' gold' });
        } catch (error: any) {
          failure = message(error);
          if (error.code === 'short_gold' || /not_in_bank/.test(failure)) throw error;
        }
        await p.request('/merchant/ponty-progress', { method: 'POST', body: { jobId: command.jobId, listingKey: requested.key, success: !failure, error: failure } });
        done.add(requested.key);
      }
      // The realm owner's stay takes the merchant home after the job.
      await refreshPontyListings();
      await complete(command, { success: true, activity });
    } catch (error) {
      await refreshPontyListings();
      await failed(command, error, { activity: activity.concat([{ level: 'error', message: 'Ponty purchase failed', details: message(error) }]) });
    }
  }

  // A mail needs its postage on hand; a merchant short of it takes it from the bank.
  const postage = (command: Command, activity: Activity, item: boolean, words: string) =>
    fund(command, activity, item ? MAIL_POSTAGE.item : MAIL_POSTAGE.letter, words);
  async function mailed(to: string, subject: string, body: string, item: boolean): Promise<void> {
    const result = await p.game.sendMail(to, subject, body, item, replyMs());
    if (result?.failed) throw Error(result.reason || 'Mail failed');
  }

  // ALData's authentication mail, a letter (its postage is `MAIL_POSTAGE.letter`).
  async function merchantALDataAuth(command: Command): Promise<void> {
    const activity: Activity = [];
    try {
      if (!command.aldataKey) throw Error('ALData authentication key is missing');
      await postage(command, activity, false, 'Insufficient bank gold to send ALData authentication mail');
      await mailed(ALDATA_AUTH_MAIL.recipient, ALDATA_AUTH_MAIL.subject, command.aldataKey, false);
      activity.push({ level: 'success', message: 'Sent ALData authentication mail; confirmation may take about a minute' });
      await complete(command, { success: true, activity, ...delivered(command) });
    } catch (error) {
      await failed(command, error, { activity: [{ level: 'error', message: 'Could not send ALData authentication mail', details: message(error) }] });
    }
  }

  // A player met at an advertised spot. The look goes on while each location refresh moves the
  // player's known spot (a progress rule); between looks the stand shows within two measured round
  // trips. It answers the player and the match, with whether the player and an open stand were seen.
  // `follow` is the buy's: an ALData sale only looks, as the previous release's sale polled its buyer
  // (shared.js:8994-9007).
  async function meet(command: Command, name: string, spot: Spot, body: Record<string, unknown>, matchOf: (player: any) => any, follow: boolean) {
    let known = spotKey(spot), seen = false, open = false;
    const look = () => {
      const player = p.getPlayer(name) as any;
      if (!player) return null;
      seen = true;
      if (Object.keys(player.slots || {}).some(slot => /^trade/.test(slot) && player.slots[slot])) open = true;
      return { player, match: matchOf(player) };
    };
    for (;;) {
      let found = look();
      // The merchant follows a seller it cannot buy from, outside the game's trade reach
      // (`trade_buy` refuses past `B.dist`, node/server.js:8964; protocol SEND_REACH).
      if (follow && found && !found.match && Math.hypot(me().x - Number(found.player.x), me().y - Number(found.player.y)) > SEND_REACH)
        p.follow(Number(found.player.x), Number(found.player.y));
      if (!found?.match && await settles(p, () => !!look()?.match)) found = look();
      if (found?.match) return { player: found.player, match: found.match, seen, open };
      const refreshed = await p.request('/merchant/refresh-location', { method: 'POST', body: { jobId: command.jobId, ...body } });
      const next: Spot | undefined = refreshed?.location;
      if (!next || spotKey(next) === known) return { player: found?.player ?? null, match: null, seen, open };
      known = spotKey(next);
      await walk(next);
    }
  }

  // ALData's marketplace buys.
  async function merchantALDataBuy(command: Command): Promise<void> {
    const activity: Activity = [], listings = command.listings || [], done = new Set(command.completedListingKeys || []);
    const report = (text: string, details: unknown) => p.request('/merchant/activity', { method: 'POST', body: {
      character: me().name, jobId: command.jobId, message: text, level: 'info', details } })
      .catch(error => p.log('ALData activity report failed: ' + message(error), 'red'));
    const matches = (item: any, listing: any) => item && item.name === listing.item.name && level(item.level) === level(listing.item.level) &&
      (listing.item.p || null) === (item.p || null) && !item.b && Number(item.price) <= Number(listing.price);
    const liveListing = (seller: any, listing: any) => {
      if (!seller?.slots) return null;
      if (matches(seller.slots[listing.slot], listing)) return { slot: listing.slot, item: seller.slots[listing.slot] };
      const slot = Object.keys(seller.slots).find(key => /^trade/.test(key) && matches(seller.slots[key], listing));
      return slot ? { slot, item: seller.slots[slot] } : null;
    };
    const cost = (listing: any) => (Number(listing.price) || 0) * quantityOf({ q: listing.buyQuantity });
    try {
      await closeStand();
      if (p.merchant.liveRealm() === command.aldataHomeRealm)
        await fund(command, activity, listings.filter((entry: any) => !done.has(entry.key)).reduce((sum: number, entry: any) => sum + cost(entry), 0),
          'Insufficient bank gold for ALData marketplace purchases');
      for (let index = 0; index < listings.length; index += 1) {
        const listing = listings[index];
        if (done.has(listing.key)) continue;
        if (me().gold < cost(listing)) {
          if (p.merchant.liveRealm() !== command.aldataHomeRealm && await p.merchant.jobHop(command, command.aldataHomeRealm) === 'yielded') return;
          await fund(command, activity, cost(listing), 'Insufficient bank gold for marketplace listing from ' + listing.seller);
        }
        const realm = p.merchant.realmOf(listing.serverRegion, listing.serverIdentifier);
        if (p.merchant.liveRealm() !== realm && await p.merchant.jobHop(command, realm) === 'yielded') return;
        let purchased = 0, failure: string | null = null, failureCode: string | null = null;
        try {
          const spot = { map: listing.map, x: Number(listing.x), y: Number(listing.y) };
          await walk(spot);
          await report('Reached ' + listing.seller + "'s advertised location; looking for an open stand",
            { map: me().map, x: me().x, y: me().y, item: listing.item.name });
          const met = await meet(command, listing.seller, spot, { listingKey: listing.key }, seller => liveListing(seller, listing), true);
          if (!met.match) {
            failureCode = !met.seen ? 'seller_not_visible' : !met.open ? 'stand_not_open' : 'listing_not_available';
            throw Error(!met.seen ? 'reached the advertised location, but ' + listing.seller + ' was not visible at any refreshed location'
              : !met.open ? 'found ' + listing.seller + ', but their stand did not reopen'
              : 'found ' + listing.seller + ' with an open stand, but the requested item was no longer listed at or below the advertised price');
          }
          await p.stopWalk().catch(error => p.log('Walk stop failed: ' + message(error), 'red'));
          purchased = Math.min(quantityOf({ q: listing.buyQuantity }), quantityOf(met.match.item));
          if (!purchasePreservesLogisticsReserve(met.match.item, purchased)) { failureCode = 'inventory_reserve'; throw reserved(); }
          purchased = await guardedMarketPurchase(command, listing, met.match.item, Number(met.match.item.price), purchased,
            count => p.game.tradeBuy(met.player, met.match.slot, count));
        } catch (error: any) {
          failure = message(error);
          failureCode = failureCode || error.failureCode || null;
        }
        const progress = await p.request('/merchant/aldata-progress', { method: 'POST', body: {
          jobId: command.jobId, listingKey: listing.key, success: !failure, quantity: purchased, error: failure, failureCode } });
        for (const additional of progress.additionalListings || [])
          if (!listings.some((entry: any) => entry.key === additional.key)) listings.push(additional);
        const cancel = progress.cancelSeller;
        if (cancel) for (const entry of listings)
          if (entry.seller === cancel.seller && entry.serverRegion === cancel.serverRegion && entry.serverIdentifier === cancel.serverIdentifier) done.add(entry.key);
        done.add(listing.key);
      }
      // The realm owner's stay takes the merchant home after the job.
      activity.push({ level: 'success', message: 'ALData marketplace itinerary completed' });
      await complete(command, { success: true, activity });
    } catch (error) {
      await failed(command, error, { activity: activity.concat([{ level: 'error', message: 'ALData marketplace purchase failed', details: message(error) }]) });
    }
  }

  // A sale into an ALData buy order.
  async function merchantALDataSell(command: Command): Promise<void> {
    const activity: Activity = [], order = command.buyOrder || {}, wanted = quantityOf({ q: command.sellQuantity });
    const matches = (item: any) => item && order.item && item.name === order.item.name && level(item.level) === level(order.item.level) &&
      (item.p || null) === (order.item.p || null);
    const owned = () => me().items.reduce((sum: number, item: any) => sum + (matches(item) ? quantityOf(item) : 0), 0);
    const buySlot = (buyer: any) => {
      if (!buyer?.slots) return null;
      const slots = [order.slot, ...Object.keys(buyer.slots).filter(slot => /^trade/.test(slot) && slot !== order.slot)];
      const slot = slots.find(key => { const live = buyer.slots[key]; return matches(live) && live.b && Number(live.price) >= Number(order.price); });
      return slot ? { slot, item: buyer.slots[slot] } : null;
    };
    try {
      if (!order.item || !order.buyer) throw Error('ALData buy order is incomplete');
      await closeStand();
      if (owned() < wanted) {
        await p.bank.merchantVisitBank(command, activity);
        // One confirmed withdrawal per stack while each moved the count and the bank holds more.
        for (let found = p.bank.findBankItem(order.item); found && owned() < wanted; found = p.bank.findBankItem(order.item))
          await p.bank.bankRetrieveConfirmed(found.pack, found.slot);
      }
      const have = owned();
      if (!have) throw Error('No matching ' + order.item.name + ' is available in merchant inventory or bank');
      const realm = p.merchant.realmOf(order.serverRegion, order.serverIdentifier);
      if (p.merchant.liveRealm() !== realm && await p.merchant.jobHop(command, realm) === 'yielded') return;
      const spot = { map: order.map, x: Number(order.x), y: Number(order.y) };
      await walk(spot);
      const met = await meet(command, order.buyer, spot, {}, buySlot, false);
      if (!met.match) throw Error('Buyer or matching live WTB was not available at any refreshed location');
      await p.stopWalk().catch(error => p.log('Walk stop failed: ' + message(error), 'red'));
      const amount = Math.min(wanted, have, quantityOf(met.match.item));
      await p.game.tradeSell(met.player, met.match.slot, amount);
      activity.push({ level: 'success', message: 'Sold ' + amount + ' × ' + order.item.name + ' to ' + order.buyer + ' for ' +
        (amount * Number(met.match.item.price)).toLocaleString() + ' gold' });
      await complete(command, { success: true, activity });
    } catch (error) {
      await p.stopWalk('smart').catch(problem => p.log('Walk stop failed: ' + message(problem), 'red'));
      await failed(command, error, { activity: activity.concat([{ level: 'error', message: 'ALData marketplace sale failed', details: message(error) }]) });
    }
  }

  // The elixir entries carried after the bank tops them up, and the restock.
  async function restockElixirEntries(command: Command, name: string, required: number) {
    let checkpoint = await p.production.checkpoint(command);
    const carried = () => p.production.entries(checkpoint).filter(entry => !entry.pack && entry.item.name === name);
    const count = () => carried().reduce((total, entry) => total + quantityOf(entry.item), 0);
    if (count() < required) {
      await p.bank.merchantVisitBank(command, []);
      checkpoint = await p.production.checkpoint(command);
      const banked = p.production.entries(checkpoint).filter(entry => {
        const original = entry.pack && me().bank?.[entry.pack]?.[entry.slot];
        return original && entry.item.name === name && quantityOf(original) === quantityOf(entry.item);
      });
      for (const entry of banked) {
        if (count() >= required) break;
        await p.bank.bankRetrieveConfirmed(entry.pack!, entry.slot);
        checkpoint = await p.production.checkpoint(command);
      }
    }
    return carried();
  }
  async function merchantSelfRestock(command: Command): Promise<void> {
    const activity: Activity = [];
    try {
      const elixir = command.restock?.elixir;
      if (elixir?.item && reads.inventoryQuantity(elixir.item) < elixir.max) await restockElixirEntries(command, elixir.item, elixir.max);
      const needs = [command.restock?.hp, command.restock?.mp].filter(supply => supply && Number(supply.max) > 0)
        .map(supply => ({ supply, quantity: Math.max(0, Number(supply.max) - reads.inventoryQuantity(supply.item)) }))
        .filter(entry => entry.quantity > 0);
      const total = needs.reduce((sum, entry) => sum + (Number(G().items[entry.supply.item]?.g) || 0) * entry.quantity, 0);
      await fund(command, activity, total, 'Insufficient bank gold to restock merchant potions');
      for (const need of needs) {
        const seller = reads.itemSeller(need.supply.item);
        if (!seller) throw Error('Could not find potion seller for ' + need.supply.item);
        await walk(p.findNpc(seller));
        await buyConfirmed(need.supply.item, need.quantity);
        activity.push({ level: 'success', message: 'Restocked ' + need.quantity + ' × ' + (G().items[need.supply.item]?.name || need.supply.item) + ' to ' + need.supply.max });
      }
      await complete(command, { success: true, ...delivered(command), activity });
    } catch (error) {
      await failed(command, error, { ...delivered(command), activity: activity.concat([{ level: 'error', message: 'Merchant potion restock failed', details: message(error) }]) });
    }
  }

  // deconstruction. A compound copy above +0 dismantles at ten times its value, capped at 50M (G
  // node/server.js dismantle handler); a dismantle recipe names its cost and parts.
  function deconstructionDefinition(item: any): { cost: number } | null {
    if (!item || item.l || item.b) return null;
    const definition = G().items[item.name] || {};
    if (Number(item.level) > 0 && definition.compound && definition.type !== 'booster')
      return { cost: Math.min(50_000_000, p.game.itemValue(item) * 10) };
    const recipe = G().dismantle?.[item.name];
    return recipe ? { cost: Number(recipe.cost) || 0 } : null;
  }
  async function merchantDeconstruct(command: Command): Promise<void> {
    const activity: Activity = [];
    try {
      await closeStand();
      await walk('craftsman');
      for (const mark of command.deconstructionMarks || []) {
        for (let unit = 0; unit < mark.quantity; unit += 1) {
          p.merchant.continues(command);
          const claim = await p.request('/deconstruction/step', { method: 'POST', body: { jobId: command.jobId, id: mark.id, action: 'claim' } });
          let failure: string | null = null, code: unknown = null;
          try {
            p.merchant.continues(command);
            let slot = Number.isInteger(mark.slot) && sameItem(me().items[mark.slot], mark.item) ? mark.slot : reads.findItem(mark.item);
            let item = me().items[slot];
            const definition = deconstructionDefinition(item);
            if (slot < 0 || !sameItem(item, mark.item) || !definition) throw Error('Marked item moved, is protected, or cannot be deconstructed');
            if (me().gold < definition.cost) {
              await walk('bank');
              p.merchant.continues(command);
              await p.bank.withdrawMerchantCash(definition.cost - me().gold, command);
              if (me().gold < definition.cost) throw itemFailure('short_gold', 'Insufficient gold: deconstruction needs ' + definition.cost);
              await walk('craftsman');
              p.merchant.continues(command);
              slot = reads.findItem(mark.item);
              item = me().items[slot];
              if (!sameItem(item, mark.item) || !deconstructionDefinition(item)) throw Error('Marked item changed during bank travel');
            }
            // The game dismantles with two free bag cells, whatever the recipe's parts (rules.ts
            // DISMANTLE_FREE_SLOTS), the same rule the coordinator holds the mark on.
            if (reads.freeInventorySlots() < DISMANTLE_FREE_SLOTS) throw itemFailure('deconstruct_space', 'Insufficient inventory space for deconstruction results');
            await p.production.verifyMarks();
            const result = await p.game.dismantle(slot);
            if (result?.failed) throw Error(result.reason || 'Deconstruction rejected');
          } catch (error) { failure = message(error); code = (error as { code?: unknown } | null)?.code ?? null; }
          await p.request('/deconstruction/step', { method: 'POST', body: { jobId: command.jobId, id: mark.id, attempt: claim.mark.attempt, success: !failure, error: failure, code } });
          if (failure) { activity.push({ level: 'error', message: 'Deconstruction blocked: ' + mark.item.name, details: failure }); break; }
          activity.push({ level: 'success', message: 'Deconstructed ' + mark.item.name });
        }
      }
      await complete(command, { success: true, activity });
    } catch (error) {
      await failed(command, error, { activity });
    }
  }

  // The NPC sale of marked copies, from the bag or the bank.
  async function merchantNpcSale(command: Command): Promise<void> {
    const activity: Activity = [], resolved: string[] = [], blocked: { id: string; error: string; code?: string }[] = [];
    try {
      for (const mark of command.npcSales || []) {
        let slot = reads.findItem(mark.item);
        if (slot < 0) {
          if (mark.source === 'merchant') {
            blocked.push({ id: mark.id, error: 'Marked item is not in merchant inventory', code: 'marked_missing' });
            activity.push({ level: 'error', message: 'Could not find merchant inventory item marked for NPC sale: ' + mark.item.name });
            continue;
          }
          await walk('bank');
          const found = p.bank.findBankItem(mark.item, mark.pack, mark.slot);
          if (!found) {
            blocked.push({ id: mark.id, error: 'Marked item is not in bank inventory' });
            activity.push({ level: 'error', message: 'Could not find NPC-sale item: ' + mark.item.name });
            continue;
          }
          await p.bank.bankRetrieveConfirmed(found.pack, found.slot);
          slot = reads.findItem(mark.item);
        }
        if (slot < 0 || !sameItem(me().items[slot], mark.item)) {
          blocked.push({ id: mark.id, error: 'NPC-sale item changed before sale' });
          activity.push({ level: 'error', message: 'NPC-sale item changed before sale: ' + mark.item.name });
          continue;
        }
        if (me().items[slot].l) { blocked.push({ id: mark.id, error: 'Item is locked' }); continue; }
        let quantity = Math.min(Number(mark.quantity) || 1, quantityOf(me().items[slot]));
        // Named NPC destinations include the walkable interaction offset.
        await walk('fancypots');
        slot = reads.findItem(mark.item);
        if (slot < 0 || !sameItem(me().items[slot], mark.item)) throw Error('NPC-sale item moved before confirmation: ' + mark.item.name);
        if (me().items[slot].l) { blocked.push({ id: mark.id, error: 'Item is locked' }); continue; }
        quantity = Math.min(quantity, quantityOf(me().items[slot]));
        if (p.merchant.job()?.jobId !== command.jobId) throw itemFailure('interrupted');
        const goldBefore = Number(me().gold) || 0;
        await p.production.verifyMarks();
        try { await p.production.verifyProtection([slot]); }
        catch (reservation) { blocked.push({ id: mark.id, error: message(reservation) }); continue; }
        await p.game.sell(slot, quantity);
        resolved.push(mark.id);
        activity.push({ level: 'success', message: 'Sold ' + quantity + ' × ' + mark.item.name + ' to NPC for ' +
          Math.max(0, (Number(me().gold) || 0) - goldBefore).toLocaleString() + ' gold' });
      }
      await complete(command, { success: true, npcSalesResolved: resolved, npcSalesBlocked: blocked, activity });
    } catch (error) {
      await failed(command, error, { npcSalesResolved: resolved, npcSalesBlocked: blocked,
        activity: activity.concat([{ level: 'error', message: 'NPC sale failed', details: message(error) }]) });
    }
  }

  // The donation, whose XP rate Ron's info answers.
  let donationRate = donationXpPerGold(Infinity);
  const donationRateListener = (data: any) => {
    if (data?.response === 'lostandfound_info') donationRate = donationXpPerGold(Number(data.gold) || 0);
  };
  async function merchantDonate(command: Command): Promise<void> {
    const activity: Activity = [], amount = Math.max(0, Math.floor(Number(command.amount) || 0));
    try {
      if (!amount) throw Error('Donation amount must be positive');
      await p.bank.merchantVisitBank(command, activity);
      await fund(command, activity, amount, 'Insufficient bank gold for donation');
      await walk(p.findNpc('lostandfound'));
      await p.game.lostAndFoundInfo();
      await p.sleep(RON_INFO_MS);
      const beforeXp = Number(me().xp) || 0;
      await p.game.donateGold(amount);
      const gained = Math.max(0, (Number(me().xp) || 0) - beforeXp);
      activity.push({ level: 'success', message: 'Donated ' + amount.toLocaleString() + ' gold at the XP frog' +
        (gained ? ' and gained ' + gained.toLocaleString() + ' XP' : '') });
      await complete(command, { success: true, ...delivered(command), activity });
    } catch (error) {
      await failed(command, error, { ...delivered(command), activity: [{ level: 'error', message: 'Merchant donation failed', details: message(error) }] });
    }
  }

  // A mail, a letter or one attachment from the bag or a bank cell.
  async function merchantSendMail(command: Command): Promise<void> {
    const activity: Activity = [], mail = command.mail || {}, source = mail.source || {};
    try {
      await postage(command, activity, !!mail.source, 'Insufficient bank gold for postage to ' + mail.recipient);
      if (!mail.source) {
        await mailed(mail.recipient, mail.subject, mail.message || '', false);
        await complete(command, { success: true, activity: [{ level: 'success', message: 'Sent mail to ' + mail.recipient }] });
        return;
      }
      let slot = -1;
      if (source.pack === 'merchant') slot = reads.findItem(source.item);
      else {
        await walk(p.bankPacks()[source.pack]?.[0] || 'bank');
        const cell = p.bank.findBankItem(source.item, source.pack, Number(source.slot));
        if (!cell) throw Error('mail attachment is no longer in the selected bank slot');
        await p.bank.bankRetrieveConfirmed(cell.pack, cell.slot);
        slot = reads.findItem(source.item);
      }
      if (slot < 0 || !me().items[slot]) throw Error('mail attachment is unavailable');
      const wanted = quantityOf({ q: mail.quantity }), available = reads.itemQuantity(me().items[slot]);
      if (wanted > available) throw Error('mail attachment quantity is no longer available');
      if (wanted < available) {
        if (reads.freeInventorySlots() < 1) throw Error('merchant needs one free inventory slot to split the mail attachment');
        slot = await splitExact(slot, wanted, 'could not split the requested mail quantity');
      }
      if (slot !== 0) { await p.game.swap(slot, 0); await p.sleep(PACKET_GAP_MS); }
      if (!me().items[0] || !sameItem(me().items[0], source.item) || reads.itemQuantity(me().items[0]) !== wanted)
        throw Error('could not place the attachment in inventory slot 0');
      await mailed(mail.recipient, mail.subject, mail.message || '', true);
      activity.push({ level: 'success', message: 'Sent mail to ' + mail.recipient + ' with ' + wanted + ' × ' + source.item.name });
      await complete(command, { success: true, activity });
    } catch (error) {
      await failed(command, error, { activity: activity.concat([{ level: 'error', message: 'Mail delivery failed', details: message(error) }]) });
    }
  }
  // A mail's attachment, taken into a free bag cell. The game answers on `game_response` by the
  // request id; no answer within two measured round trips ends the take.
  async function collectMail(command: Command): Promise<void> {
    let error: string | null = null;
    try {
      if (reads.freeInventorySlots() < 1) throw Error('Merchant needs a free inventory slot to collect mail');
      const requestId = 'mail-' + command.jobId;
      await p.game.takeMail(command.mail.id, requestId, () => new Promise<void>((resolve, reject) => {
        let timer: number | undefined;
        const finish = (problem?: string) => {
          p.scope.clearTimeout(timer);
          p.off('game_response', listener);
          if (problem) reject(Error(problem)); else resolve();
        };
        function listener(data: any) {
          if (data?.request_id !== requestId) return;
          if (data.response === 'mail_item_taken') finish();
          else if (data.failed || data.response === 'inv_size' || data.response === 'mail_item_already_taken') finish(data.reason || data.response);
        }
        p.on('game_response', listener);
        timer = p.scope.setTimeout(() => {
          p.game.replyLost('takeMail', replyMs());
          finish('Collection was not confirmed; refresh mail before retrying');
        }, replyMs());
      }));
    } catch (problem) { error = message(problem); }
    await complete(command, { success: !error, error, activity: [{ level: error ? 'error' : 'success',
      message: error ? 'Mail collection failed' : 'Collected mail attachment', details: error }] });
  }

  // A send to a player. A merchant meets the player first (the merchant job owner's meet). A meet
  // that fails at its deadline is the player never coming within reach, so SEND_MEET_MS reports.
  async function send(name: string, slot: number, quantity: number): Promise<unknown> {
    if (me().ctype === 'merchant') {
      const start = p.now();
      try { await reads.waitForPlayer(name, SEND_MEET_MS); } catch (error) {
        if (p.now() - start >= SEND_MEET_MS) boundFired({ bound: 'SEND_MEET_MS', owner: '10', state: { player: name, slot } });
        throw error;
      }
    }
    return p.game.sendItem(name, slot, quantity);
  }
  // The dashboard's give: the slot the dashboard named while it still holds the item, else the item's
  // slot now.
  async function giveDashboardItem(command: Command): Promise<void> {
    const items = me().items, slot = Number.isInteger(command.slot) && reads.sameItem(items[command.slot], command.item)
      ? command.slot : reads.findItem(command.item);
    if (slot < 0) throw Error('item no longer in inventory');
    await send(command.target, slot, items[slot].q || 1);
    p.log('Gave ' + command.item.name + ' to ' + command.target, '#51D2E1');
  }
  // The dashboard's equip. The native catalog picks the slot (Loaded Die is an orb; class weapons
  // and paired rings stay native), resolved after the preparation awaits.
  async function equipDashboardItem(command: Command): Promise<void> {
    if (!p.merchant.isEquipment(command.item)) throw Error('item is not equipment; use its explicit Use action instead');
    await p.merchant.porcupineManual();
    if (me().ctype === 'merchant') await p.merchant.leaveStand();
    const slot = reads.findItem(reads.fingerprint(command.item));
    if (slot < 0) throw Error('selected equipment is no longer in inventory; refresh and try again');
    const previous = me().ctype === 'merchant' ? p.merchant.hands() : null;
    await p.game.equip(slot);
    // A manual equip makes the hands it changed normal; armor or an orb changes no hand.
    if (previous) p.merchant.manualHands(previous);
  }
  // The dashboard's unequip of the marked piece (from shared.js's command dispatch, 3.9): the piece
  // must still sit in its slot, and a merchant's hands it changed become normal.
  async function unequipDashboardItem(command: Command): Promise<void> {
    await p.merchant.porcupineManual();
    if (me().ctype === 'merchant') await p.merchant.leaveStand();
    if (typeof command.slot !== 'string' || !reads.sameItem(me().slots[command.slot], command.item))
      throw Error('equipped item no longer matches that slot');
    const previous = me().ctype === 'merchant' ? p.merchant.hands() : null;
    await p.game.unequip(command.slot);
    if (previous) p.merchant.manualHands(previous);
  }
  // The coordinator's restore of the pieces a failed operation left off (from shared.js's command
  // dispatch, 3.9): each listed piece found in the bag goes back to its slot.
  async function restoreEquipment(command: Command): Promise<void> {
    const previous = me().ctype === 'merchant' ? p.merchant.hands() : null;
    for (const restore of command.items || []) {
      const slot = reads.findItem(restore.item);
      if (slot >= 0) await p.game.equip(slot, restore.slot);
    }
    if (previous) p.merchant.manualHands(previous);
  }
  // The dashboard's use of an elixir, licence, spawner or a giving item.
  async function useDashboardItem(command: Command): Promise<void> {
    const item = me().items[command.slot];
    if (!reads.sameItemState(item, command.item)) throw Error('item no longer matches that inventory slot');
    const definition = G().items[item.name] || {};
    if (!['elixir', 'licence', 'spawner'].includes(definition.type) && !Array.isArray(definition.gives)) throw Error('item has no supported Use action');
    await p.game.consume(command.slot);
  }

  // The native stand. The journal keeps the socket's purchase receipts across routine reloads; the
  // coordinator's acknowledgements own the ledger.
  const root: typeof globalThis & MarketWindow = globalThis;
  const journal = root.__nativeStandJournal ||= { offers: {}, receipts: {} };
  const purchaseReceipts = root.__nativePurchaseReceipts ||= {};
  const standListener = (event: any) => {
    if (!event || event.type !== '+$$' || event.buyer !== me().name) return;
    const offer: any = Object.values(journal.offers).find((entry: any) => entry.slot === event.slot);
    if (!offer || event.item?.name !== offer.itemId || level(event.item.level) !== offer.level || Number(event.item.price) !== offer.price) return;
    journal.receipts[offer.token] = (Number(journal.receipts[offer.token]) || 0) + quantityOf(event.item);
  };
  // Only the merchant's stand takes native purchases, so only the merchant holds receipts to flush.
  async function flushNativePurchaseReceipts(): Promise<void> {
    if (me().ctype !== 'merchant') return;
    for (const id of Object.keys(purchaseReceipts)) {
      await p.request('/merchant/native-stand', { method: 'POST', body: purchaseReceipts[id] });
      delete purchaseReceipts[id];
    }
  }
  /** Table A's `stand-sync` row: the merchant's open stand syncs while no job, stand return, tidy or
   *  lucky swap holds it. */
  function standSyncReply(): Promise<any> | undefined {
    if (me().ctype === 'merchant' && me().stand && !p.merchant.standReturning() && !p.merchant.holder() &&
        !p.bag.facts().tidying && !p.bag.facts().lucky)
      return nativeStandSync(null, false);
  }
  let serial: Promise<unknown> = Promise.resolve();
  function nativeStandSync(command: Command | null, suspend: boolean): Promise<any> {
    const run = serial.then(() => reconcileNativeStand(command, suspend));
    serial = run.catch(() => {});
    return run;
  }
  async function reconcileNativeStand(command: Command | null, suspend: boolean): Promise<any> {
    // An offer is funded while a free cell is left past the protected free slots.
    const report = async (extra?: Record<string, unknown>) => {
      const result = await p.request('/merchant/native-stand', { method: 'POST', body: { character: me().name, jobId: command?.jobId,
        suspend: !!suspend, slots: me().slots, open: !!me().stand, gold: me().gold,
        space: freeSlots(me().items, p.production.luckySlot(), p.protectedSlots()) > 0, receipts: journal.receipts, ...extra } });
      for (const offer of Object.values<any>(result.offers || {})) {
        if (journal.receipts[offer.token] != null) continue;
        const live = me().slots[offer.slot];
        journal.receipts[offer.token] = live?.b && String(live.rid) === offer.rid
          ? Math.max(offer.acknowledged, offer.quantity - quantityOf(live)) : offer.acknowledged;
      }
      journal.offers = result.offers || {};
      return result;
    };
    let response = await report();
    if (suspend && Object.keys(response.offers || {}).length && !me().stand) {
      await open();
      response = await report();
    }
    for (const offer of response.remove || []) {
      const current = me().slots[offer.slot];
      if (!current?.b || String(current.rid) !== offer.rid) throw Error('Native offer changed before removal');
      try {
        await p.game.unequip(offer.slot);
        if (me().slots[offer.slot] && !await settles(p, () => !me().slots[offer.slot])) throw Error('Native offer removal was not confirmed');
        response = await report({ removed: offer.token });
      } catch (error) { await report({ failed: offer.token }); throw error; }
    }
    // Every requested slot is reserved before placing, and each acknowledgement is kept before
    // another game change, so the next look cannot place a lost offer twice. The coordinator names
    // at most the stand's slots.
    for (let placed = 0; placed < reads.standSlots() && response.create?.length; placed += 1) {
      const offer = response.create[0];
      try {
        await p.game.wishlist(offer.slot, offer.itemId, offer.price, offer.level, offer.quantity);
        if (!me().slots[offer.slot]) await settles(p, () => !!me().slots[offer.slot]);
        response = await report();
      } catch (error) { await report({ failed: offer.token }); throw error; }
    }
    return response;
  }
  async function guardedMarketPurchase(command: Command, listing: any, item: any, price: number, quantity: number,
    purchase: (count: number) => Promise<unknown>, wholeStack?: boolean): Promise<number> {
    await nativeStandSync(command, true);
    const key = listing.key || [listing.seller, listing.slot, listing.rid].join(':');
    const prepared = await p.request('/merchant/native-stand', { method: 'POST', body: { action: 'purchase', character: me().name,
      jobId: command.jobId, key, item: reads.fingerprint(item), price, quantity, automatic: !!(command.bidItemId || listing.bidItemId), wholeStack: !!wholeStack } });
    if (!prepared.quantity) return 0;
    await purchase(prepared.quantity);
    purchaseReceipts[command.jobId + ':' + key] = { action: 'purchased', character: me().name, jobId: command.jobId, key };
    await flushNativePurchaseReceipts();
    return prepared.quantity;
  }
  //: the stand holder's open, list, sync and close. Trade-slot changes need the stand open and
  // are reconciled in place while it stays open.: each stand visit merges the bag before the stand
  // opens.
  async function open(): Promise<void> {
    await p.bank.mergeBag();
    if (me().stand) return;
    await p.game.openStand();
    await p.sleep(PACKET_GAP_MS);
    if (!me().stand && !await settles(p, () => !!me().stand)) throw Error('Merchant stand did not open');
  }
  async function closeStand(): Promise<void> {
    if (!me().stand) return;
    await p.game.closeStand();
    if (me().stand && !await settles(p, () => !me().stand)) throw Error('Merchant stand did not close before travel');
  }
  // The live listings once the stand matches the command's; a paused listing stays off.
  async function list(command: Command): Promise<{ id: string; tradeSlot: string }[]> {
    await nativeStandSync(command, false);
    const desired = (command.listings || []).filter((entry: any) => entry.state !== 'paused');
    const consumed: boolean[] = [], live: { id: string; tradeSlot: string }[] = [];
    for (let index = 1; index <= reads.standSlots(); index += 1) {
      const tradeSlot = 'trade' + index, listed = me().slots[tradeSlot];
      if (!listed || listed.b) continue;
      const match = desired.findIndex((entry: any, at: number) => !consumed[at] && sameItem(listed, entry.item) &&
        Number(listed.price) === Number(entry.price) && Math.min(Number(entry.quantity) || 1, quantityOf(listed)) === quantityOf(listed));
      if (match >= 0) { consumed[match] = true; live.push({ id: desired[match].id, tradeSlot }); }
      else await p.game.unequip(tradeSlot);
    }
    for (let index = 0; index < desired.length; index += 1) {
      const listing = desired[index];
      if (consumed[index]) continue;
      const slot = Number.isInteger(listing.slot) && sameItem(me().items[listing.slot], listing.item) ? listing.slot : reads.findItem(listing.item);
      if (slot < 0) continue;
      let empty: string | null = null;
      for (let at = 1; at <= reads.standSlots() && !empty; at += 1) if (!me().slots['trade' + at]) empty = 'trade' + at;
      if (!empty) break;
      const tradeSlot = empty;
      await p.production.verifyMarks();
      await p.game.trade(slot, tradeSlot, listing.price, Math.min(listing.quantity || 1, me().items[slot].q || 1));
      const shown = () => sameItem(me().slots[tradeSlot], listing.item);
      if (!shown() && !await settles(p, shown)) throw Error('stand listing did not populate ' + tradeSlot + ': ' + listing.item.name);
      consumed[index] = true;
      live.push({ id: listing.id, tradeSlot });
    }
    await nativeStandSync(command, false);
    return live;
  }

  // The loot pass over the chests within the game's loot radius, two per pass, rotating past the
  // last opened so an item chest that cannot be taken never starves later gold chests. A lasting
  // refusal waits for what refused it to change: the chest's owner, the character's map or
  // invisibility, or the bag's free cells.
  let lastChest: string | null = null;
  const refused: Record<string, { reason: string; state: string }> = {};
  const refusalState = (id: string, reason: string) => JSON.stringify([p.chests()[id]?.owner ?? null, me().map, !!me().s?.invis,
    reason === 'loot_no_space' ? reads.freeInventorySlots() : null]);
  function eligibleDepartureChests(): string[] {
    const chests = p.chests() || {};
    return Object.keys(chests).filter(id => {
      const c = chests[id];
      return c && !c.to_delete && (!c.map || c.map === me().map) && (c.in == null || String(c.in) === String(me().in)) &&
        Number.isFinite(c.x) && Number.isFinite(c.y) && Math.hypot(c.x - me().x, c.y - me().y) <= LOOT_RADIUS;
    });
  }
  async function smartLoot(eligible?: string[]): Promise<boolean> {
    const cave = p.cave();
    if (cave) return cave.loot();
    const chests = p.chests() || {}, local = eligibleDepartureChests();
    let ids = Array.isArray(eligible) ? eligible.filter(id => local.includes(id)) : local;
    if (!ids.length) {
      root.partyLootStatus = { at: p.now(), map: me().map, in: me().in, eligible: 0, pending: false, error: null };
      return true;
    }
    const start = (ids.indexOf(lastChest!) + 1) % ids.length;
    ids = ids.slice(start).concat(ids.slice(0, start));
    for (const id of Object.keys(refused)) if (!chests[id] || refused[id].state !== refusalState(id, refused[id].reason)) delete refused[id];
    // The bag is short of room once only the player's protected free slots are left.
    const capacityBlocked = !!(root.partyLootStatus?.capacityBlocked && reads.freeInventorySlots() <= p.protectedSlots());
    const progress = root.partyLootStatus = { at: p.now(), map: me().map, in: me().in, eligible: ids.length, pending: true,
      error: null as string | null, capacityBlocked, chests: ids.slice(0, 8).map(id => { const c = chests[id] || {};
        return { id, map: c.map, in: c.in, x: c.x, y: c.y, items: c.items, skin: c.skin, deleted: !!c.to_delete, refused: refused[id]?.reason ?? null }; }) };
    ids = ids.filter(id => !refused[id]);
    if (!ids.length) { progress.error = 'waiting for a refused chest to change'; return false; }
    // The game answers open_chest for a chest opened in the last 5 s with no emit, so the job band
    // would admit a call that sends nothing. The pass leaves that chest for the next one.
    ids = ids.filter(id => !(chests[id]?.openning && p.now() - +new Date(chests[id].openning) < 5000));
    if (!ids.length) { progress.error = 'waiting for an opening chest'; return false; }
    // A chest id passes loot()'s client bag check; the server checks the actual items, including a
    // merge into a carried stack, and hands them to party members who can carry them.
    if (reads.freeInventorySlots() <= p.protectedSlots()) p.merchant.cleanout().catch(error => p.log('Could not queue merchant cleanout: ' + message(error), 'red'));
    for (const id of ids.slice(0, 2)) {
      lastChest = id;
      try {
        const result = await p.game.loot(id);
        if (result?.success === false) throw result;
      } catch (error: any) {
        const reason = String(error?.reason || error?.message || error);
        progress.error = reason;
        if (!LOOT_REASONS.includes(reason)) throw error;
        if (LASTING_LOOT.includes(reason)) refused[id] = { reason, state: refusalState(id, reason) };
        if (reason === 'loot_no_space') {
          progress.capacityBlocked = true;
          p.merchant.cleanout().catch(problem => p.log('Could not queue merchant cleanout: ' + message(problem), 'red'));
        }
        if (Array.isArray(eligible) && reason !== 'chest_not_found') throw error;
      }
    }
    progress.eligible = eligibleDepartureChests().length;
    progress.pending = progress.eligible > 0;
    return true;
  }
  // The loot timer, started and stopped with the role runner. It is an `act` registration of the
  // items owner's run scope handle, so table P holds it and the generation's stop ends it (the
  // runner's `active` check and the Pause check are gone). The tick skips while the character is
  // dead or the events owner's A/B mode is pending or feeding.
  let lootTimer: number | undefined, looting = false;
  function startLoot(report: (error: unknown) => void): void {
    if (lootTimer) return;
    lootTimer = p.scope.setInterval(async () => {
      if (looting || me().rip || ['pending', 'feed'].includes(p.abtesting() ?? '')) return;
      looting = true;
      try { await smartLoot(); } catch (error) { report(error); } finally { looting = false; }
    }, LOOT_TICK_MS);
  }
  function stopLoot(): void { p.scope.clearInterval(lootTimer); lootTimer = undefined; }

  // The market's listeners, registered from the module (L-1); `stop` ends them with the runtime.
  function start(): void {
    p.on('game_response', donationRateListener);
    p.on('ui', standListener);
  }
  function stop(): void {
    p.off('game_response', donationRateListener);
    p.off('ui', standListener);
    stopLoot();
  }
  // Each status report carries the last Ponty read and starts the next one while the
  // coordinator's last reply says a reader needs the listings (`pontyWanted`), the merchant stands in
  // Ponty's range and the call budget owner's background band lets the read go. The market feeds' floor holds here too:
  // at most one read per ALData rate window, the cadence of the coordinator's own Ponty feed.
  function pontyReport() {
    if (p.bag.pontyWanted() && p.now() - ponty.readAt >= ALDATA_RATE_WINDOW_MS) void refreshPontyListings();
    return { listings: ponty.listings, updatedAt: ponty.updatedAt, error: ponty.error };
  }

  return {
    standSyncReply, buyConfirmed, purchasePreservesLogisticsReserve, merchantExchange, nearbyStandListings, merchantStandSearch, merchantStandBuy,
    refreshPontyListings, merchantPontyBuy, merchantALDataAuth, merchantALDataBuy, merchantALDataSell, restockElixirEntries,
    merchantSelfRestock, merchantDeconstruct, merchantNpcSale, merchantDonate, merchantSendMail, collectMail, send,
    equipDashboardItem, giveDashboardItem, unequipDashboardItem, restoreEquipment, useDashboardItem, flushNativePurchaseReceipts, nativeStandSync, eligibleDepartureChests, smartLoot,
    stand: { open, list, sync: nativeStandSync, close: closeStand },
    // `pass` is one pass over the chests a departure may take, for the hunting owner's loot
    // passes.
    loot: { start: startLoot, stop: stopLoot, pass: () => smartLoot(eligibleDepartureChests()) },
    ponty: pontyReport,
    donationRate: () => donationRate,
    start, stop,
  };
}
export type MarketAnswers = ReturnType<typeof createMarket>;
