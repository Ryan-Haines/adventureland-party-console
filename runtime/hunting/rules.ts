// Hunts and farming's rule rows: the decisions of its rule tables and the game reaches they read,
// used by the module's services, which keep the state, the walks and the ports.
import { contains, defaultSearchRadius, type Area } from './zones.ts';
import { object } from '../settings/api.ts';
import type { CaveChoice, CaveCommand, CavePoint, FarmAreaState, FarmSpot } from './api.ts';
import type { FarmingArea } from './areas.ts';

// The server's chest pickup reach (node/server.js:11329 `open_chest`): a chest farther than 400 from
// the player between centres opens dry.
export const GAME_CHEST_REACH = 400;
// The server's reach for an NPC's transport and the Cave's Dorr and merchants (node/server.js:228
// `B.transporter_dist`).
export const GAME_NPC_REACH = 160;
// The server's reach for Daisy's quest and turn-in (node/server.js:225 `B.sell_dist`, checked
// at:5483 against `G.maps.main.ref.monsterhunter`).
export const GAME_DAISY_REACH = 400;
// The field generator's reach (node/server.js:3620-3630): a monster inside it is in the field.
export const GAME_FIELD_REACH = 300;
// A kept safety bound (the numbers rule, 2026-11-13; bigcheck/bounds.md): a rare in combat whose HP
// sets no new low for this long ends its encounter as no progress and tells the status owner's bound
// record. It guards against the game's design: a rare the party cannot damage, or one that heals as
// fast as the party hits it. A rare targeting a member keeps its encounter (rares.ts
// `encounterExpired`). No game data or measurement gives the window, so it keeps the earlier
// console's value (navigation/rare-hunting.ts:501; queue).
export const RARE_PROGRESS_BOUND_MS = 30_000;
// A kept record bound (the numbers rule; bigcheck/bounds.md): a rejection ends on a reported kill or
// an attack on a member, and a rare that dies or despawns out of the party's sight sends neither, so
// the record keeps v1.5.0's newest count by sighting time (coordinator/rares.ts
// `keepRejections`).
export const RARE_REJECTIONS_KEPT = 100; // runtime/coordinator/navigation/rare-retention.ts:8 RARE_RECORD_LIMIT

// The party's focus: the Hunt's target while a Hunt runs, else the party's monster focus.
// coordinator/modes.ts `monsterFocus` answers a member from it.
export interface FocusFacts { targetMode?: string; monsterHunt?: { target?: string | null } | null; monsterFocus?: string[] | null }
export const huntFocusTarget = (state: FocusFacts): string | null => state.targetMode === 'hunt' && state.monsterHunt?.target || null;
export function partyFocus(state: FocusFacts): string[] {
  const target = huntFocusTarget(state);
  return target ? [target] : state.monsterFocus || [];
}

// A report's realm (its region and server) and instance, the identity a rare sighting, a Hunt loot
// pass and their receipts compare.
export const realmOf = (s?: { region?: string; server?: string }) => `${s?.region || ''}:${s?.server || ''}`;
export const instanceOf = (s?: { in?: string | number; map?: string }) => String(s?.in ?? s?.map ?? '');

// ---- The farm spot ----

// Membership by shape, else the character's search radius; a character with none saved searches
// within the declared default.
export function searchReach(radii: Record<string, number | undefined> | undefined, name: string | null): number {
  return Number(radii?.[String(name)]) || defaultSearchRadius;
}

// A member stands at the farm spot when it is on the spot's map, inside the area plus its own attack
// range (its report's `range`, the game's `character.range`): from there it reaches a monster at the
// area's edge. The farm arrival, the Hunt mission's arrival, the backup arrival and the farming
// walk's combat arrival ask this one row.
export function standsAt(spot: Area & { map?: string }, report: { map?: string; x?: number; y?: number; range?: unknown }, reach: number): boolean {
  return report.map === spot.map && contains(spot, report as { x: number; y: number }, Number(report.range) || 0, reach);
}

// Another player contests a zone with one kill, or two hits within the evidence window.
export function contests(hits: number, kill: boolean | undefined): boolean {
  return !!kill || hits >= 2;
}

/**
 * The areas the group may move to from `active`, best first: no busy zone and none excluded, then
 * the same map, more of the focus's monsters, a quiet zone with the newer mark first, the nearest, and the id.
 */
