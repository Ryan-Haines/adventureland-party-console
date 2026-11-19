// The one hook registry. It copies the state field registry's pattern (runtime/status/rules.ts
// table F): one table declares every hook, and a registration may answer only a declared hook.
// Core features register the same way as add-ons; only their folder differs. The checks run at
// load, so a conflict never reaches play.
import { ADDON_SPEND_CAP, ADDON_TIERS, SPEND_RANKS, TIERS, type SpendRank, type Tier } from '../protocol/ranks.ts';
import type { Entity } from 'typed-adventureland';
import type { ItemMark } from '../coordinator/contracts/item.ts';
import { createAddonStores, createStoreBook, type AddonStoreHandle, type ScopeHolder } from './store.ts';
import { createActionQueue, type QueuedAction } from './actions/queue.ts';
import { runAction } from './actions/dispatch.ts';
import type { MovementIncident, MovementRecord, MovementRequest, StepOptions, StepResult, WalkView } from '../protocol/records.ts';
import type { Reading, WalkReading } from '../protocol/reports.ts';
import type { Rung } from '../protocol/ladder.ts';
import type { confirmIndependentApproach, independentApproach, independentReadiness } from '../movement/api/character.ts';
import type { formationRecovery, GameMonster, heartbeatMovement } from '../movement/api/coordinator.ts';
// The settings owner's declaration types, write types and its rule for an add-on's
// settings.
import type { LifecycleState, ReadyAnswer, ReadyAsk } from '../lifecycle/api.ts';
import { addonSettingProblem, addonValues, type DeclaredSetting, type SavedRecord, type Setting, type SettingsRead, type SettingsWrite, type SettingsWriteResult } from '../settings/api.ts';
// An add-on's K1 row.
import type { EventKindAnswer } from '../events/api.ts';
import type { TargetAnswer } from '../characters/targeting/api.ts';
import type { CaveDestinationAsk, CaveRejoinAsk, CaveState, FarmingFocus, FarmSpotAnswer, FarmSpotAsk, HuntQuestAsk, HuntView, PassiveRuleView } from '../hunting/api.ts';

import * as tasks from './rows/01-tasks.ts';
import * as movement from './rows/02-movement.ts';
import * as turns from './rows/03-turns.ts';
import * as targeting from './rows/04-targeting.ts';
import * as survival from './rows/05-survival.ts';
import * as events from './rows/06-events.ts';
import * as hunting from './rows/07-hunting.ts';
import * as merchant from './rows/08-merchant.ts';
import * as calls from './rows/09-calls.ts';
import * as items from './rows/10-items.ts';
import * as settingsRows from './rows/11-settings.ts';
import * as status from './rows/12-status.ts';
import * as lifecycle from './rows/13-lifecycle.ts';
import * as addonRows from './rows/14-addons.ts';

// Two kinds of hook, no more (00-overview): a request goes into the owner's own decision, a
// notice tells what happened and changes nothing. `answers: 'one'` marks a question one
// registration answers, so a second answer is a load conflict.
// Movement's rows carry `fixture`, the row of the one movement hooks table that checks them, and on a
// request `addonMayAsk`, true only for an answer that reads state and changes nothing.
// Each owner's rows live in its own file, rows/<NN>-<area>.ts, which only that owner's build writes
//. A name is one hook, event or slot across every file and
// both kinds, so a repeated name fails the load, naming both files.
// `side` names where a row runs: on the character, on the coordinator or
// on both. A read asked on the other side fails naming the side. Each owner's row file sets it on
// its own rows, and it stays optional until every row carries one.
export type HookSide = 'character' | 'coordinator' | 'both';
export interface HookRow { kind: 'request' | 'notice'; part: string; answers: 'one' | 'many' | 'slot'; pending?: string; core?: true;
  receives: string; returns: string; fixture?: string; addonMayAsk?: boolean; bound?: string; side?: HookSide }
// A dashboard place an add-on in the owner's area shows in (0.4 part 4): its data shape, whether it
// takes the add-on's own section component, and on a general slot its bound, what a piece there may
// and may not change.
export interface SlotRow { owner: string; data: string; section: boolean; fixture: string; bound?: string }
export const ROW_FILES = {
  'rows/01-tasks.ts': tasks, 'rows/02-movement.ts': movement, 'rows/03-turns.ts': turns, 'rows/04-targeting.ts': targeting,
  'rows/05-survival.ts': survival, 'rows/06-events.ts': events, 'rows/07-hunting.ts': hunting, 'rows/08-merchant.ts': merchant,
  'rows/09-calls.ts': calls, 'rows/10-items.ts': items, 'rows/11-settings.ts': settingsRows, 'rows/12-status.ts': status,
  'rows/13-lifecycle.ts': lifecycle, 'rows/14-addons.ts': addonRows,
};
export function repeatedNames(files: Readonly<Record<string, { HOOKS: object; SLOTS: object }>>): string[] {
  const seen = new Map<string, string>(), repeats: string[] = [];
  for (const [file, rows] of Object.entries(files)) for (const [kind, table] of [['hook', rows.HOOKS], ['slot', rows.SLOTS]] as const) {
    for (const name of Object.keys(table)) {
      const at = `${file} (${kind})`, first = seen.get(name);
      if (first) repeats.push(`${name} is declared twice: in ${first} and in ${at}`);
      else seen.set(name, at);
    }
  }
  return repeats;
}
const repeats = repeatedNames(ROW_FILES);
if (repeats.length) throw Error(`The hook table has repeated names: ${repeats.join('; ')}`);
export const HOOKS = { ...tasks.HOOKS, ...movement.HOOKS, ...turns.HOOKS, ...targeting.HOOKS, ...survival.HOOKS, ...events.HOOKS,
  ...hunting.HOOKS, ...merchant.HOOKS, ...calls.HOOKS, ...items.HOOKS, ...settingsRows.HOOKS, ...status.HOOKS, ...lifecycle.HOOKS, ...addonRows.HOOKS };
export const SLOTS = { ...tasks.SLOTS, ...movement.SLOTS, ...turns.SLOTS, ...targeting.SLOTS, ...survival.SLOTS, ...events.SLOTS,
  ...hunting.SLOTS, ...merchant.SLOTS, ...calls.SLOTS, ...items.SLOTS, ...settingsRows.SLOTS, ...status.SLOTS, ...lifecycle.SLOTS, ...addonRows.SLOTS };
type HookName = keyof typeof HOOKS;
// C1 and C3: every owner's `ACTIONS` and `READS` rows by name, from the same row files.
const tableOf = (key: 'ACTIONS' | 'READS'): Record<string, unknown> =>
  Object.assign({}, ...Object.values(ROW_FILES).map(m => (m as Partial<Record<'ACTIONS' | 'READS', object>>)[key] ?? {}));
export const ACTIONS = tableOf('ACTIONS') as Readonly<Record<string, ActionRow>>;
export const READS = tableOf('READS') as Readonly<Record<string, ReadRow>>;
// The owner of each action, from the row file that holds it: rows/10-items.ts is 10's.
export const ACTION_OWNERS: Readonly<Record<string, string>> = Object.fromEntries(Object.entries(ROW_FILES).flatMap(([file, m]) =>
  Object.keys((m as Partial<Record<'ACTIONS', object>>).ACTIONS ?? {}).map(action => [action, file.slice('rows/'.length, 'rows/'.length + 2)])));
// The rows an add-on may ask (0.4 part 3): a read that changes nothing, marked `addonMayAsk: true`.
export type AskableHook = { [K in HookName]: (typeof HOOKS)[K] extends { addonMayAsk: true } ? K : never }[HookName];

// The add-on capability contracts (addon-capabilities.md C1 to C4). Each owner's row file adds an
// `ACTIONS` and a `READS` table beside `HOOKS`; the names below read them from `ROW_FILES`, so a row
// file that exports neither adds no name.
type RowModule = (typeof ROW_FILES)[keyof typeof ROW_FILES];
// The five closing codes (hook-coverage-2.md:12-18).
export type CloseCode = 'CL' | 'SV' | 'KY' | 'AS' | 'FW';
// C1: one game action. An offered row names the owner's door, its args and its bound; a closed row
// names its code and the cite. `events` and `functions` are the game calls the row covers.
export type ActionRow = { events: readonly string[]; functions: readonly string[] } &
  ({ door: string; args: string; bound: string } | { closed: CloseCode; cite: string });
// Only an offered row is a name, so an add-on that asks a closed or missing action fails the typecheck.
type OfferedActions<M> = M extends { ACTIONS: infer A } ? { [K in keyof A]: A[K] extends { door: string } ? K : never }[keyof A] : never;
export type ActionName = Extract<OfferedActions<RowModule>, string>;
export interface ActionAsk { action: ActionName; args: Readonly<Record<string, unknown>>; reason: string }
// `act` returns the ticket at once and makes no call; the outcome names the ticket's id.
export interface ActionTicket { id: string }
export type ActionOutcome = { id: string; action: ActionName; character: string; addon: string } &
  ({ outcome: 'sent'; reply?: unknown } | { outcome: 'refused'; by: string; reason: string } | { outcome: 'failed'; error: string });
// A coordinator-side ask names its character; a character-side ask acts for its own character.
export type Act = (ask: ActionAsk & { character?: string }) => ActionTicket;
// C3: one published read of an owner's door. `type` names the published type, and `door` the door
// export it calls, as `<file>#<export>`.
export interface ReadRow { side: HookSide; type: string; door: `${string}#${string}` }
type ReadRowName<M> = M extends { READS: infer R } ? keyof R : never;
export type ReadName = AskableHook | Extract<ReadRowName<RowModule>, string>;
type Asked<H extends AskableHook> = NonNullable<DispatchHooks[H]> extends (...args: infer A) => infer R ? [A, R] : [never, never];
// A hook row's ask keeps its signature. A `READS` row takes and returns `unknown` until its owner
// types it.
export type ReadArgs<N extends ReadName> = N extends AskableHook ? Asked<N>[0] : readonly unknown[];
export type ReadAnswer<N extends ReadName> = N extends AskableHook ? Asked<N>[1] : unknown;
export type Read = <N extends ReadName>(name: N, ...args: ReadArgs<N>) => ReadAnswer<N>;
// C4: the three stores an add-on sees for the character a call is for: the character's own, its
// farming scope's and the party's. The registry hands each add-on only its own handles.
export interface AddonStores { character: AddonStoreHandle; scope: AddonStoreHandle; party: AddonStoreHandle }
// C3: the third argument of every add-on answer. `scope` is the farming scope's owner the character
// plays in, and `settings` holds the add-on's values for that scope (addonValues). Notices get no
// `act`, because a notice stays read-only.
export interface AddonContext {
  side: 'character' | 'coordinator';
  character?: string;
  scope: string;
  settings: Readonly<Record<string, unknown>>;
  store: AddonStores;
  read: Read;
  act: Act;
  outcome(id: string): ActionOutcome | undefined;
}
// C2: one step of an add-on merchant job: an offered action, or a walk 02 runs at the job's tier.
export type MerchantStep = ActionAsk | { walk: { to: { map: string; x: number; y: number } | 'town' } };
// What `merchant.step` receives between steps: the job and the outcomes of the steps it ran.
export interface MerchantStepView { job: { id: string; kind: string; target: string; fields?: Readonly<Record<string, unknown>> }; done: readonly ActionOutcome[] }
// Nothing answering ends the job as `done`.
export type MerchantStepAnswer = { steps: readonly MerchantStep[] } | { end: 'done' | 'failed'; reason?: string } | undefined;
const pendingOwner = (hook: HookName): string | undefined => (HOOKS[hook] as { pending?: string }).pending;
// `core` marks a hook only the console's own code answers.
const coreOnly = (hook: HookName): boolean => (HOOKS[hook] as { core?: true }).core === true;
// One `calls.band` question.
export type CallBand = 'survival' | 'job' | 'background';
export interface CallQuestion { band: CallBand; method: string; data?: unknown }
export type CallAnswer = 'send' | 'not-now';
// P5 `retry.policy`: a failure an owner retries, its attempt and core's own answer, and what an
// add-on may change of it (runtime/hooks/rows/09-calls.ts).
export interface RetryAsk { owner: string; subject: string; failure: string; attempt: number; core: RetryPolicy }
export interface RetryPolicy { wait: number; giveUp: boolean; counts: boolean }
export type RetryAnswer = Partial<RetryPolicy>;
// The payload of the call budget's six notices. Each names the
// character and `by: 'core:calls'`, and the fields its `HOOKS` row lists.
export interface CallNotice { character: string; by: 'core:calls'; method: string; band?: string; cost?: number; used?: number; margin?: number;
  sentMargin?: number; waitedMs?: number; source?: 'untagged'; total?: number; limit?: number }
// `survival.verdict`'s four questions and answers and `survival.respawn`'s
// answer (3.5). Each question names its own key, so one answer tells them apart.
export type SurvivalQuestion = { group: string } | { walk: true; members: readonly string[]; attackers: readonly unknown[] } |
  { hold: true; tank: string; attackers: readonly unknown[]; supply: unknown } | { character: string };
// `revive` answers a character while the Cave revival holds it.
export type SurvivalVerdict = 'fight' | 'finish' | 'leave' | 'hold' | 'step' | 'revive';
export type RespawnAnswer = { answer: 'sent' } | { answer: 'not-now' } | { answer: 'refused'; reason: string };
// `survival.escaping`'s answer: the escape that owns a character,
// its stage, and the one command purpose it lets through (`escape-recovery` in `recovery-convoy`).
// `label` is the card line's words for the stage, and `climbs` marks the stage whose line 02's
// climber replaces while it serves the regroup (the status owner's table L1).
export interface EscapeHold { id: string; stage: string; admits: string | null; label: string; climbs: boolean }
// What the grouped fight keeps while a party death recovery runs (05 W2.2 `fightRule`): the
// candidates empty and retention paused while it runs; the evidence, threats and state outside
// `finishing` and `returning-to-farm`; the queue, fights, target and selection then too; and the
// fight's committed target in `finishing`. The targeting owner's grouped snapshot applies it.
export interface RecoveryFightRule { running: boolean; keepsObservations: boolean; keepsCommitted: boolean }
// `survival.recovery`'s answer (CF-S7): the recovery's last computed record. `targets` is the
// finishing list the targeting owner's A11 reads.
export interface RecoveryView { id: string; phase: string; reason: string; names: readonly string[]; targets: readonly unknown[];
  fight: RecoveryFightRule; record: unknown }
