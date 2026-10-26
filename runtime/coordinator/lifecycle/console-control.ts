import { readFileSync, renameSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { requestObject } from '../http/contracts.ts';

/**
 * The console Pause, Play and clean shutdown controls.
 *
 * Pausing writes updates/console-pause.json beside the deploy lease in updates/pause.json.
 * consoleMaintenance() and the managed host's /party-api/console-deployment
 * serve it as a draining lease whenever no deploy lease is active, so
 * characters hold through the safe reload path: no new targets, movement
 * parked, defence against attackers. The file stays until Play, so the pause
 * survives coordinator restarts, deploys and container recreation.
 */
export interface ResumeRecord {
  capturedAt: number;
  profiles: Record<string, Record<string, unknown>>;
  settings: Record<string, unknown>;
  merchantQueue: { id?: unknown; expiresAt?: unknown }[];
  running: string[];
  realm: unknown;
  events: string[];
}
interface PauseFile {
  version: 1;
  id: string;
  pausedAt: number;
  record: ResumeRecord;
  /** Set once a clean shutdown flushed storage; startup turns it into `resume`. */
  safeAt?: number;
  /** Set at startup after a clean shutdown; Play consumes it once. */
  resume?: { since: number };
}
export interface UserPauseLease {
  id: string;
  expires: number;
  mode: 'draining';
  /** Characters skip the finish-the-current-fight snapshot and only defend. */
  immediate: true;
  userPause: true;
}

export const pauseFileName = 'updates/console-pause.json';
/** The console container has no Docker socket, so the user runs this command. */
export const stopCommand = 'docker compose stop party-console';
const RESUME_WAIT_MS = 180_000;

function readPause(directory: string): PauseFile | null {
  try {
    const value = requestObject(JSON.parse(readFileSync(path.join(directory, pauseFileName), 'utf8')));
    return value.version === 1 && typeof value.id === 'string' && typeof value.pausedAt === 'number'
      ? value as unknown as PauseFile : null;
  } catch { return null; }
}
function writePause(directory: string, value: PauseFile): void {
  const file = path.join(directory, pauseFileName), temporary = `${file}.${randomUUID()}.tmp`;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n');
  for (let attempt = 0; ; attempt++) {
    try { renameSync(temporary, file); return; }
    catch (error) {
      // Windows briefly denies the replace while a reader holds the old file.
      if ((error as NodeJS.ErrnoException).code !== 'EPERM' || attempt >= 20) { rmSync(temporary, { force: true }); throw error; }
      const until = Date.now() + 25; while (Date.now() < until) { /* short synchronous retry */ }
    }
  }
}

/** The managed host reads the same file, so its loader replies cannot release the hold. */
export function userPauseLease(directory: string | undefined, now = Date.now) {
  let checked = 0, lease: UserPauseLease | null = null;
  return (): UserPauseLease | null => {
    if (!directory) return null;
    if (now() - checked < 250) return lease;
    checked = now();
    const saved = readPause(directory);
    // The expiry only satisfies lease readers; Play is the only release.
    return lease = saved ? { id: saved.id, expires: now() + 60_000, mode: 'draining', immediate: true, userPause: true } : null;
  };
}

interface ControlPorts {
  now(): number;
  capture(): ResumeRecord;
  restore(record: ResumeRecord): string[];
  /** Fresh character reports, keyed by name. */
  fresh(): Record<string, Record<string, unknown>>;
  maintenance(): { id: string | null; ready: boolean; waiting: string[] };
  flush(): void;
  log(message: string, level?: 'info' | 'warning' | 'error'): void;
}
type ShutdownPhase = 'deferred' | 'draining' | 'safe';

const inCave = (report: Record<string, unknown>) =>
  !!requestObject(requestObject(report.dungeon).cave).run || /^zone_[a-f0-9]+_\d+$/.test(typeof report.map === 'string' ? report.map : '');
// anniversary/hunt-handoff.ts reads the same three fields to detect an event.
const eventName = (report: Record<string, unknown>) => {
  const name = report.activeEvent || report.joinedEvent || report.mapEvent;
  return typeof name === 'string' ? name : name ? JSON.stringify(name) : null;
};

export function createConsoleControl(directory: string | undefined, ports: ControlPorts) {
  let saved = directory ? readPause(directory) : null;
  let shutdown: { phase: ShutdownPhase; requestedAt: number; pausedByShutdown: boolean; hold?: string } | null = null;
  const messages: { at: number; message: string }[] = [];
  function log(message: string, level: 'info' | 'warning' | 'error' = 'info') {
    messages.push({ at: ports.now(), message });
    if (messages.length > 20) messages.shift();
    ports.log(message, level);
  }
  function store(value: PauseFile | null) {
    if (!directory) throw new Error('Console controls need AL_DATA_DIR');
    if (value) writePause(directory, value);
    else rmSync(path.join(directory, pauseFileName), { force: true });
    saved = value;
  }
  // A clean shutdown marks the file before the container stops. The resume is
  // consumed here, so a second restart stays paused.
  if (saved?.safeAt) {
    const { safeAt: _safeAt, ...rest } = saved;
    store({ ...rest, resume: { since: ports.now() } });
    log('Resuming previous activity once the characters connect');
  }

  function holdReason(): string | null {
    for (const [name, report] of Object.entries(ports.fresh())) {
      if (inCave(report)) return `${name} is in a Cave run`;
      const event = eventName(report);
      if (event) return `${name} is in the ${event} event`;
    }
    return null;
  }
  function pause(): void {
    if (saved) return;
    store({ version: 1, id: 'console-pause-' + randomUUID(), pausedAt: ports.now(), record: ports.capture() });
    log('Paused all automated actions');
  }
  function play(reason = 'Play'): string[] {
    if (!saved) return [];
    const restored = ports.restore(saved.record);
    for (const line of restored) log(line);
    store(null);
    shutdown = null;
    log(`${reason}: resumed automated actions`);
    return restored;
  }
  function beginDrain(pausedByShutdown: boolean): void {
    if (pausedByShutdown) pause();
    shutdown = { phase: 'draining', requestedAt: shutdown?.requestedAt || ports.now(), pausedByShutdown };
    log('Clean shutdown: waiting for characters to hold still');
  }
  function requestShutdown(force = false): void {
    if (shutdown && shutdown.phase !== 'deferred') return;
    const pausedByShutdown = shutdown ? shutdown.pausedByShutdown : !saved;
    const hold = holdReason();
    if (hold && !force) {
      shutdown = { phase: 'deferred', requestedAt: ports.now(), pausedByShutdown, hold };
      log(`Clean shutdown deferred: ${hold}`);
      return;
    }
    if (hold) log(`Clean shutdown forced while ${hold}`, 'warning');
    beginDrain(pausedByShutdown);
  }
  function cancelShutdown(): void {
    if (!shutdown) return;
    const resume = shutdown.pausedByShutdown;
    shutdown = null;
    if (saved?.safeAt) { const { safeAt: _safeAt, ...rest } = saved; store(rest); }
    log('Clean shutdown cancelled');
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
    const hold = holdReason();
    if (hold) shutdown.hold = hold;
    else beginDrain(shutdown.pausedByShutdown);
  }
  function observeDrain(): void {
    if (shutdown?.phase !== 'draining' || !saved) return;
    const status = ports.maintenance();
    if (status.id !== saved.id || !status.ready) return;
    ports.flush();
    store({ ...saved, safeAt: ports.now() });
    shutdown.phase = 'safe';
    log('Safe to stop: state saved');
  }
  function observeResume(): void {
    if (!saved?.resume) return;
    const fresh = ports.fresh(), missing = saved.record.running.filter(name => !fresh[name]);
    if (missing.length && ports.now() - saved.resume.since < RESUME_WAIT_MS) return;
    for (const name of missing) log(`Skipped ${name}: not connected after the restart`, 'warning');
    play('Automatic resume');
  }
  /** Runs on character heartbeats, so it adds no timer of its own. */
  function observe(): void {
    observeDeferred();
    observeDrain();
    observeResume();
  }
  function shutdownStatus(active: NonNullable<typeof shutdown>) {
    const maintenance = active.phase === 'draining' ? ports.maintenance() : null;
    let waiting: string[] = [];
    if (maintenance) waiting = maintenance.id === saved?.id ? maintenance.waiting : ['another console maintenance lease'];
    return { phase: active.phase, requestedAt: active.requestedAt, hold: active.phase === 'deferred' ? active.hold ?? null : null,
      waiting, command: stopCommand };
  }
  function status() {
    const fresh = ports.fresh();
    return {
      paused: !!saved,
      pausedAt: saved ? saved.pausedAt : null,
      leaseId: saved ? saved.id : null,
      resume: saved?.resume ? { since: saved.resume.since, waiting: saved.record.running.filter(name => !fresh[name]) } : null,
      shutdown: shutdown ? shutdownStatus(shutdown) : null,
      log: messages.slice(-8),
    };
  }
  return {
    pause, play, requestShutdown, cancelShutdown, cancelResume, observe, status,
    /** Lets the shutdown hook bound its wait for workers once the state is saved. */
    prepared: () => shutdown?.phase === 'safe',
  };
}

/** Per-character choices the dashboard sets; hunt/scopes.ts stores them in farmingProfiles. */
const profileKeys = ['farmingPolicy', 'monsterHunt', 'huntSettings', 'location', 'monsterFocus', 'partyFarmingMode',
  'partyFarmingMonsterType', 'scatterMonsterTypes', 'abtestingStrategy'] as const;
const settingKeys = ['monsterFocusByCharacter', 'monsterPrioritiesByCharacter', 'monsterSearchRadiusByCharacter',
  'eventsByCharacter', 'eventSelectionsByCharacter', 'eventPrioritiesByCharacter', 'eventLimitsByCharacter',
  'merchantAutomations', 'merchantRoutinePriorities', 'activeRealm'] as const;
interface RecordState {
  farmingProfiles: Record<string, Record<string, unknown>>;
  merchantQueue: { id?: unknown; expiresAt?: unknown }[];
  merchantCurrent: { id?: unknown } | null;
  headlessSlots: (string | null)[];
  steamMembers: string[];
  statuses: Record<string, Record<string, unknown> | undefined>;
}
const copy = <T>(value: T): T => value === undefined ? value : JSON.parse(JSON.stringify(value));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function captureResumeRecord(state: RecordState, realm: unknown, now: number): ResumeRecord {
  const source = state as unknown as Record<string, unknown>;
  return {
    capturedAt: now,
    profiles: Object.fromEntries(Object.entries(state.farmingProfiles).map(([name, profile]) =>
      [name, Object.fromEntries(profileKeys.map(key => [key, copy(profile[key])]))])),
    settings: Object.fromEntries(settingKeys.map(key => [key, copy(source[key])])),
    merchantQueue: copy(state.merchantQueue),
    running: [...new Set([...state.headlessSlots, ...state.steamMembers].filter((name): name is string => !!name))],
    realm: copy(realm),
    events: [...new Set(Object.values(state.statuses).map(report => report && eventName(report)).filter((name): name is string => !!name))],
  };
}

/** Hunt progress keeps moving during a pause, so Play restores a Hunt only when its cycle changed. */
function restoreHunt(profile: Record<string, unknown>, saved: Record<string, unknown>, name: string): string[] {
  const cycle = (value: unknown) => requestObject(value).cycleId ?? null;
  if (cycle(profile.monsterHunt) === cycle(saved.monsterHunt)) return [];
  profile.monsterHunt = copy(saved.monsterHunt);
  return [`Restored ${name}'s monsterHunt`];
}
function restoreFields(target: Record<string, unknown>, saved: Record<string, unknown>, keys: readonly string[], label: string): string[] {
  const lines: string[] = [];
  for (const key of keys) if (!same(target[key], saved[key])) {
    target[key] = copy(saved[key]);
    lines.push(`Restored ${label}${key}`);
  }
  return lines;
}
function restoreQueue(state: RecordState, record: ResumeRecord, now: number): string[] {
  const lines: string[] = [];
  for (const job of record.merchantQueue) {
    if (state.merchantCurrent?.id === job.id || state.merchantQueue.some(entry => entry.id === job.id)) continue;
    if (typeof job.expiresAt === 'number' && job.expiresAt <= now) { lines.push(`Skipped merchant job ${String(job.id)}: it expired`); continue; }
    state.merchantQueue.push(copy(job));
    lines.push(`Restored merchant job ${String(job.id)}`);
  }
  return lines;
}
/** Writes back only what changed since the pause and returns one log line per change or skip. */
export function restoreResumeRecord(state: RecordState, record: ResumeRecord, ports: { now: number; liveEvent(name: string): boolean }): string[] {
  const lines: string[] = [];
  for (const [name, saved] of Object.entries(record.profiles)) {
    const profile = state.farmingProfiles[name];
    if (profile) lines.push(...restoreHunt(profile, saved, name), ...restoreFields(profile, saved, profileKeys.filter(key => key !== 'monsterHunt'), `${name}'s `));
    else lines.push(`Skipped ${name}'s farming settings: the profile no longer exists`);
  }
  lines.push(...restoreFields(state as unknown as Record<string, unknown>, record.settings, settingKeys, ''));
  lines.push(...restoreQueue(state, record, ports.now));
  for (const event of record.events)
    if (!ports.liveEvent(event)) lines.push(`Skipped the ${event} event: it ended during the pause`);
  return lines;
}
