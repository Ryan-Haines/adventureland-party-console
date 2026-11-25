// The party escape's stages on the coordinator (the stage table).
// A mage leads whenever one is alive: it Blinks to a landing and Magiports each other living
// participant in turn while its MP covers it. Whom it cannot port walks the safe path, and a member
// that dies or whose reports stop leaves the remaining stages for its own death recovery or the
// walk. With no mage every participant walks. Each crossing stage ends on its reply (the mage
// reports a refused or lost one), so no stage needs a deadline. Each stage change tells
// `survival.escapeStage`, a start `survival.escapeStarted`, and a stage that ends the escape's
// walking `survival.escapeEnded`.
import { fresh } from '../../protocol/reports.ts';
import type { EscapeHold } from '../../hooks/registry.ts';
import { partyHooks } from '../../hooks/index.ts';
import { ESCAPE_SETTLED } from '../../characters/survival/lines.ts';
import { escapeLabel } from '../../characters/survival/records.ts';

// The safe table's death goal (movement's rules.ts `SafeGoal`), which escape and death recovery share.
export interface SafeHome { goal: 'death' | 'town'; map: string; x: number; y: number; radius: number; spawn: number }

export interface EscapeStatus {
  ctype?: string; rip?: boolean; hp?: number; map?: string; in?: string | number; x?: number; y?: number; seenAt?: number;
  moving?: boolean; movement?: { done?: unknown } | null; reportIntervalMs?: unknown; lastDeath?: unknown;
  groupedCombat?: { currentAttackers?: unknown[]; threats?: unknown[] } | null;
  escape?: { id?: string; landed?: boolean; destination?: { map: string; in?: string | number; x: number; y: number } | null; blinkFailed?: boolean;
    error?: string; ported?: string; portFailed?: { stage?: string; reason?: string } | null } | null;
}
export interface PartyEscape {
  id: string; leader: string | null; participants: string[]; ports: string[]; walk: string[]; ported: string[];
  dropped: Record<string, string>; stage: string; startedAt: number; progress: Record<string, unknown>; error: string | null;
  deaths: Record<string, unknown>; recoveryAt?: number; home?: SafeHome; destination?: { map: string; in?: string | number; x: number; y: number } | null;
  convoyId?: string;
}
// The payload of `survival.escapeStarted`, `survival.escapeStage` and `survival.escapeEnded`:
// the group and the escape's id with who decided, and each notice's own fields.
export type EscapeNotice = {
  group: string; id: string; by: string;
  leader?: string | null; participants?: string[]; walk?: string[]; home?: SafeHome | null; resetsFight?: boolean;
  from?: string; to?: string; member?: string | null; reason?: string | null; stage?: string;
};
// The records the escape reads: its own (`escape`), the members' reports, the group's walk, and the
// party death recovery whose escape it may be (recovery.ts).
export interface EscapeState {
  escape: PartyEscape | null;
  statuses: Record<string, EscapeStatus | undefined>;
  activeConvoy?: { id?: string; phase?: string; failure?: string; purpose?: string | null } | null;
  combatRecovery?: { phase: string; names: string[]; home?: SafeHome; leader: string | null; policy: string; focus: string; revisions: Record<string, number> } | null;
  leader: string | null; targetMode: string; monsterFocus?: unknown; navigationIntents?: Record<string, { revision: number; cancelled?: boolean } | undefined>;
}
export interface EscapePorts {
  now(): number;
  persist(): void;
  // The safe table's death goal for a death on `map`, or null without game data, and movement's
  // arrival at it (rules.ts `isSafeAt`), the one check escape and death recovery read.
  home(map: string | undefined): SafeHome | null;
  atHome(status: { map?: string; in?: string | number; x?: number; y?: number }, home: SafeHome): boolean;
  // Movement's arrival tolerance, the distance a ported member counts as beside the mage.
  arrival: number;
  // Ends the group's walk with the escape's end code (`walks.end(group, 'escape')`).
  endWalk(): void;
  // The recovery convoy that gathers the party at the escape's home goal.
  convoy(names: string[], home: SafeHome): unknown;
  group(): string;
  // The lifecycle owner's answer whether a member is online by any client
  // (roster-projection.ts `online`).
  online(name: string): boolean;
  notify(hook: 'survival.escapeStarted' | 'survival.escapeStage' | 'survival.escapeEnded', payload: EscapeNotice): void;
}

