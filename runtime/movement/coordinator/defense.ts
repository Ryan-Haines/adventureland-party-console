// The walk's defending and report-gap phases (T4 `defending` and `report-gap`): the travel
// defense's classification, the convoy defense step, the communication recovery and the merchant
// pause. Moved here whole from coordinator/navigation/travel-defense.ts, convoy-defense.ts,
// communication-recovery.ts, communication-failure.ts and merchant-interruption.ts. `walkEligible`
// and `eventOwnsParticipant` are the movement owner's functions that read the events owner's attendance facts; the targeting
// owner's `retireTravelTargets` is in runtime/coordinator/targeting/snapshot.ts.
import { characterRuntime, reportMatches, sameWalk, sameWalkOn, type SharedCommand, type SharedConvoy, type SharedReport, type SharedState, type WalkCommand, type SlotCommand, walkCommandOf } from './route-store.ts';
import { fresh, reachLessDrift, reportClockError, widens, type WalkReading } from '../../protocol/reports.ts';
import { partyHooks } from '../../hooks/index.ts';
import { eventPresence } from '../../events/api.ts';
import { cancelEnds, exemptWalk, preemptible } from '../rules.ts';
import { type Group, type Member, type Target, updateHuntTravel } from '../../coordinator/targeting/api.ts';
import { outboundHunt, huntDefense } from './hunt-travel.ts';
import type { HuntTravelConvoy } from '../../coordinator/targeting/api.ts';
import { contains, GAME_CHEST_REACH, PATROL_WALK, RARE_WALK, type Area } from '../../hunting/api.ts';
import { searchReach } from '../../hunting/coordinator/api.ts';
import { requestObject } from '../../lifecycle/api.ts';
import { recordConvoyHistory } from './records.ts';
import { returnWalking, type ReturnTownPolicy } from './arrivals.ts';
import { walkPhase } from './walk.ts';
// Targeting's passing reads, through its door (S-04p closed).
import { collectPassing, passingIdentity, passiveStopRequired, type PassingEncounter, type PassiveTravelSettings } from '../../characters/targeting/api.ts';
import { merchantSlotCommand } from '../../merchant-jobs/coordinator/api.ts';
import { appendCombatLog } from '../../status/coordinator/api.ts';

export interface CurrentAttacker extends Target { target: string; server?: string }
interface Observation {
  presence?: unknown;
  // The gap between the character's last two reports (queue A20).
  reportIntervalMs?: number;
  seenAt?: number; map?: string; in?: string | number; server?: string; hp?: number; rip?: boolean;
  serverLiveEvents?: { name?: string }[];
  groupedCombat?: { returnDefense?: boolean; passingEncounters?: PassingEncounter[]; currentAttackersAt?: number; currentAttackers?: CurrentAttacker[]; travelCommand?: { id: number; revision: number } | null };
}
export interface DefenseState { passiveHunting?: PassiveTravelSettings; statuses: Record<string, unknown>; groupedCombat?: unknown; activeConvoy?: HuntTravelConvoy & { participants?: string[]; returnTown?: { walking: boolean }; group?: string } | null }
export interface DefenseResult {
  state: "clear" | "defending" | "waiting-for-observations";
  attackers: CurrentAttacker[];
  waiting: string[];
  message: string;
}
export const identity = (t: { server?: string; map: string; in?: string | number; id: string }) =>
  JSON.stringify([t.server, t.map, String(t.in ?? t.map), String(t.id)]);
// Queue A20 (decided by the user): a report with no attacker known stays fresh for
// two of the character's own report intervals, so a walk goes on through a late report; with
// an attacker known the console's 3 s applies.
function freshFor(status: Observation, at: number | undefined, now: number): boolean {
  return fresh(at, now, { reading: 'walk', attackerKnown: !!status.groupedCombat?.currentAttackers?.length, intervalMs: status.reportIntervalMs });
}
export function travelObservationIssue(status: Observation | undefined, now: number): string | null {
  if (!status) return 'missing character report';
  if (!freshFor(status, status.seenAt, now)) return 'character report age ' + Math.round(now - (status.seenAt || 0)) + ' ms';
  const g = status.groupedCombat;
  if (!g?.currentAttackersAt) return 'missing connected attacker observation';
  if (!freshFor(status, g.currentAttackersAt, now)) return 'attacker observation age ' + Math.round(now - g.currentAttackersAt) + ' ms';
  return Array.isArray(g.currentAttackers) ? null : 'missing attacker observation list';
}
function ready(status: Observation | undefined, now: number): status is Observation {
  return !!status && !status.rip && status.hp !== 0 && !travelObservationIssue(status, now);
}

function current(t: CurrentAttacker, status: Observation, names: string[]): boolean {
  return names.includes(t.target) && t.map === status.map &&
    String(t.in ?? t.map) === String(status.in ?? status.map) &&
    (!t.server || t.server === status.server) && t.hp !== 0;
}
// A member fighting a live event boss a map away from the leader belongs to
// that fight. Holding the convoy would stop a leader that cannot reach it
// (live 2026-10-21 05:28Z: leader held in main while followers fought
// Mr. Pumpkin in halloween).
function eventBossElsewhere(t: CurrentAttacker, status: Observation, leader: Observation | undefined, now: number): boolean {
  if (!leader || !fresh(leader.seenAt, now) || !leader.map || !status.map || !status.server || status.server !== leader.server || !t.mtype || !status.serverLiveEvents?.some(event => event?.name === t.mtype)) return false;
  return status.map !== leader.map || String(status.in ?? status.map) !== String(leader.in ?? leader.map);
}
/** The member's only attackers are live event bosses, a map away from the leader. */
export function eventFightElsewhere(party: DefenseState, name: string, now = Date.now()): boolean {
  const status = party.statuses[name] as Observation | undefined, attackers = status?.groupedCombat?.currentAttackers;
  if (!ready(status, now) || !attackers?.length) return false;
  const leader = convoyLeader(party);
  return attackers.every(t => current(t, status, party.activeConvoy?.participants || []) && eventBossElsewhere(t, status, leader, now));
}
function convoyLeader(party: DefenseState): Observation | undefined {
  const name = (party.activeConvoy as { leader?: string } | null | undefined)?.leader;
  return name ? party.statuses[name] as Observation | undefined : undefined;
}
function confirmedDeaths(party: DefenseState): Set<string> {
  const deaths = (party.groupedCombat as { deaths?: (Target & { server?: string })[] } | null)?.deaths || [];
  return new Set(deaths.map(identity));
}
function passingForDefense(party: DefenseState, names: string[], now: number) {
  return new Map(collectPassing(names.map(name=>({name,ctype:"",revision:0,status:party.statuses[name] as Member["status"]})),
    (party.groupedCombat as Group | undefined)?.passingEncounters || [], now).map(t=>[passingIdentity(t),t]));
}
function includeAttacker(party:DefenseState,passing:Map<string,PassingEncounter>,attacker:CurrentAttacker,departure?:boolean):boolean {
  const c=party.activeConvoy;
  if(passing.get(passingIdentity(attacker))?.keepMoving && !passiveStopRequired(party.passiveHunting,attacker.mtype))return false;
  return passiveStopRequired(party.passiveHunting,attacker.mtype) || outboundHunt(c) || !!departure || !!c?.continuousReturn || !passing.has(passingIdentity(attacker));
}
function observeTravelAttackers(party: DefenseState, names: string[], now: number, includePassingAttackers: boolean): Pick<DefenseResult, 'attackers' | 'waiting'> {
  const waiting: string[] = [], found = new Map<string, CurrentAttacker>();
  const dead = confirmedDeaths(party);
  const passing = includePassingAttackers ? new Map<string,PassingEncounter>() : passingForDefense(party,names,now);
  const leader = convoyLeader(party);
  for (const name of names) {
    const status = party.statuses[name] as Observation | undefined;
    if (!ready(status, now)) { waiting.push(name); continue; }
    for (const t of status.groupedCombat!.currentAttackers!) {
      if (current(t, status, names) && !eventBossElsewhere(t, status, leader, now)) {
        const attacker = { ...t, server: status.server };
        if (includeAttacker(party,passing,attacker,status.groupedCombat!.returnDefense) && !dead.has(identity(attacker))) found.set(identity(attacker), attacker);
      }
    }
  }
  return { attackers: [...found.values()], waiting };
}