export function alternatives(state: FarmAreaState, areas: FarmingArea[], active: FarmSpot, excluded: string[] = []): FarmingArea[] {
  return areas.filter(area => area.id !== active.id && !excluded.includes(area.id) && !state.activity?.[area.id])
    .sort((a, b) => Number(b.map === active.map) - Number(a.map === active.map) || b.monsterIds.length - a.monsterIds.length ||
      (state.quiet?.[b.id] || 0) - (state.quiet?.[a.id] || 0) ||
      Math.hypot(a.x - active.x, a.y - active.y) - Math.hypot(b.x - active.x, b.y - active.y) || a.id.localeCompare(b.id));
}

// Failed farm travel: the walk's end code classifies it. Only a route the planner could not walk
// counts a strike on the area; every other code (a lost runtime, owner or realm, the geometry, an
// interrupted or missing Town, the members' assembly) says nothing about the area and retries it
// after the transient wait.
export function transientFailure(code: string | null | undefined): boolean {
  return code !== 'route-failed';
}

// The farming walk's hand-off holds while another owner's work holds the character: the items owner's
// Hunt errand, the movement owner's forced, Town, group and convoy walks and the departure, the merchant jobs owner's gathering, the events owner's event
// travel and anniversary visit or staging, and the tasks owner's farm reunion. Each port is one owner's fact.
export interface HandoffHolds {
  huntErrand(): boolean; forcedWalk(): boolean; townWalk(): boolean; townActive(): boolean; groupWalk(): boolean;
  convoyActive(): boolean; gathering(): boolean; eventTravelling(): boolean; anniversaryVisit(): boolean;
  anniversaryStaging(): boolean; departing(): boolean; reunion(): boolean;
}
export const handoffHeld = (f: HandoffHolds): boolean => f.huntErrand() || f.forcedWalk() || f.townWalk() || f.townActive() ||
  f.groupWalk() || f.convoyActive() || f.gathering() || f.eventTravelling() || f.anniversaryVisit() || f.anniversaryStaging() ||
  f.departing() || f.reunion();

// ---- The combat mode answer ----

// The facts the combat mode rows read: the group's live task (the tasks owner's), the combat mode entry, the
// scatter break, and the type the party farms with the types learned as one-shot.
export interface CombatModeFacts {
  task?: string | null;
  combatMode: string;
  scatterBreak: boolean;
  type: string | null | undefined;
  learned: string[];
}
type CombatAnswer = 'default' | 'scatter';
// First match wins. A Cave run, a rare encounter and a live death recovery fight grouped whatever
// the entry. Default and Scatter decide for themselves. Auto (any target mode) scatters on a
// learned type while no break holds. `default` is the grouped answer's saved name.
const combatModeRows: { when(facts: CombatModeFacts): boolean; answer: CombatAnswer }[] = [
  { when: f => f.task === 'cave', answer: 'default' },
  { when: f => f.task === 'rare', answer: 'default' },
  { when: f => f.task === 'death-recovery', answer: 'default' },
  { when: f => f.combatMode === 'default', answer: 'default' },
  { when: f => f.combatMode === 'scatter', answer: 'scatter' },
  { when: f => !f.scatterBreak && !!f.type && f.learned.includes(f.type), answer: 'scatter' },
];
export function combatModeAnswer(facts: CombatModeFacts): CombatAnswer {
  return combatModeRows.find(row => row.when(facts))?.answer ?? 'default';
}
// An answer as the reply or a combat mode entry sent it: `scatter`, or else the grouped answer's
// saved name. The character reads the reply's answer and the tasks owner's hand response an add-on entry's by it.
export function answerOf(sent: unknown): CombatAnswer {
  return sent === 'scatter' ? 'scatter' : 'default';
}

// ---- The Hunt's status line ----

