// The groups and tasks owner's rule tables: the task rows, the questions answered from the table, the task ladder and the end codes.
// This is the only
// place the groups and tasks owner decides who wins, what a record means, who may act and what a failure does. A task
// ranks at its row's tier in `TIERS` (runtime/protocol/ranks.ts), so a group walk's movement rank
// and its task's rank are one entry.
import { TIERS, type Tier } from '../protocol/ranks.ts';
import { PROGRESS_DISTANCE } from '../protocol/ladder.ts';
// The Follow setting reads through `played`, so an add-on's overlay plays.
import { played } from '../settings/api.ts';


export const GROUP_KINDS = ['party', 'solo', 'merchant'] as const;
export type GroupKind = (typeof GROUP_KINDS)[number];
export type CoreTaskKind = 'escape' | 'death-recovery' | 'cave' | 'lifecycle' | 'realm-hold' | 'manual' | 'app' |
  'event-attendance' | 'hunt-turn-in' | 'event-return' | 'merchant-job' | 'rare' | 'hunt-mission' | 'farming' | 'idle';
export type TaskKind = CoreTaskKind | `addon:${string}`;
export type Interrupted = 'suspend' | 'cancel';
// The wind-down steps of section 2.2 that run before the row's task acts when it takes over.
export type WindDown = 'none' | 'finish' | 'finish-regroup';
// `reunion`: the farm reunion runs on its own (`alone`), only from a coordinator command
// (`command`), or not at all (`no`).
export type Reunion = 'alone' | 'command' | 'no';
// One list of end codes for every owner, movement's plus the tasks owner's and its sources'.
export type EndCode = 'done' | 'released' | `replaced:${string}` | `cancelled:${string}` | 'cancelled' | 'expired' | 'event-over' |
  'member-left' | `failed:${string}` | `refused:${string}` | 'returned-to-safe' | 'user' | 'runtime-replaced' | 'arrived' |
  'escaped' | 'recovered' | 'visit-ended' | 'returned' | 'hunt-ended' | 'rare-ended' | 'realm-done' | 'job-done';
// The declared order: the core sources ask in the order the console's providers asked, the
// player's trips first as a load restored them before every source, whichever owner's install
// publishes each one first (other owners publish theirs from their own modules).
export const SOURCE_ORDER = ['core:manual', 'core:follow-me', 'core:cave', 'core:survival-tasks', 'core:event',
  'core:merchant-realm', 'core:merchant-jobs', 'core:rare', 'core:slot', 'core:hunt'] as const;
export interface TaskAsk {
  kind: TaskKind; owner?: string;
  // An add-on names `addon-task` (section 5); core kinds take their row's tier.
  tier?: Tier;
  // A rare's "May interrupt Hunt" switch. It narrows the rare only while it is off.
  interruptsHunt?: boolean;
  // A rare's monster type, which `group.questions` hands an add-on with the question `rare`.
  rare?: string;
  // An add-on's request names its own columns; a core kind takes its row's.
  interrupted?: Interrupted; windDown?: WindDown; visit?: boolean; reunion?: Reunion;
}
interface Row {
  tier: Tier; groups: readonly GroupKind[];
  // "When interrupted" (2.2). A takeover cancels escape because only the player's command ends it
  //, and idle keeps nothing.
  interrupted: Interrupted;
  windDown: WindDown;
  // `allows('merchant-visit')` while the row is live (2.2 "Merchant visit").
  visit: boolean;
  reunion: Reunion;
  // A task with nothing below it to fall back to waits on the `wait` rung in place of
  // `fall-back`: farming is every combat group's fallback, the realm hold keeps a due step,
  // and a Hunt turn-in restarts from where the members stand (4.2 "Daisy return held").
  fallBack: 'wait' | 'end';
  // A rare does not wait behind a higher task (1.3 `refused`); its chance passes with its encounter.
  waits: boolean;
  // The row's task does not hold the group while an event attendance is due for a member.
  dueYields: boolean;
}
const ALL: readonly GroupKind[] = GROUP_KINDS;
const FIGHTERS: readonly GroupKind[] = ['party', 'solo'];
const row = (tier: Tier, groups: readonly GroupKind[], interrupted: Interrupted, windDown: WindDown, visit: boolean,
  reunion: Reunion = 'no', fallBack: Row['fallBack'] = 'end', waits = true, dueYields = false): Row =>
  ({ tier, groups, interrupted, windDown, visit, reunion, fallBack, waits, dueYields });
