// The party realm switch: the operation that moves every active character to one realm, and with set
// home changes each account character's home realm. The merchant's leg is the realm owner's
// `party-switch:<id>` want (owner.ts). Its routes are in routes.ts.
import type { CharacterBlock } from '../../lifecycle/api.ts';
import { fresh as freshReport } from '../../protocol/reports.ts';
import { ARRIVAL_WINDOW_MS, REALM_HOME_CONFIRM_MS, REALM_LOGIN_MS, normalizedRealm, type RealmAnswer, type WantOptions } from '../rules.ts';
import { merchantKind } from '../../merchant-jobs/api.ts';
import { merchantSlotCommand, pauseCurrentJob } from '../../merchant-jobs/coordinator/api.ts';
import { recordRealm } from './records.ts';
import { boundFired } from '../../status/coordinator/api.ts';

// A switch bound's firing report; the bounds are rules.ts REALM_LOGIN_MS, REALM_HOME_CONFIRM_MS and
// REALM_HOME_REPLY_MS.
export function switchBound(name: 'realmLoginMs' | 'realmHomeConfirmMs' | 'realmHomeReplyMs', ms: number, operation: RealmOperation, state: Record<string, unknown>): void {
  boundFired({ bound: name, owner: '09', subject: operation.id, state: { ...state, ms } });
}

// From runtime/coordinator/characters/realm-switch.ts.
export interface RealmOperation {
  id: string;
  realm: string;
  participants: string[];
  startedAt: number;
  setHome?: boolean;
  phase: string;
  characters: { name: string; realm: string | null; arrived: boolean; homeConfirmed?: boolean }[];
  completedAt?: number | null;
  message?: string;
  error?: string | null;
  fromRealm?: string | null;
  homeRealm?: string | null;
  homeExecutors?: string[];
  homeTargets?: string[];
  // The merchant's leg waits for its ALData sale.
  merchantWaiting?: boolean;
  // Your confirmation of a blacklisted destination, which binds every want this operation asks.
  confirmed?: boolean;
}
// The phases in which the switch owns its participants: `retrying` and `rolling-back` are
// 3.10.1's, so no merchant job starts during them.
export const LIVE_PHASES: readonly string[] = ["switching", "retrying", "rolling-back", "setting-home"];
// Each phase of 3.10.1 is one ring entry and sends `realm.switch.phase`. Every switch
// writes under the one subject `party-switch`, its operation in the entry's owner, so the realm
// records keep one ring for all switches.
export function switchPhase(operation: RealmOperation, phase: string): void {
  operation.phase = phase;
  recordPhase(operation);
}
export function recordPhase(operation: RealmOperation): void {
  recordRealm({ subject: 'party-switch', decision: 'phase', owner: 'party-switch:' + operation.id, code: operation.phase });
}
interface RealmStatus {
  seenAt: number;
  server?: string;
  ctype?: string;
  home?: string;
}
interface RealmCommand {
  id: number;
  type: "native-realm-switch" | "realm-set-home";
  realm: string;
  operationId: string;
}
interface RealmPorts {
  now(): number;
  // The next member report or home confirmation, or `bound` ms (report-wait.ts `nextReport`).
  nextReport(bound: number): Promise<void>;
  // The realm pause (`merchant.pause`): false while an ALData sale finishes first.
  pauseMerchant(): boolean | void;
  retireConvoys?(participants: string[]): void;
  // The merchant's leg is the realm owner's want (3.10): with no merchant named, every participant
  // is a fighter leg.
  merchant?(): string | null;
  realm?: { want(owner: string, realm: string, options?: WantOptions): RealmAnswer; release(owner: string): void };
  clearCommand(name: string): void;
  native(): string | null;
  steamMembers(): readonly string[];
  block(name: string): CharacterBlock;
  stop(block: CharacterBlock): Promise<void>;
  nextCommand(): number;
  command(name: string, command: RealmCommand): void;
  persist(): void;
  status(name: string): RealmStatus | undefined;
  setActiveRealm(realm: string): void;
  label(realm: string): string;
  dispatchMerchant(): void;
  start(name: string): unknown;
  characterHome(name: string): string | null;
  characterType?(name:string):string|null;
  connectionCount(): number;
  refresh(): Promise<unknown>;
  ownsOperation?(operation: RealmOperation): boolean;
  // An ALData sale is still the merchant's current job.
  saleRunning?(): boolean;
}

