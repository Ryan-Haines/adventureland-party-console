// Lifecycle's rules: the deploy lease's one shape,
// the Pause record's shape, and the tables every reader asks. The console and the host programs
// in tools/ import this file, so no copy of a rule remains in either. The character bundles
// import it too, so it reads no file: the Pause file's reader sits beside its writer in
// coordinator/control.ts.
import { fresh } from '../protocol/reports.ts';

// The host writes the deploy lease and the coordinator writes the Pause; each file has one writer.
export const LEASE_FILE = 'updates/pause.json';
export const PAUSE_FILE = 'updates/console-pause.json';

export type LoadMode = 'now' | 'safe' | 'main';
type LeasePhase = 'preparing' | 'draining' | 'moving-main' | 'holding';
/** The deploy lease as its writers write it (safe-reload.ts, the update transaction). */
export interface MaintenanceLease { id: string; mode: 'draining'; loadMode: LoadMode; phase: LeasePhase; expires: number }
/** The deploy lease as its readers parse it: a lease past `expires` is no lease. */
export interface Lease { id: string; expires: number; mode?: 'draining'; loadMode?: LoadMode; phase?: string }
/** The fight a member is in when a lease starts, which the drain lets it finish (lease.ts captures
 *  it, the heartbeat reply carries it, drain.ts reads it). */
export interface FightTarget { id: string; map: string; in?: string | number; server?: string }

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function parseLease(input: unknown, now: number): Lease | null {
  const value = record(input);
  if (typeof value.id !== 'string' || typeof value.expires !== 'number' || value.expires < now) return null;
  return { id: value.id, expires: value.expires, ...(value.mode === 'draining' ? { mode: 'draining' as const } : {}),
    ...(['now', 'safe', 'main'].includes(String(value.loadMode)) ? { loadMode: value.loadMode as LoadMode } : {}),
    ...(typeof value.phase === 'string' ? { phase: value.phase } : {}) };
}
/** A new lease: `now` holds at once, the other modes prepare first. */
export function newLease(id: string, loadMode: LoadMode, expires: number): MaintenanceLease {
  return { id, mode: 'draining', loadMode, phase: loadMode === 'now' ? 'holding' : 'preparing', expires };
}

/** The Pause record. The file stays until Play. */
export interface PauseFile {
  version: 1;
  id: string;
  pausedAt: number;
  /** The characters running at Pause; the automatic resume waits for them. */
  running: string[];
  /** Set once a clean shutdown flushed storage; startup turns it into `resume`. */
  safeAt?: number;
  /** Set at startup after a clean shutdown; the automatic resume consumes it once. */
  resume?: { since: number };
  /** A file that is there but unreadable or of the wrong shape reads as a Pause with its error, so a
   *  damaged file never plays the console; the coordinator replaces it at start. */
  damaged?: string;
}

// Table P: the run state of a character, read on the character by character/run.ts. P2 holds
// a newly loaded character until the console's first status reply answers, on both hosting modes; a
// failed report does not release it. From then on the tasks owner's
// hold field decides: the console Pause (`user`) or Pause on a headless character (`pause`) holds it.
export type RunRow = 'held' | 'starting' | 'running';
export function runRow(facts: { answered: boolean; hold: string | null | undefined }): RunRow {
  if (!facts.answered) return 'starting'; // P2
  return facts.hold === 'user' || facts.hold === 'pause' ? 'held': 'running'; // P1, P3
}
// P0, the coordinator's row: the coordinator has no hold field and waits for no reply, so its run
// never holds (b9b5c91e application.ts:1736-1754 ran its ticks through a Pause) and sends no
// holdChanged notice. run.ts createCoordinatorRun reads it.
export const COORDINATOR_ROW: RunRow = 'running';

// Table D: the coordinator's questions. Each row names when the answer is no; the Pause rides no
// lease, so each row names the Pause itself.
export type Question = 'merchant' | 'recovery' | 'pulls' | 'reply';
interface DrainFacts { paused: boolean; lease: Lease | null; pullBlock?: boolean }
const mainBeforeHolding = (lease: Lease) => lease.loadMode === 'main' && lease.phase !== 'holding';
const TABLE_D: Record<Question, (facts: DrainFacts) => boolean> = {
  // A Main lease lets the merchant work until its `holding` phase.
  merchant: ({ paused, lease }) => paused || !!lease && !mainBeforeHolding(lease),
  recovery: ({ paused, lease }) => paused || !!lease,
  // The hunting owner's pull block holds the pulls as the Pause and a lease do.
  pulls: ({ paused, lease, pullBlock }) => paused || !!lease || !!pullBlock,
  // A lease that is not draining: the heartbeat reply carries only the lease.
  reply: ({ lease }) => !!lease && lease.mode !== 'draining',
};
export function allows(question: Question, facts: DrainFacts): boolean { return !TABLE_D[question](facts); }