// The task rows, highest first. A solo group has no escape or rare source, and has
// the Cave row only while it holds a visit participant still inside. The merchant has
// no Hunt, Cave, rare or farming.
const ROWS: Record<CoreTaskKind, Row> = {
  escape: row('escape', ['party'], 'cancel', 'none', false),
  'death-recovery': row('death-recovery', ALL, 'suspend', 'finish', false),
  cave: row('cave', FIGHTERS, 'suspend', 'finish-regroup', false),
  // No 01 source asks this row: Load in Main, the checkpoint return and the drain park are movement
  // requests of kind `lifecycle` from the lifecycle owner's drain.
  lifecycle: row('lifecycle', ALL, 'suspend', 'finish', false),
  'realm-hold': row('realm-hold', ['merchant'], 'suspend', 'none', false, 'no', 'wait'),
  manual: row('manual', FIGHTERS, 'suspend', 'none', true, 'command'),
  app: row('app', FIGHTERS, 'suspend', 'none', true, 'command'),
  'event-attendance': row('event-attendance', ALL, 'suspend', 'finish-regroup', true),
  'hunt-turn-in': row('hunt-turn-in', FIGHTERS, 'suspend', 'finish', false, 'command', 'wait', true, true),
  'event-return': row('event-return', ALL, 'suspend', 'finish', true, 'command'),
  'merchant-job': row('errand', ['merchant'], 'suspend', 'none', false),
  rare: row('rare', ['party'], 'cancel', 'none', true, 'no', 'end', false),
  'hunt-mission': row('hunt-mission', FIGHTERS, 'suspend', 'finish', true, 'alone'),
  farming: row('farming', FIGHTERS, 'suspend', 'finish', true, 'alone', 'wait'),
  idle: row('idle', ALL, 'cancel', 'none', true, 'alone', 'wait'),
};
// An add-on's row: the registration names its groups and its columns (section 5).
const ADDON = row('addon-task', ALL, 'suspend', 'none', true);
const isAddon = (kind: TaskKind): kind is `addon:${string}` => kind.startsWith('addon:');
const rowOf = (kind: TaskKind): Row => {
  const found = isAddon(kind) ? ADDON : ROWS[kind];
  if (!found) throw Error(`${kind} is not a task row`);
  return found;
};

// The tier a task ranks at. An add-on that names any tier but `addon-task` breaks the request
// protocol; the hook registry refuses that registration at load, so no clamp runs here.
export function taskTier(ask: Pick<TaskAsk, 'kind' | 'tier'>): Tier {
  if (!isAddon(ask.kind)) return rowOf(ask.kind).tier;
  if (ask.tier !== undefined && ask.tier !== 'addon-task') throw Error(`${ask.kind} names the tier ${ask.tier}; an add-on task names addon-task`);
  return 'addon-task';
}
export const above = (a: Tier, b: Tier) => TIERS[a].rank > TIERS[b].rank;
const HUNT: readonly TaskKind[] = ['hunt-mission', 'hunt-turn-in'];

