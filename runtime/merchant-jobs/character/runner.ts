// The merchant job owner's runner on the character: the one record of what holds the merchant, the
// merchant's take of each command the intake accepts, the run of a job under the record, the wait for
// combat to end before a job, the command reports, and the stand return. The record sits on the
// runtime root as `__merchantHolder`, so the runtime a code reload starts reads the holder the old
// runtime left and starts no job beside it. It holds a job, a realm hop, a gathering attempt
// (gathering.ts), a command the intake accepted, a service itinerary between its legs, or the stand
// return. A reader that needs the job's own fields asks `job()`; a reader that asks whether a job or a
// hop holds the merchant asks `holder()`; a reader that asks whether anything holds it asks
// `record()`. Nothing else writes the record.
//
// A holder hands the merchant to the command that ended it: a command accepted while a job holds, or
// one that ended a gathering attempt, waits as the holder's `next` and takes the record on its release,
// so no other holder starts between them.
// The stand return is the holder `idle`: it walks to the market, opens and lists the stand through the
// items owner's body and keeps the merchant while the stand stays open for trades. A command or a
// gathering attempt that meets it ends it, and its release closes the stand, so no part waits for the
// stand return to let go. Gathering's cooldown rest is the one exception (design part 6, correction 4):
// it opens the stand through standReturn under the gathering holder, and its release leaves the stand
// open with no holder; the next take closes it (take ends the stand through leaveStand).
import { partyHooks } from '../../hooks/index.ts';
import { boundFired } from '../../status/api.ts';
import type { MerchantJobNotice } from '../../hooks/registry.ts';
import { itemFailure } from '../../items/api.ts';
import { scope } from '../../lifecycle/api.ts';
import { runAddonSteps, type AddonStepsCommand } from './steps.ts';
import { wakeReportWaits } from './report-wait.ts';
import type { ActionOutcome, MerchantStep } from '../../hooks/registry.ts';
import { AT_STAND, BACKGROUND_REFUSED, DEFAULT_HOME_REALM, jobCommandRetained, legacyStandLocation, type MerchantDoorAnswer, type MerchantDoorBand, type MerchantDoors, type MerchantStandLocation } from '../rules.ts';

type RunnerPorts = Record<string, any>;

// The job holder: who runs it, under which command, and since when. The commerce executor (the
// items owner's) keeps its journal key and sequence on it, so a recovery after a reload finds
// them.
interface JobHolder {
  kind: 'job'; jobId: string; commandId: number; owner: string; label: string;
  startedAt: number;
  commerceCycle?: boolean; commerceJournalKey?: string; commerceSequence?: number; next?: CommandHolder | null;
  // The service visit asks its itinerary to keep the merchant after the job ends, against
  // coordinator silence for `collectFor` ms past the last reply (`standReply`).
  collectFor?: number;
}
// A realm hop in flight: the hop executor ended the job's code at the hop, and this
// runtime holds the merchant until the restart on the destination replaces it.
interface RealmHolder { kind: 'realm'; realm: string; owner: string; startedAt: number }
// A command the intake accepted, until its handler returns: a travel, a `give`, an event command
// or `realm-set-home` holds the merchant as a job does.
interface CommandHolder { kind: 'command'; type: string; commandId: number; owner: string; startedAt: number; next?: CollectionHolder | null }
// A service itinerary between its legs: the coordinator sends the next leg or retries this one.
// The next job takes the record, and a command runs and hands it back. The hold ends on the first
// reply that names no open itinerary (`standReply`); each reply that names one moves `until` to
// `bound` ms past it, so `until` passes only when the coordinator goes silent, and that lapse
// reports under COLLECTION_HOLD_MS.
interface CollectionHolder { kind: 'collection'; jobId: string; owner: string; startedAt: number; until: number; bound: number; lapsed?: true }
export interface GatheringHolder { kind: 'gathering'; id: string; mode: string; phase: 'travel' | 'cast' | 'restoring' | 'rest'; owner: string; startedAt: number;
  cancelled: string | null; done: Promise<void>; next?: CommandHolder | null }