// The facts a label names: the target and its kills left, the backup's ready count, a member, the
// Daisy action, the walk's or the receipt's own text.
export interface HuntLabelFacts {
  target?: string | null;
  left?: number | null;
  ready?: number;
  all?: number;
  name?: string;
  text?: string | null;
  turnIn?: boolean;
  action?: string;
}
type Label = (facts: HuntLabelFacts) => string;
const stageLabels = {
  'daisy-sync-travel': () => 'Synchronizing at Daisy',
  // The Daisy return's leg, Town step or blocker text.
  returning: f => 'Returning to Daisy' + (f.text ? ': ' + f.text : ''),
  'at-daisy': f => f.turnIn ? 'Turning in' : 'Taking a quest',
  assigning: f => f.turnIn ? 'Turning in' : 'Taking a quest',
  'waiting-expiry': () => 'Waiting at Daisy for the selected hunt to expire',
  'checking-quests': () => 'Checking quests',
  'mission-travel': f => 'Travelling to ' + f.target,
  farming: f => 'Hunting ' + f.target + (f.left != null ? ' (' + f.left + ' left)' : ''),
  'blacklist-retreat': () => 'Hunt target blacklisted',
  'backup-travel': f => 'Backup farming: ' + (f.ready ?? 0) + '/' + (f.all ?? 0) + ' ready',
  'backup-farming': f => 'Backup farming: ' + (f.ready ?? 0) + '/' + (f.all ?? 0) + ' ready',
  'batch-loot': () => 'Collecting loot',
} satisfies Record<string, Label>;
/** A stage of the Hunt cycle, one row of the stage table (record.ts `huntStep` moves the cycle between them). */
export type HuntStage = keyof typeof stageLabels;
// The holds and blockers a stage waits on, each one label; the stage's own label returns when the
// hold clears.
const holdLabels = {
  held: () => 'Hunt movement is paused; select Hunt again to resume',
  consoleLoad: () => 'Waiting for safe console load; finishing current combat',
  manualHold: () => 'Hunt movement paused by manual navigation',
  escape: () => 'Hunt movement is paused by Escape',
  waitingFresh: f => 'Waiting for fresh Hunt status from ' + f.name,
  backupStale: f => 'Backup Hunt waiting for fresh status from ' + f.name,
  protocol: () => 'Waiting for all party members to load the return-routing update',
  noLocation: () => 'Waiting for Daisy or monster spawn location data',
  noDaisy: () => 'Waiting for Daisy location data',
  noLeader: () => 'Waiting for an online party leader on the convoy realm',
  communication: f => f.text || 'Waiting for coordinator communication',
  defense: f => String(f.text),
  travelHeld: f => 'Hunt travel held: ' + f.text,
  returnGeometry: () => 'Returning to Daisy: repairing shared-route geometry; waiting for one runtime reload',
  returnFailed: f => 'Daisy return failed: ' + f.text + '; restarting it from where the party stands',
  batchPickup: f => 'Picking up Hunt batch: ' + f.ready + '/' + f.all + ' assigned',
  eventsFirst: () => 'Rewards checked; allowing pending events before the next hunt',
  retrying: f => 'Retrying ' + f.action + ' for ' + f.name + (f.text ? ': ' + f.text : ''),
  recovering: () => 'Recovering after a party death; continuing the current Hunt',
  blacklisted: f => 'Blacklisted ' + f.target + ' after a party death; waiting for respawn before selecting the next quest',
  regroupSpawns: f => f.target + ' spawns failed; regrouping and starting over from the first spawn',
  questsOver: f => 'Every ' + f.target + ' spawn failed again; starting the Hunt over from its quests',
  skipped: f => 'Skipping ' + f.target + ': no spawn could be reached',
  spawnRestored: () => 'Restored Hunt spawn after temporary route recovery',
  backupNoSpot: () => 'Backup Hunt waiting for configured farming location',
  lootPending: f => 'Pending Hunt loot: ' + (f.text || 'collecting final kill drops'),
  lootCollector: () => 'Waiting for the Hunt loot collector',
  // The mission walk stops at the spawn until movement hands it to farming
  // (runtime/coordinator/navigation/hunt-arrival.ts:85).
  spawnReached: () => 'Hunt spawn reached; stopping travel for farming',
} satisfies Record<string, Label>;
/** A hold or blocker the Hunt's status line names in place of its stage. */
export type HuntHold = keyof typeof holdLabels;

/**
 * The Hunt's label for a stage (the stage table's label column) or a hold; record.ts `labelHunt` writes it. Each
 * key is a row of one of the two tables, so a key with no row fails tsc.
 */
export function huntLabel(key: HuntHold | HuntStage, facts: HuntLabelFacts = {}): string {
  return (key in holdLabels ? holdLabels[key as HuntHold] : stageLabels[key as HuntStage])(facts);
}

// ---- The loot barrier ----