// `targeting.fight`'s answer: the group's grouped fight as the
// queue holds it, its target's start, its fights and its death tombstones with their monster type.
// `targeting.groupView`'s answer: the queue ledger's facts.
export interface GroupView { selected: string | null; queued: unknown[]; locked: unknown; engaged: unknown[]; killed: unknown[]; claimed: unknown[];
  revision: string | undefined; acknowledgements: string[]; lost: { retiredAt: number; reason: string }[]; seenAt: number }
export interface GroupFightView { startedAt?: number; fights: readonly { id: string; map: string; in?: string | number; server?: string; mtype?: string; hp?: number }[];
  deaths: readonly { id: string; map: string; in?: string | number; server?: string; at: number; mtype?: string }[] }
// `survival.refuses`'s question: the recovery's or a walk's verdict with what it read.
// A refusal with the registration that gave it, so a reader names the refuser without parsing text.
export interface Refusal { by: string; reason: string }
export interface SurvivalRefusalAsk { question: 'recovery' | 'walk'; group?: string; survivors: readonly unknown[]; foes: readonly unknown[]; verdict: SurvivalVerdict }
// The targeting owner's notices beyond `targeting.changed` and `targeting.unreachable`.
export type TargetingNotice = 'targeting.refused' | 'targeting.skipped' | 'targeting.retired' | 'targeting.cleared' | 'targeting.nominated' |
  'targeting.fightState' | 'targeting.granted' | 'targeting.revoked' | 'targeting.passed';
// The view `targeting.candidates` and `targeting.prefers` ask with: the candidates, the
// character, the entities in view and the party.
export interface CandidatesView<T = unknown> { candidates: readonly T[]; character: unknown; entities: Readonly<Record<string, unknown>>; party: readonly string[];
  nomination?: unknown; event?: string | null }
// The survival owner's notices.
export type SurvivalNotice = 'survival.died' | 'survival.escaped' | 'survival.recoveryStarted' | 'survival.recoveryPhase' | 'survival.recovered' |
  'survival.escapeStarted' | 'survival.escapeStage' | 'survival.escapeEnded' | 'survival.escapeMember' | 'survival.judged' |
  'survival.respawning' | 'survival.memberRecovery' | 'survival.reviving';
// The codes `walks.end` ends a group walk with. The escape and the death
// recovery end theirs with their own kind, and the task owner's takeover adds its own:
// `membership`, for a member that leaves the walk's group (01 RF1 cut 9), and `replaced:<kind>`, for
// a walk that ranks below the task that now holds its group.
export type WalkEndCode = 'realm-switch' | 'membership' | 'escape' | 'death-recovery' | `replaced:${string}`;
// The group walk's notices.
export type WalkNotice = 'walk.formed' | 'walk.phase' | 'walk.member' | 'walk.ended';
// The movement owner's other notices.
type MovementNotice = 'journey.resumed' | 'request.waiting' | 'request.refused' | 'ladder.climbed' | 'hold.started' | 'hold.ended' |
  'click.taken' | 'records.saved' | 'crossing.started' | 'crossing.ended' | 'step.sent' | 'formation.moved';
// `walks.request`'s ask: `kind` is the walk's purpose, which names its
// asker's task, and `tier` the rank it asks at.
// `by` names the app (`app:<name>`) behind an `app` tier walk.
export interface WalkAsk { kind: string; destination: { map: string; x: number; y: number; in?: string | number }; members?: string[]; tier: Tier; label?: string; by?: string }
// `movement.live`'s answer (design 1.3 `live()`).
export interface MovementLive { kind: string; owner?: string; tier?: string; journey: boolean; paused: boolean; stepAt?: number; stepMs?: number; deadline?: number; label?: string }
// What the crossing, step and formation hooks see.
export interface CrossingAsk { character: string; crossing: string; kind: string; owner: string }
export interface RouteAvoidAsk { from: { map: string; x: number; y: number }; to: { map: string; x: number; y: number } }
export interface StepPointAsk { character: string; mover: string; to: { x: number; y: number }; target?: string }
// What `formation.routine` sees: the character, its class, the formation's target, its healer, the
// desired range, the members' positions, the solver's candidate points with their scores, and
// whether the party fights grouped or scattered.
// What `walk.flags` sees: a group walk, core or add-on, with the flags core gave it.
export interface WalkFlagsView { group: string | null; walk: { purpose: string | null; phase: string; flags: { departure: string; defencePauses: boolean; handsCombat: boolean } } }
export interface WalkFlagsAnswer { depart?: 'hold' | 'go'; defence?: 'pause' | 'walk-on'; handsCombat?: boolean }
export interface FormationCandidate { x: number; y: number; danger: number; coverage: number; rangeError: number; clearance?: number }
export interface FormationAsk { character: string; ctype: string; target: string | undefined; healer: string | undefined; desiredRange: number;
  members: { name: string; ctype: string; x: number; y: number }[]; candidates: FormationCandidate[]; mode: 'grouped' | 'scatter' }
export type FormationAnswer = { x: number; y: number } | { hold: true } | undefined;
// What `walk.request` sees and answers: the group, its live add-on task and that task's walk.
export interface AddonWalkView { group: string | null; task: { kind: string; tier: Tier; owner: string };
  walk: { id: string; phase: string; destination: unknown; members: string[] } | null }
export type AddonWalkAnswer = { destination: { map: string; x: number; y: number; in?: string | number }; label?: string; members?: string[]; handsCombat?: boolean } | 'end' | undefined;
// One owner's hold on a walk member. `coming` false lets the
// walk go on without the member. `endsOn` names the holder's notice that ends or changes the hold,
// or 'report' for a stand-in, whose hold the walk reads again on each of the member's reports.
// `targeting.passing`'s cause (Reopened R4 RR14): a monster whose passive rule says "stop", or a rare.
export type PassingCause = 'passive' | 'rare';
export interface MemberHold { owner: '01' | '02' | '05' | '06' | '08' | '13'; reason: string; coming: boolean; endsOn: string }
// `at` is the asking walk's clock, which a hold read from the member's reports judges their age by.
// A walk's start names its own `activity` and `key` (the event, or the event return's cycle), so a
// holder answers nothing for the walk that goes where the member already is (S-06h), and 01's
// wind-down reads an event walk's spawn and walk time from 06's `event.schedule` for the group and
// the key (S-01e closed).
export interface MemberHoldAsk { group: string | null; member: string; at: number; activity?: string; key?: string }
// An event walk that would take over the group's live walk, which the walk hands the group's the MP table
// `walk:event` answer.
export type WalkTakeover = Pick<MemberHoldAsk, 'at' | 'group' | 'key'>;
// One party member as its last report shows it: its class, HP, MP,
// place and each add-on's own report. A field the member's report does not carry stays unset; a
// character's party reply carries no add-on reports.
export interface MemberView { name: string; ctype?: string; hp?: number; max_hp?: number; mp?: number; max_mp?: number; rip?: boolean;
  map?: string; in?: string | number; x?: number; y?: number; addonReports?: Readonly<Record<string, unknown>> }
// What `targeting.aggroOwner` sees: the asking character and its party.
export interface AggroParty { character: string; leader: string; members: readonly MemberView[] }
// The published reads' shapes. A caller asks one with `ask`, in its own shape, and its one core
// answer replies.
export type Monster = Entity | null;
export interface QueueSelection { targetId: string | null; selection: unknown; leaderTarget: unknown; partyTargets: unknown;
  partyThreats: unknown; scatterBreakTarget: unknown; lastAttack: { target: unknown; at: number } }
export interface PublishedReads {
  'targeting.partyAttacker'(): Monster; 'targeting.partyTarget'(): Monster; 'targeting.engagedMonster'(): Monster;
  'targeting.focusedInRadius'(): Monster; 'targeting.dungeonTarget'(): Monster; 'targeting.eventTarget'(): Monster;
  'targeting.returnDefenseTarget'(): Monster; 'targeting.rareTarget'(): Monster; 'targeting.passingTarget'(): Monster;
  'targeting.defensiveTarget'(): Monster; 'targeting.activeTarget'(): Monster;
  'targeting.allowed'(target: Monster, travel?: boolean, diagnostic?: string): boolean;
  'targeting.claimed'(target: Monster): boolean; 'targeting.attacking'(target: Monster): boolean; 'targeting.priority'(target: Monster): number;
  'targeting.pullOnly'(target: Monster, skill: string): boolean;
  'targeting.lockAllows'(target: Monster): boolean; 'targeting.partyTargetIs'(target: Monster): boolean; 'targeting.returnAttacker'(target: Monster): boolean;
  'targeting.groupReady'(target: Monster): boolean; 'targeting.rareAllows'(target: Monster, skill: string): boolean;
  'targeting.committedEncounter'(target: Monster): boolean; 'targeting.passingEncounter'(target: Monster): boolean;
  'targeting.levelAllows'(target: Monster): boolean; 'targeting.passiveStop'(target: Monster): boolean;
  'targeting.departureEngaged'(target: Monster): boolean; 'targeting.dungeonAllows'(target: Monster): boolean;
  'targeting.frankyAllows'(target: Monster): boolean; 'targeting.drainAllows'(target: Monster): boolean;
  'targeting.graveyardAreaAllows'(range: number): boolean; 'targeting.passingKey'(target: Monster, realm?: string): string;
  'targeting.returnActive'(): boolean; 'targeting.unfinished'(): boolean; 'targeting.drainCombat'(): boolean;
  'targeting.departurePending'(): boolean; 'targeting.anchorVisible'(): boolean;
  'targeting.report'(): unknown; 'targeting.acknowledgement'(): unknown; 'targeting.entityReport'(entity: Monster): unknown; 'targeting.passingReport'(): unknown;
  'targeting.publishSelection'(target: Monster, clear?: boolean): void;
  'targeting.beginPassing'(target: Monster, admission: unknown, reserveOnly?: boolean): boolean;
  'targeting.acceptQueue'(next: unknown): void; 'targeting.acceptControl'(state: unknown): void; 'targeting.cancelReturnTown'(): void;
  'targeting.queue'(): unknown; 'targeting.selection'(): QueueSelection;
  'targeting.setTargetId'(id: string | null, by: string): void; 'targeting.noteAttack'(target: unknown, at: number, by: string): void;
  'targeting.receive'(fields: Record<string, unknown>): void;
  // The threat fact: `core:targeting`'s answer on a character.
  'targeting.threat'(view: unknown): unknown;
  'movement.followIfFar'(ask: { character: string }): Promise<boolean>;
  // The settings owner's declaration table.
  'settings.declared'(): readonly DeclaredSetting[];
  // Movement's core requests and reads, each its module function's own shape.
  'walks.request'(group: string, ask: WalkAsk): boolean;
  'movement.step'(to: { x: number; y: number }, mode: string, options?: StepOptions): StepResult;
  'movement.acceptMagiport'(request: MovementRequest, name: string): Promise<unknown>;
  'movement.live'(): MovementLive | null;
  'movement.park'(character: string): void;
  'reports.fresh'(at: unknown, now: number, reading?: Reading | WalkReading): boolean;
  'movement.climbing'(): unknown;
  // Generic in the reply's state, so a caller reaches it through `answerOf`, which keeps the type parameter.
  'movement.reply': typeof heartbeatMovement;
  'movement.records'(): readonly MovementRecord[];
  // The turns and targeting rings, which the status owner's diagnostics lease posts (E03-12, E04-12).
  'skills.records'(): readonly unknown[];
  'targeting.records'(): readonly unknown[];
  'movement.incidents'(): readonly MovementIncident[];
  'movement.gameMonsters'(): Readonly<Record<string, GameMonster | undefined>> | null;
  // The events owner's coordinator reads: K3's presence of a member and
  // K2's occurrence of a group's event (runtime/events/api.ts `EventPresence`, `EventSchedule`).
  'event.presence'(name: string): unknown;
  'event.schedule'(occurrence: string): unknown;
  // Whether a member's Hunt waits on an event: its latest report says so.
  'event.pending'(name: string): boolean;
  // Whether the anniversary cycle holds the party, from its staging to its return.
  'event.cycle'(): boolean;
  // The character's read: the event's monster types and the area event of the map it stands on.
  'event.targets'(): unknown;
  'movement.formationRecovery': typeof formationRecovery;
  'movement.independentApproach': typeof independentApproach;
  'movement.independentReadiness': typeof independentReadiness;
  'movement.confirmIndependentApproach': typeof confirmIndependentApproach;
  // The merchant job, realm and hands owners' reads an add-on may ask. The job and realm owners answer
  // on the coordinator, the hands owner on the merchant.
  'jobs.current'(): { id: string; reason: string; target: string; phase?: string } | null;
  // The items owner's reads, answered on the
  // coordinator.
  // Dashboard and status's reads, answered on the
  // coordinator from stored state: table L's line, the last report, the one connection state.
  'status.cardLine'(character: string): import('../status/api.ts').CardLine | null;
  'status.lastReport'(character: string): { report: Record<string, unknown>; seenAt: number } | null;
  'status.connected'(character: string): boolean;
  'items.stock'(character: string, item: string): number;
  'items.claimPending'(character: string, by: string): number;
  'items.needs'(job: Readonly<Record<string, unknown>>): { gold: number; withdrawals: readonly unknown[]; slots: number; postage: number; blockedBy?: string };
  // `slot` is a bag slot, or a mark whose named copy 10's identity rule resolves.
  'items.fate'(character: string, slot: number | ItemMark): { fate: string; row: string; by: string } | null;
  'items.freeSlots'(character: string): number;
  'items.luckySlot'(character: string): number | null;
  'items.fetch'(character: string, item: string): unknown;
  'items.bank'(): unknown;
  'items.storagePending'(character: string): boolean;
  'items.productionPending'(character: string): boolean;
  'items.bag'(character: string): unknown;
  'items.standSlots'(merchant: string): { slots: number; used: number; free: number };
  'jobs.ready'(merchant: string): readonly { id: string; reason: string; target: string; priority: number; realm: string | null }[];
  'merchant.kind'(reason: string): Readonly<Record<string, unknown>>;
  'realm.target'(): string | undefined;
  'realm.moving'(): boolean;
  'hands.normal'(ctx?: AddonContext): { mainhand: unknown; offhand: unknown };
  // The hunts and farming owner's reads (07 6 part 3): a group's focus and farm spot, a member's or
  // the party's Cave visit, a monster's passive rule, a group's Hunt cycle. Each reads 07's record
  // and changes nothing.
  'farming.focus'(group?: string): FarmingFocus | undefined;
  'cave.state'(member?: string): CaveState;
  'passive.rule'(monster: string): PassiveRuleView;
  'hunt.view'(group: string): HuntView | undefined;
}
type PublishedRead = keyof PublishedReads;
// The hunts and farming owner's notices, each naming its
// subject and `by`.
type HuntingNotice = 'hunt.stage' | 'hunt.questChanged' | 'hunt.counted' | 'hunt.blacklisted' | 'farming.focusChanged' |
  'farm.relocated' | 'farming.mode' | 'scatter.learned' | 'rare.encounter' | 'rare.patrol' | 'cave.phase' | 'cave.member';