// The stand return: `return` while it walks and lists, `open` while the stand waits for trades. A
// newer listing request waits as `pending` and runs next under the same holder.
// `taker` is the holder kind of the command that cancelled the stand return, which its close names.
interface IdleHolder { kind: 'idle'; commandId: number; owner: string; startedAt: number; phase: 'return' | 'open';
  cancelled: string | null; taker?: string; done: Promise<void>; pending: any }
type Holder = JobHolder | RealmHolder | CommandHolder | GatheringHolder | CollectionHolder | IdleHolder;

export function createMerchantRunner(p: RunnerPorts) {
  const runtimeId = Date.now() + '-' + Math.random().toString(36).slice(2);
  // The command ids in the intake now: a repeat delivery of one meets it there and runs nothing, so
  // a command id runs once.
  const entering = new Set<number>();
  // The merchant's stand settings from the last reply (the merchant job owner's merchant section):
  // the player's "force stand", and the stand point, the legacy market point until the reply names
  // one.
  let forceStand = false, market: MerchantStandLocation = legacyStandLocation;
  // The home realm the stand return hops to; each stand return's command may name a new one.
  let homeRealm = DEFAULT_HOME_REALM;
  /** Table A's `stand-settings` row: a stand point off the main map or without coordinates is not one. */
  function standReply(state: { merchantForceStand?: unknown; merchantStandLocation?: { map?: unknown; x?: unknown; y?: unknown } | null; merchantItinerary?: unknown }): void {
    if ('merchantItinerary' in state) itineraryReply(state.merchantItinerary);
    forceStand = !!state.merchantForceStand;
    const spot = state.merchantStandLocation;
    if (spot && spot.map === 'main' && Number.isFinite(spot.x) && Number.isFinite(spot.y)) market = { map: 'main', x: spot.x as number, y: spot.y as number };
  }
  // Who asks to hear the merchant come free: gathering's pass runs at that moment.
  const freed: Array<() => void> = [];
  // The runner's notices (part 2), `by` the job owner's runner.
  function notify(notice: MerchantJobNotice, payload: Record<string, unknown>): void {
    partyHooks().notify(notice, { character: p.character().name, ...payload, by: payload.by ?? 'core:merchant-jobs' });
  }
  // Every write of the one record (3.3) tells `merchant.holder.changed` with the holder kinds and the
  // command the change names.
  function setHolder(next: Holder | null): void {
    const from: Holder | null = p.root().__merchantHolder || null;
    p.root().__merchantHolder = next;
    if (from === next) return;
    const command = (h: Holder | null) => h && 'commandId' in h ? h.commandId : null;
    notify('merchant.holder.changed', { from: from ? from.kind : null, to: next ? next.kind : null, command: command(next) ?? command(from) });
  }
  function record(): Holder | null {
    const current: Holder | null = p.root().__merchantHolder || null;
    if (!current || current.kind !== 'collection' || Date.now() < current.until) return current;
    if (!current.lapsed) {
      current.lapsed = true;
      boundFired({ bound: 'COLLECTION_HOLD_MS', owner: '08', state: { jobId: current.jobId, heldMs: Date.now() - current.startedAt } });
    }
    return null;
  }
  // The reply's open itinerary: a hold waiting on the record or behind a command ends when the reply
  // names none, and the coordinator's answer moves its silence bound.
  function itineraryReply(open: unknown): void {
    const current: Holder | null = p.root().__merchantHolder || null;
    const hold = current?.kind === 'collection' ? current : current?.kind === 'command' && current.next ? current.next : null;
    if (!hold || hold.lapsed) return;
    if (open) { hold.until = Date.now() + hold.bound; return; }
    if (current === hold) {
      setHolder(null);
      freed.forEach(listener => { Promise.resolve().then(listener); });
    } else if (current?.kind === 'command') current.next = null;
  }
  function holder(): JobHolder | RealmHolder | null {
    const current = record();
    return current && (current.kind === 'job' || current.kind === 'realm') ? current : null;
  }
  function job(): JobHolder | null { const current = record(); return current && current.kind === 'job' ? current : null; }
  // I-13: the commerce executor's marks on the job it runs under `commandId`: the cycle flag the
  // events owner's merchant reads, and the journal key and sequence a recovery after a reload finds. A
  // job the runner no longer holds under that command takes none.
  function commerce(commandId: number, marks: Pick<JobHolder, 'commerceCycle' | 'commerceJournalKey' | 'commerceSequence'>): void {
    const held = job();
    if (held && held.commandId === commandId) Object.assign(held, marks);
  }
  function holdRealm(realm: string): void { setHolder({ kind: 'realm', realm, owner: runtimeId, startedAt: Date.now() }); }
  // A holder takes the record only when nothing holds it. A gathering attempt also ends a stand left
  // open for trades (`endsStand`), and closes it first thing (`leaveStand`).
  function take(next: Holder, endsStand = false): boolean {
    const current = record();
    if (current && !(endsStand && current.kind === 'idle' && current.phase === 'open')) return false;
    setHolder(next);
    return true;
  }
  // A holder lets go: the command waiting as its `next` takes the record. A service job that asked
  // for it leaves its itinerary holding the merchant, behind that command if one waits. A job, a hop
  // or a command that leaves the merchant free tells the listeners; gathering's own release does not,
  // so its next attempt keeps the 2 s tick.
  function release(current: Holder): void {
    if (record() !== current) return;
    const next = ('next' in current && current.next) || null;
    const bound = current.kind === 'job' ? Number(current.collectFor) || 0 : 0;
    const itinerary: CollectionHolder | null = current.kind === 'job' && bound > 0
      ? { kind: 'collection', jobId: current.jobId, owner: runtimeId, startedAt: Date.now(), until: Date.now() + bound, bound } : null;
    if (next && next.kind === 'command' && itinerary) next.next = itinerary;
    setHolder(next || itinerary);
    if (!record() && current.kind !== 'gathering') freed.forEach(listener => { Promise.resolve().then(listener); });
  }
  function whenFree(listener: () => void): void { freed.push(listener); }
  // The service visit's ask: its itinerary keeps the merchant after the job ends, with `ms` as the
  // bound on coordinator silence, 0 for no hold.
  function collectAfter(ms: number): void {
    const current = job();
    if (current) current.collectFor = Math.max(0, ms);
  }
  // The intake admits a command id once while it runs.
  function admit(id: number): boolean {
    if (entering.has(id)) return false;
    entering.add(id);
    return true;
  }
  // The intake accepted a command; accept holds no `merchant-gather`. A job or a
  // gathering attempt keeps the record and the command waits as its `next`; a hop keeps it until the
  // restart replaces the runtime. Otherwise the command holds it, the newest replacing an older one,
  // as the newest command runs today; an itinerary between its legs waits as the command's `next`.
  function holdCommand(command: { type: string; id: number }): void {
    const current = record();
    if (current && current.kind === 'command' && current.commandId === command.id) return;
    if (current && current.kind === 'realm') return;
    // A newer listing request goes to the stand return that holds (holdStand).
    if (current && current.kind === 'idle' && command.type === 'merchant-idle') return;
    const hold: CommandHolder = { kind: 'command', type: command.type, commandId: command.id, owner: runtimeId, startedAt: Date.now(),
      next: current && current.kind === 'collection' ? current : current && current.kind === 'command' ? current.next : null };
    if (current && (current.kind === 'job' || current.kind === 'gathering')) current.next = hold;
    else setHolder(hold);
  }
  // The command's handler returned.
  function releaseCommand(id: number): void {
    entering.delete(id);
    const current = record();
    if (!current) return;
    if (current.kind === 'command' && current.commandId === id) release(current);
    else if ((current.kind === 'job' || current.kind === 'gathering') && current.next && current.next.commandId === id) current.next = null;
  }

  // A processing routine tells the coordinator its stage once per change.
  async function operationStage(command: any, stage: string): Promise<void> {
    if (!command.processingRoutine || command.operationStage === stage) return;
    command.operationStage = stage;
    await p.request('/merchant/heartbeat', { method: 'POST', body: { jobId: command.jobId, commandId: command.id, operationStage: stage } });
  }

  async function runJob(command: any, label: string, action: () => Promise<unknown>): Promise<unknown> {
    const active = job();
    if (active && active.jobId === command.jobId && active.owner !== runtimeId) {
      // The command id tells a redelivery from a reissue. The same id reaches a hot reloaded runtime
      // while the holder's job still runs, so it starts nothing. A new id is the coordinator's reissue
      // after its own JOB_LIVE_MS expiry (the silence ending, reported by its workerExpired), so the orphaned
      // holder goes and the job resumes from its durable state.
      if (active.commandId === command.id) {
        p.log('Merchant job already running; hot reload will not start a duplicate', '#f0b429');
        return;
      }
      setHolder(null);
    }
    if (active && active.jobId !== command.jobId) {
      // A recovered job has a new coordinator id. The walk its orphaned predecessor owned stops
      // first; that old completion cannot end the new id.
      await p.stopWalk();
      setHolder(null);
    }
    const token: JobHolder = { kind: 'job', jobId: command.jobId, commandId: command.id, owner: runtimeId, label,
      startedAt: Date.now() };
    setHolder(token);
    // The start acknowledgement moves the coordinator's job to `processing`. From then on the
    // merchant's status report carries the running job (`running` below), which keeps it live.
    report(command, 'running');
    try { await p.request('/merchant/heartbeat', { method: 'POST', body: {
      jobId: command.jobId, commandId: command.id, operationStage: command.operationStage } }); }
    catch (_heartbeatError) { /* Completion or recovery already owns the terminal state. */ }
    try {
      // The items owner's recoveries before a job, unchanged.
      if (command.commerceProgressVersion === 2) await p.recoverProductionJournal();
      if (p.previewSuppliesSaved()) await p.restoreUpgradePreviewSupplies();
      p.setLuckySlot(command.luckyUpgradeSlot);
      await p.recoverLuckyUpgrade();
      if (command.type !== 'merchant-upgrade-preview' && command.commerceProgressVersion !== 2 && p.freeSlots() > 0) await p.tidyLuckySlot(command.luckyUpgradeSlot);
      // The job starts with the items owner's bag merge.
      await p.mergeBag();
      return await action();
    } catch (error: any) {
      // Any throw ends the job with its failure, so a job never waits on the coordinator's heartbeat
      // bound for an error the runner saw. A job whose action already reported its end gets 409 here.
      try { await p.request('/merchant/complete', { method: 'POST', body: { jobId: command.jobId, commandId: command.id, success: false,
        error: String(error.reason || error.message || error), code: error?.code } }); } catch (_) { /* The coordinator's recovery ends it. */ }
      throw error;
    } finally {
      release(token);
    }
  }

  // A holder other than the stand return starts with the stand closed. The take's holder closes a
  // stand the game reports open through the items owner's stand holder before it acts. The close
  // tells `merchant.stand.closed` with the holder that took the stand.
  // `taker` names the holder that takes the stand when the stand return lets go for it.
  async function leaveStand(taker?: string): Promise<void> {
    const open = !!p.standOpen();
    await p.stand().close();
    const current = record();
    if (open) notify('merchant.stand.closed', { by: taker ?? (current ? current.kind : 'none') });
  }
  function standReturning(): boolean { const current = record(); return !!current && current.kind === 'idle' && current.phase === 'return'; }

  // A lucky upgrade left half done finishes before the stand lists (the items owner's recovery),
  // after a tidy that holds the bag.
  async function standInventoryReady(command: any): Promise<boolean> {
    try {
      await p.recoverLuckyUpgrade();
      return true;
    } catch (error: any) {
      await p.request('/merchant/idle-status', { method: 'POST', body: {
        character: p.character().name, commandId: command.id, phase: 'inventory-recovery', error: String(error.reason || error.message || error),
      } });
      return false;
    }
  }

  // The stand return's walk home, open and listing, under the holder `current` names: the stand
  // return itself, the stand sync's job (in place) or gathering's rest. Closing hides trade1 to
  // trade16 from the owner's character snapshot, but the server keeps those items in persistent stand
  // storage, so a sync in place may open, change and close the stand anywhere without returning its
  // listings to the bag.
  async function standReturn(command: any, current: () => boolean): Promise<any> {
    if (p.previewInFlight()) return { state: 'deferred' };
    const c = p.character(), spot = market, standWasOpen = !!c.stand;
    const atStand = () => c.map === spot.map && Math.hypot(c.x - spot.x, c.y - spot.y) <= AT_STAND;
    const status = (phase: string, extra?: Record<string, unknown>) => p.request('/merchant/idle-status', { method: 'POST', body: Object.assign({
      character: c.name, commandId: command.id, phase }, extra) });
    let stage = 'return';
    try {
      if (command.homeRealm) homeRealm = command.homeRealm;
      // A move home ends the stand return at the hop; the runner holds the merchant until the restart.
      const home = homeRealm;
      if (p.hop().liveRealm() !== home && await p.hop().hop('/merchant/ensure-home-realm', { character: c.name, realm: home }, home) === 'yielded')
        return { state: 'deferred' };
      if (!atStand() && !command.inPlace) {
        await status('returning');
        await p.stand().close();
        if (!current()) return;
        await p.townReturn(null, current);
        if (!current()) return;
        // The walk ends on movement's answer: arrival, or the failure its ladder reports, which the catch
        // below sends as the failed status with the error's code.
        await p.walkToMarket(market);
      }
      if (!command.inPlace && !atStand()) throw new Error('Merchant stand return ended before reaching the market');
      if (!current()) throw itemFailure('interrupted');
      stage = 'stand';
      if (!command.inPlace) await status('arrived');
      // A standless return (coordinator/stand.ts `standless`) ends at the market: the game opens a
      // stand only from a stand item, so an open here would fail on every report.
      if (command.noStand && !c.stand) {
        await status('no-stand');
        return { state: 'complete', liveListings: [] };
      }
      // The stand opens only for the holder that still holds the merchant (the race of
      // v1.5.0's shared.js:9521-9530).
      if (!current()) throw itemFailure('interrupted');
      await p.stand().open();
      if (!await standInventoryReady(command)) return { state: 'deferred' };
      const liveListings = await p.stand().list(command);
      if (!standWasOpen && c.stand) notify('merchant.stand.opened', { by: 'idle' });
      if (!command.inPlace && current()) {
        try { await p.tidyLuckySlot(p.luckySlot()); }
        catch (tidyError: any) { await status('inventory-recovery', { error: String(tidyError.reason || tidyError.message || tidyError) }); }
      }
      await status('complete', { liveListings, inventory: c.items.map((item: any, slot: number) => item ? { slot, item: p.fingerprint(item) } : null) });
      if (command.closeAfterSync && !standWasOpen) await p.stand().close();
      p.log(command.inPlace ? 'Marked items moved into persistent stand storage' : 'Merchant stand open; waiting for trades', '#51D2E1');
      return { state: 'complete', liveListings };
    } catch (error: any) {
      try { await status('failed', { stage, error: String(error.reason || error.message || error), code: error?.code }); }
      catch (_statusError) { /* A newer command superseded this attempt. */ }
      throw error;
    }
  }

  // The stand return's release closes the stand (3.3), then frees the record.
  async function releaseStand(held: IdleHolder, taker?: string): Promise<void> {
    if (record() !== held) return;
    try { await leaveStand(taker); }
    catch (closeError: any) { p.log('Merchant stand close failed: ' + String(closeError.message || closeError), '#f0b429'); }
    release(held);
  }

  // The `merchant-idle` command: the stand return takes the merchant as the holder `idle` and keeps
  // it while the stand stays open. A newer request while it walks or lists runs next under the same
  // holder; one while the stand is open runs at once under it. A job or a hop that holds the
  // merchant skips it, as on an earlier build.
  async function holdStand(command: any): Promise<any> {
    const held = record();
    if (held && held.kind === 'idle') {
      if (held.phase === 'return') { held.pending = command; return; }
      return runStand(held, command);
    }
    if (held && !(held.kind === 'command' && held.commandId === command.id)) return { state: 'skipped' };
    let done!: () => void;
    const hold: IdleHolder = { kind: 'idle', commandId: command.id, owner: runtimeId, startedAt: Date.now(), phase: 'return',
      cancelled: null, done: new Promise<void>(resolve => { done = resolve; }), pending: null };
    setHolder(hold);
    try { return await runStand(hold, command); }
    finally { done(); }
  }
  async function runStand(hold: IdleHolder, command: any): Promise<any> {
    const current = () => record() === hold && !hold.cancelled;
    let next = command, result: any, failure: unknown = null;
    while (next) {
      hold.phase = 'return';
      hold.pending = null;
      try { result = await standReturn(next, current); failure = null; }
      catch (error) { failure = error; }
      if (!current()) break;
      next = hold.pending;
    }
    // A stand left open, listed or not (a lucky recovery defers the listing), stays the holder's.
    if (current() && !failure && p.standOpen()) hold.phase = 'open';
    else await releaseStand(hold, hold.taker);
    if (failure) throw failure;
    return result;
  }

  // A command meets the stand return. A newer listing request and a stand sync leave it
  // be; any other command ends it at once, and the release closes the stand before the command
  // runs.
  async function meetStand(command: any): Promise<void> {
    const held = record();
    if (!held || held.kind !== 'idle' || ['merchant-idle', 'merchant-stand-sync'].indexOf(command.type) >= 0) return;
    held.cancelled = 'command ' + command.type;
    // The command takes the stand: a job's command runs under the job holder, any other under its own.
    held.taker = command.jobId ? 'job' : 'command';
    if (held.phase === 'return') { await p.stopWalk(); await held.done; }
    else await releaseStand(held, held.taker);
  }

  // The stand sync job moves the marked items into the stand's storage in place, under the job.
  async function standSync(command: any): Promise<void> {
    try {
      const current = () => { const held = job(); return !!held && held.jobId === command.jobId; };
      const result = current() ? await standReturn({ id: command.id, jobId: command.jobId, listings: command.listings || [], inPlace: true, closeAfterSync: true }, current)
        : { state: 'skipped' };
      if (!result || result.state !== 'complete') throw new Error('Stand inventory sync did not execute: ' + (result && result.state || 'interrupted'));
      await p.request('/merchant/complete', { method: 'POST', body: { jobId: command.jobId, success: true,
        activity: [{ level: 'success', message: 'Marked inventory moved into persistent stand storage' }] } });
    } catch (error: any) {
      try { await p.request('/merchant/complete', { method: 'POST', body: { jobId: command.jobId, success: false, error: String(error.reason || error.message || error), code: error?.code,
        activity: [{ level: 'error', message: 'Stand inventory sync failed', details: String(error.reason || error.message || error) }] } }); }
      catch (_completeError) { /* The job was already cleared. */ }
      throw error;
    }
  }

  // The merchant tells the coordinator what became of a job's command: accepted, or deferred with its
  // reason. The report rides on the next status at the coordinator's clock.
  function report(command: any, state: string, reason?: string | null): void {
    if (p.character().ctype !== 'merchant' || !command || !command.jobId) return;
    p.root().__merchantCommandReport = { commandId: command.id, jobId: command.jobId, state, reason: reason || null, at: Date.now() + p.clockOffset() };
  }

  // The merchant's take of a command the intake accepted. A `merchant-` command
  // delivered in an event's window, before the reservation reached the coordinator, waits and is
  // reported `deferred` (the character half of the event hold; the events owner's facts through, as read them);
  // the anniversary half leaves the stand return and the stand sync be. A gathering attempt or a stand
  // return the command meets lets go, the command holds the merchant, the stand closes but for a
  // listing request or a sync in place, and the hands go back to normal. It answers whether the command
  // runs now.
  async function accept(command: any): Promise<boolean> {
    if (/^merchant-/.test(command.type) && p.eventReserved()) { report(command, 'deferred', 'event'); return false; }
    if (command.type !== 'merchant-idle' && command.type !== 'merchant-stand-sync' && /^merchant-/.test(command.type) && p.anniversaryReserved()) {
      report(command, 'deferred', 'anniversary');
      return false;
    }
    // A `merchant-gather` never takes the merchant. It meets no gathering attempt, no
    // stand return, no holder and no hands; the stand closes, as before every merchant command.
    if (command.type === 'merchant-gather') { await leaveStand(); return true; }
    if (!await p.gatheringHandoff(command)) return false;
    await meetStand(command);
    holdCommand(command);
    if (command.type !== 'merchant-idle' && command.type !== 'merchant-stand-sync') await leaveStand();
    // A job command whose hands are not back to normal waits, reported, and its slot keeps it for
    // the next delivery; any other command runs with the hands as settle left them.
    if (!await p.settle(command) && jobCommandRetained(command.type)) {
      report(command, 'deferred', 'restoring hands after gathering');
      return false;
    }
    return true;
  }

  // The runner's take of an `addon-steps` command (steps.ts) under the job holder runJob set.
  // Each step goes to the action dispatcher (runtime/hooks/actions/, the add-on system), which the
  // realm's registry carries as `actions.dispatch`. A realm without it refuses the step, which ends
  // the job. A listing kind's job hops to its realm first, and runs again there once the hop lands.
  async function addonSteps(command: AddonStepsCommand): Promise<string> {
    if (command.realm && p.hop().liveRealm() !== command.realm && await p.hop().jobHop(command, command.realm) === 'yielded') return 'yielded';
    const hooks = partyHooks() as ReturnType<typeof partyHooks> & {
      actions?: { dispatch?(step: MerchantStep, at: { band: 'job'; holder: string; addon: string; character: string }): Promise<ActionOutcome> } };
    const reports = scope('08', 'act');
    return runAddonSteps(command, {
      next: (addon, view) => hooks.merchantJobs.step(addon, view),
      act: (step, holder) => hooks.actions?.dispatch
        ? hooks.actions.dispatch(step, { band: 'job', holder, addon: String(command.addon), character: command.target })
        : Promise.resolve({ id: holder, action: (step as { action?: ActionOutcome['action'] }).action!, character: command.target, addon: String(command.addon),
          outcome: 'refused', by: '14', reason: 'this realm has no action dispatcher' }),
      retry: (ask, core) => hooks.retry.policy(ask, core),
      window: () => Number(hooks.calls.window()) || 0,
      wait: ms => new Promise<void>(resolve => { reports.setTimeout(() => resolve(), ms); }),
      checkpoint: async (cmd, done) => {
        const reply = await p.request('/merchant/checkpoint', { method: 'POST', body: { jobId: cmd.jobId, commandId: cmd.id, state: { done } } });
        return { yield: !!(reply as { yield?: unknown } | null)?.yield };
      },
      holds: cmd => job()?.jobId === cmd.jobId,
      complete: async (cmd, success, error) => {
        await p.request('/merchant/complete', { method: 'POST', body: { jobId: cmd.jobId, commandId: cmd.id, success, ...(error ? { error } : {}) } });
      },
    });
  }

  // A job finishes the character's fight before it runs. Its errand request waits on combat in the
  // movement owner (`waiting`), which starts it when combat lets go, and a cancelled farming walk
  // drops it. The character is departing meanwhile, so targeting picks no new fight.
  async function afterCombat(action: () => Promise<unknown>, label: string): Promise<unknown> {
    const navigationOwner = p.farmingTravel();
    p.departing(true);
    const travel = p.travelCombat();
    const fighting = (): boolean => p.fighting(travel);
    if (fighting()) p.log('Finishing combat before ' + label, '#51D2E1');
    try {
      const started = await p.movement().afterCombat({ kind: 'errand', owner: 'errand:' + label,
        current: () => !(navigationOwner && navigationOwner.cancelled) }, fighting);
      if (!started) return;
      return await action();
    } finally {
      p.departing(false);
    }
  }

  // The running job, the idle job's return to the stand and a gathering attempt hold a
  // deploy's drain until they end. Each CODE load puts this runtime's answer in the realm's
  // registration.
  partyHooks().publish({ name: 'core:merchant-jobs', folder: 'core', author: 'adventureland-party-console',
    summary: "Holds a deploy's drain while the merchant runs a job, returns to its stand or gathers.",
    hooks: {
    // Each status report carries the job this runtime runs, so the coordinator reads the job's life
    // from the report. A holder a code reload left in the record names another runtime and is not
    // reported. A report also wakes the asks that wait on the coordinator's word (report-wait.ts).
    'report.sent': () => {
      const running = job();
      if (running && running.owner === runtimeId) report({ id: running.commandId, jobId: running.jobId }, 'running');
      wakeReportWaits();
    },
    'lifecycle.ready': () => {
      const held = record(), running = holder();
      if (running) return { ready: false, reason: running.kind === 'realm' ? 'the merchant is hopping realms' : 'the merchant is running a job' };
      if (standReturning()) return { ready: false, reason: 'the merchant is returning to its stand' };
      return held?.kind === 'gathering' ? { ready: false, reason: 'the merchant is gathering' } : { ready: true };
    } } });

  // The stand doors (`stand.open` and `stand.close`). An add-on opens or
  // closes the stand only while nothing holds the merchant, or inside its own job. The items
  // owner's stand call makes the game call.
  async function standDoor(open: boolean, band: MerchantDoorBand, holder?: string): Promise<MerchantDoorAnswer> {
    const current = record(), refused = (reason: string): MerchantDoorAnswer => ({ outcome: 'refused', by: '08', reason });
    if (current && !(current.kind === 'job' && holder === 'job:' + current.jobId)) return refused(`the merchant is held by ${current.kind}`);
    if (!!p.standOpen() === open) return { outcome: 'sent', reply: open ? 'already open' : 'already closed' };
    if (band === 'background' && partyHooks().calls.band({ band, method: 'merchant' }) !== 'send') return refused(BACKGROUND_REFUSED);
    await (open ? p.stand().open() : p.stand().close());
    notify(open ? 'merchant.stand.opened' : 'merchant.stand.closed', { by: 'addon' });
    return { outcome: 'sent' };
  }
  const doors = ((globalThis as { __partyMerchantDoors?: MerchantDoors }).__partyMerchantDoors ??= {});
  doors.standOpen = (_args, band, holder) => standDoor(true, band, holder);
  doors.standClose = (_args, band, holder) => standDoor(false, band, holder);

  return { runtimeId, record, holder, job, commerce, holdRealm, take, release, whenFree, collectAfter, admit, holdCommand, releaseCommand, operationStage, runJob,
    addonSteps, leaveStand, standReturning, standReturn, holdStand, meetStand, standSync, report, accept, afterCombat,
    standReply, forceStand: () => forceStand, market: () => market };
}
export type MerchantRunner = ReturnType<typeof createMerchantRunner>;

const merchant = ((globalThis as any).partyMerchant ||= {});
merchant.jobs = Object.assign(merchant.jobs || {}, { runner: createMerchantRunner });