/** Coordinates one requested realm transition without changing worker restart ownership. */
export function createRealmSwitch(ports: RealmPorts) {
  function arrived(name: string, operation: RealmOperation, realm = operation.realm): boolean {
    const status = ports.status(name);
    return (
      !!status && status.seenAt >= operation.startedAt && freshReport(status.seenAt, ports.now(), 'presence') &&
      normalizedRealm(status.server) === realm
    );
  }

  function observations(operation: RealmOperation, realm = operation.realm): RealmOperation["characters"] {
    return operation.participants.map((name) => ({
      name,
      realm: normalizedRealm(ports.status(name)?.server),
      arrived: arrived(name, operation, realm),
    }));
  }

  function merchantLeg(operation: RealmOperation): string | null {
    const merchant = ports.merchant?.() || null;
    return merchant && ports.realm && operation.participants.includes(merchant) ? merchant : null;
  }
  // One participant's leg to `realm`: the merchant's is the realm owner's `party-switch:<id>` want,
  // a headless fighter's worker restarts on the realm, and the primary Steam character switches
  // natively. A merchant leg held for its ALData sale is asked once the sale ends. `again` marks a
  // retry window's leg.
  async function leg(operation: RealmOperation, name: string, realm: string, again = false): Promise<void> {
    if (name === merchantLeg(operation)) {
      if (!operation.merchantWaiting) wantRealm(operation, 'party-switch:' + operation.id, realm, again);
      return;
    }
    if (!ports.steamMembers().includes(name)) {
      const block = ports.block(name);
      block.realm = realm;
      if (block.enabled) await ports.stop(block);
      return;
    }
    if (name === ports.native() && normalizedRealm(ports.status(name)?.server) !== realm)
      ports.command(name, { id: ports.nextCommand(), type: "native-realm-switch", realm, operationId: operation.id });
  }

  // Every want the switch asks carries the operation's confirmation, and the rollback's return
  // to the realm the party left needs none; a refused want ends the operation at once with its reason.
  function wantRealm(operation: RealmOperation, owner: string, realm: string, again = false): void {
    const confirm = operation.confirmed === true || realm === operation.fromRealm;
    const answer = ports.realm!.want(owner, realm, { manual: true, confirm, again });
    if (answer !== 'here' && answer !== 'moving') throw new Error('Merchant realm want ' + answer + ' for ' + ports.label(realm));
  }

  async function depart(operation: RealmOperation): Promise<void> {
    const merchant = merchantLeg(operation);
    operation.merchantWaiting = ports.pauseMerchant() === false && !!merchant;
    ports.retireConvoys?.(operation.participants);
    operation.participants.forEach((name) => { if (!(name === merchant && operation.merchantWaiting)) ports.clearCommand(name); });
    for (const name of operation.participants) await leg(operation, name, operation.realm);
    ports.persist();
  }

  function operationOwned(operation: RealmOperation): boolean {
    return ports.ownsOperation?.(operation) !== false;
  }

  // v1.5.0's 60 s arrival deadline sets each window's length. The progress rule
  // decides whether a straggler is coming: a straggler whose login made progress in the window (a
  // report from any realm, or the merchant's sale still running) is asked again with another window,
  // and a window with no progress from any straggler ends the phase. No count ends it.
  async function awaitArrival(operation: RealmOperation, realm: string, phases: readonly string[]): Promise<void> {
    let windowStart = ports.now();
    for (;;) {
      if (!operationOwned(operation) || !phases.includes(operation.phase))
        throw new Error("Realm operation was cancelled or superseded");
      if (operation.merchantWaiting && !ports.saleRunning?.()) {
        operation.merchantWaiting = false;
        await leg(operation, merchantLeg(operation)!, realm);
      }
      operation.characters = observations(operation, realm);
      if (operation.characters.every(entry => entry.arrived)) return;
      if (ports.now() - windowStart >= ARRIVAL_WINDOW_MS) {
        const stragglers = operation.characters.filter(entry => !entry.arrived).map(entry => entry.name);
        const progressing = stragglers.filter(name => progressed(operation, name, windowStart));
        if (!progressing.length) throw new StragglerError(stragglers);
        if (operation.phase === "switching") switchPhase(operation, "retrying");
        operation.message = "Waiting for " + stragglers.join(", ") + " on " + ports.label(realm);
        for (const name of progressing) await leg(operation, name, realm, true);
        ports.persist();
        windowStart = ports.now();
      }
      await ports.nextReport(windowStart + ARRIVAL_WINDOW_MS - ports.now());
    }
  }
  function progressed(operation: RealmOperation, name: string, since: number): boolean {
    if (name === merchantLeg(operation) && operation.merchantWaiting) return true;
    const status = ports.status(name);
    return !!status && status.seenAt > since && freshReport(status.seenAt, ports.now(), 'presence');
  }
  // 3.10.1's rolling back: every participant goes back to the realm the switch left, with the same
  // windows; the operation ends `failed:rolled-back` with the stragglers named. It answers the
  // participants that did not come back.
  async function rollBack(operation: RealmOperation, reason: string): Promise<string[]> {
    const back = operation.fromRealm!;
    switchPhase(operation, "rolling-back");
    operation.message = "Returning the party to " + ports.label(back) + "; " + reason;
    ports.persist();
    for (const name of operation.participants) await leg(operation, name, back);
    try { await awaitArrival(operation, back, ["rolling-back"]); } catch (error) {
      if (!(error instanceof StragglerError)) throw error;
      return error.stragglers;
    }
    return [];
  }

  function assignHomeExecutor(operation: RealmOperation): void {
    operation.homeExecutors = [...operation.participants];
    for (const executor of operation.homeExecutors) {
      if (normalizedRealm(currentHome(executor, operation)) === operation.realm) {
        const entry = operation.characters.find((character) => character.name === executor);
        if (entry) entry.homeConfirmed = true;
        continue;
      }
      ports.command(executor, {
      id: ports.nextCommand(),
      type: "realm-set-home",
      operationId: operation.id,
      realm: operation.realm,
      });
    }
  }

  async function waitHome(operation: RealmOperation, names: string[]): Promise<void> {
    const deadline = ports.now() + REALM_HOME_CONFIRM_MS;
    while (ports.now() < deadline) {
      if (operation.error) throw new Error(operation.error);
      if (names.every((name) => operation.characters.some((entry) => entry.name === name && entry.homeConfirmed))) return;
      await ports.nextReport(deadline - ports.now());
    }
    switchBound('realmHomeConfirmMs', REALM_HOME_CONFIRM_MS, operation, { names });
    throw new Error("Home realm confirmation timed out for " + names.join(", "));
  }

  function currentHome(name: string, operation: RealmOperation): string | null {
    return observedHome(ports.status(name), ports.characterHome(name), operation, ports.now());
  }

  async function withCleanup(work: () => Promise<void>, cleanup: () => Promise<void>): Promise<void> {
    const errors: unknown[] = [];
    try { await work(); } catch (error) { errors.push(error); }
    try { await cleanup(); } catch (error) { errors.push(error); }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      const messages = errors.map((error) => error instanceof Error ? error.message : String(error));
      throw new AggregateError(errors, messages.join("; cleanup also failed: "));
    }
  }

  async function freshArrival(name: string, operation: RealmOperation, since: number, message: string): Promise<void> {
    const deadline = ports.now() + REALM_LOGIN_MS;
    const fresh = () => arrived(name, operation) && ports.status(name)!.seenAt >= since;
    while (!fresh() && ports.now() < deadline) await ports.nextReport(deadline - ports.now());
    if (fresh()) return;
    switchBound('realmLoginMs', REALM_LOGIN_MS, operation, { name });
    throw new Error(message + name);
  }

  async function visitHome(name: string, operation: RealmOperation): Promise<void> {
    const block = ports.block(name);
    if (block.instance) throw new Error(name + " already has an unmanaged connection; refusing to replace it");
    const previous = { enabled: block.enabled, realm: block.realm };
    const want = name === ports.merchant?.() && ports.realm ? 'party-switch:' + operation.id + ':home' : null;
    await withCleanup(async () => {
      block.enabled = true;
      if (want) wantRealm(operation, want, operation.realm);
      else block.realm = operation.realm;
      const loginStartedAt = ports.now();
      if (!ports.start(name)) throw new Error("Could not temporarily log in " + name);
      await freshArrival(name, operation, loginStartedAt, "Temporary login timed out for ");
      operation.characters.push({ name, realm: operation.realm, arrived: true });
      operation.homeExecutors!.push(name);
      ports.command(name, { id: ports.nextCommand(), type: "realm-set-home", operationId: operation.id, realm: operation.realm });
      await waitHome(operation, [name]);
    }, async () => {
      ports.clearCommand(name);
      block.enabled = false;
      await withCleanup(() => ports.stop(block), async () => {
        block.enabled = previous.enabled;
        if (want) ports.realm!.release(want);
        else block.realm = previous.realm;
        ports.persist();
      });
    });
  }

  function characterType(name:string):string|undefined|null {
    return ports.characterType?.(name) || ports.status(name)?.ctype;
  }
  function merchantToSuspend(operation:RealmOperation,offline:string[]):string|undefined {
    if(!offline.some(name=>characterType(name)==='merchant')) return undefined;
    const incumbent=operation.participants.find(name=>characterType(name)==='merchant');
    if(!incumbent) return undefined;
    if(ports.steamMembers().includes(incumbent))
      throw new Error('A managed merchant slot must be available to temporarily log in offline merchants; existing Steam merchant sessions were preserved');
    return incumbent;
  }
  function connectionToSuspend(operation: RealmOperation,offline:string[]): string | undefined {
    const merchant=merchantToSuspend(operation,offline);
    if(merchant) return merchant;
    if (ports.connectionCount() < 4) return undefined;
    const name = operation.participants.find((participant) => !ports.steamMembers().includes(participant));
    if (!name) throw new Error("A headless slot must be available to temporarily log in offline characters; existing Steam sessions were preserved");
    return name;
  }

  async function restoreConnection(name: string, block: CharacterBlock, enabled: boolean | undefined, operation: RealmOperation): Promise<void> {
    block.enabled = enabled;
    if (!enabled) return;
    const restoredAt = ports.now();
    if (!ports.start(name)) throw new Error("Could not restore " + name);
    await freshArrival(name, operation, restoredAt, "Reconnection timed out for ");
  }

  async function offlineHomes(operation: RealmOperation): Promise<void> {
    const offline = (operation.homeTargets || []).filter((name) => {
      const home = ports.characterHome(name);
      return !operation.participants.includes(name) && normalizedRealm(home) !== operation.realm;
    });
    if (!offline.length) return;
    // Free one headless connection while retaining its slot and configuration. No
    // Steam window is replaced, and temporary visitors are never assigned slots.
    const suspendedName = connectionToSuspend(operation,offline);
    const suspended = suspendedName ? ports.block(suspendedName) : null;
    const enabled = suspended?.enabled;
    await withCleanup(async () => {
      if (suspended) { suspended.enabled = false; await ports.stop(suspended); }
      for (const name of offline) await visitHome(name, operation);
    }, async () => {
      await withCleanup(async () => {
        if (suspended && suspendedName) await restoreConnection(suspendedName, suspended, enabled, operation);
      }, async () => { ports.persist(); });
    });
  }

  async function finish(operation: RealmOperation): Promise<void> {
    ports.setActiveRealm(operation.realm);
    switchPhase(operation, operation.setHome ? "setting-home" : "complete");
    operation.completedAt = operation.setHome ? null : ports.now();
    operation.message = operation.setHome
      ? "Party arrived; every participant is setting their home realm"
      : "Every active character arrived on " + ports.label(operation.realm);
    ports.persist();
    if (operation.setHome) {
      const confirmationDeadline = ports.now() + REALM_HOME_CONFIRM_MS;
      assignHomeExecutor(operation);
      await waitHome(operation, operation.participants);
      await offlineHomes(operation);
      await confirmAccountHomes(operation, confirmationDeadline);
      switchPhase(operation, "complete");
      operation.homeRealm = operation.realm;
      operation.completedAt = ports.now();
      operation.message = "Home realm changed for every character in the account";
      ports.persist();
    }
    ports.dispatchMerchant();
  }
  async function confirmAccountHomes(operation: RealmOperation, deadline: number): Promise<void> {
    const names = operation.homeTargets || operation.participants;
    do {
      await ports.refresh();
      if (names.every(name => persistedHomeConfirmed(name, operation))) return;
      if (ports.now() >= deadline) break;
      await ports.nextReport(deadline - ports.now());
    } while (ports.now() < deadline);
    switchBound('realmHomeConfirmMs', REALM_HOME_CONFIRM_MS, operation, { names });
    throw new Error('Account roster did not confirm every persisted home realm before the confirmation deadline');
  }
  function persistedHomeConfirmed(name: string, operation: RealmOperation): boolean {
    // Native set_home changes connected player state without a synchronous DB
    // write. Visitors have stopped, so only their refreshed account home counts.
    const home = operation.participants.includes(name) ? currentHome(name, operation) : ports.characterHome(name);
    return normalizedRealm(home) === operation.realm;
  }

  async function run(operation: RealmOperation): Promise<void> {
    let finishing = false;
    try {
      if (!operationOwned(operation)) return;
      await depart(operation);
      try {
        await awaitArrival(operation, operation.realm, ["switching", "retrying"]);
      } catch (error) {
        if (!(error instanceof StragglerError) || !operation.fromRealm || !operationOwned(operation)) throw error;
        const unreturned = await rollBack(operation, error.stragglers.join(", ") + " did not arrive");
        throw new Error("failed:rolled-back; " + error.stragglers.join(", ") + " did not reach " + ports.label(operation.realm) +
          (unreturned.length ? "; " + unreturned.join(", ") + " did not return to " + ports.label(operation.fromRealm) : ""));
      }
      if (!operationOwned(operation)) return;
      finishing = true;
      await finish(operation);
    } catch (error) {
      // A replaced operation must not clear commands owned by its successor.
      if (!operationOwned(operation)) return;
      let message = error instanceof Error ? error.message : String(error);
      for (const name of operation.homeExecutors || []) ports.clearCommand(name);
      // A set home that fails inside `finish` takes the party back to the realm it left, and the
      // operation fails once they are back, so a failed set home leaves no one on the destination.
      if (finishing && operation.setHome && operation.fromRealm) {
        ports.setActiveRealm(operation.fromRealm);
        try {
          const unreturned = await rollBack(operation, message);
          if (unreturned.length) message += "; " + unreturned.join(", ") + " did not return to " + ports.label(operation.fromRealm);
        } catch (rollbackError) {
          if (!operationOwned(operation)) return;
          message += "; " + (rollbackError instanceof Error ? rollbackError.message : String(rollbackError));
        }
      }
      switchPhase(operation, "failed");
      operation.error = message;
      operation.completedAt = ports.now();
      ports.persist();
    } finally {
      ports.realm?.release('party-switch:' + operation.id);
    }
  }

  return { run };
}
// A character's home during a set home: native set_home answers the live player before its
// periodic DB save, so a fresh report from the operation's destination counts first, then the
// account's saved home.
export function observedHome(status: RealmStatus | undefined, saved: string | null, operation: RealmOperation, now: number): string | null {
  const fresh = !!status && status.seenAt >= operation.startedAt && freshReport(status.seenAt, now, 'recent') &&
    normalizedRealm(status.server) === operation.realm;
  return fresh && status.home ? status.home : saved;
}
// The stragglers of a window in which none of them made progress (3.10.1).
class StragglerError extends Error {
  stragglers: string[];
  constructor(stragglers: string[]) { super("No straggler made progress: " + stragglers.join(", ")); this.stragglers = stragglers; }
}
/** Temporary home visitors retain exclusive command ownership until cleanup. */
export function realmOperationOwnsCharacter(operation: RealmOperation | null, name: string | null): boolean {
  return !!operation && !!name && LIVE_PHASES.includes(operation.phase) &&
    [...operation.participants, ...(operation.homeTargets || [])].includes(name);
}
// The realm a live switch takes any of `names` to, or null when no switch owns them. A rollback
// takes its participants back to the realm the switch left (3.10.1); every other live phase takes
// them to the switch's realm. The roster's Steam restore reads it (decision 2026-11-17).
export function realmOperationDestination(operation: RealmOperation | null, names: string[]): string | null {
  if (!operation || !names.some(name => realmOperationOwnsCharacter(operation, name))) return null;
  return operation.phase === "rolling-back" ? operation.fromRealm || null : operation.realm;
}

