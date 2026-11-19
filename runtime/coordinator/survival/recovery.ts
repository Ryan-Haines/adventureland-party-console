// The party death recovery's phases on the coordinator.
// A death outside an event and a Cave
// starts it: the party finishes the fight while the verdict (verdict.ts) reads `finish`, and
// escapes once it reads `leave` or an add-on's `survival.refuses` answers. The escape's members
// recover at home, then the party walks back to its farm or the recovery completes. The deaths come
// from the one death counter (died.ts). Each phase change tells `survival.recoveryPhase`; a change
// that drops the grouped fight's observations carries `resetsFight`, and the targeting owner's listener resets its
// own state at that notice.
import { MOVEMENT_RING_SIZE } from '../../protocol/records.ts';
import { fresh as freshReport } from '../../protocol/reports.ts';
import { partyHooks } from '../../hooks/index.ts';
import { targetIdentity as id } from '../targeting/api.ts';
import type { RecoveryView, Refusal, SurvivalRefusalAsk } from '../../hooks/registry.ts';
import { recoveryRunning, recoveryView } from '../../characters/survival/records.ts';
import type { DiedStatus, ScanRules } from './died.ts';
import type { EscapeJudgement, EscapedNotice } from './escaped.ts';
import type { SafeHome } from './escape.ts';
import type { Judgement, VerdictFoe, VerdictMember } from './verdict.ts';

type Foe = { id: string; map: string; in?: string | number; server?: string; mtype?: string; hp?: number; target?: string | null };
export interface RecoveryStatus extends DiedStatus {
  ctype?: string; server?: string; in?: string | number; max_hp?: number; moving?: boolean; movement?: { done?: unknown } | null;
  groupedCombat?: { threats?: Foe[]; sightings?: Foe[] } | null;
}
export interface PartyRecovery {
  id: string; phase: string; at: number; deaths: string[]; reason: string; names: string[]; leader: string | null; server?: string;
  focus: string; policy: string; location: unknown; revisions: Record<string, number>; home?: SafeHome; targets?: Foe[];
  verdicts?: { at: number; verdict: string; model: string; restart: string | null; foeRate: number | null; toKill: number | null; toFall: Record<string, number> | null }[];
  resumeReset?: boolean; returnConvoyId?: string | null; returnRetries?: number; returnFailedAt?: number;
}
// The payload of `survival.recoveryStarted`, `survival.recoveryPhase` and `survival.recovered`:
// the group and the recovery's id with who decided, and each notice's own fields.
export type RecoveryNotice = {
  group: string; id: string; by: string;
  names?: string[]; deaths?: string[]; home?: SafeHome | null;
  from?: string; to?: string; reason?: string; resetsFight?: boolean;
  code?: 'complete' | 'cancelled' | 'arrived-at-farm';
};
export interface RecoveryState {
  combatRecovery?: PartyRecovery | null;
  combatDeathSeen?: Record<string, { at: number; dead: boolean } | undefined> | null;
  statuses: Record<string, RecoveryStatus | undefined>;
  leader: string | null; monsterFocus?: unknown; targetMode: string; location?: unknown;
  activeConvoy?: { id?: string; phase?: string; failure?: string; purpose?: string | null } | null;
  lastConvoyEngagement?: { convoyId?: string; target?: { map?: string; x?: number; y?: number } | null } | null;
  // The party's escape (escape.ts), whose regroup the recovery waits for.
  escape?: { stage: string } | null;
}
// The escape stages where its regroup is over: it gathered the party home, held after a failure,
// or was released.
const ESCAPE_DONE: readonly string[] = ['complete', 'failed-hold', 'home', 'released'];
// The grouped fight's read (`targeting.fight`): its target's start, its fights and its
// death tombstones, each with the monster type the target had.
export interface FightRead { startedAt?: number; fights: Foe[]; deaths: { id: string; map: string; in?: string | number; server?: string; at: number; mtype?: string }[] }
export interface RecoveryPorts {
  now(): number;
  persist(): void;
  // The one coordinator log append (install.ts `log`).
  log(message: string): void;
  group(): string;
  notify(hook: 'survival.recoveryStarted' | 'survival.recoveryPhase' | 'survival.recovered', payload: RecoveryNotice): void;
  notify(hook: 'survival.judged', payload: Record<string, unknown>): void;
  died(names: string[], rules: ScanRules): string[];
  verdict(key: string, survivors: VerdictMember[], foes: VerdictFoe[], at: number): Judgement;
  endVerdict(key: string): void;
  escaped(names: string[], survivors: VerdictMember[], mtypes: string[], judgement: EscapeJudgement, by: string, deaths: string[]): EscapedNotice;
  won(kills: readonly { mtype?: string; at?: number }[]): void;
  refuses(ask: SurvivalRefusalAsk): Refusal | undefined;
  fight(): FightRead | undefined;
  // Whether the member reads below its "HP potion below" line (install.ts `low`, the survival owner's one health
  // rule, which `survival.low` also answers).
  low(name: string): boolean;
  home(map: string | undefined): SafeHome | null;
  atHome(status: RecoveryStatus, home: SafeHome): boolean;
  members(): string[];
  intent(name: string): { revision: number; cancelled?: boolean };
  // The hunting owner's `cave.state` answer: a member inside a Cave run, whom death recovery does not count (01
  // design 2.3 rule 5).
  inCave(name: string): boolean;
  // The tasks owner's `death-recovery` question for the member.
  allows(name: string): boolean;
  // The hunting owner's event death rule over the member's event trips (hunting/api.ts `eventDeath`).
  eventDeath(name: string, status: DiedStatus, at: number, reported: boolean): boolean;
  escape(names: string[]): unknown;
  releaseEscape(): void;
  // Ends the group's walk with the death recovery's end code (`walks.end(group, 'death-recovery')`).
  endWalk(): void;
  returnToFarm(location: unknown, names: string[]): unknown;
  // The hunting owner's farm area test with the leader's search reach (install.ts `inFarm`): the point stands inside
  // the saved farm location.
  inFarm(location: unknown, point: { map?: string; x?: number; y?: number }): boolean;
}

