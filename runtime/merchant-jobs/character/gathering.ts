// The merchant job owner's gathering on the character:
// fishing and mining as a holder of the runner's one record. An attempt takes the
// record as the holder `gathering` with its phase (`travel`, `cast`, `restoring`, `rest`) and lets it
// go when the attempt ends, so a job, a hop or a running command finds the merchant held and
// gathering finds them holding it. A command meets the holder at `handoff`: a cast holds a job command
// until the cast ends, and any other command ends the attempt and takes the record on its
// release. shared.js builds it at load over one-line reads of other owners
// (`gatheringPorts()`); the moved code is shared.js's own JavaScript, so those reads are untyped here.
//
// The hands' tool choice, equip and restore are the hands owner's (runtime/merchant-hands/, 3.11); the
// attempt reaches them through its ports.
import { partyHooks } from '../../hooks/index.ts';
import type { GatheringHolder, MerchantRunner } from './runner.ts';
import { itemFailure, exchangeKey } from '../../items/api.ts';
import { scope } from '../../lifecycle/api.ts';
import { boundFired } from '../../status/api.ts';
import { AT_STAND } from '../rules.ts';
import { OWN_UPDATE, untilGame } from './game-wait.ts';

export type GatheringPorts = Record<string, any>;

// A failed attempt waits for its cause to clear: the level gate for the merchant's level. A travel,
// approach or settle failure has no game answer that says it cleared, so FAILURE_RETRY_MS bounds that
// wait and its firing goes to the status owner's bound record.
const FAILURE_RETRY_MS = 15_000;
// The game's timing inside one action (3.12): the catch event and its bag update can land on adjacent
// turns (250 ms); the last movement packet can still be live after a route resolves, so the cast
// waits for 500 ms of stillness within 6 s; the stand opens 350 ms after a Town return, since the
// server refuses it as `cant_equip` while the equip packet settles.
const CATCH_JOIN_MS = 250, SETTLE_STILL_MS = 500, SETTLE_WITHIN_MS = 6_000, STAND_AFTER_TOWN_MS = 350;
// The cast outcome's bounds on an older client (3.12): the channel or the cooldown shows within
// 1.5 s, the channel ends within the skill's duration_max plus 5 s, and a success's cooldown shows
// within 1.5 s of the channel's end. A missing reuse_cooldown reads as 60 s.
const CAST_APPEAR_MS = 1_500, CAST_OVERRUN_MS = 5_000, CAST_SETTLE_MS = 1_500, COOLDOWN_FALLBACK_MS = 60_000;
// SETTLE_WITHIN_MS, CAST_OVERRUN_MS and COOLDOWN_FALLBACK_MS are kept bounds against the game: each
// firing goes to the status owner's bound record (status/character/bounds.ts).
const bound = (name: string, state: Record<string, unknown>) => boundFired({ bound: name, owner: '08', state });
// The waits that put a line on the merchant's card, as on b9b5c91e.
const NAMED_WAITS = ['merchant job', 'stand operation', 'banking', 'anniversary reservation', 'upgrading', 'departure pending'];