// From runtime/coordinator/characters/realm-composition.ts.
type RealmCompositionPorts = Parameters<typeof createRealmSwitch>[0];
interface PausedJob {
  [field: string]: unknown;
  id: string;
  reason: string;
  queuedAt?: number;
}
interface RealmCompositionState {
  realmSwitch?: RealmOperation | null;
  commands: Record<string, unknown>;
  steamMembers: string[];
  nextCommandId: number;
  statuses: Record<string, ReturnType<RealmCompositionPorts["status"]>>;
  activeRealm: string | null;
  merchantCharacter: string | null;
  merchantCurrent: PausedJob | null;
  merchantQueue: PausedJob[];
}
// The lifecycle owner's roster projection and account, read for the participants' homes, types
// and connections.
export interface RealmRoster {
  owned(name: string): { home?: string | null; type?: string | null } | undefined;
  homeRealm(): string | null;
}
export interface RealmAccount {
  response: { characters: { name: string; online?: unknown }[] };
  updateInfo(): Promise<unknown>;
}
interface CompositionPorts extends Pick<RealmCompositionPorts, "now" | "nextReport" | "native" | "block" | "stop" | "persist" | "label" | "dispatchMerchant" | "start"> {
  stamp(job: PausedJob): PausedJob;
  roster: RealmRoster;
  account: RealmAccount;
  realm: { want(owner: string, realm: string, options?: WantOptions): RealmAnswer; release(owner: string): void };
  // The combat groups whose walk carries a departing member, and movement's `walks.end`.
  groups(): { id: string | null; state: { activeConvoy?: { participants: string[] } | null } }[];
  endWalk(group: string | null): void;
}