export type TaskDecision = { decision: 'granted'; interrupted?: Interrupted } | { decision: 'kept' | 'waiting' | 'refused' };
// With its switch off a rare never takes a group whose Hunt task is live. A rare never takes
// a group whose add-on task refuses it. The owner asks `group.questions` the question `rare` only of
// the add-on whose task the group runs, so the refusal is that add-on's "May interrupt" for its own
// task, and `addonRefuses` is that answer.
export function rareRefused(live: TaskAsk, incoming: TaskAsk, addonRefuses: boolean): boolean {
  if (incoming.kind !== 'rare') return false;
  return incoming.interruptsHunt === false && HUNT.includes(live.kind) || isAddon(live.kind) && addonRefuses;
}
// An add-on's own task hears the question `preempt` when a core task ranked from the Hunt
// mission up to event attendance would take its group. Its `false` keeps the group, and the core
// task waits. A rare hears `rare` instead. The player's commands and every task at `town` or above
// take the group with no question.
export function preemptAsked(live: TaskAsk, incoming: TaskAsk): boolean {
  if (!isAddon(live.kind) || isAddon(incoming.kind) || incoming.kind === 'rare') return false;
  const tier = TIERS[taskTier(incoming)].rank;
  return tier >= TIERS['hunt-mission'].rank && tier <= TIERS['event-attendance'].rank;
}
// Rule 2.3.1: a request ranks against the live task. A higher tier takes the group, an equal
// one keeps the live task, and the same identity is the same task. The Player command column
// lets the player's `manual` command end an escape or a death recovery, as movement's
// `decide` does for their walks, so the task and its walks agree on every pair.
export function judge(live: TaskAsk | undefined, incoming: TaskAsk, addonRefuses = false): TaskDecision {
  if (!live) return { decision: 'granted' };
  if (incoming.owner !== undefined && incoming.owner === live.owner) return { decision: 'kept' };
  const held = taskTier(live), tier = taskTier(incoming);
  if (incoming.kind === 'manual' && TIERS[held].player === 'ends') return { decision: 'granted', interrupted: 'cancel' };
  const refusesRare = rareRefused(live, incoming, addonRefuses), preempted = preemptAsked(live, incoming) && addonRefuses;
  if (above(tier, held) && !refusesRare && !preempted) return { decision: 'granted', interrupted: column(live, 'interrupted') };
  return { decision: rowOf(incoming.kind).waits && !refusesRare ? 'waiting' : 'refused' };
}
// A row's column for a task. An add-on's own request fields name its columns; a core kind
// takes its row's.
export function column<K extends 'interrupted' | 'windDown' | 'visit' | 'reunion'>(ask: TaskAsk, key: K): Row[K] {
  return (isAddon(ask.kind) ? ask[key] as Row[K] | undefined : undefined) ?? rowOf(ask.kind)[key];
}
export const dueYields = (kind: TaskKind) => rowOf(kind).dueYields;
// A group whose wiring has no source for a row never requests it, so the owner
// refuses a request for one. An add-on's task runs only in the group kinds its `task.request`
// answer names, when it names any; a core row keeps its own kinds.
export function offers(group: GroupKind, kind: TaskKind, groups?: readonly GroupKind[]): boolean {
  if (isAddon(kind) && groups) return groups.includes(group);
  return rowOf(kind).groups.includes(group);
}

// `groups`: what the one combat group composition (application.ts
// `composeCombatGroup`) runs for each kind of combat group. A solo group moves its one character.
// The escape, death recovery, rare and Follows me sources run only in the party (the Groups
// column), so a solo group has no escape to release, no party death recovery, no rare hunt and no
// member holds on its walks. A solo heartbeat reads the hand-in without the event yield, as
// b9b5c91e's solo services did.
export interface GroupColumns { members: 'scope' | 'one'; escape: boolean; deathRecovery: boolean; rare: boolean; holds: boolean;
  turnIn: 'heartbeat' | 'travel' }
export const GROUPS: Readonly<Record<'party' | 'solo', GroupColumns>> = {
  party: { members: 'scope', escape: true, deathRecovery: true, rare: true, holds: true, turnIn: 'heartbeat' },
  solo: { members: 'one', escape: false, deathRecovery: false, rare: false, holds: false, turnIn: 'travel' },
};

