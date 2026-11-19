import { readFileSync, renameSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fresh as freshAt } from '../../protocol/reports.ts';
import { MOVEMENT_RING_SIZE } from '../../protocol/records.ts';
import { PAUSE_FILE, allows, deployRefusal, shutdownHold, type LoadMode, type Member, type PauseFile, type Question } from '../rules.ts';
import { createLease, type Statuses } from './lease.ts';
import { requestObject } from '../http.ts';

/**
 * The console Pause, Play and clean shutdown. The Pause is one fact, held here in memory and saved
 * in updates/console-pause.json, which this file alone writes and reads once at start. It runs no
 * console code until Play (user, 2026-10-29: "a pause means pause all code"). It reaches the groups
 * through the task owner's `user` hold and the characters through that owner's heartbeat hold
 * field; it rides no lease. The file stays until Play, so the Pause survives coordinator restarts,
 * deploys and container recreation. Play only removes the file: it writes no setting back, so every
 * choice made while paused stays (spec 11 SET-Q4).
 */

/** The console container has no Docker socket, so the user runs this command. */
const stopCommand = 'docker compose stop party-console';

// The one reader of the Pause file: the coordinator at start and the managed host's deployment
// reply, which tells a character that has not heard the coordinator yet. A missing file is no Pause;
// any other read error or a record of the wrong shape is a Pause marked `damaged`.
export function readPause(directory: string): PauseFile | null {
  let value: Record<string, unknown>;
  try { value = requestObject(JSON.parse(readFileSync(path.join(directory, PAUSE_FILE), 'utf8'))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    return { version: 1, id: 'damaged', pausedAt: Date.now(), running: [], damaged: String(error) };
  }
  if (value.version !== 1 || typeof value.id !== 'string' || typeof value.pausedAt !== 'number')
    return { version: 1, id: 'damaged', pausedAt: Date.now(), running: [], damaged: 'the record is not a Pause record' };
  return { ...value, running: Array.isArray(value.running) ? value.running.filter((name): name is string => typeof name === 'string') : [] } as PauseFile;
}

function writePause(directory: string, value: PauseFile): void {
  const file = path.join(directory, PAUSE_FILE), temporary = `${file}.${randomUUID()}.tmp`;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n');
  try { renameSync(temporary, file); }
  catch (error) { rmSync(temporary, { force: true }); throw error; }
}

interface ControlPorts {
  now(): number;
  /** The roster record (roster/): the headless slots, the Steam members and the Steam handoff. */
  roster: { headlessSlots: readonly (string | null)[]; steamMembers: readonly (string | null)[]; steamSwitch?: { phase: string } | null };
  statuses(): Statuses;
  // The member's assignment, its group's live task (01 design 1.3 `assignment`).
  task(name: string): { kind: string; owner: string } | null;
  flush(): void;
  log(message: string, level?: 'info' | 'warning' | 'error'): void;
  /** How long the automatic resume waits for a character that ran before the shutdown: the saved `consoleResumeWaitMs`, read at each check. */
  resumeWaitMs(): number;
  /** The lifecycle owner's notices on the coordinator. */
  notify(hook: 'lifecycle.paused' | 'lifecycle.played' | 'lifecycle.shutdown' | 'lifecycle.drainStarted' | 'lifecycle.drainEnded', payload: Record<string, unknown>): void;
}
type ShutdownPhase = 'deferred' | 'draining' | 'safe';

export function createConsoleControl(directory: string | undefined, ports: ControlPorts) {
  let saved = directory ? readPause(directory) : null;
  let shutdown: { phase: ShutdownPhase; requestedAt: number; pausedByShutdown: boolean; hold?: string } | null = null;
  const lease = createLease(directory, { now: ports.now, paused: () => !!saved, log: ports.log, notify: ports.notify });
  // The clean shutdown's flush time, which bounds the prepared worker wait (start.ts).
  let flushMs = 0;
  // The control log keeps the protocol ring's one bound.
  const messages: { at: number; message: string }[] = [];
  function log(message: string, level: 'info' | 'warning' | 'error' = 'info') {
    messages.push({ at: ports.now(), message });
    if (messages.length > MOVEMENT_RING_SIZE) messages.shift();
    ports.log(message, level);
  }
  function store(value: PauseFile | null) {
    if (!directory) throw new Error('Console controls need AL_DATA_DIR');
    if (value) writePause(directory, value);
    else rmSync(path.join(directory, PAUSE_FILE), { force: true });
    saved = value;
  }
  // A damaged Pause file starts the console paused under a fresh record, so a restart never plays
  // characters the player paused.
  if (saved?.damaged) {
    log(`The Pause file could not be read (${saved.damaged}); the console starts paused`, 'error');
    store({ version: 1, id: randomUUID(), pausedAt: ports.now(), running: [] });
  }
  // A clean shutdown marks the file before the container stops. Startup turns the mark into one
  // resume, so a second restart stays paused.
  if (saved?.safeAt) {
    const { safeAt: _safeAt, ...rest } = saved;
    store({ ...rest, resume: { since: ports.now() } });
    log('Resuming previous activity once the characters connect');
  }

  // The characters connected now, by the `recent` reading of their reports.
  function fresh(): string[] {
    const statuses = ports.statuses();
    return Object.keys(statuses).filter(name => statuses[name]?.connected !== false && freshAt(statuses[name]?.seenAt, ports.now(), 'recent', 0, true));
  }
  const members = (names: readonly string[]): Member[] => names.map(name => ({ name, task: ports.task(name), map: ports.statuses()[name]?.map }));
  // The characters expected to run: the headless slots and the Steam members.
  const running = () => [...ports.roster.headlessSlots, ...ports.roster.steamMembers].filter((name): name is string => !!name);
  // A Steam handoff in progress keeps a drain waiting.
  const handoff = () => !!ports.roster.steamSwitch && ports.roster.steamSwitch.phase !== 'complete';
  const maintenance = () => lease.status(ports.statuses(), running(), handoff());

  function pause(by: 'user' | 'shutdown' = 'user'): void {
    if (saved) return;
    store({ version: 1, id: 'console-pause-' + randomUUID(), pausedAt: ports.now(), running: [...new Set(running())] });
    log('Paused all automated actions');
    ports.notify('lifecycle.paused', { lease: saved!.id, running: saved!.running, by });
  }
  const PLAYED_BY = { Play: 'user', 'Automatic resume': 'auto-resume', 'Shutdown cancelled': 'shutdown-cancel' } as const;
  function play(reason: keyof typeof PLAYED_BY = 'Play', skipped: string[] = []): void {
    if (!saved) return;
    store(null);
    shutdown = null;
    log(`${reason}: resumed automated actions`);
    ports.notify('lifecycle.played', { skipped, by: PLAYED_BY[reason] });
  }
  function phase(value: 'deferred' | 'draining' | 'safe' | 'cancelled', hold: string | null = null): void {
    ports.notify('lifecycle.shutdown', { phase: value, hold, by: 'user' });
  }
  function beginDrain(pausedByShutdown: boolean): void {
    if (pausedByShutdown) pause('shutdown');
    shutdown = { phase: 'draining', requestedAt: shutdown?.requestedAt || ports.now(), pausedByShutdown };
    log('Clean shutdown: waiting for characters to hold still');
    phase('draining');
  }
  function requestShutdown(force = false): void {
    if (shutdown && shutdown.phase !== 'deferred') return;
    const pausedByShutdown = shutdown ? shutdown.pausedByShutdown : !saved;
    const hold = shutdownHold(members(fresh()));
    if (hold && !force) {
      shutdown = { phase: 'deferred', requestedAt: ports.now(), pausedByShutdown, hold };
      log(`Clean shutdown deferred: ${hold}`);
      phase('deferred', hold);
      return;
    }
    if (hold) log(`Clean shutdown forced while ${hold}`, 'warning');
    beginDrain(pausedByShutdown);
  }
  /** Cancel plays when the shutdown made the Pause. A Pause the user made stays. */
  function cancelShutdown(): void {
    if (!shutdown) return;
    const resume = shutdown.pausedByShutdown;
    shutdown = null;
    if (saved?.safeAt) { const { safeAt: _safeAt, ...rest } = saved; store(rest); }
    log('Clean shutdown cancelled');
    phase('cancelled');
    if (resume) play('Shutdown cancelled');
  }
  function cancelResume(): void {
    if (!saved?.resume) return;
    const { resume: _resume, ...rest } = saved;
    store(rest);
    log('Automatic resume cancelled; the console stays paused');
  }
  function observeDeferred(): void {
    if (shutdown?.phase !== 'deferred') return;
    const hold = shutdownHold(members(fresh()));
    if (hold) shutdown.hold = hold;
    else beginDrain(shutdown.pausedByShutdown);
  }
  // The clean shutdown drains on the Pause's own readiness: every running character acknowledges
  // held and still (table R row A1). The Pause rides no lease, so the acknowledgement names no Pause id;
  // its `held` mark is the answer (character/drain.ts `acknowledge`).
  function pauseReady(): { ready: boolean; waiting: string[] } {
    const statuses = ports.statuses(), names = [...new Set([...running(), ...fresh()])];
    const waiting = names.filter(name => {
      const ack = statuses[name]?.consoleMaintenance as { held?: unknown; ready?: unknown } | null | undefined;
      return !freshAt(statuses[name]?.seenAt, ports.now(), 'recent') || ack?.held !== true || ack?.ready !== true;
    });
    if (handoff()) waiting.push('active Steam handoff');
    return { ready: waiting.length === 0, waiting };
  }
  function observeDrain(): void {
    if (shutdown?.phase !== 'draining' || !saved) return;
    if (lease.current() || !pauseReady().ready) return;
    const began = ports.now();
    ports.flush();
    flushMs = ports.now() - began;
    store({ ...saved, safeAt: ports.now() });
    shutdown.phase = 'safe';
    log('Safe to stop: state saved');
    phase('safe');
  }
  function observeResume(): void {
    if (!saved?.resume) return;
    const connected = fresh(), missing = saved.running.filter(name => !connected.includes(name));
    if (missing.length && ports.now() - saved.resume.since < ports.resumeWaitMs()) return;
    for (const name of missing) log(`Skipped ${name}: not connected after the restart`, 'warning');
    play('Automatic resume', missing);
  }
  /** The heartbeat reply runs it, so it adds no timer of its own. */
  function observe(): void {
    observeDeferred();
    observeDrain();
    observeResume();
  }
  function shutdownStatus(active: NonNullable<typeof shutdown>) {
    let waiting: string[] = [];
    if (active.phase === 'draining') waiting = lease.current() ? ['another console maintenance lease'] : pauseReady().waiting;
    return { phase: active.phase, requestedAt: active.requestedAt, hold: active.phase === 'deferred' ? active.hold ?? null : null,
      waiting, command: stopCommand };
  }
  function status() {
    const connected = fresh();
    return {
      paused: !!saved,
      pausedAt: saved ? saved.pausedAt : null,
      leaseId: saved ? saved.id : null,
      resume: saved?.resume ? { since: saved.resume.since, waiting: saved.running.filter(name => !connected.includes(name)) } : null,
      shutdown: shutdown ? shutdownStatus(shutdown) : null,
      // The wait the next automatic resume uses, so a page or a test reads the value in force.
      resumeWaitMs: ports.resumeWaitMs(),
      // The page shows the last 8 lines (the status owner's display length).
      log: messages.slice(-8),
    };
  }
  /** The coordinator's `lifecycle.drain`: the lease with its participants, or null (the hunting owner's row 39). */
  function drain() {
    const active = lease.current();
    return active ? { lease: active, participants: maintenance().participants } : null;
  }
  return {
    pause, play, requestShutdown, cancelShutdown, cancelResume, observe, status, drain, maintenance,
    /** Table D: whether a coordinator reader may act now; `pullBlock` is the hunting owner's pull block. */
    allows: (question: Question, pullBlock?: boolean) => allows(question, { paused: !!saved, lease: lease.current(), pullBlock }),
    /** Table S1: why a deploy of this mode may not start now, or null. */
    admit: (mode: LoadMode) => deployRefusal(mode, members(Object.keys(ports.statuses()))),
    /** The lease with its captured fight, for the heartbeat reply. */
    served: () => lease.served(ports.statuses()),
    /** `lifecycle.state`: the Pause, the drain and the shutdown. */
    state: () => ({ paused: !!saved, pausedAt: saved ? saved.pausedAt : null, drain: drain(), shutdown: shutdown?.phase ?? null }),
    /** Lets the shutdown hook bound its wait for workers once the state is saved. */
    prepared: () => shutdown?.phase === 'safe',
    flushMs: () => flushMs,
    /** A worker stopped (table W's stop row): it leaves the deploy lease's participants. */
    stopped: (name: string) => lease.leave(name),
    /** The coordinator's shutdown ends the lease watch (start.ts `createShutdown`). */
    close: () => lease.close(),
  };
}
