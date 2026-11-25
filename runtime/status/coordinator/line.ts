// The card line (the card line table in rules.ts): one line per
// character that the dashboard, the PWA and the APK read from the state's `activity`. The first row
// of the table that holds gives the line, and its words are the owner's that makes the state. It follows
// the character's task and that task's phase, never the movement of the moment, so
// walking to the next monster inside a farm still reads "Fighting <monster>". Replaces
// runtime/coordinator/status/activity.ts.
import type { Assignment as MemberAssignment } from '../../tasks/api.ts';
import { TIERS } from '../../protocol/ranks.ts';
import { DEAD_LABEL, ESCAPE_TASK_LABEL, partyDeathLabel, recoveryRuns } from '../../coordinator/survival/api.ts';
import type { EscapeHold, RecoveryView } from '../../hooks/registry.ts';
import { climbLabel, farmWalk, partyTravelLabel, walkLabel, type CardWalk } from '../../movement/api/coordinator.ts';
import { farmLine, farmWalkLine, huntLine, modeLine, RARE_TRAVEL_LABEL, rareWalkKind, rareWalkLine, slotPair } from '../../hunting/api.ts';
import { eventAttendanceLine, eventReturnLine } from '../../events/api.ts';
import { merchantLine } from '../../merchant-jobs/api.ts';
import { tripLabel } from '../../items/api.ts';
import { holdLabel, type LifecycleState } from '../../lifecycle/api.ts';
import type { HuntView } from '../../hunting/api.ts';
import { monsterFocus, type MemberFocusState } from '../../hunting/coordinator/api.ts';
import type { Tier } from '../../protocol/ranks.ts';
import { TABLE_L, type LineRow } from '../rules.ts';
import type { CardLine, GroupLine } from '../api.ts';
import { partyHooks } from '../../hooks/index.ts';

interface Point { map: string; x: number; y: number; label?: string }
interface LineWalk extends CardWalk { id: string; participants: string[]; location?: Point; walkingEvent?: string }
interface LineStatus {
  seenAt?: number; rip?: boolean; ctype?: string; map?: string;
  banking?: boolean; bankQueued?: boolean; stocking?: boolean;
  joinedEvent?: string | null; mapEvent?: string | null;
  // The lifecycle owner's acknowledgement of the drain: `combat` while the drain lets the character finish its fight.
  consoleMaintenance?: { combat?: boolean } | null;
  // The survival owner's member recovery record, with its card words while it runs.
  recovery?: { stage?: string; label?: string | null; recovery?: { phase?: string } | null } | null;
  movementClimb?: { activity?: string | null; trying?: string | null; notice?: string | null; incident?: string | null } | null;
  // The movement owner's `movement.live()`, with the holder's card words.
  movementLive?: { kind?: string; owner?: string; tier?: string; journey?: boolean; label?: string } | null;
  // The player's click to walk in the game client (the movement owner's `clicking`), with its card words.
  movementClick?: { walking?: boolean; label?: string } | null;
  // The event schedule the character reports (runtime/events/character/clock.ts `schedule`).
  eventSchedules?: unknown;
}
interface LineState {
  statuses: Record<string, LineStatus | undefined>;
  activeConvoy?: LineWalk | null;
  targetMode?: string;
  combatMode?: string;
  eventReturn?: { event?: string; participants: string[] } | null;
  merchantCharacter?: string | null;
  // The facts the hunting owner's monsterFocus reads for the member's focus.
  leader: MemberFocusState['leader'];
  followers: MemberFocusState['followers'];
  monsterHunt?: MemberFocusState['monsterHunt'];
  monsterFocus: MemberFocusState['monsterFocus'];
  monsterFocusByCharacter: MemberFocusState['monsterFocusByCharacter'];
  rareHuntState?: { encounter?: { mtype?: string; target?: { mtype?: string } } } | null;
}
interface LinePorts {
  assignment(name: string): MemberAssignment | null;
  monsterName(key: string): string | undefined;
  // The tasks owner's `task.status` for the member's group.
  groupLine?(name: string): GroupLine | null;
  // The lifecycle owner's `lifecycle.state()`: the Pause, and the drain with its participants.
  lifecycle(): LifecycleState;
  // The hunting owner's `hunt.view` for the member's group.
  hunt(name: string): HuntView | undefined;
  // the merchant jobs owner's `jobs.current`: whether the merchant runs a job, whose words its group line carries.
  merchantJob(): boolean;
  // The survival owner's `survival.escaping(name)` and the party's `survival.recovery(group)`, each with its words.
  escaping(name: string): EscapeHold | undefined;
  recovery(): RecoveryView | undefined;
  // The hunting owner's `cave.state()`: the visit's members and its travel repair's line.
  cave(): { members: string[]; travel: string | null };
  // The button label of a target or combat mode entry, from the slots that register it.
  entryLabel(slot: 'target-mode' | 'combat-mode', mode: string): string | undefined;
}