// The hand control switches, which the dashboard's card and the formation route read: Manual or Pause, the potions and combat a Manual character
// keeps, and "While I play this character, the party" (Follows me by default).
export interface HandControl { on: boolean; usePotions: boolean; combat: boolean; party: 'follows-me' | 'carries-on' }
export const HAND_CONTROL_DEFAULT: HandControl = { on: false, usePotions: true, combat: true, party: 'follows-me' };
export function validHandControl(value: unknown): value is HandControl {
  const v = value as Partial<HandControl> | null;
  return !!v && typeof v === 'object' && typeof v.on === 'boolean' && typeof v.usePotions === 'boolean' && typeof v.combat === 'boolean' &&
    (v.party === 'follows-me' || v.party === 'carries-on');
}

// A saved trip: its group, identity, walkers, goal (`destination`), start,
// tier kind and line. The coordinator's load reads the saved list with savedManual, so the rule sits
// in the table file the load can import without the task owner's coordinator code.
export interface SavedManual { group: string; owner: string; members: string[]; destination?: unknown; since: number; kind?: 'manual' | 'app'; label?: string }
// The saved entries as the settings journal holds them; savedManual drops an entry of another shape.
export function savedManual(value: unknown): SavedManual[] {
  return (Array.isArray(value) ? value : []).filter((entry): entry is SavedManual => !!entry && typeof entry === 'object' &&
    typeof entry.group === 'string' && typeof entry.owner === 'string' && Array.isArray(entry.members) && Number.isFinite(entry.since));
}
// The questions the table answers alone. `merchant-visit` reads the live task's visit column;
// `event-attendance` is false while a task above event attendance holds the group. An
// add-on's task also hears `rare` (rareRefused), which the table never answers alone.
export type Question = 'merchant-visit' | 'event-attendance';
export function allows(question: Question, live: TaskAsk): boolean {
  if (question === 'merchant-visit') return column(live, 'visit');
  return !above(taskTier(live), 'event-attendance');
}
// `death-recovery`: no party death recovery while a
// member is at an event, read from the member's one event fact.
export function deathRecoveryAllows(presence: unknown): boolean { return !presence; }
// `busy`: why a target mode entry may not act now, or null. It acts while its task
// may act (`runs`), and waits while a walk other than its own target walk runs in its group. The
// walk is the one movement's notices name.
export function busy(runs: boolean, walk: { purpose: string | null; phase: string } | undefined): string | null {
  if (!runs) return 'another task holds the party';
  return walk && walk.purpose !== 'manual-monster-override' && !['complete', 'failed'].includes(walk.phase) ? 'the party is travelling' : null;
}
// `walk:<activity>` (b9b5c91e application.ts:2002, the solo allow list): the town and event
// returns always walk; an event walk walks while the hand-in yields to a due event; any other walk
// waits while the group's Hunt record is a hand-in. An event walk does not take over the live trip
// while the trip winds down.
export function walkAllowed(activity: string, turnIn: boolean, yieldsToEvent: boolean, tripWindsDown = false): boolean {
  if (activity === 'event') return !tripWindsDown && (yieldsToEvent || !turnIn);
  return activity === 'town-return' || activity === 'event-return' || !turnIn;
}

// The `hunt` row's hand-in: a Daisy return or turn-in that is not complete. The record is the
// Hunt's (runtime/hunting/coordinator/hunt.ts `Hunt`).
export interface HuntRecord { stage: string; turnIn?: { phase: string }; eventReleaseAt?: number; participants: string[] }
export function priority(hunt: HuntRecord | null | undefined): boolean {
  if (!hunt) return false;
  if (hunt.turnIn) return hunt.turnIn.phase !== 'complete';
  return hunt.stage === 'returning' || hunt.stage === 'at-daisy';
}
// The holds: a hold is not a task. `acting` is whether the hold
// stops every source's acting tick in its group (the sources still observe). The
// console Pause stops every group until Play; the escape's hold stops the suspended task until
// Resume. The Cave Hold holds the visit's group with the visit task still live, the
// Hunt's `intent` hold stops only that group's travel, and an add-on's `group.hold` stops what
// `intent` stops. Manual and Pause hold one member: the console moves it in no walk.
export type HoldBy = 'user' | 'escape' | 'cave-hold' | 'intent' | 'manual' | 'pause' | `addon:${string}`;
export const stopsActing = (by: HoldBy) => by === 'user' || by === 'escape';