// `rare.search`'s question (6 part 1): the patrol's group, the game's Phoenix regions and the
// region the patrol stands in.
export interface RareSearchAsk { group: string; regions: readonly string[]; current: string | null }
// The job owner's notices, each naming its subject and `by`.
export type MerchantJobNotice = 'merchant.job.queued' | 'merchant.job.started' | 'merchant.job.paused' | 'merchant.job.resumed' |
  'merchant.job.ended' | 'merchant.job.blocked' | 'merchant.job.unblocked' | 'merchant.gathering.cast' | 'merchant.gathering.phase' |
  'merchant.gathering.noTool' | 'merchant.stand.opened' | 'merchant.stand.closed' | 'merchant.slot.written' | 'merchant.slot.held' |
  'merchant.slot.refused' | 'merchant.holder.changed';
// The items owner's notices, each naming its
// subject and `by`.
export type ItemsNotice = 'items.fateChanged' | 'items.claimShort' | 'items.banked' | 'items.withdrawn' | 'items.bought' |
  'items.sold' | 'items.listed' | 'items.unlisted' | 'items.produced' | 'items.exchanged' | 'items.dismantled' | 'items.mailed' |
  'items.storage' | 'items.bankChanged' | 'items.orderPaused' | 'items.claimRefused' | 'items.sortLease' | 'items.bankboi' |
  'items.saleBlocked' | 'items.intent';
// The realm and hands owners' notices.
export type RealmNotice = 'realm.move.started' | 'realm.move.arrived' | 'realm.move.failed' | 'realm.want.refused' | 'realm.want.granted' |
  'realm.switch.phase';
export type HandsNotice = 'hands.lease.taken' | 'hands.lease.ended' | 'hands.restore.failed';
// An add-on's job kind: the J5 command type it runs, its realm and its priority, which
// The job owner clamps into the add-on band.
// `spends`: an `addon-steps` kind whose steps move the account's assets, which runs only after
// the player switches it on.
export interface MerchantKindAsk { kind: string; command: string; realm: 'home' | 'here' | 'listing'; priority: number; label?: string; spends?: boolean }
// An add-on's one job of its own kinds for a dispatch pass; `realm` is the listing's realm.
// `steps`: an `addon-steps` job's first steps, which the merchant runs one at a time.
export interface MerchantJobAsk { kind: string; target: string; realm?: string; fields?: Readonly<Record<string, unknown>>; steps?: readonly MerchantStep[] }
// What `items.claim` receives and answers (10 3.3): a character's bag and the bank snapshot, and a
// claim of copies at a place, which 10 names `addon:<name>` and ranks after the core claims.
export interface ItemClaimView { character: string; bag: readonly unknown[]; bank: unknown }
export interface ItemClaimAsk { item: { name: string; level?: number }; quantity: { count: number } | { stacks: number } | { min: number; max: number } | { all: true };
  place: string; reason: string }
// What `items.action` receives: a copy no player mark, claim or core rule holds, and its rule owner.
// `core` is the core rule's action for the copy, when one holds it.
export interface ItemActionAsk { character: string; slot: number; item: unknown; owner: string; core?: string }
// An add-on's action, and its place among the core actions (P11, runtime/items/rules.ts addonAhead).
export type ActionOrder = { before: string } | { after: string };
export interface ItemActionAnswer { action: string; order?: ActionOrder }
// What `items.source` receives: a buy order the core sources left short. Its answer is listings in
// the ALData listing's shape (item, seller, map, x, y, price, quantity, serverRegion,
// serverIdentifier, key), which the core's ALData buy reaches.
export interface ItemSourceAsk { item: string; price: number; quantity: number }
// What `items.bankLayout` receives: one bank floor and its cells outside the staging row, each with
// the copy it holds. The answer is the floor's cells in the order the sort fills them.
export interface BankLayoutView { floor: string; items: readonly { pack: string; slot: number; item: unknown }[] }
// What `merchant.job` receives: the merchant, its current job and the queue.
export interface MerchantJobView { merchant: string | null; current: { id: string; reason: string } | null;
  queued: readonly { id: string; reason: string; target: string }[] }
// What `merchant.routine` receives (hook-coverage-2 R3): the merchant, its current job, and each
// queued job with its readiness and the priority the built-in pick ranks it by.
export interface MerchantRoutineView { merchant: string; current: { id: string; reason: string } | null;
  queued: readonly { id: string; reason: string; target: string; priority: number; ready: boolean }[] }
// Its answer: the queued job to run, one job of the add-on's own kinds to queue, standing at the
// merchant's place, or nothing for the built-in pick.
export type MerchantRoutineAnswer = { run: string } | { queue: MerchantJobAsk } | { idle: true } | undefined;
// The events owner's notices: K2's occurrence phases, K3's
// member states, K4's admission, K6's return, the anniversary's phases, the A/B strategy and the
// Cipher plan.
type EventNotice = 'event.scheduled' | 'event.due' | 'event.started' | 'event.ended' | 'event.admitted' | 'event.joined' |
  'event.refused' | 'event.left' | 'event.limit' | 'event.returning' | 'event.returned' | 'anniversary.phase' | 'abtesting.strategy' | 'cipher.plan';
// What `event.attend` sees: the member, its occurrence and K4's answer.
export interface EventAttendAsk { member: string; event: string; occurrence: string; allowed: boolean }
// Dashboard and status's notices.
type StatusNotice = 'status.lineChanged' | 'status.received' | 'status.replied' | 'dashboard.command' | 'dashboard.opened' |
  'dashboard.closed' | 'diagnostics.leased' | 'diagnostics.released' | 'app.keyIssued' | 'app.keyRevoked' | 'app.used';
export type NoticeName = StatusNotice | EventNotice | MerchantJobNotice | ItemsNotice | RealmNotice | HandsNotice | 'journey.started' | 'journey.paused' | 'journey.ended' | WalkNotice | MovementNotice |
  'calls.held' | 'calls.released' | 'calls.waited' | 'calls.raised' | 'calls.unmatched' | 'calls.limitdc' | 'addon.off' | 'addon.on' | 'addon.acted' | 'addon.commanded' | 'settings.changed' | 'settings.refused' | 'settings.imported' | 'settings.saved' | 'task.started' | 'task.suspended' | 'task.resumed' | 'task.ended' |
  'task.waiting' | 'task.refused' | 'task.phase' | 'task.ladder' | 'task.invariant' | 'task.due' | 'group.changed' | 'group.held' | 'group.released' |
  'member.assigned' | 'member.presence' | 'status.changed' | 'slot.changed' | SurvivalNotice | 'targeting.unreachable' |
  SkillsNotice | 'targeting.changed' | TargetingNotice | 'report.sent' | HuntingNotice | LifecycleNotice;
// Lifecycle's notices (K-S5).
type LifecycleNotice = 'lifecycle.started' | 'lifecycle.paused' | 'lifecycle.played' | 'lifecycle.drainStarted' | 'lifecycle.drainEnded' |
  'lifecycle.readiness' | 'lifecycle.shutdown' | 'lifecycle.reloaded' | 'lifecycle.holdChanged' | 'worker.started' | 'worker.exited' | 'roster.changed';
// The groups and tasks owner's notices.
export type TaskNoticeName = Extract<NoticeName, `task.${string}` | `group.${string}` | `member.${string}` | 'status.changed' | 'slot.changed'>;
// The decision hooks the owner asks of one add-on for its own task.
export type OwnTaskHook = 'task.alternative' | 'task.safePoint' | 'group.questions' | 'group.hold' | 'member.apart';

// What a mover answers for one tick. A `step` goes through the movement owner's `step()`,
// so step safety and the rule table judge it; `hold` takes the tick and sends nothing.
// `phase` names what the answer serves in the character's combat position report, which the
// coordinator reads (the `group.anchor` hook receives it).
// Step 9b: `walk` is a task walk to a point on any map, which the movement owner plans and
// climbs at the mover's tier, the way a rare path walks (characters/shared.js climbTaskWalk).
// A `step` may name `closes` as a combat step that closes on a boss does (StepOptions, queue A23).
export type MoverAnswer = ({ kind: 'hold' } | { kind: 'step'; to: { x: number; y: number }; target?: string; closes?: 'terrain' | 'attackers' } |
  { kind: 'walk'; to: { map: string; x: number; y: number } }) & { reason: string; phase?: string };
// The turns owner's notices.
export type SkillsNotice = 'skills.sent' | 'skills.settled' | 'skills.dropped' | 'skills.waiting' | 'skills.readied' | 'skills.held' |
  'skills.released' | 'skills.shot' | 'skills.landed' | 'skills.passed';
// The basic attack's own context, which `skills.sent` and
// `skills.settled` carry for its send, so 04's bookings and 12's handoff notes (runtime/status/character/rings.ts) read the
// send they book: the target, whether it is a passing attack, the range sample at the ask, and
// whether the selection the ask was made on still holds. `skills.settled` adds the send's time and
// the reply.
export interface AttackContext<T = unknown, R = unknown> { target: T; passing: boolean; range: R | null; current(): boolean }
// `skills.allows`'s ask and its refusal: the rank that would spend, whether
// it is a passing attack, and `occupied` to read only the occupied rows, which shared.js's
// `isOccupied` binding asks. A refusal names the spend table's row and the owner whose fact holds it.
export interface SkillsAllowsAsk { rank: SpendRank; passing?: boolean; occupied?: boolean }
export interface SkillsHold { row: string; source: string }
// One spend request: the skill, its targets and argument, the rank that
// orders it in its cooldown family and the category whose MP rule it meets. `attack` and `heal`
// are the game's basic attack and heal; every other skill is a `G.skills` id.
export interface SpendAsk<Target = unknown> { skill: string; targets?: readonly Target[]; argument?: unknown;
  rank: SpendRank; category: 'survival' | 'maintenance' | 'damage'; reason: string }
// A requester of `skills.request`: the highest rank it asks at, and its answer for one pass. The
// turns owner drops an answer above `rank`.
export interface SpendRequester<View = unknown> { name: string; rank: SpendRank;
  answer(view: View, settings: Readonly<Record<string, unknown>>, ctx: AddonContext): SpendAsk | readonly SpendAsk[] | undefined }
export interface Mover<View = unknown> {
  name: string; tier: Tier;
  // A core positioning step: where the character stands around the target it fights. An add-on
  // answer of the same tier runs before it, because the add-on answers that same question.
  positions?: boolean;
  // Core movers answer inline in the role runner, in its chain order; only add-ons pass one.
  // `ctx` is the add-on context; `ctx.store.character` is the character's own store (store.ts).
  answer?(view: View, settings: Readonly<Record<string, unknown>>, ctx: AddonContext): MoverAnswer | undefined;
}
// A member as the anchor question sees it: its report, whether the group could centre on it now,
// and its combat position report (characters/shared.js `partyCombatPosition`).
export interface AnchorMember extends MemberView { ctype: string; available?: boolean; positioning?: { movementOwner?: string | null; phase?: string } | null }
// What an owner's action door settles an add-on's action with: the
// outcome without the ticket's names, which the dispatcher adds.
export type DoorOutcome = { outcome: 'sent'; reply?: unknown } | { outcome: 'refused'; by: string; reason: string } | { outcome: 'failed'; error: string };
// What an owner's door hears beside the args: the ask's id and action, its band, the asking add-on,
// the character and the reason. A C2 step names the job that holds the merchant (`holder`). A
// coordinator ask carries the coordinator's facts for a door that reads them (10's fates and working
// gold, 06's admission, 07's Hunt cycle); they come over the reply, so each door reads its own fields.
export interface DoorAsk { id: string; action: string; band: 'background' | 'job'; addon: string; character: string; reason: string; holder?: string;
  facts?: Readonly<Record<string, unknown>> }
// An owner's door for one action: an export of its door file
// under the name its ACTIONS row gives, which the character's install publishes to the dispatcher.
export type Door = (args: Readonly<Record<string, unknown>>, ask: DoorAsk) => DoorOutcome | Promise<DoorOutcome>;
// An owner's facts for one carried ask, which the coordinator computes as it writes the reply.
export type AskFacts = (ask: { action: string; addon: string; character: string; args: Readonly<Record<string, unknown>> }) =>
  Readonly<Record<string, unknown>> | undefined;
