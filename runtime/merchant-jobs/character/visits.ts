// The merchant job owner's visits on the character: both halves of a merchant visit and the
// giveaways the merchant sees. The merchant's service visit collects from a member, delivers to it
// through the delivery journal and services its items, and the member equips what it delivered. A
// fighter hands the merchant its marked items, its cleanout and its gold in one send window, hands
// an order's materials, asks for a cleanout when its bag runs low, and drops invisibility while the
// merchant visits it. shared.js builds it at load over one-line reads of other owners
// (`visitPorts()`), each read when a function runs; the moved code is shared.js's own JavaScript, so
// those reads are untyped here.
// The send window waits for the merchant's distance and the command's state only. Its own `cc <= 120` went in
// layer 8 part 4 (3.13): the call budget's bands keep combat's room, and the sends pass the budget's emit layer
// as the items owner's rows under.
import { fateReachesMerchant, ruleKeyParts, TRACKER_ITEMS, type Fate } from '../../items/api.ts';
import { jobEnded, HANDOFF, VISIBILITY_RANGE, merchantAnniversaryControl, BACKGROUND_REFUSED, type MerchantDoorAnswer, type MerchantDoorBand, type MerchantDoors } from '../rules.ts';
import { boundFired } from '../../status/api.ts';
import { partyHooks } from '../../hooks/index.ts';
import { ageOf } from '../../protocol/reports.ts';
import { ENTITY_UPDATE, OWN_UPDATE, untilGame } from './game-wait.ts';
import { nextOwnReport } from './report-wait.ts';

export type VisitPorts = Record<string, any>;
export interface SendWindow { deadline: number; revision: number; realm: string; approachPending: boolean; reason: string | null }

// The bounds inside one visit (v1.5.0's): the send window waits 30 s for the
// merchant in reach, looking again at each entity update the game sends.
const SEND_WINDOW_MS = 30_000;
// A visited fighter keeps invisibility off while the coordinator's reply names the visiting merchant
// and the merchant stands within rules.ts's VISIBILITY_RANGE.
// The merchant's bounds on a visit (v1.5.0's): the rendezvous gives the walk
// to a member 120 s, and the giveaway join looks for its host 60 s, at each entity update, and walks
// to the host when it stands farther than 350.
const RENDEZVOUS_MS = 120_000, HOST_LOOK_MS = 60_000, HOST_REACH = 350;
// The service visit's bounds (v1.5.0's): the merchant waits 10 s for the
// member to come into reach, and asks for the handoff's receipt again at each of its own reports
// (report-wait.ts). A collection keeps the bag's protected free slots (the items owner's
// `p.protectedSlots()`); a delivery swap keeps SWAP_RESERVE of them free, so the lucky slot can still
// be cleared.
const RECIPIENT_MS = 10_000, SWAP_RESERVE = 1;
// After a service visit the itinerary keeps the merchant while the coordinator sends its next leg or
// retries this one, so gathering does not take it in between (the runner's `collection` holder). The
// hold ends on the first reply that names no open itinerary. COLLECTION_HOLD_MS, the earlier
// console's 30 s, bounds it against a coordinator that stops answering, counted from the last reply.
const COLLECTION_HOLD_MS = 30_000;
// A delivered item arrives in the bag, and an equip shows in the slots, on the character's update.
// v1.5.0 looked 20 times 250 ms apart, so ARRIVAL_MS bounds the wait at that 5 s.
const ARRIVAL_MS = 5_000;
// SEND_WINDOW_MS, RENDEZVOUS_MS, HOST_LOOK_MS, RECIPIENT_MS, ARRIVAL_MS and RELOCATE_MS are kept bounds
// against the game, and COLLECTION_HOLD_MS against the coordinator (runner.ts `record`): each firing
// goes to the status owner's bound record (status/character/bounds.ts). The pause and
// receipt waits end on the coordinator's answer: the handoff, or a refusal naming the cause
// (merchant-jobs/coordinator/routes.ts `handoffRefusal`).
const bound = (name: string, state: Record<string, unknown>) => boundFired({ bound: name, owner: '08', state });
// A meet that runs out of time throws "timed out" (movement errands.ts `meet`), and a fighter's wait
// "did not become reachable" (items bag.ts `waitForPlayer`); either is the named bound's firing.
async function bounded<T>(name: string, state: Record<string, unknown>, work: () => Promise<T>): Promise<T> {
  try { return await work(); } catch (error: any) {
    if (/timed out|did not become reachable/.test(String(error?.message || error))) bound(name, state);
    throw error;
  }
}
// The town return's bounds (v1.5.0's): within 140 of the market the merchant
// is already home; the Town cast has relocated it once it stands 90 from where it cast, which the
// game's transport (`new_map`) or the character's update shows.
const HOME_REACH = 140, RELOCATED = 90;
// RELOCATE_MS bounds that wait: the channel's time left, which the server's `town` condition carries
// (`character.c.town.ms`), plus a report's freshness window for the transport. G.skills.use_town names
// no channel time, so v1.5.0's 12 s stays for a cast whose condition has not shown yet.
const RELOCATE_MS = 12_000;
const relocateMs = (me: any): number => {
  const left = Number(me.c?.town?.ms);
  return left > 0 ? left + ageOf('report') : RELOCATE_MS;
};
// The supplies and the personal tracker a cleanout never sends.
const CLEANOUT_KEEPS = [...TRACKER_ITEMS, 'hpot0', 'mpot0', 'hpot1', 'mpot1'];

export function cleanoutProtected(item: any): boolean {
  return !!(item.l || item.b || CLEANOUT_KEEPS.indexOf(item.name) >= 0);
}
export function isPersonalTracker(item: any): boolean {
  return !!item && TRACKER_ITEMS.includes(item.name);
}
// A cleanout sends the least valuable kinds first: materials, then jewellery, armour and weapons.
export function cleanoutPriority(entry: any): number {
  if (entry.kind !== 'cleanout') return 0;
  const data = (G as any).items[entry.item.name] || {};
  if (data.type === 'weapon' || data.wtype) return 4;
  if (['helmet', 'chest', 'pants', 'gloves', 'shoes', 'cape', 'shield'].indexOf(data.type) >= 0) return 3;
  if (['ring', 'earring', 'belt', 'orb', 'amulet', 'source', 'quiver', 'offhand'].indexOf(data.type) >= 0) return 2;
  return 1;
}
// The items owner's rule key parse; a name-only key from before levels is the
// item at +0.
const ruleItem = (key: string) => ruleKeyParts(key) ?? { name: key, level: 0 };
export function cleanoutRespectsAutoItemLevel(item: any, rules: Record<string, string> | undefined): boolean {
  const keys = Object.keys(rules || {}).filter(key => {
    if (rules![key] !== 'bank' && rules![key] !== 'merchant') return false;
    return ruleItem(key).name === item.name;
  });
  // An explicit level policy must not become a name-only rule via cleanout.
  return !keys.length || keys.some(key => {
    return (Number(item.level) || 0) === ruleItem(key).level;
  });
}