// Table R, coordinator rows: whether a participant keeps a drain waiting.
interface Report { seenAt?: unknown; ctype?: unknown; type?: unknown; map?: unknown; consoleMaintenance?: unknown }
const merchantOf = (report: Report) => (report.ctype || report.type) === 'merchant';
/** R5: the merchant of a Main lease works on until `holding`. */
const merchantContinues = (report: Report, lease: Lease) => mainBeforeHolding(lease) && merchantOf(report);
/** R4: a Main lease waits for each fighter on `main`. */
const waitingForMain = (report: Report, lease: Lease) => lease.loadMode === 'main' && !merchantOf(report) && report.map !== 'main';
export function waiting(report: Report, lease: Lease, now: number): boolean {
  if (merchantContinues(report, lease)) return false;
  const ack = record(report.consoleMaintenance);
  return !fresh(report.seenAt, now, 'recent') // R1
    || ack.id !== lease.id || ack.ready !== true // R2
    || lease.mode === 'draining' && (ack.mode !== 'draining' || ack.combat !== false) // R3
    || waitingForMain(report, lease); // R4
}
// The participants: every character with a report fresh by the merchant's reading (02 RF7's
// reading for this site), beside the expected names the caller adds.
export const participates = (report: Report, now: number) => fresh(report.seenAt, now, 'merchant-home', 0, true);

// Table S: deploy admission and the shutdown's hold. A member is a name with its live task (the tasks owner's
// `task.live`) and its reported map.
export interface Member { name: string; task: { kind: string; owner: string } | null; map?: unknown }
// A Cave of Many Dreams floor is a generated map, `zone_<hex>_<floor>`; the deploy admission and the
// character card's map label read it.
const CAVE_MAP = /^zone_[a-f0-9]+_\d+$/;
export const caveMap = (map: unknown): boolean => CAVE_MAP.test(String(map ?? ''));
/** S1: a safe or Main deploy waits out a Cave run; a member on a Cave map with no task yet counts. */
export function deployRefusal(mode: LoadMode, members: readonly Member[]): string | null {
  if (mode === 'now') return null;
  return members.some(member => member.task?.kind === 'cave' || caveMap(member.map)) ? 'This load mode is unavailable in Cave' : null;
}
/** S2: a clean shutdown waits out a Cave run or an event; a confirmed force overrides it. */
export function shutdownHold(members: readonly Member[]): string | null {
  for (const { name, task } of members) {
    if (task?.kind === 'cave') return `${name} is in a Cave run`;
    if (task?.kind === 'event-attendance') return `${name} is in the ${task.owner.split(':')[1]} event`;
  }
  return null;
}

// Table W: worker and code lifetime. One row per worker transition, each with today's
// outcome (LIF-004 to LIF-006, LIF-012, LIF-013); coordinator/workers.ts and coordinator/code.ts ask
// it, and each wait names its source in fields.ts.
export const TABLE_W = {
  /** Start: a realm that does not resolve refuses the start, and an unknown character turns its worker off. */
  start: (facts: { realm: boolean; character: boolean }) => !facts.realm ? 'realm-error' as const : !facts.character ? 'disable' as const : 'start' as const,
  /** Stop: a connected worker is told to close. Its last acknowledgement with an open boundary keeps
   *  its process until it exits (A67: a trade in flight finishes); otherwise the close grace bounds it. */
  stop: (facts: { connected: boolean; boundaryOpen: boolean }) => !facts.connected ? 'kill' as const : facts.boundaryOpen ? 'close-held' as const : 'close' as const,
  /** Exit: a retired worker's exit changes nothing; a client update restarts its own worker; an
   *  enabled worker restarts once its game cache repair answers; any other goes offline. */
  exit: (facts: { current: boolean; updating: boolean; enabled: boolean }) =>
    !facts.current ? 'ignore' as const : facts.updating ? 'update' as const : facts.enabled ? 'restart' as const : 'offline' as const,
  /** Realm error: retried when the account answers with the realm; a worker turned off or running stops waiting. */
  realm: (facts: { enabled: boolean; running: boolean; resolves: boolean }) =>
    !facts.enabled || facts.running ? 'drop' as const : facts.resolves ? 'start' as const : 'wait' as const,
  /** Client update: an enabled worker on the live client (no pinned version) restarts on the new one. */
  update: (facts: { enabled: boolean; pinned: boolean }) => facts.enabled && !facts.pinned,
  /** Reload reply: `busy` waits for the worker's next report that reads not busy; a failure that
   *  needs recovery restarts the worker; any other failure keeps the running generation. */
  reload: (reply: { status: 'ready' | 'busy' | 'failed'; restartRequired?: boolean }) =>
    reply.status === 'ready' ? 'activated' as const : reply.status === 'busy' ? 'retry' as const : reply.restartRequired ? 'restart' as const : 'keep' as const,
};

