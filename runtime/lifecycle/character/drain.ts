// The drain on the character (table R's character rows): the deploy lease and the fight it lets finish, Load in Main
// and the checkpoint return (movement requests kind `lifecycle`), the atomic boundary, the acknowledgement, and the
// lifecycle owner's own `lifecycle.ready` answer with the busy rule A2m and A2 that the acknowledgement, the CODE
// reload and the Steam handoff fence read. Moved from characters/shared.js.
import { partyHooks } from '../../hooks/index.ts';
import type { ReadyAnswer } from '../api.ts';
import { createRunScope } from './run.ts';
import { LIFECYCLE_WALK_LABEL, type FightTarget } from '../rules.ts';
import { createIntake } from './intake.ts';

interface Lease { id: string; mode?: string; loadMode?: string; phase?: string; fightTargets?: FightTarget[] }
interface Spot { map: string; in?: string | number; x: number; y: number }
interface Character extends Spot { name: string; ctype: string; moving?: boolean; q?: Record<string, unknown> }
interface Marker { id: string; role?: string; visible?: boolean }

// The fields other owners read keep their names on the CODE frame: the lease (`__partyConsoleMaintenance`
// and its server time), the drain targets 04 reads and the open boundary count. drain.ts alone
// writes them; the loader reads the lease the host sent before this generation installed.
interface Frame {
  __partyConsoleMaintenance?: Lease | null;
  __partyConsoleMaintenanceAt?: number;
  __partyConsoleDrainTargets?: Record<string, boolean> | null;
  __partyConsoleAtomic?: number;
}
interface DrainPorts {
  frame: Frame;
  game: { __partyConsoleMaintenance?: Lease | null; __partyConsoleMaintenanceAt?: number };
  character(): Character;
  storage(): Storage;
  realm(): string;
  current(): boolean;
  /** The run scope's disposal of this generation (run.ts `retired`). */
  retired: AbortSignal;
  /** Table P: the character is held or starting (run.ts). */
  held(): boolean;
  /** The targeting owner's drain reads: the queue's markers, the started target, the engaged target, its key, and
   *  whether a drain fight is still active. */
  markers(): Marker[];
  started(id: string): boolean;
  attackingParty(id: string): boolean;
  engaged(): { id: string; map: string; in?: string | number } | null;
  drainKey(target: { id: string; map?: string; in?: string | number }): string;
  drainFight(): boolean;
  /** The targeting owner's threat read: how many monsters attack the party while it travels. */
  attackers(): number;
  /** Movement: a lifecycle walk, whether movement holds the character parked, and whether a
   *  route still runs. The checkpoint return is a forced walk (movement's `lifecycleWalk`). */
  move(goal: string | Spot, owner: string, label: string, forced?: boolean): Promise<unknown>;
  parked(): boolean;
  routing(): boolean;
  log(message: string): void;
}

// A2m's owners: the merchant held by a lease in its `holding` phase, or by any lease not in Main mode,
// waits only for its boundary, the game's queue and the items owner's bag holder (which covers the upgrade and its
// preview), as the merchant's jobs are already held.
const MERCHANT_HELD = new Set(['core:lifecycle', 'core:items-bag']);