/** Travel consults live targeting, never retained engagements or recent outgoing hits. */
export function classifyTravelDefense(party: DefenseState, names: string[], now = Date.now(), includePassingAttackers = false): DefenseResult {
  const { attackers, waiting } = observeTravelAttackers(party, names, now, includePassingAttackers);
  const defend = huntNeedsDefense(party,names,attackers,now);
  if (defend) return { state: "defending", attackers, waiting,
    message: defenseMessage(party,attackers) };

  if (waiting.length) return { state: "waiting-for-observations", attackers, waiting,
    message: "Waiting for fresh travel observations from " + waiting.join(", ") };
  return { state: "clear", attackers, waiting, message: "" };
}

function defenseMessage(party: DefenseState, attackers: CurrentAttacker[]): string {
  if(!attackers.length)return 'Travel encounter: pursuing '+(party.activeConvoy?.huntTravel?.committed||[]).map(t=>(t.mtype==='tinyp'?'Fairy':t.mtype)+' '+t.id).join(', ');
  return 'Defending '+[...new Set(attackers.map(t=>t.target))].join(', ')+' from '+attackers.map(t=>(t.mtype||'monster')+' '+t.id).join(', ');
}

function huntNeedsDefense(party: DefenseState, names: string[], attackers: CurrentAttacker[], now: number): boolean {
  const c=party.activeConvoy;
  if(!c)return attackers.length>0;
  // Targeting's passing column, asked through the hook bus: classifyTravelDefense's callers hold no
  // ports to hand it in (decided 2026-11-09).
  const control=updateHuntTravel(c,names.map(name=>({name,ctype:'',revision:0,status:party.statuses[name] as Member['status']})),now,undefined,party.passiveHunting,
    walk=>partyHooks().targeting.passing(walk,'passive'));
  if(!control)return attackers.length>0;
  if(control.reason==='passive-setting' && !huntDefense(c))return true;
  if(huntDefense(c)) {
    return attackers.length>0 || !!control.committed?.length;
  }
  const encounters=new Set(attackers.map(identity));
  if(control.primary)encounters.add(identity(control.primary));
  return encounters.size>1;
}

export interface TravelState {
  statuses?: Record<string, Observation | undefined>;
  activeConvoy?: { id?: string; epoch?: number; participants: string[]; purpose?: string | null; force?: boolean; phase?: string; farmingEngagement?: unknown } | null;
  commands?: Record<string, { id?: number; type?: string; phase?: string; convoyId?: string; convoyHandoff?: string; navigationRevision?: number } | undefined>;
  navigationIntents?: Record<string, { revision?: number; cancelled?: boolean } | undefined>;
  releasedArrivalCommands?: Record<string, {id: number; revision: number}>;
  monsterHunt?: { cycleId?: string; stage?: string; currentIndex?: number; startedAt?: number; participants: string[] } | null;
  targetMode?: string;
  rareHuntState?: { encounter?: { revisions?: Record<string, number> } | null } | null;
  farmAreaState?: { pending?: { at?: number } | null } | null;
  followers?: Record<string, unknown>;
  leader?: string | null;
  escape?: { stage?: string } | null;
}
export interface TravelCombat { id: string; revision: number; startedAt: number }
const controls = new WeakMap<TravelState, Map<string, TravelCombat>>();
export function normalTravel(purpose: string | null | undefined): boolean {
  return !["escape-recovery", "franky-exit", "event-return", RARE_WALK, PATROL_WALK, "grouped-approach", "shared-walk-return"].includes(purpose || "");
}
function huntOperation(state: TravelState, name: string): { id: string; at: number } | null {
  const h = state.monsterHunt;
  if (!h?.participants?.includes(name) || state.targetMode !== "hunt") return null;
  if (!["returning", "daisy-sync-travel", "mission-travel", "backup-travel", "batch-loot", "at-daisy"].includes(h.stage || "")) return null;
  return { id: [h.cycleId, h.stage, h.currentIndex].join(":"), at: h.startedAt || 0 };
}
function waitingOperation(state: TravelState, name: string): { id: string; at: number } | null {
  if (eventOwnsParticipant(name)) return null;
  if (rareOwnsParticipant(state, name)) return null;
  const hunt = huntOperation(state, name);
  if (hunt) return hunt;
  if (state.farmAreaState?.pending && (name === state.leader || state.followers?.[name]))
    return { id: "farm:" + state.farmAreaState.pending.at, at: state.farmAreaState.pending.at || 0 };
  return null;
}
function rareOwnsParticipant(state: TravelState, name: string): boolean {
  const revision = state.rareHuntState?.encounter?.revisions?.[name];
  return revision !== undefined && revision === (state.navigationIntents?.[name]?.revision || 0);
}
function commandOperation(state: TravelState, name: string): { id: string; at: number } | null {
  const command = state.commands?.[name];
  if (!command || !["travel", "character-travel", "event-resume-travel", "return-leader"].includes(command.type || "")) return null;
  // A combat handoff command (walk.ts `engageWalk`) hands the walk's members to the fight its leader
  // engaged, so travel holds no fight for it. The member's reunion pauses while a monster attacks the
  // party, and its handoff finds no target while travel holds combat, so a held member stood beside
  // the leader's fight until that fight ended.
  if (command.convoyHandoff) return null;
  return { id: "command:" + command.id, at: command.id || 0 };
}
function releasedEventWalk(state: TravelState, name: string): boolean {
  const c = state.activeConvoy;
  const command = state.commands?.[name];
  // A terminal event-entry walk explicitly returns movement to event combat.
  // Retaining its diagnostic convoy must not keep the character combat-paused.
  return c?.phase === "failed" && command?.phase === "event-walk-release" && command.convoyId === c.id &&
      command.navigationRevision === (state.navigationIntents?.[name]?.revision || 0);
}
function operation(state: TravelState, name: string): { id: string; at: number } | null {
  const c = state.activeConvoy;
  if (releasedEventWalk(state, name)) return null;
  if (c?.participants?.includes(name)) return !c.force && normalTravel(c.purpose)
    ? convoyOperation(c) : null;
  return nonConvoyOperation(state, name);
}
function convoyOperation(c: NonNullable<TravelState['activeConvoy']>): {id:string;at:number} | null {
  return c.farmingEngagement ? null : {id:c.id || 'convoy',at:c.epoch || 0};
}
function nonConvoyOperation(state: TravelState, name: string): { id: string; at: number } | null {
  if (state.commands?.[name]?.type === "force-travel") return null;
  return commandOperation(state, name) || localOperation(state, name) || waitingOperation(state, name);
}
function localOperation(state: TravelState, name: string): { id: string; at: number } | null {
  const status = state.statuses?.[name], command = status?.groupedCombat?.travelCommand;
  if (releasedArrivalCommand(state, name, command)) return null;
  if (!command || !ready(status, Date.now()) || command.revision !== travelRevision(state, name)) return null;
  return { id: "command:" + command.id, at: status.groupedCombat!.currentAttackersAt! };
}
function control(state: TravelState, name: string, owner: { id: string } | null): TravelCombat | null {
  let members = controls.get(state);
  if (!members) { members = new Map(); controls.set(state, members); }
  if (!owner) { members.delete(name); return null; }
  const before = members.get(name), revision = state.navigationIntents?.[name]?.revision || 0;
  if (before?.id === owner.id && before.revision === revision) return before;
  const next = { id: owner.id, revision, startedAt: Date.now() };
  members.set(name, next);
  return next;
}
// Whether the members' travel defense holds them in a fight, which the Hunt entry asks before it
// switches (hunting/coordinator/routes.ts `fighting`).
export function fighting(party: DefenseState, names: string[], now = Date.now()): boolean {
  return classifyTravelDefense(party, names, now).state === "defending";
}
export function travelCombatFor(state: TravelState, name: string): TravelCombat | null {
  if (state.escape && state.escape.stage !== "released" || state.navigationIntents?.[name]?.cancelled) return control(state, name, null);
  const owner = operation(state, name);
  return control(state, name, owner);
}