/** Realm transitions share command sequencing and always observe current coordinator state. */
export function createCoordinatorRealmSwitch(state: RealmCompositionState, ports: CompositionPorts) {
  return createRealmSwitch({
    now: () => ports.now(),
    ownsOperation: (operation) => state.realmSwitch === operation,
    nextReport: (bound) => ports.nextReport(bound),
    pauseMerchant: () => pauseCurrentJob(state, 'realm', ports.now, ports.stamp),
    // Each group whose walk carries a departing member ends it through `walks.end`; saved
    // farming destinations stay.
    retireConvoys: (participants) => {
      for (const group of ports.groups())
        if (group.state.activeConvoy?.participants.some(name => participants.includes(name))) ports.endWalk(group.id);
    },
    merchant: () => state.merchantCharacter,
    realm: ports.realm,
    saleRunning: () => !!state.merchantCurrent && merchantKind(String(state.merchantCurrent.reason)).interrupt === 'never',
    // The switch's own commands reach the slot through the job owner's writer as `realm` (3.3).
    clearCommand: (name) => { merchantSlotCommand(state, 'realm', null, name); },
    native: () => ports.native(),
    steamMembers: () => state.steamMembers,
    block: (name) => ports.block(name),
    stop: (block) => ports.stop(block),
    nextCommand: () => state.nextCommandId++,
    command: (name, command) => { merchantSlotCommand(state, 'realm', command, name); },
    persist: () => ports.persist(),
    status: (name) => state.statuses[name],
    setActiveRealm: (realm) => {
      state.activeRealm = realm;
    },
    label: (realm) => ports.label(realm),
    dispatchMerchant: () => ports.dispatchMerchant(),
    start: (name) => ports.start(name),
    characterHome: (name) => ports.roster.owned(name)?.home || null,
    characterType: (name) => ports.roster.owned(name)?.type || null,
    connectionCount: () => ports.account.response.characters.filter((entry) => !!entry.online).length,
    refresh: () => ports.account.updateInfo(),
  });
}