// The visits this CODE load built, whose invisibility window turns asks through the door below.
let live: ReturnType<typeof createMerchantVisits> | null = null;
export function createMerchantVisits(p: VisitPorts) {
  const character = (): any => p.character();
  async function withMerchantHandoffRecovery(command: any, action: () => Promise<unknown>): Promise<unknown> {
    const revision = p.walkState().intent.revision;
    const needsUnequip = (command.upgrades || []).some((mark: any) =>
      mark.equipped && typeof mark.slot === 'string' && p.sameItem(character().slots[mark.slot], mark.item));
    command.__handoffApproached = false;
    try { return needsUnequip ? await p.afterCombat(action, 'merchant handoff') : await action(); }
    finally {
      // A late handoff must never override a new manual move or cleared focus.
      const intent = p.walkState().intent;
      if ((needsUnequip || command.__handoffApproached) && !command.convoyContinuation && p.current() && p.lastCommand() === command.id &&
          intent.revision === revision && !intent.cancelled && p.partyLocation() && character().ctype !== 'merchant')
        p.beginFarmReunion();
    }
  }

  function assertMerchantContinuation(command: any): void {
    const continuation = command.convoyContinuation;
    if (!continuation) return;
    if (!p.current() || p.lastCommand() !== command.id || p.walkState().intent.revision !== continuation.navigationRevision)
      throw new Error('Merchant collection continuation expired or was superseded');
    if (Date.now() >= continuation.deadline) {
      // The walk's pause for this visit ran out (rules.ts MERCHANT_PAUSE_DEADLINE_MS).
      bound('MERCHANT_PAUSE_DEADLINE_MS', { jobId: command.jobId, convoyId: continuation.convoyId });
      throw new Error('Merchant collection continuation expired or was superseded');
    }
  }

  // The next game packet of `events`, or `bound` ms: a loop that reads the game state looks again then.
  function nextUpdate(events: readonly string[], bound: number): Promise<boolean> {
    let first = true;
    return p.untilGame(events, () => { if (first) { first = false; return false; } return true; }, Math.max(0, bound));
  }

  async function requestMerchantHandoff(url: string, options: unknown): Promise<any> {
    for (;;) {
      const result = await p.request(url, options);
      if (result.deferred && result.reason === 'hunt_movement_owned') {
        const deferred: any = new Error(result.reason); deferred.reason = result.reason; throw deferred;
      }
      if (result.refused) throw new Error('Handoff refused: ' + result.reason);
      if (!result.waiting) return result;
      // The coordinator admits the pause from the members' reports, so the merchant asks again at
      // its own next report, bounded by a report's freshness window.
      await p.nextReport(ageOf('report'));
    }
  }

  // One bounded window covers every bag transfer and the gold. It never moves an engaged fighter
  // toward the merchant.
  async function waitForHandoffSendWindow(command: any, window: SendWindow): Promise<{ ready: boolean; waited: boolean }> {
    let waited = false;
    const reach = HANDOFF.sendDistance;
    while (Date.now() < window.deadline) {
      const continuation = command.convoyContinuation, me = character(), intent = p.walkState().intent;
      if (!p.current() || p.lastCommand() !== command.id || intent.revision !== window.revision || p.realm() !== window.realm ||
          me.rip || continuation && (intent.revision !== continuation.navigationRevision || Date.now() >= continuation.deadline)) {
        window.reason = 'handoff interrupted';
        return { ready: false, waited };
      }
      const player: any = p.player(command.merchant);
      const sameLocation = player && !player.rip && (!player.map || player.map === me.map) &&
        (player.in == null || String(player.in) === String(me.in));
      const distance = sameLocation ? Math.hypot(Number(player.x) - Number(me.x), Number(player.y) - Number(me.y)) : Infinity;
      if (distance < reach) return { ready: true, waited };
      if (sameLocation && !me.moving && !window.approachPending && !p.engaged()) {
        window.approachPending = true;
        command.__handoffApproached = true;
        try {
          Promise.resolve(p.approach(Number(player.x), Number(player.y)))
            .catch((error: any) => p.log('Handoff approach failed: ' + String(error?.reason || error?.message || error), 'red'))
            .finally(() => { window.approachPending = false; });
        } catch (_handoffApproachError) { window.approachPending = false; }
      }
      waited = true;
      await nextUpdate(ENTITY_UPDATE, window.deadline - Date.now());
    }
    bound('SEND_WINDOW_MS', { merchant: command.merchant, jobId: command.jobId });
    window.reason = 'no safe send window within 30 seconds';
    return { ready: false, waited };
  }

  // Whether a copy's fate lets its request send it. An automatic pickup or compound copy
  // goes only on a fate that reaches the merchant. Any other request stays on `held` or `keep` from a
  // row above the default (an operation, the hands, the player's lock, a claim, a rule or an
  // add-on). The default `keep` names a copy no row claims, which a mark or the cleanout sends,
  // and a copy that landed after the coordinator's last status has no fate yet and goes as asked.
  // A one-time exchange holds its copy (fates.ts `copyFate`, held by `exchange`) against every other
  // errand, so its own pickup, the mark that names the exchange, sends that held copy.
  function fateSends(request: any, fate: Fate | null | undefined): boolean {
    if (request.mark?.exchangeJobId && fate?.fate === 'held' && fate.by === 'exchange') return true;
    if (request.mark && (request.mark.automaticPickup || request.mark.autoCompound)) return fateReachesMerchant(fate);
    return !fate || fate.row === 'F7' || ['keep', 'held'].indexOf(fate.fate) < 0;
  }

  async function merchantHandoff(command: any): Promise<void> {
    const me = character();
    const window: SendWindow = { deadline: Date.now() + SEND_WINDOW_MS, revision: p.walkState().intent.revision, realm: p.realm(), approachPending: false, reason: null };
    const sent: any[] = [], banked: any[] = [], kept: any[] = [], cleaned: any[] = [], reserved: any[] = [];
    for (let equippedIndex = 0; equippedIndex < (command.upgrades || []).length; equippedIndex += 1) {
      assertMerchantContinuation(command);
      const equippedMark = command.upgrades[equippedIndex];
      if (equippedMark.equipped && typeof equippedMark.slot === 'string' && p.sameItem(me.slots[equippedMark.slot], equippedMark.item))
        await p.unequip(equippedMark.slot);
      reserved.push(equippedMark);
    }
    (command.compounds || []).forEach((group: any) => { (group.items || []).forEach((mark: any) => { reserved.push(mark); }); });
    const reservedSlots: Record<number, boolean> = {};
    let requests: any[] = reserved.map(mark => {
      const markedSlot = Number.isInteger(mark.slot) ? mark.slot : null;
      const liveSlot = markedSlot !== null && !reservedSlots[markedSlot] && p.sameItem(me.items[markedSlot], mark.item)
        ? markedSlot : me.items.findIndex((item: any, slot: number) => !reservedSlots[slot] && p.sameItem(item, mark.item));
      if (liveSlot < 0) return null;
      reservedSlots[liveSlot] = true;
      return { item: mark.item, slot: liveSlot, mark, kind: 'work' };
    }).filter(Boolean);
    if ((command.autoCompounds || []).length) await p.refreshCompoundProtection(command);
    const deliverySafeStock = p.compoundAvailableStock(command);
    (command.autoCompounds || []).forEach((autoMark: any) => {
      me.items.forEach((item: any, slot: number) => {
        if (!item || !deliverySafeStock[slot] || item.name !== autoMark.name || (item.level || 0) >= autoMark.targetTier ||
            requests.some(entry => entry.slot === slot)) return;
        requests.push({ item: p.fingerprint(item), slot, mark: { slot, item: p.fingerprint(item), autoCompound: true }, kind: 'work' });
      });
    });
    (command.marked || []).forEach((mark: any) => {
      const wanted = mark && mark.item ? mark.item : mark;
      const markedSlot = mark && Number.isInteger(mark.slot) ? mark.slot : null;
      const liveSlot = markedSlot !== null && p.sameItem(me.items[markedSlot], wanted) ? markedSlot : p.findItem(wanted);
      if (liveSlot >= 0 && !requests.some(entry => entry.slot === liveSlot))
        requests.push({ item: wanted, slot: liveSlot, mark, kind: 'bank' });
    });
    (command.merchantMarked || []).forEach((mark: any) => {
      const wanted = mark && mark.item ? mark.item : mark;
      const markedSlot = mark && Number.isInteger(mark.slot) ? mark.slot : null;
      const liveSlot = markedSlot !== null && p.sameItem(me.items[markedSlot], wanted) ? markedSlot : p.findItem(wanted);
      if (liveSlot >= 0 && !requests.some(entry => entry.slot === liveSlot))
        requests.push({ item: wanted, slot: liveSlot, mark, kind: 'keep',
          quantity: (mark.deconstructionId || mark.npcSaleId || mark.automaticPickup) ? mark.quantity : undefined });
    });
    // Resolve automatic rules against the character's live bag at rendezvous time. The coordinator
    // snapshot can be one status beat behind when loot lands before a Merchant's Luck or service visit.
    Object.keys(command.autoItemMarks || {}).forEach(ruleKey => {
      const mode = command.autoItemMarks[ruleKey];
      if (mode !== 'bank' && mode !== 'merchant') return;
      const { name: itemName, level: itemLevel } = ruleItem(ruleKey);
      me.items.forEach((item: any, slot: number) => {
        if (!item || item.name !== itemName || (Number(item.level) || 0) !== itemLevel || requests.some(entry => entry.slot === slot)) return;
        const mark = { slot, item: p.fingerprint(item), auto: true };
        requests.push({ item: mark.item, slot, mark, kind: mode === 'bank' ? 'bank' : 'keep' });
      });
    });

    if (command.cleanout) {
      me.items.forEach((item: any, slot: number) => {
        if (!item || requests.some(entry => entry.slot === slot)) return;
        if (cleanoutProtected(item)) return;
        if (!cleanoutRespectsAutoItemLevel(item, command.autoItemMarks)) return;
        const mark = { slot, item: p.fingerprint(item), quantity: p.itemQuantity(item), autoCleanout: true };
        requests.push({ item: mark.item, slot, mark, kind: 'cleanout', quantity: mark.quantity });
      });
      requests = requests.filter(entry => !cleanoutProtected(entry.item));
      requests.sort((a, b) => cleanoutPriority(a) - cleanoutPriority(b));
    }
    requests = requests.filter(entry => !isPersonalTracker(entry.item));
    let capacity = Math.max(0, Number(command.capacity) || 0);
    // A cleanout is an emergency while the bag is down to the items owner's protected free slots.
    const cleanoutEmergency = p.freeInventorySlots() <= p.protectedSlots();
    try {
      for (let i = 0; i < requests.length; i += 1) {
        if (capacity <= 0) break;
        // Once an emergency visit starts, it uses its carrying capacity; only the follow-up visit
        // depends on the remaining free slots.
        if (requests[i].kind === 'cleanout' && !cleanoutEmergency) break;
        if (!(await waitForHandoffSendWindow(command, window)).ready) break;
        let slot = Number.isInteger(requests[i].slot) && p.sameItem(me.items[requests[i].slot], requests[i].item)
          ? requests[i].slot : p.findItem(requests[i].item);
        if (slot < 0) continue;
        // Before sending, the copy's one fate (the items owner's `items.fate`)
        // decides for every request, so a copy the merchant takes is sent though the item also has a
        // compound rule, and a held, claimed or locked copy stays though a mark, a rule or the cleanout
        // asked for it. An automatic pickup or compound copy is asked at its own slot.
        const pickup = !!requests[i].mark && (requests[i].mark.automaticPickup || requests[i].mark.autoCompound);
        if (pickup) slot = requests[i].slot;
        if (!Number.isInteger(slot)) continue;
        const answer = await p.request('/merchant/job/' + command.jobId + '?target=' + encodeURIComponent(me.name) + '&slot=' + slot);
        if (!p.sameItem(me.items[slot], requests[i].item) || !fateSends(requests[i], answer && answer.fates && answer.fates[slot])) continue;
        const checkedSlot = slot;
        if (pickup) {
          // An automatic pickup also stays within its listed quantity.
          if (requests[i].mark.automaticPickup) {
            const livePickups = answer.collectionPickups && answer.collectionPickups.keep || [];
            // collectionPickups gives a slot to an ordinary merchant mark ahead of a processing pickup
            // for the same copy, so either live entry authorizes the send (#43, fork). An ordinary
            // mark sends the whole stack and is the mark the receipt reports for clearing.
            const authorizedPickup = livePickups.find((mark: any) => mark.slot === slot && p.sameItem(mark.item, requests[i].item) &&
              (mark.automaticPickup || !mark.npcSaleId && !mark.deconstructionId));
            if (!authorizedPickup) continue;
            if (!authorizedPickup.automaticPickup) requests[i].mark = authorizedPickup;
            requests[i].quantity = authorizedPickup.automaticPickup
              ? Math.min(Number(authorizedPickup.quantity) || 1, p.itemQuantity(me.items[slot])) : p.itemQuantity(me.items[slot]);
          }
        }
        // Authorization and protection reads can yield while combat or loot changes range or slots;
        // a newly opened send window reauthorizes.
        const finalWindow = await waitForHandoffSendWindow(command, window);
        if (!finalWindow.ready) break;
        if (finalWindow.waited) { i -= 1; continue; }
        slot = Number.isInteger(requests[i].slot) && p.sameItem(me.items[requests[i].slot], requests[i].item)
          ? requests[i].slot : p.findItem(requests[i].item);
        if (slot < 0) continue;
        // A copy that moved slots while the window opened is asked again at its new slot.
        if (slot !== checkedSlot) { i -= 1; continue; }
        if (isPersonalTracker(me.items[slot]) || command.cleanout && cleanoutProtected(me.items[slot])) continue;
        const sendQuantity = Math.min(Number(requests[i].quantity) || p.itemQuantity(me.items[slot]), p.itemQuantity(me.items[slot]));
        if (requests[i].mark && (requests[i].mark.deconstructionId || requests[i].mark.npcSaleId) && (me.items[slot].l || me.items[slot].b)) continue;
        await p.sendItem(command.merchant, slot, sendQuantity);

        sent.push(requests[i]);
        capacity -= 1;
        if (requests[i].kind === 'bank') banked.push(requests[i].mark);
        if (requests[i].kind === 'keep') kept.push((requests[i].mark.deconstructionId || requests[i].mark.npcSaleId || requests[i].mark.automaticPickup)
          ? Object.assign({}, requests[i].mark, { quantity: sendQuantity }) : requests[i].mark);
        if (requests[i].kind === 'cleanout') cleaned.push(requests[i].mark);
      }
    } catch (handoffError: any) {
      // Confirmed earlier sends still belong in the receipt. Unacknowledged requests stay marked for
      // the native inventory reconciliation and retry.
      window.reason = String(handoffError.reason || handoffError.message || handoffError);
    }
    // The threshold only decides when an automatic visit is queued. Once the merchant is here,
    // automatically or by hand, the character hands over all carried gold; a requested walking
    // balance is delivered after the pickup.
    let excess = 0;
    if (me.gold > 0 && !window.reason && (await waitForHandoffSendWindow(command, window)).ready) {
      const outgoingGold = Math.max(0, me.gold);
      if (outgoingGold) {
        try { await p.sendGold(command.merchant, outgoingGold); excess = outgoingGold; }
        catch (goldError: any) { window.reason = String(goldError.reason || goldError.message || goldError); }
      }
    }
    await p.request('/merchant/handoff-complete', { method: 'POST', body: {
      jobId: command.jobId, commandId: command.id, character: me.name, sent, banked, kept, cleaned,
      cleanoutRemaining: !!command.cleanout && p.freeInventorySlots() <= p.protectedSlots() && sent.length < requests.length, gold: excess,
      partial: !!window.reason, reason: window.reason,
    } });
    p.log('Merchant handoff complete', '#51D2E1');
  }

  async function merchantOrderHandoff(command: any): Promise<void> {
    const me = character();
    await p.waitForPlayer(command.merchant, HANDOFF.playerWaitMs);
    assertMerchantContinuation(command);
    const sent: any[] = [];
    for (let i = 0; i < (command.items || []).length; i += 1) {
      assertMerchantContinuation(command);
      const requestItem = command.items[i], wanted = requestItem.item;
      const slot = Number.isInteger(requestItem.slot) && p.sameItem(me.items[requestItem.slot], wanted) ? requestItem.slot : p.findItem(wanted);
      if (slot < 0) throw new Error('Missing crafting material ' + wanted.name);
      const quantity = Math.min(Number(requestItem.quantity) || 1, me.items[slot].q || 1);
      await p.sendItem(command.merchant, slot, quantity);
      sent.push({ item: wanted, quantity });
    }
    await p.request('/merchant/order-handoff-complete', { method: 'POST', body: {
      jobId: command.jobId, commandId: command.id, character: me.name, sent,
    } });
  }

  // The coordinator names the merchant visiting this fighter on each reply; within range the
  // fighter drops invisibility, and turns reads `merchantVisibilityActive` to hold it off.
  let visiting: string | null = null;
  function merchantNearby(merchant: string | null): boolean {
    const me = character(), player: any = merchant && p.player(merchant);
    return !!player && !player.rip && (!player.map || player.map === me.map) &&
      (player.in == null || me.in == null || player.in === me.in) &&
      Math.hypot(player.x - me.x, player.y - me.y) <= VISIBILITY_RANGE;
  }
  async function applyMerchantVisibility(merchant: string | null | undefined): Promise<void> {
    const me = character();
    visiting = merchant || null;
    if (merchantNearby(visiting) && me.s && me.s.invis) await p.stop('invis');
  }
  // The hold lasts while the last reply names the merchant and it stands in range now.
  function merchantVisibilityActive(): boolean { return merchantNearby(visiting); }

  // The giveaways the merchant sees on other players' trade slots, for its report; the
  // coordinator queues the join (sources.ts `enqueueGiveaway`).
  function nearbyGiveaways(): any[] {
    const me = character();
    if (me.ctype !== 'merchant') return [];
    const giveaways: any[] = [], entities = p.entities() || {};
    Object.keys(entities).forEach(id => {
      const seller = entities[id];
      if (!seller || seller.type !== 'character' || seller.name === me.name || !seller.slots) return;
      Object.keys(seller.slots).forEach(slot => {
        const item = seller.slots[slot];
        if (slot.indexOf('trade') !== 0 || !item || !item.giveaway || !item.rid) return;
        giveaways.push({ seller: seller.name, slot, rid: item.rid, item: p.fingerprint(item),
          minutes: Number(item.giveaway) || 0, entrants: Array.isArray(item.list) ? item.list.slice() : [],
          map: seller.map || me.map, x: Math.round(seller.x), y: Math.round(seller.y) });
      });
    });
    return giveaways;
  }

  // The merchant's delivery journal. Each reserved delivery is written as uncertain before the send,
  // so an interrupted send is never blindly repeated; the coordinator acknowledges each receipt, and
  // a confirmed one leaves the journal. The journal sits in the browser's storage under the
  // merchant's name, so it survives a reload; a send the reload cut off reads as uncertain.
  let recoveredDeliveryJournal = false;
  const journalKey = () => 'party-deliveries:' + character().name;
  function merchantDeliveryJournal(): Record<string, any> {
    const journal = JSON.parse(p.root().localStorage.getItem(journalKey()) || '{}');
    if (!recoveredDeliveryJournal) {
      Object.keys(journal).forEach(id => { if (journal[id].phase === 'sending') journal[id].phase = 'uncertain'; });
      recoveredDeliveryJournal = true;
      saveMerchantDeliveryJournal(journal);
    }
    return journal;
  }
  function saveMerchantDeliveryJournal(journal: Record<string, any>): void {
    p.root().localStorage.setItem(journalKey(), JSON.stringify(journal));
  }
  // One pass at a time sends the journal's receipts, on each status reply (the status owner's table A
  // row) and after each delivery; the flag sits on the runtime root, so a reloaded runtime starts no
  // second pass. A failed send keeps its receipt in the journal for the next pass.
  async function recoverMerchantDeliveryReceipts(): Promise<void> {
    if (character().ctype !== 'merchant' || p.root().__merchantDeliveryReceiptBusy) return;
    p.root().__merchantDeliveryReceiptBusy = true;
    try {
      const journal = merchantDeliveryJournal();
      for (const id of Object.keys(journal)) {
        const receipt = journal[id];
        if (receipt.phase === 'sending') continue;
        await p.request('/merchant/delivery-receipt', { method: 'POST', body: receipt });
        if (receipt.phase === 'confirmed') {
          const latest = merchantDeliveryJournal(); delete latest[id]; saveMerchantDeliveryJournal(latest);
        }
      }
    } catch (_) { /* The receipt stays in the journal. */ } finally { p.root().__merchantDeliveryReceiptBusy = false; }
  }
  async function sendReservedMerchantDelivery(command: any, mark: any, slot: number): Promise<boolean> {
    if (!mark.id) throw new Error('Delivery identity unavailable; waiting for refreshed command');
    let journal = merchantDeliveryJournal();
    if (journal[mark.id]) return false;
    const receipt: any = { deliveryReceipt: true, character: character().name, target: command.target, deliveryId: mark.id, phase: 'uncertain' };
    journal[mark.id] = receipt; saveMerchantDeliveryJournal(journal);
    // Persist uncertainty before the game mutation; an interrupted send is never blindly repeated.
    const admitted = await p.request('/merchant/delivery-receipt', { method: 'POST', body: receipt });
    if (admitted && admitted.pending === false) {
      delete journal[mark.id]; saveMerchantDeliveryJournal(journal); return false;
    }
    receipt.phase = 'sending'; journal[mark.id] = receipt; saveMerchantDeliveryJournal(journal);
    try {
      await p.merchantSendItem(command.target, slot, mark.item.q || 1);
      receipt.phase = 'confirmed';
    } catch (error) {
      receipt.phase = 'uncertain';
      throw error;
    } finally {
      journal = merchantDeliveryJournal(); journal[mark.id] = receipt; saveMerchantDeliveryJournal(journal);
    }
    await recoverMerchantDeliveryReceipts();
    return true;
  }

  // The recipient equips what the merchant delivered. A delivery and the dashboard's poll can cross on
  // the wire, so the item gets 5 s (20 looks, 250 ms apart) to arrive before the instruction counts as
  // stale. The game refuses a two-handed equip while the offhand is held, so the offhand comes off
  // first and stays in the bag.
  async function equipDeliveredItems(items: any[]): Promise<any[]> {
    const me = character(), results: any[] = [];
    const named = (item: any) => (G as any).items[item.name] && (G as any).items[item.name].name || item.name;
    for (const wanted of items || []) {
      if (!p.isEquipment(wanted)) { results.push({ item: wanted, success: false, error: 'item is not equipment' }); continue; }
      const alreadyEquipped = Object.keys(me.slots || {}).some(equippedSlot => p.sameItemState(me.slots[equippedSlot], wanted));
      if (alreadyEquipped && !me.items.some((item: any) => p.sameItemState(item, wanted))) {
        results.push({ item: wanted, success: true, alreadyEquipped: true });
        continue;
      }
      const slotOf = () => me.items.findIndex((item: any) => p.sameItemState(item, wanted));
      await p.untilGame(OWN_UPDATE, () => slotOf() >= 0, ARRIVAL_MS);
      const slot = slotOf();
      if (slot < 0) {
        bound('ARRIVAL_MS', { item: wanted.name, level: wanted.level || 0 });
        results.push({ item: wanted, success: false, error: 'delivered item did not arrive' });
        p.log('Could not equip delivered ' + wanted.name + ': item did not arrive', 'red');
        continue;
      }
      try {
        const definition = (G as any).items[wanted.name] || {};
        const classDefinition = (G as any).classes && (G as any).classes[me.ctype] || {};
        const twoHanded = definition.wtype && classDefinition.doublehand && classDefinition.doublehand[definition.wtype];
        if (twoHanded && me.slots && me.slots.offhand) await p.unequip('offhand');
        await p.equip(slot);
        const equipped = () => Object.keys(me.slots || {}).some(equippedSlot => p.sameItemState(me.slots[equippedSlot], wanted));
        if (!await p.untilGame(OWN_UPDATE, equipped, ARRIVAL_MS)) {
          bound('ARRIVAL_MS', { item: wanted.name, level: wanted.level || 0, equip: true });
          throw new Error('game did not confirm the equipped item');
        }
        results.push({ item: wanted, success: true });
        p.log('Equipped delivered ' + named(wanted), '#51D2E1');
      } catch (error: any) {
        results.push({ item: wanted, success: false, error: String(error.reason || error.message || error) });
        p.log('Could not equip delivered ' + named(wanted) + ': ' + String(error.reason || error.message || error), 'red');
      }
    }
    return results;
  }

  // A fighter whose bag runs low asks for the merchant's cleanout; looting goes on. One ask is in
  // flight at a time, and once the coordinator answered, the next ask waits for the bag to change.
  let cleanoutAsking = false, cleanoutAnsweredBag: string | null = null;
  const bagSignature = (me: any) => (me.items || []).map((item: any) => item ? item.name + ':' + (item.q || 1) : '').join(',');
  async function requestMerchantCleanout(): Promise<void> {
    const me = character();
    if (me.ctype === 'merchant' || cleanoutAsking || bagSignature(me) === cleanoutAnsweredBag) return;
    cleanoutAsking = true;
    try {
      await p.request('/merchant/cleanout', { method: 'POST', body: { character: me.name } });
      cleanoutAnsweredBag = bagSignature(me);
      p.log('Inventory low; merchant cleanout queued. Looting continues.', '#f0b429');
    } finally {
      cleanoutAsking = false;
    }
  }

  // The cargo the merchant carries across consecutive collection jobs, so it visits the whole party
  // before one bank trip.
  let pendingBank: any[] = [], pendingGold = 0;

  // The merchant's service visit to one member: the bank pickups and the restock, the rendezvous,
  // the deliveries, Merchant's Luck, the collection, the improvements and, at the itinerary's
  // end, the bank trip. The items owner's bank, restock, delivery and improvement calls are
  // ports.
  async function merchantService(command: any): Promise<void> {
    const me = character();
    const activity: any[] = [], deliveredMerchantItems: any[] = [], luckRecipients: string[] = [];
    const handoff = { banked: [] as any[], kept: [] as any[], cleaned: [] as any[], gold: 0, cleanoutRemaining: false };
    const deliveredRestocks: Record<number, boolean> = {}, deliveredWithdrawalsByIndex: Record<number, boolean> = {};
    let deliveredWithdrawals = false, cargoRecorded = false, statScrollsDelivered = false, improvementsCompleted = false;
    let improvedItems: any[] = [], improved = 0, hasDeferredWork = false;
    if (command.cargo && Array.isArray(command.cargo.bank)) {
      pendingBank = command.cargo.bank.slice();
      pendingGold = Number(command.cargo.gold) || 0;
    }
    const meetRecipient = () => bounded('RECIPIENT_MS', { target: command.target, jobId: command.jobId }, () => p.waitForPlayer(command.target, RECIPIENT_MS));
    async function ensureCurrentJob(): Promise<void> {
      try { await p.request('/merchant/job/' + command.jobId); }
      catch (_error) { throw new Error('merchant job was cleared'); }
    }
    function mergeHandoff(next: any): void {
      next = next || {};
      (['banked', 'kept', 'cleaned'] as const).forEach(key => { (next[key] || []).forEach((entry: any) => { handoff[key].push(entry); }); });
      handoff.gold += Number(next.gold) || 0;
      handoff.cleanoutRemaining = handoff.cleanoutRemaining || !!next.cleanoutRemaining;
    }
    async function collectFromTarget(useTemporaryReserve: boolean): Promise<any> {
      await meetRecipient();
      await requestMerchantHandoff('/merchant/handoff', { method: 'POST', body: { jobId: command.jobId, target: command.target,
        capacity: Math.max(0, p.freeInventorySlots() - (useTemporaryReserve ? SWAP_RESERVE : p.protectedSlots())) } });
      // The member's completion writes the receipt on the coordinator; the merchant asks for it at
      // each of its own reports and stays in reach of the member meanwhile.
      let current: any;
      for (;;) {
        current = await p.request('/merchant/job/' + command.jobId);
        if (current.handoffRefused) throw new Error('Handoff refused: ' + current.handoffRefused);
        if (current.handoff) break;
        await meetRecipient();
        await p.nextReport(ageOf('report'));
      }
      mergeHandoff(current.handoff);
      // Incoming sends use the game's first empty slot, including the lucky
      // slot. Clear it at the receipt boundary, before continuing the itinerary.
      await p.tidyLuckySlot();
      return current;
    }
    const deliveries: any[] = [];
    async function deliverToTarget(): Promise<void> {
      for (const deliveryMark of command.merchantDeliveries || []) {
        if (deliveredMerchantItems.indexOf(deliveryMark) >= 0) continue;
        const markedDeliverySlot = Number.isInteger(deliveryMark.slot) && p.sameItem(me.items[deliveryMark.slot], deliveryMark.item)
          ? deliveryMark.slot : p.findItem(deliveryMark.item);
        if (markedDeliverySlot < 0) {
          activity.push({ level: 'info', message: 'Delivery blocked: ' + deliveryMark.item.name + '; continuing collection' });
          continue;
        }
        try {
          if (!await sendReservedMerchantDelivery(command, deliveryMark, markedDeliverySlot)) continue;
        } catch (sendError: any) {
          if (sendError?.code === 'interrupted') throw sendError;
          activity.push({ level: 'error', message: 'Delivery awaiting reconciliation: ' + deliveryMark.item.name,
            details: String(sendError.message || sendError) });
          continue;
        }
        deliveredMerchantItems.push(deliveryMark);
        activity.push({ level: 'success', message: 'Delivered ' + deliveryMark.item.name + ' to ' + command.target });
      }
      for (let d = 0; d < deliveries.length; d += 1) {
        if (deliveredRestocks[d]) continue;
        let deliverySlot = p.findInventoryItemByName(deliveries[d].name);
        if (Number.isInteger(deliveries[d].slot)) {
          // Travel or tidying can move a supplied copy, so the reservations are read again before the
          // send, and the copy sent is one no other job reserves.
          const supplyCheckpoint = await p.offeringCheckpoint(command);
          const supplied = p.availableOfferingEntries(supplyCheckpoint).find((entry: any) =>
            !entry.pack && entry.item.name === deliveries[d].name && (Number(entry.item.q) || 1) >= deliveries[d].quantity);
          deliverySlot = supplied ? supplied.slot : -1;
        }
        // A restock whose supply copy is gone stays undelivered, so the report shows the miss and the
        // next visit restocks.
        if (deliverySlot < 0) {
          activity.push({ level: 'error', message: 'Restock not delivered: no ' + deliveries[d].name + ' for ' + command.target });
          continue;
        }
        await p.merchantSendItem(command.target, deliverySlot, deliveries[d].quantity);
        deliveredRestocks[d] = true;
      }
      for (let r = 0; r < (command.withdrawals || []).length; r += 1) {
        if (deliveredWithdrawalsByIndex[r]) continue;
        const withdrawalSlot = p.findItem(command.withdrawals[r].item);
        if (withdrawalSlot < 0) continue;
        await p.merchantSendItem(command.target, withdrawalSlot, me.items[withdrawalSlot].q || 1);
        deliveredWithdrawalsByIndex[r] = true;
      }
    }
    try {
      await ensureCurrentJob();
      await p.preloadStatScrolls(command, activity);
      // Pick up requested bank items and gold before meeting the character.
      const initialGoldShortage = Number.isInteger(command.goldTarget) ? Math.max(0, command.goldTarget - (command.targetGold || 0)) : 0;
      if ((command.withdrawals || []).length || initialGoldShortage) {
        await p.visitBank(command, activity);
        for (const withdrawal of command.withdrawals || []) {
          const found = p.findBankItem(withdrawal.item, withdrawal.pack, withdrawal.slot);
          if (found) { await p.bankRetrieve(found.pack, found.slot); deliveredWithdrawals = true; }
        }
        if (initialGoldShortage) await p.withdrawCash(Math.min(initialGoldShortage, Number(me.bank && me.bank.gold) || 0), command);
        try { await p.sortBankFloor(activity); }
        catch (deliverySortError: any) {
          activity.push({ level: 'error', message: 'Bank sorting failed after delivery withdrawal',
            details: String(deliverySortError.reason || deliverySortError.message || deliverySortError) });
        }
      }
      const restockSupplies = ['hp', 'mp', 'elixir'].map(kind => {
        const supply = command.restock && command.restock[kind];
        if (!supply || !supply.max) return null;
        return { kind, supply, have: p.statusQuantity(command.targetInventory, supply.item) };
      }).filter(Boolean) as any[];
      // Either low-water mark starts one complete restock. Once the merchant
      // commits to the visit, bring every configured potion up to its maximum.
      if (restockSupplies.some(entry => entry.have <= entry.supply.min)) for (const restockEntry of restockSupplies) {
        const supply = restockEntry.supply, seller = p.itemSeller(supply.item);
        let needed = Math.max(0, supply.max - restockEntry.have);
        if (needed > 0 && restockEntry.kind === 'elixir') {
          const elixirEntries = await p.restockElixirEntries(command, supply.item, needed);
          for (let ei = 0; ei < elixirEntries.length && needed > 0; ei++) {
            const elixirDelivery = Math.min(needed, Number(elixirEntries[ei].item.q) || 1);
            deliveries.push({ name: supply.item, quantity: elixirDelivery, slot: elixirEntries[ei].slot });
            needed -= elixirDelivery;
          }
        } else if (needed > 0 && seller) {
          const buyQuantity = Math.max(0, needed - p.inventoryQuantity(supply.item));
          if (me.gold >= (G as any).items[supply.item].g * buyQuantity) {
            if (buyQuantity) {
              await p.walkToNpc(seller);
              await p.buy(supply.item, buyQuantity);
            }
            deliveries.push({ name: supply.item, quantity: needed });
          } else activity.push({ level: 'error', message: 'Insufficient gold to restock ' + command.target });
        }
      }
      await rendezvous(command.jobId, command.target);
      if (command.expandLeaderCluster) await p.request('/merchant/leader-cluster', { method: 'POST', body: { jobId: command.jobId } });
      if (command.expandMarkedCluster) await p.request('/merchant/marked-cluster', { method: 'POST', body: { jobId: command.jobId } });
      if (command.expandLuckCluster) await p.request('/merchant/luck-cluster', { method: 'POST', body: { jobId: command.jobId } });
      await ensureCurrentJob();
      await meetRecipient();
      try {
        await deliverToTarget();
      } catch (deliveryError: any) {
        const deliveryReason = String(deliveryError.reason || deliveryError.message || deliveryError).toLowerCase();
        if (deliveryReason !== 'send_no_space') throw deliveryError;
        activity.push({ level: 'info', message: command.target + ' was full; collecting items before retrying delivery' });
        await collectFromTarget(true);
        await ensureCurrentJob();
        await meetRecipient();
        await deliverToTarget();
      }
      await p.tidyLuckySlot();
      const luck = p.luck();
      if (command.castMerchantLuck && luck.castsLuck() && (G as any).skills.mluck) {
        if (await luck.castMerchantLuck(me)) {
          luckRecipients.push(me.name);
          activity.push({ level: 'success', message: "Cast Merchant's Luck on " + me.name });
        }
        if (await luck.castMerchantLuck(p.player(command.target))) {
          luckRecipients.push(command.target);
          activity.push({ level: 'success', message: "Cast Merchant's Luck on " + command.target });
        }
      }
      const job = await collectFromTarget(false);
      await ensureCurrentJob();
      if (Number.isInteger(command.goldTarget) && command.goldTarget > 0) {
        await rendezvous(command.jobId, command.target);
        await p.sendGold(command.target, Math.min(command.goldTarget, me.gold));
        deliveredWithdrawals = true;
      }
      handoff.banked.forEach(mark => { pendingBank.push({ owner: command.target, mark }); });
      handoff.cleaned.forEach(mark => { pendingBank.push({ owner: command.target, mark, autoCleanout: true }); });
      pendingGold += handoff.gold;
      cargoRecorded = true;
      if (handoff.gold) activity.push({ level: 'info', message: 'Collected ' + handoff.gold.toLocaleString() + ' gold from ' + command.target });
      const canContinueCollection = !!job.nextCollectionTarget && p.freeInventorySlots() > p.protectedSlots();
      p.collectAfter(canContinueCollection ? COLLECTION_HOLD_MS : 0);
      hasDeferredWork = canContinueCollection && ((command.upgrades || []).length > 0 ||
        (command.purchases || []).length > 0 || (command.compounds || []).length > 0 ||
        (command.autoCompounds || []).length > 0 || (command.statScrolls || []).length > 0);
      if (command.collectionOnly) {
        // Collection ends with retained cargo; processing is separately scheduled on the merchant.
      } else if (hasDeferredWork) {
        activity.push({ level: 'info', message: "Deferred improvements until the Merchant's Luck party itinerary is complete", details: command.target });
      } else {
        statScrollsDelivered = await p.deliverStatScrolls(command, activity);
        await p.prepareManualImprovementScrolls(command, activity);
        improvedItems = await p.improve(command, activity);
        improvementsCompleted = true;
      }
      if (improvedItems.length) {
        await rendezvous(command.jobId, command.target);
        for (improved = 0; improved < improvedItems.length; improved += 1) {
          const improvedSlot = p.findItem(improvedItems[improved]);
          const improvedItem = improvedSlot >= 0 && me.items[improvedSlot];
          if (improvedItem) await p.merchantSendItem(command.target, improvedSlot, improvedItem.q || 1);
        }
      }
      const bankedByCharacter: Record<string, any[]> = {};
      if (!canContinueCollection) {
        const merchantTarget = Number.isInteger(command.merchantGoldTarget) ? command.merchantGoldTarget : 0;
        let goldDeposit = Math.min(pendingGold, Math.max(0, me.gold - merchantTarget));
        // This is the final return leg after servicing the player cluster.
        // Teleport out first, then walk from whichever town Town selected to
        // the bank. Never do this between players in the same itinerary.
        if (pendingBank.length || goldDeposit > 0) {
          await merchantTownReturn(activity);
          await p.visitBank(command, activity);
        }
        for (const pending of pendingBank) {
          const wanted = pending.mark && pending.mark.item ? pending.mark.item : pending.mark;
          const bankSlot = p.findItem(wanted);
          if (bankSlot < 0) continue;
          // With no forced pack, bank_store first merges into a compatible
          // stack across every accessible pack, then uses the first free slot.
          await p.bankStoreFully(bankSlot);
          (bankedByCharacter[pending.owner] ||= []).push(pending.mark);
        }
        pendingBank = [];
        goldDeposit = Math.min(pendingGold, Math.max(0, me.gold - merchantTarget));
        if (goldDeposit > 0) {
          await p.bankDeposit(goldDeposit);
          activity.push({ level: 'success', message: 'Deposited ' + goldDeposit.toLocaleString() + ' collected gold' });
        }
        pendingGold = 0;
      }
      activity.push({ level: 'success', message: 'Serviced ' + command.target });
      await p.request('/merchant/complete', { method: 'POST', body: { jobId: command.jobId, commandId: command.id, success: true,
        banked: bankedByCharacter[command.target] || [], bankedByCharacter,
        kept: handoff.kept,
        cargo: { bank: pendingBank, gold: pendingGold },
        withdrawalsDelivered: deliveredWithdrawals,
        confirmedWithdrawals: (command.withdrawals || []).filter((_: unknown, index: number) => deliveredWithdrawalsByIndex[index]),
        upgradesResolved: !hasDeferredWork && (command.upgrades || []).length > 0,
        upgradeMarksResolved: (command.upgrades || []).filter((mark: any) => (command._offeringWaits || []).indexOf(mark) < 0),
        compoundsResolved: !hasDeferredWork && (command.compounds || []).length > 0,
        statScrollsReady: statScrollsDelivered,
        purchasesResolved: !hasDeferredWork && (command.purchases || []).length > 0,
        autoCompoundsResolved: hasDeferredWork ? [] : command._autoCompoundsResolved || [],
        deferredWork: hasDeferredWork,
        merchantWithdrawalsDelivered: command._merchantWithdrawalsCompleted || [],
        merchantBanked: command._merchantBankedCompleted || [],
        mluckRecipients: luckRecipients,
        merchantDeliveriesDelivered: deliveredMerchantItems, activity } });
    } catch (error: any) {
      // The coordinator retries or advances the itinerary, so the merchant stays its own meanwhile.
      p.collectAfter(COLLECTION_HOLD_MS);
      if (!cargoRecorded) {
        handoff.banked.forEach(mark => { pendingBank.push({ owner: command.target, mark }); });
        handoff.cleaned.forEach(mark => { pendingBank.push({ owner: command.target, mark, autoCleanout: true }); });
        pendingGold += handoff.gold;
      }
      const serviceReason = String(error.reason || error.message || error);
      const movementDeferred = serviceReason === 'hunt_movement_owned';
      const interrupted = error?.code === 'interrupted', anniversary = error?.code === 'merchant_anniversary_reserved';
      activity.push({ level: movementDeferred || anniversary || interrupted ? 'info' : 'error',
        message: movementDeferred ? 'Service deferred until Hunt releases movement' : anniversary ? 'Service paused for anniversary'
          : interrupted ? 'Service interrupted for ' + command.target + '; retrying' : 'Service failed for ' + command.target, details: error.details || serviceReason });
      try {
        await p.request('/merchant/complete', { method: 'POST', body: { jobId: command.jobId, commandId: command.id, success: false,
          failureKind: movementDeferred ? 'hunt_movement_owned' : undefined,
          error: String(error.reason || error.message || error), code: error?.code,
          ...(serviceReason.indexOf('merchant job failed: wrong realm') === 0 ? {
            upgradesResolved: improvementsCompleted,
            compoundsResolved: improvementsCompleted,
            purchasesResolved: improvementsCompleted,
            autoCompoundsResolved: command._autoCompoundsResolved || [],
            statScrollsReady: statScrollsDelivered,
            pendingImprovedDeliveries: improvementsCompleted ? improvedItems.slice(improved).map(item => ({ item })) : [],
          } : {}),
          confirmedWithdrawals: (command.withdrawals || []).filter((_: unknown, index: number) => deliveredWithdrawalsByIndex[index]),
          mluckRecipients: luckRecipients,
          merchantWithdrawalsDelivered: command._merchantWithdrawalsCompleted || [],
          merchantBanked: command._merchantBankedCompleted || [],
          cargo: { bank: pendingBank, gold: pendingGold },
          merchantDeliveriesDelivered: deliveredMerchantItems, activity } });
      } catch (completeError: any) {
        // A cleared job is already terminal; any other failure of the report is logged.
        if (!jobEnded(completeError)) p.log('Service failure report failed: ' + String(completeError?.message || completeError), 'red');
      }
      if (movementDeferred) return;
      throw error;
    }
  }

  // The merchant's Town back to the market before a walk home: the service visit's last leg, the
  // stand return and gathering's rest. It answers whether Town moved the merchant; the caller walks
  // the rest. The stand is already closed: the holder that runs it took the merchant with the stand
  // closed.
  async function merchantTownReturn(activity: any[] | null, owns?: () => boolean): Promise<boolean> {
    const holds = owns || (() => true), me = character(), market = p.market();
    if (!holds() || me.ctype !== 'merchant') return false;
    if (me.map === market.map && Math.hypot(Number(me.x) - market.x, Number(me.y) - market.y) <= HOME_REACH) return false;
    try { await p.stopWalk('smart'); } catch (_stopSmartError) { /* No smart path is active. */ }
    if (!holds()) return false;
    try { await p.stopWalk('move'); } catch (_stopMoveError) { /* No direct movement is active. */ }
    if (!holds()) return false;
    if (p.onCooldown('use_town') || !p.canUse('use_town')) {
      if (activity) activity.push({ level: 'info', message: 'Town unavailable; walking back to town' });
      return false;
    }
    const before = { map: me.map, x: Number(me.x), y: Number(me.y) };
    const relocated = () => me.map !== before.map || Math.hypot(Number(me.x) - before.x, Number(me.y) - before.y) > RELOCATED;
    try {
      await p.townCast();
      // The cast resolves when channeling starts. Wait for the actual
      // relocation before allowing smart_move to replace the channel.
      await p.untilGame(['new_map', ...OWN_UPDATE], () => !holds() || relocated() && !p.transporting(), relocateMs(me));
      if (!holds()) return false;
      if (!relocated()) {
        bound('RELOCATE_MS', { map: me.map, x: Number(me.x), y: Number(me.y) });
        throw new Error('Town did not relocate the merchant');
      }
      if (activity) activity.push({ level: 'success', message: 'Used Town to return from the party' });
      return true;
    } catch (error: any) {
      if (activity) activity.push({ level: 'info', message: 'Town return failed; walking instead', details: String(error.reason || error.message || error) });
      return false;
    }
  }

  // 08 half: the merchant meets a member by the job's word on whom (movement's `errand` walk
  // carries the route, 02), reading the member's report from the job.
  function rendezvous(jobId: string, name: string): Promise<unknown> {
    return bounded('RENDEZVOUS_MS', { target: name, jobId }, () =>
      p.meet(name, RENDEZVOUS_MS, async () => (await p.request('/merchant/job/' + jobId + '?target=' + encodeURIComponent(name))).targetStatus));
  }

  // The merchant joins the giveaways a host offers. The walk goes to the host as the game reports
  // it: the host in view, else the sighting's position, else the market spot a typed host name falls
  // back to. The errand's route leaves the bank as every errand's does. The realm owner refuses a
  // PVP realm on the hop, so the executor keeps no refusal of its own.
  async function merchantJoinGiveaway(command: any): Promise<void> {
    const activity: Array<Record<string, unknown>> = [], me = character();
    function activeGiveaways(seller: any): string[] {
      if (!seller || !seller.slots) return [];
      return Object.keys(seller.slots).filter(slot => {
        const item = seller.slots[slot];
        return slot.indexOf('trade') === 0 && item && item.giveaway && item.rid && (!command.rid || item.rid === command.rid) &&
          (!command.slot || slot === command.slot) &&
          (!command.expectedItem || (item.name === command.expectedItem.name && Number(item.level || 0) === Number(command.expectedItem.level || 0)));
      });
    }
    function hostPosition(): any {
      const seen = p.player(command.seller);
      if (seen && seen.map) return { map: seen.map, x: Number(seen.x), y: Number(seen.y) };
      return command.location && command.location.map ? command.location : p.market();
    }
    try {
      if (command.expiresAt && Date.now() >= command.expiresAt) throw new Error('Giveaway observation expired');
      if (command.realm && p.hop().liveRealm() !== command.realm && await p.hop().jobHop(command, command.realm) === 'yielded') return;
      await p.walk(hostPosition());
      let seller: any = null, slots: string[] = [];
      const found = () => {
        seller = p.player(command.seller);
        slots = activeGiveaways(seller);
        return slots.length > 0 || !!seller && !!command.rid;
      };
      if (!await p.untilGame(ENTITY_UPDATE, found, HOST_LOOK_MS)) bound('HOST_LOOK_MS', { seller: command.seller });
      if (!seller) throw new Error(command.seller + ' was not visible at the market');
      if (!slots.length) throw new Error('No active giveaway was found for ' + command.seller);
      if (Math.hypot(Number(me.x) - Number(seller.x), Number(me.y) - Number(seller.y)) > HOST_REACH)
        await p.walk({ map: me.map, x: Number(seller.x), y: Number(seller.y) });
      let joined = 0;
      for (const slot of slots) {
        if (command.expiresAt && Date.now() >= command.expiresAt) throw new Error('Giveaway observation expired before entry');
        seller = p.player(command.seller);
        if (!seller) throw new Error('Giveaway seller disappeared before entry');
        const item = seller.slots[slot];
        if (!item || !item.giveaway || !item.rid || activeGiveaways(seller).indexOf(slot) < 0) throw new Error('Giveaway changed before entry');
        if (Array.isArray(item.list) && item.list.indexOf(me.name) >= 0) continue;
        // The join asks the call budget's job band first (3.13), and goes out from the merchant job
        // owner's module, as the luck cast does for mluck. A job the coordinator cancelled or replaced
        // during the wait is no longer the intake's current command, so the wait ends with no join.
        const hooks = partyHooks();
        while (hooks.calls.band({ band: 'job', method: 'join_giveaway' }) !== 'send') {
          if (!p.current() || p.lastCommand() !== command.id) return;
          await p.sleep(hooks.calls.window());
        }
        await join_giveaway(seller.name, slot as Parameters<typeof join_giveaway>[1], item.rid);
        joined += 1;
      }
      activity.push({ level: 'success', message: joined ? 'Joined ' + joined + ' giveaway' + (joined === 1 ? '' : 's') + ' from ' + seller.name
        : "Already entered " + seller.name + "'s giveaway" });
      await p.request('/merchant/complete', { method: 'POST', body: { jobId: command.jobId, success: true, activity } });
    } catch (error: any) {
      try {
        await p.request('/merchant/complete', { method: 'POST', body: { jobId: command.jobId, success: false, error: String(error.reason || error.message || error), code: error?.code,
          activity: activity.concat([{ level: 'error', message: 'Giveaway entry failed', details: String(error.reason || error.message || error) }]) } });
      } catch (completeError: any) {
        // A cleared job is already ended; any other failure of the report is logged.
        if (!jobEnded(completeError)) p.log('Giveaway failure report failed: ' + String(completeError?.message || completeError), 'red');
      }
      throw error;
    }
  }

  // The `equip-deliveries` command: the delivered items are equipped and each result, with its
  // delivery id, reported to the coordinator.
  async function equipDeliveries(command: { id?: number; items?: any[]; deliveryIds?: unknown[] }): Promise<void> {
    const results = await equipDeliveredItems(command.items || []);
    results.forEach((result, index) => { if (command.deliveryIds) result.deliveryId = command.deliveryIds[index]; });
    await p.request('/equip-delivery-complete', { method: 'POST', body: { character: character().name, commandId: command.id, results } });
  }
  // The giveaway door (`giveaway.join`): the add-on names the seller and
  // the slot of an open giveaway in reach, and the merchant joins it once. The bound reads the
  // seller as the game reports it, as merchantJoinGiveaway does.
  async function joinGiveawayDoor(args: Readonly<Record<string, unknown>>, band: MerchantDoorBand): Promise<MerchantDoorAnswer> {
    const refused = (reason: string): MerchantDoorAnswer => ({ outcome: 'refused', by: '08', reason }), me = character();
    const seller = typeof args.seller === 'string' ? p.player(args.seller) : null, slot = String(args.slot ?? '');
    if (!seller) return refused(`${String(args.seller)} is not visible`);
    const item = slot.indexOf('trade') === 0 ? seller.slots?.[slot] : null;
    if (!item || !item.giveaway || !item.rid) return refused(`${seller.name} has no open giveaway in ${slot}`);
    if (me.map !== seller.map || Math.hypot(Number(me.x) - Number(seller.x), Number(me.y) - Number(seller.y)) > HOST_REACH) return refused(`${seller.name} is out of reach`);
    if (Array.isArray(item.list) && item.list.indexOf(me.name) >= 0) return { outcome: 'sent', reply: 'already entered' };
    const hooks = partyHooks();
    if (band === 'background' && hooks.calls.band({ band, method: 'join_giveaway' }) !== 'send') return refused(BACKGROUND_REFUSED);
    while (band === 'job' && hooks.calls.band({ band: 'job', method: 'join_giveaway' }) !== 'send') await p.sleep(hooks.calls.window());
    return { outcome: 'sent', reply: await join_giveaway(seller.name, slot as Parameters<typeof join_giveaway>[1], item.rid) };
  }
  ((globalThis as { __partyMerchantDoors?: MerchantDoors }).__partyMerchantDoors ??= {}).joinGiveaway = joinGiveawayDoor;
  const visits = { withMerchantHandoffRecovery, assertMerchantContinuation, requestMerchantHandoff, waitForHandoffSendWindow, merchantHandoff, merchantOrderHandoff,
    applyMerchantVisibility, merchantVisibilityActive, nearbyGiveaways, rendezvous, merchantJoinGiveaway, requestMerchantCleanout, merchantService, merchantTownReturn,
    recoverMerchantDeliveryReceipts, sendReservedMerchantDelivery, equipDeliveredItems, equipDeliveries };
  live = visits;
  return visits;
}

// The door shared.js reaches (3.1: `globalThis.partyMerchant`): the job owner's character half, with
// the anniversary control the events owner's merchant row asks (events/character/merchant.ts
// `control`) and the invisibility window the turns skill runtime holds Invis behind
// (`visibilityActive`).
const merchant = ((globalThis as any).partyMerchant ||= {});
merchant.jobs = Object.assign(merchant.jobs || {}, { visits: createMerchantVisits, isPersonalTracker, anniversaryControl: merchantAnniversaryControl,
  untilGame, nextOwnReport,
  visibilityActive: (): boolean => !!live?.merchantVisibilityActive() });
