// The merchant realm owner on the coordinator (rules in ../rules.ts).
// It holds the wants for the merchant's realm and the move in flight (the saved realm request), and
// it is the one writer of the merchant's `block.realm` and `merchantRealmRequests[merchant]` and the
// one sender of its `native-realm-switch`, which goes through the job owner's slot writer as `realm`.
// Other owners ask `want`, `release`, `target`, `moving`, `retry` and `reconnect`; the routes
// (routes.ts), the party visit (party-visit.ts) and the worker setup (worker-setup.ts) only ask.
// A decision reads the player's setting through `played`, so an add-on's overlay plays.
import { played } from '../../settings/api.ts';
import type { CharacterBlock } from '../../lifecycle/api.ts';
import { fresh } from '../../protocol/reports.ts';
import { endMerchantJob, merchantSlotCommand } from '../../merchant-jobs/coordinator/api.ts';
import type { LadderPort } from '../../tasks/api.ts';
import { ARRIVAL_WINDOW_MS, jobWant, normalizedRealm, realmRefusal, realmRequestArrived, wantRank,
  type RealmAnswer, type RealmRequest, type WantOptions } from '../rules.ts';
import { recordRealm } from './records.ts';
import { boundFired } from '../../status/coordinator/api.ts';

interface Worker extends Pick<CharacterBlock, 'realm' | 'connected' | 'instance'> {}
interface Sale {
  id: string;
  reason?: string;
  manual?: boolean;
  startedAt?: unknown;
  buyOrder?: { buyer?: string; item?: { name?: string } };
}
interface RealmOwnerState {
  merchantCharacter: string | null;
  activeRealm: string;
  merchantRealmRequests?: Record<string, RealmRequest | undefined>;
  merchantRealmBlacklist?: readonly string[];
  steamMembers?: readonly string[];
  headlessSlots?: readonly (string | null)[];
  statuses: Record<string, { server?: string; seenAt?: number; runtime?: string; hp?: number; rip?: boolean; travelSample?: {connected?: boolean} } | undefined>;
  commands: Record<string, unknown>;
  merchantCurrent?: Sale | null;
  nextCommandId: number;
}
interface RealmOwnerPorts<T extends Worker> {
  now(): number;
  block(name: string): T;
  realmLabel(realm: string): string;
  log(message: string, level: string, details?: unknown): void;
  persist(): void;
  // The headless worker's stop; the worker manager starts it again on `block.realm`.
  restart(block: T): void;
  // The merchant group's realm-hold ladder.
  ladder?: LadderPort;
  // The tasks owner's task tick. It otherwise runs once per status report, before the dispatch
  // that writes a job's destination, so realm-hold would wait a report to hold the merchant.
  taskTick?(): void;
  // The game's realm list.
  resolve?(realm: string): unknown;
}
export type ReconnectAnswer = 'sent' | 'not-now';