// Table I: the command intake on the character. The
// coordinator sends one command per status reply; character/intake.ts asks this table which commands
// it takes and how each one runs. A command runs only on the running row of table P with no deploy
// lease (P1 and P2 hold it, so the reply sends it again after Play); Manual (the tasks owner's hold `manual`) still hands items to the merchant, which moves no one but the
// merchant.
export function intakeAdmits(facts: { held: boolean; lease: boolean; hand: string | null | undefined; type: string }): boolean {
  if (facts.held || facts.lease) return false;
  return !facts.hand || facts.hand === 'manual' && facts.type === 'merchant-handoff';
}
type Label = string | ((command: { mail?: { recipient?: string }; action?: string }) => string);
/** A command's row: the owner whose door runs it, and the bands that door runs in.
 *  - `merchant`: only the merchant takes it; another character drops it.
 * - `job`: the merchant jobs owner's job band, under this label on the merchant's card.
 * - `combat`: the merchant jobs owner's band that waits out combat first, under this label.
 *  - `location`: a command without `location` has no place to go: its id is spent and its door does not run.
 *  - `walk`: a farming walk (02), which holds the walk's travel token for its run; `defensive` walks
 *    let 04 defend on the way.
 *  - `retry`: a failed run hands the command back, so the coordinator's next reply runs it again.
 *  - `own`: the door accepts the command itself, before the merchant's preparation and the takeover;
 *    it spends the id through the `accept` it is handed. */
export interface CommandRow {
  owner: string; merchant?: true; job?: Label; combat?: Label; location?: true;
  walk?: 'farm' | 'defensive'; retry?: true; own?: true;
}
// The key of a command: its type, with the convoy phases that run apart from a walk.
export const commandKey = (command: { type?: string; phase?: string }) =>
  command.type === 'party-monster-travel' && (command.phase === 'event-walk-release' || command.phase === 'defending')
    ? `${command.type}:${command.phase}` : String(command.type);
const job = (label: Label, combat: Label = label): CommandRow => ({ owner: '08', merchant: true, job: label, combat });
export const TABLE_I: Record<string, CommandRow> = {
  'party-monster-travel:event-walk-release': { owner: '02', walk: 'farm', own: true },
  'party-monster-travel:defending': { owner: '02', walk: 'farm', own: true },
  'merchant-production-recover': { owner: '10', own: true },
  'merchant-mluck': job("refreshing Merchant's Luck"),
  'merchant-service': job('merchant service'),
  'merchant-self-improve': job('merchant upgrades and compounds'),
  'merchant-self-bank': job('merchant bank exchange'),
  'merchant-bank-unlock': job('bank unlock', 'unlocking bank storage'),
  'merchant-deconstruct': job('merchant deconstruction'),
  'merchant-npc-sale': job('merchant NPC sale'),
  'merchant-donate': job('merchant donation'),
  'merchant-self-restock': job('merchant potion restock'),
  'merchant-upgrade-preview': { owner: '10', merchant: true, job: 'upgrade preview' },
  'merchant-commerce': job('merchant shopping and crafting'),
  'merchant-exchange': job('merchant exchange'),
  'merchant-stand-search': job('stand search'),
  'merchant-join-giveaway': job('joining giveaway'),
  // C2: an add-on merchant job, held like the core kinds.
  'addon-steps': job('add-on merchant job'),
  'merchant-stand-buy': job('stand purchase'),
  'merchant-ponty-buy': job('Ponty purchase'),
  'merchant-aldata-auth': job('ALData authentication'),
  'merchant-aldata-buy': job('ALData marketplace purchase'),
  'merchant-aldata-sell': job('ALData marketplace sale'),
  'merchant-collect-mail': job('collecting mail attachment'),
  'merchant-send-mail': job(command => 'sending mail to ' + (command.mail?.recipient || 'recipient'), 'sending mail'),
  'merchant-stand-sync': { owner: '08', merchant: true, job: 'stand inventory sync' },
  'merchant-idle': { owner: '08', merchant: true },
  'bankboi-service': { owner: '10', merchant: true },
  'merchant-gather': { owner: '08', merchant: true },
  'merchant-handoff': { owner: '08' },
  'merchant-order-handoff': { owner: '08', combat: 'merchant material handoff' },
  'restore-equipment': { owner: '10' },
  'apply-stat-scrolls': { owner: '10', combat: 'applying stat scrolls' },
  'monster-hunt-interact': { owner: '07', retry: true,
    combat: command => command.action === 'claim' ? 'claiming Monster Hunt' : 'accepting Monster Hunt' },
  bank: { owner: '10', combat: 'banking' },
  upgrade: { owner: '10', combat: 'upgrading' },
  travel: { owner: '02', location: true, walk: 'defensive' },
  'force-travel': { owner: '02', location: true, walk: 'farm' },
  'town-party': { owner: '02', retry: true },
  'event-return-town': { owner: '06', retry: true },
  'character-travel': { owner: '02', location: true, walk: 'defensive', combat: 'travel' },
  'party-monster-travel': { owner: '02', location: true, walk: 'farm' },
  'event-resume-travel': { owner: '06', location: true, walk: 'farm', retry: true },
  'return-leader': { owner: '02', walk: 'defensive', combat: 'returning to leader' },
  'use-item': { owner: '10' },
  equip: { owner: '10' },
  'equip-deliveries': { owner: '08' },
  unequip: { owner: '10' },
  give: { owner: '10' },
  'native-switch': { owner: '13' },
  'native-realm-switch': { owner: '08' },
  'realm-set-home': { owner: '08' },
};