function releasedArrivalCommand(state: TravelState, name: string, command: {id: number; revision: number} | null | undefined): boolean {
  if (state.monsterHunt?.stage !== 'farming' || !command) return false;
  const released = state.releasedArrivalCommands?.[name];
  return released?.id === command.id && released.revision === command.revision;
}

function travelRevision(state: TravelState, name: string): number { return state.navigationIntents?.[name]?.revision || 0; }

// Queue A4 (decided by the user): a walk that stopped for the monsters it walked
// into fights them, runs its loot pass and goes on as the SAME walk from where it stands (no
// new epoch, no fresh assembly); a fight the party cannot win (survival's walk verdict, `walkOn`)
// is not the walk's, so the walk goes on and survival's rules decide any escape.
interface Loot { id: string; after: number; realm: string; map: string; in: string; x: number; y: number; complete: boolean; progress?: Progress }
interface Progress { id: string; observedAt: number; realm: string; map: string; in: string; complete: boolean; error?: string }
interface Status { seenAt: number; speed?: number; rip?: boolean; hp: number; map: string; in?: string; region?: string; server: string; x: number; y: number; convoyLoot?: Progress; presence?: unknown;
  groupedCombat?: NonNullable<Member['status']>['groupedCombat']; }
interface Convoy extends HuntTravelConvoy {
  defenseTargets?: PassingEncounter[];
  continuousReturn?: number; huntTarget?: string; returnTown?: ReturnTownPolicy; townRetry?: boolean;
  returnTownRally?: {map:string;x:number;y:number};
  farmingEngagement?: {target: {id:string;map:string;in?:string|number;server?:string};at:number;finished?:boolean};
  id: string; epoch: number; phase: string; purpose?: string | null; force?: boolean; navigationExempt?: boolean;
  participants: string[]; leader: string; label?: string; loot?: Loot; defenseAt?: number; defenseReason?: string | null;
  departAt?: number | null; completed: string[]; rally?: { map: string; x: number; y: number };
  observedPhase?: string | null; runtimes?: unknown; location: Area;
  returnRouting?: boolean; townFirst?: boolean; townCompleted?: boolean;
  failure?: string | null; failureCode?: string | null; failedAt?: number | null;
  observationPhase?: string; sharedStoppedAt?: number; observationReadyAt?: number;
  // The walk's phase and arrivals when it stopped to defend, so it goes on as the same walk.
  defendedFrom?: { phase: string; completed: string[] };
}
interface Party extends DefenseState {
  monsterSearchRadiusByCharacter?: Record<string, number | undefined>;
  combatLogs?: Record<string, import("../../status/api.ts").StoredCombatLogEntry[]>;
  activeConvoy?: Convoy | null; commands: Record<string, unknown>;
  navigationIntents?: Record<string, { cancelled?: boolean } | undefined>;
  escape?: { stage: string } | null;
  monsterHunt?: unknown;
}
function cancelled(p: Party, c: Convoy): boolean {
  return c.participants.some(n => p.navigationIntents?.[n]?.cancelled) || !!p.escape && p.escape.stage !== "released";
}
function createLoot(c: Convoy, lead: Status, now: number): Loot {
  return { id: JSON.stringify(["convoy", c.id, c.epoch, now]), after: now, realm: `${lead.region || ""}:${lead.server || ""}`,
    map: lead.map, in: String(lead.in ?? lead.map), x: lead.x, y: lead.y, complete: false };
}
// The leader's loot report counts while it stands within the game's chest reach of the spot, the
// reach the hunting owner's loot client loots from (hunting/rules.ts GAME_CHEST_REACH), less the distance it
// may have walked since its report, as the Hunt's loot barrier reads it (hunting/coordinator/hunt.ts).
function matching(progress: Progress | undefined, loot: Loot, lead: Status, now: number): progress is Progress {
  return !!progress && progress.id === loot.id && progress.observedAt > loot.after &&
    progress.realm === loot.realm && progress.map === loot.map && String(progress.in) === loot.in &&
    lead.map === loot.map && String(lead.in ?? lead.map) === loot.in && Math.hypot(lead.x - loot.x, lead.y - loot.y) <= reachLessDrift(GAME_CHEST_REACH, lead.speed, now - lead.seenAt);
}
function lootComplete(p: Party, c: Convoy, now: number): boolean {
  const lead = p.statuses[c.leader] as Status;
  c.loot ||= createLoot(c, lead, now);
  if (matching(lead.convoyLoot, c.loot, lead, now)) { c.loot.progress = lead.convoyLoot; c.loot.complete = lead.convoyLoot.complete; }
  if (c.loot.complete) return true;
  c.defenseReason = "Pending travel loot: " + (c.loot.progress?.error || "collecting defensive kill drops");
  return false;
}
// Queue A4: a walk that stopped to defend runs its loot pass and goes on as the same walk under
// the same epoch. Its arrivals stand. A walk stopped in a barrier phase gathers again at the
// leader. A walk past the barrier holds in shared-hold, which plans a new shared route from where
// the leader stands, since its route was detached for the fight. Any other walk off reassembles
// under a new epoch, as b9b5c91e convoy-defense.ts:63-73 did. The walk's hold owns the member
// while it defends and lends it to combat steps.
function resume(p: Party, c: Convoy, now: number): void {
  if(c.huntTravel){c.huntTravel.primary=null;c.huntTravel.committed=[];delete c.huntTravel.reason;}
  delete c.defenseTargets;
  c.townRetry = false;
  delete c.farmingEngagement;
  delete c.loot;
  const from = c.defendedFrom;
  delete c.defendedFrom;
  const barrier = !from || from.phase === "assemble" || from.phase === "town";
  walkPhase(p, c, barrier ? "assemble" : "shared-hold"); if (!from) c.epoch++; c.observedPhase = null;
  if (!barrier) c.sharedStoppedAt = now;
  // The barrier binds the runtimes again when the members gather. shared-hold goes on as the same
  // walk, so it keeps the runtimes it set out with, which health() checks every report against.
  if (barrier) c.runtimes = null;
  c.completed = from ? from.completed : [];
  c.returnRouting = !!c.returnRouting; c.townFirst = false; c.townCompleted = false;
  c.failure = null; c.failureCode = null; c.failedAt = null; c.defenseReason = null;
}
function observeHold<S, C>(input: S, p: Party, c: Convoy, message: string,
  commandFor: (state: S, convoy: C, phase: string, name: string) => unknown): boolean {
  c.defenseReason = message;
  if (c.phase === "observing") { delete c.observationReadyAt; return true; }
  c.observationPhase = c.phase; walkPhase(p, c, "observing"); c.departAt = null;
  for (const name of c.participants) merchantSlotCommand(p, 'convoy:' + c.id, commandFor(input, c as C, "shared-hold", name), name);
  return true;
}
function resumeObservation<S, C>(input: S, p: Party, c: Convoy, now: number,
  commandFor: (state: S, convoy: C, phase: string, name: string) => unknown): boolean {
  if (c.phase !== "observing") return false;
  if (!observationStable(p, c, now)) return true;
  delete c.observationReadyAt;
  const defended = c.observationPhase === "defending";
  delete c.observationPhase;
  if (defended) { walkPhase(p, c, "defending"); return false; }
  resume(p, c, now);
  const lead = p.statuses[c.leader] as Status;
  c.rally = c.returnTownRally || {map:lead.map, x:lead.x, y:lead.y};
  walkPhase(p, c, 'shared-hold'); c.sharedStoppedAt = now;
  issue(input, p, c, commandFor);
  return true;
}
// CF4 W convoy-defense.ts:124, the walk phase table `report-gap` (A20): the observing hold ends once every member's
// next report after all stood held is in, a Hunt walk's too.
function observationStable(p: Party, c: Convoy, now: number): boolean {
  if (!observationStopped(p,c,now)) { delete c.observationReadyAt; return false; }
  const since = c.observationReadyAt ??= now;
  return c.participants.every(name => Number((p.statuses[name] as Status | undefined)?.seenAt) > since);
}
function observationStopped(p: Party, c: Convoy, now: number): boolean {
  return c.participants.every(name => {
    const s = p.statuses[name] as DefenseReport & {moving?:boolean;transporting?:boolean};
    return s?.convoyNavigation?.phase === "held" && !s.moving && !s.transporting && reportOwned(p,c,{...s,name},now);
  });
}
function finishDefense(p: Party, c: Convoy, now: number): boolean {
  if (!lootComplete(p, c, now)) return false;
  const lead = p.statuses[c.leader] as Status;
  resume(p, c, now); c.rally = c.returnTownRally || { map: lead.map, x: lead.x, y: lead.y };
  return true;
}
function defend(p: Party, c: Convoy, now: number, message: string): boolean {
  delete c.loot; c.defenseReason = message;
  if (c.phase === "defending") return false;
  // A failed walk has nothing to go on with, so it rebuilds as b9b5c91e does.
  if (c.phase !== "observing" && c.phase !== "failed") c.defendedFrom = { phase: c.phase, completed: [...c.completed] };
  walkPhase(p, c, "defending"); c.defenseAt = now; c.departAt = null; c.completed = [];
  return true;
}
function ownedConvoy(p: Party): Convoy | null {
  const c = p.activeConvoy;
  return c && !c.continuousReturn && !returnWalking(c) && walkEligible(c) && !cancelled(p, c) && !superseded(p, c) && !casualty(p, c) ? c : null;
}
function superseded(p: Party, c: Convoy): boolean {
  return c.participants.some(name => {
    const command = p.commands[name] as { type?: string; convoyId?: string } | undefined;
    return !!command && (!!command.type && command.type !== "party-monster-travel" || !!command.convoyId && command.convoyId !== c.id);
  });
}
function casualty(p: Party, c: Convoy): boolean {
  return c.participants.some(name => { const s = p.statuses[name] as Status | undefined; return s?.rip || s?.hp === 0; });
}
function localDefense(p: Party, c: Convoy): boolean {
  return c.participants.some(name => {
    // A member's own defense against a live event boss a map away does not hold the leader.
    if (eventFightElsewhere(p, name)) return false;
    const command = p.commands[name] as {id?:number;convoyId?:string;epoch?:number;navigationRevision?:number} | undefined;
    const s = p.statuses[name] as {convoyNavigation?: {id:string;epoch:number;commandId:number;navigationRevision:number;runtimeId:string;phase:string};combatSelection?:{runtimeId?:string}} | undefined;
    const n=s?.convoyNavigation;
    if(!n || !command || n.phase!=='defending')return false;
    return command.convoyId===c.id && n.id===c.id && n.epoch===c.epoch && sameWalkOn({...command, epoch: n.epoch} as WalkCommand, n, s?.combatSelection?.runtimeId);
  });
}
interface DefenseReport {
  seenAt?: number;
  convoyNavigation?: {id:string;epoch:number;commandId:number;runtimeId:string;navigationRevision:number;phase:string;
    encounterCatchup?:{from:string;map:string;failed?:string|null};defenseTargets?:PassingEncounter[];defenseInterruption?:{source:string}};
  combatSelection?: {runtimeId:string};
}
function stoppedReports(p: Party, c: Convoy): (DefenseReport & {name:string})[] {
  return c.participants.map(name=>({...p.statuses[name] as DefenseReport,name})).filter(s=>
    s?.convoyNavigation?.phase==='defending' && s.convoyNavigation.id===c.id && s.convoyNavigation.epoch===c.epoch);
}
function reportOwned(p: Party, c: Convoy, s: DefenseReport & {name:string}, now: number): boolean {
  const n=s.convoyNavigation!;
  const command=p.commands[s.name] as {id?:number;convoyId?:string;navigationRevision?:number} | undefined;
  return fresh(s.seenAt, now) && command?.convoyId===c.id &&
    sameWalkOn({...command, epoch: n.epoch} as WalkCommand, n, s.combatSelection?.runtimeId);
}
function stoppedCauses(c: Convoy, reports: DefenseReport[]): PassingEncounter[] | null {
  const causes=[...(c.defenseTargets||[])];
  for(const s of reports) {
    const n=s.convoyNavigation!, targets=n.defenseTargets||[];
    if(!targets.length && !(causes.length && n.defenseInterruption?.source==='coordinator'))return null;
    causes.push(...targets);
  }
  return causes.length ? [...new Map(causes.map(t=>[passingIdentity(t),t])).values()] : null;
}
function obsoleteDefense(p: Party, c: Convoy, now: number): boolean {
  if(outboundHunt(c) || c.huntTravel?.reason)return false;
  const members=c.participants.map(name=>({name,ctype:'',revision:0,status:p.statuses[name] as Member['status']}));
  const passing=new Set(collectPassing(members,[],now).map(passingIdentity));
  const reports=stoppedReports(p,c);
  if(!reports.every(s=>reportOwned(p,c,s,now)))return false;
  const causes=stoppedCauses(c,reports);
  return !!causes && causes.every(t=>passing.has(passingIdentity(t)));
}
function resumePassingDefense<S,C>(input:S,p:Party,c:Convoy,state:string,now:number,
  commandFor:(state:S,convoy:C,phase:string,name:string)=>unknown):boolean {
  if(state!=='clear' || !obsoleteDefense(p,c,now))return false;
  // The walk goes on as the same walk (A4), planning again because its shared route was detached
  // for the fight. Passing-only stops own no loot.
  resume(p, c, now);
  issue(input, p, c, commandFor);
  return true;
}
function rememberDefenseTargets(p:Party,c:Convoy,attackers:PassingEncounter[]):void {
  if(c.huntTravel)c.huntTravel.reason ||= 'extra-aggro';
  if(attackers.length)c.defenseTargets=[...new Map([...(c.defenseTargets||[]),...attackers].map(t=>[passingIdentity(t),t])).values()];
  else c.defenseTargets=stoppedCauses(c,stoppedReports(p,c))||undefined;
}
function defenseDetail(p:Party,c:Convoy,now:number,message:string):string {
  const catchup=catchupMessage(p,c,now);
  return message+(catchup ? '; '+catchup : '');
}
function catchupMessage(p: Party, c: Convoy, now: number): string {
  return stoppedReports(p,c).filter(s=>reportOwned(p,c,s,now)).flatMap(s=> {
    const r=s.convoyNavigation?.encounterCatchup;
    return r ? [s.name+': '+(r.failed || 'joining encounter from '+r.from+' to '+r.map)] : [];
  }).join('; ');
}
function defenseParticipants(c: Convoy): string[] {
  return outboundHunt(c) ? c.participants : c.participants.filter(name=>!c.completed.includes(name));
}
/** All route implementations share this barrier and keep their own command identities. */
function advanceDefense<S, C>(input: S, now: number, commandFor: (state: S, convoy: C, phase: string, name: string) => unknown): boolean {
  const p = input as Party, c = ownedConvoy(p);
  if (!c) return false;
  const decision = classifyTravelDefense(p, defenseParticipants(c), now);
  if (farmingEngagementPending(p,c,now)) return true;
  if (decision.state === "waiting-for-observations") return observeHold(input, p, c, decision.message, commandFor);
  if(resumePassingDefense(input,p,c,decision.state,now,commandFor))return true;
  const observationResumed=resumeObservation(input, p, c, now, commandFor);
  if ([observationResumed,decision.state === "clear"].every(Boolean)) return true;
  if (needsDefense(p,c,decision.state) && !walkOn(c,decision.attackers)) {
    rememberDefenseTargets(p,c,decision.attackers.map(t=>({...t,at:now})));
    if (!defend(p, c, now, defenseDetail(p,c,now,decision.message))) return true;
  } else {
    if (c.phase !== "defending") { c.defenseReason = null; return false; }
    if (!finishDefense(p, c, now)) return true;
  }
  issue(input, p, c, commandFor);
  return true;
}
// The walk's phase command goes to each member that has not arrived, as walk.ts `issue` sends it.
function issue<S, C>(input: S, p: Party, c: Convoy, commandFor: (state: S, convoy: C, phase: string, name: string) => unknown): void {
  for (const name of c.participants) if (!c.completed.includes(name)) merchantSlotCommand(p, 'convoy:' + c.id, commandFor(input, c as C, c.phase, name), name);
}