export function createMerchantRealmOwner<T extends Worker>(state: RealmOwnerState, ports: RealmOwnerPorts<T>) {
  // The wants other than home, by owner. A job's want lives while its job is current.
  const wants = new Map<string, string>();
  // The requests whose arrival a want's `here` already told (`realm.move.arrived`).
  const arrived = new WeakSet<RealmRequest>();
  // The last ensureHome held work on the merchant's late home report, so the next one that does
  // not is the window's end.
  let heldOnReport = false;
  function liveWant(owner: string): boolean {
    return !jobWant(owner) || state.merchantCurrent?.id === owner.slice(4);
  }
  // The highest live want, or home. A job want whose job ended leaves the map here.
  function winning(): { owner: string; realm: string } {
    let best: { owner: string; realm: string } = { owner: 'home', realm: state.activeRealm };
    for (const [owner, realm] of wants) {
      if (!liveWant(owner)) { wants.delete(owner); continue; }
      if (wantRank(owner) > wantRank(best.owner)) best = { owner, realm };
    }
    return best;
  }
  function request(): RealmRequest | undefined {
    return state.merchantCharacter ? state.merchantRealmRequests?.[state.merchantCharacter] : undefined;
  }
  // The saved request keeps a job's want through a coordinator restart; liveWant drops it once
  // its job is no longer current.
  const saved = request();
  if (saved && jobWant(saved.owner)) wants.set(saved.owner, saved.realm);
  function steam(name: string): boolean {
    return state.statuses[name]?.runtime === 'native';
  }
  // A Steam merchant's move is `native-realm-switch` through the slot writer at once;
  // a headless merchant's worker stops and starts again on `block.realm`. A move the merchant's own
  // route asked (`acknowledged`) stops the worker once the route's reply is sent, and on Steam its
  // hop changes the page (rule 6), so it writes no command: one navigator per move, as the earlier
  // console's job and home routes sent none (http/merchant-job-actions.ts:42).
  function execute(merchant: string, block: T, realm: string, acknowledged?: WantOptions['acknowledged']): void {
    if (steam(merchant)) {
      if (acknowledged) return;
      merchantSlotCommand(state, 'realm', { id: state.nextCommandId++, type: 'native-realm-switch', realm });
      ports.persist();
      return;
    }
    if (acknowledged) acknowledged(() => ports.restart(block));
    else ports.restart(block);
  }
  // The move in flight: the saved request and the worker's realm.
  function move(merchant: string, owner: string, realm: string, attempts: number): RealmRequest {
    const next: RealmRequest = { realm, owner, requestedAt: ports.now(), attempts };
    (state.merchantRealmRequests ||= {})[merchant] = next;
    ports.block(merchant).realm = realm;
    recordRealm({ subject: merchant, decision: 'move', owner, code: realm });
    ports.taskTick?.();
    return next;
  }

  // Where the merchant stands: a headless worker on its block's realm once connected. A Steam
  // merchant's block has no worker connection, so its fresh report names the realm while its game
  // connection is up; a page change to the realm it stands on would replace its CODE for nothing.
  function onRealm(merchant: string, block: T, realm: string): boolean {
    if (!steam(merchant)) return block.realm === realm && !!block.connected;
    const status = state.statuses[merchant];
    return normalizedRealm(String(status?.server || '')) === realm && status?.travelSample?.connected === true &&
      fresh(status.seenAt, ports.now(), 'presence');
  }
  // `realm.want`: the refusals first, then the wants. A lower want waits, answered `moving`, and is
  // asked again when the higher one is released.
  function want(owner: string, realm: string, options: WantOptions = {}): RealmAnswer {
    const merchant = state.merchantCharacter;
    if (!merchant) return 'refused:no-merchant';
    const refusal = realmRefusal(owner, realm, played(state, 'merchantRealmBlacklist') || [], options);
    if (refusal) {
      recordRealm({ subject: merchant, decision: 'refused', owner, code: refusal });
      return refusal;
    }
    if (owner !== 'home') wants.set(owner, realm);
    if (winning().owner !== owner) return 'moving';
    const block = ports.block(merchant), current = request();
    if (onRealm(merchant, block, realm)) {
      if (current?.owner === owner && current.realm === realm && !arrived.has(current)) {
        arrived.add(current);
        recordRealm({ subject: merchant, decision: 'arrived', owner, code: realm });
      }
      return 'here';
    }
    const inFlight = current?.owner === owner && current.realm === realm;
    if (inFlight && !options.again) return 'moving';
    recordRealm({ subject: merchant, decision: 'granted', owner, code: realm });
    move(merchant, owner, realm, inFlight ? current!.attempts + 1 : 1);
    execute(merchant, block, realm, options.acknowledged);
    ports.persist();
    return 'moving';
  }
  function release(owner: string): void {
    wants.delete(owner);
  }
  // The refusals for a want not asked yet: the party visit's eligibility reads it so a blacklisted member's
  // realm keeps the visit queued with no ladder failure.
  function refuses(owner: string, realm: string, options: WantOptions = {}): boolean {
    return realmRefusal(owner, realm, played(state, 'merchantRealmBlacklist') || [], options) !== null;
  }
  // The party visit's travel port (3.the items owner's writers table): the current job's want for
  // the member's realm, with the job's command cleared while the worker reconnects.
  async function visit(realm: string): Promise<void> {
    const job = state.merchantCurrent;
    if (!ports.resolve?.(realm) || !job) throw new Error("Unknown merchant destination realm");
    merchantSlotCommand(state, 'realm', null);
    const answer = want('job:' + job.id, realm);
    if (answer !== 'moving' && answer !== 'here') throw new Error("Merchant realm want " + answer);
  }

  // The home want's arrival reading: a fresh report on home newer than the request, or with
  // no request a connected merchant reporting home. A Steam merchant's block names its native home
  // whenever no move names a realm (workers.ts ensure), so only a headless block's realm counts.
  function homeArrived(merchant: string, block: T, current: RealmRequest | undefined): boolean {
    const status = state.statuses[merchant];
    if (!steam(merchant) && block.realm !== state.activeRealm) return false;
    if (current) return realmRequestArrived(status, {...current, realm:state.activeRealm}, ports.now());
    return Number(status?.seenAt) > 0 && fresh(status?.seenAt, ports.now()) && reportedAtHome(status);
  }
  function reportedAtHome(status: RealmOwnerState['statuses'][string]): boolean {
    return normalizedRealm(String(status?.server || '')) === state.activeRealm;
  }
  function living(status: NonNullable<RealmOwnerState['statuses'][string]>): boolean {
    return !status.rip && Number.isFinite(status.hp) && Number(status.hp) > 0;
  }
  function workerConnected(block: T): boolean {
    return block.connected === true && !!block.instance && block.instance.exitCode === null && !block.instance.killed;
  }
  // The connected-at-home reading: a living merchant on home whose Steam or headless
  // connection is up.
  function connectedAtHome(merchant: string, block: T): boolean {
    const status = state.statuses[merchant];
    if (!status || !living(status) || !reportedAtHome(status)) return false;
    if (status.runtime === 'native')
      return state.steamMembers?.includes(merchant) === true && status.travelSample?.connected === true;
    return status.runtime === 'headless' && block.realm === state.activeRealm && workerConnected(block);
  }
  function awaitingFreshHomeReport(merchant: string, block: T): boolean {
    const seenAt = Number(state.statuses[merchant]?.seenAt);
    // A healthy assigned connection may have a delayed heartbeat. Hold work, without creating a
    // realm move, while the `merchant-home` reading counts the report.
    return seenAt > 0 && fresh(seenAt, ports.now(), 'merchant-home', 0, true) && connectedAtHome(merchant, block);
  }
  // The runtime the merchant reports from, under the `presence` reading (the earlier
  // console's 10 s).
  function runtimeFresh(merchant: string, runtime: 'native' | 'headless'): boolean {
    const status = state.statuses[merchant];
    return status?.runtime === runtime && fresh(status.seenAt, ports.now(), 'presence');
  }
  function homing(current: RealmRequest | undefined): boolean {
    return current?.owner === 'home' || current?.owner === 'user:force-stand';
  }
  // A move starts only from a merchant that reports from its own connection: a retired Steam status
  // or an unassigned headless worker never starts one, and a return already asked keeps its clock
  // while the worker reconnects.
  function mayMove(merchant: string, current: RealmRequest | undefined): boolean {
    if (homing(current)) return true;
    if (state.steamMembers?.includes(merchant)) return runtimeFresh(merchant, 'native');
    return !!state.headlessSlots?.includes(merchant) && runtimeFresh(merchant, 'headless');
  }
  function homeRequest(merchant: string, current: RealmRequest | undefined): RealmRequest {
    if (homing(current) && current!.realm === state.activeRealm) return current!;
    return (state.merchantRealmRequests ||= {})[merchant] = {
      realm: state.activeRealm, owner: 'home', requestedAt: ports.now(), attempts: 0,
    };
  }
  // An attempt whose arrival window passed is one failure of the realm hold's task ladder: no
  // count ends the return. At `wait` the next attempt waits for a report from the merchant that
  // shows a change, so the hold always has a due step. A request an older version marked exhausted
  // climbs again.
  function attemptReturn(merchant: string, current: RealmRequest, reason: string): void {
    if (current.exhausted) { delete current.exhausted; ports.persist(); }
    if (current.attempts !== 0 && ports.now() - current.requestedAt < ARRIVAL_WINDOW_MS) return;
    if (current.attempts !== 0 && current.climbedAt !== current.requestedAt) {
      current.climbedAt = current.requestedAt;
      boundFired({ bound: 'realmArrivalWindow', owner: '09', subject: merchant, state: { realm: current.realm, attempts: current.attempts, ms: ARRIVAL_WINDOW_MS } });
      const climbed = ports.ladder?.fail('realm-return', { trying: 'the merchant realm return' });
      recordRealm({ subject: merchant, decision: 'failed', owner: current.owner, code: climbed?.rung ?? 'realm-return' });
      if (climbed?.rung === 'wait') ports.log('Merchant realm return failed ' + current.attempts + ' times; trying again on the next report', 'error', {merchant, realm:state.activeRealm});
      ports.persist();
    }
    if (ports.ladder?.rung() === 'wait') return;
    const block = ports.block(merchant);
    move(merchant, current.owner, state.activeRealm, current.attempts + 1);
    merchantSlotCommand(state, 'realm', null);
    ports.log('Returning ' + merchant + ' to ' + ports.realmLabel(state.activeRealm) + ' before ' + reason, 'info');
    ports.persist();
    execute(merchant, block, state.activeRealm);
  }
  // The home want as the dispatch asks it: only a merchant that reports from its own connection,
  // or one whose return is already asked, starts a move.
  function homeWant(reason: string): boolean {
    const merchant = state.merchantCharacter;
    return !!merchant && mayMove(merchant, request()) && ensureHome(reason);
  }
  // The home want (the wants' last row): true once the merchant is home. A higher live want for another
  // realm keeps it waiting, so a job's listing trip is never cut short by home.
  function ensureHome(reason: string): boolean {
    const merchant = state.merchantCharacter;
    if (!merchant) return false;
    const current = request();
    const block = ports.block(merchant);
    if (homeArrived(merchant, block, current)) {
      if (current) {
        ports.ladder?.progress();
        recordRealm({ subject: merchant, decision: 'arrived', owner: current.owner, code: current.realm });
        delete state.merchantRealmRequests![merchant];
        ports.persist();
      }
      return true;
    }
    if (!current && awaitingFreshHomeReport(merchant, block)) { heldOnReport = true; return false; }
    // The `merchant-home` window ended with no fresh report from home: a kept bound.
    if (heldOnReport) {
      heldOnReport = false;
      boundFired({ bound: 'merchantHomeReportMs', owner: '09', subject: merchant, state: {} });
    }
    if (winning().realm !== state.activeRealm) return false;
    attemptReturn(merchant, homeRequest(merchant, current), reason);
    return false;
  }

  // A move holds `realm-hold` from the write of its destination until the arrival; a
  // job's listing hop holds it only inside v1.5.0's 60 s window, the time the
  // v1.5.0's home return already gave a job's realm request before it took the
  // merchant home (home-recovery.ts:122).
  function moving(): boolean {
    const current = request(), merchant = state.merchantCharacter;
    if (!current || current.exhausted || !merchant) return false;
    if (realmRequestArrived(state.statuses[merchant], current, ports.now())) return false;
    return !jobWant(current.owner) || ports.now() - current.requestedAt < ARRIVAL_WINDOW_MS;
  }
  // `realm.moving()` for one character, the roster's read. A party switch's move holds no roster
  // action: the switch's own Steam group restore carries a Steam merchant to the realm, and a
  // refusal there failed the restore and rolled the whole switch back.
  function movingFor(name: string): boolean {
    return name === state.merchantCharacter && moving() && !request()!.owner.startsWith('party-switch:');
  }
  // The home return or the force stand return is in flight (the hold table's realm-hold home row).
  function returningHome(): boolean {
    const current = request();
    return homing(current) && !current!.exhausted;
  }
  // `realm.target()`: the realm the merchant's move in flight names.
  function target(): string | undefined {
    const current = request();
    return current && !current.exhausted ? current.realm : undefined;
  }
  // `realm.retry()`, the dashboard Retry: the next attempt runs now.
  function retry(): void {
    const merchant = state.merchantCharacter;
    if (merchant) delete state.merchantRealmRequests?.[merchant];
    ports.ladder?.progress();
    ports.persist();
  }
  // `realm.reconnect(character)` (the events owner's A/B exit rung): one login to the realm the
  // character reports now; no want, no realm-hold. While the merchant's own move is in flight it
  // answers `not-now`.
  function reconnect(character: string): ReconnectAnswer {
    const realm = normalizedRealm(state.statuses[character]?.server);
    if (!realm || character === state.merchantCharacter && moving()) return 'not-now';
    const block = ports.block(character);
    block.realm = realm;
    if (steam(character))
      merchantSlotCommand(state, 'realm', { id: state.nextCommandId++, type: 'native-realm-switch', realm }, character);
    else ports.restart(block);
    ports.persist();
    return 'sent';
  }

  function alDataSale(job: Sale | null | undefined): job is Sale {
    return !!job && job.reason === 'ALData marketplace sales';
  }
  /** Never retry an ambiguous WTB sale: the server may already have fulfilled it. The merchant job owner's recovery asks
   *  this once the lifecycle owner's roster holds the merchant offline. The sale ends through the merchant job owner's one job
   *  end, which frees the merchant and hands a manual command held for the sale to the slot. */
  function recoverStalledSale(): boolean {
    const job = state.merchantCurrent;
    const merchant = state.merchantCharacter;
    if (!merchant || !alDataSale(job)) return false;
    merchantSlotCommand(state, 'realm', null);
    endMerchantJob(state, job, { decision: 'ended', code: 'sale-stalled' });
    const block = ports.block(merchant);
    move(merchant, 'home', state.activeRealm, 1);
    ports.log(
      "Stopped WTB fill for " + (job.buyOrder?.buyer || 'unknown buyer') +
        " when the merchant went offline; returning home without retrying the sale",
      "error",
      { item: job.buyOrder?.item?.name },
    );
    ports.persist();
    execute(merchant, block, state.activeRealm);
    return true;
  }
  // `label` is the realm's log label ("US I"), from the coordinator's realm list.
  return { want, release, label: ports.realmLabel, refuses, visit, homeWant, ensureHome, moving, movingFor, returningHome, target, retry, reconnect, recoverStalledSale };
}
export type MerchantRealmOwner = ReturnType<typeof createMerchantRealmOwner>;