// The Hunt mission's loot pass identity: the cycle, its mission list's revision, the mission and its
// target and owners. The coordinator's barrier and the character's loot client compare the same id.
export function huntLootId(hunt: { cycleId?: unknown; missionRevision?: number; currentIndex?: number;
  missions?: readonly { target?: unknown; owners?: unknown }[] }): string {
  const mission = hunt.missions?.[hunt.currentIndex ?? -1];
  return JSON.stringify([hunt.cycleId, hunt.missionRevision || 0, hunt.currentIndex, mission?.target, mission?.owners]);
}

// ---- The death count's event test ----

// A death on an event trip counts nothing on the Hunt: one inside a trip the console recorded for
// the member, inside the trip the death report names, or, with a report that names no trip, while
// the member stood in an event. Survival's party death recovery asks the same test, since an
// event's death starts no party recovery (rule 8).
export interface DeathStatus { joinedEvent?: unknown; lastDeath?: { eventTrip?: { event?: unknown; startedAt?: unknown } | null } | null }
export interface EventTripSpan { event?: unknown; startedAt: number; endedAt?: number | null }
export function eventDeath(s: DeathStatus, trips: readonly EventTripSpan[], at: number, reported: boolean): boolean {
  const within = (trip: EventTripSpan | undefined) => !!trip && at >= trip.startedAt && (trip.endedAt == null || at <= trip.endedAt);
  if (trips.some(within)) return true;
  if (!reported) return !!s.joinedEvent;
  // A named trip whose start is no number spans nothing, so the death falls outside it.
  const named = s.lastDeath?.eventTrip, startedAt = named?.startedAt;
  if (named) return typeof startedAt === 'number' &&
    within(trips.find(t => t.startedAt === startedAt && t.event === named.event) ?? { event: named.event, startedAt });
  return !('eventTrip' in (s.lastDeath || {})) && !!s.joinedEvent;
}

// ---- How a rare encounter ends ----

// The end codes the encounter sets where it ends. A selection released by targeting's queue and a
// pursuit without progress (lost sight included) reject the rare until new evidence; every other end
// lets the rare be asked again after its cooldown. `yielded`: the selection was released while
// targeting's queue retired the rare for the party's travel after the encounter started; travel is
// no evidence the rare cannot be reached. `cancelled`: the player's navigation, a patrol change or a
// higher rare ended the encounter.
export type RareEnd = 'killed' | 'died' | 'disabled' | 'claimed' | 'released' | 'yielded' | 'no-progress' | 'interrupted' | 'cancelled';
export function rareEndRejects(code: RareEnd): boolean {
  return code === 'released' || code === 'no-progress';
}
// An end that read the rare (its target, HP, reach or the party's engagement) holds it until a
// sighting shows one of them changed. A yielded, interrupted or cancelled end read only the party's
// travel or hold, so the rare's next sighting after the end lets it go.
export function rareEndReadsRare(code: RareEnd): boolean {
  return code !== 'yielded' && code !== 'interrupted' && code !== 'cancelled';
}
// Each end's status line; the kill names the rare.
const rareEndLabels: Record<RareEnd, (name: string) => string> = {
  killed: name => name + ' defeated; loot checked',
  died: () => 'Rare died without confirmed party engagement',
  disabled: () => 'Passive hunt disabled',
  claimed: () => 'Rare pursuit ended: claimed outside party or no fresh sightings',
  released: () => 'Rare pursuit cancelled: selection released',
  yielded: () => 'Rare pursuit yielded to travel',
  'no-progress': () => 'Rare pursuit ended: no progress',
  interrupted: () => 'Rare encounter interrupted by protected activity',
  cancelled: () => 'Rare pursuit cancelled',
};
export function rareEndLabel(code: RareEnd, name: string): string {
  return rareEndLabels[code](name);
}

// ---- The rare encounter's and the Cave visit's status lines ----