// A slot holds one selected entry per group (R4 as M1 amends it). `choice` is one of the slot's
// entries, which the player picks; `beside` runs on top of whatever the slot holds, and the load
// check refuses it, so a slot never holds two entries at once.
// `combat-routine` holds one entry per character: the spends its routine asks in place of
// the built-in attack, offense and buffs. `formation` (R4 of hook-coverage-2) is a routine slot
// too: each character picks its own entry. `merchant-routine` holds the merchant's entry: the
// job it runs next in place of J2's built-in pick.
export type SlotName = 'target-mode' | 'combat-mode' | 'combat-routine' | 'formation' | 'merchant-routine';
// A slot entry's button and, for an add-on's target mode entry, its status line. They are data the
// dashboard, the PWA and the APK draw alike, so a colour is a name each app maps to its own
// palette. The list holds every colour the core uses.
export const SLOT_COLORS = ['slate', 'cyan', 'emerald', 'violet', 'amber', 'rose', 'sky'] as const;
export type SlotColor = (typeof SLOT_COLORS)[number];
interface SlotButton { label: string; description: string; color: SlotColor }
// `field` names a field of the add-on's scope store, the one `target.settings` and `target.mode`
// write; `idle` shows while it is empty.
interface SlotStatus { title: string; field: string; idle: string }
// `classes` names the character classes a per-character entry serves; left out, it serves all.
// `returnsTo` is the entry the slot's `leave` port writes when the entry ends itself (Farming when
// unset). `reads` lists the player's settings the entry's ports may write; with it unset they may
// write any. `scoped` lists the hooks the registry asks only for a character whose selected entry
// is this one.
export interface SlotMode { slot: SlotName; mode: string; fills: 'choice' | 'beside'; button?: SlotButton; status?: SlotStatus;
  classes?: readonly string[]; returnsTo?: string; reads?: readonly string[]; scoped?: readonly HookName[] }
// One entry as the slots show it: its mode, its registration and its declared data.
export interface SlotEntry { mode: string; addon: string; button: SlotButton; status?: SlotStatus; classes?: readonly string[] }
// `targeting.target`'s answer (runtime/characters/targeting/api.ts:13-17): the target with its reads,
// or `{ due: true }` while a selection is due and no target stands.
export type TurnsTargetAnswer = TargetAnswer | { due: true };
// A target mode add-on's answer to its own settings route (POST /party-api/addon-farming).
export type TargetSettingsAnswer = { ok: true; reply: Record<string, unknown> } | { ok: false; status: number; error: string };
// What `addon.command` receives: the farming scope's owner, the character the dashboard sent it
// for, the add-on's own store for that scope, the time and the posted body.
export interface AddonCommandView { owner: string; character?: string; store: Record<string, unknown>; now: number; body: unknown }
// C4: an `addon.command` answer that hands the body on to the character the command names.
export interface AddonForward { forward: true }
// What `addon.tick` receives: the character the tick is for and the time.
export interface AddonTickView { character: string; now: number }
// The status a `target.settings` answer that threw or broke its shape replies with: the add-on failed.
const ADDON_FAILED_STATUS = 500;
function isSettingsAnswer(a: unknown): a is TargetSettingsAnswer {
  if (typeof a !== 'object' || a === null || !('ok' in a)) return false;
  if (a.ok === true) return 'reply' in a && typeof a.reply === 'object' && a.reply !== null;
  return a.ok === false && 'status' in a && typeof a.status === 'number' && 'error' in a && typeof a.error === 'string';
}
// The slot's name in the player's words, for load refusals and `addon:check`.
const SLOT_WORDS: Record<SlotName, string> = { 'target-mode': 'target mode', 'combat-mode': 'combat mode', 'combat-routine': 'combat routine', formation: 'formation',
  'merchant-routine': 'merchant routine' };
// The hooks that answer a slot's entry: a registration that answers one fills a choice entry of the
// slot, and an add-on's choice entry answers the first, which the console asks for the entry.
const SLOT_HOOKS = { 'target-mode': ['target.mode', 'target.settings'], 'combat-mode': ['combat.mode'], 'combat-routine': ['turns.routine'],
  formation: ['formation.routine'], 'merchant-routine': ['merchant.routine'] } as const satisfies Record<SlotName, readonly HookName[]>;
// 12 D4 part 4, the `diagnostics-ring` slot: an add-on's own ring. It rides table G's lease as
// `<add-on>.<key>`; the character half's `read` answers it after the report, and the diagnostics
// view draws it with the add-on's own records component (addon-kit.ts AddonDashboard `ring`).
export interface AddonRing { label: string; read?(): { records: unknown; incidents?: unknown } }
export interface Registration {
  name: string;
  folder: 'core' | 'addons';
  author: string;
  // What it changes, in player terms (QUESTIONS.md Part 1 question 2).
  summary: string;
  hooks: {
    'movement.request'?: readonly Mover[];
    'group.anchor'?(members: readonly AnchorMember[], settings: Readonly<Record<string, unknown>>, ctx: AddonContext): string | undefined;
    'step.safety'?(view: unknown, to: { x: number; y: number }, settings: Readonly<Record<string, unknown>>, ctx: AddonContext): string | undefined;
    'target.mode'?(view: unknown, settings: Readonly<Record<string, unknown>>, ctx: AddonContext): Record<string, unknown> | undefined;
    'target.settings'?(view: unknown, settings: Readonly<Record<string, unknown>>, ctx: AddonContext): TargetSettingsAnswer;
    // An add-on's own dashboard command (POST /party-api/addon-command), with its scope store. The
    // coordinator answers first; `{forward: true}` hands the body to the character's own answer.
    'addon.command'?(view: AddonCommandView, settings: Readonly<Record<string, unknown>>, ctx: AddonContext): TargetSettingsAnswer | AddonForward;
    // C1: the add-on's own tick, once per report on each side.
    'addon.tick'?(view: AddonTickView, settings: Readonly<Record<string, unknown>>, ctx: AddonContext): void;
    'combat.mode'?(members: unknown, settings: Readonly<Record<string, unknown>>, ctx: AddonContext): 'grouped' | 'scatter' | undefined;
    'status.report'?(view: unknown, settings: Readonly<Record<string, unknown>>, ctx: AddonContext): Record<string, unknown> | undefined;
    // 12 D4 part 1: one line under table L's line on the character's card, under the add-on's name.
    'status.line'?(ask: { character: string; line: string }, settings: Readonly<Record<string, unknown>>, ctx: AddonContext): { label: string } | undefined;
    'targeting.candidates'?(view: unknown, settings: Readonly<Record<string, unknown>>, ctx: AddonContext): unknown;
    'targeting.prefers'?(view: CandidatesView, settings: Readonly<Record<string, unknown>>, ctx: AddonContext): readonly unknown[] | undefined;
    'skills.request'?: readonly SpendRequester[];
    // P13: the spends a combat routine entry asks on one pass, or nothing to spend nothing.
    'turns.routine'?(view: RoutineView, settings: Readonly<Record<string, unknown>>, ctx: AddonContext): readonly SpendAsk[] | undefined;
    'skills.ready'?(skill: string, member?: string): unknown;
    'targeting.target'?(view: unknown): TurnsTargetAnswer | undefined;
    'targeting.allows'?(monster: unknown, skill: string): string | undefined;
    'targeting.fight'?(group: string): GroupFightView | undefined;
    'targeting.groupView'?(ask: { group: string }): GroupView | undefined;
    'targeting.passing'?(walk: WalkView, cause: PassingCause): boolean;
    'targeting.aggroOwner'?(party: AggroParty, settings: Readonly<Record<string, unknown>>, ctx: AddonContext): string | undefined;
    'targeting.refuses'?(monster: unknown, skill: string, settings: Readonly<Record<string, unknown>>, ctx: AddonContext): string | undefined;
    // P4: an add-on's answer for a liftable table A row, the passing column or a priority row.
    // P2: an add-on's pick among the options core accepts for one survival question.
    'survival.choice'?(ask: SurvivalChoiceAsk, settings: Readonly<Record<string, unknown>>, ctx: AddonContext): unknown;
    'targeting.rule'?(ask: TargetingRuleAsk, settings: Readonly<Record<string, unknown>>, ctx: AddonContext): { admit: true } | number | undefined;
    'skills.incoming'?(target: unknown, attacker?: string): number;
    'skills.allows'?(ask: SkillsAllowsAsk): SkillsHold | undefined;
    'skills.pullSafe'?(character: string, target: unknown): true | string;
    // The character's turns report for its status report (TRN-Q-DPS).
    'skills.report'?(): unknown;
    'skills.refuses'?(ask: SpendAsk & { family: string }, settings: Readonly<Record<string, unknown>>, ctx: AddonContext): string | undefined;
    'survival.revival'?(character: string): Promise<boolean>;
    'survival.fighting'?(character: string): boolean;
    'survival.refuses'?(ask: SurvivalRefusalAsk, settings: Readonly<Record<string, unknown>>, ctx: AddonContext): string | undefined;
    'event.attend'?(ask: EventAttendAsk, settings: Readonly<Record<string, unknown>>, ctx: AddonContext): { refuse: string } | undefined;
    'hunt.quest'?(ask: HuntQuestAsk, settings: Readonly<Record<string, unknown>>, ctx: AddonContext): false | undefined;
    'farm.spot'?(ask: FarmSpotAsk, settings: Readonly<Record<string, unknown>>, ctx: AddonContext): FarmSpotAnswer | undefined;
    'rare.search'?(ask: RareSearchAsk, settings: Readonly<Record<string, unknown>>, ctx: AddonContext): readonly string[] | undefined;
    'cave.destination'?(ask: CaveDestinationAsk, settings: Readonly<Record<string, unknown>>, ctx: AddonContext): string | undefined;
    'cave.rejoin'?(ask: CaveRejoinAsk, settings: Readonly<Record<string, unknown>>, ctx: AddonContext): false | undefined;
    'event.kind'?(ctx: AddonContext): EventKindAnswer | undefined;
    'task.request'?(view: unknown, settings: Readonly<Record<string, unknown>>, ctx: AddonContext): unknown;
    'merchant.jobKind'?(settings: Readonly<Record<string, unknown>>, ctx: AddonContext): readonly MerchantKindAsk[] | undefined;
    'merchant.job'?(view: MerchantJobView, settings: Readonly<Record<string, unknown>>, ctx: AddonContext): MerchantJobAsk | undefined;
    // P14: the merchant routine entry's pick for one dispatch pass.
    'merchant.routine'?(view: MerchantRoutineView, settings: Readonly<Record<string, unknown>>, ctx: AddonContext): MerchantRoutineAnswer;
    // C2: the next steps of an add-on merchant job, asked on the merchant between steps.
    'merchant.step'?(view: MerchantStepView, settings: Readonly<Record<string, unknown>>, ctx: AddonContext): MerchantStepAnswer;
    'items.claim'?(view: ItemClaimView, settings: Readonly<Record<string, unknown>>, ctx: AddonContext): ItemClaimAsk | readonly ItemClaimAsk[] | undefined;
    'items.action'?(ask: ItemActionAsk, settings: Readonly<Record<string, unknown>>, ctx: AddonContext): ItemActionAnswer | undefined;
    'items.source'?(ask: ItemSourceAsk, settings: Readonly<Record<string, unknown>>, ctx: AddonContext): readonly unknown[] | undefined;
    'items.bankLayout'?(view: BankLayoutView, settings: Readonly<Record<string, unknown>>, ctx: AddonContext): readonly { pack: string; slot: number }[] | undefined;
  } & {
    [hook in OwnTaskHook]?: (view: Readonly<Record<string, unknown>>, settings: Readonly<Record<string, unknown>>, ctx: AddonContext) => unknown;
  } & {
    'settings.write'?(batch: SettingsWrite): SettingsWriteResult;
    // P1: an add-on's value for one read of a setting it lists in `overlays`; core:settings checks it.
    'settings.overlay'?(ask: OverlayAsk, settings: Readonly<Record<string, unknown>>, ctx: AddonContext): unknown;
    'settings.accepts'?(field: string, value: unknown): string | undefined;
    'settings.read'?(query: SettingsRead): unknown;
    'calls.band'?(question: CallQuestion): CallAnswer;
    'calls.margin'?(): number | undefined;
    'calls.window'?(): number;
    'survival.verdict'?(question: SurvivalQuestion): SurvivalVerdict | undefined;
    'survival.respawn'?(ask: { by: string }): RespawnAnswer;
    'survival.escaping'?(name: string): EscapeHold | undefined;
    'survival.recovery'?(group: string): RecoveryView | undefined;
    'survival.recoveryStep'?(group: string): RecoveryView | undefined;
    'survival.life'?(name: string): number;
    'survival.low'?(name: string): boolean;
    'survival.healthy'?(share: number): boolean;
    'survival.mpPotion'?(mpAfter: number): number;
    'realm.reconnect'?(character: string): 'sent' | 'not-now';
    'retry.policy'?(ask: RetryAsk, settings: Readonly<Record<string, unknown>>, ctx: AddonContext): RetryAnswer | undefined;
    'lifecycle.ready'?(ask: ReadyAsk, ctx: AddonContext): ReadyAnswer | undefined;
    // Lifecycle's published reads: the coordinator answers `state` and
    // `allows`; both runtimes answer `drain`; the character answers `held` and `boundary`.
    'lifecycle.state'?(): LifecycleState;
    'lifecycle.drain'?(): unknown;
    'lifecycle.allows'?(question: string): boolean;
    'lifecycle.boundary'?(): Promise<void>;
    'lifecycle.held'?(): boolean;
    'roster.offline'?(name: string): Promise<boolean>;
    'roster.assign'?(slot: number, name: string): void;
    'walks.end'?(group: string, code: WalkEndCode, member?: string): boolean;
    'walks.estimate'?(group: string, destination: WalkAsk['destination'], member?: string): Promise<number | undefined>;
    'member.holder'?(ask: MemberHoldAsk): readonly MemberHold[];
    'route.avoid'?(ask: RouteAvoidAsk, settings: Readonly<Record<string, unknown>>, ctx: AddonContext): readonly string[] | undefined;
    'crossing.allows'?(ask: CrossingAsk, settings: Readonly<Record<string, unknown>>, ctx: AddonContext): string | undefined;
    'step.point'?(ask: StepPointAsk, settings: Readonly<Record<string, unknown>>, ctx: AddonContext): { x: number; y: number } | undefined;
    'formation.routine'?(ask: FormationAsk, settings: Readonly<Record<string, unknown>>, ctx: AddonContext): FormationAnswer;
    'ladder.rung'?(ask: { holder: string; activity?: string }, settings: Readonly<Record<string, unknown>>, ctx: AddonContext): readonly Rung[] | undefined;
    'walk.request'?(view: AddonWalkView, settings: Readonly<Record<string, unknown>>, ctx: AddonContext): AddonWalkAnswer;
    'walk.departs'?(view: { group: string | null; walk: string; phase: string; members: string[] }, settings: Readonly<Record<string, unknown>>, ctx: AddonContext): boolean | undefined;
    'safe.goal'?(view: { group: string | null; walk: string; purpose?: string | null }, settings: Readonly<Record<string, unknown>>, ctx: AddonContext): { map: string; x: number; y: number } | undefined;
    'walk.flags'?(view: WalkFlagsView, settings: Readonly<Record<string, unknown>>, ctx: AddonContext): WalkFlagsAnswer | undefined;
  } & Partial<PublishedReads> & Partial<Record<NoticeName, (payload: Record<string, unknown>, settings: Readonly<Record<string, unknown>>, ctx: AddonContext) => void>>;
  slots?: readonly SlotMode[];
  // The player's settings this add-on's `settings.overlay` answers. One add-on overlays a field.
  overlays?: readonly string[];
  rings?: Readonly<Record<string, AddonRing>>;
  settings?: Readonly<Record<string, Setting>>;
  // The saved values play produces that this owner writes. An add-on
  // keeps its state in its store (store.ts), so an add-on that declares one is refused.
  records?: Readonly<Record<string, SavedRecord>>;
  // The tier a `task.request` answer ranks at (01 design section 5). An add-on task names
  // `addon-task` (60), above farming and below the Hunt mission, so no add-on outranks Hunt,
  // rares, events, the player's commands, the Cave or survival.
  taskTier?: Tier;
  // The owner a `member.holder` answer speaks for. Movement adds a member's own report of
  // what holds it only for an owner that no registration speaks for (movement/coordinator/runtime.ts
  // `memberHolds`).
  holder?: MemberHold['owner'];
}
// The hooks as core's dispatch calls them. The registry wraps each add-on answer at load
// (`withContext`) and hands it the add-on's context after its settings, so a call site passes only
// the arguments before the context.
// A parameter list ends in the context only when its last type is AddonContext itself, so an
// answer whose last parameter is `unknown` keeps it.
type Dispatched<F> = F extends (...args: infer A) => infer R
  ? A extends [...infer P, infer C] ? [C, AddonContext] extends [AddonContext, C] ? (...args: P) => R : F : F
  : F extends readonly (infer E extends { answer: unknown })[] ? readonly (Omit<E, 'answer'> & { answer: Dispatched<E['answer']> })[] : F;