export function createGathering(p: GatheringPorts) {
  const runner: MerchantRunner = p.runner();
  const root = p.root();
  let mode: string | null = null, modes: string[] = [], autoCraft: Record<string, boolean> = {}, standListings: any[] = [];
  // The tick is the merchant jobs owner's `act` registration: it holds with the
  // character, and the generation's stop removes it, so no record of it stays on the window.
  const act = scope('08', 'act');
  let timer: number | null = null, retry: (() => boolean) | null = null, lastStatus: string | null = null, waitMessage: string | null = null;
  // The tool order the hands placed, held until its job reports (holdForOrder below).
  let toolOrder: { jobId: string; tool: string } | null = null;
  // The cooldown end the last cooldown notice named.
  let noticedCooldown = 0;
  // The job command a cast deferred: it waits in the slot and takes the merchant at the cast's end
  //, so no attempt starts while the coordinator still holds it there undelivered.
  let deferred: number | null = null;
  let session: any = root.__merchantGatheringSession || null;
  const cooldowns: Record<string, number> = root.__merchantGatheringCooldowns ||= { fishing: 0, mining: 0 };
  // A code reload ends the old runtime's attempt; its release lets the new runtime's tick take over.
  const left = runner.record();
  if (left && left.kind === 'gathering') { left.cancelled = 'code reload'; stopAttempt(); }
  // A cancelled attempt's stop that fails leaves the merchant walking, so its line says why.
  function stopAttempt(): void {
    Promise.resolve(p.stop()).catch((error: any) => gatheringStatus('Gathering stop failed', 'warning', String(error?.reason || error?.message || error)));
  }

  // The merchant coming free runs the gathering pass at once: the mode choice a holder
  // deferred, then the tick.
  runner.whenFree(() => { selectGatheringMode(); wakeGatheringAfterStatus(); });

  function attempt(): GatheringHolder | null { const held = runner.record(); return held && held.kind === 'gathering' ? held as GatheringHolder : null; }
  function active(): boolean { return !!attempt(); }
  const label = (m: string | null) => m === 'fishing' ? 'Fishing' : 'Mining';

  function serverCooldownUntil(m: string): number {
    const value = p.parent().next_skill && p.parent().next_skill[m];
    if (!value) return 0;
    const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
  }
  function syncGatheringCooldown(m: string): number {
    const observed = serverCooldownUntil(m);
    if (observed > (Number(cooldowns[m]) || 0)) cooldowns[m] = observed;
    return Number(cooldowns[m]) || 0;
  }
  function hasGatheringAccess(m: string): boolean { return !!(p.parent().quirks && p.parent().quirks[m]); }

  // Walkable points beside the gathering zones of G.maps. Mining stands in the east corridor beside
  // the ore polygon: the skill targets the adjacent zone, and points inside it are collision geometry.
  function gatheringDestination(m: string) {
    return m === 'fishing' ? { map: 'main', x: -1597, y: 552 } : { map: 'tunnel', x: 277, y: -96 };
  }

  // A status line goes out when it changes; `repeat` sends each outcome line, which repeats by design.
  function gatheringStatus(message: string, level?: string, details?: unknown, repeat?: boolean): void {
    if (!repeat && lastStatus === message) return;
    lastStatus = message;
    p.request('/merchant/gather-status', { method: 'POST', body: {
      character: p.character().name, mode, message, level: level || 'info', details: details || null,
    } }).catch(() => { /* Reporting never stops gathering. */ });
  }

  function gatheringBaseline(): Array<{ item: any; quantity: number }> {
    const baseline: Array<{ item: any; quantity: number }> = [], c = p.character();
    function add(item: any) {
      if (!item) return;
      const existing = baseline.find(entry => p.sameItem(entry.item, item));
      if (existing) existing.quantity += p.itemQuantity(item);
      else baseline.push({ item: p.fingerprint(item), quantity: p.itemQuantity(item) });
    }
    c.items.forEach(add);
    // Equipping the tool moves the weapons into the bag; they are not a catch.
    add(c.slots && c.slots.mainhand);
    add(c.slots && c.slots.offhand);
    return baseline;
  }

  function gatheringInventoryTotals(): Record<string, { item: any; quantity: number }> {
    const totals: Record<string, { item: any; quantity: number }> = {};
    p.character().items.forEach((item: any) => {
      if (!item) return;
      const key = exchangeKey(item.name, item.level);
      if (!totals[key]) totals[key] = { item: p.fingerprint(item), quantity: 0 };
      totals[key].quantity += p.itemQuantity(item);
    });
    return totals;
  }

  /** Whether a finished channel succeeded. Current clients resolve the cast with `found`; older
   *  ones resolve when the channel starts, so wait for it to end and read the game's cooldown,
   *  which the server starts (skill_timeout) only on a success. */
  async function gatheringOutcome(m: string, result: any, castAt: number, current: () => boolean): Promise<boolean> {
    if (result && typeof result.found === 'boolean') return result.found;
    const c = p.character();
    const channelling = () => !!(c.c && c.c[m]);
    // The character's update shows the channel (`c[m]`) and the `eval` packet the cooldown.
    await untilGame(act, OWN_UPDATE, () => channelling() || serverCooldownUntil(m) > castAt || !current(), CAST_APPEAR_MS);
    if (!current()) return false;
    const end = castAt + (Number((G as any).skills[m] && (G as any).skills[m].duration_max) || 15000) + CAST_OVERRUN_MS;
    await untilGame(act, OWN_UPDATE, () => !channelling() || !current(), Math.max(0, end - Date.now()));
    if (!current()) return false;
    if (channelling()) bound('CAST_OVERRUN_MS', { mode: m, castAt });
    await untilGame(act, OWN_UPDATE, () => serverCooldownUntil(m) > Date.now() || !current(), CAST_SETTLE_MS);
    if (!current()) return false;
    return serverCooldownUntil(m) > Date.now();
  }

  // Gathering's notices: each phase of the attempt's holder,
  // and each cast's catch or miss.
  function tell(notice: 'merchant.gathering.phase' | 'merchant.gathering.cast', payload: Record<string, unknown>): void {
    partyHooks().notify(notice, { character: p.character().name, ...payload, by: 'core:merchant-jobs' });
  }
  function phase(holder: GatheringHolder, next: GatheringHolder['phase']): void {
    holder.phase = next;
    tell('merchant.gathering.phase', { mode: holder.mode, phase: next });
  }
  async function reportGatheringResult(m: string, before: Record<string, { quantity: number }>, result: any, current: () => boolean): Promise<void> {
    const fishing = m === 'fishing';
    tell('merchant.gathering.cast', { mode: m, outcome: result && result.found === false ? 'miss' : 'catch' });
    if (result && result.found === false) {
      gatheringStatus(fishing ? "Didn't catch anything" : "Didn't mine anything", 'info', null, true);
      return;
    }
    await p.sleep(CATCH_JOIN_MS);
    if (!current()) return;
    const after = gatheringInventoryTotals(), gains: Array<{ item: any; quantity: number }> = [];
    Object.keys(after).forEach(key => {
      const quantity = after[key].quantity - (before[key] && before[key].quantity || 0);
      if (quantity > 0) gains.push({ item: after[key].item, quantity });
    });
    if (!gains.length) {
      gatheringStatus(fishing ? 'Caught an item' : 'Mined an item', 'success', result || null, true);
      return;
    }
    const message = gains.map(gain => {
      const name = (G as any).items[gain.item.name] && (G as any).items[gain.item.name].name || gain.item.name;
      return (gain.quantity > 1 ? gain.quantity + ' × ' : '') + name + ((gain.item.level || 0) > 0 ? ' +' + gain.item.level : '');
    }).join(', ');
    gatheringStatus((fishing ? 'Caught ' : 'Mined ') + message, 'success', null, true);
  }

  async function settleBeforeGathering(current: () => boolean): Promise<void> {
    const c = p.character();
    await p.stop('smart');
    if (p.moving()) await p.stop('move');
    // Stillness counts from the last position the character's update moved; with no update since,
    // the wait ends SETTLE_STILL_MS after it.
    let stillSince = Date.now(), previousX = Number(c.x), previousY = Number(c.y);
    const settled = () => {
      if (!current()) return true;
      const x = Number(c.x), y = Number(c.y);
      if (p.moving() || Math.abs(x - previousX) >= 0.05 || Math.abs(y - previousY) >= 0.05) stillSince = Date.now();
      previousX = x;
      previousY = y;
      return !p.moving() && Date.now() - stillSince >= SETTLE_STILL_MS;
    };
    const still = await untilGame(act, OWN_UPDATE, settled, SETTLE_WITHIN_MS, () => stillSince + SETTLE_STILL_MS);
    if (!current()) throw itemFailure('interrupted');
    if (still) return;
    bound('SETTLE_WITHIN_MS', { x: Number(c.x), y: Number(c.y), map: c.map });
    throw new Error('movement did not settle at gathering spot');
  }

  function baselineAmount(s: any, item: any): number {
    const entry = (s.baseline || []).find((candidate: any) => p.sameItem(candidate.item, item));
    return entry ? entry.quantity : 0;
  }

  // What the session caught since its baseline, by item.
  function sessionGains(s: any): Array<{ item: any; quantity: number }> {
    const gains: Array<{ item: any; quantity: number }> = [];
    p.character().items.forEach((item: any) => {
      if (!item || gains.some(gain => p.sameItem(gain.item, item))) return;
      const gained = p.inventoryAmount(item) - baselineAmount(s, item);
      if (gained > 0) gains.push({ item: p.fingerprint(item), quantity: gained });
    });
    return gains;
  }

  async function depositGatheringGains(s: any, current: () => boolean): Promise<number> {
    const c = p.character(), gains = sessionGains(s);
    if (!gains.length) return 0;
    gatheringStatus('Gathering inventory nearly full; banking new drops', 'info');
    await p.smartMove('bank');
    if (!current()) return 0;
    let deposited = 0;
    // Whole new stacks first, which makes room to split gains merged into old stacks.
    gains.sort((a, b) => baselineAmount(s, a.item) - baselineAmount(s, b.item));
    for (const gain of gains) {
      let remaining = gain.quantity;
      while (remaining > 0) {
        if (!current()) return deposited;
        const slot = p.findItem(gain.item);
        if (slot < 0) break;
        const stackQuantity = p.itemQuantity(c.items[slot]);
        if (!Math.max(0, stackQuantity - remaining)) {
          await p.bankStoreFully(slot);
          deposited += stackQuantity;
          remaining -= stackQuantity;
          continue;
        }
        if (p.freeSlots() < 1) break;
        const before = c.items.map((item: any) => JSON.stringify(p.fingerprint(item)));
        const splitQuantity = remaining;
        // The split is the items owner's call (rows/10-items.ts ACTIONS item.split), which asks the job band first.
        await p.split(slot, splitQuantity);
        await p.sleep(CATCH_JOIN_MS);
        if (!current()) return deposited;
        const splitSlot = c.items.findIndex((item: any, index: number) => before[index] !== JSON.stringify(p.fingerprint(item)) &&
          p.sameItem(item, gain.item) && p.itemQuantity(item) === splitQuantity);
        if (splitSlot < 0 || splitSlot === slot) break;
        await p.bankStoreFully(splitSlot);
        deposited += splitQuantity;
        remaining = 0;
      }
    }
    s.baseline = gatheringBaseline();
    const sortActivity: Array<{ message: string }> = [];
    try {
      await p.sortBankFloor(sortActivity);
      if (sortActivity.length) gatheringStatus(sortActivity[sortActivity.length - 1].message, 'success');
    } catch (sortError: any) {
      gatheringStatus('Bank sorting failed after gathering deposit', 'error', String(sortError.reason || sortError.message || sortError));
    }
    gatheringStatus('Banked ' + deposited + ' newly gathered item' + (deposited === 1 ? '' : 's'), 'success');
    return deposited;
  }

  // The merchant rests at its open stand through a cooldown when the stand is open at the market
  // point, the tool is out of the hands, and the stand shows the listings the rest opened it with
  // (`restListings`, null when the merchant is not resting).
  function atMarket(): boolean {
    const c = p.character(), market = p.market();
    return c.map === market.map && Math.hypot(c.x - market.x, c.y - market.y) <= AT_STAND;
  }
  function resting(s: any): boolean {
    const c = p.character();
    return !!c.stand && atMarket() && !(c.slots && c.slots.mainhand && c.slots.mainhand.name === s.tool) && s.restListings === JSON.stringify(standListings);
  }

  // Why the tick does not take the merchant now. The record answers for the job, the hop, a running
  // command, another attempt, a service itinerary between its legs and a stand return still walking
  // or listing; a stand open for trades lets an attempt take the merchant. The
  // other facts are owners' with no character holder yet, read unchanged: the items owner's banking and upgrade,
  // The events owner's departure and anniversary, the bag at the reserve and a dead merchant.
  function waitReason(): string | null {
    const held = runner.record(), c = p.character();
    if (held && !(held.kind === 'idle' && held.phase === 'open')) return held.kind === 'job' ? 'merchant job' : held.kind === 'realm' ? 'realm hop' :
      held.kind === 'gathering' ? 'active gathering attempt' : held.kind === 'collection' ? 'logistics handoff' :
      held.kind === 'idle' ? 'stand operation' : 'command ' + held.type;
    if (deferred !== null) {
      const slot = p.slotCommand();
      if (slot && Number(slot.id) === deferred && deferred > p.lastCommand()) return 'deferred command';
      deferred = null;
    }
    if (p.banking()) return 'banking';
    if (p.anniversaryReserved()) return 'anniversary reservation';
    if (retry && !retry()) return 'retry delay';
    retry = null;
    if (toolOrderPending()) return 'tool order';
    if (p.upgrading()) return 'upgrading';
    if (p.departurePending()) return 'departure pending';
    if (c.rip) return 'dead';
    // A bag at the reserve with the session's catch in it banks the catch; a bag full of
    // other items waits for the job owner's bank work.
    if (p.freeSlots() <= p.protectedSlots() && !(session && sessionGains(session).length)) return 'inventory capacity';
    return null;
  }

  async function gatheringTick(): Promise<void> {
    if (!mode || p.maintenance()) return;
    const wait = waitReason();
    root.__merchantGatheringBlockedReason = wait;
    if (wait) {
      if (NAMED_WAITS.indexOf(wait) >= 0 && waitMessage !== wait) {
        waitMessage = wait;
        gatheringStatus(label(mode) + ' waiting for ' + wait, 'info');
      }
      return;
    }
    waitMessage = null;
    const m = mode, s = session, c = p.character();
    let release!: () => void;
    const holder: GatheringHolder = { kind: 'gathering', id: Date.now() + ':' + Math.random().toString(36).slice(2), mode: m,
      phase: 'travel', owner: runner.runtimeId, startedAt: Date.now(), cancelled: null, done: new Promise<void>(resolve => { release = resolve; }) };
    // The rest at the open stand needs no holder: the next tick reads it from the game again.
    s.cooldownUntil = Math.max(Number(s.cooldownUntil) || 0, syncGatheringCooldown(m));
    const cooling = s.cooldownUntil > Date.now() || p.onCooldown(m);
    if (cooling && resting(s)) return;
    if (!runner.take(holder, true)) return;
    tell('merchant.gathering.phase', { mode: m, phase: holder.phase });
    // Each await ends here, and its result goes on only while this attempt still holds the merchant.
    const current = () => runner.record() === holder && !holder.cancelled && !p.anniversaryReserved();
    try {
      // The game's skill record holds the level gate: G.skills.fishing and .mining both read level 16.
      const needed = Number((G as any).skills[m] && (G as any).skills[m].level) || 0;
      if (c.level < needed) throw new Error('Gathering requires merchant level ' + needed);
      // The attempt starts with the stand closed, but a cooldown at the market, where the stand
      // return lists the open stand in place.
      if (!cooling || !atMarket() || p.freeSlots() <= p.protectedSlots()) await runner.leaveStand();
      if (p.freeSlots() <= p.protectedSlots()) {
        await depositGatheringGains(s, current);
        if (!current() || p.freeSlots() <= p.protectedSlots()) return;
      }
      const destination = gatheringDestination(m);
      if (cooling) {
        phase(holder, 'restoring');
        gatheringStatus(label(m) + ' cooling down; returning to stand', 'info');
        // A failed restore or stand return stays in its phase, and the next tick tries again.
        if (!await p.restoreEquipment(current) || !current()) return;
        phase(holder, 'rest');
        // Gathering spots can be several maps away: the merchant's Town return comes before the walk
        // to the market.
        await p.townReturn(current);
        if (!current()) return;
        await p.sleep(STAND_AFTER_TOWN_MS);
        if (!current()) return;
        const listings = JSON.stringify(standListings);
        try { await p.standReturn(standListings, current); } catch (standError: any) {
          gatheringStatus('Stand return failed during the cooldown rest', 'warning', String(standError?.reason || standError?.message || standError));
          return;
        }
        if (current()) s.restListings = listings;
        return;
      }
      s.restListings = null;
      if (!await p.ensureTool(s, current)) return;
      if (!current()) return;
      // The map spawn comes first: the pathfinder can exhaust its cross-map search when asked for the
      // tunnel transition and an exact interior point in one pass, answering only {reason:"failed"}.
      if (c.map !== destination.map) {
        gatheringStatus('Going ' + m + ' · travelling to ' + destination.map, 'info');
        try { await p.smartMove(destination.map); }
        catch (travelError: any) { throw { reason: 'travel_to_' + destination.map + ':' + String(travelError.reason || travelError.message || travelError) }; }
        if (!current()) return;
      }
      if (Math.hypot(c.x - destination.x, c.y - destination.y) > 1) {
        gatheringStatus('Going ' + m + ' · approaching gathering spot', 'info');
        try { await p.smartMove(destination, { arrivalTolerance: 1 }); }
        catch (approachError: any) { throw { reason: 'approach_spot:' + String(approachError.reason || approachError.message || approachError) }; }
        if (!current()) return;
      }
      await settleBeforeGathering(current);
      if (!current()) return;
      if (c.map !== destination.map || Math.hypot(c.x - destination.x, c.y - destination.y) > 1)
        throw new Error('approach_spot:arrival outside gathering tolerance');
      // The travel gear (the broom's speed) stays on until arrival.
      await p.equipTool(s, current);
      if (!current()) return;
      if (p.freeSlots() <= p.protectedSlots()) return;
      if (!p.onCooldown(m) && p.canUse(m)) {
        const beforeGathering = gatheringInventoryTotals();
        gatheringStatus(m === 'fishing' ? 'Fishing…' : 'Mining…', 'info');
        phase(holder, 'cast');
        // The cast asks the call budget's job band first (3.13); a "not now" waits for the call
        // window and is the cast's own wait, inside the attempt.
        const hooks = partyHooks();
        while (hooks.calls.band({ band: 'job', method: m }) !== 'send') {
          await p.sleep(hooks.calls.window());
          if (!current()) return;
        }
        const castAt = Date.now();
        const gatheringResult = await use_skill(m as any);
        if (!current()) return;
        const caught = await gatheringOutcome(m, gatheringResult, castAt, current);
        if (!current()) return;
        await reportGatheringResult(m, beforeGathering, { found: caught }, current);
        if (!current()) return;
        // The server starts the reuse cooldown (skill_timeout) only on a success; a miss costs MP and
        // can be cast again at once.
        const serverCooldown = serverCooldownUntil(m);
        s.cooldownUntil = !caught ? 0 : serverCooldown > Date.now() ? serverCooldown :
          Date.now() + (Number((G as any).skills[m] && (G as any).skills[m].reuse_cooldown) || 0);
        cooldowns[m] = s.cooldownUntil;
        phase(holder, 'travel');
        if (p.freeSlots() <= p.protectedSlots()) {
          await depositGatheringGains(s, current);
          if (current()) await p.smartMove(destination);
        }
      }
    } catch (error: any) {
      if (!current()) return;
      if (error && (error.reason === 'cooldown' || error.message === 'cooldown')) {
        const reportedCooldown = Number(error.ms || error.cooldown || error.remaining);
        // The server's own cooldown answer, else the skill's reuse_cooldown, else COOLDOWN_FALLBACK_MS (3.12).
        const reuse = Number((G as any).skills[m] && (G as any).skills[m].reuse_cooldown);
        if (!(reportedCooldown > 0) && !reuse) bound('COOLDOWN_FALLBACK_MS', { mode: m, error: String(error.reason || error.message) });
        s.cooldownUntil = Math.max(serverCooldownUntil(m), Date.now() + (reportedCooldown > 0 ? reportedCooldown : reuse || COOLDOWN_FALLBACK_MS));
        cooldowns[m] = s.cooldownUntil;
        gatheringStatus(label(m) + ' cooldown detected; returning to stand', 'info');
        return;
      }
      const reason = String(error && (error.reason || error.message) || error);
      if (reason === 'moving' || /(^|:)interrupted$/.test(reason)) {
        // The next tick tries again (3.12: the 1 s retry is the next tick).
        s.cooldownUntil = syncGatheringCooldown(m);
        gatheringStatus(label(m) + ' interrupted during ' + holder.phase + ': ' + (reason === 'moving' ? 'movement' : 'unknown cause') + '; retrying', 'info',
          { attemptId: holder.id, reason, moving: !!c.moving }, true);
        return;
      }
      gatheringStatus(label(m) + ' attempt failed: ' + reason, 'error',
        { reason, mode: m, position: { map: c.map, x: c.x, y: c.y }, destination: gatheringDestination(m),
          distance: Math.hypot(c.x - gatheringDestination(m).x, c.y - gatheringDestination(m).y), access: hasGatheringAccess(m) }, true);
      const needed = Number((G as any).skills[m] && (G as any).skills[m].level) || 0;
      if (c.level < needed) retry = () => c.level >= needed;
      else {
        const at = Date.now() + FAILURE_RETRY_MS;
        retry = () => {
          if (Date.now() < at) return false;
          bound('FAILURE_RETRY_MS', { mode: m, reason });
          return true;
        };
      }
      p.log(m + ' failed: ' + (error.reason || error.message || error), 'red');
    } finally {
      if (holder.cancelled) gatheringStatus(label(m) + ' paused during ' + holder.phase + ': ' + holder.cancelled, 'info', { attemptId: holder.id }, true);
      runner.release(holder);
      release();
      if (holder.cancelled !== 'code reload') selectGatheringMode();
    }
  }

  // A command meets the gathering holder before the intake accepts it (the hands owner's place for
  // `hands.settle`); runner.accept never sends it a `merchant-gather`. A cast holds a job command, which
  // stays in the slot and goes next, and yields at once to any other command, a force stand or an
  // anniversary reservation. Otherwise the attempt ends and hands the record to the command.
  async function meetCommand(command: any): Promise<boolean> {
    const held = attempt();
    if (!held) return true;
    const override = !/^merchant-/.test(command.type) || p.forceStand() || p.anniversaryReserved();
    if (held.phase === 'cast' && !override) {
      deferred = Number(command.id);
      p.reportCommand(command, 'deferred', 'finishing ' + held.mode + ' cast');
      return false;
    }
    held.cancelled = 'command ' + command.type;
    runner.holdCommand(command);
    await p.stop();
    await held.done;
    return true;
  }

  function wakeGatheringAfterStatus(): void {
    if (p.character().ctype === 'merchant' && mode && p.current()) gatheringTick();
  }

  function selectGatheringMode(): void {
    const enabled: string[] = modes.filter(m => m === 'fishing' || m === 'mining');
    const held = attempt();
    if (held && held.owner === runner.runtimeId) {
      if (enabled.indexOf(held.mode) < 0) {
        held.cancelled = 'gathering disabled';
        stopAttempt();
      }
      return;
    }
    // The mode choice is a gathering step: it waits under any other holder, so no session
    // takes its catch baseline or swaps tools while a command moves items. A stand left open for
    // trades holds nothing a gathering attempt cannot end.
    const holding = runner.record();
    if (holding && !(holding.kind === 'idle' && holding.phase === 'open')) return;
    if (!enabled.length) { if (mode) setGathering(null); return; }
    const ready = enabled.filter(m => syncGatheringCooldown(m) <= Date.now() && !p.onCooldown(m));
    const choice = ready[0] || enabled.slice().sort((a, b) => syncGatheringCooldown(a) - syncGatheringCooldown(b))[0];
    if (choice !== mode) setGathering(choice);
  }

  function setGathering(next: string | null): void {
    if (next === mode && timer) return;
    const oldSession = session;
    mode = next;
    halt();
    lastStatus = null;
    if (!next) {
      session = root.__merchantGatheringSession = null;
      // The hands go back to normal under a gathering holder in its `restoring` phase, so no command
      // runs beside the swap; a holder already there met `settle`, which restored them.
      let done!: () => void;
      const restoring: GatheringHolder = { kind: 'gathering', id: 'restore:' + Date.now(), mode: oldSession ? oldSession.mode : '', phase: 'restoring',
        owner: runner.runtimeId, startedAt: Date.now(), cancelled: null, done: new Promise<void>(resolve => { done = resolve; }) };
      if (runner.take(restoring)) p.restoreEquipment(() => !mode && runner.record() === restoring && !restoring.cancelled)
        .catch(() => { /* The restore reports its own status. */ }).finally(() => { runner.release(restoring); done(); });
      return;
    }
    // The hands owner keeps the normal record; the session keeps the mode's tool, its catch
    // baseline and its cooldown.
    if (!oldSession || oldSession.mode !== next)
      session = root.__merchantGatheringSession = { mode: next, tool: (G as any).skills[next].wtype[0],
        baseline: gatheringBaseline(), cooldownUntil: Number(cooldowns[next]) || 0 };
    // The cooldown notice is written once per cooldown, keyed by the game's cooldown end.
    const until = Number(session.cooldownUntil) || 0;
    if (!runner.holder() && until > Date.now()) {
      if (noticedCooldown !== until) { noticedCooldown = until; gatheringStatus(label(next) + ' cooling down; will resume automatically', 'info', undefined, true); }
    } else if (!runner.holder()) gatheringStatus('Preparing to go ' + next, 'info');
    gatheringTick();
    timer = act.setInterval(() => { gatheringTick(); }, 2000);
  }

  // The tick's 2 s timer stops: a new mode starts its own, and a retired runtime keeps none.
  function halt(): void {
    act.clearInterval(timer);
    timer = null;
  }

  // The coordinator's reply: the modes, the replacement-craft opt-in, the stand listings and the saved
  // cooldowns, each applied as b9b5c91e applied it.
  function receive(state: any): void {
    autoCraft = state.gatheringAutoCraft || {};
    standListings = state.standListings || standListings;
    if (state.gatheringCooldowns) {
      ['fishing', 'mining'].forEach(m => {
        const persisted = Number(state.gatheringCooldowns[m]) || 0;
        if (persisted > (Number(cooldowns[m]) || 0)) cooldowns[m] = persisted;
      });
      if (session && session.mode) session.cooldownUntil = Math.max(Number(session.cooldownUntil) || 0, Number(cooldowns[session.mode]) || 0);
    }
    const enabled = Array.isArray(state.gatheringModes) ? state.gatheringModes : [];
    if (JSON.stringify(enabled) !== JSON.stringify(modes)) modes = enabled.slice();
    selectGatheringMode();
  }
  function choose(next: string[]): void { modes = next.slice(); selectGatheringMode(); }

  // The merchant's report: what holds, the phase and the cooldowns.
  function report() {
    const held = attempt();
    return {
      gatheringActive: !!held, gatheringBlockedReason: root.__merchantGatheringBlockedReason || null,
      gatheringPhase: held ? held.phase : 'idle', gatheringAttemptId: held ? held.id : null,
      gatheringCooldowns: { fishing: Number(cooldowns.fishing) || 0, mining: Number(cooldowns.mining) || 0 },
      gatheringAccess: { fishing: hasGatheringAccess('fishing'), mining: hasGatheringAccess('mining') },
    };
  }

  // The hands' tool look reads these: the opt-in to craft a missing tool, and the hold on its order
  // (I-12). Gathering holds until the runner reports the order's job (its command reached the
  // merchant) or the tool is in the bag, so the next pass neither orders the tool again nor starts
  // without it. A missing tool leaves the mode on.
  function crafts(m: string): boolean { return autoCraft[m] === true; }
  function holdForOrder(jobId: string, tool: string): void { toolOrder = { jobId, tool }; }
  function toolOrderPending(): boolean {
    if (!toolOrder) return false;
    const c = p.character(), tool = toolOrder.tool, report = root.__merchantCommandReport;
    if (report?.jobId === toolOrder.jobId || c.slots?.mainhand?.name === tool || c.items.some((item: any) => item?.name === tool)) toolOrder = null;
    return !!toolOrder;
  }

  /** Table A's `gathering-settings` row: the merchant's gathering modes, cooldowns and listings. */
  function reply(state: any): void { if (p.character().ctype === 'merchant') receive(state); }
  // What shared.js reads, and the four the gathering unit files drive (a known load failure keeps them from
  // loading, so their rows cannot yet move onto the owner behaviour).
  return {
    reply, active, attempt, standListings: () => standListings, syncGatheringCooldown, gatheringStatus, gatheringBaseline,
    meetCommand, wakeGatheringAfterStatus, halt, choose, report, crafts, holdForOrder,
    gatheringDestination, gatheringTick, selectGatheringMode, receive,
  };
}

const merchant = ((globalThis as any).partyMerchant ||= {});
merchant.jobs = Object.assign(merchant.jobs || {}, { gathering: createGathering });
// the merchant jobs owner's gathering as targeting's ports hold it.
export type MerchantGathering = ReturnType<typeof createGathering>;