// One label per encounter state, sent as the rare task's label: the pursuit and the fight name
// the rare (the Fairy with its field generator's state), then the loot.
export type RareLabelState = 'approach' | 'combat' | 'finishing' | 'loot';
export function rareLabel(state: RareLabelState, name: string, generator?: string): string {
  if (state === 'finishing') return 'Finishing party combat before rare loot';
  if (state === 'loot') return 'Collecting ' + name + ' drops';
  return (state === 'combat' ? 'Fighting ' : 'Pursuing ') + name + (generator ? ' · ' + generator : '');
}
// One label per Cave phase, sent as the Cave task's label.
// The game's map name of a Cave floor: the run and the floor number (zone_<run>_<floor>).
export const caveFloorMap = (run: unknown, floor: unknown): string => `zone_${run}_${floor}`;
// B.4's vote settlement, which the character's journal and the coordinator's actions both ask. The
// game records a vote only while its choice is open, so a vote that lands after the other votes
// resolved the choice, or after the choice was replaced or ended, never shows in `votes` (Sadokunn's
// vote on 2026-10-20, fork). A vote settles once this member's option is recorded, the choice
// resolved, or the choice with its id is gone.
export function voteSettled(choice: Pick<CaveChoice, 'id' | 'resolved' | 'votes'> | null | undefined,
  command: Pick<CaveCommand, 'choice' | 'option'>, name: string): boolean {
  return !choice || choice.id !== command.choice || choice.resolved || choice.votes[name] === command.option;
}
// Auto exploration: the points it may walk to next are the stairs down once unlocked and the
// required rooms of this floor not done. A locked stairs point that a room row also lists stays a room.
export function caveDestinations(cave: { run: string; floor: number; points: readonly CavePoint[] }): CavePoint[] {
  const down = cave.points.find(p => p.down && !p.exit);
  const rooms = cave.points.filter(p => p.required && !p.done && !p.exit && p.map === caveFloorMap(cave.run, cave.floor));
  return down && !down.locked ? [down, ...rooms.filter(p => p !== down)] : rooms;
}
// The next point among the offered ones: the add-on's pick (`cave.destination`) when it names one,
// else the unlocked stairs, else the room under way, else the room nearest the leader.
export function caveNextPoint(offered: readonly CavePoint[], previous: string | undefined, leader: { x?: number; y?: number } | undefined,
  pick: string | undefined): CavePoint | undefined {
  const picked = offered.find(p => p.id === pick) ?? offered.find(p => p.down && !p.locked) ?? offered.find(p => p.id === previous);
  if (picked) return picked;
  const gap = (p: CavePoint) => Math.hypot(p.x - (leader?.x || 0), p.y - (leader?.y || 0));
  return [...offered].sort((a, b) => gap(a) - gap(b))[0];
}
export function caveLabel(phase: string): string {
  return phase === 'held' ? 'Cave run finished: waiting for Release' : 'Cave of Many Dreams: ' + phase;
}

// The card line's words for the hunting owner's tasks, moved unchanged from
// runtime/coordinator/status/activity.ts. A line with `walk` is a walk's line, which movement's walk
// words finish (`walkLabel`).
export type HuntCardLine = { phase: string; label: string } | { walk: { purpose: string; travelling: string } };
export function huntLine(stage: string | undefined, target: string | undefined, focus: string | undefined): HuntCardLine {
  const line = (label: string) => ({ phase: stage ?? 'idle', label });
  const walk = (purpose: string, travelling: string) => ({ walk: { purpose, travelling } });
  switch (stage) {
    case 'checking-quests': case 'assigning': return line('Acquiring new hunt target');
    case 'daisy-sync-travel': return walk('to Daisy for new hunt', 'Travelling to Daisy for new hunt');
    case 'at-daisy': return line('At Daisy - picking up hunts');
    case 'mission-travel': return walk(`to Hunt target - ${target}`, `Travelling to Hunt target - ${target}`);
    case 'farming': return line(`Fighting ${target}`);
    case 'returning': return walk('Hunt finished, to turn in', 'Hunt finished - Travelling to turn in');
    case 'batch-loot': return line('Hunt finished - collecting loot');
    case 'waiting-expiry': return line('Waiting for the Hunt to expire');
    case 'backup-travel': return walk(`to farm - ${focus ?? 'backup farm'}`, `Travelling to farm - ${focus ?? 'backup farm'} while Hunts expire`);
    case 'backup-farming': return line(`Fighting ${focus ?? 'monsters'} while Hunts expire`);
    case 'blacklist-retreat': return line('Leaving a blacklisted Hunt');
    default: return line(target ? `Fighting ${target}` : 'Acquiring new hunt target');
  }
}
// The purposes of the rare's walk and the Phoenix patrol's (coordinator/rares.ts starts both), and
// which of the two a walk's purpose names, null for any other walk.
export const RARE_WALK = 'rare-hunt';
export const PATROL_WALK = 'phoenix-patrol';
export const rareWalkKind = (purpose: string | null | undefined): 'rare' | 'patrol' | null =>
  purpose === RARE_WALK ? 'rare' : purpose === PATROL_WALK ? 'patrol' : null;
