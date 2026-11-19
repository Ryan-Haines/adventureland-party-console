// The hands owner on the character:
// every equip and unequip of the merchant's own two hands for gathering, the normal record,
// and `settle`, where a command meets the gathering lease. Each call asks the call budget's job band
// first (3.13). shared.js builds it at load over one-line reads of other owners
// (`handsPorts()`); the moved code is shared.js's own JavaScript, so those reads are untyped here.
//
// One normal record: the `merchantWeapon` intent when set (the items owner's setting, delivered in the
// reply), else the hands observed when the lease began. The gathering session keeps no copy.
import { partyHooks } from '../../hooks/index.ts';
import { scope } from '../../lifecycle/api.ts';
import { boundFired } from '../../status/api.ts';
import type { HandsNotice } from '../../hooks/registry.ts';
import { DASHBOARD_EQUIPMENT_TYPES, gatheringTools, normalItem, settleAnswer } from '../rules.ts';

export type HandsPorts = Record<string, any>;
type Hands = { mainhand: any; offhand: any };
interface HandsState {
  lease: string | null; observed: Hands | null;
  // The look for a missing normal item or tool, asked again only when its bag and bank signature
  // changes (no timer and no count).
  missing: Record<string, string>;
  // A refused replacement order, by tool: the bag and bank it was refused against.
  refused?: Record<string, string>;
}

// The game's packet order inside one action (3.11): the next equip waits 250 ms after an equip or
// unequip packet.
const PACKET_MS = 250;
export function isDashboardEquipment(item: any): boolean {
  const definition = (G as any).items[item && item.name] || {};
  return DASHBOARD_EQUIPMENT_TYPES.includes(definition.type);
}