function farmingEngagementPending(p: Party, c: Convoy, now: number): boolean {
  const encounter=c.farmingEngagement;
  if (!encounter || encounter.finished) return false;
  const group=p.groupedCombat as {deaths?: {id:string;map:string;in?:string|number;server?:string}[];lostTargets?: {id:string;map:string;in?:string|number;server?:string}[];target?:{id:string}} | undefined;
  const matches=(t: typeof encounter.target)=>t.id===encounter.target.id && t.map===encounter.target.map &&
    String(t.in??t.map)===String(encounter.target.in??encounter.target.map) && t.server===encounter.target.server;
  const retired=group ? [...(group.deaths||[]),...(group.lostTargets||[])] : [];
  encounter.finished=retired.some(matches) || farmingTargetLeftArea(p,c,now) ||
    farmingTargetSwitched(encounter,group?.target);
  return !encounter.finished;
}

// CF4 W convoy-defense.ts:265: the encounter ends once the group's targeting names another target
// (the targeting owner's answer), with no 15 s clock.
function farmingTargetSwitched(encounter: NonNullable<Convoy['farmingEngagement']>, target: {id:string} | undefined): boolean {
  return !!target && target.id!==encounter.target.id;
}

function sameFarmingPlace(status: Status, target: NonNullable<Convoy['farmingEngagement']>['target']): boolean {
  return status.server===target.server && status.map===target.map && String(status.in??status.map)===String(target.in??target.map);
}
function farmingTargetLeftArea(p: Party, c: Convoy, now: number): boolean {
  const target=c.farmingEngagement!.target;
  const radius=searchReach(p.monsterSearchRadiusByCharacter, c.leader);
  return c.participants.some(name=>{
    const status=p.statuses[name] as Status | undefined;
    if (!status || !fresh(status.seenAt,now)) return false;
    const observation=status.groupedCombat;
    if (!fresh(observation?.observationAt,now,'report',reportClockError(status)) || !sameFarmingPlace(status,target)) return false;
    const sighting=observation?.sightings?.find(candidate=>candidate.id===target.id &&
      candidate.map===target.map && String(candidate.in??candidate.map)===String(target.in??target.map));
    return !!sighting && !contains(c.location,sighting,0,radius);
  });
}