export function createDrain(p: DrainPorts) {
  const f = p.frame;
  const boundaryCount = () => f.__partyConsoleAtomic || 0;
  const queued = () => { const q = p.character().q; return !!q && Object.keys(q).length > 0; };
  const lease = () => f.__partyConsoleMaintenance || null;
  // A stale local clock cannot release a transaction. The coordinator observes host lease expiry and
  // sends an ordered null; defense remains permitted.
  const draining = () => lease()?.mode === 'draining';
  const checkpointKey = () => 'party-console-return:' + p.character().name;

  // The lifecycle owner's own answer: a transaction in flight, or an action the game has not answered, holds the drain.
  function ready(): ReadyAnswer {
    if (boundaryCount()) return { ready: false, reason: 'a transaction is in flight' };
    if (queued()) return { ready: false, reason: 'the game has not answered an action' };
    return { ready: true };
  }
  // The waiting reasons last sent, for `lifecycle.readiness`: one notice per change.
  let lastWaiting = '', reasons: { by: string; reason: string }[] = [];
  /** Table R, A2m and A2: whether the character is busy for the drain. `includeFight` false leaves out
   *  the fight term, as the CODE reload and the Steam fence read it. */
  function busy(includeFight = true): boolean {
    const active = lease(), character = p.character();
    const readiness = partyHooks().lifecycle.ready({ character: character.name, lease: active });
    const merchantHeld = character.ctype === 'merchant' && !!active && (active.phase === 'holding' || active.loadMode !== 'main');
    const waiting = merchantHeld ? readiness.waiting.filter(entry => MERCHANT_HELD.has(entry.by)) : readiness.waiting;
    reasons = waiting;
    return waiting.length > 0 || includeFight && p.attackers() > 0;
  }
  // `acknowledge` alone sends `lifecycle.readiness`. A read of `lifecycle.drain().park` runs `busy`
  // too, and a listener that reads it while it handles another notice (the lifecycle hooks fixture's
  // `report.sent`) would get the readiness notice inside its own handler.
  function announce(): void {
    const active = lease(), text = active ? JSON.stringify(reasons) : '';
    if (text === lastWaiting) return;
    lastWaiting = text;
    if (active) partyHooks().notify('lifecycle.readiness', { character: p.character().name, lease: active.id, waiting: reasons, by: 'core:lifecycle' });
  }

  // Whether movement parks the character for the drain (E02-13, `lifecycle.drain(character).park`): a
  // Main load leaves a fighter away from main free, since parking its route while the load waits for it
  // would deadlock readiness; otherwise the drain parks once no drain fight is in sight and the work it
  // lets finish is done.
  function park(): boolean {
    const active = lease(), character = p.character();
    if (active?.loadMode === 'main' && character.ctype !== 'merchant' && character.map !== 'main') return false;
    return draining() && !p.drainFight() && !busy();
  }

  // Load in Main and the checkpoint return: movement requests of kind `lifecycle` at today's
  // moments. A held character never reaches this: its reply ends before (table D `reply-held`).
  let mainWalk: Promise<unknown> | null = null, returnWalk: Promise<unknown> | null = null;
  function mainTick(): boolean {
    const active = lease(), character = p.character();
    if (active?.loadMode === 'main' && character.ctype !== 'merchant') {
      if (character.map !== 'main' && !p.drainFight() && !mainWalk) {
        const walk: Promise<unknown> = p.move('main', 'lifecycle:main', LIFECYCLE_WALK_LABEL).catch(error => p.log('Console Main travel retry: ' + String((error as Error)?.message || error)))
          .finally(() => { if (mainWalk === walk) mainWalk = null; });
        mainWalk = walk;
      }
      return true;
    }
    let saved: Spot | null;
    try { saved = JSON.parse(p.storage().getItem(checkpointKey()) || 'null'); } catch { return false; }
    if (!active && saved && character.ctype !== 'merchant') {
      if (!returnWalk) {
        const walk: Promise<unknown> = p.move(saved, 'lifecycle:checkpoint', LIFECYCLE_WALK_LABEL, true).then(() => { if (p.current()) p.storage().removeItem(checkpointKey()); })
          .catch(error => p.log('Console checkpoint return retry: ' + String((error as Error)?.message || error)))
          .finally(() => { if (returnWalk === walk) returnWalk = null; });
        returnWalk = walk;
      }
      return true;
    }
    return false;
  }

  // The atomic boundary: it settles once neither a lease holding the merchant nor table P
  // holds the character, on the reply that clears the lease or releases the hold, where today a 100 ms
  // poll asked. The generation's disposal settles it too, and the waiter throws as replaced.
  let waiters: (() => void)[] = [];
  const free = () => p.character().ctype !== 'merchant' || !lease() && !p.held();
  function settle(): void {
    if (!free() && !p.retired.aborted) return;
    const ready = waiters; waiters = [];
    for (const resolve of ready) resolve();
  }
  p.retired.addEventListener('abort', settle, { once: true });
  async function boundary(): Promise<void> {
    if (!free() && !p.retired.aborted) await new Promise<void>(resolve => waiters.push(resolve));
    if (!p.current()) throw Error('Merchant continuation replaced during console loading');
  }
  /** A native transaction runs whole: it waits at the boundary, then counts as open until it ends. */
  async function atomic<T>(work: () => Promise<T>): Promise<T> {
    await boundary();
    f.__partyConsoleAtomic = boundaryCount() + 1;
    try { return await work(); } finally { f.__partyConsoleAtomic = boundaryCount() - 1; }
  }

  function receive(input: Lease | null, serverNow?: number): void {
    let next = input;
    if (serverNow && serverNow < (f.__partyConsoleMaintenanceAt || 0)) return;
    f.__partyConsoleMaintenanceAt = serverNow || f.__partyConsoleMaintenanceAt || 0;
    const character = p.character();
    if (next?.loadMode === 'main' && next.phase !== 'holding' && character.ctype === 'merchant') next = null;
    if (next?.mode === 'draining' && next.id !== lease()?.id) {
      // Snapshot the current red-circle fight before enabling the acquisition gate. A held character
      // (table P1) keeps no fight: nothing acts until Play.
      const targets: Record<string, boolean> = {};
      const markers = p.held() ? [] : p.markers().filter(marker => marker.role === 'current' && marker.visible &&
        (p.started(marker.id) || p.attackingParty(marker.id)));
      for (const marker of markers) targets[p.drainKey(marker)] = true;
      const engaged = p.held() ? null : p.engaged();
      if (engaged && !markers.length && (p.started(engaged.id) || p.attackingParty(engaged.id))) targets[p.drainKey(engaged)] = true;
      f.__partyConsoleDrainTargets = targets;
      if (next.loadMode === 'main' && character.ctype !== 'merchant' && !p.storage().getItem(checkpointKey()))
        p.storage().setItem(checkpointKey(), JSON.stringify({ map: character.map, in: character.in, x: character.x, y: character.y }));
    }
    f.__partyConsoleMaintenance = next;
    for (const target of next?.fightTargets ?? [])
      if (target.map === character.map && String(target.in || target.map) === String(character.in || character.map) && (!target.server || target.server === p.realm()))
        (f.__partyConsoleDrainTargets ||= {})[p.drainKey(target)] = true;
    p.game.__partyConsoleMaintenance = next; p.game.__partyConsoleMaintenanceAt = f.__partyConsoleMaintenanceAt;
    if (!next) f.__partyConsoleDrainTargets = null;
    settle();
  }

  /** The acknowledgement (table R's character rows A1, A2m, A2), sent with each report. */
  function acknowledge() {
    const active = lease(), character = p.character(), fight = p.drainFight();
    // `boundary` is the open transaction count: a worker told to close keeps its process while it is
    // above 0 (table W's stop row).
    const open = boundaryCount();
    // A1: a held character acts not at all, so a job or a fight cannot finish. It is ready once it
    // stands still, and only a native transaction in flight holds it. Under the console Pause with no
    // deploy lease it acknowledges `held`, which the clean shutdown waits on.
    const heldReady = !character.moving && !open && !queued(), waits = !!active && busy();
    announce();
    if (p.held()) return active ? { id: active.id, mode: active.mode, phase: active.phase, held: true, combat: false, boundary: open, ready: heldReady }
      : { held: true, combat: false, boundary: open, ready: heldReady };
    return active ? { id: active.id, mode: active.mode, phase: active.phase, combat: fight, boundary: open, ready: !fight && !waits && !character.moving &&
      (active.loadMode !== 'main' || character.ctype === 'merchant' || character.map === 'main') && (p.parked() || !p.routing()) } : null;
  }

  // Each CODE load puts this runtime's answer in the realm's registration.
  partyHooks().publish({ name: 'core:lifecycle', folder: 'core', author: 'adventureland-party-console',
    summary: "Holds the drain while a native transaction is in flight or the game has not answered an action.",
    hooks: { 'lifecycle.ready': ready, 'lifecycle.held': p.held, 'lifecycle.boundary': boundary,
      // `park` is read when asked: the targeting owner's drain fight reads the targets, and park reads that fight.
      'lifecycle.drain': () => draining() ? { targets: { ...f.__partyConsoleDrainTargets }, get park() { return park(); } } : null } });

  // Table A's three 13 rows on a reply, each in the place the table names.
  type Reply = { consoleMaintenance?: Lease | null; serverNow?: number };
  const parkMoving = () => { const character = p.character(); if (character.moving) partyHooks().ask('movement.park', character.name); };
  // Table D's `reply-held`: a held character keeps its heartbeat healthy, takes the deploy lease
  // for its acknowledgement and parks once on the held transition; the reply applies nothing else
  // until Play, so the row ends the apply.
  let heldParked = false;
  function heldReply(state: Reply): boolean {
    if (!p.held()) { heldParked = false; return false; }
    receive(state.consoleMaintenance || null, state.serverNow);
    if (!heldParked) { heldParked = true; parkMoving(); }
    return true;
  }
  // The lease on a reply to a character table P does not hold.
  const leaseReply = (state: Reply): void => receive(state.consoleMaintenance || null, state.serverNow);
  // The maintenance hold. A held character still has a healthy heartbeat, so Steam's stale-runner
  // recovery leaves its CODE running; the drain parks it without ending its journey, and its farm,
  // hunt or event continuation resumes when the lease clears (stand-in S20). The row ends the apply
  // while it holds.
  function maintenanceReply(): boolean {
    if (mainTick()) return true;
    if (!lease() || draining() && p.drainFight()) return false;
    if (!busy()) parkMoving();
    return true;
  }

  return {
    lease, draining, park, boundary, atomic, receive, acknowledge, heldReply, leaseReply, maintenanceReply,
    /** Whether a CODE reload may replace this runtime now: A2's busy rule without its fight term. */
    canReload: () => !busy(false),
    /** O1's maintenance clause and O3: the drain holds the turns while no drain fight is in sight. */
    holds: () => draining() && !p.drainFight(),
    /** The first owner's reason the last busy read found, which the Steam fence's refusal names. */
    busyReason: () => reasons[0] ? `${reasons[0].reason} (${reasons[0].by})` : null,
  };
}

// The lifecycle owner's door on the character realm (the run scope, the drain and the command intake), which characters/shared.js reaches at its install. It sits here, with
// the hook registry the drain publishes to, so run.ts stays free of the registry and the headless host
// can import its facade.
Object.assign(globalThis, { partyLifecycle: { createRunScope, createDrain, createIntake } });
// The lifecycle owner's character drain as targeting's ports hold it.
export type CharacterDrain = ReturnType<typeof createDrain>;