export function createMerchantHands(p: HandsPorts) {
  // The lease and its normal record live on the runtime root, so a code reload restores what the
  // old runtime's lease displaced.
  const state: HandsState = p.root().__merchantHands ||= { lease: null, observed: null, missing: {} };
  const tools = () => gatheringTools((G as any).skills);
  const listed = (item: unknown) => p.listings().some((listing: any) => listing && listing.item && p.sameItem(item, listing.item));
  // The hands owner's notices: every lease change, and a restore
  // that failed.
  function tell(notice: HandsNotice, payload: Record<string, unknown>): void {
    partyHooks().notify(notice, { character: p.character().name, ...payload, by: 'core:merchant-hands' });
  }
  function lease(next: string | null): void {
    const was = state.lease;
    state.lease = next;
    if (was !== next) tell(next ? 'hands.lease.taken' : 'hands.lease.ended', { lease: next ?? was });
  }

  function hands(): Hands {
    const c = p.character();
    return { mainhand: p.fingerprint(c.slots && c.slots.mainhand), offhand: p.fingerprint(c.slots && c.slots.offhand) };
  }
  // An enabled add-on's item for a hand, when the merchant holds it and it is a normal item;
  // otherwise the hand the merchant had.
  function addonHand(hand: 'mainhand' | 'offhand', wanted: { mainhand?: unknown; offhand?: unknown } | undefined, observed: unknown): unknown {
    const item = wanted?.[hand] as { name?: string } | null | undefined, c = p.character();
    if (!item || !normalItem(item, listed, tools())) return observed;
    const at = p.findItem(item);
    if (at >= 0) return p.fingerprint(c.items[at]);
    return p.sameItem(c.slots && c.slots[hand], item) ? p.fingerprint(c.slots[hand]) : observed;
  }
  function normal(): Hands {
    const observed = state.observed || { mainhand: null, offhand: null }, wanted = partyHooks().hands.restore();
    return { mainhand: p.intent() || addonHand('mainhand', wanted, normalItem(observed.mainhand, listed, tools()) ? observed.mainhand : null),
      offhand: addonHand('offhand', wanted, normalItem(observed.offhand, listed, tools()) ? observed.offhand : null) };
  }
  function bestWeapon(): any {
    return p.character().items.filter((item: any) => item && (G as any).items[item.name] && (G as any).items[item.name].type === 'weapon')
      .sort((a: any, b: any) => (Number(b.level) || 0) - (Number(a.level) || 0))[0] || null;
  }

  // Each equip and unequip asks the job band first; a "not now" waits for the call window, as the
  // realm owner's page change does. The wait ends with no call once the caller's holder is no
  // longer current, and every caller tests current() after the call. A reply the game never sends
  // ends the call after two margins (the items owner's itemReplyBound rule), reported as `handReplyBound`, and the
  // caller's check of the hand names the failure.
  async function handCall(method: 'equip' | 'unequip', hand: string, current: () => boolean, slot = -1): Promise<void> {
    const hooks = partyHooks();
    while (hooks.calls.band({ band: 'job', method }) !== 'send') {
      if (!current()) return;
      await p.sleep(hooks.calls.window());
    }
    const scoped = scope('09', 'act'), bound = 2 * hooks.calls.margin();
    let timer: ReturnType<typeof scoped.setTimeout> | undefined;
    const late = new Promise<void>(resolve => {
      timer = scoped.setTimeout(() => { boundFired({ bound: 'handReplyBound', owner: '09', state: { method, hand, ms: bound } }); resolve(); }, bound);
    });
    await Promise.race([method === 'equip' ? equip(slot, hand as any) : unequip(hand as any), late]).finally(() => scoped.clearTimeout(timer));
    await p.sleep(PACKET_MS);
  }

  // The item's count in the bag and in the bank snapshot: the look's signature.
  function signature(name: string): string {
    const bank = p.character().bank;
    return p.count(name) + ':' + (bank ? Object.keys(bank).reduce((total, pack) => total + (Array.isArray(bank[pack])
      ? bank[pack].filter((item: any) => item && item.name === name).length : 0), 0) : '-');
  }
  // Every item the bag and the bank hold, by name and count: a refused craft's signature.
  function holdings(): string {
    const c = p.character(), counts: Record<string, number> = {};
    const add = (item: any) => { if (item && item.name) counts[item.name] = (counts[item.name] || 0) + (Number(item.q) || 1); };
    (c.items || []).forEach(add);
    for (const pack of Object.values(c.bank || {})) if (Array.isArray(pack)) pack.forEach(add);
    return JSON.stringify(Object.entries(counts).sort());
  }
  // A missing item is looked for in the bank once per bag and bank change, and named when the
  // bank does not hold it.
  async function look(name: string, current: () => boolean): Promise<boolean> {
    if (state.missing[name] === signature(name)) return false;
    p.status('Checking bank for ' + name, 'info');
    // The items owner's bank look: the walk and one withdrawal.
    if (!await partyHooks().ask('items.fetch', p.character().name, name) || !current()) return false;
    if (p.count(name) > 0) { delete state.missing[name]; return true; }
    state.missing[name] = signature(name);
    return false;
  }

  // The tool for a gathering mode, from the bag or the bank. A missing tool leaves the mode on and is
  // recorded for the card; the look runs again when the bag or the bank changes.
  async function ensureGatheringTool(session: any, current: () => boolean): Promise<boolean> {
    const c = p.character();
    const carried = () => (c.slots && c.slots.mainhand && c.slots.mainhand.name === session.tool) ||
      c.items.some((item: any) => item && item.name === session.tool);
    const reported = state.missing[session.tool] !== undefined;
    if (carried() || await look(session.tool, current) && carried()) {
      if (reported) p.report({ mode: session.mode, toolFound: true, message: (session.mode === 'fishing' ? 'Fishing' : 'Mining') + ' tool found', level: 'info' });
      session.baseline = p.baseline();
      return true;
    }
    if (!current()) return false;
    // The craft opt-in orders a replacement even after the no-tool report, since turning it on
    // clears the coordinator's no-tool record; the report itself goes once per record. A
    // refused order is asked again only once the bag or the bank holds something new, such as the
    // recipe's materials.
    if (p.crafts(session.mode) && state.refused?.[session.tool] !== holdings()) {
      const toolOrder = await p.request('/merchant/order', { method: 'POST', body: { buys: [], crafts: [{ id: session.tool, quantity: 1, level: 0 }] } });
      if (!toolOrder?.jobId) { (state.refused ||= {})[session.tool] = holdings(); return false; }
      delete state.refused?.[session.tool];
      p.holdForOrder(toolOrder.jobId, session.tool);
      p.status('Crafting replacement ' + session.tool, 'info', { jobId: toolOrder.jobId });
      delete state.missing[session.tool];
      return false;
    }
    if (reported || p.crafts(session.mode)) return false;
    p.report({ mode: session.mode, noTool: true, message: (session.mode === 'fishing' ? 'Fishing' : 'Mining') + ' waiting: no tool in inventory or bank', level: 'info' });
    return false;
  }

  // The lease begins at the spot: the best tool goes into the mainhand, and the hands it displaces
  // are the normal record.
  async function equipGatheringTool(session: any, current: () => boolean): Promise<void> {
    const c = p.character();
    const equipped = c.slots && c.slots.mainhand;
    if (equipped && !tools().includes(equipped.name)) state.observed = hands();
    else if (!state.observed) state.observed = { mainhand: p.fingerprint(equipped ? bestWeapon() : null), offhand: p.fingerprint(c.slots && c.slots.offhand) };
    lease(session.tool);
    let bestLevel = equipped && equipped.name === session.tool ? Number(equipped.level) || 0 : -1;
    let slot = -1;
    c.items.forEach((item: any, index: number) => {
      if (item && item.name === session.tool && (Number(item.level) || 0) > bestLevel) { bestLevel = Number(item.level) || 0; slot = index; }
    });
    if (slot < 0 && equipped && equipped.name === session.tool) {
      if (c.slots && c.slots.offhand) await handCall('unequip', 'offhand', current);
      return;
    }
    if (slot < 0) throw new Error('Missing ' + session.tool + ' in merchant inventory');
    // A tool is a mainhand item, and an equipped offhand makes the server refuse it as cant_equip.
    if (c.slots && c.slots.offhand) {
      await handCall('unequip', 'offhand', current);
      if (!current()) return;
      // The unequip packet may fill a bag hole, so the tool is found again by its level.
      slot = c.items.findIndex((item: any) => item && item.name === session.tool && (Number(item.level) || 0) === bestLevel);
      if (slot < 0) throw new Error('Best ' + session.tool + ' moved while clearing offhand');
    }
    await handCall('equip', 'mainhand', current, slot);
    if (!current()) return;
    if (!c.slots || !c.slots.mainhand || c.slots.mainhand.name !== session.tool) throw new Error('Game did not equip ' + session.tool);
    p.status('Equipped best ' + session.tool + ' (+' + bestLevel + ')', 'success');
  }

  // Both hands back to normal, the offhand after a two-handed weapon, each call checked. A normal
  // item in neither the bag nor the hands is looked for in the bank and named. A missing
  // normal weapon still takes the tool off the hand, but the lease stays and the restore answers
  // false, so a job command waits until the weapon is back, as v1.5 (aac30d45 shared.js:10009 and :10642,
  // decisions.md answer 2). A refused equip keeps the lease too, and the next settle or tick tries
  // again.
  // One restore runs at a time: the command's settle, the gathering attempt's end and its cooling
  // rest each ask for one, and each would send its own equip for the same hand. A later ask shares
  // the running restore and reads its own `current` after it.
  let restoring: Promise<boolean> | null = null;
  function restoreGatheringEquipment(current: () => boolean): Promise<boolean> {
    if (restoring) return restoring.then(done => done && current());
    const run = restoreHands(current).finally(() => { if (restoring === run) restoring = null; });
    restoring = run;
    return run;
  }
  async function restoreHands(current: () => boolean): Promise<boolean> {
    const c = p.character();
    try {
      if (!current()) return false;
      const wanted = normal();
      let mainhand = wanted.mainhand, missing: string | null = null;
      const definition = mainhand && (G as any).items[mainhand.name], weaponType = definition && definition.wtype;
      const classDefinition = (G as any).classes && (G as any).classes[c.ctype] || {};
      if (mainhand && weaponType && !(classDefinition.mainhand && classDefinition.mainhand[weaponType]) &&
          !(classDefinition.doublehand && classDefinition.doublehand[weaponType])) {
        p.status('Merchant weapon is incompatible: ' + mainhand.name, 'error');
        mainhand = null;
      }
      const doublehand = !!(mainhand && weaponType && classDefinition.doublehand && classDefinition.doublehand[weaponType]);
      if (doublehand && c.slots && c.slots.offhand) {
        await handCall('unequip', 'offhand', current);
        if (!current()) return false;
      }
      if (mainhand && !p.sameItem(c.slots && c.slots.mainhand, mainhand) && p.findItem(mainhand) < 0 && !await look(mainhand.name, current)) {
        if (!current()) return false;
        p.status('Marked weapon missing: ' + mainhand.name, 'error');
        missing = mainhand.name;
        mainhand = null;
      }
      if (mainhand && !p.sameItem(c.slots && c.slots.mainhand, mainhand)) {
        await handCall('equip', 'mainhand', current, p.findItem(mainhand));
        if (!current()) return false;
        if (!p.sameItem(c.slots && c.slots.mainhand, mainhand)) throw new Error('Game did not equip merchant weapon ' + mainhand.name);
      } else if (!mainhand && c.slots && c.slots.mainhand && !normalItem(c.slots.mainhand, listed, tools())) {
        await handCall('unequip', 'mainhand', current);
        if (!current()) return false;
        if (c.slots && c.slots.mainhand) throw new Error('Game did not clear the merchant mainhand');
      }
      const offhand = wanted.offhand;
      if (!doublehand && offhand && !p.sameItem(c.slots && c.slots.offhand, offhand)) {
        const offSlot = p.findItem(offhand);
        if (offSlot < 0) p.status('Previous offhand is no longer in inventory: ' + offhand.name, 'error');
        else {
          await handCall('equip', 'offhand', current, offSlot);
          if (!current()) return false;
          if (!p.sameItem(c.slots && c.slots.offhand, offhand)) throw new Error('Game did not equip previous offhand ' + offhand.name);
        }
      }
      if (missing) {
        tell('hands.restore.failed', { error: 'Marked weapon missing: ' + missing });
        return false;
      }
      lease(null);
      p.status(p.intent() ? 'Equipped marked merchant weapon after gathering' : 'Restored equipment after gathering', 'success');
      return true;
    } catch (error: any) {
      if (!current()) return false;
      p.status('Could not restore pre-gathering equipment', 'error', String(error.reason || error.message || error));
      tell('hands.restore.failed', { error: String(error.reason || error.message || error) });
      return false;
    }
  }

  // A command meets the lease where the intake hands it on (3.11): every command that reaches settle
  // ends the lease, and both hands go back to normal before the command runs. It answers
  // whether the hands are normal, which runner.accept reads to defer a job command.
  // A manual Equip of a hand item puts that hand back itself, and manual() then makes it normal and
  // ends the lease, so its settle sends no restore equip ahead of the command's own.
  async function settle(command?: { type?: unknown; item?: { name?: string } | null }): Promise<boolean> {
    if (settleAnswer(!!state.lease) === 'pass') return true;
    if (command?.type === 'equip' && handItem(command.item)) return true;
    return await restoreGatheringEquipment(p.current);
  }
  function handItem(item: { name?: string } | null | undefined): boolean {
    const definition = (G as any).items[item && item.name || ''] || {};
    return definition.type === 'weapon' || ['shield', 'source', 'quiver', 'misc_offhand'].includes(definition.type);
  }

  // A manual equip or unequip of a hand makes that hand's item normal, and a tool it
  // replaced ends the lease. `before` is the hands as they were before the command.
  function manual(before: Hands): void {
    const now = hands();
    (['mainhand', 'offhand'] as const).forEach(hand => {
      if (p.sameItem(now[hand], before[hand]) || now[hand] && tools().includes(now[hand].name)) return;
      state.observed = { ...(state.observed || { mainhand: null, offhand: null }), [hand]: now[hand] };
    });
    if (!(now.mainhand && tools().includes(now.mainhand.name))) lease(null);
  }

  // An unmarked weapon listed for stand sale leaves the hand and the normal record.
  async function releaseListed(): Promise<void> {
    const c = p.character();
    if (p.intent() || !c.slots || !c.slots.mainhand || !listed(c.slots.mainhand)) return;
    const released = p.fingerprint(c.slots.mainhand);
    await handCall('unequip', 'mainhand', p.current);
    if (!p.current()) return;
    if (state.observed && p.sameItem(state.observed.mainhand, released)) state.observed = { ...state.observed, mainhand: null };
    p.status('Released unmarked merchant weapon for stand listing', 'success');
  }

  // Table A's `stand-listings` row: on the merchant, while no job holds it and no gathering runs.
  async function listedReply(): Promise<void> {
    if (p.character().ctype !== 'merchant' || p.holder() || p.gathering()) return;
    await releaseListed();
  }

  // The normal record is the read an add-on on the character may ask. Each CODE load
  // puts this runtime's answer in the realm's registration.
  partyHooks().publish({ name: 'core:merchant-hands', folder: 'core', author: 'adventureland-party-console',
    summary: "Answers the merchant's normal hands.", hooks: { 'hands.normal': normal } });
  return { hands, normal, ensureGatheringTool, equipGatheringTool, restoreGatheringEquipment, settle, manual, releaseListed, listedReply };
}

// The door shared.js reaches (3.1: `globalThis.partyMerchant`): the hands owner's character half.
const merchant = ((globalThis as any).partyMerchant ||= {});
merchant.hands = Object.assign(merchant.hands || {}, { create: createMerchantHands, isDashboardEquipment });