// A4: a fight the party cannot win is not the walk's to stay for.
function walkOn(c:Convoy,attackers:{mtype?:string;hp?:number;target:string}[]):boolean {
  if(!attackers.length)return false;
  // Survival's walk verdict (`survival.verdict({walk})`,) answers with
  // today's `fightWinnable`, unchanged, so A4's rule stays one model.
  if(partyHooks().survival.verdict({walk:true,members:c.participants,attackers})==='fight')return false;
  c.defenseReason='Walking on: the party cannot win this fight';
  return true;
}
function needsDefense(p:Party,c:Convoy,state:string):boolean {
  return state==='defending' || c.phase!=='defending' && localDefense(p,c);
}

const defenseMessages = new WeakMap<object, string>();
export function step<S,C>(input:S,now:number,commandFor:(state:S,convoy:C,phase:string,name:string)=>unknown):boolean {
  const p=input as Party, c=p.activeConvoy;
  const before=c?.phase;
  const changed=advanceDefense(input,now,commandFor);
  if(!c || !changed)return changed;
  const message=c.phase==='assemble' && before!=='assemble' ? 'Travel encounter complete; regrouping toward '+(c.huntTarget||c.label||'destination') : c.defenseReason;
  if(message && message!==defenseMessages.get(c)) {
    defenseMessages.set(c,message);
    logDefense(p,c,now,message);
  }
  return changed;
}