/**
 * The card lines as derived state: each read computes table L's answer with the add-ons'
 * `status.line` answers under it, and the kept line is replaced only when that answer changes, so a
 * reader holds one object per line until it changes. Each change of table L's own line sends
 * `status.lineChanged`. Nothing is saved; a restart derives the lines again from the
 * owners' reads.
 */
export function createCardLines(state: LineState, ports: LinePorts): (name: string) => CardLine | null {
  const kept = new Map<string, { line: CardLine; text: string; own: string }>();
  return name => {
    const answer = cardLine(state, ports, name);
    if (!answer) { kept.delete(name); return null; }
    const own = answer.line;
    const addons = partyHooks().statusLines({ character: name, line: own.text });
    const line = addons.length ? { ...own, addons } : own;
    const text = JSON.stringify(line), ownText = JSON.stringify(own), prior = kept.get(name);
    if (prior?.text === text) return prior.line;
    kept.set(name, { line, text, own: ownText });
    if (prior?.own !== ownText)
      partyHooks().notify('status.lineChanged', { character: name, line: own.text, task: own.task, phase: own.phase, by: answer.source });
    return line;
  };
}

// The card line table's answer for one character, with its group line and the row that gave it,
// or null before its first report.
function cardLine(state: LineState, ports: LinePorts, name: string): { line: CardLine; source: string } | null {
  const status = state.statuses[name];
  if (!status) return null;
  const group = ports.groupLine?.(name) ?? undefined;
  const { line, source } = memberLine(state, ports, name, status, group);
  return { line: group ? { ...line, group } : line, source };
}