// The card line's words for the lifecycle owner's holds: the player's Pause reads "Paused", a deploy's drain "Paused
// for console update", and " - finishing the fight" while the drain lets the character fight. The lifecycle walk to
// Main is The lifecycle owner's request.
export function holdLabel(paused: boolean, fighting: boolean): string {
  return (paused ? 'Paused' : 'Paused for console update') + (fighting ? ' - finishing the fight' : '');
}
// The lifecycle walk's card words, which its movement request carries (the status owner's table L8).
export const LIFECYCLE_WALK_LABEL = 'Travelling to Main - console load';

// The game's character name rule (adventure_functions.js `is_name_allowed`): 4 to the status owner of
// `allowed_name_characters` (letters, digits and _), not only digits, and never an inherited object
// key such as "constructor" (`is_safe_character_name`). The roster create, the storage character
// create and the giveaway's typed host read it. The create dialog types only its characters, at most
// CHARACTER_NAME_MAX of them, and enables Create from CHARACTER_NAME_MIN on, as b9b5c91e's dialog did;
// the storage create's refusal names every other case.
export const CHARACTER_NAME_MIN = 4;
export const CHARACTER_NAME_MAX = 12;
export const CHARACTER_NAME_REFUSAL = `name must be ${CHARACTER_NAME_MIN}-${CHARACTER_NAME_MAX} letters, numbers, or underscores, not only numbers`;
const NAME_PATTERN = new RegExp(`^[A-Za-z0-9_]{${CHARACTER_NAME_MIN},${CHARACTER_NAME_MAX}}$`);
export const nameCharacters = (text: string): string => text.replace(/[^A-Za-z0-9_]/g, '');
export function characterNameAllowed(name: string): boolean {
  const lower = name.toLowerCase();
  return NAME_PATTERN.test(name) && !/^\d+$/.test(name) && lower !== 'prototype' &&
    !Object.getOwnPropertyNames(Object.prototype).some(key => key.toLowerCase() === lower);
}
// The game server refuses a login past this many characters of one account online at once
// (node/server_functions.js `is_player_allowed`): it counts the owner's non-merchant characters
// against `options.character_limit`, which the live server's config outside the source sets to 3,
// and lets one merchant per owner through apart from that count. The headless slots, the
// participants a Steam handoff may hold and the switcher's login all stop there.
export const MAX_LOGGED_IN = 4;
// The Steam bridge's protocol (roster/bridge.ts posts it): version 2 carries the multi-character
// handoff's operation, and a client id or game session id longer than BRIDGE_ID_MAX_LENGTH is no
// bridge's (the bridge's id is a UUID).
export const BRIDGE_MULTI_VERSION = 2;
export const BRIDGE_ID_MAX_LENGTH = 100;
// The player's CODE stop flag in the game window's storage: the Steam recovery writes it when the
// player stops a character's CODE, and the loader and the recovery skip a stopped character.
export const codeStoppedKey = (name: string) => 'party-code-stopped:' + name;
export function codeStopped(storage: Pick<Storage, 'getItem'>, name: string | undefined): boolean {
  return storage.getItem(codeStoppedKey(String(name))) === '1';
}
// K-S5: the roster counts a character offline after this many account answers in a row show it so;
// one answer can lag a logout the game already made (ownership.ts `confirmOffline`).
export const OFFLINE_ANSWERS = 2;