function logDefense(p:Party,c:Convoy,now:number,message:string):void {
  appendCombatLog(p.combatLogs,c.leader,{at:now,type:'navigation',message,details:{convoyId:c.id,epoch:c.epoch,destination:c.location}});
}

export function communicationReason(text: string): boolean {
  const reason = text.replace(/^(?:[A-Za-z0-9_]+: )?(?:Error: )*/, '');
  return reason === 'Shared route coordinator signal expired' ||
    /^POST \/(?:movement-barrier|movement-plan) · (?:network|timeout)(?:$|:)/.test(reason);
}
// The communication hold takes over a failed walk whose failure is the coordinator's communication
// alone: the member's captured context names this walk at its current epoch, so no later climb or
// failure followed it, and every cause the failure names is a communication cause (R1.3: the walk
// holds no `recoveryAttempts` gate; the ladder keeps the walk's climbs).
export function capturedCommunicationFailure(c: {id: string; epoch?: unknown; phase: string; communicationLegacyRecovered?: boolean; failureDetails?: unknown; failure?: string}): boolean {
  if (c.phase !== 'failed' || c.communicationLegacyRecovered) return false;
  const context = requestObject(requestObject(c.failureDetails).failureContext);
  if (context.convoyId !== c.id || context.epoch !== c.epoch) return false;
  const reason = c.failure || '';
  const pair = /^Return route held after two planning cycles; first: (.+); latest: (.+)$/.exec(reason);
  if (pair) return communicationReason(pair[1]!) && communicationReason(pair[2]!);
  return communicationReason(reason);
}


/** Only the old, captured completion-network failure is eligible for migration. */
export function legacyCompletionFailure(c: { id: string; purpose?: string | null; phase: string;
  failure?: string; failureDetails?: unknown; communicationLegacyRecovered?: boolean; location?: {map: string; x: number; y: number} }): boolean {
  if (c.purpose !== 'monster-hunt' || c.phase !== 'failed' || c.communicationLegacyRecovered) return false;
  if (!/POST \/convoy-complete · (network|timeout)(?:$|:)/.test(c.failure || '')) return false;
  const context = requestObject(requestObject(c.failureDetails).failureContext);
  const position = requestObject(context.position), destination = requestObject(context.destination);
  return context.phase === 'arrived' && context.convoyId === c.id && !!c.location &&
    equalPosition(destination, c.location) && equalPosition(position, destination);
}
function equalPosition(a: Record<string, unknown>, b: {map?: unknown; x?: unknown; y?: unknown}): boolean {
  return a.map === b.map && a.x === b.x && a.y === b.y;
}

interface Ports {
  owned(state: SharedState, c: SharedConvoy, name: string): boolean;
  hold(state: SharedState, c: SharedConvoy): void;
  resume(state: SharedState, c: SharedConvoy, now: number): boolean;
  fail(state: SharedState, reason: string, code: string, now: number): boolean;
}

function failedRouteHeld(c: SharedConvoy, legacy: boolean): boolean {
  return c.merchantInterruption?.resumePhase === 'failed' || c.phase === 'failed' && !legacy;
}

/** Readiness is intentionally not persisted: every restart requires fresh observations. */
// Queue A20 (decided by the user): a group walk keeps going through a late report
// while no attacker is known, for up to two of the console's own report intervals, which each
// member reports (`reportIntervalMs`); only a longer gap, or one while an attacker is known,
// holds the walk in communication-hold.
export function createCommunicationRecovery(ports: Ports) {
  function affected(state: SharedState, c: SharedConvoy, name: string, now: number): boolean {
    const s = state.statuses[name];
    return memberAffected(state, c, name, now, s && { reading: 'walk', attackerKnown: knownAttacker(s), intervalMs: (s as { reportIntervalMs?: number }).reportIntervalMs });
  }
  function enter(state: SharedState, c: SharedConvoy, now: number, names: string[], legacy: boolean): boolean {
    const resumeDefense = c.phase === 'defending' || c.observationPhase === 'defending' || !!c.loot;
    const details = names.map(name => name + ': ' + (travelObservationIssue(state.statuses[name], now) || 'walking signal expired')).join('; ');
    c.communicationHold = { since: now, participants: names, reason: legacy ? 'Recovering captured coordinator communication failure' : 'Waiting for coordinator communication: ' + details, legacy, resumeDefense };
    if (legacy) c.communicationLegacyRecovered = true;
    walkPhase(state, c, 'communication-hold'); c.departAt = null; c.epoch++;
    c.completed = []; c.failureCode = undefined; c.failure = c.communicationHold.reason;
    ports.hold(state, c);
    recordConvoyHistory(state, c, 'communication lost', now, { ...c.communicationHold, reports: Object.fromEntries(names.map(name => [name, {seenAt: state.statuses[name]?.seenAt, sample: requestObject(state.statuses[name]).travelSample}])) });
    return true;
  }
  function detect(state: SharedState, c: SharedConvoy, now: number): boolean {
    const transport = capturedCommunicationFailure(c);
    const legacy = legacyCompletionFailure(c) || transport;
    // Collection's stopped barrier handles freshness for an exhausted route.
    // Communication recovery must not turn that temporary hold into fresh travel.
    if (failedRouteHeld(c, legacy)) return false;
    const names = c.participants.filter(n => affected(state, c, n, now));
    if (!legacy && !names.length) return false;
    if (!c.participants.every(n => ports.owned(state, c, n))) return false;
    if (transport) delete c.returnFirstFailure;
    return enter(state, c, now, legacy ? c.participants : names, legacy);
  }
  function rebind(state: SharedState, c: SharedConvoy, now: number): boolean {
    const changed = c.participants.some(n => {
      const s = state.statuses[n];
      return !state.commands[n] || !!s && fresh(s.seenAt, now) &&
        !!characterRuntime(s) && c.expected?.[n]?.runtimeId !== characterRuntime(s);
    });
    if (!changed) return false;
    c.epoch++; ports.hold(state, c);
    return true;
  }
  function ready(state: SharedState, c: SharedConvoy, now: number): boolean {
    const leader = state.statuses[c.leader];
    return c.participants.every(n => {
      const s = state.statuses[n];
      if (!readyStatus(s, now)) return false;
      return !!characterRuntime(s) && s.server === (c.routeServer || leader?.server) &&
        reportMatches(state, n) && s.convoyNavigation?.phase === 'held';
    });
  }
  function resume(state: SharedState, c: SharedConvoy, now: number): boolean {
    const hold = c.communicationHold!;
    if (!ready(state, c, now)) { c.failure = hold.reason + ': ' + holdBlockers(state,c,now).join('; '); return false; }
    // ports.resume (walk.ts resumeCommunication) refuses while the walk's defense or route is not
    // ready to go again.
    c.failure = 'Communication restored; preparing the walk to resume';
    if (!ports.resume(state, c, now)) return false;
    delete c.communicationHold; c.failure = undefined;
    delete c.failureCode; delete c.failedAt; c.restartRecovery = false;
    // Preserve movement counters. Only the terminal marker for the migrated network failure is retired.
    if (hold.legacy) c.retryExhausted = false;
    recordConvoyHistory(state, c, 'communication restored', now, { durationMs: now - hold.since, participants: hold.participants });
    return true;
  }
  return function step(state: SharedState, c: SharedConvoy, now: number): boolean | null {
    if (!eligible(c)) return null;
    if (!c.communicationHold) return detect(state, c, now) ? true : null;
    if (!c.participants.every(n => ports.owned(state, c, n))) {
      delete c.communicationHold;
      return ports.fail(state, 'Communication recovery superseded by newer navigation', 'owner-lost', now);
    }
    if (rebind(state, c, now)) return true;
    return resume(state, c, now);
  };
}