// The task ladder: the requester's answer one level above movement's walk ladder. A
// failure moves the live task one rung on and progress moves it back to `walk`; no count ends the
// ladder. nextRung skips `alternative` for a task with none left and `fall-back` for a
// task whose row waits in place, and a failure on `wait` waits again.
export const RUNGS = ['walk', 'alternative', 'regroup', 'safe-point', 'fall-back', 'wait'] as const;
export type Rung = typeof RUNGS[number];
export interface FailOptions {
  // The task still has an alternative of its own: the next spawn, the next farm area.
  alternative?: boolean;
  // The rung the failure ran at, when the source counts its own failures past the owner's rung:
  // a merchant job's booked failures (merchant-jobs/rules.ts `ladderFrom`).
  from?: Rung;
  // What the task tries on the next report, for the line "Stuck - trying <rung>".
  trying?: string;
}
export function nextRung(at: Rung, kind: TaskKind, options: FailOptions = {}): Rung {
  const from = Math.max(RUNGS.indexOf(at), RUNGS.indexOf(options.from ?? 'walk'));
  // A failure on `wait`, the owner's or the source's, waits again, so `from + 1` below always
  // names a rung.
  if (RUNGS[from] === 'wait') return 'wait';
  let next = RUNGS[from + 1]!;
  if (next === 'alternative' && !options.alternative) next = 'regroup';
  if (next === 'fall-back' && rowOf(kind).fallBack === 'wait') next = 'wait';
  return next;
}
// The wait rung's "report that shows a change" is movement's progress test:
// a new map, `PROGRESS_DISTANCE` units of movement, a death or a respawn.
export interface ReportPoint { map?: string; x?: number; y?: number; rip?: unknown }
export function reportChanged(before: ReportPoint | undefined, after: ReportPoint | undefined): boolean {
  if (!before || !after) return !!before !== !!after;
  return before.map !== after.map || !!before.rip !== !!after.rip ||
    Math.hypot(Number(after.x) - Number(before.x), Number(after.y) - Number(before.y)) >= PROGRESS_DISTANCE;
}

// A farming scope's owner: a follower farms in its leader's scope, and the merchant always in its
// own, whatever its saved follower mark says. The coordinator's scopes (coordinator/groups.ts)
// and the dashboard's card read this one rule; a character whose owner is another is never offered
// a route of its own.
export function scopeOwner(party: { leader?: string | null; followers?: Record<string, boolean>; merchantCharacter?: string | null }, name: string): string {
  return party.leader && name !== party.merchantCharacter && played(party, 'followers', name)?.[name] ? party.leader : name;
}
// The groups the named members form by scopeOwner: the leader's group with its followers, the leader
// first, and each other member alone. The merchant and the BankBoi storage characters join no group.
// the merchant jobs owner's party visit and the dashboard's Send to party list read it.
export function scopeGroups(
  party: Parameters<typeof scopeOwner>[0] & { bankbois?: Record<string, unknown> | { name: string }[] },
  names: string[],
): { id: string; members: string[] }[] {
  const groups = new Map<string, string[]>();
  const storage = new Set(Array.isArray(party.bankbois) ? party.bankbois.map(worker => worker.name) : Object.keys(party.bankbois || {}));
  for (const name of new Set(names)) {
    if (name === party.merchantCharacter || storage.has(name)) continue;
    const owner = scopeOwner(party, name), members = groups.get(owner) || [];
    members.push(name);
    groups.set(owner, members);
  }
  return [...groups].map(([id, members]) => ({ id, members: members.sort((a, b) => a === id ? -1 : b === id ? 1 : a.localeCompare(b)) }));
}