// A rare walk or patrol: the patrol names its search, a rare walk its monster. With no monster name
// the line reads "Phoenix" on a patrol and "rare monster" on a rare walk.
export function rareWalkLine(patrol: boolean, rare: string | null | undefined, label: string | undefined): { purpose: string; travelling: string } {
  const name = rare ?? (patrol ? 'Phoenix' : 'rare monster');
  return { purpose: `to rare - ${name}`, travelling: patrol ? `Searching for Phoenix - ${label}` : `Travelling to rare - ${name}` };
}
export const RARE_TRAVEL_LABEL = 'Travelling to rare monster';
//: the group's mode names the target mode and the combat mode, as "Hunt (Scatter)", on the
// card's mode summary; its task's line adds the label, as "Hunt (Scatter): Fighting Goo".
export const modePair = (target: string, combat: string): string => `${target} (${combat})`;
export const modeLine = (target: string, combat: string, label: string): string => `${modePair(target, combat)}: ${label}`;
// The two slot fields: the defaults saved-fields.ts declares, and a character's or a scope's
// resolved pair. A field comes from its own farming profile, else from the party fields the
// leader's scope keeps at the top level, else from the default.
export const DEFAULT_COMBAT_MODE = 'auto';
export const DEFAULT_TARGET_MODE = 'farming';
export interface SlotFields { combatMode?: string; targetMode?: string }
export function slotPair(own: SlotFields | undefined, party: SlotFields | undefined): Required<SlotFields> {
  return { combatMode: own?.combatMode || party?.combatMode || DEFAULT_COMBAT_MODE,
    targetMode: own?.targetMode || party?.targetMode || DEFAULT_TARGET_MODE };
}
export const farmWalkLine = (farm: string | undefined) => ({ purpose: `to farm - ${farm ?? 'saved spot'}`, travelling: `Travelling to farm - ${farm ?? 'saved spot'}` });
export function farmLine(idle: boolean, farm: string | undefined): { phase: string; label: string } {
  if (idle && !farm) return { phase: 'idle', label: 'Idle - no farm set' };
  return { phase: 'fighting', label: farm ? `Fighting ${farm}` : 'Fighting nearby monsters' };
}
export const caveTravelLabel = (trying: string): string => `Cave travel - ${trying}`;

// A member's daily Cave answer counts until the game's daily reset it names; an answer read before
// that reset is stale once the reset passes. The Cave start's entry check (coordinator/cave.ts) and
// the dashboard's Cave row read this one rule.
export function caveVisitCurrent(visit: { checkedAt: number; resets: number }, now: number): boolean {
  return !(visit.checkedAt < visit.resets && now >= visit.resets);
}

// The user's rejoin (2026-11-16): the game lets a member that disconnected from a run enter it again
// while the run's clock runs (game node/logic/generated_maps.js:20-25 `generated_return_run`). The
// member's own game answer names the run it may return to (`visit.resume`, generated_maps.js:672-678),
// and a member still inside reports the clock: stopped while a vote pauses the run (generated_maps.js:13
// `generated_clock`), else short of the run's `expires`, which the run closes at (generated_maps.js:435).
export function caveRejoinOpen(resume: { run?: string } | undefined, inside: ({ run: string; paused: boolean; expires: number } | null | undefined)[],
  run: string | undefined, now: number): boolean {
  return !!run && resume?.run === run && inside.some(cave => !!cave && cave.run === run && (cave.paused || now < cave.expires));
}
// A member the game reports offline leaves the visit, whatever its last report's age; the others go
// on. When every member is offline the roster stays whole, and the hold ends the visit. The
// lifecycle owner answers `offline`: a member whose worker is starting or repairing stays, and a
// member handed from its headless worker to the Steam client counts by its own reports, not by the
// worker record the handoff left offline.
export function caveDropped(participants: readonly string[], offline: (name: string) => boolean): string[] {
  const gone = participants.filter(offline);
  return gone.length === participants.length ? [] : gone;
}

// ---- The passive rare rules and the Hunt settings (saved-fields.ts declares them) ----