function holdRuntimeIssue(s: NonNullable<SharedState['statuses'][string]>, server: string | undefined): string | null {
  if(s.server!==server)return 'server mismatch';
  return !characterRuntime(s) ? 'waiting for a runtime report' : null;
}
function holdBlockers(state: SharedState, c: SharedConvoy, now: number): string[] {
  return c.participants.flatMap(name=> {
    const s=state.statuses[name];
    if(!readyStatus(s,now))return [name+': waiting for fresh living stopped report'];
    const reason=!reportMatches(state,name) ? 'waiting for matching hold command, epoch, navigation and runtime acknowledgement' :
      s.convoyNavigation?.phase!=='held' ? 'waiting for held acknowledgement (reported '+s.convoyNavigation?.phase+')' :
      holdRuntimeIssue(s,c.routeServer||state.statuses[c.leader]?.server);
    return reason ? [name+': '+reason] : [];
  });
}
function eligible(c: SharedConvoy): boolean {
  return c.geometryRepair?.phase !== 'waiting' && c.failureCode !== 'geometry-mismatch';
}
function readyStatus(s: SharedState['statuses'][string], now: number): s is NonNullable<SharedState['statuses'][string]> {
  return !!s && !s.rip && s.hp !== 0 && !s.moving && !s.transporting && fresh(s.seenAt, now);
}

// A member counts no attacker while its last attacker list is empty.
function knownAttacker(s: NonNullable<SharedState["statuses"][string]>): boolean {
  return !!s.groupedCombat?.currentAttackers?.length;
}
// `walk`: A20's walk reading for a member's report. While it does not widen to two intervals, the
// attacker observation check applies too.
function memberAffected(state: SharedState, c: SharedConvoy, name: string, now: number, walk?: WalkReading): boolean {
  if (c.completed.includes(name)) return false;
  const s = state.statuses[name];
  if (s?.rip || s?.hp === 0) return false;
  if (!s) return true;
  if (!fresh(s.seenAt, now, walk) || !widens(walk!) && observationLost(s, now)) return true;
  return recoveryReportMatches(state,c,name,now) && communicationReport(s.convoyNavigation, c.routeVersion);
}
function communicationReport(report: SharedReport | undefined, routeVersion: number | undefined): boolean {
  if (!report?.communication || report.communication.operation === '/convoy-complete') return false;
  if (report.phase === 'communication-hold') return true;
  // Older clients can publish readiness from a late response after signal expiry.
  // Repair only this captured failure under the current route generation.
  return report.phase === 'route-ready' && report.routeVersion === routeVersion &&
    report.communication.operation === '/status' &&
    ['expired-signal', 'missing-signal'].includes(report.communication.kind) &&
    report.failure === 'Shared route coordinator signal expired';
}

function observationLost(s: NonNullable<SharedState["statuses"][string]>, now: number): boolean {
  return !!s.groupedCombat && !!travelObservationIssue(s, now);
}

// The legacy assembly barrier binds expected runtimes before it creates the
// shared route's runtimes map. A failed initial planner request must still
// reach the existing fresh all-party hold protocol.
function initialAssemblyReport(state: SharedState,c: SharedConvoy,name: string,now: number): boolean {
  const s=state.statuses[name],command=walkCommandOf(state, name),n=s?.convoyNavigation;
  if(c.phase!=='assemble' || c.runtimes || !command || !n || !readyStatus(s,now))return false;
  if(!initialAssemblyCommand(c,command,n))return false;
  return initialAssemblyRuntime(c,name,command.id,command.navigationRevision,s,n) && initialAssemblyTransport(state,c,s,n);
}
function recoveryReportMatches(state: SharedState,c: SharedConvoy,name: string,now: number): boolean {
  return reportMatches(state,name) || initialAssemblyReport(state,c,name,now);
}
function initialAssemblyRuntime(c: SharedConvoy,name: string,id: number,revision: number,s: NonNullable<SharedState['statuses'][string]>,n: SharedReport): boolean {
  const expected=c.expected?.[name],runtime=characterRuntime(s);
  return !!runtime && runtime===n.runtimeId && expected?.runtimeId===runtime && expected.commandId===id && expected.revision===revision;
}
function initialAssemblyTransport(state: SharedState,c: SharedConvoy,s: NonNullable<SharedState['statuses'][string]>,n: SharedReport): boolean {
  return typeof s.server==='string' && !!s.server && s.server===state.statuses[c.leader]?.server &&
    n.communication?.operation==='/movement-plan' && ['network','timeout'].includes(n.communication.kind);
}
function initialAssemblyCommand(c: SharedConvoy,command: SharedCommand,n: SharedReport): boolean {
  return command.type==='party-monster-travel' && command.phase==='assemble' &&
    command.convoyId===c.id && command.epoch===c.epoch && sameWalk(command, n) && !n.routeVersion;
}