const dead = (s: RecoveryStatus | undefined) => !!s && (!!s.rip || Number(s.hp) <= 0);

export function createPartyRecovery(state: RecoveryState, ports: RecoveryPorts) {
  state.combatDeathSeen ||= {};
  const fresh = (s: RecoveryStatus | undefined): s is RecoveryStatus => !!s && freshReport(s.seenAt, ports.now());
  const active = () => recoveryRunning(state.combatRecovery);
  // One notice per phase change, with whether the targeting owner's grouped fight drops this fight's observations.
  function told(r: PartyRecovery, from: string, to: string, resetsFight: boolean, by = 'core:survival'): void {
    ports.notify('survival.recoveryPhase', { group: ports.group(), id: r.id, from, to, reason: r.reason, resetsFight, names: [...r.names], by });
  }
  function change(r: PartyRecovery, to: string, reason: string): void {
    const from = r.phase;
    r.phase = to; r.reason = reason;
    if (from !== to) told(r, from, to, false);
  }
  // `policy` is the target mode: a target change ends the recovery, and a combat mode change does not
  //.
  function capture(names: string[]) {
    return { names, leader: state.leader, server: state.leader ? state.statuses[state.leader]?.server : undefined, focus: JSON.stringify(state.monsterFocus),
      policy: state.targetMode, location: state.location,
      revisions: Object.fromEntries(names.map(n => [n, ports.intent(n).revision])) };
  }
  function current(r: PartyRecovery): boolean {
    return r.leader === state.leader && r.focus === JSON.stringify(state.monsterFocus) && r.policy === state.targetMode &&
      r.names.every(n => !ports.intent(n).cancelled && ports.intent(n).revision === r.revisions[n]);
  }
  function foes(r: PartyRecovery): Foe[] {
    const found = new Map<string, Foe>(), fight = ports.fight();
    for (const name of r.names) {
      const s = state.statuses[name]; if (!fresh(s) || dead(s)) continue;
      for (const t of s.groupedCombat?.threats || []) found.set(id({ ...t, server: s.server }), { ...t, server: s.server });
    }
    for (const f of fight?.fights || []) found.set(id(f), f);
    return [...found.values()].filter(t => !fight?.deaths.some(d => id(d) === id(t)));
  }
  // The survivors and the foes the verdict reads, and each change of its answer
  // with its rates in the record's ring. A survivor is a living member in the fight: on the
  // server, map and instance of a foe it fights. A member that respawned at the game's respawn point
  // reports alive from another map, and is no arrival at the fight (3.6's window restarts when a
  // member arrives, not when it respawns away).
  function survivors(r: PartyRecovery, targets: Foe[]): (VerdictMember & RecoveryStatus)[] {
    const here = (s: RecoveryStatus) => !targets.length || targets.some(t => (t.server == null || s.server === t.server) && s.map === t.map && (t.in == null || s.in === t.in));
    return r.names.map(n => state.statuses[n] && { name: n, ...state.statuses[n]! }).filter((s): s is VerdictMember & RecoveryStatus => !!s && fresh(s) && !dead(s) && here(s));
  }
  // The foes are the targets a living member's fresh report observes (3.6 `foeRate`). A target only
  // the fight list still names has left every member's view, so the verdict reads no foe for it, as
  // b9b5c91e's finish rule needed an observation of each target. A removed monster disappears without
  // a death, and its stale list HP would hold the window still.
  function foeReadings(r: PartyRecovery, targets: Foe[]): VerdictFoe[] {
    return targets.map(t => {
      const seen = r.names.flatMap(n => {
        const s = state.statuses[n];
        return fresh(s) && !dead(s) && s.server === t.server && s.map === t.map && s.in === t.in ?
          (s.groupedCombat?.sightings || []).concat(s.groupedCombat?.threats || []).filter(v => v.id === t.id && Number.isFinite(v.hp)).map(v => ({ ...v, seenAt: s.seenAt })) : [];
      });
      // The newest sighting that names the foe's target, with its report time, so the verdict reads
      // only this fight's (verdict.ts `placed`).
      const named = seen.filter(v => v.target).sort((a, b) => b.seenAt - a.seenAt)[0];
      return seen.length ? { id: id(t), mtype: t.mtype, hp: Math.min(...seen.map(v => Number(v.hp))), ...(named ? { target: named.target, seenAt: named.seenAt } : {}) } : null;
    }).filter((f): f is NonNullable<typeof f> => !!f);
  }
  // The verdict's last answer per recovery, with the fight it read, for the escape's cause.
  const judged = new Map<string, { j: Judgement; alive: VerdictMember[]; foes: VerdictFoe[] }>();
  // The verdict on the fight as it stands. A `finish` asks the add-ons' `survival.refuses` once,
  // and a refusal turns it into `leave` with the refusal as its reason.
  function finishes(r: PartyRecovery, targets: Foe[]): { finish: boolean; refusal?: Refusal } {
    // The reading's time is the survivors' newest report (verdict.ts `observe`).
    const alive = survivors(r, targets), seen = foeReadings(r, targets);
    const j = ports.verdict(r.id, alive, seen, Math.max(0, ...alive.map(s => Number(s.seenAt) || 0)));
    judged.set(r.id, { j, alive, foes: seen });
    const last = (r.verdicts || []).at(-1);
    if (!last || last.verdict !== j.verdict || j.restart) {
      (r.verdicts ||= []).push({ at: ports.now(), verdict: j.verdict, model: j.model, restart: j.restart, foeRate: j.foeRate, toKill: j.toKill, toFall: j.toFall });
      // The ring is a diagnostic record, bounded as movement's ring is.
      if (r.verdicts.length > MOVEMENT_RING_SIZE) r.verdicts.splice(0, r.verdicts.length - MOVEMENT_RING_SIZE);
      ports.notify('survival.judged', { key: 'recovery:' + r.id, verdict: j.verdict, model: j.model, restart: j.restart, foeRate: j.foeRate, toKill: j.toKill, by: 'core:survival' });
    }
    if (j.verdict !== 'finish') return { finish: false };
    const refusal = ports.refuses({ question: 'recovery', group: ports.group(), survivors: alive, foes: seen, verdict: 'finish' });
    return refusal ? { finish: false, refusal } : { finish: true };
  }
  // An escape the verdict decided over a fight with foes gets its
  // cause, bad luck or too hard, published as `survival.escaped` (escaped.ts); the card's reason names
  // it. An escape with no foe left, or from a death during the farm return, has no fight to judge. An
  // add-on's refusal names its add-on in the notice's `by` and the reason.
  function escape(r: PartyRecovery, reason: string, judgedFight = false, refusal?: Refusal): void {
    const fight = judgedFight ? judged.get(r.id) : undefined; judged.delete(r.id);
    const by = refusal?.by ?? 'core:survival';
    const cause = fight && fight.foes.length ? ports.escaped(r.names, fight.alive, fight.foes.map(f => f.mtype).filter((m): m is string => !!m), fight.j, by, r.deaths) : null;
    const from = r.phase;
    r.phase = 'escaping'; r.reason = (cause ? reason + ' (' + cause.cause + ')' : reason) + (refusal ? ' (refused by ' + refusal.by + ': ' + refusal.reason + ')' : '');
    // The grouped fight drops this fight's observations at the escape.
    told(r, from, 'escaping', true, by); ports.log(reason); ports.persist();
    ports.escape(r.names);
    // Escape owns any revisions produced by its own cancellation and recovery.
    r.revisions = Object.fromEntries(r.names.map(n => [n, ports.intent(n).revision]));
    ports.persist();
  }
  // A recovery that ends drops its verdict window (verdict.ts `end`): its key is its own id, so no
  // later fight reads it.
  function ended(r: PartyRecovery, phase: 'complete' | 'cancelled', reason: string, code: 'complete' | 'cancelled' | 'arrived-at-farm'): void {
    change(r, phase, reason); ports.endVerdict(r.id); judged.delete(r.id);
    ports.notify('survival.recovered', { group: ports.group(), id: r.id, code, by: 'core:survival' });
  }
  function start(names: string[], deaths: string[]): void {
    const r: PartyRecovery = state.combatRecovery = { ...capture(names), id: 'death-' + ports.now(), phase: 'finishing', at: ports.now(), deaths, reason: 'Checking remaining attackers' };
    // The party regroups where the game respawns a death on this map. Without game data there is no
    // goal, and the escape this recovery starts holds (escape.ts `start`).
    const home = ports.home(state.statuses[deaths[0]!]?.map); if (home) r.home = home;
    ports.notify('survival.recoveryStarted', { group: ports.group(), id: r.id, names: [...names], deaths: [...deaths], home: home ?? null, by: 'core:survival' });
    const targets = foes(r); r.targets = targets;
    const verdict = finishes(r, targets);
    // An add-on may escape where core would finish; it never finishes where core escapes.
    const pick = partyHooks().survival.choice({ question: 'recovery', member: deaths[0] ?? '', options: verdict.finish ? ['finish', 'escape'] : ['escape'],
      core: verdict.finish ? 'finish' : 'escape' });
    if (pick === 'escape') escape(r, 'Party death: escaping unsafe or completed encounter', true, verdict.refusal);
    else { ports.endWalk(); r.reason = 'Finishing weakened attackers before escape'; ports.log(r.reason); ports.persist(); }
  }
  // A member is out of danger at home at or above its "HP potion below" line, the line the
  // potion table drinks below (lines.ts holds its defaults).
  function safe(r: PartyRecovery): boolean {
    return r.names.every(n => {
      const s = state.statuses[n];
      return fresh(s) && !dead(s) && !s.moving && (!s.movement || typeof s.movement.done === 'boolean') && Number(s.max_hp) > 0 &&
        !ports.low(n) && !!r.home && ports.atHome(s, r.home) && !(s.groupedCombat?.threats || []).length;
    });
  }
  function recover(r: PartyRecovery): void {
    change(r, 'recovering', 'Waiting for respawn and safe regroup above the HP potion line');
    if (!safe(r)) return;
    // The escape's recovery convoy gathers the members at home before the recovery moves on, so the
    // party never skips its regroup.
    if (state.escape && !ESCAPE_DONE.includes(state.escape.stage)) return;
    const farm = r.policy !== 'hunt' && !!r.location, next = farm ? 'returning-to-farm' : 'complete';
    // Discard all observations gathered during the escape before allowing fresh pulls: the targeting owner's grouped
    // fight resets at this change, and the escape releases before the phase moves on.
    if (!r.resumeReset) {
      told(r, 'recovering', next, true); ports.log('Recovery complete: recalculating farming targets'); ports.persist();
      ports.releaseEscape(); r.resumeReset = true;
      r.phase = next;
    }
    if (farm) { change(r, 'returning-to-farm', r.reason); return returnToFarm(r); }
    ended(r, 'complete', 'Recovery complete', 'complete');
    ports.persist();
  }
  const reportedSince = (r: PartyRecovery, at: number) => r.names.some(n => { const s = state.statuses[n]; return fresh(s) && s.seenAt > at; });
  // The farm return after a death ends when every member stands alive on the recovery's server inside
  // the saved farm, or when its convoy handed the party to a fight inside the farm (b9b5c91e
  // combat-disengagement.cjs `returnToFarm`). A party already there starts no convoy. A failed or
  // refused return asks again on the next report after it (the tasks owner's report-driven wait), not
  // after a fixed series.
  function returnToFarm(r: PartyRecovery): void {
    const server = r.server || (r.leader ? state.statuses[r.leader]?.server : undefined);
    const standing = r.names.every(n => { const s = state.statuses[n]; return fresh(s) && !dead(s) && s.server === server; });
    const core = standing && r.names.every(n => ports.inFarm(r.location, state.statuses[n]!));
    // An add-on may end the return once every member stands alive on the server, inside the farm or not.
    const arrived = partyHooks().survival.choice({ question: 'farmReturn', member: r.leader ?? r.names[0] ?? '', options: core || !standing ? [core] : [false, true], core });
    const handoff = state.lastConvoyEngagement;
    if (arrived || (r.returnConvoyId && handoff?.convoyId === r.returnConvoyId && !!handoff.target && ports.inFarm(r.location, handoff.target))) {
      ended(r, 'complete', 'Arrived at saved farm', 'arrived-at-farm'); ports.persist(); return;
    }
    const c = state.activeConvoy;
    if (c && c.id === r.returnConvoyId && c.phase !== 'failed') { r.reason = c.phase === 'defending' ? 'Defending during farm return' : 'Returning to saved farm'; return; }
    if (c && c.id !== r.returnConvoyId) { r.reason = 'Waiting for current travel before farm return'; return; }
    // A failed convoy reaches the coordinator with a report, so the return asks again on that
    // report; only a return the convoy refused (`false` below) waits for the next one.
    if (r.returnConvoyId && !r.returnFailedAt) { r.reason = 'Retrying farm return' + (c?.failure ? ': ' + c.failure : ''); ports.persist(); }
    else if (r.returnFailedAt && !reportedSince(r, r.returnFailedAt)) return;
    if (!r.names.every(n => fresh(state.statuses[n]) && !dead(state.statuses[n]))) return;
    if (c) ports.endWalk();
    if (ports.returnToFarm(r.location, r.names) === false) { r.returnFailedAt = ports.now(); ports.persist(); return; }
    r.returnConvoyId = state.activeConvoy?.id || null; r.returnRetries = (r.returnRetries || 0) + 1; r.returnFailedAt = 0;
    r.reason = 'Returning to saved farm'; ports.persist();
  }
  function tick(): void {
    const legacy = state.combatRecovery;
    // A complete recovery with a death-recovery convoy still running returns again, except with the
    // convoy its own return started: that return already arrived, and the convoy only winds down.
    if (legacy?.phase === 'complete' && state.activeConvoy?.purpose === 'death-recovery' && state.activeConvoy.id !== legacy.returnConvoyId && current(legacy)) {
      change(legacy, 'returning-to-farm', legacy.reason); legacy.returnConvoyId = state.activeConvoy.id;
    }
    // Rule 2.3.5: death recovery runs only outside a Cave run. A member
    // inside one is not counted, and its deaths there are marked seen, so leaving the cave starts no
    // recovery for a death the cave already answered.
    const seen = state.combatDeathSeen ||= {};
    const pool = active() ? state.combatRecovery!.names : ports.members();
    for (const name of pool.filter(n => ports.inCave(n))) {
      const s = state.statuses[name];
      if (s) seen[name] = { at: Math.max(seen[name]?.at || 0, Number(s.lastDeath?.at) || 0), dead: dead(s) };
    }
    const names = pool.filter(n => !ports.inCave(n));
    // A kill clears its monster type's bad-luck record (escaped.ts `won`); each tombstone carries the
    // monster type its target had.
    const fight = ports.fight();
    ports.won((fight?.deaths || []).map(d => ({ mtype: d.mtype, at: d.at })));
    const deaths = ports.died(names, { eventDeath: ports.eventDeath, fightStartedAt: () => fight?.startedAt ?? Infinity });
    if (active()) {
      const r = state.combatRecovery!;
      if (!current(r)) {
        ended(r, 'cancelled', 'Recovery superseded by new activity', 'cancelled'); ports.releaseEscape(); ports.persist(); return;
      }
      if (!names.every(n => ports.allows(n))) return;
      if (r.phase === 'returning-to-farm') {
        if (deaths.length) { r.resumeReset = false; r.returnConvoyId = null; escape(r, 'Another death during farm return'); }
        else returnToFarm(r);
        return;
      }
      if (r.phase === 'finishing') {
        // A death, an arrival or a new attacker restarts the verdict's window, which
        // recalculates at once on the fight as it stands.
        const targets = foes(r); r.targets = targets;
        const verdict = finishes(r, targets);
        if (!verdict.finish) escape(r, 'Finishing ended: escaping after party death', true, verdict.refusal);
      } else recover(r);
      return;
    }
    if (deaths.length && names.length && names.every(n => ports.allows(n)) && names.every(n => !ports.intent(n).cancelled)) start(names, deaths);
  }
  // `survival.recovery`'s answer: the last computed record (api.ts `recoveryView`).
  function view(): RecoveryView | undefined { return recoveryView(state.combatRecovery); }
  // The death recovery task this record describes (rank 95), for the
  // party's seat at the task owner. Its own escape outranks it and suspends it.
  function task() {
    if (!active()) return null;
    const r = state.combatRecovery!;
    return { owner: 'death:' + r.id, members: [...r.names], phase: r.phase, label: r.reason || 'Recovering from a party death' };
  }
  return { tick, active, view, task };
}
export type PartyRecoveryControl = ReturnType<typeof createPartyRecovery>;