export type DispatchHooks = { [H in keyof Registration['hooks']]: Dispatched<Registration['hooks'][H]> };
export type DispatchRegistration = Omit<Registration, 'hooks'> & { hooks: DispatchHooks };
// What a `task.request` answer asks for (01 design section 5). The kind is `addon:<name>`.
// The task ends on the first tick its source asks for none (rule 2.3.3), so it names no deadline.
export interface AddonTaskAsk { kind: string; owner: string; members?: readonly string[]; phase?: string; label?: string; goal?: unknown;
  interrupted?: 'suspend' | 'cancel'; windDown?: 'none' | 'finish' | 'finish-regroup'; visit?: boolean; reunion?: 'alone' | 'command' | 'no' }
export interface AddonState { enabled?: boolean; settings?: Record<string, unknown> }
// What `settings.overlay` receives: the field, the character a per-character read is for, and the
// player's saved value.
export interface OverlayAsk { field: string; character?: string; value: unknown }
// P2 `survival.choice`'s questions and its ask: the member, the options core accepts, and core's pick.
export type SurvivalChoiceName = 'potion' | 'regen' | 'heal' | 'stomp' | 'scare' | 'ports' | 'landing' | 'escapeSpend' | 'danger' | 'transfer' |
  'respawn' | 'recovery' | 'farmReturn' | 'revival';
export interface SurvivalChoiceAsk<T = unknown> { question: SurvivalChoiceName; member: string; options: readonly T[]; core: T }
// What `turns.routine` receives: the turns view of the pass, the entry and the class, and
// each skill's readiness from the turns owner.
export interface RoutineView { entry: string; ctype: string; view: unknown; ready(skill: string): unknown }
// What `targeting.rule` receives: the row, the monster (none for the passing column), the
// character, and core's own outcome, a refusal's reason or the row's priority.
export interface TargetingRuleAsk { row: string; target: unknown; character: string; core: string | number }
// The game's character classes (G.classes), which a combat routine entry names.
const CHARACTER_CLASSES: readonly string[] = ['merchant', 'warrior', 'priest', 'mage', 'ranger', 'rogue', 'paladin'];
const MANUAL = TIERS.manual.rank;
const rank = (tier: Tier) => TIERS[tier].rank;
// The movers' answers in rank order, highest first, for `addon:map`.
const tiersInRankOrder = () => (Object.keys(TIERS) as Tier[]).sort((a, b) => rank(b) - rank(a));

// What an owner's row file reads of the registry for its own rows' dispatch.
export interface DispatchContext {
  answering(hook: HookName): DispatchRegistration[];
  settings(name: string): Record<string, unknown>;
  enabled(name: string): boolean;
  // C3 (lane L4): the context a dispatch hands an add-on answer it calls outside the registry's
  // own wrapper, as the merchant runner's `merchant.step`.
  addonContext(name: string): AddonContext | undefined;
  registration(name: string): DispatchRegistration | undefined;
  slotHolder(key: string): { name: string; fills: SlotMode['fills']; classes?: readonly string[] } | undefined;
  // Keeps a dropped or refused answer's reason in the error log.
  record(name: string, hook: HookName, error: string): void;
  // Runs one registration's answer. An answer that throws counts as none (0.4), and its error goes
  // to the error log.
  call<T>(r: DispatchRegistration, hook: HookName, answer: () => T): T | undefined;
  // Each enabled registration's answer in load order, named by the registration; an answer of
  // nothing, or one that throws, is left out.
  answers<T>(hook: HookName, ask: (r: DispatchRegistration) => T | undefined): { addon: string; answer: T }[];
  // The first refusal in load order, named by its add-on: a non-empty string is a refusal.
  refusal(hook: HookName, ask: (r: DispatchRegistration) => unknown): string | undefined;
  // The same refusal as its registration's name and its reason.
  refuser(hook: HookName, ask: (r: DispatchRegistration) => unknown): Refusal | undefined;
  // The one registration a core-answered hook has; a realm without it fails naming the hook.
  one(hook: HookName): DispatchRegistration;
}
// An add-on answer the registry calls with its settings only; the wrapper `withContext` adds the
// context after them.
type Answer2<V, R> = (view: V, settings: Readonly<Record<string, unknown>>) => R;
type AnyAnswer = (...args: unknown[]) => unknown;
const isForward = (a: unknown): a is AddonForward => typeof a === 'object' && a !== null && (a as AddonForward).forward === true;
// The call frame a coordinator route names: the view's scope owner and the scope state.
const frameOf = (view: unknown, scope: unknown) => ({ ...(typeof (view as { owner?: unknown })?.owner === 'string' ? { owner: (view as { owner: string }).owner } : {}),
  ...(typeof (view as { character?: unknown })?.character === 'string' ? { character: (view as { character: string }).character } : {}), scope });