export interface MerchantInterruption {
  kind?: "equipment";
  jobId: unknown;
  recipient: string;
  phase: "stopping" | "ready" | "collecting" | "resuming";
  deadline: number;
  resumePhase: string;
  revisions: Record<string, number>;
  commandId?: number;
}
interface MerchantState extends SharedState { merchantCurrent?: { id: unknown } | null }

/** Admission never replaces travel. The navigation tick first stops the whole party. */
export function admitMerchantInterruption(input: unknown, name: string, jobId: unknown, now: number, deadlineMs: number, kind?: "equipment"): boolean {
  const state = input as SharedState, c = state.activeConvoy;
  if (!c?.participants.includes(name)) return !navigationCommand(state.commands[name]);
  if (c.communicationHold) return false;
  if (!preemptible(c) || ["defending", "observing", "communication-hold"].includes(c.phase)) return false;
  const pause = c.merchantInterruption;
  if (pause) return pause.jobId === jobId && pause.recipient === name && pause.phase === "ready";
  // The pause's deadline is the merchant job's, which its request passes (CF4 W
  // merchant-interruption.ts:24).
  c.merchantInterruption = { kind, jobId, recipient: name, phase: "stopping", deadline: now + deadlineMs,
    resumePhase: c.phase, revisions: Object.fromEntries(c.participants.map(n => [n, state.navigationIntents?.[n]?.revision || 0])) };
  recordConvoyHistory(state, c, "merchant pause", now, { recipient: name, jobId });
  return false;
}
function navigationCommand(command: SlotCommand | undefined): boolean {
  return !!command && ["event-return-town", "event-resume-travel", "party-monster-travel", "town-party",
    "character-travel", "travel", "return-leader"].includes(command.type);
}

export function attachMerchantInterruption(input: unknown, name: string, command: { id: number; [key: string]: unknown }): void {
  const c = (input as SharedState).activeConvoy, pause = c?.merchantInterruption;
  if (!c || !pause || pause.recipient !== name) return;
  pause.commandId = command.id; pause.phase = "collecting";
  command.convoyContinuation = { convoyId: c.id, navigationRevision: pause.revisions[name], deadline: pause.deadline };
  // A collection does not cancel the enclosing Town/event return generation.
  if (c.purpose === "shared-walk-return") command.purpose = c.purpose;
}

export function finishMerchantInterruption(input: unknown, name: string, commandId: unknown): void {
  const pause = (input as SharedState).activeConvoy?.merchantInterruption;
  if (pause?.recipient === name && pause.commandId === commandId) pause.phase = "resuming";
}

/** Release only the ending job's collection. Never erase a newer navigation command. */
export function releaseMerchantInterruption(input: unknown, jobId: unknown): void {
  const state = input as SharedState, pause = state.activeConvoy?.merchantInterruption;
  if (jobId === undefined) return;
  if (pause && pause.kind !== 'equipment' && pause.jobId === jobId) pause.phase = 'resuming';
  for (const [name, command] of Object.entries(state.commands)) {
    if (command?.jobId === jobId && ['merchant-handoff', 'merchant-order-handoff'].includes(command.type))
      delete state.commands[name];
  }
}

function owned(state: SharedState, c: SharedConvoy, name: string): boolean {
  const pause = c.merchantInterruption!, command = state.commands[name];
  if (!sameIntent(state, c, name)) return false;
  if (!command) return !!c.restartRecovery || (name === pause.recipient && pause.phase === "resuming");
  return command.convoyId === c.id || (name === pause.recipient && command.id === pause.commandId);
}
function sameIntent(state: SharedState, c: SharedConvoy, name: string): boolean {
  const intent = state.navigationIntents?.[name];
  return (intent?.revision || 0) === c.merchantInterruption!.revisions[name] && !cancelEnds(c, intent);
}
function stopped(state: SharedState, c: SharedConvoy, now: number): boolean {
  return c.participants.filter(n => !c.completed.includes(n)).every(n => {
    const s = state.statuses[n];
    return !!s && fresh(s.seenAt, now) && !s.moving && reportMatches(state, n) && s.convoyNavigation?.phase === "held";
  });
}
function hold(state: SharedState, c: SharedConvoy, make: (name: string) => SharedCommand): void {
  for (const name of c.participants.filter(n => !c.completed.includes(n))) {
    const command = state.commands[name];
    const runtime = characterRuntime(state.statuses[name]) || "";
    if (command?.convoyId === c.id && command.phase === "shared-hold" && c.runtimes?.[name] === runtime) continue;
    (c.runtimes ||= {})[name] = runtime;
    merchantSlotCommand(state, 'convoy:' + c.id, { ...make(name), reason: "Travel paused for " + c.merchantInterruption!.recipient +
      (c.merchantInterruption!.kind === 'equipment' ? "'s delivered equipment" : "'s merchant collection") }, name);
  }
}

/** Returns null when ordinary navigation may run; otherwise consumes this tick. */
export function stepMerchantInterruption(input: SharedState, now: number, ports: {
  hold: (name: string) => SharedCommand; resume(phase: string): boolean; fail(reason: string): boolean;
}): boolean | null {
  const state = input as MerchantState, c = state.activeConvoy, pause = c?.merchantInterruption;
  if (!pause) return null;
  // Job cleanup can remove its handoff before this tick. Release the pause before
  // checking ownership, while still rejecting changed intents or newer commands.
  if (expired(state, pause, now)) pause.phase = "resuming";
  if (!c.participants.every(n => c.completed.includes(n) || owned(state, c, n))) {
    delete c.merchantInterruption;
    return ports.fail("Merchant continuation superseded by newer navigation or command");
  }
  c.departAt = null;
  walkPhase(input, c, "shared-hold");
  if (pause.phase === "collecting") return false;
  hold(state, c, ports.hold);
  if (!stopped(state, c, now)) return true;
  if (pause.phase === "resuming") {
    c.restartRecovery = false;
    // A collection may temporarily stop a failed convoy, but it never grants
    // another route attempt or erases the original travel diagnostics.
    if (pause.resumePhase !== "failed") { c.failure = undefined; c.failureCode = undefined; }
    recordConvoyHistory(state, c, "merchant resume", now, { recipient: pause.recipient, jobId: pause.jobId });
    delete c.merchantInterruption;
    return ports.resume(pause.resumePhase);
  }
  if (pause.phase === "ready") return false;
  pause.phase = "ready";
  return true;
}
function expired(state: MerchantState, pause: MerchantInterruption, now: number): boolean {
  return now >= pause.deadline || pause.kind !== 'equipment' && state.merchantCurrent?.id !== pause.jobId;
}

// A member at an event (the events owner's `event.presence`) belongs to its event, so the walk's
// defense leaves it out.
function eventOwnsParticipant(name: string): boolean {
  return !!eventPresence(name);
}
// A walk takes the coordinator's travel defense unless it is forced, abnormal travel, an
// exempt walk (the request table `exemptWalk`) or has a member at an event.
function walkEligible(c: Convoy): boolean {
  return !c.force && normalTravel(c.purpose) && !exemptWalk(c) && !c.participants.some(eventOwnsParticipant);
}