// The member's line: table L's rows in order; the first that answers gives the line.
function memberLine(state: LineState, ports: LinePorts, name: string, status: LineStatus, group: GroupLine | undefined): { line: CardLine; source: string } {
  const monster = (key: string | null | undefined) => key ? ports.monsterName(key) ?? key : undefined;
  // The event schedules the characters report name each event.
  const eventName = (key: string) => Object.values(state.statuses).flatMap(s => Array.isArray(s?.eventSchedules) ? s.eventSchedules as { id?: string; name?: string }[] : [])
    .find(schedule => schedule.id === key)?.name;
  const event = (key: string | null | undefined) => key ? eventName(key) ?? monster(key) ?? key : undefined;
  // The member's focus is the list the hunting owner's farming reply sends it (modes.ts `monsterFocus`).
  const focus = () => {
    const keys = monsterFocus(state, name);
    return keys.length ? keys.map(key => monster(key)!).join(', ') : undefined;
  };
  const line = (task: string, phase: string, text: string): CardLine => ({ text, task, phase });
  const climb = status.movementClimb;
  // The climber rule: while the movement owner's climber serves the line's walk, its words replace the line, and its
  // stuck notice and record id ride with it.
  const climbing = (task: string, phase: string, text: string): CardLine => !climb?.activity ? line(task, phase, text)
    : { ...line(task, phase, climbLabel({ activity: climb.activity, trying: climb.trying })),
      ...(climb.notice ? { notice: climb.notice, ...(climb.incident ? { incident: climb.incident } : {}) } : {}) };
  const convoy = state.activeConvoy?.participants.includes(name) ? state.activeConvoy : null;
  const live = status.movementLive;
  const rows: Record<LineRow, () => CardLine | null> = {
    // Escape, then own death, then the party death recovery, then the member's respawn.
    survival: () => {
      const escape = ports.escaping(name);
      if (escape) return escape.climbs ? climbing('escape', escape.stage, escape.label) : line('escape', escape.stage, escape.label);
      if (status.rip) return line('death-recovery', 'dead', DEAD_LABEL);
      const party = ports.recovery();
      if (party && recoveryRuns(party.phase) && party.names.includes(name)) {
        const label = partyDeathLabel(party.phase, focus());
        if (label) return line('party-recovery', party.phase, label);
      }
      const respawn = status.recovery;
      if (respawn?.label) {
        const phase = respawn.recovery?.phase ?? respawn.stage!;
        if (climb?.activity) return climbing('death-recovery', phase, climb.activity);
        return line('death-recovery', phase, respawn.label);
      }
      return null;
    },
    // The player's click ranks as the player's command, below survival.
    click: () => status.movementClick ? line('click', status.movementClick.walking ? 'walking' : 'countdown', status.movementClick.label ?? '') : null,
    // A climber outside survival; its activity names the task it serves.
    climber: () => climb?.activity ? climbing('movement', 'climb', climb.activity) : null,
    // A Cave travel repair names the failing members and what the travel tries.
    cave: () => { const cave = ports.cave(); return cave.travel && cave.members.includes(name) ? line('cave', 'travel', cave.travel) : null; },
    // The player's Pause and a deploy's drain hold every task.
    held: () => {
      const { paused, drain } = ports.lifecycle();
      const draining = !!drain && 'participants' in drain && drain.participants.includes(name);
      if (!paused && !draining) return null;
      return line('pause', paused ? 'paused' : (drain as { lease: { phase?: string; mode?: string } }).lease.phase ?? 'draining',
        holdLabel(paused, draining && !!status.consoleMaintenance?.combat));
    },
    // A reason that needs the player's action loses only to the rows above.
    'needs-you': () => group?.reasons[0]?.needsAction ? line(group.reasons[0].kind, 'needs-action', group.label) : null,
    // The merchant's own line: its group line while the merchant jobs owner runs a job (it writes the job's words),
    // else the merchant jobs owner's banking or idle words.
    merchant: () => {
      if (name !== state.merchantCharacter) return null;
      if (ports.merchantJob() && group) return line('merchant', group.phase, group.label);
      const merchant = merchantLine(null, !!status.banking);
      return line('merchant', merchant.phase, merchant.label);
    },
    // The request that holds the character's movement; two holders at once rank by the rank
    // table, and a bag fact with no request ranks as an errand.
    holder: () => {
      const holders: { rank: number; line: CardLine }[] = [];
      // The request's own words on `movement.live` (the movement owner's for character travel and Town, the lifecycle owner's for
      // the lifecycle walk); an errand's words are the items owner's bag facts.
      if (live?.label && live.kind && HOLDERS.has(live.kind) && live.kind !== 'errand')
        holders.push({ rank: TIERS[live.kind as Tier].rank, line: line(live.kind, live.journey ? 'walk' : 'cast', live.label) });
      const party = convoy && partyTravelLabel(convoy), tier = convoy?.requester?.tier === 'app' ? 'app' : 'manual';
      if (party) holders.push({ rank: TIERS[tier].rank, line: line(tier, convoy!.phase, party) });
      if (status.banking || status.stocking || live?.kind === 'errand')
        holders.push({ rank: TIERS.errand.rank, line: line('errand', status.stocking ? 'stocking' : 'banking', tripLabel(!!status.stocking, status.map === 'bank')) });
      return holders.reduce<{ rank: number; line: CardLine } | null>((top, next) => !top || next.rank > top.rank ? next : top, null)?.line ?? null;
    },
  };
  for (const [index, row] of TABLE_L.entries()) {
    const answer = rows[row.row]();
    if (answer) return { line: answer, source: `L${index + 1}` };
  }
  // Otherwise (source 'L9') the member's group task.
  return { line: taskLine(state, ports, name, status, convoy, focus, event, monster, group), source: 'L9' };
}

// The requests the card line table names as holders of the character's movement.
const HOLDERS = new Set(['manual', 'app', 'town', 'lifecycle', 'errand']);