// The coordinator ask and command ids a character remembers, so a reply that carries one again
// runs it once.
const CARRIED_KEPT = 200;
export function createRegistry() {
  const registrations = new Map<string, DispatchRegistration>();
  const refusals: { name: string; message: string }[] = [];
  const state = new Map<string, AddonState>();
  // The error log keeps one entry per registration and hook: its last error and how many times it
  // threw. A broken add-on that throws every tick holds one entry, so the log needs no cap.
  const errors = new Map<string, { name: string; hook: HookName; error: string; count: number }>();
  function record(name: string, hook: HookName, error: string): void {
    const key = `${name}\n${hook}`, was = errors.get(key);
    errors.delete(key);
    errors.set(key, { name, hook, error, count: was ? was.count + 1 : 1 });
  }
  function call<T>(r: DispatchRegistration, hook: HookName, answer: () => T): T | undefined {
    try { return answer(); }
    catch (error) { record(r.name, hook, String(error)); return undefined; }
  }
  function answers<T>(hook: HookName, ask: (r: DispatchRegistration) => T | undefined): { addon: string; answer: T }[] {
    return answering(hook).flatMap(r => { const answer = call(r, hook, () => ask(r)); return answer === undefined ? [] : [{ addon: r.name, answer }]; });
  }
  function refuser(hook: HookName, ask: (r: DispatchRegistration) => unknown): Refusal | undefined {
    for (const r of answering(hook)) {
      const refused = call(r, hook, () => ask(r));
      if (typeof refused === 'string' && refused) return { by: r.name, reason: refused };
    }
    return undefined;
  }
  function refusal(hook: HookName, ask: (r: DispatchRegistration) => unknown): string | undefined {
    const refused = refuser(hook, ask);
    return refused && `${refused.by}: ${refused.reason}`;
  }
  // The core answer goes first, so a read an add-on also answers (P12 `hands.normal`) still reaches
  // the owner that checks the add-on's answer.
  function one(hook: HookName): DispatchRegistration {
    const r = answering(hook).find(o => o.folder === 'core') ?? answering(hook)[0];
    if (!r) throw Error(`${hook} has no answer`);
    return r;
  }
  // The entry each slot selected for this character, from its reply's `slotEntries`. A
  // registration's scoped hook is left out while its entry is not the selected one, so a character
  // whose reply named none asks no scoped hook.
  const selected = new Map<string, string>();
  const offEntry = (r: DispatchRegistration, hook: HookName) => (r.slots ?? []).some(m => m.scoped?.includes(hook) && selected.get(m.slot) !== m.mode);
  const stores = createAddonStores();
  // C3: the side this registry runs on, set by the side's own install (`attach`). On the character,
  // its scope's owner and the add-ons' values for that scope come with each reply (`addonScope`).
  let side: 'character' | 'coordinator' | undefined;
  let self: { name: string; dead?(): boolean } | undefined;
  let scopeGiven: { owner: string; settings: Record<string, Record<string, unknown>> } | undefined;
  // C4: the coordinator's stores; only the coordinator's intake attaches its saved record.
  const book = createStoreBook();
  // The call a hook answer runs for. On the coordinator the caller names the character and the
  // scope (`within`); on the character they are its own.
  let frame: { character?: string; owner?: string; scope?: unknown } = {};
  function within<T>(next: typeof frame, run: () => T): T {
    const was = frame; frame = next;
    try { return run(); } finally { frame = was; }
  }
  // The settings object a call hands an answer: the scope's values over the account's. The
  // registry marks each one, so an add-on answer's wrapper finds where the context goes.
  const given = new WeakSet<object>();
  function scoped(name: string): Record<string, unknown> {
    const account = settings(name);
    const values = side === 'character' ? { ...account, ...scopeGiven?.settings[name] } : addonValues(name, frame.scope, account);
    given.add(values);
    return values;
  }
  // C1: the action queue. An outcome reaches only the add-on that asked it, and core listeners.
  const actions = createActionQueue({ settled: outcome => tellAddon(outcome.addon, 'addon.acted', { ...outcome }) });
  // The doors and reads the owners publish on this side.
  const doors = new Map<string, Door>(), reads = new Map<string, (...args: readonly unknown[]) => unknown>();
  // On the coordinator: each owner's facts for the asks its character doors take (DoorAsk `facts`),
  // and the asks a door published here runs now.
  const askFacts = new Map<string, AskFacts>(), running = new Set<string>();
  // On the character: the coordinator's asks it ran, by id, and the outcomes and command replies
  // its next report carries until a reply answers that report.
  const carried = new Set<string>(), results: { sent: boolean; outcome: ActionOutcome }[] = [];
  const replies: { sent: boolean; reply: { id: string; addon: string; reply: unknown } }[] = [];
  // On the coordinator: the commands `addon.command` forwarded, by character, until its report
  // carries the reply (C4 `addon-inbox`).
  const inbox = new Map<string, { id: string; addon: string; body: unknown }[]>();
  let inboxSeq = 0;
  function tellAddon(addon: string, hook: 'addon.acted' | 'addon.commanded', payload: Record<string, unknown>): void {
    for (const r of answering(hook)) if (r.folder === 'core' || r.name === addon)
      call(r, hook, () => { r.hooks[hook]!(payload, scoped(r.name)); });
  }
  // The context every add-on answer receives as the argument after its settings. A notice
  // gets no `act`, because a notice stays read-only.
  function context(r: Registration, hook: string): AddonContext {
    const character = frame.character ?? (side === 'character' ? self?.name : undefined);
    const owner = frame.owner ?? (side === 'character' ? scopeGiven?.owner : undefined) ?? '';
    const refuse = (message: string) => record(r.name, hook as HookName, message);
    const store = side === 'character' ? stores.handles(r.name, refuse) : book.handles(r.name, character, owner || undefined, frame.scope as ScopeHolder | undefined, refuse);
    const notice = (HOOKS as Record<string, HookRow>)[hook]?.kind === 'notice';
    return { side: side ?? 'coordinator', ...(character ? { character } : {}), scope: owner, settings: scoped(r.name), store,
      read: ((name: string, ...args: readonly unknown[]) => askRow(name, args)) as Read,
      act(ask) {
        if (notice) throw Error(`${r.name} asked ${ask.action} from the notice ${hook}; a notice stays read-only`);
        const who = side === 'character' ? self?.name : ask.character ?? character;
        if (!who) throw Error(`${r.name} asked ${ask.action} for no character`);
        return actions.ask(r.name, who, ask);
      },
      outcome: id => actions.outcome(r.name, id) };
  }
  // An add-on's answers take the context after their settings. The registry wraps each answer at
  // load, so every owner's dispatch hands it on with no change of its own. A core answer takes no
  // context and goes in as it is.
  function withContext(r: Registration): DispatchRegistration {
    const wrap = (hook: string, fn: AnyAnswer): AnyAnswer => function (this: unknown, ...args: unknown[]) {
      const at = args.findIndex(a => typeof a === 'object' && a !== null && given.has(a));
      return fn.apply(this, [...(at < 0 ? args : args.slice(0, at + 1)), context(r, hook)]);
    };
    const hooks = Object.fromEntries(Object.entries(r.hooks).map(([hook, answer]) => [hook, r.folder !== 'addons' ? answer
      : hook === 'movement.request' ? (answer as readonly Mover[]).map(m => m.answer ? { ...m, answer: wrap(hook, m.answer as AnyAnswer) } : m)
        : hook === 'skills.request' ? (answer as readonly SpendRequester[]).map(q => ({ ...q, answer: wrap(hook, q.answer as AnyAnswer) }))
          : typeof answer === 'function' ? wrap(hook, answer as AnyAnswer) : answer]));
    return { ...r, hooks: hooks as DispatchHooks };
  }
  // The one core answer of an ask as its own function. `Parameters<>` drops a generic answer's type
  // parameter, so a generic row such as `movement.reply` is called through this.
  function answerOf<H extends PublishedRead>(hook: H): PublishedReads[H] {
    const reads: Partial<PublishedReads> = one(hook).hooks;
    return reads[hook]!;
  }
  // C3's one read: a hook row an add-on may ask, or an owner's `READS` row, on the side it runs on.
  function askRow(name: string, question: readonly unknown[]): unknown {
    const row = (HOOKS as Record<string, HookRow>)[name] ?? READS[name];
    if (!row) throw Error(`${name} is neither a hook row nor a READS row`);
    if (row.side && row.side !== 'both' && side && row.side !== side) throw Error(`${name} answers on the ${row.side}; this is the ${side}`);
    if ((row as HookRow).kind === 'notice') throw Error(`${name} is a notice; a read asks a request row`);
    if (name in HOOKS) return (one(name as HookName).hooks[name as HookName] as (...args: readonly unknown[]) => unknown)(...question);
    const answer = reads.get(name);
    if (!answer) throw Error(`${name} has no answer on the ${side ?? 'unattached side'}: its owner has not published it here`);
    return answer(...question);
  }
  // Runs the character's queued actions: each add-on's next ask goes through the dispatcher. A
  // coordinator ask's outcome waits for the next report; the character's own settles here.
  function pump(): void {
    const me = self;
    if (side !== 'character' || !me) return;
    for (const a of actions.take(me.name)) void runAction(a, { row: action => ACTIONS[action], door: name => doors.get(name), holds: () => holds(me) })
      .then(outcome => { if (carried.has(a.id)) { results.push({ sent: false, outcome }); actions.forget(a.id); } else actions.settle(outcome); });
  }
  // The common holds, which a heal already obeys: the lifecycle owner's Pause and the player's hold,
  // the player's own command while Manual holds the character, the escape that owns it, and a
  // character at 0 HP. A side with no answer for a hold, as a test realm, holds nothing for it.
  function holds(me: { name: string; dead?(): boolean }): { by: string; reason: string } | undefined {
    const asked = <T,>(hook: HookName, ...args: unknown[]): T | undefined => {
      const r = answering(hook)[0];
      return r ? (r.hooks[hook] as AnyAnswer)(...args) as T : undefined;
    };
    if (asked<boolean>('lifecycle.held')) return { by: '13', reason: "the Pause or the player's hold holds the character" };
    if (asked<MovementLive | null>('movement.live')?.tier === 'manual') return { by: '02', reason: "the player's own command holds the character (Manual)" };
    if (asked<EscapeHold>('survival.escaping', me.name)) return { by: '05', reason: 'an escape owns the character' };
    if (me.dead?.()) return { by: '05', reason: 'the character is at 0 HP' };
    return undefined;
  }
  // The two slots, keyed `<slot>:<entry>` (groups and tasks).
  const slotHolders = new Map<string, { name: string; fills: SlotMode['fills']; button?: SlotButton; status?: SlotStatus; classes?: readonly string[] }>();

  // The settings owner's check of a field an add-on overlays, set once its declaration table builds.
  let overlayGuard: ((field: string) => string | undefined) | undefined;
  // The load conflict's words when a registration in `others` that `counts` answers a one-answer hook
  // `r` answers too.
  function oneAnswerHeld(r: Registration, counts: (o: Registration) => boolean, others: readonly Registration[] = [...registrations.values()]): string | undefined {
    for (const hook of Object.keys(r.hooks) as HookName[]) {
      if (HOOKS[hook].answers !== 'one') continue;
      const other = others.find(o => o.name !== r.name && hook in o.hooks && counts(o));
      if (other) return `${r.name} and ${other.name} both answer "${hook}", a question with one answer`;
    }
    return undefined;
  }
  function refuse(name: string, message: string) { refusals.push({ name, message }); return { ok: false as const, message }; }
  // `from` is the folder the build found an add-on in (build/installed.mts): its name is
  // the folder's, and a folder holds an add-on, never a core registration. `republished` names the
  // live registration a CODE reload publishes again, which the check sets aside.
  function problem(r: Registration, from?: string, republished?: Registration): string | undefined {
    const others = [...registrations.values()].filter(o => o !== republished);
    const holders = [...slotHolders.entries()].filter(([, h]) => h.name !== republished?.name);
    if (from !== undefined && r.folder !== 'addons') return `runtime/addons/${from} registers ${r.name} as core; an add-on folder holds an add-on`;
    if (from !== undefined && r.name !== from) return `runtime/addons/${from} registers as ${r.name}; an add-on's name is its folder's`;
    if (others.some(o => o.name === r.name)) return `${r.name} is already registered`;
    for (const hook of Object.keys(r.hooks)) if (!(hook in HOOKS)) return `${r.name} answers the hook "${hook}", which the hook table does not declare`;
    for (const hook of Object.keys(r.hooks) as HookName[]) {
      const owner = pendingOwner(hook);
      if (owner) return `${r.name} answers "${hook}", which waits for the ${owner} owner: the hook point is declared and opens when that owner is built`;
      if (r.folder === 'addons' && coreOnly(hook)) return `${r.name} answers "${hook}", which takes no add-on answer: an add-on makes no game call`;
    }
    if (r.folder === 'addons' && r.hooks['task.request'] && r.taskTier !== 'addon-task')
      return `${r.name} asks for tasks at the tier "${r.taskTier ?? 'none'}"; an add-on task names addon-task, above farming and below the Hunt mission`;
    for (const [slot, hooks] of Object.entries(SLOT_HOOKS) as [SlotName, readonly HookName[]][]) for (const hook of hooks)
      if (r.hooks[hook as keyof Registration['hooks']] && !(r.slots ?? []).some(m => m.slot === slot && m.fills === 'choice'))
        return `${r.name} answers "${hook}" but fills no ${SLOT_WORDS[slot]} entry; declare the entry it answers as a ${slot} choice`;
    // P1: an overlay names its fields, and one add-on overlays a field, so two answers never meet.
    if (r.hooks['settings.overlay'] && !r.overlays?.length) return `${r.name} answers "settings.overlay" but lists no overlays; name the settings it answers for`;
    if (r.overlays?.length && !r.hooks['settings.overlay']) return `${r.name} lists overlays but answers no "settings.overlay"`;
    for (const field of r.overlays ?? []) {
      const other = others.find(o => o.overlays?.includes(field));
      if (other) return `${r.name} and ${other.name} both overlay the setting "${field}"; one add-on overlays a setting`;
      const refused = overlayGuard?.(field);
      if (refused) return `${r.name} overlays "${field}": ${refused}`;
    }
    // The settings owner's rule for what a registration's settings may declare.
    const settingProblem = addonSettingProblem(r);
    if (settingProblem) return settingProblem;
    for (const mover of r.hooks['movement.request'] ?? []) {
      if (!(mover.tier in TIERS)) return `${r.name} moves at the tier "${mover.tier}", which the rank table does not have`;
      if (r.folder === 'addons' && rank(mover.tier) >= MANUAL)
        return `${r.name} moves at the tier "${mover.tier}", at or above your own commands (manual); an add-on ranks below them`;
      if (r.folder === 'addons' && !ADDON_TIERS.includes(mover.tier))
        return `${r.name} moves at the tier "${mover.tier}", which moves no character; an add-on mover names one of ${ADDON_TIERS.join(', ')}`;
      if (r.folder === 'addons' && !mover.answer) return `${r.name} declares the mover ${mover.name} with no answer`;
    }
    for (const asker of r.hooks['skills.request'] ?? []) {
      if (!(asker.rank in SPEND_RANKS)) return `${r.name} asks for a spend at the rank "${asker.rank}", which the rank table does not have`;
      if (r.folder === 'addons' && SPEND_RANKS[asker.rank] > SPEND_RANKS[ADDON_SPEND_CAP])
        return `${r.name} asks for a spend at the rank "${asker.rank}", above ${ADDON_SPEND_CAP}: an add-on spend ranks at ${ADDON_SPEND_CAP} or below, so no add-on outranks a heal or a potion`;
    }
    // Two add-ons meet on a one-answer hook only while both are on; a core answer holds it always.
    const held = oneAnswerHeld(r, o => o.folder === 'core' || r.folder === 'core' || enabled(o.name) && enabled(r.name), others);
    if (held) return held;
    for (const mode of r.slots ?? []) {
      if (!(mode.slot in SLOT_WORDS)) return `${r.name} fills the slot "${mode.slot}", which the console does not have`;
      // P13: a per-character entry names the game's classes it serves.
      const strange = (mode.classes ?? []).find(c => !CHARACTER_CLASSES.includes(c));
      if (strange !== undefined) return `${r.name} fills the ${SLOT_WORDS[mode.slot]} entry "${mode.mode}" for the class "${strange}", which the game does not have`;
      if (mode.fills === 'choice' && !mode.button) return `${r.name} fills the ${SLOT_WORDS[mode.slot]} entry "${mode.mode}" with no button; declare its label, description and colour`;
      if (mode.button && !(SLOT_COLORS as readonly string[]).includes(mode.button.color))
        return `${r.name} colours its ${SLOT_WORDS[mode.slot]} button "${mode.mode}" ${JSON.stringify(mode.button.color)}, which is not one of ${SLOT_COLORS.join(', ')}`;
      if (r.folder === 'addons' && mode.slot === 'target-mode' && mode.fills === 'choice' && !mode.status?.field)
        return `${r.name} fills the target mode entry "${mode.mode}" with no status line; declare its title, store field and idle text`;
      if (mode.returnsTo === mode.mode) return `${r.name}'s ${SLOT_WORDS[mode.slot]} entry "${mode.mode}" returns to itself; name the entry the party goes back to`;
      for (const hook of mode.scoped ?? []) if (!(hook in r.hooks))
        return `${r.name} scopes "${hook}" to its ${SLOT_WORDS[mode.slot]} entry "${mode.mode}" but answers no "${hook}"`;
      const inSlot = holders.filter(([key]) => key.startsWith(mode.slot + ':'));
      const same = inSlot.find(([key]) => key === mode.slot + ':' + mode.mode)?.[1];
      if (same) return `${r.name} and ${same.name} both fill the ${SLOT_WORDS[mode.slot]} entry "${mode.mode}"`;
      // R4: one slot holds one mode, so a mode that runs beside the slot would run with every choice.
      const beside = mode.fills === 'beside' ? inSlot[0] : inSlot.find(([, h]) => h.fills === 'beside');
      if (beside) {
        const [toggle, other] = mode.fills === 'beside' ? [r.name, beside[1].name] : [beside[1].name, r.name];
        const words = SLOT_WORDS[mode.slot];
        return `${toggle} runs beside the ${words}, and ${other} fills it: the ${words} slot holds one selected entry, so ` +
          `both cannot be on. Register ${toggle} as a ${words} entry`;
      }
      // The console asks an add-on's choice entry through its slot's first hook, so an entry with no
      // answer would show a button that does nothing.
      const tick = SLOT_HOOKS[mode.slot][0];
      if (r.folder === 'addons' && mode.fills === 'choice' && !r.hooks[tick])
        return `${r.name} fills the ${SLOT_WORDS[mode.slot]} entry "${mode.mode}" but answers no "${tick}", which the console asks for the entry`;
    }
    // The diagnostics view names each ring's tab by its label; table G's rings are the core's own.
    for (const [key, ring] of Object.entries(r.rings ?? {})) {
      if (r.folder !== 'addons') return `${r.name} declares the ring "${key}": the core's rings are table G's (runtime/status/rules.ts)`;
      if (!ring.label) return `${r.name} declares the ring "${key}" with no label; name the diagnostics tab it shows as`;
    }
    return undefined;
  }
  const enabled = (name: string) => registrations.get(name)?.folder === 'core' || state.get(name)?.enabled === true;
  function settings(name: string): Record<string, unknown> {
    const declared = registrations.get(name)?.settings ?? {}, saved = state.get(name)?.settings ?? {};
    return Object.fromEntries(Object.entries(declared).map(([key, setting]): [string, unknown] => [key, key in saved ? saved[key] : setting.default]));
  }
  // Answering registrations, enabled ones only, in load order. A hook point with nothing
  // registered reads one empty list (00-overview "Hooks are always there, and free when unused").
  const lists = new Map<HookName, DispatchRegistration[]>(), coreMovers = new Map<string, Tier>(), positioning = new Set<string>();
  function answering(hook: HookName): DispatchRegistration[] {
    let list = lists.get(hook);
    // Core movers answer inline in the role runner, so the add-on movers are the list.
    if (!list) lists.set(hook, list = [...registrations.values()].filter(r => hook in r.hooks && enabled(r.name) &&
      !(hook === 'movement.request' && r.folder === 'core') && !offEntry(r, hook)));
    return list;
  }
  const ctx: DispatchContext = { answering, settings: scoped, enabled, addonContext: name => { const r = registrations.get(name); return r ? context(r, 'addon.tick') : undefined; }, registration: name => registrations.get(name), slotHolder: key => slotHolders.get(key),
    record, call, answers, refusal, refuser, one };
  const m02 = movement.dispatch(ctx), t03 = turns.dispatch(ctx), t04 = targeting.dispatch(ctx), s05 = survival.dispatch(ctx);
  const c09 = calls.dispatch(ctx), l13 = lifecycle.dispatch(ctx);
  const api = {
    ...tasks.dispatch(ctx), ...settingsRows.dispatch(ctx), ...merchant.dispatch(ctx), ...items.dispatch(ctx),
    register(r: Registration, from?: string): { ok: true } | { ok: false; message: string } {
      const message = problem(r, from);
      if (message) return refuse(r.name, message);
      registrations.set(r.name, withContext(r)); lists.clear();
      if (r.folder === 'core') for (const m of r.hooks['movement.request'] ?? []) { coreMovers.set(m.name, m.tier); if (m.positions) positioning.add(m.name); }
      for (const mode of r.slots ?? []) slotHolders.set(mode.slot + ':' + mode.mode, { name: r.name, fills: mode.fills, button: mode.button, status: mode.status, ...(mode.classes ? { classes: mode.classes } : {}) });
      return { ok: true };
    },
    // A core registration that a CODE reload installs again (the published reads, 02 R3): the
    // first load registers it, and each later load puts its own closure's answers in it.
    publish(r: Registration): { ok: true } | { ok: false; message: string } {
      const live = registrations.get(r.name);
      if (!live) return this.register(r);
      if (live.folder !== 'core' || r.folder !== 'core') return refuse(r.name, `${r.name} is already registered`);
      const message = problem({ ...live, hooks: { ...live.hooks, ...r.hooks } }, undefined, live);
      if (message) return refuse(r.name, message);
      Object.assign(live.hooks, r.hooks); lists.clear();
      return { ok: true };
    },
    // The settings owner hands its field check here once its table builds, which is after the
    // add-ons registered: an add-on whose `overlays` names a field the check refuses (`noOverlay`,
    // a credential, a record) is taken out and refused, as a load refusal would.
    guardOverlays(guard: (field: string) => string | undefined): void {
      overlayGuard = guard;
      for (const r of [...registrations.values()]) {
        if (r.folder !== 'addons' || !r.overlays?.length) continue;
        const message = problem(r, undefined, r);
        if (!message) continue;
        registrations.delete(r.name); lists.clear();
        for (const [key, h] of [...slotHolders]) if (h.name === r.name) slotHolders.delete(key);
        refuse(r.name, message);
      }
    },
    refusals: () => refusals.slice(),
    registrations: () => [...registrations.values()],
    // The coordinator's saved switches and settings, sent with every status reply. An add-on
    // left out keeps its default: off.
    // Each add-on whose switch this turns off gets `addon.off`, with the settings it had, and so
    // does each core registration that answers it, with its own. Each add-on it turns on gets
    // `addon.on` the same way, with its new settings.
    configure(next: Record<string, AddonState> | null | undefined) {
      const was = new Map([...registrations.values()].filter(r => r.folder === 'addons' && enabled(r.name)).map(r => [r.name, settings(r.name)]));
      state.clear(); lists.clear();
      for (const [name, value] of Object.entries(next ?? {})) state.set(name, { enabled: !!value?.enabled, settings: { ...value?.settings } });
      // An add-on switched off answers nothing, so its one-answer hooks are free. One switched on is
      // checked against the add-ons already on, those that were on first: on a conflict it stays off
      // and is refused with the load conflict's words.
      const kept = new Set<string>();
      const on = [...registrations.values()].filter(r => r.folder === 'addons' && enabled(r.name))
        .sort((a, b) => Number(!was.has(a.name)) - Number(!was.has(b.name)));
      for (const r of on) {
        const held = oneAnswerHeld(r, o => o.folder === 'core' || kept.has(o.name));
        // Each reply configures again, so a refusal already listed is not listed twice.
        if (held) { state.set(r.name, { ...state.get(r.name)!, enabled: false }); if (!refusals.some(x => x.name === r.name && x.message === held)) refuse(r.name, held); continue; }
        kept.add(r.name);
      }
      const tell = (hook: 'addon.off' | 'addon.on', r: DispatchRegistration, own: Record<string, unknown>) => {
        const core = [...registrations.values()].filter(c => c.folder === 'core' && c.hooks[hook]);
        for (const listener of r.hooks[hook] ? [r, ...core] : core)
          call(listener, hook, () => listener.hooks[hook]!({ name: r.name }, listener === r ? own : settings(listener.name)));
      };
      for (const r of registrations.values()) {
        if (r.folder !== 'addons') continue;
        const had = was.get(r.name);
        if (had && !enabled(r.name)) { tell('addon.off', r, had); actions.drop(r.name); }
        else if (!had && enabled(r.name)) tell('addon.on', r, settings(r.name));
      }
    },
    enabled, settings,
    // The add-on manager's check before a switch turns on (http.ts `save`): the conflict that would
    // keep `name` off while the add-ons in `on` are on, or undefined.
    switchProblem(name: string, on: ReadonlySet<string>): string | undefined {
      const r = registrations.get(name);
      return r && oneAnswerHeld(r, o => o.folder === 'core' || on.has(o.name));
    },
    // True when an enabled add-on moves, so the role runner builds its view only then.
    moving: () => answering('movement.request').length > 0,
    // The best enabled add-on answer for this tick: the highest tier first, then load order.
    moverAnswer<View>(view: View): { registration: string; mover: Mover<View>; answer: MoverAnswer } | null {
      if (!answering('movement.request').length) return null;
      let best: { registration: string; mover: Mover<View>; answer: MoverAnswer } | null = null;
      for (const r of answering('movement.request')) {
        for (const mover of r.hooks['movement.request']! as readonly Mover<View>[]) {
          if (best && rank(mover.tier) <= rank(best.mover.tier)) continue;
          const answer = call(r, 'movement.request', () => (mover.answer as Answer2<View, MoverAnswer> | undefined)?.(view, scoped(r.name)));
          if (answer) best = { registration: r.name, mover, answer };
        }
      }
      return best;
    },
    // A core mover's place in the chain: an add-on answer runs before the first core mover
    // whose tier ranks below its own (Step 9 design "The movers in one list").
    coreTier(mover: string): Tier {
      const tier = coreMovers.get(mover);
      if (!tier) throw Error(`No core mover named ${mover}`);
      return tier;
    },
    before(answer: { mover: Mover<unknown> } | null, coreMover: string): boolean {
      if (!answer) return false;
      const own = rank(answer.mover.tier), core = rank(this.coreTier(coreMover));
      return own > core || own === core && positioning.has(coreMover);
    },
    // Step 9b hook points. A refusal names the add-on, so the step's record says who refused it.
    stepRefusal(view: unknown, to: { x: number; y: number }): string | undefined {
      return refusal('step.safety', r => r.hooks['step.safety']!(view, to, scoped(r.name)));
    },
    // True when an enabled add-on keeps step safety zones, so the owner builds its view only then.
    guardsSteps: () => answering('step.safety').length > 0,
    // Every enabled target mode add-on's tick: each runs once per report, whatever entry the
    // scope holds, so it can let go of its target when the player picks another entry.
    // `scope` is the farming scope the call runs for; the settings owner's `addonValues` gives the
    // settings it reads.
    targetTicks(): { name: string; mode: string; tick(view: unknown, scope?: unknown): Record<string, unknown> | undefined }[] {
      return [...slotHolders.entries()].filter(([key, h]) => key.startsWith('target-mode:') && h.fills === 'choice').flatMap(([key, h]) => {
        const r = registrations.get(h.name);
        return r && r.folder === 'addons' && enabled(r.name) && r.hooks['target.mode']
          ? [{ name: r.name, mode: key.slice('target-mode:'.length), tick: (view: unknown, scope?: unknown) => within(frameOf(view, scope),
            () => call(r, 'target.mode', () => r.hooks['target.mode']!(view, scoped(r.name)))) }] : [];
      });
    },
    // A decision hook of one add-on's own task: only that add-on answers, while it is on.
    // An answer that throws counts as none and is recorded with the notices' errors.
    ownTask(hook: OwnTaskHook, addon: string, view: Readonly<Record<string, unknown>>): unknown {
      const r = registrations.get(addon), answer = r && r.folder === 'addons' && enabled(r.name) ? r.hooks[hook] : undefined;
      return answer && call(r!, hook, () => answer(view, scoped(r!.name)));
    },
    // The enabled target mode add-on's settings route. Its answer runs through `call`. An answer that
    // throws or breaks `TargetSettingsAnswer`'s shape is the add-on's failure, which the route replies
    // with. A broken shape goes to the error log, as a throw does.
    targetSettings(name: string): ((view: unknown, scope?: unknown) => TargetSettingsAnswer) | null {
      const r = registrations.get(name);
      if (!(r && r.folder === 'addons' && enabled(r.name) && r.hooks['target.settings'])) return null;
      return (view, scope) => {
        // The add-on's answer is read as `unknown`, and isSettingsAnswer checks its shape.
        const answered = within(frameOf(view, scope), () => call(r, 'target.settings', (): { answer: unknown } => ({ answer: r.hooks['target.settings']!(view, scoped(r.name)) })));
        if (!answered) return { ok: false, status: ADDON_FAILED_STATUS, error: `${r.name}'s settings threw` };
        if (isSettingsAnswer(answered.answer)) return answered.answer;
        const problem = `answered ${JSON.stringify(answered.answer) ?? 'nothing'}, not { ok, reply } or { ok: false, status, error }`;
        record(r.name, 'target.settings', problem);
        return { ok: false, status: ADDON_FAILED_STATUS, error: `${r.name}'s settings ${problem}` };
      };
    },
    // The enabled add-on's command route, with `target.settings`'s shape check and failure reply.
    // The coordinator answers first. A `{forward: true}` answer puts the body in the named
    // character's `addon-inbox`, and the route replies with the forward's id.
    addonCommand(name: string): ((view: AddonCommandView, scope?: unknown) => TargetSettingsAnswer) | null {
      const r = registrations.get(name);
      if (!(r && r.folder === 'addons' && enabled(r.name) && r.hooks['addon.command'])) return null;
      return (view, scope) => {
        const answered = within(frameOf(view, scope), () => call(r, 'addon.command', (): { answer: unknown } =>
          ({ answer: (r.hooks['addon.command'] as Answer2<AddonCommandView, unknown>)(view, scoped(r.name)) })));
        if (!answered) return { ok: false, status: ADDON_FAILED_STATUS, error: `${r.name}'s command threw` };
        if (isForward(answered.answer)) {
          if (!view.character) return { ok: false, status: 400, error: `${r.name} forwarded a command that names no character` };
          const id = `${r.name}:${Date.now().toString(36)}:${++inboxSeq}`;
          inbox.set(view.character, [...inbox.get(view.character) ?? [], { id, addon: r.name, body: view.body }]);
          return { ok: true, reply: { forwarded: id } };
        }
        if (isSettingsAnswer(answered.answer)) return answered.answer;
        const problem = `answered ${JSON.stringify(answered.answer) ?? 'nothing'}, not { ok, reply } or { ok: false, status, error }`;
        record(r.name, 'addon.command', problem);
        return { ok: false, status: ADDON_FAILED_STATUS, error: `${r.name}'s command ${problem}` };
      };
    },
    // The side this registry runs on, set by that side's install. A character names itself
    // and how it reads its own 0 HP, which the common holds read.
    attach(on: { side: 'coordinator' } | { side: 'character'; name: string; dead?(): boolean }): void {
      side = on.side;
      if (on.side === 'character') { self = { name: on.name, ...(on.dead ? { dead: on.dead } : {}) }; stores.self(on.name); }
    },
    side: () => side,
    within,
    // Table A's `addons` row on the character: the reply's switches and settings, the
    // scope's owner and values, the add-on stores, then the coordinator's asks and forwarded
    // commands. A reply answers the report before it, so the outcomes and command replies
    // that report carried leave.
    reply(state: { addons?: Record<string, AddonState> | null; addonStores?: unknown; addonScope?: { owner?: unknown; settings?: unknown } | null;
      addonActions?: readonly QueuedAction[] | null; addonInbox?: readonly { id: string; addon: string; body: unknown }[] | null;
      slotEntries?: Record<string, string> | null }) {
      if ('slotEntries' in state) { selected.clear(); for (const [slot, entry] of Object.entries(state.slotEntries || {})) selected.set(slot, entry); }
      this.configure(state.addons || {});
      if (state.addonScope && typeof state.addonScope.owner === 'string')
        scopeGiven = { owner: state.addonScope.owner, settings: { ...(state.addonScope.settings as Record<string, Record<string, unknown>> | undefined) } };
      stores.restore(state.addonStores);
      if (!('addonActions' in state || 'addonInbox' in state)) return;
      for (const list of [results, replies] as { sent: boolean }[][]) for (let i = list.length - 1; i >= 0; i--) if (list[i]!.sent) list.splice(i, 1);
      if (side !== 'character' || !self) return;
      for (const a of state.addonActions ?? []) if (!carried.has(a.id) && enabled(a.addon)) {
        carried.add(a.id); actions.carry({ ...a, character: self.name });
      }
      for (const item of state.addonInbox ?? []) {
        if (carried.has(item.id)) continue;
        carried.add(item.id);
        const r = registrations.get(item.addon), answer = r && r.folder === 'addons' && enabled(r.name) ? r.hooks['addon.command'] : undefined;
        const view: AddonCommandView = { owner: scopeGiven?.owner ?? '', character: self.name, store: stores.values(item.addon, 'scope'),
          now: Date.now(), body: item.body };
        const reply = answer ? call(r!, 'addon.command', () => (answer as Answer2<AddonCommandView, unknown>)(view, scoped(r!.name))) : { ok: false, status: 404, error: `${item.addon} is off or takes no command here` };
        replies.push({ sent: false, reply: { id: item.id, addon: item.addon, reply: reply ?? null } });
      }
      while (carried.size > CARRIED_KEPT) carried.delete(carried.values().next().value!);
      pump();
    },
    // The scope store's `deliver` field: what a target mode add-on hands its scope's characters.
    delivered: (name: string): unknown => stores.handles(name, () => {}).scope.get('deliver'),
    // A slot's entries in load order: the console's own, then each enabled add-on's.
    entries: (slot: SlotName): SlotEntry[] => [...slotHolders.entries()].filter(([key, h]) => key.startsWith(slot + ':') &&
      h.fills === 'choice' && enabled(h.name)).map(([key, h]) => ({ mode: key.slice(slot.length + 1), addon: h.name, button: h.button!, ...(h.status ? { status: h.status } : {}),
      ...(h.classes ? { classes: h.classes } : {}) })),
    // The target mode entries the enabled add-ons add, for the dashboard's mode list.
    targetModes: (): { mode: string; addon: string }[] => [...slotHolders.entries()].filter(([key, h]) => key.startsWith('target-mode:') &&
      h.fills === 'choice' && registrations.get(h.name)?.folder === 'addons' && enabled(h.name)).map(([key, h]) => ({ mode: key.slice('target-mode:'.length), addon: h.name })),
    // The add-on stores the character reports with each status and adopts from each reply, and
    // the coordinator's book of every store (store.ts).
    stores: { report: stores.report, restore: stores.restore, handles: stores.handles, book },
    // C1 and C4 on the character: the outcomes of the coordinator's asks and the replies to its
    // forwarded commands, which each report carries until a reply answers it. A report sent passes
    // one interval for the outcomes `ctx.outcome` keeps.
    carriedResults(): ActionOutcome[] {
      for (const item of results) item.sent = true;
      if (self) actions.passed(self.name);
      return results.map(r => r.outcome);
    },
    carriedReplies(): { id: string; addon: string; reply: unknown }[] {
      for (const item of replies) item.sent = true;
      return replies.map(r => r.reply);
    },
    // C2 (lane L4): one step of an add-on merchant job, run now through the same dispatcher at the
    // job's band. `holder` names the job that holds the merchant, so 08's stand door lets the job's
    // own step through.
    actions: {
      dispatch(step: ActionAsk, on: { band: 'background' | 'job'; holder?: string; addon: string; character?: string }): Promise<ActionOutcome> {
        const character = on.character ?? self?.name ?? '';
        const a: QueuedAction = { id: `${on.addon}:${on.holder ?? 'step'}:${Date.now().toString(36)}:${++inboxSeq}`, addon: on.addon, character,
          action: step.action, args: { ...step.args }, reason: String(step.reason ?? '') };
        return runAction(a, { row: action => ACTIONS[action], door: name => doors.get(name), holds: () => holds({ name: character, ...(self?.dead ? { dead: self.dead } : {}) }) },
          { band: on.band, ...(on.holder ? { holder: on.holder } : {}) });
      },
    },
    // C1 on the coordinator: the asks this character's reply carries, its pending asks and every
    // ask in flight until its outcome comes back.
    // A door published on the coordinator (07's Cave entry) runs its ask here once, and the outcome
    // settles it; every other ask rides with its owner's facts. Facts its owner cannot give now are
    // left out, so the door refuses as it does with none.
    carriedAsks(character: string): QueuedAction[] {
      actions.take(character);
      return actions.inFlight(character).flatMap(a => {
        const row = ACTIONS[a.action];
        if (row && 'door' in row && doors.has(row.door)) {
          if (!running.has(a.id)) {
            running.add(a.id);
            void runAction(a, { row: action => ACTIONS[action], door: name => doors.get(name), holds: () => holds({ name: character }) })
              .then(outcome => { running.delete(a.id); actions.settle(outcome); });
          }
          return [];
        }
        const facts = askFacts.get(ACTION_OWNERS[a.action] ?? '');
        let given: Readonly<Record<string, unknown>> | undefined;
        try { given = facts?.(a); } catch (error) { record(a.addon, 'addon.acted', `the facts for ${a.action}: ${String(error)}`); }
        return [given ? { ...a, facts: given } : a];
      });
    },
    // The forwarded commands this character's reply carries until its report answers them.
    inbox: (character: string) => [...inbox.get(character) ?? []],
    // A character's report on the coordinator: each outcome it carries settles its ask and
    // reaches the asking add-on as `addon.acted`, and each command reply leaves the inbox as
    // `addon.commanded`.
    reported(character: string, report: { addonActionResults?: unknown; addonCommandReplies?: unknown }): void {
      actions.passed(character);
      for (const outcome of Array.isArray(report.addonActionResults) ? report.addonActionResults as ActionOutcome[] : [])
        if (outcome && typeof outcome.id === 'string' && outcome.character === character) actions.reported(outcome);
      for (const answer of Array.isArray(report.addonCommandReplies) ? report.addonCommandReplies as { id: string; addon: string; reply: unknown }[] : []) {
        const waiting = inbox.get(character) ?? [], found = waiting.find(item => item.id === answer?.id);
        if (!found) continue;
        inbox.set(character, waiting.filter(item => item !== found));
        tellAddon(found.addon, 'addon.commanded', { id: found.id, character, addon: found.addon, reply: answer.reply ?? null });
      }
    },
    // C1: each enabled add-on's tick for one character on this side; the coordinator names the
    // character's scope. On the character the queued actions run after the ticks.
    tick(character: string, scope?: { owner: string; state: unknown }): void {
      within({ character, ...(scope ? { owner: scope.owner, scope: scope.state } : {}) }, () => {
        for (const r of answering('addon.tick')) call(r, 'addon.tick', () => (r.hooks['addon.tick'] as Answer2<AddonTickView, void>)({ character, now: Date.now() }, scoped(r.name)));
      });
      pump();
    },
    // C1: an owner's doors on this side, by the door name its `ACTIONS` rows give. A name no row
    // gives is refused, so a door never runs outside the table.
    publishDoors(given: Readonly<Record<string, Door>>): { ok: true } | { ok: false; message: string } {
      const named = new Set(Object.values(ACTIONS).flatMap(row => 'door' in row ? [row.door] : []));
      const stranger = Object.keys(given).find(name => !named.has(name));
      if (stranger) return { ok: false, message: `no ACTIONS row names the door ${JSON.stringify(stranger)}` };
      for (const [name, door] of Object.entries(given)) doors.set(name, door);
      return { ok: true };
    },
    // C1 on the coordinator: an owner's facts for its character doors, by the owner of the ACTIONS
    // rows. An owner with no ACTIONS row is refused.
    publishFacts(given: Readonly<Record<string, AskFacts>>): { ok: true } | { ok: false; message: string } {
      const owners = new Set(Object.values(ACTION_OWNERS));
      const stranger = Object.keys(given).find(owner => !owners.has(owner));
      if (stranger) return { ok: false, message: `owner ${JSON.stringify(stranger)} has no ACTIONS row` };
      for (const [owner, facts] of Object.entries(given)) askFacts.set(owner, facts);
      return { ok: true };
    },
    // C3: an owner's `READS` answers on this side, by row name.
    publishReads(given: Readonly<Record<string, (...args: readonly unknown[]) => unknown>>): { ok: true } | { ok: false; message: string } {
      const stranger = Object.keys(given).find(name => !(name in READS));
      if (stranger) return { ok: false, message: `${JSON.stringify(stranger)} is not a READS row` };
      for (const [name, answer] of Object.entries(given)) reads.set(name, answer);
      return { ok: true };
    },
    // 12 D4's `diagnostics-ring` slot: each enabled add-on's own rings in load order, each under its
    // add-on's name.
    rings: (): { ring: string; addon: string; label: string; read?: AddonRing['read'] }[] => [...registrations.values()]
      .filter(r => r.folder === 'addons' && enabled(r.name)).flatMap(r => Object.entries(r.rings ?? {})
        .map(([key, ring]) => ({ ring: `${r.name}.${key}`, addon: r.name, label: ring.label, ...(ring.read ? { read: ring.read } : {}) }))),
    // 12 D4's `status.line`: each enabled add-on's line for one character's card, in load order.
    statusLines(ask: { character: string; line: string }): { addon: string; label: string }[] {
      return answers('status.line', r => r.hooks['status.line']!(ask, scoped(r.name)))
        .flatMap(({ addon, answer }) => answer.label ? [{ addon, label: String(answer.label) }] : []);
    },
    reports(view: unknown): Record<string, Record<string, unknown>> {
      return Object.fromEntries(answers('status.report', r => (r.hooks['status.report'] as Answer2<unknown, Record<string, unknown> | undefined>)(view, scoped(r.name)))
        .map(({ addon, answer }) => [addon, answer]));
    },
    // `scope` is the group's farming scope, whose placed values win over the account's. A call with
    // no scope runs in the frame its caller set (`within`).
    anchor(members: readonly AnchorMember[], scope?: unknown): string | undefined {
      const r = answering('group.anchor')[0];
      return r && within(scope === undefined ? frame : { ...frame, scope }, () => call(r, 'group.anchor', () => r.hooks['group.anchor']!(members, scoped(r.name))));
    },
    // Notices change nothing, so a listener that throws is recorded and the rest still run. The
    // names of the listeners that threw come back.
    notify(hook: NoticeName, payload: Record<string, unknown>): string[] {
      return answering(hook).filter(r => call(r, hook, () => { r.hooks[hook]!(payload, scoped(r.name)); return true; }) !== true).map(r => r.name);
    },
    noticeErrors: () => [...errors.values()],
    // A row an add-on asks through addon-api.ts `read`: a hook row's one answer, or an owner's
    // published `READS` answer, on the side the row runs on. A read on the other side fails naming
    // the side.
    askRow(hook: ReadName, question: readonly unknown[]): unknown { return askRow(hook, question); },
    // An ask with one core answer (04's reads and requests, movement's follow and walks, the other
    // owners' reads), in the caller's shape. `PublishedReads` holds the writes and requests their
    // owner publishes beside the reads; `askRow` keeps the reads an add-on may ask.
    // It reads no `this`, so an owner hands it on as a port: survival's Stomp gates take it whole.
    ask<H extends PublishedRead>(hook: H, ...args: Parameters<PublishedReads[H]>): ReturnType<PublishedReads[H]> {
      return (answerOf(hook) as (...a: Parameters<PublishedReads[H]>) => ReturnType<PublishedReads[H]>)(...args);
    },
    answerOf,
    // The turns owner's pass: every enabled requester's answer, in
    // load order, core first. A requester that throws asks nothing this pass, and the error is
    // kept with the notices' so one broken add-on stops no spend.
    skillRequests(view: unknown): { registration: string; requester: SpendRequester; answer: SpendAsk }[] {
      const out: { registration: string; requester: SpendRequester; answer: SpendAsk }[] = [];
      const ordered = [...answering('skills.request')].sort((a, b) => Number(a.folder !== 'core') - Number(b.folder !== 'core'));
      for (const r of ordered) for (const requester of r.hooks['skills.request']!) {
        const answer = call(r, 'skills.request', () => requester.answer(view, scoped(r.name)));
        for (const ask of answer === undefined ? [] : Array.isArray(answer) ? answer as readonly SpendAsk[] : [answer as SpendAsk]) out.push({ registration: r.name, requester, answer: ask });
      }
      return out;
    },
    // Each owner's asks with its rule for a missing answer live in its row file's `dispatch`; the
    // registry composes them under the names their callers use.
    turns: { ...t03.turns, ...t04.turns },
    skills: { ...t03.skills, ...s05.skills },
    calls: c09.calls,
    targeting: t04.targeting,
    survival: s05.survival,
    events: events.dispatch(ctx),
    // The hunts and farming owner's decision hooks.
    hunting: hunting.dispatch(ctx),
    lifecycle: l13.lifecycle,
    roster: l13.roster,
    realm: c09.realm,
    hands: c09.hands,
    retry: c09.retry,
    walks: m02.walks,
    movement: m02.movement,
    // `addon:map`: the hook table, the tiers in rank order and who answers each hook.
    map() {
      return {
        hooks: Object.entries(HOOKS).map(([name, hook]) => ({ name, ...hook,
          answeredBy: [...registrations.values()].filter(r => name in r.hooks).map(r => r.name) })),
        tiers: tiersInRankOrder().map(tier => ({ tier, rank: rank(tier), addons: rank(tier) < MANUAL,
          movers: [...registrations.values()].flatMap(r => (r.hooks['movement.request'] ?? []).filter(m => m.tier === tier).map(m => `${r.name}/${m.name}`)) })),
        slots: [...slotHolders.entries()].map(([key, holder]) => ({ slot: key.split(':')[0], mode: key.slice(key.indexOf(':') + 1), ...holder })),
        registrations: [...registrations.values()].map(r => ({ name: r.name, folder: r.folder, author: r.author, summary: r.summary,
          settings: r.settings ?? {}, enabled: enabled(r.name) })),
      };
    },
  };
  return api;
}
export type HookRegistry = ReturnType<typeof createRegistry>;