// A rare's rule: whether the group hunts it, whether a walk keeps moving past it, its priority
// (0 to 1,000), its level cap (-1 for none) and its "May interrupt Hunt" switch, which
// counts as on while unset.
export interface PassiveRule { enabled: boolean; keepMoving: boolean; priority: number; maxLevel?: number; interruptsHunt?: boolean }
export interface PassiveSettings { version: 1; rules: Record<string, PassiveRule>; useFieldGenerators: boolean }
// The rares of the first passive switches, with their priorities: the Fairy outranks the rest.
export const legacyPriorities: Record<string, number> = { tinyp: 101, phoenix: 100, goldenbat: 100, cutebee: 100, hen: 100, rooster: 100 };
export function defaultPassiveRule(id: string): PassiveRule {
  return { enabled: false, keepMoving: false, priority: legacyPriorities[id] ?? 100, maxLevel: -1 };
}
// A rule saved before the cap existed has none. A finite cap refuses a rare of unknown level.
export function passiveLevelAllowed(rule: PassiveRule | undefined, level: number | undefined): boolean {
  const cap = rule?.maxLevel ?? -1;
  return cap === -1 || Number.isFinite(level) && Number(level) <= cap;
}
// A save of the old switches gets one rule per switch, field generators on; a saved version 1 loads as it is.
export function migratePassiveSettings(saved?: PassiveSettings | null, legacy: Record<string, boolean> = {}): PassiveSettings {
  if (saved?.version === 1) return saved;
  const rules = Object.fromEntries(Object.entries(legacy).map(([id, enabled]) => [id, { ...defaultPassiveRule(id), enabled }]));
  return { version: 1, useFieldGenerators: true, rules };
}
// A passive rule's ranges, which the rule check reads and the dashboard's passive menu draws: a
// whole priority in the range, and a max level that is a positive whole number or NO_LEVEL_CAP.
export const PASSIVE_PRIORITY_RANGE = { min: 0, max: 1000 } as const;
export const NO_LEVEL_CAP = -1;
// The switches the rules commit, saved as passiveRareHunts: a rare the group stops for.
export function committedPassiveRules(settings: PassiveSettings): Record<string, boolean> {
  return Object.fromEntries(Object.entries(settings.rules).map(([id, rule]) => [id, rule.enabled && !rule.keepMoving]));
}

// A character's monster search radius range. The focus route refuses a request outside it, the
// declaration applies the same rule to a stored or imported value, and the dashboard's
// radius control draws it.
export const SEARCH_RADIUS_RANGE = { min: 1, max: 10000 } as const;

export interface HuntSettings {
  preferredSpawns?: Record<string, string>;
  // The relocation switch here means the root setting `relocateIfCompeting`. The load reads a
  // save's copy into the root (coordinator/record.ts), and the Hunt settings route writes a patch's
  // copy to it, so a saved or imported value from before the root setting existed passes the check.
  relocateIfCompeting?: boolean;
  blacklistDeaths: boolean;
  deathThreshold: number;
  blacklistExpirations: boolean;
  expirationThreshold: number;
}
export const defaultHuntSettings: HuntSettings = {
  blacklistDeaths: true,
  deathThreshold: 1,
  blacklistExpirations: true,
  expirationThreshold: 1,
};
// A preferred spawn per monster: a monster id of 1 to 100 characters naming a spawn key
// (areas.ts `huntSpawnKey`) of at most 200.
function validSpawnPreferences(value: unknown): value is Record<string, string> {
  return object(value) && Object.entries(value).every(([monster, key]) =>
    monster.length > 0 && monster.length <= 100 && typeof key === 'string' && key.length <= 200);
}
// The Hunt settings route writes a patch of these keys, and the declaration checks the saved
// object with the same rule, so a patch and a stored value pass or fail alike.
export function validHuntSettings(value: unknown): value is Partial<HuntSettings> {
  if (!object(value)) return false;
  return Object.entries(value).every(([key, item]) => {
    if (key === 'preferredSpawns') return validSpawnPreferences(item);
    if (['relocateIfCompeting', 'blacklistDeaths', 'blacklistExpirations'].includes(key))
      return typeof item === 'boolean';
    return ['deathThreshold', 'expirationThreshold'].includes(key) && Number.isSafeInteger(item) && Number(item) >= 1;
  });
}