const WALK = ['recovering', 'recovery-convoy', 'failed-hold', 'home', 'released'];
// The stages that end the escape's walking: the settled ones, which hold the party until the
// player's command, and the player's release.
const ENDS: readonly string[] = [...ESCAPE_SETTLED, 'released'];
const dead = (s: EscapeStatus | undefined) => !s || !!s.rip || Number(s.hp) <= 0;

function recoveryMembershipOwned(state: EscapeState, escape: PartyEscape): boolean {
  const recovery = state.combatRecovery;
  return !!recovery && ['escaping', 'recovering'].includes(recovery.phase) &&
    recovery.leader === state.leader && recovery.policy === state.targetMode &&
    recovery.focus === JSON.stringify(state.monsterFocus) &&
    escape.participants.every(name => recovery.names.includes(name)) &&
    recovery.names.every(name => {
      const intent = state.navigationIntents?.[name];
      return !!intent && !intent.cancelled && intent.revision === recovery.revisions[name];
    });
}

export function createPartyEscape(state: EscapeState, ports: EscapePorts) {
  const owns = (name: string) => !!(state.escape && state.escape.stage !== 'released' && state.escape.participants.includes(name));
  // One notice per stage change, and the end notice when the stage ends the escape's walking.
  function stage(e: PartyEscape, to: string, reason: string | null = e.error, member: string | null = null, by = 'core:survival'): void {
    const from = e.stage;
    e.stage = to;
    if (from === to) return;
    ports.notify('survival.escapeStage', { group: ports.group(), id: e.id, from, to, member, reason, by });
    if (ENDS.includes(to)) ports.notify('survival.escapeEnded', { group: ports.group(), id: e.id, stage: to, by });
  }
  // The status owner's command slot drops each participant's pending command on `survival.escapeStarted`
  // (the status owner's command slot).
  function cancel(): void {
    ports.endWalk();
  }
  // Every member walks home from whatever stage the escape stood in; the notice names that stage.
  function recover(e: PartyEscape, reason: string): void {
    e.error = reason; e.recoveryAt = ports.now(); e.destination = null; stage(e, 'recovering', reason);
    cancel(); ports.persist();
  }
  function fail(reason: string): void {
    const e = state.escape;
    if (e && !WALK.includes(e.stage)) recover(e, reason);
  }
  // Per member at each read: a report is late after 3 s while an attacker on that member is
  // known, and after two of its own report intervals otherwise. A late report holds the member's
  // stage; only the lifecycle owner's answer that it is offline drops it.
  function late(s: EscapeStatus | undefined): boolean {
    if (!s) return true;
    const attackerKnown = !!(s.groupedCombat?.currentAttackers?.length || s.groupedCombat?.threats?.length);
    return !fresh(s.seenAt, ports.now(), { reading: 'walk', attackerKnown, intervalMs: s.reportIntervalMs });
  }
  // Today's port order: the warrior, then the priest, then the rest by name.
  function portOrder(names: string[]): string[] {
    const rank = (name: string) => ({ warrior: 0, priest: 1 } as Record<string, number>)[String(state.statuses[name]?.ctype)] ?? 2;
    const core = [...names].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    // An add-on may order the same members another way.
    return partyHooks().survival.choice({ question: 'ports', member: core[0] ?? '', options: [core], core });
  }
  function start(names: string[], by = 'core:survival'): PartyEscape {
    if (state.escape && !ENDS.includes(state.escape.stage)) return state.escape;
    // Every requested member evacuates, including members whose class has not arrived yet.
    const participants = [...new Set(names)];
    const deaths = Object.fromEntries(participants.map(name => [name, state.statuses[name]?.lastDeath]));
    // The dead walk from the start: their own death recovery respawns them at the same home.
    const walk = participants.filter(name => dead(state.statuses[name]));
    const leader = participants.find(name => !walk.includes(name) && state.statuses[name]?.ctype === 'mage') || null;
    const e: PartyEscape = state.escape = { id: 'escape-' + ports.now(), leader, participants,
      ports: leader ? portOrder(participants.filter(n => n !== leader && !walk.includes(n))) : [],
      walk, ported: [], dropped: Object.fromEntries(walk.map(n => [n, 'dead'])),
      stage: leader ? 'blink' : 'recovering', startedAt: ports.now(), progress: {}, error: null, deaths };
    if (!leader) e.recoveryAt = ports.now();
    // The escape walks to the safe table's death goal. A death recovery's escape takes the
    // recovery's own goal, so both wait for one place.
    const recovery = state.combatRecovery;
    const home = recovery?.home && recovery.phase === 'escaping' && participants.every(name => recovery.names.includes(name)) ?
      recovery.home : ports.home(state.statuses[participants[0]!]?.map);
    if (home) e.home = home;
    cancel();
    // No escape start resets the grouped fight by itself; the recovery's own phase change does
    // (recovery.ts `escape`), so `resetsFight` is false here.
    ports.notify('survival.escapeStarted', { group: ports.group(), id: e.id, leader, participants: [...participants], walk: [...walk], home: e.home ?? null, resetsFight: false, by });
    // Without game data the coordinator knows no safe goal, so the escape holds where the
    // party stands, because it cannot check a place it has no game data for.
    if (!home) { e.error = 'No game data for the safe goal'; stage(e, 'failed-hold'); ports.persist(); return e; }
    step(); ports.persist(); return e;
  }
  // The player's release, or the death recovery's once its members stand safe at home.
  function release(by = 'player'): void {
    if (!state.escape || state.escape.stage === 'released') return;
    cancel(); stage(state.escape, 'released', null, null, by); ports.persist();
  }
  // Active owned journeys omit `done`; terminal movement receipts include it. A paused or
  // between-node walker is not an acknowledged safety arrival.
  const settled = (s: EscapeStatus) => !s.moving && (!s.movement || typeof s.movement.done === 'boolean');
  // A ported member stands where the mage stands: Magiport places it on the mage, and movement's
  // arrival tolerance is the distance a walk counts as arrived.
  function besideMage(e: PartyEscape, s: EscapeStatus | undefined): boolean {
    const m = e.leader ? state.statuses[e.leader] : undefined;
    return !!(s && m && !late(s) && !dead(s) && ports.atHome(s, { goal: 'death', map: String(m.map), x: Number(m.x), y: Number(m.y), radius: ports.arrival, spawn: 0 }));
  }
  // The next port stage, or the end of the ports: home when the landing is home, else the walk.
  function nextStage(e: PartyEscape): void {
    const next = e.ports.find(name => !e.walk.includes(name) && !e.ported.includes(name));
    if (next) { stage(e, 'port:' + next, null, next); return; }
    const landing = e.destination && { ...e.destination, in: e.destination.in ?? e.destination.map };
    // A landing off home is input to the walk home, not an end (bug 5).
    if (landing && e.home && ports.atHome(landing, e.home) && e.walk.length === 0) stage(e, 'complete');
    else { e.recoveryAt = ports.now(); stage(e, 'recovering'); }
  }
  function step(): void {
    const e = state.escape;
    if (!e || ENDS.includes(e.stage)) return;
    // A record saved by an older release has no port list; it walks, as a restart's repair does.
    e.walk ||= []; e.ported ||= []; e.dropped ||= {}; e.ports ||= [];
    for (const name of e.participants) {
      const report = state.statuses[name]?.escape;
      if (report?.id === e.id) e.progress[name] = report;
    }
    if (!WALK.includes(e.stage)) {
      // A member that died, or whose reports stopped while the lifecycle owner answers it offline,
      // leaves the remaining stages; the escape goes on for the rest, and every remaining member walks
      // once it is the mage.
      for (const name of e.participants) {
        if (e.walk.includes(name)) continue;
        const s = state.statuses[name];
        const died = !!s && (dead(s) || JSON.stringify(s.lastDeath) !== JSON.stringify(e.deaths[name]));
        if (!s || died || late(s) && !ports.online(name)) {
          e.walk.push(name); e.dropped[name] = died ? 'died' : 'disconnected';
          if (name === e.leader) { e.error = name + (died ? ' died' : ' disconnected'); e.recoveryAt = ports.now(); stage(e, 'recovering', e.error, name); }
          ports.persist();
        }
      }
    }
    // The regroup point is the safe table's death goal, which escape and death recovery
    // share.
    const gathered = (s: EscapeStatus) => !!e.home && ports.atHome(s, e.home);
    if (e.stage === 'recovering') {
      // Every member walks home on its own ladder (runtime/characters/survival/escape.ts). Once all
      // of them stand there, the recovery convoy gathers them at the goal's point, so the party
      // never skips its regroup.
      const ready = e.participants.every(name => {
        const s = state.statuses[name]; return !!s && settled(s) && !s.rip && Number(s.hp) > 0 && gathered(s) && !late(s);
      });
      if (ready && ports.convoy(e.participants, e.home!)) { e.convoyId = state.activeConvoy?.id; stage(e, 'recovery-convoy'); ports.persist(); }
      return;
    }
    if (e.stage === 'recovery-convoy') {
      const casualty = e.participants.find(name => state.statuses[name]?.rip);
      if (casualty) { cancel(); stage(e, 'recovering', casualty + ' died', casualty); ports.persist(); return; }
      if (state.activeConvoy?.phase === 'failed') {
        e.progress.recovery = { error: state.activeConvoy.failure || 'Recovery convoy is blocked' };
      }
      // The escape ends `home` once the convoy gathered everyone (8a correction 11). A failed or
      // missing convoy returns the members to their own walks home, the next step that keeps the
      // stage from standing still.
      if (e.participants.every(name => {
        const s = state.statuses[name]; return !!s && settled(s) && !s.rip && !late(s) && gathered(s);
      })) { stage(e, 'home'); cancel(); ports.persist(); }
      else if (!state.activeConvoy || state.activeConvoy.phase === 'failed') { stage(e, 'recovering'); ports.persist(); }
      return;
    }
    const mage = e.leader ? state.statuses[e.leader] : undefined, report = mage?.escape?.id === e.id ? mage.escape : null;
    if (e.stage === 'blink') {
      // The Blink's crossing settles on its reply: a landing the mage reached moves on, and a mage
      // that cannot Blink (no landing left, too little MP) leaves every member to the walk.
      if (report?.landed && report.destination && mage!.map === report.destination.map) { e.destination = report.destination; nextStage(e); ports.persist(); }
      else if (report?.blinkFailed) { e.error = report.error || 'The mage cannot Blink'; e.recoveryAt = ports.now(); stage(e, 'recovering'); ports.persist(); }
      return;
    }
    if (e.stage.startsWith('port:')) {
      const name = e.stage.slice(5);
      // The member's report of its accepted Magiport ends the stage, or a report beside the mage.
      const own = state.statuses[name]?.escape;
      if (own?.id === e.id && own.ported === e.stage || besideMage(e, state.statuses[name])) { e.ported.push(name); nextStage(e); ports.persist(); return; }
      // A port the mage's MP cannot cover, a refused one or one whose reply was lost: that member
      // walks the safe path, and the next stage starts.
      if (e.walk.includes(name) || report?.portFailed?.stage === e.stage) {
        if (!e.walk.includes(name)) { e.walk.push(name); e.dropped[name] = report!.portFailed!.reason || 'not ported'; }
        nextStage(e); ports.persist();
      }
    }
  }
  // The escape task this record describes (rank 100), for the party's seat at the task owner. It
  // holds the party from the first cast until the party is home, completes or the player releases
  // it; a failed hold keeps it, because only the player's command ends an escape.
  function task() {
    const e = state.escape;
    if (!e || ['released', 'complete', 'home'].includes(e.stage)) return null;
    return { owner: 'escape:' + e.id, members: [...e.participants], phase: e.stage, label: e.error ? 'Escaping: ' + e.error : 'Escaping to safety' };
  }
  // `survival.escaping`'s party half: the escape that owns the member, and the one
  // command purpose it lets through, the recovery convoy's in `recovery-convoy`.
  function escaping(name: string): EscapeHold | undefined {
    const e = state.escape;
    if (!e || !owns(name)) return undefined;
    const trying = (e.progress[name] as { trying?: string | null } | undefined)?.trying;
    return { id: e.id, stage: e.stage, admits: e.stage === 'recovery-convoy' ? 'escape-recovery' : null, ...escapeLabel(e.stage, trying) };
  }
  // A hold the death recovery left out of its member list reopens to walk the missing members.
  const held = state.escape;
  if (held && ['failed-hold', 'home'].includes(held.stage) && recoveryMembershipOwned(state, held) &&
      state.combatRecovery!.names.some(name => !held.participants.includes(name))) stage(held, 'recovering', 'Recovery names a member the escape left out');
  if (state.escape && !ENDS.includes(state.escape.stage)) {
    const recovery = state.combatRecovery, e = state.escape;
    // Repair only the still-owned death recovery after a restart. An unrelated manual escape or
    // superseded navigation must not acquire extra members.
    if (recoveryMembershipOwned(state, e)) {
      e.participants = [...new Set(recovery!.names)];
      e.deaths ||= {};
      for (const name of e.participants) if (!(name in e.deaths)) e.deaths[name] = state.statuses[name]?.lastDeath;
    }
    // As v1.5.0's repair does (party-escape.cjs:108), every stage outside the ends
    // walks home.
    recover(e, 'Coordinator restarted during escape');
  }
  return { start, release, step, owns, fail, task, escaping };
}
export type PartyEscapeControl = ReturnType<typeof createPartyEscape>;