// The card keeps its own line kinds beside the group line from `status()` (01 step 5b): the Hunt's
// tasks, and the farming its backup runs, read as the Hunt's line while the member is in the Hunt;
// every other core task reads as the farm line. An add-on's task reads as its own label, which it
// sets through `task.request` and `task.update` (12 design table L, "An add-on task's line").
type CardKind = 'escape' | 'event-return' | 'event' | 'hunt' | 'farm' | 'idle' | 'addon';
function cardTask(hunt: HuntView | undefined, task: MemberAssignment | null): { kind: CardKind; event?: string; away?: string; apart?: MemberAssignment['apart'] } {
  const kind = task?.kind ?? 'idle';
  const goal = task?.goal as { event?: string } | undefined;
  if (kind === 'escape' || kind === 'event-return' || kind === 'idle') return { kind };
  if (kind.startsWith('addon:')) return { kind: 'addon' };
  if (kind === 'event-attendance') return { kind: 'event', event: task?.event, away: goal?.event, apart: task?.apart };
  if (hunt?.stage) return { kind: 'hunt' };
  return { kind: 'farm' };
}

function taskLine(state: LineState, ports: LinePorts, name: string, status: LineStatus, convoy: LineWalk | null,
  focus: () => string | undefined, event: (key: string | null | undefined) => string | undefined, monster: (key: string | null | undefined) => string | undefined,
  group: GroupLine | undefined): CardLine {
  const hunt = ports.hunt(name), task = cardTask(hunt, ports.assignment(name));
  const live = status.movementLive;
  const line = (phase: string, text: string): CardLine => ({ text, task: task.kind, phase });
  // A task's walk: the movement owner's words, with the task's purpose.
  const walk = (purpose: string, travelling: string): CardLine => line(convoy?.phase ?? 'walk', walkLabel(convoy, purpose, travelling));
  const owned = (answer: { phase: string; label: string } | { walk: { purpose: string; travelling: string } }) =>
    'walk' in answer ? walk(answer.walk.purpose, answer.walk.travelling) : line(answer.phase, answer.label);
  // The group's mode task names both modes, in the hunting owner's words.
  const modes = (answer: CardLine): CardLine => {
    const pair = slotPair(undefined, state);
    const target = ports.entryLabel('target-mode', pair.targetMode), combat = ports.entryLabel('combat-mode', pair.combatMode);
    return target && combat ? { ...answer, text: modeLine(target, combat, answer.text) } : answer;
  };
  switch (task.kind) {
    case 'event-return':
      return owned(eventReturnLine(event(state.eventReturn?.event) ?? 'event', !!(convoy || live?.journey)));
    case 'event': {
      const attending = status.joinedEvent === task.event || status.mapEvent === task.event;
      const travelling = convoy?.walkingActivity === 'event' || live?.tier === 'event-attendance' && !!live.journey;
      return owned(eventAttendanceLine(event(task.event) ?? 'event', attending, travelling,
        task.apart ? { kind: task.apart, away: event(task.away) ?? 'an event' } : undefined));
    }
    case 'hunt':
      return modes(owned(huntLine(hunt?.stage ?? undefined, monster(hunt?.target), focus())));
    case 'farm': case 'idle': {
      const rareWalk = rareWalkKind(convoy?.purpose);
      if (convoy && rareWalk) {
        const w = rareWalkLine(rareWalk === 'patrol', monster(state.rareHuntState?.encounter?.mtype ?? state.rareHuntState?.encounter?.target?.mtype), convoy.label);
        return walk(w.purpose, w.travelling);
      }
      if (live?.tier === 'rare' && live.journey) return { text: RARE_TRAVEL_LABEL, task: 'rare', phase: 'walk' };
      const farm = focus();
      const farming = (answer: CardLine) => task.kind === 'farm' ? modes(answer) : answer;
      if (convoy && farmWalk(convoy)) { const w = farmWalkLine(farm); return farming(walk(w.purpose, w.travelling)); }
      if (live?.tier === 'farming' && live.journey && (live.owner ?? '').startsWith('reunion:')) return farming(line('reunion', farmWalkLine(farm).travelling));
      return farming(owned(farmLine(task.kind === 'idle', farm)));
    }
    case 'escape': return line('pending', ESCAPE_TASK_LABEL);
    // The group line names the live task's label and phase (the tasks owner's `task.status`).
    case 'addon': return group ? line(group.phase, group.label) : line('start', ports.assignment(name)!.kind);
  }
}
